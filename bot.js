"use strict";

// ============================================================
//  بوت تيليجرام شامل — Sonjj API الحقيقي
//  temp_email + temp_gmail + temp_outlook + VirusTotal
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");

// ===================== الإعدادات =====================
const BOT_TOKEN  = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const SONJJ_KEY  = "e802e32c0107fdba6b515500e75a14341caeefcf3bbe8d8c08123fc21f102c8e";
const VT_KEY     = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY     = "u3469811-ab163c31f24d6012491f0807";
const DEV_ID     = 7411444902;
const PORT       = process.env.PORT || 8080;
const SONJJ_BASE = "https://app.sonjj.com";

// ===================== Keep-Alive =====================
http.createServer((_,res)=>{ res.writeHead(200); res.end("OK"); })
  .listen(PORT,"0.0.0.0",()=>console.log(`✅ Port ${PORT}`));

// ===================== قاعدة البيانات =====================
const DB = {
  users:         {},
  sessions:      {},
  activeEmails:  {}, // uid -> { email, type, createdAt }
  savedEmails:   {}, // uid -> [{email, type, label, savedAt}]
  savedPasswords:{}, // uid -> [{platform, password, savedAt}]
  emailHistory:  {}, // uid -> [{email, type, time, msgCount}]
  activityLog:   {}, // uid -> [{action, detail, time}]
  referrals:     {},
  referralOf:    {},
  referralPerks: {},
  logs:          [],
  admins:        new Set([DEV_ID]),
  announcements: [],
  settings: {
    maxEmailsPerDay: 30,
    cooldown:        8,
    emailWatchMin:   20,
    refBonus:        5,
    maintenanceMode: false,
  },
  lastReq:  {},
  daily:    {},
  vtCache:  {},
  state:    {},
  domainsCache: { list:[], ts:0 },
};

// ===================== مساعدات =====================
const now   = () => Math.floor(Date.now()/1000);
const today = () => new Date().toISOString().slice(0,10);
const stamp = () => new Date().toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function log(type, uid, text) {
  DB.logs.unshift({type,uid,text,time:stamp()});
  if(DB.logs.length>1000) DB.logs.pop();
  if(!DB.activityLog[uid]) DB.activityLog[uid]=[];
  DB.activityLog[uid].unshift({action:type,detail:text,time:stamp()});
  if(DB.activityLog[uid].length>50) DB.activityLog[uid].pop();
}

function ensureUser(ctx) {
  const u = ctx.from;
  if(!DB.users[u.id]){
    DB.users[u.id]={
      name:u.first_name||"مجهول", username:u.username||"",
      joinedAt:stamp(), banned:false, muted:false, role:"user",
      passwordHash:null, accountEmail:null, lastSeen:stamp(), msgCount:0,
    };
    log("join",u.id,u.first_name||"مجهول");
  }
  DB.users[u.id].name     = u.first_name||DB.users[u.id].name;
  DB.users[u.id].username = u.username  ||DB.users[u.id].username;
  DB.users[u.id].lastSeen = stamp();
  DB.users[u.id].msgCount = (DB.users[u.id].msgCount||0)+1;
}

const isDev   = id => id===DEV_ID;
const isAdmin = id => DB.admins.has(id)||isDev(id);
const isBanned= id => DB.users[id]?.banned;

function dailyCount(id){ return DB.daily[`e_${id}_${today()}`]||0; }
function incDaily(id)  { const k=`e_${id}_${today()}`; DB.daily[k]=(DB.daily[k]||0)+1; }
function maxDay(id)    { return DB.settings.maxEmailsPerDay+(DB.referralPerks[id]?.extra||0); }

function hashPass(p){ return crypto.createHash("sha256").update(p+"SALT_V2").digest("hex"); }
function randStr(n=10){ return crypto.randomBytes(n).toString("base64").replace(/[^a-z0-9]/gi,"").slice(0,n).toLowerCase(); }
function genStrongPass(){
  const up="ABCDEFGHJKLMNPQRSTUVWXYZ",lo="abcdefghjkmnpqrstuvwxyz",nu="23456789",sp="@#$!_-";
  let p="";
  for(let i=0;i<4;i++) p+=up[Math.floor(Math.random()*up.length)];
  for(let i=0;i<4;i++) p+=lo[Math.floor(Math.random()*lo.length)];
  for(let i=0;i<3;i++) p+=nu[Math.floor(Math.random()*nu.length)];
  for(let i=0;i<2;i++) p+=sp[Math.floor(Math.random()*sp.length)];
  return p.split("").sort(()=>Math.random()-0.5).join("");
}

// ===================== Sonjj API =====================
const sonjjHeaders = { "X-Api-Key": SONJJ_KEY, "Accept": "application/json" };

// جلب النطاقات المتاحة (مع كاش 10 دقائق)
async function getTempDomains() {
  if(now()-DB.domainsCache.ts < 600 && DB.domainsCache.list.length)
    return DB.domainsCache.list;
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_email/domains`,
      {headers:sonjjHeaders, timeout:10000});
    const list = r.data?.domains || [];
    if(list.length){ DB.domainsCache={list,ts:now()}; return list; }
  } catch(e){ console.error("domains:",e.message); }
  return ["guerrillamailblock.com"];
}

// إنشاء إيميل مؤقت على نطاق محدد
async function createTempEmail(emailAddress, expiryMin=20) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_email/create`,{
      headers: sonjjHeaders,
      params:  { email: emailAddress, expiry_minutes: expiryMin },
      timeout: 12000,
    });
    return r.data;
  } catch(e){
    console.error("createTempEmail:",e.response?.data||e.message);
    return null;
  }
}

// فحص صندوق الوارد للإيميل المؤقت
async function getTempInbox(emailAddress) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_email/inbox`,{
      headers: sonjjHeaders,
      params:  { email: emailAddress },
      timeout: 10000,
    });
    return r.data?.messages || [];
  } catch(e){ return []; }
}

// قراءة رسالة محددة
async function getTempMessage(emailAddress, mid) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_email/message`,{
      headers: sonjjHeaders,
      params:  { email: emailAddress, mid },
      timeout: 10000,
    });
    return r.data?.body || null;
  } catch(e){ return null; }
}

// Gmail مؤقت عشوائي
async function getRandomGmail() {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_gmail/random`,
      {headers:sonjjHeaders, timeout:10000});
    return r.data;
  } catch(e){ return null; }
}

// Outlook مؤقت عشوائي
async function getRandomOutlook() {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_outlook/random`,
      {headers:sonjjHeaders, timeout:10000});
    return r.data;
  } catch(e){ return null; }
}

// فحص صندوق Gmail
async function getGmailInbox(email, timestamp) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_gmail/inbox`,{
      headers: sonjjHeaders,
      params:  { email, timestamp },
      timeout: 10000,
    });
    return r.data?.messages || [];
  } catch(e){ return []; }
}

// قراءة رسالة Gmail
async function getGmailMessage(email, mid, timestamp) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_gmail/message`,{
      headers: sonjjHeaders,
      params:  { email, mid, timestamp },
      timeout: 10000,
    });
    return r.data?.body || null;
  } catch(e){ return null; }
}

// فحص صندوق Outlook
async function getOutlookInbox(email, timestamp) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_outlook/inbox`,{
      headers: sonjjHeaders,
      params:  { email, timestamp },
      timeout: 10000,
    });
    return r.data?.messages || [];
  } catch(e){ return []; }
}

// قراءة رسالة Outlook
async function getOutlookMessage(email, mid, timestamp) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_outlook/message`,{
      headers: sonjjHeaders,
      params:  { email, mid, timestamp },
      timeout: 10000,
    });
    return r.data?.body || null;
  } catch(e){ return null; }
}

// ===================== مراقب الإيميل (الدقيق) =====================
async function emailWatcher(bot, uid, emailData, chatId) {
  const { email, type, timestamp } = emailData;
  const endTime = now() + DB.settings.emailWatchMin * 60;
  const seenMids = new Set();
  let checkCount = 0;

  console.log(`👀 مراقبة: ${email} | نوع: ${type}`);

  while(now() < endTime) {
    await sleep(7000); // فحص كل 7 ثواني

    // تحقق أن الإيميل لا يزال نشطاً
    if(!DB.activeEmails[uid] || DB.activeEmails[uid].email !== email) {
      console.log(`🛑 توقفت المراقبة: ${email}`);
      return;
    }

    checkCount++;
    let messages = [];

    try {
      if(type === "gmail") {
        messages = await getGmailInbox(email, timestamp);
      } else if(type === "outlook") {
        messages = await getOutlookInbox(email, timestamp);
      } else {
        messages = await getTempInbox(email);
      }
    } catch(e) { continue; }

    for(const msg of messages) {
      const mid = msg.mid || msg.id || String(msg.textDate);
      if(seenMids.has(mid)) continue;
      seenMids.add(mid);

      // قراءة محتوى الرسالة
      let body = "";
      try {
        if(type === "gmail") {
          body = await getGmailMessage(email, mid, timestamp) || "";
        } else if(type === "outlook") {
          body = await getOutlookMessage(email, mid, timestamp) || "";
        } else {
          body = await getTempMessage(email, mid) || "";
        }
      } catch(e){}

      // تنظيف HTML
      body = body.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim().slice(0,1000);

      // استخراج الأكواد/OTP
      const otpMatch = body.match(/\b\d{4,8}\b/g);
      const otpText = otpMatch ? `\n\n🔑 *الكود المحتمل:* \`${otpMatch[0]}\`` : "";

      log("email_received", uid, `${email} | ${msg.textSubject||"بدون موضوع"}`);

      if(DB.emailHistory[uid]) {
        const idx = DB.emailHistory[uid].findIndex(e=>e.email===email);
        if(idx>=0) DB.emailHistory[uid][idx].msgCount=(DB.emailHistory[uid][idx].msgCount||0)+1;
      }

      try {
        await bot.telegram.sendMessage(chatId,
          `📧 *وصلت رسالة جديدة!*\n\n` +
          `📬 *من:* \`${msg.textFrom||"—"}\`\n` +
          `📋 *الموضوع:* ${msg.textSubject||"(بدون موضوع)"}\n` +
          `🕐 *التاريخ:* ${msg.textDate||stamp()}` +
          otpText +
          `\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
          {parse_mode:"Markdown",...emailActiveKb(email,type,timestamp)}
        );
      } catch(e){ console.error("sendMsg:",e.message); }
    }
  }

  // انتهى وقت المراقبة
  if(DB.activeEmails[uid]?.email === email) {
    delete DB.activeEmails[uid];
    try {
      await bot.telegram.sendMessage(chatId,
        `⏰ *انتهى وقت مراقبة:*\n\`${email}\`\n\nيمكنك إنشاء إيميل جديد 📧`,
        {parse_mode:"Markdown",...mainKb()}
      );
    } catch{}
  }
}

// ===================== VirusTotal =====================
async function vtScanUrl(url) {
  if(DB.vtCache[url] && now()-DB.vtCache[url].ts<3600)
    return DB.vtCache[url].result;
  try {
    const enc = Buffer.from(url).toString("base64")
      .replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r = await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr  = r.data?.data?.attributes||{};
    const result= {
      stats:      attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      title:      attr.title||"",
      categories: attr.categories||{},
    };
    DB.vtCache[url]={result,ts:now()};
    return result;
  } catch{ return null; }
}

async function vtScanDomain(domain) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/domains/${domain}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr = r.data?.data?.attributes||{};
    return { stats: attr.last_analysis_stats||{}, reputation: attr.reputation||0 };
  } catch{ return null; }
}

async function vtScanIp(ip) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr = r.data?.data?.attributes||{};
    return { stats: attr.last_analysis_stats||{}, reputation: attr.reputation||0, country: attr.country||"—" };
  } catch{ return null; }
}

// رفع ملف لفحصه
async function vtUploadFile(buffer, filename) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", buffer, {filename: filename||"file"});
    const r = await axios.post("https://www.virustotal.com/api/v3/files", form, {
      headers:{...form.getHeaders(),"x-apikey":VT_KEY},
      timeout: 60000,
    });
    return r.data?.data?.id || null;
  } catch(e){ console.error("vtUpload:",e.message); return null; }
}

async function vtGetAnalysis(id) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/analyses/${id}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    return r.data?.data?.attributes || null;
  } catch{ return null; }
}

// ===================== UptimeRobot =====================
async function getMonitors() {
  try {
    const r = await axios.post("https://api.uptimerobot.com/v2/getMonitors",
      `api_key=${UR_KEY}&format=json&response_times=1&all_time_uptime_ratio=1`,
      {headers:{"Content-Type":"application/x-www-form-urlencoded"},timeout:10000});
    return r.data?.monitors||[];
  } catch{ return []; }
}

// ===================== لوحات المفاتيح =====================
const mainKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("📧 إيميل مؤقت","menu_emails"),
   Markup.button.callback("🔑 كلمات السر","menu_passwords")],
  [Markup.button.callback("🔍 فحص أمان","menu_vt"),
   Markup.button.callback("🌐 مراقبة مواقع","menu_uptime")],
  [Markup.button.callback("📊 إحصائياتي","my_stats"),
   Markup.button.callback("🎁 الإحالة","referral")],
  [Markup.button.callback("📋 سجلي","my_history"),
   Markup.button.callback("👤 حسابي","my_account")],
  [Markup.button.callback("ℹ️ مساعدة","help")],
]);

const backKb = () => Markup.inlineKeyboard([[Markup.button.callback("🔙 الرئيسية","back")]]);

const emailActiveKb = (email, type, timestamp) => {
  const ts = timestamp||0;
  return Markup.inlineKeyboard([
    [Markup.button.callback("📨 فتح الصندوق",`inbox:${type}:${ts}:${email}`),
     Markup.button.callback("🔄 تحديث",`inbox:${type}:${ts}:${email}`)],
    [Markup.button.callback("💾 حفظ الإيميل",`save_email:${type}:${ts}:${email}`),
     Markup.button.callback("🗑 إنهاء",`del_email:${email}`)],
    [Markup.button.callback("🔙 الرئيسية","back")],
  ]);
};

const devKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("👥 الأعضاء","dev_users"),
   Markup.button.callback("📊 إحصائيات","dev_stats")],
  [Markup.button.callback("📜 السجل","dev_logs"),
   Markup.button.callback("📢 رسالة جماعية","dev_broadcast")],
  [Markup.button.callback("🔨 حظر","dev_ban"),
   Markup.button.callback("✅ رفع حظر","dev_unban")],
  [Markup.button.callback("🔇 كتم","dev_mute"),
   Markup.button.callback("🔊 رفع كتم","dev_unmute")],
  [Markup.button.callback("⭐ ترقية","dev_promote"),
   Markup.button.callback("⬇️ تخفيض","dev_demote")],
  [Markup.button.callback("⚙️ الإعدادات","dev_settings"),
   Markup.button.callback("📣 إعلان","dev_announce")],
  [Markup.button.callback("🔍 بحث عضو","dev_search_user"),
   Markup.button.callback("🗑 مسح السجل","dev_clear_logs")],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

const devSettingsKb = () => Markup.inlineKeyboard([
  [Markup.button.callback(`📏 إيميلات/يوم: ${DB.settings.maxEmailsPerDay}`,"ds_max"),
   Markup.button.callback(`⏳ انتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`⏱ مراقبة: ${DB.settings.emailWatchMin}د`,"ds_watch"),
   Markup.button.callback(`🎁 مكافأة: ${DB.settings.refBonus}`,"ds_ref")],
  [Markup.button.callback(`🔧 صيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,"ds_maint")],
  [Markup.button.callback("🔙 لوحة","dev_panel")],
]);

function usersKb(action, page=0) {
  const ids = Object.keys(DB.users);
  const pp = 6, slice = ids.slice(page*pp,(page+1)*pp);
  const rows = slice.map(id=>{
    const u = DB.users[id];
    const b = u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
    return [Markup.button.callback(`${b} ${u.name.slice(0,14)} [${id}]`,`${action}:${id}`)];
  });
  const nav=[];
  if(page>0) nav.push(Markup.button.callback("◀️",`upage:${action}:${page-1}`));
  nav.push(Markup.button.callback(`${page+1}/${Math.ceil(ids.length/pp)||1}`,"noop"));
  if((page+1)*pp<ids.length) nav.push(Markup.button.callback("▶️",`upage:${action}:${page+1}`));
  if(nav.length>1) rows.push(nav);
  rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== البوت =====================
const bot = new Telegraf(BOT_TOKEN);

bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid = ctx.from.id;
  if(isBanned(uid)&&!isDev(uid)){
    try{ await ctx.reply("🚫 أنت محظور."); }catch{}
    return;
  }
  if(DB.settings.maintenanceMode&&!isAdmin(uid)){
    try{ await ctx.reply("🔧 البوت في وضع الصيانة."); }catch{}
    return;
  }
  return next();
});

// /start
bot.start(async ctx=>{
  const uid = ctx.from.id;
  delete DB.state[uid];
  const payload = ctx.startPayload;

  if(payload?.startsWith("ref_")){
    const rid = parseInt(payload.slice(4));
    if(rid!==uid&&!DB.referralOf[uid]){
      DB.referralOf[uid]=rid;
      if(!DB.referrals[rid]) DB.referrals[rid]=[];
      DB.referrals[rid].push(uid);
      if(!DB.referralPerks[rid]) DB.referralPerks[rid]={extra:0};
      DB.referralPerks[rid].extra+=DB.settings.refBonus;
      log("referral",rid,`أحال ${uid}`);
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق! حصلت على ${DB.settings.refBonus} إيميلات إضافية`); }catch{}
    }
  }

  log("start",uid,DB.users[uid]?.name);

  if(isDev(uid)){
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n👥 الأعضاء: *${Object.keys(DB.users).length}*`,
      {parse_mode:"Markdown",...devKb()}
    );
  }

  if(!DB.sessions[uid]?.verified){
    const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
    DB.sessions[uid]={verified:false, captchaAns:n1+n2};
    DB.state[uid]={mode:"captcha"};
    return ctx.reply(
      `👋 *أهلاً ${ctx.from.first_name}!*\n\n🤖 للتحقق أنك لست روبوت:\n\n🔢 كم يساوي: *${n1} + ${n2} = ?*`,
      {parse_mode:"Markdown"}
    );
  }
  showMain(ctx);
});

async function showMain(ctx){
  const uid = ctx.from.id;
  const ann = DB.announcements[0];
  let txt = `🏠 *القائمة الرئيسية*\nأهلاً *${ctx.from.first_name}* 👋`;
  if(ann) txt+=`\n\n📣 ${ann}`;
  await ctx.reply(txt,{parse_mode:"Markdown",...mainKb()});
}

bot.command("dev",   async ctx=>{ if(!isDev(ctx.from.id))return; await ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; await ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });

// ===================== الأزرار =====================
bot.on("callback_query", async ctx=>{
  await ctx.answerCbQuery().catch(()=>{});
  const data = ctx.callbackQuery.data;
  const uid  = ctx.from.id;
  const edit = (t,ex={}) =>
    ctx.editMessageText(t,{parse_mode:"Markdown",...ex})
      .catch(()=>ctx.reply(t,{parse_mode:"Markdown",...ex}));

  if(data==="noop") return;
  if(data==="back"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }

  // ═══ قائمة الإيميلات ═══
  if(data==="menu_emails"){
    const active = DB.activeEmails[uid];
    const saved  = (DB.savedEmails[uid]||[]).length;
    const used   = dailyCount(uid), max = maxDay(uid);
    const rows   = [];
    if(active){
      rows.push([Markup.button.callback(
        `📬 إيميلك: ${active.email}`,
        `inbox:${active.type}:${active.timestamp||0}:${active.email}`
      )]);
    }
    rows.push([
      Markup.button.callback("📬 إيميل مؤقت (اختر نطاق)","choose_domain_temp"),
      Markup.button.callback("🔴 Gmail حقيقي","new_gmail"),
    ]);
    rows.push([Markup.button.callback("🔵 Outlook حقيقي","new_outlook")]);
    rows.push([Markup.button.callback("🌐 عرض النطاقات","show_domains")]);
    if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`, "my_emails")]);
    rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(
      `📧 *نظام الإيميلات*\n\n✅ اليوم: *${used}/${max}*\n🔔 وصول فوري للرسائل والأكواد\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      Markup.inlineKeyboard(rows)
    );
  }

  // اختيار نطاق للإيميل المؤقت
  if(data==="choose_domain_temp"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid))
      return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلت له.\nأحِل أصدقاء للمزيد 🎁`,backKb());

    await edit("⏳ *جاري تحميل النطاقات...*");
    const domains = await getTempDomains();
    const rows = [];
    for(let i=0;i<domains.length;i+=2){
      const row=[];
      row.push(Markup.button.callback(`@${domains[i]}`,`make_temp:${domains[i]}`));
      if(domains[i+1]) row.push(Markup.button.callback(`@${domains[i+1]}`,`make_temp:${domains[i+1]}`));
      rows.push(row);
    }
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`🌐 *اختر النطاق (${domains.length} نطاق):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("make_temp:")){
    const domain = data.slice(10);
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());

    await edit("⚡ *جاري إنشاء الإيميل...*");
    const username = randStr(10);
    const emailAddress = `${username}@${domain}`;

    const result = await createTempEmail(emailAddress, DB.settings.emailWatchMin);

    if(!result){
      return edit(
        "❌ *فشل إنشاء الإيميل.*\nجرب نطاقاً آخر أو أعد المحاولة.",
        Markup.inlineKeyboard([[Markup.button.callback("🔄 جرب مجدداً","choose_domain_temp")],[Markup.button.callback("🔙 رجوع","menu_emails")]])
      );
    }

    const emailData = { email: emailAddress, type:"temp", timestamp: now(), createdAt: now() };
    DB.activeEmails[uid] = emailData;
    DB.lastReq[`e_${uid}`] = now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:emailAddress, type:"temp", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("email_created",uid,emailAddress);

    await edit(
      `✅ *تم إنشاء إيميلك!*\n\n📧 *العنوان:*\n\`${emailAddress}\`\n\n🌐 *النطاق:* \`@${domain}\`\n\n⚡ *البوت يراقب الصندوق تلقائياً*\n🔑 *سيوصلك الكود فور وصوله*\n⏱ المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      emailActiveKb(emailAddress,"temp",now())
    );
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // Gmail حقيقي
  if(data==="new_gmail"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff}ث.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي وصلت له.`,backKb());
    await edit("⚡ *جاري تحميل Gmail عشوائي...*");
    const r = await getRandomGmail();
    if(!r||!r.email) return edit("❌ فشل. حاول لاحقاً.",Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_gmail")],[Markup.button.callback("🔙 رجوع","menu_emails")]]));
    const emailData = { email:r.email, type:"gmail", timestamp:r.timestamp||now(), createdAt:now() };
    DB.activeEmails[uid]=emailData;
    DB.lastReq[`e_${uid}`]=now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:r.email, type:"gmail", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("gmail_created",uid,r.email);
    await edit(
      `✅ *تم الحصول على Gmail!*\n\n📧 *العنوان:*\n\`${r.email}\`\n\n🔴 *Gmail حقيقي — يصل لأي موقع*\n⚡ البوت يراقب فوراً ويوصلك الكود\n⏱ المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      emailActiveKb(r.email,"gmail",r.timestamp||now())
    );
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // Outlook حقيقي
  if(data==="new_outlook"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff}ث.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي وصلت له.`,backKb());
    await edit("⚡ *جاري تحميل Outlook عشوائي...*");
    const r = await getRandomOutlook();
    if(!r||!r.email) return edit("❌ فشل. حاول لاحقاً.",Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_outlook")],[Markup.button.callback("🔙 رجوع","menu_emails")]]));
    const emailData = { email:r.email, type:"outlook", timestamp:r.timestamp||now(), createdAt:now() };
    DB.activeEmails[uid]=emailData;
    DB.lastReq[`e_${uid}`]=now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:r.email, type:"outlook", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("outlook_created",uid,r.email);
    await edit(
      `✅ *تم الحصول على Outlook!*\n\n📧 *العنوان:*\n\`${r.email}\`\n\n🔵 *Outlook حقيقي — يصل لأي موقع*\n⚡ البوت يراقب فوراً ويوصلك الكود\n⏱ المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      emailActiveKb(r.email,"outlook",r.timestamp||now())
    );
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // عرض النطاقات
  if(data==="show_domains"){
    await edit("⏳ *جاري تحميل النطاقات...*");
    const domains = await getTempDomains();
    return edit(
      `🌐 *النطاقات المتاحة (${domains.length}):*\n\n${domains.map((d,i)=>`${i+1}. \`@${d}\``).join("\n")}`,
      Markup.inlineKeyboard([[Markup.button.callback("✨ اختر نطاق","choose_domain_temp")],[Markup.button.callback("🔙 رجوع","menu_emails")]])
    );
  }

  // فتح الصندوق
  if(data.startsWith("inbox:")){
    const parts = data.split(":");
    const type  = parts[1];
    const ts    = parseInt(parts[2])||0;
    const email = parts.slice(3).join(":");
    await edit("📨 *جاري فتح الصندوق...*");

    let messages = [];
    if(type==="gmail") messages = await getGmailInbox(email, ts);
    else if(type==="outlook") messages = await getOutlookInbox(email, ts);
    else messages = await getTempInbox(email);

    if(!messages.length) return edit(
      `📭 *الصندوق فارغ*\n\n\`${email}\`\n\n⚡ البوت يراقب ويوصلك الرسائل تلقائياً`,
      emailActiveKb(email,type,ts)
    );

    const rows = messages.slice(0,10).map(m=>[
      Markup.button.callback(
        `📩 ${(m.textSubject||"(بدون موضوع)").slice(0,28)}`,
        `msg:${type}:${ts}:${m.mid}:${email}`
      )
    ]);
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${type}:${ts}:${email}`)]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📬 *الصندوق (${messages.length} رسالة):*\n\`${email}\``,Markup.inlineKeyboard(rows));
  }

  // قراءة رسالة
  if(data.startsWith("msg:")){
    const parts = data.split(":");
    const type  = parts[1];
    const ts    = parseInt(parts[2])||0;
    const mid   = parts[3];
    const email = parts.slice(4).join(":");
    await edit("📖 *جاري قراءة الرسالة...*");

    let body = "";
    if(type==="gmail") body = await getGmailMessage(email, mid, ts) || "";
    else if(type==="outlook") body = await getOutlookMessage(email, mid, ts) || "";
    else body = await getTempMessage(email, mid) || "";

    body = body.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim().slice(0,1500);
    const otp = body.match(/\b\d{4,8}\b/g);
    const otpTxt = otp ? `\n\n🔑 *الكود:* \`${otp[0]}\`` : "";

    return edit(
      `📩 *الرسالة*${otpTxt}\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 الصندوق",`inbox:${type}:${ts}:${email}`)],
        [Markup.button.callback("💾 حفظ الإيميل",`save_email:${type}:${ts}:${email}`)],
      ])
    );
  }

  // حفظ إيميل
  if(data.startsWith("save_email:")){
    const parts = data.split(":");
    const type  = parts[1];
    const ts    = parseInt(parts[2])||0;
    const email = parts.slice(3).join(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    if(DB.savedEmails[uid].find(e=>e.email===email))
      return edit("✅ الإيميل محفوظ مسبقاً.",emailActiveKb(email,type,ts));
    DB.state[uid]={mode:"save_email_label",email,type,ts};
    return edit("✏️ أرسل اسم/تسمية لهذا الإيميل:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_emails")]]));
  }

  if(data==="my_emails"){
    const saved = DB.savedEmails[uid]||[];
    if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows = saved.map((e,i)=>[
      Markup.button.callback(`📧 ${e.label} — ${e.email.slice(0,25)}`,`open_saved:${i}`)
    ]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📂 *محفوظاتي (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("open_saved:")){
    const idx = parseInt(data.split(":")[1]);
    const e = DB.savedEmails[uid]?.[idx];
    if(!e) return edit("❌ لم يُعثر.",backKb());
    return edit(
      `📧 *${e.label}*\n\n\`${e.email}\`\n🏷 نوع: ${e.type}\n🕐 ${e.savedAt}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📨 فتح الصندوق",`inbox:${e.type}:${e.ts||0}:${e.email}`)],
        [Markup.button.callback("🗑 حذف",`del_saved:${idx}`),
         Markup.button.callback("🔙 رجوع","my_emails")],
      ])
    );
  }

  if(data.startsWith("del_saved:")){
    const idx = parseInt(data.split(":")[1]);
    if(DB.savedEmails[uid]) DB.savedEmails[uid].splice(idx,1);
    return edit("🗑 *تم الحذف.*",backKb());
  }

  if(data.startsWith("del_email:")){
    const email = data.slice(10);
    if(DB.activeEmails[uid]?.email===email) delete DB.activeEmails[uid];
    return edit("🗑 *تم إنهاء الإيميل.*",backKb());
  }

  if(data==="email_history"){
    const h = DB.emailHistory[uid]||[];
    if(!h.length) return edit("📊 *لا يوجد سجل.*",backKb());
    let txt=`📊 *سجل الإيميلات (${h.length}):*\n\n`;
    h.slice(0,10).forEach((e,i)=>{
      const icon=e.type==="gmail"?"🔴":e.type==="outlook"?"🔵":"📧";
      txt+=`${i+1}. ${icon} \`${e.email}\`\n   📩 ${e.msgCount||0} رسالة | 🕐 ${e.time}\n\n`;
    });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_emails")]]));
  }

  // ═══ كلمات السر ═══
  if(data==="menu_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    return edit(
      `🔑 *مدير كلمات السر*\n\n💾 محفوظة: *${saved.length}*`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔐 توليد كلمة سر قوية","gen_pass")],
        [Markup.button.callback("💾 كلمات السر المحفوظة","my_passwords")],
        [Markup.button.callback("➕ حفظ كلمة سر","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="gen_pass"){
    const p = genStrongPass();
    return edit(
      `🔐 *كلمة السر الجديدة:*\n\n\`${p}\`\n\n📊 الطول: ${p.length} حرف`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💾 حفظها",`store_pass:${p}`)],
        [Markup.button.callback("🔄 توليد أخرى","gen_pass")],
        [Markup.button.callback("🔙 رجوع","menu_passwords")],
      ])
    );
  }

  if(data.startsWith("store_pass:")){
    const pass = data.slice(11);
    DB.state[uid]={mode:"store_pass_platform",pass};
    return edit("✏️ أرسل اسم المنصة:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]]));
  }

  if(data==="save_pass_prompt"){
    DB.state[uid]={mode:"save_pass_custom"};
    return edit("✏️ أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]]));
  }

  if(data==="my_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر.*",backKb());
    let txt=`🔑 *كلمات السر (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{ txt+=`${i+1}. 🏷 *${p.platform}*\n   🔐 \`${p.password}\`\n   🕐 ${p.savedAt}\n\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_passwords")]]));
  }

  // ═══ فحص VirusTotal ═══
  if(data==="menu_vt"){
    return edit(
      `🔍 *فحص الأمان (VirusTotal)*\n\nاختر نوع الفحص:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔗 فحص رابط/URL","vt_url")],
        [Markup.button.callback("🌐 فحص دومين","vt_domain"),
         Markup.button.callback("🖥 فحص IP","vt_ip")],
        [Markup.button.callback("📁 فحص ملف (أرسل الملف)","vt_file_info")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="vt_url")      { DB.state[uid]={mode:"vt_url"};    return edit("🔗 أرسل الرابط:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_domain")   { DB.state[uid]={mode:"vt_domain"}; return edit("🌐 أرسل الدومين (مثال: google.com):",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_ip")       { DB.state[uid]={mode:"vt_ip"};     return edit("🖥 أرسل عنوان IP:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_file_info"){ return edit("📁 *فحص الملفات:*\n\nأرسل أي ملف مباشرة (صور، تطبيقات، مستندات) وسيتم فحصه تلقائياً.",Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_vt")]])); }

  // ═══ UptimeRobot ═══
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors = await getMonitors();
    if(!monitors.length) return edit("🌐 *لا توجد مواقع مضافة.*",backKb());
    let txt=`🌐 *مواقعك المراقبة (${monitors.length}):*\n\n`;
    monitors.slice(0,10).forEach(m=>{
      const ic=m.status===2?"🟢":m.status===9?"🔴":"🟡";
      txt+=`${ic} *${m.friendly_name||m.url}*\n   📈 ${m.all_time_uptime_ratio||"—"}% | 🔗 ${m.url}\n\n`;
    });
    return edit(txt,backKb());
  }

  // ═══ الإحالة ═══
  if(data==="referral"){
    const me   = await bot.telegram.getMe();
    const link = `https://t.me/${me.username}?start=ref_${uid}`;
    const refs  = (DB.referrals[uid]||[]).length;
    const bonus = DB.referralPerks[uid]?.extra||0;
    return edit(
      `🎁 *نظام الإحالة*\n\n🔗 *رابطك:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}*\n🎁 مكافأة: *+${bonus} إيميل/يوم*\n\n📌 لكل صديق: تحصل على *${DB.settings.refBonus} إضافي*`,
      Markup.inlineKeyboard([
        [Markup.button.callback("👥 إحالاتي","my_referrals")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="my_referrals"){
    const refs = DB.referrals[uid]||[];
    if(!refs.length) return edit("👥 *لم تُحِل أحداً بعد.*",backKb());
    let txt=`👥 *إحالاتي (${refs.length}):*\n\n`;
    refs.slice(0,10).forEach((id,i)=>{ txt+=`${i+1}. ${DB.users[id]?.name||id} (\`${id}\`)\n`; });
    return edit(txt,backKb());
  }

  // ═══ إحصائياتي ═══
  if(data==="my_stats"){
    const u = DB.users[uid]||{};
    return edit(
      `📊 *إحصائياتي*\n\n👤 *${u.name}*\n🆔 \`${uid}\`\n📅 انضممت: ${u.joinedAt}\n\n` +
      `📧 إيميلات اليوم: *${dailyCount(uid)}/${maxDay(uid)}*\n` +
      `📚 الإجمالي: *${(DB.emailHistory[uid]||[]).length}*\n` +
      `💾 محفوظات: *${(DB.savedEmails[uid]||[]).length}*\n` +
      `🔑 كلمات سر: *${(DB.savedPasswords[uid]||[]).length}*\n` +
      `👥 إحالات: *${(DB.referrals[uid]||[]).length}*\n` +
      `🏅 الدور: *${u.role||"user"}*`,
      backKb()
    );
  }

  // ═══ سجلي ═══
  if(data==="my_history"){
    const h = DB.emailHistory[uid]||[];
    const a = DB.activityLog[uid]||[];
    let txt="📋 *سجلي*\n\n";
    if(h.length){
      txt+="*📧 آخر الإيميلات:*\n";
      h.slice(0,5).forEach((e,i)=>{
        const ic=e.type==="gmail"?"🔴":e.type==="outlook"?"🔵":"📧";
        txt+=`${i+1}. ${ic} \`${e.email}\` — ${e.time}\n`;
      });
      txt+="\n";
    }
    if(!h.length&&!a.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ═══ حسابي ═══
  if(data==="my_account"){
    const u = DB.users[uid]||{};
    return edit(
      `👤 *حسابي*\n\n📧 البريد: ${u.accountEmail?`\`${u.accountEmail}\``:"غير محدد"}\n🔐 كلمة السر: ${u.passwordHash?"✅ محددة":"❌ غير محددة"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📧 ربط بريد","acc_email")],
        [Markup.button.callback("🔐 تعيين كلمة سر","acc_pass")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }
  if(data==="acc_email"){ DB.state[uid]={mode:"acc_email"}; return edit("📧 أرسل بريدك:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }
  if(data==="acc_pass") { DB.state[uid]={mode:"acc_pass"};  return edit("🔐 أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }

  // ═══ مساعدة ═══
  if(data==="help"){
    return edit(
      `ℹ️ *دليل البوت*\n\n*📧 الإيميلات المؤقتة:*\n• إيميل مؤقت بنطاق تختاره\n• Gmail حقيقي يصل لأي موقع 🔴\n• Outlook حقيقي يصل لأي موقع 🔵\n• الرسائل والأكواد تصلك فوراً ⚡\n\n*🔑 مدير كلمات السر:*\nتوليد وحفظ كلمات سر قوية\n\n*🔍 فحص الأمان:*\nفحص روابط + دومينات + IP + ملفات\n\n*🎁 الإحالة:*\nشارك رابطك واحصل على إيميلات إضافية`,
      backKb()
    );
  }

  // ═══ لوحة المطور ═══
  if(data==="dev_panel")  { if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *الإعدادات:*",devSettingsKb()); }
  if(data==="ds_maint"){ if(!isDev(uid))return; DB.settings.maintenanceMode=!DB.settings.maintenanceMode; return edit("⚙️",devSettingsKb()); }

  for(const k of["ds_max","ds_cool","ds_watch","ds_ref"]){
    if(data===k){
      if(!isAdmin(uid))return;
      const lbl={ds_max:"الحد اليومي",ds_cool:"الانتظار (ث)",ds_watch:"مدة المراقبة (د)",ds_ref:"مكافأة الإحالة"};
      DB.state[uid]={mode:"dev_setting",key:k};
      return edit(`✏️ أرسل القيمة الجديدة لـ *${lbl[k]}*:`,Markup.inlineKeyboard([[Markup.button.callback("❌","dev_settings")]]));
    }
  }

  if(data==="dev_stats"){
    if(!isAdmin(uid))return;
    const total=Object.keys(DB.users).length;
    const banned=Object.values(DB.users).filter(u=>u.banned).length;
    const emails=Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0);
    const active=Object.keys(DB.activeEmails).length;
    return edit(
      `📊 *إحصائيات عامة*\n\n👥 الأعضاء: *${total}*\n🚫 المحظورون: *${banned}*\n⭐ المسؤولون: *${DB.admins.size}*\n📧 إجمالي إيميلات: *${emails}*\n📬 نشطون الآن: *${active}*\n📜 السجلات: *${DB.logs.length}*`,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])
    );
  }

  if(data==="dev_logs"){
    if(!isAdmin(uid))return;
    let txt=`📜 *آخر ${Math.min(DB.logs.length,15)} أحداث:*\n\n`;
    DB.logs.slice(0,15).forEach(l=>{ txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${(l.text||"").slice(0,40)}\n🕐 ${l.time}\n\n`; });
    return edit(txt||"لا سجلات.",Markup.inlineKeyboard([[Markup.button.callback("🗑 مسح","dev_clear_logs"),Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_clear_logs"){ if(!isDev(uid))return; DB.logs=[]; return edit("✅ مُسح.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])); }

  if(data==="dev_users"){
    if(!isAdmin(uid))return;
    const users=Object.entries(DB.users);
    let txt=`👥 *الأعضاء (${users.length}):*\n\n`;
    users.slice(0,10).forEach(([id,u])=>{
      const b=u.banned?"🚫":isAdmin(parseInt(id))?"⭐":"👤";
      txt+=`${b} *${u.name}* [\`${id}\`] | ${u.joinedAt}\n`;
    });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔍 بحث","dev_search_user")],[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_search_user"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"dev_search"}; return edit("🔍 أرسل ID أو اسم العضو:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]])); }

  if(data==="dev_announce"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"dev_announce"}; return edit("📣 أرسل نص الإعلان:",Markup.inlineKeyboard([[Markup.button.callback("🗑 مسح الإعلان","dev_clear_ann")],[Markup.button.callback("❌","dev_panel")]])); }
  if(data==="dev_clear_ann"){ if(!isAdmin(uid))return; DB.announcements=[]; return edit("✅ تم مسح الإعلان.",devKb()); }

  if(data==="dev_broadcast"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"broadcast"}; return edit("📢 أرسل الرسالة الجماعية:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]])); }

  // إجراءات على الأعضاء
  const acts=["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"];
  for(const act of acts){
    if(data===act){ if(!isAdmin(uid))return; return edit(`${act}\n*اختر العضو:*`,usersKb(act)); }
    if(data.startsWith(`${act}:`)){
      if(!isAdmin(uid))return;
      const tid=parseInt(data.split(":")[1]);
      if(!DB.users[tid]) DB.users[tid]={name:String(tid),username:"",joinedAt:stamp(),banned:false,muted:false,role:"user",lastSeen:"—",msgCount:0};
      let msg="";
      if(act==="dev_ban")    { DB.users[tid].banned=true;  msg=`🚫 حظر \`${tid}\``; log("ban",uid,String(tid)); }
      if(act==="dev_unban")  { DB.users[tid].banned=false; msg=`✅ رفع حظر \`${tid}\``; log("unban",uid,String(tid)); }
      if(act==="dev_mute")   { DB.users[tid].muted=true;   msg=`🔇 كتم \`${tid}\``; log("mute",uid,String(tid)); }
      if(act==="dev_unmute") { DB.users[tid].muted=false;  msg=`🔊 رفع كتم \`${tid}\``; }
      if(act==="dev_promote"){ if(!isDev(uid))return edit("❌ المطور فقط.",backKb()); DB.admins.add(tid); DB.users[tid].role="admin"; msg=`⭐ ترقية \`${tid}\``; log("promote",uid,String(tid)); try{await bot.telegram.sendMessage(tid,"⭐ تمت ترقيتك لمسؤول!");}catch{} }
      if(act==="dev_demote") { if(!isDev(uid))return edit("❌ المطور فقط.",backKb()); DB.admins.delete(tid); DB.users[tid].role="user"; msg=`⬇️ تخفيض \`${tid}\``; log("demote",uid,String(tid)); }
      try{ await bot.telegram.sendMessage(tid,`📢 إجراء على حسابك: ${msg.replace(/`/g,"")}`); }catch{}
      return edit(msg,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
    }
  }

  if(data.startsWith("upage:")){ const[,act,pg]=data.split(":"); return edit("*اختر العضو:*",usersKb(act,parseInt(pg))); }
});

// ===================== النصوص =====================
bot.on("text", async ctx=>{
  const uid  = ctx.from.id;
  const text = ctx.message.text.trim();
  const st   = DB.state[uid];
  if(!st) return;

  // captcha
  if(st.mode==="captcha"){
    if(parseInt(text)===DB.sessions[uid]?.captchaAns){
      DB.sessions[uid].verified=true;
      delete DB.state[uid];
      log("verified",uid,DB.users[uid]?.name);
      await ctx.reply("✅ *تم التحقق! أهلاً بك 🎉*",{parse_mode:"Markdown"});
      return showMain(ctx);
    } else {
      const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
      DB.sessions[uid].captchaAns=n1+n2;
      return ctx.reply(`❌ خطأ. حاول: *${n1} + ${n2} = ?*`,{parse_mode:"Markdown"});
    }
  }

  // فحص رابط
  if(st.mode==="vt_url"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري الفحص...*",{parse_mode:"Markdown"});
    const r = await vtScanUrl(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation}=r;
    const mal=stats.malicious||0, sus=stats.suspicious||0, clean=stats.harmless||0;
    const vd=mal>0?"🔴 *خطر*":sus>0?"🟡 *مشبوه*":"🟢 *آمن*";
    return ctx.reply(
      `🔍 *نتيجة فحص الرابط*\n\n${vd}\n\n🔗 \`${text.slice(0,60)}\`\n\n🔴 ضار: *${mal}* | 🟡 مشبوه: *${sus}* | 🟢 آمن: *${clean}*\n⭐ السمعة: *${reputation}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_domain"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الدومين...*",{parse_mode:"Markdown"});
    const domain = text.replace(/https?:\/\//,"").split("/")[0];
    const r = await vtScanDomain(domain);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation}=r;
    const mal=stats.malicious||0;
    return ctx.reply(
      `🌐 *فحص الدومين*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${domain}\`\n\n🔴 ضار: *${mal}* | 🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${reputation}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_ip"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الـ IP...*",{parse_mode:"Markdown"});
    const r = await vtScanIp(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,country}=r;
    const mal=stats.malicious||0;
    return ctx.reply(
      `🖥 *فحص IP*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${text}\`\n🌍 الدولة: *${country}*\n\n🔴 ضار: *${mal}* | 🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${reputation}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // حفظ الإيميل
  if(st.mode==="save_email_label"){
    const {email,type,ts}=st;
    delete DB.state[uid];
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    DB.savedEmails[uid].push({email,type,ts,label:text,savedAt:stamp()});
    log("email_saved",uid,`${email} | ${text}`);
    return ctx.reply(`✅ *تم حفظ الإيميل!*\n\n📧 \`${email}\`\n🏷 *${text}*`,
      {parse_mode:"Markdown",...emailActiveKb(email,type,ts)});
  }

  // حفظ كلمة سر
  if(st.mode==="store_pass_platform"){
    const pass=st.pass; delete DB.state[uid];
    if(!DB.savedPasswords[uid]) DB.savedPasswords[uid]=[];
    DB.savedPasswords[uid].push({platform:text,password:pass,savedAt:stamp()});
    log("pass_saved",uid,text);
    return ctx.reply(`✅ *تم!*\n\n🏷 *${text}*\n🔐 \`${pass}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="save_pass_custom"){
    DB.state[uid]={mode:"store_pass_platform",pass:text};
    return ctx.reply("✏️ اسم المنصة:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  // حساب
  if(st.mode==="acc_email"){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply("❌ بريد غير صحيح.");
    delete DB.state[uid]; DB.users[uid].accountEmail=text;
    return ctx.reply(`✅ *تم ربط:* \`${text}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="acc_pass"){
    if(text.length<6) return ctx.reply("❌ يجب 6 أحرف على الأقل.");
    delete DB.state[uid]; DB.users[uid].passwordHash=hashPass(text);
    return ctx.reply("✅ *تم تعيين كلمة السر!*",{parse_mode:"Markdown",...mainKb()});
  }

  // إعدادات المطور
  if(st.mode==="dev_setting"){
    if(!isAdmin(uid))return;
    const val=parseInt(text);
    if(isNaN(val)||val<1) return ctx.reply("❌ قيمة غير صحيحة.");
    if(st.key==="ds_max")  DB.settings.maxEmailsPerDay=val;
    if(st.key==="ds_cool") DB.settings.cooldown=val;
    if(st.key==="ds_watch")DB.settings.emailWatchMin=val;
    if(st.key==="ds_ref")  DB.settings.refBonus=val;
    delete DB.state[uid];
    return ctx.reply("✅ تم التحديث.",devSettingsKb());
  }

  if(st.mode==="dev_announce"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    DB.announcements.unshift(text);
    if(DB.announcements.length>3) DB.announcements.pop();
    return ctx.reply("✅ تم نشر الإعلان.",devKb());
  }

  if(st.mode==="dev_search"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    const q=text.toLowerCase();
    const found=Object.entries(DB.users).filter(([id,u])=>
      id===text||u.name?.toLowerCase().includes(q)||u.username?.toLowerCase().includes(q)
    );
    if(!found.length) return ctx.reply("❌ لم يُعثر.",devKb());
    let txt=`🔍 *نتائج (${found.length}):*\n\n`;
    found.slice(0,5).forEach(([id,u])=>{
      txt+=`👤 *${u.name}* [\`${id}\`]\n@${u.username||"—"} | ${u.joinedAt}\n🚫 ${u.banned?"محظور":"غير محظور"} | 🏅 ${u.role}\n\n`;
    });
    return ctx.reply(txt,{parse_mode:"Markdown",...devKb()});
  }

  if(st.mode==="broadcast"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    const ids=Object.keys(DB.users);
    await ctx.reply(`📢 جاري الإرسال لـ ${ids.length} عضو...`);
    let sent=0,fail=0;
    for(const id of ids){
      try{ await bot.telegram.sendMessage(parseInt(id),`📢 *رسالة من الإدارة:*\n\n${text}`,{parse_mode:"Markdown"}); sent++; await sleep(50); }
      catch{ fail++; }
    }
    log("broadcast",uid,`${sent} نجح | ${fail} فشل`);
    return ctx.reply(`✅ *${sent}* أُرسلت | *${fail}* فشل`,{parse_mode:"Markdown",...devKb()});
  }
});

// ===================== فحص الملفات =====================
bot.on(["document","photo","video","audio"], async ctx=>{
  const uid = ctx.from.id;
  if(!DB.sessions[uid]?.verified&&!isDev(uid)) return;

  const file =
    ctx.message.document ||
    (ctx.message.photo&&ctx.message.photo[ctx.message.photo.length-1]) ||
    ctx.message.video ||
    ctx.message.audio;

  if(!file) return;
  if((file.file_size||0)>10*1024*1024)
    return ctx.reply("❌ الملف أكبر من 10MB.");

  await ctx.reply("⏳ *جاري رفع الملف لفحصه...*",{parse_mode:"Markdown"});

  try {
    const link   = await bot.telegram.getFileLink(file.file_id);
    const res    = await axios.get(link.href,{responseType:"arraybuffer",timeout:30000});
    const fname  = file.file_name||`file_${Date.now()}`;
    const id     = await vtUploadFile(Buffer.from(res.data), fname);

    if(!id) return ctx.reply("❌ فشل رفع الملف.",mainKb());

    log("file_scan",uid,fname);
    await ctx.reply("⏳ *تم الرفع. انتظر النتيجة (15 ثانية)...*",{parse_mode:"Markdown"});
    await sleep(15000);

    const report = await vtGetAnalysis(id);
    if(!report) return ctx.reply("⌛ النتيجة لم تكتمل بعد. حاول لاحقاً.",mainKb());

    const stats = report.stats||{};
    const mal   = stats.malicious||0, sus=stats.suspicious||0, clean=stats.harmless||0;
    const vd    = mal>0?"🔴 *خطر — لا ترفع هذا الملف!*":sus>0?"🟡 *مشبوه*":"🟢 *آمن*";

    return ctx.reply(
      `🔍 *نتيجة فحص الملف*\n\n${vd}\n\n📄 \`${fname}\`\n\n🔴 ضار: *${mal}*\n🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  } catch(e){
    console.error("vtFile:",e.message);
    return ctx.reply("❌ حدث خطأ أثناء الفحص.",mainKb());
  }
});

// ===================== تشغيل =====================
console.log("🚀 البوت يعمل...");
bot.launch();
process.once("SIGINT",  ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
