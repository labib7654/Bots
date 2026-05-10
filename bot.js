"use strict";

// ============================================================
//  بوت تيليجرام شامل — نسخة متطورة
//  1secmail + VirusTotal + UptimeRobot
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");

// ===================== الإعدادات =====================
const BOT_TOKEN = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const VT_KEY    = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY    = "u3469811-ab163c31f24d6012491f0807";
const DEV_ID    = 7411444902;
const PORT      = process.env.PORT || 8080;
const BOT_VER   = "2.0.0";

// نطاقات 1secmail
const MAIL_DOMAINS = [
  "1secmail.com","1secmail.org","1secmail.net",
  "wwjmp.com","esiix.com","xojxe.com","yoggm.com"
];

// ===================== Keep-Alive =====================
http.createServer((_,res)=>{ res.writeHead(200); res.end("Bot Running v"+BOT_VER); })
  .listen(PORT,"0.0.0.0",()=>console.log(`✅ Port ${PORT} | Bot v${BOT_VER}`));

// ===================== قاعدة البيانات =====================
const DB = {
  users:          {}, // id -> { name, username, joinedAt, banned, muted, role, passwordHash, accountEmail, lastSeen, msgCount }
  sessions:       {}, // id -> { verified, captchaAns }
  activeEmails:   {}, // id -> { login, domain, createdAt, watcherActive }
  savedEmails:    {}, // id -> [{ login, domain, label, savedAt }]
  savedPasswords: {}, // id -> [{ platform, password, savedAt }]
  emailHistory:   {}, // id -> [{ address, time, msgCount }]
  activityLog:    {}, // id -> [{ action, time, detail }]
  referrals:      {}, // refId -> [userId]
  referralOf:     {}, // userId -> refId
  referralPerks:  {}, // userId -> { extra, level }
  logs:           [],
  admins:         new Set([DEV_ID]),
  announcements:  [],
  settings: {
    maxEmailsPerDay: 20,
    emailWatchMin:   15,
    cooldown:        10,
    refBonus:        5,
    maintenanceMode: false,
    welcomeMsg:      "مرحباً بك في البوت! 🎉",
  },
  lastReq:        {},
  daily:          {},
  vtCache:        {}, // url -> { result, ts }
  uptimeCache:    { data:[], ts:0 },
  state:          {},
};

// ===================== مساعدات =====================
const now    = () => Math.floor(Date.now()/1000);
const today  = () => new Date().toISOString().slice(0,10);
const stamp  = () => new Date().toLocaleString("ar-SA", { timeZone:"Asia/Riyadh" });
const sleep  = ms => new Promise(r=>setTimeout(r,ms));
const escape = t => (t||"").replace(/[_*[\]()~`>#+=|{}.!-]/g,"\\$&");

function addLog(type, uid, text) {
  DB.logs.unshift({ type, uid, text, time: stamp() });
  if (DB.logs.length > 1000) DB.logs.pop();
  if (!DB.activityLog[uid]) DB.activityLog[uid] = [];
  DB.activityLog[uid].unshift({ action: type, detail: text, time: stamp() });
  if (DB.activityLog[uid].length > 50) DB.activityLog[uid].pop();
}

function ensureUser(ctx) {
  const u = ctx.from;
  if (!DB.users[u.id]) {
    DB.users[u.id] = {
      name: u.first_name||"مجهول",
      username: u.username||"",
      joinedAt: stamp(),
      banned: false,
      muted: false,
      role: "user",
      passwordHash: null,
      accountEmail: null,
      lastSeen: stamp(),
      msgCount: 0,
      emailsToday: 0,
      vtScans: 0,
    };
    addLog("join", u.id, u.first_name||"مجهول");
  }
  DB.users[u.id].name     = u.first_name || DB.users[u.id].name;
  DB.users[u.id].username = u.username   || DB.users[u.id].username;
  DB.users[u.id].lastSeen = stamp();
  DB.users[u.id].msgCount = (DB.users[u.id].msgCount||0)+1;
}

const isDev   = id => id === DEV_ID;
const isAdmin = id => DB.admins.has(id) || isDev(id);
const isBanned= id => DB.users[id]?.banned;
const isMuted = id => DB.users[id]?.muted;

function dailyEmailCount(id) { return DB.daily[`email_${id}_${today()}`]||0; }
function incDailyEmail(id)   { const k=`email_${id}_${today()}`; DB.daily[k]=(DB.daily[k]||0)+1; }
function maxEmailsDay(id)    { return DB.settings.maxEmailsPerDay+(DB.referralPerks[id]?.extra||0); }

function hashPass(p) { return crypto.createHash("sha256").update(p+"SALT_BOT_V2").digest("hex"); }
function randStr(len=10) {
  return crypto.randomBytes(len).toString("base64").replace(/[^a-z0-9]/gi,"").slice(0,len).toLowerCase();
}
function genStrongPass() {
  const up="ABCDEFGHJKLMNPQRSTUVWXYZ", lo="abcdefghjkmnpqrstuvwxyz",
        nu="23456789", sp="@#$!_-";
  let p="";
  for(let i=0;i<5;i++) p += up[Math.floor(Math.random()*up.length)];
  for(let i=0;i<5;i++) p += lo[Math.floor(Math.random()*lo.length)];
  for(let i=0;i<3;i++) p += nu[Math.floor(Math.random()*nu.length)];
  for(let i=0;i<2;i++) p += sp[Math.floor(Math.random()*sp.length)];
  return p.split("").sort(()=>Math.random()-0.5).join("");
}
function genUsername() {
  const adj=["swift","smart","cool","bright","fast"];
  const nn=adj[Math.floor(Math.random()*adj.length)];
  return `${nn}_${randStr(5)}`;
}

// ===================== 1secmail API =====================
async function mailGen(customLogin=null) {
  const doms = await mailDomains();
  const login  = customLogin || randStr(12);
  const domain = doms[Math.floor(Math.random()*doms.length)];
  return { login, domain, address:`${login}@${domain}` };
}
async function mailInbox(login, domain) {
  try {
    const r = await axios.get("https://www.1secmail.com/api/v1/",{
      params:{action:"getMessages",login,domain}, timeout:10000
    });
    return Array.isArray(r.data)?r.data:[];
  } catch{ return []; }
}
async function mailRead(login, domain, id) {
  try {
    const r = await axios.get("https://www.1secmail.com/api/v1/",{
      params:{action:"readMessage",login,domain,id}, timeout:10000
    });
    return r.data||null;
  } catch{ return null; }
}
async function mailDomains() {
  try {
    const r = await axios.get("https://www.1secmail.com/api/v1/",{params:{action:"getDomainList"},timeout:6000});
    return Array.isArray(r.data)&&r.data.length?r.data:MAIL_DOMAINS;
  } catch{ return MAIL_DOMAINS; }
}

// ===================== VirusTotal =====================
async function vtScanUrl(url) {
  const cached = DB.vtCache[url];
  if (cached && now()-cached.ts < 3600) return cached.result;
  try {
    const enc = Buffer.from(url).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r = await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,{
      headers:{"x-apikey":VT_KEY}, timeout:12000
    });
    const attr  = r.data?.data?.attributes||{};
    const stats = attr.last_analysis_stats||{};
    const result = {
      stats,
      categories: attr.categories||{},
      reputation: attr.reputation||0,
      lastScan: attr.last_analysis_date||null,
      title: attr.title||"",
      finalUrl: attr.last_final_url||url,
    };
    DB.vtCache[url] = { result, ts:now() };
    return result;
  } catch(e){ return null; }
}

async function vtScanFile(fileBuffer, fileName) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", fileBuffer, fileName);
    const r = await axios.post("https://www.virustotal.com/api/v3/files", form, {
      headers:{ ...form.getHeaders(), "x-apikey":VT_KEY }, timeout:30000
    });
    return r.data?.data?.id||null;
  } catch{ return null; }
}

async function vtGetFileReport(analysisId) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/analyses/${analysisId}`,{
      headers:{"x-apikey":VT_KEY}, timeout:12000
    });
    return r.data?.data?.attributes||null;
  } catch{ return null; }
}

async function vtGetIpReport(ip) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,{
      headers:{"x-apikey":VT_KEY}, timeout:12000
    });
    return r.data?.data?.attributes||null;
  } catch{ return null; }
}

async function vtGetDomainReport(domain) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/domains/${domain}`,{
      headers:{"x-apikey":VT_KEY}, timeout:12000
    });
    return r.data?.data?.attributes||null;
  } catch{ return null; }
}

// ===================== UptimeRobot =====================
async function getMonitors() {
  if (now()-DB.uptimeCache.ts < 120 && DB.uptimeCache.data.length) return DB.uptimeCache.data;
  try {
    const r = await axios.post("https://api.uptimerobot.com/v2/getMonitors",
      `api_key=${UR_KEY}&format=json&response_times=1&all_time_uptime_ratio=1&logs=1`,
      { headers:{"Content-Type":"application/x-www-form-urlencoded"}, timeout:10000 }
    );
    const monitors = r.data?.monitors||[];
    DB.uptimeCache = { data:monitors, ts:now() };
    return monitors;
  } catch{ return []; }
}

async function addMonitor(url, friendlyName) {
  try {
    const r = await axios.post("https://api.uptimerobot.com/v2/newMonitor",
      `api_key=${UR_KEY}&format=json&type=1&url=${encodeURIComponent(url)}&friendly_name=${encodeURIComponent(friendlyName||url)}`,
      { headers:{"Content-Type":"application/x-www-form-urlencoded"}, timeout:10000 }
    );
    return r.data;
  } catch{ return null; }
}

// ===================== مراقب إيميل تلقائي =====================
async function emailWatcher(bot, uid, login, domain, chatId, maxMin=15) {
  if (DB.activeEmails[uid]) DB.activeEmails[uid].watcherActive = true;
  const end = now()+maxMin*60;
  let lastIds = new Set();
  let msgCount = 0;
  while(now()<end){
    await sleep(6000);
    if(!DB.activeEmails[uid]||DB.activeEmails[uid].login!==login) return;
    const msgs = await mailInbox(login,domain);
    for(const m of msgs){
      if(!lastIds.has(m.id)){
        lastIds.add(m.id);
        msgCount++;
        const full = await mailRead(login,domain,m.id);
        const body = (full?.textBody||full?.htmlBody||"").slice(0,800).replace(/<[^>]+>/g,"");
        addLog("email_received",uid,`${login}@${domain} | ${m.subject}`);
        if(DB.emailHistory[uid]){
          const idx = DB.emailHistory[uid].findIndex(e=>e.address===`${login}@${domain}`);
          if(idx>=0) DB.emailHistory[uid][idx].msgCount=(DB.emailHistory[uid][idx].msgCount||0)+1;
        }
        try {
          await bot.telegram.sendMessage(chatId,
            `📧 *رسالة جديدة وصلت!*\n\n📬 *من:* \`${m.from}\`\n📋 *الموضوع:* ${m.subject}\n🕐 *التاريخ:* ${m.date||stamp()}\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
            {parse_mode:"Markdown",...emailActiveKb(login,domain)}
          );
        } catch{}
      }
    }
  }
  if(DB.activeEmails[uid]?.login===login) DB.activeEmails[uid].watcherActive=false;
}

// ===================== لوحات المفاتيح =====================
const mainKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("📧 إيميلات مؤقتة","menu_emails"),
   Markup.button.callback("🔑 مدير كلمات السر","menu_passwords")],
  [Markup.button.callback("🔍 فحص رابط","menu_vt"),
   Markup.button.callback("🌐 مراقبة المواقع","menu_uptime")],
  [Markup.button.callback("📊 إحصائياتي","my_stats"),
   Markup.button.callback("🎁 الإحالة","referral")],
  [Markup.button.callback("📋 سجلي","my_history"),
   Markup.button.callback("👤 حسابي","my_account")],
  [Markup.button.callback("ℹ️ مساعدة","help")],
]);

const backKb = () => Markup.inlineKeyboard([[Markup.button.callback("🔙 الرئيسية","back")]]);

const emailActiveKb = (login,domain) => Markup.inlineKeyboard([
  [Markup.button.callback("📨 فتح الصندوق",`inbox:${login}:${domain}`),
   Markup.button.callback("🔄 تحديث",`inbox:${login}:${domain}`)],
  [Markup.button.callback("💾 حفظ الإيميل",`save_email:${login}:${domain}`),
   Markup.button.callback("🗑 حذف",`del_email:${login}:${domain}`)],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

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
  [Markup.button.callback("🌐 مراقبة المواقع","dev_monitors"),
   Markup.button.callback("🗑 مسح السجل","dev_clear_logs")],
  [Markup.button.callback("👤 بحث عضو","dev_search_user"),
   Markup.button.callback("📤 تصدير البيانات","dev_export")],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

const devSettingsKb = () => Markup.inlineKeyboard([
  [Markup.button.callback(`📏 إيميلات/يوم: ${DB.settings.maxEmailsPerDay}`,"ds_max_email"),
   Markup.button.callback(`⏳ انتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`⏱ مدة المراقبة: ${DB.settings.emailWatchMin}د`,"ds_watch"),
   Markup.button.callback(`🎁 مكافأة إحالة: ${DB.settings.refBonus}`,"ds_ref")],
  [Markup.button.callback(`🔧 صيانة: ${DB.settings.maintenanceMode?"✅ مفعّل":"❌ معطّل"}`,"ds_maintenance"),
   Markup.button.callback("✏️ رسالة الترحيب","ds_welcome")],
  [Markup.button.callback("🔙 لوحة التحكم","dev_panel")],
]);

function usersKb(action, page=0) {
  const ids = Object.keys(DB.users);
  const perPage = 6;
  const slice = ids.slice(page*perPage,(page+1)*perPage);
  const rows = slice.map(id => {
    const u = DB.users[id];
    const badge = u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
    const sub = `${badge} ${u.name.slice(0,15)} [${id}]`;
    return [Markup.button.callback(sub, `${action}:${id}`)];
  });
  const nav = [];
  if(page>0) nav.push(Markup.button.callback("◀️",`upage:${action}:${page-1}`));
  nav.push(Markup.button.callback(`${page+1}/${Math.ceil(ids.length/perPage)}`,`noop`));
  if((page+1)*perPage<ids.length) nav.push(Markup.button.callback("▶️",`upage:${action}:${page+1}`));
  if(nav.length>1) rows.push(nav);
  rows.push([Markup.button.callback("🔙 لوحة التحكم","dev_panel")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== البوت =====================
const bot = new Telegraf(BOT_TOKEN);

// middleware
bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid = ctx.from.id;
  if(isBanned(uid)&&!isDev(uid)){
    try{ await ctx.reply("🚫 أنت محظور من استخدام البوت."); }catch{}
    return;
  }
  if(DB.settings.maintenanceMode&&!isAdmin(uid)){
    try{ await ctx.reply("🔧 البوت في وضع الصيانة حالياً. حاول لاحقاً."); }catch{}
    return;
  }
  return next();
});

// /start
bot.start(async ctx => {
  const uid = ctx.from.id;
  delete DB.state[uid];
  const payload = ctx.startPayload;

  // معالجة الإحالة
  if(payload?.startsWith("ref_")){
    const rid = parseInt(payload.slice(4));
    if(rid!==uid&&!DB.referralOf[uid]){
      DB.referralOf[uid] = rid;
      if(!DB.referrals[rid]) DB.referrals[rid]=[];
      DB.referrals[rid].push(uid);
      if(!DB.referralPerks[rid]) DB.referralPerks[rid]={extra:0,level:1};
      DB.referralPerks[rid].extra += DB.settings.refBonus;
      const refCount = DB.referrals[rid].length;
      if(refCount>=10&&DB.referralPerks[rid].level<2){
        DB.referralPerks[rid].level=2;
        try{ await bot.telegram.sendMessage(rid,"🏆 وصلت لـ 10 إحالات! تمت ترقيتك لمستوى 2 🎖"); }catch{}
      }
      addLog("referral",rid,`أحال ${uid}`);
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق عبر رابطك!\nحصلت على ${DB.settings.refBonus} إيميلات إضافية يومياً 🎁`); }catch{}
    }
  }

  addLog("start", uid, DB.users[uid]?.name);

  if(isDev(uid)){
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n\n🤖 البوت v${BOT_VER} يعمل بكفاءة\n👥 الأعضاء: *${Object.keys(DB.users).length}*\n📜 السجلات: *${DB.logs.length}*`,
      {parse_mode:"Markdown",...devKb()}
    );
  }

  // تحقق captcha
  if(!DB.sessions[uid]?.verified){
    const ops = ["+","-","×"];
    const op  = ops[Math.floor(Math.random()*2)];
    const n1  = Math.floor(Math.random()*9)+1;
    const n2  = Math.floor(Math.random()*9)+1;
    const ans = op==="+"?n1+n2:op==="-"?n1-n2:n1*n2;
    DB.sessions[uid] = { verified:false, captchaAns:ans };
    DB.state[uid] = { mode:"captcha" };
    return ctx.reply(
      `👋 *أهلاً ${ctx.from.first_name}!*\n\n🤖 للتحقق أنك لست روبوت:\n\n🔢 كم يساوي: *${n1} ${op} ${n2} = ?*`,
      {parse_mode:"Markdown"}
    );
  }

  showMain(ctx);
});

async function showMain(ctx) {
  const uid = ctx.from.id;
  const ann = DB.announcements[0];
  let txt = `🏠 *القائمة الرئيسية*\n\nأهلاً *${ctx.from.first_name}* 👋`;
  if(ann) txt += `\n\n📣 *${ann}*`;
  txt += "\n\nاختر الخدمة:";
  await ctx.reply(txt, {parse_mode:"Markdown",...mainKb()});
}

// /dev و /panel
bot.command("dev",   async ctx=>{ if(!isDev(ctx.from.id))return; await ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; await ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("stats", async ctx=>{ handleStats(ctx); });
bot.command("help",  async ctx=>{ handleHelp(ctx); });

// ===================== معالج الأزرار =====================
bot.on("callback_query", async ctx => {
  await ctx.answerCbQuery().catch(()=>{});
  const data = ctx.callbackQuery.data;
  const uid  = ctx.from.id;
  const edit = (text,extra={}) =>
    ctx.editMessageText(text,{parse_mode:"Markdown",...extra})
      .catch(()=>ctx.reply(text,{parse_mode:"Markdown",...extra}));

  if(data==="noop") return;

  // ─── رئيسية ───
  if(data==="back"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }

  // ─── إيميلات ───
  if(data==="menu_emails"){
    const saved  = DB.savedEmails[uid]||[];
    const active = DB.activeEmails[uid];
    const used   = dailyEmailCount(uid);
    const max    = maxEmailsDay(uid);
    const rows   = [];
    if(active) rows.push([Markup.button.callback(`📬 إيميلك النشط: ${active.login}@${active.domain}`,`inbox:${active.login}:${active.domain}`)]);
    rows.push([Markup.button.callback("✨ إنشاء إيميل جديد","new_email"),
               Markup.button.callback("🎲 إيميل بنطاق عشوائي","new_email_random")]);
    rows.push([Markup.button.callback("🌐 عرض النطاقات المتاحة","email_domains")]);
    if(saved.length) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved.length})`, "my_emails")]);
    rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(
      `📧 *نظام الإيميلات المؤقتة*\n\n✅ الاستخدام اليوم: *${used}/${max}*\n🔔 تصلك الرسائل تلقائياً\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      Markup.inlineKeyboard(rows)
    );
  }

  if(data==="new_email"||data==="new_email_random"){
    const diff = now()-(DB.lastReq[`email_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyEmailCount(uid)>=maxEmailsDay(uid)&&!isAdmin(uid))
      return edit(`🚫 وصلت للحد اليومي (${maxEmailsDay(uid)}).\nأحِل أصدقاء للحصول على المزيد 🎁`,backKb());
    await edit("⚡ *جاري إنشاء الإيميل...*");
    const {login,domain,address} = await mailGen();
    DB.activeEmails[uid] = { login, domain, createdAt:now(), watcherActive:true };
    DB.lastReq[`email_${uid}`] = now();
    incDailyEmail(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({address,time:stamp(),msgCount:0});
    DB.emailHistory[uid] = DB.emailHistory[uid].slice(0,20);
    addLog("email_created",uid,address);
    await edit(
      `✅ *تم إنشاء إيميلك!*\n\n📧 *العنوان:*\n\`${address}\`\n\n👤 *المستخدم:* \`${login}\`\n🌐 *النطاق:* \`@${domain}\`\n\n⚡ ستصلك الرسائل تلقائياً 🔔\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      emailActiveKb(login,domain)
    );
    emailWatcher(bot,uid,login,domain,ctx.chat.id, DB.settings.emailWatchMin);
    return;
  }

  if(data==="email_domains"){
    await edit("⏳ *جاري جلب النطاقات...*");
    const doms = await mailDomains();
    const list = doms.map((d,i)=>`${i+1}. \`@${d}\``).join("\n");
    return edit(`🌐 *النطاقات المتاحة (${doms.length}):*\n\n${list}`,
      Markup.inlineKeyboard([[Markup.button.callback("✨ إنشاء إيميل","new_email")],[Markup.button.callback("🔙 رجوع","menu_emails")]])
    );
  }

  if(data.startsWith("inbox:")){
    const [,login,domain] = data.split(":");
    await edit("📨 *جاري فتح الصندوق...*");
    const msgs = await mailInbox(login,domain);
    if(!msgs.length) return edit(
      `📭 *الصندوق فارغ*\n\n\`${login}@${domain}\`\n\nانتظر وصول رسائل... البوت يراقب تلقائياً ⚡`,
      emailActiveKb(login,domain)
    );
    const rows = msgs.slice(0,10).map(m=>[
      Markup.button.callback(`📩 ${(m.subject||"(بدون موضوع)").slice(0,28)}`,`msg:${login}:${domain}:${m.id}`)
    ]);
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${login}:${domain}`)]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📬 *الصندوق (${msgs.length} رسالة):*\n\`${login}@${domain}\``,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("msg:")){
    const [,login,domain,id] = data.split(":");
    await edit("📖 *جاري القراءة...*");
    const msg = await mailRead(login,domain,parseInt(id));
    if(!msg) return edit("❌ تعذر قراءة الرسالة.",backKb());
    const body = (msg.textBody||msg.htmlBody||"(فارغ)").slice(0,1000).replace(/<[^>]+>/g,"");
    return edit(
      `📩 *رسالة*\n\n👤 *من:* \`${msg.from}\`\n📋 *الموضوع:* ${msg.subject||"—"}\n🕐 *التاريخ:* ${msg.date||stamp()}\n\n📝 *المحتوى:*\n\`\`\`\n${body}\n\`\`\``,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 الصندوق",`inbox:${login}:${domain}`)],
        [Markup.button.callback("💾 حفظ الإيميل",`save_email:${login}:${domain}`)],
      ])
    );
  }

  if(data.startsWith("save_email:")){
    const [,login,domain] = data.split(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    const exists = DB.savedEmails[uid].find(e=>e.login===login&&e.domain===domain);
    if(exists) return edit("✅ الإيميل محفوظ مسبقاً.",emailActiveKb(login,domain));
    DB.state[uid] = {mode:"save_email_label",login,domain};
    return edit("✏️ أرسل تسمية لهذا الإيميل:\nمثال: حساب نتفليكس",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_emails")]])
    );
  }

  if(data==="my_emails"){
    const saved = DB.savedEmails[uid]||[];
    if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows = saved.map((e,i)=>[
      Markup.button.callback(`📧 ${e.label} — ${e.login}@${e.domain}`,`open_saved:${i}`)
    ]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📂 *إيميلاتي المحفوظة (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("open_saved:")){
    const idx = parseInt(data.split(":")[1]);
    const e = DB.savedEmails[uid]?.[idx];
    if(!e) return edit("❌ لم يُعثر على الإيميل.",backKb());
    return edit(
      `📧 *الإيميل المحفوظ*\n\n📬 \`${e.login}@${e.domain}\`\n🏷 *الاسم:* ${e.label}\n🕐 *حُفظ:* ${e.savedAt}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📨 فتح الصندوق",`inbox:${e.login}:${e.domain}`)],
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
    const [,login,domain] = data.split(":");
    if(DB.activeEmails[uid]?.login===login) delete DB.activeEmails[uid];
    DB.savedEmails[uid]=(DB.savedEmails[uid]||[]).filter(e=>!(e.login===login&&e.domain===domain));
    addLog("email_deleted",uid,`${login}@${domain}`);
    return edit("🗑 *تم حذف الإيميل.*",backKb());
  }

  if(data==="email_history"){
    const h = DB.emailHistory[uid]||[];
    if(!h.length) return edit("📊 *لا يوجد سجل إيميلات.*",backKb());
    let txt = `📊 *سجل إيميلاتي (${h.length}):*\n\n`;
    h.slice(0,10).forEach((e,i)=>{
      txt += `${i+1}. \`${e.address}\`\n   📩 رسائل: *${e.msgCount||0}* | 🕐 ${e.time}\n\n`;
    });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_emails")]]));
  }

  // ─── كلمات السر ───
  if(data==="menu_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    return edit(
      `🔑 *مدير كلمات السر*\n\n✅ محفوظة: *${saved.length}*\n🔒 محمية ومشفرة`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔐 توليد كلمة سر قوية","gen_pass")],
        [Markup.button.callback("💾 كلمات السر المحفوظة","my_passwords")],
        [Markup.button.callback("➕ حفظ كلمة سر يدوياً","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="gen_pass"){
    const p = genStrongPass();
    return edit(
      `🔐 *كلمة السر القوية:*\n\n\`${p}\`\n\n📊 الطول: ${p.length} حرف\n✅ تحتوي على: أحرف كبيرة وصغيرة + أرقام + رموز`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💾 حفظها في المدير",`store_pass:${p}`)],
        [Markup.button.callback("🔄 توليد أخرى","gen_pass")],
        [Markup.button.callback("🔙 رجوع","menu_passwords")],
      ])
    );
  }

  if(data.startsWith("store_pass:")){
    const pass = data.slice(11);
    DB.state[uid] = {mode:"store_pass_platform",pass};
    return edit("✏️ أرسل اسم المنصة/الموقع:\nمثال: Netflix أو تويتر",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]])
    );
  }

  if(data==="save_pass_prompt"){
    DB.state[uid] = {mode:"save_pass_custom"};
    return edit("✏️ أرسل كلمة السر:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]])
    );
  }

  if(data==="my_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر محفوظة.*",backKb());
    let txt = `🔑 *كلمات السر (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{
      txt += `${i+1}. 🏷 *${p.platform}*\n   🔐 \`${p.password}\`\n   🕐 ${p.savedAt}\n\n`;
    });
    return edit(txt,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 رجوع","menu_passwords")]
      ])
    );
  }

  // ─── فحص VirusTotal ───
  if(data==="menu_vt"){
    return edit(
      `🔍 *فحص الأمان بـ VirusTotal*\n\nاختر نوع الفحص:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔗 فحص رابط/URL","vt_url")],
        [Markup.button.callback("🌐 فحص دومين","vt_domain")],
        [Markup.button.callback("🖥 فحص IP","vt_ip")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="vt_url"){ DB.state[uid]={mode:"vt_scan_url"}; return edit("🔗 أرسل الرابط للفحص:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_vt")]])); }
  if(data==="vt_domain"){ DB.state[uid]={mode:"vt_scan_domain"}; return edit("🌐 أرسل اسم الدومين:\nمثال: example.com",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_vt")]])); }
  if(data==="vt_ip"){ DB.state[uid]={mode:"vt_scan_ip"}; return edit("🖥 أرسل عنوان IP:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_vt")]])); }

  // ─── UptimeRobot ───
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors = await getMonitors();
    if(!monitors.length) return edit(
      "🌐 *مراقبة المواقع*\n\nلا توجد مواقع مضافة بعد.",
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ إضافة موقع","uptime_add")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
    const rows = monitors.slice(0,8).map(m=>{
      const icon = m.status===2?"🟢":m.status===9?"🔴":"🟡";
      return [Markup.button.callback(`${icon} ${(m.friendly_name||m.url).slice(0,30)}`,`uptime_detail:${m.id}`)];
    });
    rows.push([Markup.button.callback("➕ إضافة موقع","uptime_add"),
               Markup.button.callback("🔄 تحديث","menu_uptime")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(`🌐 *مراقبة المواقع (${monitors.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("uptime_detail:")){
    const id = parseInt(data.split(":")[1]);
    const monitors = await getMonitors();
    const m = monitors.find(x=>x.id===id);
    if(!m) return edit("❌ الموقع غير موجود.",backKb());
    const icon = m.status===2?"🟢 يعمل":m.status===9?"🔴 متوقف":"🟡 غير معروف";
    return edit(
      `🌐 *${m.friendly_name||m.url}*\n\n${icon}\n🔗 \`${m.url}\`\n📈 الاتاحة: *${m.all_time_uptime_ratio||"—"}%*\n🕐 آخر تحقق: ${m.last_check_date||"—"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 المواقع","menu_uptime")]
      ])
    );
  }

  if(data==="uptime_add"){
    if(!isAdmin(uid)) return edit("❌ هذه الميزة للمسؤولين فقط.",backKb());
    DB.state[uid]={mode:"uptime_add_url"};
    return edit("➕ أرسل رابط الموقع لإضافته:\nمثال: https://example.com",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_uptime")]])
    );
  }

  // ─── الإحالة ───
  if(data==="referral"){
    const me = await bot.telegram.getMe();
    const link = `https://t.me/${me.username}?start=ref_${uid}`;
    const refs  = (DB.referrals[uid]||[]).length;
    const bonus = DB.referralPerks[uid]?.extra||0;
    const level = DB.referralPerks[uid]?.level||1;
    return edit(
      `🎁 *نظام الإحالة*\n\n🔗 *رابطك الخاص:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}*\n🎖 مستواك: *${level}*\n🎁 مكافأة: *+${bonus} إيميل/يوم*\n\n📌 لكل صديق ينضم عبر رابطك:\n• تحصل على *${DB.settings.refBonus} إيميلات إضافية يومياً*\n• عند 10 إحالات: ترقية لمستوى 2 🏆`,
      Markup.inlineKeyboard([
        [Markup.button.callback("👥 قائمة إحالاتي","my_referrals")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="my_referrals"){
    const refs = DB.referrals[uid]||[];
    if(!refs.length) return edit("👥 *لم تُحِل أحداً بعد.*",backKb());
    let txt = `👥 *إحالاتي (${refs.length}):*\n\n`;
    refs.slice(0,10).forEach((id,i)=>{
      const u = DB.users[id];
      txt += `${i+1}. ${u?.name||id} (${id})\n`;
    });
    return edit(txt,backKb());
  }

  // ─── إحصائياتي ───
  if(data==="my_stats"){ return handleStats(ctx,edit); }

  async function handleStats(ctx,editFn){
    const fn = editFn||(t=>ctx.reply(t,{parse_mode:"Markdown",...backKb()}));
    const uid2 = ctx.from.id;
    const u = DB.users[uid2]||{};
    const refs = (DB.referrals[uid2]||[]).length;
    const bonus = DB.referralPerks[uid2]?.extra||0;
    const emailCount = (DB.emailHistory[uid2]||[]).length;
    const savedEmails = (DB.savedEmails[uid2]||[]).length;
    const savedPasses = (DB.savedPasswords[uid2]||[]).length;
    return fn(
      `📊 *إحصائياتي*\n\n👤 *الاسم:* ${u.name}\n🆔 *المعرف:* \`${uid2}\`\n🕐 *انضممت:* ${u.joinedAt}\n👁 *آخر ظهور:* ${u.lastSeen}\n\n` +
      `📧 إيميلات أنشأتها: *${emailCount}*\n💾 إيميلات محفوظة: *${savedEmails}*\n🔑 كلمات سر محفوظة: *${savedPasses}*\n📅 إيميلات اليوم: *${dailyEmailCount(uid2)}/${maxEmailsDay(uid2)}*\n\n` +
      `👥 إحالاتي: *${refs}*\n🎁 مكافأة: *+${bonus}/يوم*\n🏅 الدور: *${u.role||"user"}*`,
      backKb()
    );
  }

  // ─── سجلي ───
  if(data==="my_history"){
    const h = DB.emailHistory[uid]||[];
    const a = DB.activityLog[uid]||[];
    let txt = `📋 *سجلي*\n\n`;
    if(h.length){
      txt += `*📧 آخر الإيميلات (${Math.min(h.length,5)}):*\n`;
      h.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. \`${e.address}\` — ${e.time}\n`; });
      txt += "\n";
    }
    if(a.length){
      txt += `*📜 آخر الأنشطة (${Math.min(a.length,5)}):*\n`;
      a.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. ${e.action} — ${e.time}\n`; });
    }
    if(!h.length&&!a.length) txt += "لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ─── حسابي ───
  if(data==="my_account"){
    const u = DB.users[uid]||{};
    const hasAcc = !!u.accountEmail;
    return edit(
      `👤 *حسابي*\n\n${hasAcc?`📧 البريد المرتبط: \`${u.accountEmail}\``:"⚠️ لم تربط بريداً بعد"}\n🔐 كلمة السر: ${u.passwordHash?"✅ محددة":"❌ غير محددة"}`,
      Markup.inlineKeyboard([
        hasAcc?
          [Markup.button.callback("🔄 تغيير البريد","acc_change_email")]:
          [Markup.button.callback("📧 ربط بريد إلكتروني","acc_set_email")],
        [Markup.button.callback(u.passwordHash?"🔄 تغيير كلمة السر":"🔐 تعيين كلمة السر","acc_set_pass")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="acc_set_email"||data==="acc_change_email"){
    DB.state[uid]={mode:"set_account_email"};
    return edit("📧 أرسل بريدك الإلكتروني لربطه بحسابك (لاسترجاع البيانات):",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","my_account")]])
    );
  }

  if(data==="acc_set_pass"){
    DB.state[uid]={mode:"set_account_pass"};
    return edit("🔐 أرسل كلمة السر الجديدة لحسابك:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","my_account")]])
    );
  }

  // ─── مساعدة ───
  if(data==="help"){ return handleHelp(ctx,edit); }

  async function handleHelp(ctx,editFn){
    const fn = editFn||(t=>ctx.reply(t,{parse_mode:"Markdown",...backKb()}));
    return fn(
      `ℹ️ *دليل البوت v${BOT_VER}*\n\n` +
      `*📧 الإيميلات المؤقتة:*\nإيميلات فورية من 1secmail تستقبل الرسائل تلقائياً\n\n` +
      `*🔑 مدير كلمات السر:*\nتوليد كلمات سر قوية وحفظها مع اسم المنصة\n\n` +
      `*🔍 فحص الأمان (VirusTotal):*\nفحص روابط ودومينات وعناوين IP\n\n` +
      `*🌐 مراقبة المواقع (UptimeRobot):*\nعرض حالة مواقعك المراقبة\n\n` +
      `*🎁 الإحالة:*\nشارك رابطك للحصول على إيميلات إضافية\n\n` +
      `*👤 الحساب:*\nاربط بريدك لحفظ بياناتك واسترجاعها`,
      backKb()
    );
  }

  // ─── لوحة المطور ───
  if(data==="dev_panel"){ if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *الإعدادات:*",devSettingsKb()); }

  if(data==="ds_maintenance"){
    if(!isDev(uid))return;
    DB.settings.maintenanceMode=!DB.settings.maintenanceMode;
    return edit("⚙️ *الإعدادات:*",devSettingsKb());
  }

  for(const k of["ds_max_email","ds_cool","ds_watch","ds_ref"]){
    if(data===k){
      if(!isAdmin(uid))return;
      const labels={ds_max_email:"الحد اليومي للإيميلات",ds_cool:"الانتظار (ثانية)",ds_watch:"مدة المراقبة (دقيقة)",ds_ref:"مكافأة الإحالة"};
      DB.state[uid]={mode:"dev_setting",key:k};
      return edit(`✏️ أرسل القيمة الجديدة لـ *${labels[k]}*:`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_settings")]])
      );
    }
  }

  if(data==="ds_welcome"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_welcome"};
    return edit("✏️ أرسل رسالة الترحيب الجديدة:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_settings")]]));
  }

  if(data==="dev_stats"){
    if(!isAdmin(uid))return;
    const total    = Object.keys(DB.users).length;
    const banned   = Object.values(DB.users).filter(u=>u.banned).length;
    const admins   = DB.admins.size;
    const emails   = Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0);
    const active   = Object.keys(DB.activeEmails).length;
    const today_   = Object.keys(DB.daily).filter(k=>k.includes(today())).reduce((a,k)=>a+DB.daily[k],0);
    return edit(
      `📊 *إحصائيات عامة*\n\n👥 الأعضاء: *${total}*\n🚫 المحظورون: *${banned}*\n⭐ المسؤولون: *${admins}*\n📧 إجمالي الإيميلات: *${emails}*\n📬 نشطون الآن: *${active}*\n📅 طلبات اليوم: *${today_}*\n📜 السجلات: *${DB.logs.length}*`,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])
    );
  }

  if(data==="dev_logs"){
    if(!isAdmin(uid))return;
    const last=DB.logs.slice(0,15);
    let txt=`📜 *آخر ${last.length} أحداث:*\n\n`;
    last.forEach(l=>{ txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${(l.text||"").slice(0,50)}\n🕐 ${l.time}\n\n`; });
    return edit(txt||"لا توجد سجلات.",
      Markup.inlineKeyboard([
        [Markup.button.callback("🗑 مسح","dev_clear_logs"),
         Markup.button.callback("🔙 لوحة","dev_panel")]
      ])
    );
  }

  if(data==="dev_clear_logs"){
    if(!isDev(uid))return;
    DB.logs=[];
    return edit("✅ تم مسح السجل.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_users"){
    if(!isAdmin(uid))return;
    const users=Object.entries(DB.users);
    let txt=`👥 *الأعضاء (${users.length}):*\n\n`;
    users.slice(0,10).forEach(([id,u])=>{
      const badge=u.banned?"🚫":isAdmin(parseInt(id))?"⭐":"👤";
      txt+=`${badge} *${u.name}* [\`${id}\`]\n   📅 ${u.joinedAt} | 👁 ${u.lastSeen}\n\n`;
    });
    if(users.length>10) txt+=`... و ${users.length-10} آخرين`;
    return edit(txt,Markup.inlineKeyboard([
      [Markup.button.callback("🔍 بحث عن عضو","dev_search_user")],
      [Markup.button.callback("🔙 لوحة","dev_panel")]
    ]));
  }

  if(data==="dev_search_user"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_search_user"};
    return edit("🔍 أرسل معرف المستخدم (ID) أو اسمه:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_panel")]])
    );
  }

  if(data==="dev_announce"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_announce"};
    return edit("📣 أرسل نص الإعلان (سيظهر في الصفحة الرئيسية):",
      Markup.inlineKeyboard([[Markup.button.callback("🗑 مسح الإعلان الحالي","dev_clear_announce")],[Markup.button.callback("❌ إلغاء","dev_panel")]])
    );
  }

  if(data==="dev_clear_announce"){
    if(!isAdmin(uid))return;
    DB.announcements=[];
    return edit("✅ تم مسح الإعلان.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_monitors"){
    if(!isAdmin(uid))return;
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors=await getMonitors();
    if(!monitors.length) return edit("🌐 لا توجد مواقع مضافة.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
    let txt=`🌐 *المواقع المراقبة (${monitors.length}):*\n\n`;
    monitors.forEach(m=>{
      const icon=m.status===2?"🟢":m.status===9?"🔴":"🟡";
      txt+=`${icon} *${m.friendly_name||m.url}*\n   📈 ${m.all_time_uptime_ratio||"—"}%\n\n`;
    });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_export"){
    if(!isDev(uid))return;
    const exp={
      users:    Object.keys(DB.users).length,
      admins:   [...DB.admins],
      referrals:Object.keys(DB.referrals).length,
      logs:     DB.logs.length,
      settings: DB.settings,
      exported: stamp(),
    };
    return edit(`📤 *تصدير البيانات (ملخص):*\n\n\`\`\`json\n${JSON.stringify(exp,null,2).slice(0,600)}\n\`\`\``,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])
    );
  }

  if(data==="dev_broadcast"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"broadcast"};
    return edit("📢 أرسل الرسالة الجماعية:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_panel")]])
    );
  }

  // عرض المستخدمين للإجراءات
  const actions=["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"];
  for(const act of actions){
    if(data===act){
      if(!isAdmin(uid))return;
      const labels={dev_ban:"🔨 حظر",dev_unban:"✅ رفع حظر",dev_mute:"🔇 كتم",dev_unmute:"🔊 رفع كتم",dev_promote:"⭐ ترقية",dev_demote:"⬇️ تخفيض"};
      return edit(`${labels[act]}\n\n*اختر العضو:*`,usersKb(act));
    }
    if(data.startsWith(`${act}:`)){
      if(!isAdmin(uid))return;
      const tid=parseInt(data.split(":")[1]);
      if(!DB.users[tid]) DB.users[tid]={name:String(tid),username:"",joinedAt:stamp(),banned:false,muted:false,role:"user",lastSeen:"—",msgCount:0};
      let msg="";
      if(act==="dev_ban")     { DB.users[tid].banned=true;  msg=`🚫 تم حظر \`${tid}\``; addLog("ban",uid,`حظر ${tid}`); }
      if(act==="dev_unban")   { DB.users[tid].banned=false; msg=`✅ رُفع الحظر عن \`${tid}\``; addLog("unban",uid,`رفع حظر ${tid}`); }
      if(act==="dev_mute")    { DB.users[tid].muted=true;   msg=`🔇 تم كتم \`${tid}\``; addLog("mute",uid,`كتم ${tid}`); }
      if(act==="dev_unmute")  { DB.users[tid].muted=false;  msg=`🔊 رُفع الكتم عن \`${tid}\``; addLog("unmute",uid,`رفع كتم ${tid}`); }
      if(act==="dev_promote") {
        if(!isDev(uid)) return edit("❌ فقط المطور يمكنه الترقية.",backKb());
        DB.admins.add(tid); DB.users[tid].role="admin"; msg=`⭐ تمت ترقية \`${tid}\``;
        addLog("promote",uid,`ترقية ${tid}`);
        try{ await bot.telegram.sendMessage(tid,"⭐ تمت ترقيتك لمسؤول في البوت!"); }catch{}
      }
      if(act==="dev_demote"){
        if(!isDev(uid)) return edit("❌ فقط المطور يمكنه التخفيض.",backKb());
        DB.admins.delete(tid); DB.users[tid].role="user"; msg=`⬇️ تم تخفيض \`${tid}\``;
        addLog("demote",uid,`تخفيض ${tid}`);
      }
      try{ await bot.telegram.sendMessage(tid,`📢 تم اتخاذ إجراء على حسابك: ${msg.replace(/`/g,"")}`); }catch{}
      return edit(msg,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
    }
  }

  if(data.startsWith("upage:")){
    const [,act,page]=data.split(":");
    return edit("*اختر العضو:*",usersKb(act,parseInt(page)));
  }
});

// ===================== معالج النصوص =====================
bot.on("text", async ctx => {
  const uid  = ctx.from.id;
  const text = ctx.message.text.trim();
  const st   = DB.state[uid];
  if(!st) return;

  // captcha
  if(st.mode==="captcha"){
    const ans = parseInt(text);
    if(ans===DB.sessions[uid]?.captchaAns){
      DB.sessions[uid].verified=true;
      delete DB.state[uid];
      addLog("verified",uid,DB.users[uid]?.name);
      await ctx.reply("✅ *تم التحقق بنجاح!* 🎉",{parse_mode:"Markdown"});
      return showMain(ctx);
    } else {
      const ops=["+","-"];
      const op=ops[Math.floor(Math.random()*2)];
      const n1=Math.floor(Math.random()*9)+1;
      const n2=Math.floor(Math.random()*9)+1;
      DB.sessions[uid].captchaAns=op==="+"?n1+n2:n1-n2;
      return ctx.reply(`❌ إجابة خاطئة. حاول مجدداً:\n\n🔢 *${n1} ${op} ${n2} = ?*`,{parse_mode:"Markdown"});
    }
  }

  // فحص رابط
  if(st.mode==="vt_scan_url"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري الفحص...*",{parse_mode:"Markdown"});
    const r = await vtScanUrl(text);
    if(!r) return ctx.reply("❌ تعذر الفحص. تأكد من صحة الرابط.",mainKb());
    const {stats,reputation,title} = r;
    const mal=stats.malicious||0, sus=stats.suspicious||0, clean=stats.harmless||0, un=stats.undetected||0;
    const verdict=mal>0?"🔴 *خطر*":sus>0?"🟡 *مشبوه*":"🟢 *آمن*";
    DB.users[uid].vtScans=(DB.users[uid].vtScans||0)+1;
    return ctx.reply(
      `🔍 *نتيجة الفحص*\n\n${verdict}\n\n🔗 \`${text.slice(0,60)}\`\n${title?`📌 ${title}\n`:""}\n🔴 ضار: *${mal}*\n🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}*\n⚪ غير محدد: *${un}*\n⭐ السمعة: *${reputation}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // فحص دومين
  if(st.mode==="vt_scan_domain"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الدومين...*",{parse_mode:"Markdown"});
    const r = await vtGetDomainReport(text.replace(/https?:\/\//,"").split("/")[0]);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const stats=r.last_analysis_stats||{};
    const mal=stats.malicious||0;
    const verdict=mal>0?"🔴 *خطر*":"🟢 *آمن*";
    return ctx.reply(
      `🌐 *فحص الدومين*\n\n${verdict}\n\n🌐 \`${text}\`\n\n🔴 ضار: *${mal}*\n🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${r.reputation||0}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // فحص IP
  if(st.mode==="vt_scan_ip"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الـ IP...*",{parse_mode:"Markdown"});
    const r = await vtGetIpReport(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const stats=r.last_analysis_stats||{};
    const mal=stats.malicious||0;
    const verdict=mal>0?"🔴 *خطر*":"🟢 *آمن*";
    return ctx.reply(
      `🖥 *فحص IP*\n\n${verdict}\n\n🖥 \`${text}\`\n\n🌍 الدولة: *${r.country||"—"}*\n🔴 ضار: *${mal}*\n🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${r.reputation||0}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // حفظ اسم الإيميل
  if(st.mode==="save_email_label"){
    const {login,domain}=st;
    delete DB.state[uid];
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    DB.savedEmails[uid].push({login,domain,label:text,savedAt:stamp()});
    addLog("email_saved",uid,`${login}@${domain} | ${text}`);
    return ctx.reply(
      `✅ *تم حفظ الإيميل!*\n\n📧 \`${login}@${domain}\`\n🏷 *${text}*`,
      {parse_mode:"Markdown",...emailActiveKb(login,domain)}
    );
  }

  // حفظ كلمة سر مع اسم المنصة
  if(st.mode==="store_pass_platform"){
    const pass=st.pass;
    delete DB.state[uid];
    if(!DB.savedPasswords[uid]) DB.savedPasswords[uid]=[];
    DB.savedPasswords[uid].push({platform:text,password:pass,savedAt:stamp()});
    addLog("pass_saved",uid,text);
    return ctx.reply(`✅ *تم الحفظ!*\n\n🏷 *${text}*\n🔐 \`${pass}\``,{parse_mode:"Markdown",...mainKb()});
  }

  // حفظ كلمة سر يدوية
  if(st.mode==="save_pass_custom"){
    DB.state[uid]={mode:"store_pass_platform",pass:text};
    return ctx.reply("✏️ أرسل اسم المنصة/الموقع:",{...Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]])});
  }

  // ربط بريد بالحساب
  if(st.mode==="set_account_email"){
    const emailRegex=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(text)) return ctx.reply("❌ بريد غير صحيح. أرسل بريداً صحيحاً:");
    delete DB.state[uid];
    DB.users[uid].accountEmail=text;
    addLog("account_email_set",uid,text);
    return ctx.reply(`✅ *تم ربط البريد:* \`${text}\`\nستستطيع استرجاع بياناتك به.`,{parse_mode:"Markdown",...mainKb()});
  }

  // تعيين كلمة سر الحساب
  if(st.mode==="set_account_pass"){
    if(text.length<6) return ctx.reply("❌ كلمة السر قصيرة. يجب أن تكون 6 أحرف على الأقل:");
    delete DB.state[uid];
    DB.users[uid].passwordHash=hashPass(text);
    addLog("account_pass_set",uid,"");
    return ctx.reply("✅ *تم تعيين كلمة السر بنجاح!* 🔐",{parse_mode:"Markdown",...mainKb()});
  }

  // إضافة موقع للمراقبة
  if(st.mode==="uptime_add_url"){
    delete DB.state[uid];
    if(!isAdmin(uid)) return;
    await ctx.reply("⏳ *جاري إضافة الموقع...*",{parse_mode:"Markdown"});
    const result=await addMonitor(text);
    DB.uptimeCache.ts=0;
    if(result?.stat==="ok") return ctx.reply(`✅ *تم إضافة الموقع:*\n\`${text}\``,{parse_mode:"Markdown",...mainKb()});
    return ctx.reply(`❌ فشل الإضافة: ${result?.error?.message||"تحقق من الرابط"}`,mainKb());
  }

  // إعداد رقمي للمطور
  if(st.mode==="dev_setting"){
    if(!isAdmin(uid))return;
    const val=parseInt(text);
    if(isNaN(val)||val<1) return ctx.reply("❌ قيمة غير صحيحة.");
    if(st.key==="ds_max_email") DB.settings.maxEmailsPerDay=val;
    if(st.key==="ds_cool")      DB.settings.cooldown=val;
    if(st.key==="ds_watch")     DB.settings.emailWatchMin=val;
    if(st.key==="ds_ref")       DB.settings.refBonus=val;
    delete DB.state[uid];
    addLog("settings",uid,`${st.key}=${val}`);
    return ctx.reply("✅ تم التحديث.",devSettingsKb());
  }

  // رسالة الترحيب
  if(st.mode==="dev_welcome"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    DB.settings.welcomeMsg=text;
    return ctx.reply("✅ تم تحديث رسالة الترحيب.",devSettingsKb());
  }

  // إعلان
  if(st.mode==="dev_announce"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    DB.announcements.unshift(text);
    if(DB.announcements.length>3) DB.announcements.pop();
    addLog("announce",uid,text.slice(0,50));
    return ctx.reply("✅ تم نشر الإعلان. سيظهر في الصفحة الرئيسية.",devKb());
  }

  // بحث عن عضو
  if(st.mode==="dev_search_user"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    const q=text.toLowerCase();
    const found=Object.entries(DB.users).filter(([id,u])=>
      id===text || u.name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q)
    );
    if(!found.length) return ctx.reply("❌ لم يُعثر على عضو.",devKb());
    let txt=`🔍 *نتائج البحث (${found.length}):*\n\n`;
    found.slice(0,5).forEach(([id,u])=>{
      txt+=`👤 *${u.name}*\n🆔 \`${id}\`\n📛 @${u.username||"—"}\n📅 ${u.joinedAt}\n👁 ${u.lastSeen}\n🏅 ${u.role}\n🚫 محظور: ${u.banned?"نعم":"لا"}\n\n`;
    });
    return ctx.reply(txt,{parse_mode:"Markdown",...devKb()});
  }

  // رسالة جماعية
  if(st.mode==="broadcast"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    const ids=Object.keys(DB.users);
    await ctx.reply(`📢 جاري الإرسال لـ ${ids.length} عضو...`);
    let sent=0, fail=0;
    for(const id of ids){
      try{
        await bot.telegram.sendMessage(parseInt(id),`📢 *رسالة من الإدارة:*\n\n${text}`,{parse_mode:"Markdown"});
        sent++; await sleep(50);
      } catch{ fail++; }
    }
    addLog("broadcast",uid,`أُرسلت ${sent} | فشل ${fail}`);
    return ctx.reply(`✅ أُرسلت لـ *${sent}* | فشل *${fail}*`,{parse_mode:"Markdown",...devKb()});
  }
});

// معالجة الملفات للفحص
bot.on("document", async ctx => {
  const uid = ctx.from.id;
  if(!DB.sessions[uid]?.verified&&!isDev(uid)) return;
  const file = ctx.message.document;
  if(file.file_size>5*1024*1024) return ctx.reply("❌ الملف كبير جداً (الحد 5MB).");
  await ctx.reply("⏳ *جاري رفع الملف للفحص...*",{parse_mode:"Markdown"});
  try {
    const link = await bot.telegram.getFileLink(file.file_id);
    const res  = await axios.get(link.href, {responseType:"arraybuffer",timeout:20000});
    const analysisId = await vtScanFile(Buffer.from(res.data), file.file_name||"file");
    if(!analysisId) return ctx.reply("❌ فشل رفع الملف للفحص.",mainKb());
    addLog("file_scan",uid,file.file_name||"file");
    await ctx.reply(`⏳ تم رفع الملف. جاري الانتظار للحصول على النتيجة...\n🆔 \`${analysisId}\``,{parse_mode:"Markdown"});
    await sleep(15000);
    const report = await vtGetFileReport(analysisId);
    if(!report) return ctx.reply("⌛ لم تكتمل النتيجة بعد. حاول مجدداً بعد قليل.",mainKb());
    const stats = report.stats||{};
    const mal = stats.malicious||0;
    const verdict = mal>0?"🔴 *خطر*":stats.suspicious?"🟡 *مشبوه*":"🟢 *آمن*";
    return ctx.reply(
      `🔍 *نتيجة فحص الملف*\n\n${verdict}\n\n📄 *${file.file_name||"ملف"}*\n\n🔴 ضار: *${mal}*\n🟡 مشبوه: *${stats.suspicious||0}*\n🟢 آمن: *${stats.harmless||0}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  } catch(e){
    return ctx.reply("❌ حدث خطأ أثناء الفحص.",mainKb());
  }
});

// ===================== تشغيل =====================
console.log(`🚀 البوت v${BOT_VER} يعمل...`);
bot.launch();
process.once("SIGINT",  ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
