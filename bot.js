"use strict";

// ============================================================
//  بوت تيليجرام شامل — MailSlurp API الحقيقي
//  النسخة المطورة الكاملة v4.0
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");

// ===================== الإعدادات =====================
const BOT_TOKEN   = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const MS_API_KEY  = "sk_jmXm1Im3hxzT7Lnf_6T6dD3ab7Xzf4ACe0or8TEqBNX9L6hwW9rw1ddfKtiGjs3bCyJTOKuQNKZ1mMSkV";
const MS_BASE     = "https://api.mailslurp.com"; // MailSlurp REST API
const VT_KEY      = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY      = "u3469811-ab163c31f24d6012491f0807";
const DEV_ID      = 7411444902;
const PORT        = process.env.PORT || 8080;

// ===================== MailSlurp Headers =====================
const msHeaders = {
  "x-api-key": MS_API_KEY,
  "Content-Type": "application/json",
  "Accept": "application/json",
};

// ===================== Keep-Alive =====================
http.createServer((_,res)=>{ res.writeHead(200); res.end("OK"); })
  .listen(PORT,"0.0.0.0",()=>console.log(`✅ Port ${PORT}`));

// ===================== قاعدة البيانات =====================
const DB = {
  users:         {},
  sessions:      {},
  activeEmails:  {}, // uid -> { email, inboxId, type, createdAt }
  savedEmails:   {},
  savedPasswords:{},
  emailHistory:  {},
  activityLog:   {},
  referrals:     {},
  referralOf:    {},
  referralPerks: {},
  logs:          [],
  admins:        new Set([DEV_ID]),
  adminPerms:    {},
  announcements: [],
  groups:        {},
  settings: {
    maxEmailsPerDay:      30,
    cooldown:             8,
    emailWatchMin:        25,
    refBonus:             5,
    maintenanceMode:      false,
    screenshotProtection: false,
    botName:              "بوت الإيميلات المؤقت",
    welcomeMsg:           "أهلاً بك في البوت! 🎉",
  },
  lastReq:  {},
  daily:    {},
  vtCache:  {},
  state:    {},
};

// ===================== مساعدات =====================
const now   = () => Math.floor(Date.now()/1000);
const today = () => new Date().toISOString().slice(0,10);
const stamp = () => new Date().toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function log(type, uid, text) {
  DB.logs.unshift({type,uid,text,time:stamp()});
  if(DB.logs.length>2000) DB.logs.pop();
  if(!DB.activityLog[uid]) DB.activityLog[uid]=[];
  DB.activityLog[uid].unshift({action:type,detail:text,time:stamp()});
  if(DB.activityLog[uid].length>100) DB.activityLog[uid].pop();
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

function hasPerm(uid, perm) {
  if(isDev(uid)) return true;
  if(!isAdmin(uid)) return false;
  const perms = DB.adminPerms[uid];
  if(!perms) return true;
  return !!perms[perm];
}

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

// ===================== MailSlurp API Functions =====================

// إنشاء Inbox جديد
async function msCreateInbox(expiresInMinutes = 25) {
  try {
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const r = await axios.post(`${MS_BASE}/inboxes`, {
      expiresAt,
      useDomainPool: true,
      isPublic: false,
    }, { headers: msHeaders, timeout: 15000 });

    const data = r.data;
    console.log(`✅ MailSlurp Inbox: ${data.emailAddress} | ID: ${data.id}`);
    return {
      email:   data.emailAddress,
      inboxId: data.id,
      expiresAt: data.expiresAt,
    };
  } catch(e) {
    console.error("msCreateInbox error:", e.response?.status, e.response?.data || e.message);
    return null;
  }
}

// جلب رسائل Inbox (polling)
async function msGetEmails(inboxId, since) {
  try {
    const params = {
      inboxId,
      size: 20,
      sort: "DESC",
    };
    if(since) params.since = since;

    const r = await axios.get(`${MS_BASE}/emails`, {
      headers: msHeaders,
      params,
      timeout: 10000,
    });

    // الاستجابة هي صفحة paginated
    const content = r.data?.content || r.data || [];
    return Array.isArray(content) ? content : [];
  } catch(e) {
    console.log("msGetEmails error:", e.response?.status, e.message);
    return [];
  }
}

// قراءة رسالة كاملة
async function msGetEmail(emailId) {
  try {
    const r = await axios.get(`${MS_BASE}/emails/${emailId}`, {
      headers: msHeaders,
      timeout: 10000,
    });
    return r.data;
  } catch(e) {
    console.log("msGetEmail error:", e.message);
    return null;
  }
}

// انتظار الرسالة الجديدة (WaitFor API) — يظل منتظراً حتى تصل
async function msWaitForLatestEmail(inboxId, timeoutMs = 30000, since) {
  try {
    const params = { inboxId, timeout: timeoutMs, unreadOnly: true };
    if(since) params.since = since;

    const r = await axios.get(`${MS_BASE}/waitForLatestEmail`, {
      headers: msHeaders,
      params,
      timeout: timeoutMs + 5000,
    });
    return r.data;
  } catch(e) {
    // 404 = لم تصل رسالة في المهلة
    return null;
  }
}

// حذف Inbox
async function msDeleteInbox(inboxId) {
  try {
    await axios.delete(`${MS_BASE}/inboxes/${inboxId}`, {
      headers: msHeaders,
      timeout: 10000,
    });
    return true;
  } catch(e) { return false; }
}

// استخراج الكود / OTP من نص
function extractOTP(text) {
  if(!text) return [];
  // تنظيف HTML
  const clean = text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/g," ")
    .replace(/\s+/g," ")
    .trim();

  const patterns = [
    /(?:verification|confirm|otp|code|رمز|كود|pin|token)[^0-9A-Z]*([A-Z0-9]{4,10})/gi,
    /\b([0-9]{4,8})\b/g,
    /([A-Z0-9]{6,10})\b/g,
  ];

  const found = new Set();
  for(const pat of patterns) {
    const matches = [...clean.matchAll(pat)];
    for(const m of matches) {
      if(m[1] && m[1].length >= 4) found.add(m[1]);
    }
  }
  return [...found].slice(0, 5);
}

// ===================== مراقب الإيميل — MailSlurp =====================
async function emailWatcher(bot, uid, emailData, chatId) {
  const { email, inboxId, createdAt } = emailData;
  const watchMinutes = DB.settings.emailWatchMin;
  const endTime = now() + watchMinutes * 60;
  const seenIds = new Set();

  console.log(`👀 بدأ مراقبة: ${email} | inboxId: ${inboxId}`);

  // نستخدم ISO timestamp لجلب الرسائل الجديدة فقط
  let sinceTime = new Date(createdAt * 1000).toISOString();

  while(now() < endTime) {
    // توقف إذا أُلغي الإيميل
    if(!DB.activeEmails[uid] || DB.activeEmails[uid].inboxId !== inboxId) {
      console.log(`🛑 توقف مراقبة: ${email}`);
      return;
    }

    await sleep(5000);

    let emails = [];
    try {
      emails = await msGetEmails(inboxId, sinceTime);
    } catch(e) { continue; }

    for(const preview of emails) {
      const eid = String(preview.id);
      if(seenIds.has(eid)) continue;
      seenIds.add(eid);

      // تحديث sinceTime
      if(preview.createdAt) sinceTime = preview.createdAt;

      // جلب تفاصيل الرسالة الكاملة
      const fullEmail = await msGetEmail(eid);
      if(!fullEmail) continue;

      const subject = fullEmail.subject || preview.subject || "بدون موضوع";
      const from    = fullEmail.from    || preview.from    || "—";
      const body    = fullEmail.body    || fullEmail.bodyPlainText || "";
      const otps    = extractOTP(body);

      const otpText = otps.length
        ? `\n\n🔑 *الكود:*\n${otps.map(c=>`\`${c}\``).join("  ")}`
        : "";

      const cleanBody = body
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
        .replace(/<[^>]+>/g," ")
        .replace(/\s+/g," ")
        .trim()
        .slice(0,1500);

      log("email_received", uid, `${email} | ${subject}`);
      if(DB.emailHistory[uid]) {
        const idx = DB.emailHistory[uid].findIndex(e=>e.email===email);
        if(idx>=0) DB.emailHistory[uid][idx].msgCount = (DB.emailHistory[uid][idx].msgCount||0)+1;
      }

      try {
        const msgOpts = {
          parse_mode:"Markdown",
          ...emailActiveKb(email, inboxId),
        };
        if(DB.settings.screenshotProtection) msgOpts.protect_content = true;

        await bot.telegram.sendMessage(chatId,
          `📧 *وصلت رسالة جديدة!*\n\n` +
          `📬 *من:* \`${from}\`\n` +
          `📋 *الموضوع:* ${subject}` +
          otpText +
          `\n\n📝 *المحتوى:*\n\`\`\`\n${cleanBody||"(فارغ)"}\n\`\`\``,
          msgOpts
        );
      } catch(e){ console.error("sendMsg:", e.message); }
    }
  }

  // انتهى الوقت
  if(DB.activeEmails[uid]?.inboxId === inboxId) {
    // حذف inbox من MailSlurp
    await msDeleteInbox(inboxId);
    delete DB.activeEmails[uid];
    try {
      await bot.telegram.sendMessage(chatId,
        `⏰ *انتهت مدة الإيميل المؤقت*\n\n\`${email}\`\n\nأنشئ إيميلاً جديداً 📧`,
        {parse_mode:"Markdown",...mainKb()}
      );
    } catch{}
  }
}

// ===================== VirusTotal =====================
async function vtScanUrl(url) {
  const cacheKey = `url_${Buffer.from(url).toString("base64").slice(0,30)}`;
  if(DB.vtCache[cacheKey] && now()-DB.vtCache[cacheKey].ts<3600)
    return DB.vtCache[cacheKey].result;
  try {
    const submitRes = await axios.post("https://www.virustotal.com/api/v3/urls",
      new URLSearchParams({url}).toString(),
      { headers:{"x-apikey":VT_KEY,"Content-Type":"application/x-www-form-urlencoded"}, timeout:15000 }
    );
    const analysisId = submitRes.data?.data?.id;
    if(analysisId) {
      await sleep(3000);
      const analysisRes = await axios.get(`https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        {headers:{"x-apikey":VT_KEY}, timeout:12000}
      );
      const attr = analysisRes.data?.data?.attributes||{};
      const result = {
        stats: attr.stats||{},
        reputation: 0,
        malEngines: Object.entries(attr.results||{})
          .filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
      };
      DB.vtCache[cacheKey]={result,ts:now()};
      return result;
    }
  } catch(e){ console.log("vtSubmit:",e.message); }
  try {
    const enc = Buffer.from(url).toString("base64")
      .replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r = await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr  = r.data?.data?.attributes||{};
    const result = {
      stats:      attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      malEngines: [],
    };
    DB.vtCache[cacheKey]={result,ts:now()};
    return result;
  } catch{ return null; }
}

async function vtScanDomain(domain) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/domains/${domain}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr = r.data?.data?.attributes||{};
    return {
      stats: attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      registrar: attr.registrar||"—",
      created: attr.creation_date ? new Date(attr.creation_date*1000).toLocaleDateString("ar") : "—",
      malEngines: Object.entries(attr.last_analysis_results||{})
        .filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
    };
  } catch{ return null; }
}

async function vtScanIp(ip) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr = r.data?.data?.attributes||{};
    return {
      stats: attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      country: attr.country||"—",
      asOwner: attr.as_owner||"—",
      malEngines: Object.entries(attr.last_analysis_results||{})
        .filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
    };
  } catch{ return null; }
}

async function vtUploadFile(buffer, filename) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", buffer, {filename: filename||"file"});
    const r = await axios.post("https://www.virustotal.com/api/v3/files", form, {
      headers:{...form.getHeaders(),"x-apikey":VT_KEY},
      timeout:120000, maxContentLength:Infinity, maxBodyLength:Infinity,
    });
    return r.data?.data?.id || null;
  } catch(e){ console.error("vtUpload:",e.message); return null; }
}

async function vtGetAnalysis(id) {
  try {
    for(let i=0; i<8; i++) {
      const r = await axios.get(`https://www.virustotal.com/api/v3/analyses/${id}`,
        {headers:{"x-apikey":VT_KEY},timeout:12000});
      const attr = r.data?.data?.attributes;
      if(attr?.status === "completed") return attr;
      await sleep(5000);
    }
  } catch(e){}
  return null;
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

const emailActiveKb = (email, inboxId) => Markup.inlineKeyboard([
  [Markup.button.callback("📨 فتح الصندوق",`inbox:${inboxId}`),
   Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)],
  [Markup.button.callback("💾 حفظ الإيميل",`save_email:${inboxId}:${email}`),
   Markup.button.callback("🗑 إنهاء",`del_email:${inboxId}`)],
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
  [Markup.button.callback("⭐ ترقية مسؤول","dev_promote"),
   Markup.button.callback("⬇️ تخفيض","dev_demote")],
  [Markup.button.callback("👥 إدارة القروبات","dev_groups"),
   Markup.button.callback("🛡 إدارة المسؤولين","dev_admins")],
  [Markup.button.callback("📣 إعلانات","dev_announce"),
   Markup.button.callback("🔍 بحث عضو","dev_search_user")],
  [Markup.button.callback("⚙️ إعدادات البوت","dev_settings"),
   Markup.button.callback("🤖 تخصيص البوت","dev_customize")],
]);

const devSettingsKb = () => Markup.inlineKeyboard([
  [Markup.button.callback(`🔧 الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,"ds_maint")],
  [Markup.button.callback(`📧 الحد اليومي: ${DB.settings.maxEmailsPerDay}`,"ds_max"),
   Markup.button.callback(`⏱ الانتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`⏰ مراقبة: ${DB.settings.emailWatchMin}د`,"ds_watch"),
   Markup.button.callback(`🎁 مكافأة إحالة: ${DB.settings.refBonus}`,"ds_ref")],
  [Markup.button.callback(
    `🛡 حماية لقطات الشاشة: ${DB.settings.screenshotProtection?"✅ مفعّلة":"❌ معطّلة"}`,
    "ds_screenshot"
  )],
  [Markup.button.callback("🔙 لوحة","dev_panel")],
]);

function usersKb(action, page=0) {
  const pp=8;
  const ids=Object.keys(DB.users);
  const rows=ids.slice(page*pp,(page+1)*pp).map(id=>{
    const u=DB.users[id];
    const b = u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
    return [Markup.button.callback(`${b} ${u.name.slice(0,14)} [${id}]`,`${action}:${id}`)];
  });
  const nav=[];
  if(page>0) nav.push(Markup.button.callback("◀️",`upage:${action}:${page-1}`));
  nav.push(Markup.button.callback(`${page+1}/${Math.ceil(ids.length/pp)||1}`,"noop"));
  if((page+1)*pp<ids.length) nav.push(Markup.button.callback("▶️",`upage:${action}:${page+1}`));
  if(nav.length) rows.push(nav);
  rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== البوت =====================
const bot = new Telegraf(BOT_TOKEN);

// تتبع القروبات
bot.on("my_chat_member", async ctx => {
  try {
    const chat = ctx.chat;
    if(chat.type==="group"||chat.type==="supergroup") {
      DB.groups[chat.id]={
        title:chat.title||"قروب",id:chat.id,type:chat.type,
        joinedAt:stamp(),members:chat.members_count||0,
      };
      log("group_join",DEV_ID,chat.title);
    }
  } catch(e){}
});

bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid = ctx.from.id;

  if(ctx.chat&&(ctx.chat.type==="group"||ctx.chat.type==="supergroup")) {
    if(!DB.groups[ctx.chat.id]) {
      DB.groups[ctx.chat.id]={title:ctx.chat.title||"قروب",id:ctx.chat.id,
        type:ctx.chat.type,joinedAt:stamp(),members:0};
    }
  }

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
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق! +${DB.settings.refBonus} إيميلات إضافية`); }catch{}
    }
  }

  log("start",uid,DB.users[uid]?.name);

  if(isDev(uid)){
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n\n🤖 *${DB.settings.botName}*\n` +
      `👥 الأعضاء: *${Object.keys(DB.users).length}*\n` +
      `🏘 القروبات: *${Object.keys(DB.groups).length}*\n` +
      `⭐ المسؤولون: *${DB.admins.size-1}*\n\n` +
      `📧 البريد: MailSlurp API ✅`,
      {parse_mode:"Markdown",...devKb()}
    );
  }

  if(!DB.sessions[uid]?.verified){
    const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
    DB.sessions[uid]={verified:false,captchaAns:n1+n2};
    DB.state[uid]={mode:"captcha"};
    return ctx.reply(
      `👋 *${DB.settings.welcomeMsg}*\n\n🤖 للتحقق أنك لست روبوت:\n\n🔢 *${n1} + ${n2} = ?*`,
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
  if(DB.settings.screenshotProtection) txt+=`\n\n🛡 _الحماية مفعّلة_`;
  const opts = {parse_mode:"Markdown",...mainKb()};
  if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
  await ctx.reply(txt,opts);
}

bot.command("dev",   async ctx=>{ if(!isDev(ctx.from.id))return; ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("stats", async ctx=>{ if(!isAdmin(ctx.from.id))return; showDevStats(ctx); });

async function showDevStats(ctx) {
  const total  = Object.keys(DB.users).length;
  const banned = Object.values(DB.users).filter(u=>u.banned).length;
  const muted  = Object.values(DB.users).filter(u=>u.muted).length;
  const emails = Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0);
  const active = Object.keys(DB.activeEmails).length;
  const groups = Object.keys(DB.groups).length;
  const today_e= Object.keys(DB.daily).filter(k=>k.includes(today())).reduce((a,k)=>a+DB.daily[k],0);

  const txt =
    `📊 *إحصائيات شاملة*\n\n` +
    `👥 إجمالي الأعضاء: *${total}*\n` +
    `🚫 المحظورون: *${banned}*\n🔇 المكتومون: *${muted}*\n` +
    `⭐ المسؤولون: *${DB.admins.size}*\n🏘 القروبات: *${groups}*\n\n` +
    `📧 إيميلات كلي: *${emails}*\n📬 نشطون الآن: *${active}*\n` +
    `📅 إيميلات اليوم: *${today_e}*\n📜 السجلات: *${DB.logs.length}*\n\n` +
    `⚙️ *الإعدادات:*\n` +
    `• الحد اليومي: ${DB.settings.maxEmailsPerDay}\n` +
    `• المراقبة: ${DB.settings.emailWatchMin}د\n` +
    `• الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}\n` +
    `• 🛡 حماية الشاشة: ${DB.settings.screenshotProtection?"✅":"❌"}\n` +
    `• 📧 API: MailSlurp ✅`;

  if(ctx.callbackQuery) {
    await ctx.editMessageText(txt,{parse_mode:"Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  } else {
    await ctx.reply(txt,{parse_mode:"Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  }
}

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
  if(data==="dev_panel"){ if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }

  // ═══ قائمة الإيميلات ═══
  if(data==="menu_emails"){
    const active = DB.activeEmails[uid];
    const saved  = (DB.savedEmails[uid]||[]).length;
    const used   = dailyCount(uid), max = maxDay(uid);
    const rows   = [];
    if(active){
      rows.push([Markup.button.callback(
        `📬 إيميلك النشط: ${active.email.slice(0,30)}`,
        `inbox:${active.inboxId}`
      )]);
    }
    rows.push([Markup.button.callback("⚡ إيميل مؤقت جديد (MailSlurp)","new_temp_email")]);
    if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`, "my_emails")]);
    rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(
      `📧 *نظام الإيميلات — MailSlurp*\n\n` +
      `✅ اليوم: *${used}/${max}*\n` +
      `🔔 الكود يوصلك تلقائياً ⚡\n` +
      `⏱ مراقبة: *${DB.settings.emailWatchMin} دقيقة*\n\n` +
      `🌐 إيميلات حقيقية من MailSlurp`,
      Markup.inlineKeyboard(rows)
    );
  }

  // إنشاء إيميل مؤقت جديد عبر MailSlurp
  if(data==="new_temp_email"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid))
      return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلته.\nأحِل أصدقاء للمزيد 🎁`,backKb());

    await edit("⚡ *جاري إنشاء إيميل MailSlurp حقيقي...*");

    const result = await msCreateInbox(DB.settings.emailWatchMin);

    if(!result || !result.email) {
      return edit(
        "❌ *فشل إنشاء الإيميل!*\n\nتحقق من مفتاح MailSlurp API أو حاول لاحقاً.",
        Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_temp_email")],[Markup.button.callback("🔙 رجوع","menu_emails")]])
      );
    }

    // إلغاء inbox القديم إذا وُجد
    if(DB.activeEmails[uid]?.inboxId) {
      msDeleteInbox(DB.activeEmails[uid].inboxId).catch(()=>{});
    }

    const emailData = {
      email: result.email,
      inboxId: result.inboxId,
      createdAt: now(),
    };
    DB.activeEmails[uid] = emailData;
    DB.lastReq[`e_${uid}`] = now();
    incDaily(uid);

    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:result.email, type:"mailslurp", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("email_created",uid,result.email);

    const opts = {parse_mode:"Markdown",...emailActiveKb(result.email, result.inboxId)};
    if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;

    await edit(
      `✅ *تم إنشاء إيميلك الحقيقي!*\n\n` +
      `📧 *العنوان:*\n\`${result.email}\`\n\n` +
      `⚡ *البوت يراقب ويوصلك الكود فور وصوله تلقائياً*\n` +
      `⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*\n\n` +
      `💡 استخدم هذا الإيميل في أي موقع الآن`,
      opts
    );

    // ابدأ المراقبة في الخلفية
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // فتح الصندوق
  if(data.startsWith("inbox:")){
    const inboxId = data.slice(6);
    await edit("📨 *جاري فتح الصندوق...*");

    const emails = await msGetEmails(inboxId);

    if(!emails.length) {
      const active = DB.activeEmails[uid];
      return edit(
        `📭 *الصندوق فارغ حالياً*\n\n` +
        `\`${active?.email||"الإيميل"}\`\n\n` +
        `⚡ البوت يراقب ويوصلك الرسائل تلقائياً\n` +
        `_لا تحتاج تفتح الصندوق يدوياً_`,
        emailActiveKb(active?.email||"", inboxId)
      );
    }

    const rows = emails.slice(0,10).map(m=>{
      const sub = m.subject || "(بدون موضوع)";
      return [Markup.button.callback(`📩 ${sub.slice(0,28)}`, `msg:${m.id}:${inboxId}`)];
    });
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📬 *الصندوق — ${emails.length} رسالة:*`,Markup.inlineKeyboard(rows));
  }

  // قراءة رسالة
  if(data.startsWith("msg:")){
    const parts   = data.split(":");
    const emailId = parts[1];
    const inboxId = parts[2];
    await edit("📖 *جاري قراءة الرسالة...*");

    const fullEmail = await msGetEmail(emailId);
    if(!fullEmail) return edit("❌ تعذر قراءة الرسالة.",backKb());

    const body = (fullEmail.body||fullEmail.bodyPlainText||"")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
      .replace(/<[^>]+>/g," ")
      .replace(/\s+/g," ")
      .trim()
      .slice(0,1500);

    const otps    = extractOTP(fullEmail.body||"");
    const otpTxt  = otps.length ? `\n\n🔑 *الكود:*\n${otps.map(c=>`\`${c}\``).join("  ")}` : "";

    return edit(
      `📩 *الرسالة*\n\n` +
      `📬 *من:* \`${fullEmail.from||"—"}\`\n` +
      `📋 *الموضوع:* ${fullEmail.subject||"بدون موضوع"}` +
      otpTxt +
      `\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 الصندوق",`inbox:${inboxId}`)],
      ])
    );
  }

  // حفظ إيميل
  if(data.startsWith("save_email:")){
    const parts   = data.split(":");
    const inboxId = parts[1];
    const email   = parts.slice(2).join(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    if(DB.savedEmails[uid].find(e=>e.email===email))
      return edit("✅ الإيميل محفوظ مسبقاً.",emailActiveKb(email,inboxId));
    DB.state[uid]={mode:"save_email_label",email,inboxId};
    return edit("✏️ أرسل اسم/تسمية لهذا الإيميل:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_emails")]]));
  }

  if(data==="my_emails"){
    const saved = DB.savedEmails[uid]||[];
    if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows = saved.map((e,i)=>[
      Markup.button.callback(`📧 ${e.label} — ${e.email.slice(0,20)}`,`open_saved:${i}`)
    ]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📂 *محفوظاتي (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("open_saved:")){
    const idx = parseInt(data.split(":")[1]);
    const e = DB.savedEmails[uid]?.[idx];
    if(!e) return edit("❌ لم يُعثر.",backKb());
    return edit(
      `📧 *${e.label}*\n\n\`${e.email}\`\n🕐 ${e.savedAt}`,
      Markup.inlineKeyboard([
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
    const inboxId = data.slice(10);
    if(DB.activeEmails[uid]?.inboxId===inboxId) {
      msDeleteInbox(inboxId).catch(()=>{});
      delete DB.activeEmails[uid];
    }
    return edit("🗑 *تم إنهاء الإيميل.*",backKb());
  }

  if(data==="email_history"){
    const h = DB.emailHistory[uid]||[];
    if(!h.length) return edit("📊 *لا يوجد سجل.*",backKb());
    let txt=`📊 *سجل الإيميلات (${h.length}):*\n\n`;
    h.slice(0,10).forEach((e,i)=>{
      txt+=`${i+1}. 📧 \`${e.email}\`\n   📩 ${e.msgCount||0} رسالة | 🕐 ${e.time}\n\n`;
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
        [Markup.button.callback("➕ حفظ كلمة سر يدوياً","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="gen_pass"){
    const p = genStrongPass();
    return edit(
      `🔐 *كلمة السر:*\n\n\`${p}\`\n\n📊 الطول: ${p.length} | أحرف+أرقام+رموز`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💾 حفظها",`store_pass:${p}`)],
        [Markup.button.callback("🔄 أخرى","gen_pass")],
        [Markup.button.callback("🔙 رجوع","menu_passwords")],
      ])
    );
  }

  if(data.startsWith("store_pass:")){
    DB.state[uid]={mode:"store_pass_platform",pass:data.slice(11)};
    return edit("✏️ اكتب اسم المنصة (مثال: Gmail):",
      Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  if(data==="save_pass_prompt"){
    DB.state[uid]={mode:"save_pass_custom"};
    return edit("🔐 أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  if(data==="my_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر.*",backKb());
    let txt=`🔑 *كلمات السر (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{ txt+=`${i+1}. 🏷 *${p.platform}*\n   \`${p.password}\`\n\n`; });
    return edit(txt,Markup.inlineKeyboard([
      [Markup.button.callback("🗑 حذف الكل","del_all_pass")],
      [Markup.button.callback("🔙 رجوع","menu_passwords")],
    ]));
  }

  if(data==="del_all_pass"){ DB.savedPasswords[uid]=[]; return edit("🗑 *تم الحذف.*",backKb()); }

  // ═══ VirusTotal ═══
  if(data==="menu_vt"){
    return edit(
      `🔍 *فحص الأمان — VirusTotal*\n\n🛡 70+ محرك أمان`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔗 فحص رابط","vt_url"),
         Markup.button.callback("🌐 فحص دومين","vt_domain")],
        [Markup.button.callback("🖥 فحص IP","vt_ip"),
         Markup.button.callback("📁 فحص ملف","vt_file_info")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="vt_url")      { DB.state[uid]={mode:"vt_url"};    return edit("🔗 أرسل الرابط:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_domain")   { DB.state[uid]={mode:"vt_domain"}; return edit("🌐 أرسل الدومين:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_ip")       { DB.state[uid]={mode:"vt_ip"};     return edit("🖥 أرسل IP:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_file_info"){ return edit("📁 أرسل الملف مباشرة ↓",Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_vt")]])); }

  // ═══ UptimeRobot ═══
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors = await getMonitors();
    if(!monitors.length) return edit("🌐 *لا توجد مواقع.*",backKb());
    let txt=`🌐 *مواقعك (${monitors.length}):*\n\n`;
    monitors.slice(0,10).forEach(m=>{
      const ic=m.status===2?"🟢":m.status===9?"🔴":"🟡";
      txt+=`${ic} *${m.friendly_name||m.url}*\n   📈 ${m.all_time_uptime_ratio||"—"}%\n\n`;
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
      `🎁 *نظام الإحالة*\n\n🔗 *رابطك:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}*\n🎁 مكافأتك: *+${bonus} إيميل/يوم*\n\n📌 لكل صديق: *+${DB.settings.refBonus} إيميل إضافي*`,
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
    refs.slice(0,10).forEach((id,i)=>{ txt+=`${i+1}. ${DB.users[id]?.name||id}\n`; });
    return edit(txt,backKb());
  }

  // ═══ إحصائياتي ═══
  if(data==="my_stats"){
    const u = DB.users[uid]||{};
    return edit(
      `📊 *إحصائياتي*\n\n👤 *${u.name}*\n🆔 \`${uid}\`\n📅 انضممت: ${u.joinedAt}\n` +
      `📧 إيميلات اليوم: *${dailyCount(uid)}/${maxDay(uid)}*\n` +
      `📚 إجمالي: *${(DB.emailHistory[uid]||[]).length}*\n` +
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
      h.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. 📧 \`${e.email}\` — ${e.time}\n`; });
      txt+="\n";
    }
    if(a.length){
      txt+="*🕐 آخر النشاطات:*\n";
      a.slice(0,5).forEach((ac,i)=>{ txt+=`${i+1}. ${ac.action} — ${ac.time}\n`; });
    }
    if(!h.length&&!a.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ═══ حسابي ═══
  if(data==="my_account"){
    const u = DB.users[uid]||{};
    return edit(
      `👤 *حسابي*\n\n🆔 \`${uid}\`\n📧 ${u.accountEmail?`\`${u.accountEmail}\``:"غير محدد"}\n🔐 ${u.passwordHash?"✅":"❌"}\n🏅 ${u.role||"user"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📧 ربط بريد","acc_email"),
         Markup.button.callback("🔐 كلمة سر","acc_pass")],
        [Markup.button.callback("🔙","back")],
      ])
    );
  }
  if(data==="acc_email"){ DB.state[uid]={mode:"acc_email"}; return edit("📧 أرسل بريدك:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }
  if(data==="acc_pass") { DB.state[uid]={mode:"acc_pass"};  return edit("🔐 أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }

  // ═══ مساعدة ═══
  if(data==="help"){
    return edit(
      `ℹ️ *دليل البوت*\n\n` +
      `*📧 الإيميلات المؤقتة:*\n• إيميل حقيقي من MailSlurp\n• الأكواد تصلك تلقائياً فوراً ⚡\n• مراقبة ${DB.settings.emailWatchMin} دقيقة\n\n` +
      `*🔑 كلمات السر:* توليد وحفظ\n\n` +
      `*🔍 فحص الأمان:* 70+ محرك\n\n` +
      `*🎁 الإحالة:* إيميلات إضافية`,
      backKb()
    );
  }

  // ═══════════ لوحة التحكم ═══════════
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *إعدادات البوت:*",devSettingsKb()); }

  if(data==="ds_maint"){
    if(!isDev(uid))return;
    DB.settings.maintenanceMode=!DB.settings.maintenanceMode;
    return edit(`⚙️ الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,devSettingsKb());
  }

  if(data==="ds_screenshot"){
    if(!isDev(uid))return;
    DB.settings.screenshotProtection=!DB.settings.screenshotProtection;
    const status = DB.settings.screenshotProtection;
    if(status) {
      const ids=Object.keys(DB.users);
      for(const id of ids){
        try{
          await bot.telegram.sendMessage(parseInt(id),
            `🛡 *تم تفعيل الحماية من لقطات الشاشة*\n\n⚠️ الرسائل الآن محمية ولا يمكن إعادة توجيهها.\n🔒 بياناتك محمية.`,
            {parse_mode:"Markdown"}
          );
          await sleep(30);
        }catch{}
      }
    }
    return edit(
      `🛡 الحماية من لقطات الشاشة: ${status?"✅ مفعّلة\n\n✉️ تم إشعار الجميع":"❌ معطّلة"}`,
      devSettingsKb()
    );
  }

  for(const k of["ds_max","ds_cool","ds_watch","ds_ref"]){
    if(data===k){
      if(!isAdmin(uid))return;
      const lbl={ds_max:"الحد اليومي",ds_cool:"وقت الانتظار (ث)",ds_watch:"مدة المراقبة (د)",ds_ref:"مكافأة الإحالة"};
      DB.state[uid]={mode:"dev_setting",key:k};
      return edit(`✏️ أرسل القيمة الجديدة لـ *${lbl[k]}:*`,Markup.inlineKeyboard([[Markup.button.callback("❌","dev_settings")]]));
    }
  }

  if(data==="dev_stats"){ if(!isAdmin(uid))return; return showDevStats({callbackQuery:true,editMessageText:(t,o)=>ctx.editMessageText(t,o),from:ctx.from}); }

  if(data==="dev_logs"){
    if(!isAdmin(uid))return;
    let txt=`📜 *آخر ${Math.min(DB.logs.length,20)} أحداث:*\n\n`;
    DB.logs.slice(0,20).forEach(l=>{
      txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${(l.text||"").slice(0,50)}\n🕐 ${l.time}\n\n`;
    });
    return edit(txt||"لا سجلات.",Markup.inlineKeyboard([
      [Markup.button.callback("🗑 مسح","dev_clear_logs"),
       Markup.button.callback("📥 تصدير","dev_export_logs")],
      [Markup.button.callback("🔙 لوحة","dev_panel")]
    ]));
  }

  if(data==="dev_clear_logs"){ if(!isDev(uid))return; DB.logs=[]; return edit("✅ مُسح.",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }

  if(data==="dev_export_logs"){
    if(!isDev(uid))return;
    let txt="📜 سجل الأحداث:\n\n";
    DB.logs.forEach(l=>{ txt+=`[${l.time}] ${l.type} | ${l.uid} | ${l.text}\n`; });
    try{ await ctx.reply(`\`\`\`\n${txt.slice(0,4000)}\n\`\`\``,{parse_mode:"Markdown"}); }catch{}
    return;
  }

  if(data==="dev_users"){
    if(!isAdmin(uid))return;
    const users=Object.entries(DB.users);
    const banned=users.filter(([,u])=>u.banned).length;
    let txt=`👥 *الأعضاء (${users.length}):*\n🚫 ${banned} محظور\n\n`;
    users.slice(0,8).forEach(([id,u])=>{
      const b=u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
      txt+=`${b} *${u.name}* [\`${id}\`]\n@${u.username||"—"}\n`;
    });
    return edit(txt,Markup.inlineKeyboard([
      [Markup.button.callback("📋 قائمة كاملة","dev_users_list"),
       Markup.button.callback("🔍 بحث","dev_search_user")],
      [Markup.button.callback("🔙 لوحة","dev_panel")]
    ]));
  }

  if(data==="dev_users_list"){ if(!isAdmin(uid))return; return edit("*اختر عضواً:*",usersKb("dev_view_user")); }

  if(data.startsWith("dev_view_user:")){
    if(!isAdmin(uid))return;
    const tid=parseInt(data.split(":")[1]);
    const u=DB.users[tid];
    if(!u) return edit("❌ لم يُعثر.",backKb());
    return edit(
      `👤 *${u.name}*\n🆔 \`${tid}\`\n@${u.username||"—"}\n📅 ${u.joinedAt}\n` +
      `📧 ${(DB.emailHistory[tid]||[]).length} إيميل\n` +
      `🚫 ${u.banned?"محظور":"—"} | 🔇 ${u.muted?"مكتوم":"—"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(u.banned?"✅ رفع حظر":"🚫 حظر",u.banned?`dev_unban:${tid}`:`dev_ban:${tid}`),
         Markup.button.callback(u.muted?"🔊 رفع كتم":"🔇 كتم",u.muted?`dev_unmute:${tid}`:`dev_mute:${tid}`)],
        [Markup.button.callback("⭐ ترقية",`dev_promote:${tid}`),
         Markup.button.callback("⬇️ تخفيض",`dev_demote:${tid}`)],
        [Markup.button.callback("🔙 القائمة","dev_users_list")],
      ])
    );
  }

  // القروبات
  if(data==="dev_groups"){
    if(!isAdmin(uid))return;
    const groups=Object.entries(DB.groups);
    if(!groups.length) return edit("🏘 *لا توجد قروبات.*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]]));
    let txt=`🏘 *القروبات (${groups.length}):*\n\n`;
    groups.slice(0,10).forEach(([id,g])=>{ txt+=`📌 *${g.title}*\n🆔 \`${id}\`\n🕐 ${g.joinedAt}\n\n`; });
    const rows=groups.slice(0,8).map(([id,g])=>[Markup.button.callback(`🏘 ${g.title.slice(0,20)}`,`group_view:${id}`)]);
    rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
    return edit(txt,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("group_view:")){
    if(!isAdmin(uid))return;
    const gid=data.split(":")[1];
    const g=DB.groups[gid];
    if(!g) return edit("❌",backKb());
    return edit(`🏘 *${g.title}*\n🆔 \`${gid}\``,
      Markup.inlineKeyboard([
        [Markup.button.callback("📢 رسالة",`msg_group:${gid}`),
         Markup.button.callback("🔗 رابط",`group_link:${gid}`)],
        [Markup.button.callback("🗑 إزالة",`del_group:${gid}`)],
        [Markup.button.callback("🔙","dev_groups")],
      ])
    );
  }

  if(data.startsWith("msg_group:")){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"send_group_msg",gid:data.split(":")[1]};
    return edit("📢 أرسل الرسالة:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_groups")]]));
  }

  if(data.startsWith("group_link:")){
    if(!isAdmin(uid))return;
    try{
      const link=await bot.telegram.exportChatInviteLink(data.split(":")[1]);
      return edit(`🔗 *رابط الدعوة:*\n${link}`,backKb());
    }catch(e){
      return edit(`❌ فشل: ${e.message}`,backKb());
    }
  }

  if(data.startsWith("del_group:")){
    if(!isDev(uid))return;
    delete DB.groups[data.split(":")[1]];
    return edit("🗑 تم.",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_groups")]]));
  }

  // إدارة المسؤولين
  if(data==="dev_admins"){
    if(!isDev(uid))return;
    const admins=[...DB.admins].filter(a=>a!==DEV_ID);
    let txt=`🛡 *المسؤولون (${admins.length}):*\n\n`;
    admins.forEach(aid=>{
      const u=DB.users[aid];
      txt+=`⭐ *${u?.name||aid}* [\`${aid}\`]\n`;
    });
    if(!admins.length) txt+="لا يوجد مسؤولون.";
    const rows=admins.map(aid=>[[Markup.button.callback(`⭐ ${DB.users[aid]?.name||aid}`,`admin_manage:${aid}`)]]).flat();
    rows.push([Markup.button.callback("➕ إضافة","dev_promote")]);
    rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
    return edit(txt,Markup.inlineKeyboard(rows));
  }

  // تخصيص البوت
  if(data==="dev_customize"){
    if(!isDev(uid))return;
    return edit(
      `🤖 *تخصيص البوت*\n\n📛 الاسم: *${DB.settings.botName}*\n💬 الترحيب: _${DB.settings.welcomeMsg}_`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✏️ تغيير الاسم","change_bot_name")],
        [Markup.button.callback("💬 تغيير رسالة الترحيب","change_welcome")],
        [Markup.button.callback("📝 تغيير الوصف","change_bot_desc")],
        [Markup.button.callback("🔙 لوحة","dev_panel")],
      ])
    );
  }

  if(data==="change_bot_name"){ if(!isDev(uid))return; DB.state[uid]={mode:"change_bot_name"}; return edit("✏️ أرسل الاسم الجديد:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]])); }
  if(data==="change_welcome")  { if(!isDev(uid))return; DB.state[uid]={mode:"change_welcome"};  return edit("💬 أرسل رسالة الترحيب:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]])); }
  if(data==="change_bot_desc") { if(!isDev(uid))return; DB.state[uid]={mode:"change_bot_desc"}; return edit("📝 أرسل الوصف الجديد:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]])); }

  // إعلانات
  if(data==="dev_announce"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_announce"};
    return edit("📣 أرسل نص الإعلان:",Markup.inlineKeyboard([
      [Markup.button.callback("🗑 مسح الحالي","dev_clear_ann")],
      [Markup.button.callback("❌","dev_panel")]
    ]));
  }
  if(data==="dev_clear_ann"){ if(!isAdmin(uid))return; DB.announcements=[]; return edit("✅ تم مسح الإعلان.",devKb()); }

  // رسالة جماعية
  if(data==="dev_broadcast"){
    if(!hasPerm(uid,"broadcast"))return edit("❌ لا صلاحية.",backKb());
    DB.state[uid]={mode:"broadcast"};
    return edit("📢 أرسل الرسالة الجماعية:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]]));
  }

  // بحث عضو
  if(data==="dev_search_user"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_search"};
    return edit("🔍 أرسل ID أو اسم:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]]));
  }

  // إجراءات الأعضاء
  const acts=["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"];
  for(const act of acts){
    if(data===act){ if(!isAdmin(uid))return; return edit("*اختر عضواً:*",usersKb(act)); }
    if(data.startsWith(`${act}:`)){
      if(!isAdmin(uid))return;
      const tid=parseInt(data.split(":")[1]);
      if(!DB.users[tid]) DB.users[tid]={name:String(tid),username:"",joinedAt:stamp(),banned:false,muted:false,role:"user",lastSeen:"—",msgCount:0};
      let msg="";
      if(act==="dev_ban")    { if(!hasPerm(uid,"ban"))return; DB.users[tid].banned=true;  msg=`🚫 تم حظر \`${tid}\``; log("ban",uid,String(tid)); }
      if(act==="dev_unban")  { if(!hasPerm(uid,"ban"))return; DB.users[tid].banned=false; msg=`✅ رُفع حظر \`${tid}\``; log("unban",uid,String(tid)); }
      if(act==="dev_mute")   { if(!hasPerm(uid,"mute"))return; DB.users[tid].muted=true;   msg=`🔇 تم كتم \`${tid}\``; log("mute",uid,String(tid)); }
      if(act==="dev_unmute") { if(!hasPerm(uid,"mute"))return; DB.users[tid].muted=false;  msg=`🔊 رُفع كتم \`${tid}\``; log("unmute",uid,String(tid)); }
      if(act==="dev_promote"){ if(!isDev(uid))return; DB.admins.add(tid); DB.users[tid].role="admin"; msg=`⭐ ترقية \`${tid}\``; log("promote",uid,String(tid)); try{await bot.telegram.sendMessage(tid,"⭐ تمت ترقيتك لمسؤول!");}catch{} }
      if(act==="dev_demote") { if(!isDev(uid))return; DB.admins.delete(tid); delete DB.adminPerms[tid]; DB.users[tid].role="user"; msg=`⬇️ تخفيض \`${tid}\``; log("demote",uid,String(tid)); }
      try{ await bot.telegram.sendMessage(tid,`📢 إجراء: ${msg.replace(/`/g,"")}`); }catch{}
      return edit(msg,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
    }
  }

  if(data.startsWith("upage:")){ const[,act,pg]=data.split(":"); return edit("*اختر:*",usersKb(act,parseInt(pg))); }
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
      return ctx.reply(`❌ خطأ. حاول:\n\n🔢 *${n1} + ${n2} = ?*`,{parse_mode:"Markdown"});
    }
  }

  // فحص رابط
  if(st.mode==="vt_url"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري الفحص...*",{parse_mode:"Markdown"});
    const r = await vtScanUrl(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,malEngines}=r;
    const mal=stats.malicious||0,sus=stats.suspicious||0,clean=stats.harmless||0,undet=stats.undetected||0;
    const vd=mal>0?"🔴 *خطر!*":sus>0?"🟡 *مشبوه*":"🟢 *آمن*";
    const engTxt=malEngines?.length?`\n\n🚨 *كشف بواسطة:*\n${malEngines.join(", ")}`:"";
    return ctx.reply(
      `🔍 *نتيجة فحص الرابط*\n\n${vd}\n\n🔗 \`${text.slice(0,60)}\`\n\n` +
      `🔴 ضار: *${mal}* | 🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}* | ⬜ غير محدد: *${undet}*\n⭐ السمعة: *${reputation}*`+engTxt,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_domain"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الدومين...*",{parse_mode:"Markdown"});
    const domain=text.replace(/https?:\/\//,"").split("/")[0];
    const r=await vtScanDomain(domain);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,registrar,created,malEngines}=r;
    const mal=stats.malicious||0;
    return ctx.reply(
      `🌐 *فحص الدومين*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${domain}\`\n\n` +
      `🔴 ضار: *${mal}* | 🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${reputation}*\n🏢 ${registrar}\n📅 ${created}` +
      (malEngines?.length?`\n🚨 ${malEngines.join(", ")}`:""),
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_ip"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص IP...*",{parse_mode:"Markdown"});
    const r=await vtScanIp(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,country,asOwner,malEngines}=r;
    const mal=stats.malicious||0;
    return ctx.reply(
      `🖥 *فحص IP*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${text}\`\n🌍 ${country}\n🏢 ${asOwner}\n\n` +
      `🔴 *${mal}* | 🟢 *${stats.harmless||0}*\n⭐ *${reputation}*`+
      (malEngines?.length?`\n🚨 ${malEngines.join(", ")}`:""),
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // حفظ الإيميل
  if(st.mode==="save_email_label"){
    const {email,inboxId}=st;
    delete DB.state[uid];
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    DB.savedEmails[uid].push({email,inboxId,label:text,savedAt:stamp()});
    log("email_saved",uid,`${email} | ${text}`);
    return ctx.reply(`✅ *تم الحفظ!*\n\n📧 \`${email}\`\n🏷 *${text}*`,
      {parse_mode:"Markdown",...emailActiveKb(email,inboxId)});
  }

  // كلمات السر
  if(st.mode==="store_pass_platform"){
    const pass=st.pass; delete DB.state[uid];
    if(!DB.savedPasswords[uid]) DB.savedPasswords[uid]=[];
    DB.savedPasswords[uid].push({platform:text,password:pass,savedAt:stamp()});
    log("pass_saved",uid,text);
    return ctx.reply(`✅ *تم الحفظ!*\n\n🏷 *${text}*\n🔐 \`${pass}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="save_pass_custom"){
    DB.state[uid]={mode:"store_pass_platform",pass:text};
    return ctx.reply("✏️ اسم المنصة:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  // إعداد الحساب
  if(st.mode==="acc_email"){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply("❌ بريد غير صحيح.");
    delete DB.state[uid]; DB.users[uid].accountEmail=text;
    return ctx.reply(`✅ *تم ربط البريد:* \`${text}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="acc_pass"){
    if(text.length<6) return ctx.reply("❌ يجب 6 أحرف+.");
    delete DB.state[uid]; DB.users[uid].passwordHash=hashPass(text);
    return ctx.reply("✅ *تم تعيين كلمة السر!*",{parse_mode:"Markdown",...mainKb()});
  }

  // إعدادات الأرقام
  if(st.mode==="dev_setting"){
    if(!isAdmin(uid))return;
    const val=parseInt(text);
    if(isNaN(val)||val<1) return ctx.reply("❌ قيمة غير صحيحة.");
    if(st.key==="ds_max")   DB.settings.maxEmailsPerDay=val;
    if(st.key==="ds_cool")  DB.settings.cooldown=val;
    if(st.key==="ds_watch") DB.settings.emailWatchMin=val;
    if(st.key==="ds_ref")   DB.settings.refBonus=val;
    delete DB.state[uid];
    return ctx.reply("✅ تم التحديث.",devSettingsKb());
  }

  if(st.mode==="dev_announce"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    DB.announcements.unshift(text);
    if(DB.announcements.length>3) DB.announcements.pop();
    return ctx.reply("✅ تم النشر.",devKb());
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
      txt+=`👤 *${u.name}* [\`${id}\`]\n@${u.username||"—"}\n\n`;
    });
    const rows=found.slice(0,5).map(([id])=>[[Markup.button.callback(`👁 ${id}`,`dev_view_user:${id}`)]]).flat();
    rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
    return ctx.reply(txt,{parse_mode:"Markdown",...Markup.inlineKeyboard(rows)});
  }

  if(st.mode==="broadcast"){
    if(!hasPerm(uid,"broadcast"))return;
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

  if(st.mode==="send_group_msg"){
    if(!isAdmin(uid))return;
    const gid=st.gid; delete DB.state[uid];
    try{
      await bot.telegram.sendMessage(gid,`📢 *من الإدارة:*\n\n${text}`,{parse_mode:"Markdown"});
      return ctx.reply("✅ تم الإرسال.",devKb());
    }catch(e){ return ctx.reply(`❌ فشل: ${e.message}`,devKb()); }
  }

  if(st.mode==="change_bot_name"){
    if(!isDev(uid))return; delete DB.state[uid];
    DB.settings.botName=text;
    try{ await bot.telegram.setMyName(text); }catch{}
    return ctx.reply(`✅ تم تغيير الاسم: *${text}*`,{parse_mode:"Markdown",...devKb()});
  }

  if(st.mode==="change_welcome"){
    if(!isDev(uid))return; delete DB.state[uid];
    DB.settings.welcomeMsg=text;
    return ctx.reply("✅ تم تغيير رسالة الترحيب.",devKb());
  }

  if(st.mode==="change_bot_desc"){
    if(!isDev(uid))return; delete DB.state[uid];
    try{
      await bot.telegram.setMyDescription(text);
      return ctx.reply("✅ تم تغيير الوصف.",devKb());
    }catch(e){ return ctx.reply(`❌ فشل: ${e.message}`,devKb()); }
  }
});

// ===================== فحص الملفات =====================
bot.on(["document","photo","video","audio"], async ctx=>{
  const uid = ctx.from.id;
  if(!DB.sessions[uid]?.verified&&!isDev(uid)) return;

  const file =
    ctx.message.document ||
    (ctx.message.photo&&ctx.message.photo[ctx.message.photo.length-1]) ||
    ctx.message.video || ctx.message.audio;

  if(!file) return;
  const fileSize = file.file_size||0;
  if(fileSize>32*1024*1024) return ctx.reply("❌ الملف أكبر من 32MB.");

  const fname = file.file_name||`file_${Date.now()}`;
  const ext   = fname.split(".").pop()?.toLowerCase()||"";
  let fileType="📄 مستند";
  if(["jpg","jpeg","png","gif","webp"].includes(ext)) fileType="🖼 صورة";
  else if(["apk","exe","msi"].includes(ext)) fileType="📱 تطبيق";
  else if(["mp4","avi","mkv"].includes(ext)) fileType="🎬 فيديو";
  else if(["mp3","wav","ogg"].includes(ext)) fileType="🎵 صوت";
  else if(["pdf","doc","docx"].includes(ext)) fileType="📋 وثيقة";
  else if(["zip","rar","7z"].includes(ext)) fileType="📦 مضغوط";
  else if(["js","py","php","sh"].includes(ext)) fileType="💻 سكريبت";

  await ctx.reply(
    `🔍 *جاري فحص الملف...*\n\n${fileType}: \`${fname}\`\n📦 ${(fileSize/1024).toFixed(1)}KB\n\n⏳ الفحص بـ 70+ محرك...`,
    {parse_mode:"Markdown"}
  );

  try{
    const link   = await bot.telegram.getFileLink(file.file_id);
    const res    = await axios.get(link.href,{responseType:"arraybuffer",timeout:60000});
    const id     = await vtUploadFile(Buffer.from(res.data),fname);
    if(!id) return ctx.reply("❌ فشل رفع الملف.",mainKb());

    log("file_scan",uid,fname);
    await ctx.reply("⏳ *تم الرفع. جاري التحليل...*",{parse_mode:"Markdown"});

    const report = await vtGetAnalysis(id);
    if(!report) return ctx.reply("⌛ التحليل لم يكتمل. حاول لاحقاً.",mainKb());

    const stats=report.stats||{};
    const mal=stats.malicious||0,sus=stats.suspicious||0,clean=stats.harmless||0,undet=stats.undetected||0;
    const vd=mal>0?"🔴 *خطر!*":sus>0?"🟡 *مشبوه*":"🟢 *آمن*";
    const malEngines=Object.entries(report.results||{})
      .filter(([,v])=>v.category==="malicious").map(([k,v])=>`${k}: ${v.result||""}`).slice(0,8);

    return ctx.reply(
      `🔍 *نتيجة الفحص*\n\n${vd}\n\n${fileType}: \`${fname}\`\n\n` +
      `🔴 ضار: *${mal}*\n🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}*\n⬜ غير محدد: *${undet}*` +
      (malEngines.length?`\n\n🚨 *كشف بواسطة:*\n${malEngines.join("\n")}`:""),
      {parse_mode:"Markdown",...mainKb()}
    );
  }catch(e){
    console.error("vtFile:",e.message);
    return ctx.reply("❌ خطأ أثناء الفحص.",mainKb());
  }
});

// ===================== تشغيل =====================
console.log("🚀 البوت v4.0 — MailSlurp API");
bot.launch();
process.once("SIGINT",  ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
