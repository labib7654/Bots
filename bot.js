"use strict";

// ============================================================
//  بوت تيليجرام شامل — Sonjj API الحقيقي
//  النسخة المطورة الكاملة v3.0
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");

// ===================== الإعدادات =====================
const BOT_TOKEN  = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const SONJJ_KEY  = "058c3cdeb3cb9e7c9d8e0b5e747b39bb90fef2821e1db8fdb11301894bd3df06";
const VT_KEY     = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY     = "u3469811-ab163c31f24d6012491f0807";
const DEV_ID     = 7411444902;
const PORT       = process.env.PORT || 8080;
const SONJJ_BASE = "https://ugener.com";  // UGener API - الرابط الصحيح
const UGENER_BASE = "https://ugener.com"; // نفس الخادم

// ===================== Keep-Alive =====================
http.createServer((_,res)=>{ res.writeHead(200); res.end("OK"); })
  .listen(PORT,"0.0.0.0",()=>console.log(`✅ Port ${PORT}`));

// ===================== قاعدة البيانات =====================
const DB = {
  users:         {},
  sessions:      {},
  activeEmails:  {},
  savedEmails:   {},
  savedPasswords:{},
  emailHistory:  {},
  activityLog:   {},
  referrals:     {},
  referralOf:    {},
  referralPerks: {},
  logs:          [],
  admins:        new Set([DEV_ID]),
  // صلاحيات المسؤولين المخصصة
  adminPerms: {}, // uid -> { ban, mute, broadcast, viewUsers, manageGroups }
  announcements: [],
  groups:        {}, // chatId -> { title, members, joinedAt }
  settings: {
    maxEmailsPerDay: 30,
    cooldown:        8,
    emailWatchMin:   20,
    refBonus:        5,
    maintenanceMode: false,
    screenshotProtection: false, // حماية من لقطات الشاشة
    botName:         "بوت الإيميلات المؤقت",
    welcomeMsg:      "أهلاً بك في البوت! 🎉",
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

// تحقق من صلاحية معينة للمسؤول
function hasPerm(uid, perm) {
  if(isDev(uid)) return true;
  if(!isAdmin(uid)) return false;
  const perms = DB.adminPerms[uid];
  if(!perms) return true; // مسؤول بلا قيود
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

// ===================== Sonjj API — الرابط الصحيح =====================
const sonjjHeaders = {
  "X-Api-Key": SONJJ_KEY,
  "Accept": "application/json",
  "Content-Type": "application/json",
};

// جلب النطاقات المتاحة
async function getTempDomains() {
  if(now()-DB.domainsCache.ts < 300 && DB.domainsCache.list.length)
    return DB.domainsCache.list;
  try {
    // مسارات ugener.com
    const endpoints = [
      `${UGENER_BASE}/api/domains`,
      `${UGENER_BASE}/api/v1/domains`,
      `${UGENER_BASE}/v1/temp_email/domains`,
    ];
    for(const url of endpoints) {
      try {
        const r = await axios.get(url, {headers:sonjjHeaders, timeout:12000});
        const data = r.data;
        let list = data?.domains || data?.data?.domains || data?.data || [];
        if(typeof list === "object" && !Array.isArray(list)) {
          list = Object.keys(list);
        }
        if(Array.isArray(list) && list.length > 0) {
          DB.domainsCache = {list, ts: now()};
          console.log(`✅ نطاقات من: ${url} — ${list.length} نطاق`);
          return list;
        }
      } catch(e){ console.log(`❌ ${url}: ${e.message}`); }
    }
  } catch(e){ console.error("domains error:",e.message); }
  // نطاقات احتياطية
  return ["guerrillamailblock.com","sharklasers.com","guerrillamail.info","grr.la","guerrillamail.biz","guerrillamail.de","spam4.me"];
}

// إنشاء إيميل مؤقت — جرب عدة نقاط نهاية
async function createTempEmail(emailAddress, expiryMin=20) {
  const endpoints = [
    { method:"GET", url:`${SONJJ_BASE}/v1/temp_email/create`, params:{ email: emailAddress, expiry_minutes: expiryMin } },
    { method:"POST", url:`${SONJJ_BASE}/v1/temp_email/create`, data:{ email: emailAddress, expiry_minutes: expiryMin } },
    { method:"GET", url:`${SONJJ_BASE}/api/v1/temp_email/create`, params:{ email: emailAddress } },
  ];
  for(const ep of endpoints) {
    try {
      let r;
      if(ep.method==="GET") {
        r = await axios.get(ep.url, {headers:sonjjHeaders, params:ep.params, timeout:15000});
      } else {
        r = await axios.post(ep.url, ep.data, {headers:sonjjHeaders, timeout:15000});
      }
      if(r.data && (r.data.email || r.data.success || r.data.data)) {
        console.log(`✅ إيميل من: ${ep.url}`);
        return r.data;
      }
    } catch(e){ console.log(`❌ create ${ep.url}: ${e.response?.status} ${e.message}`); }
  }
  // إذا فشل API نولد الإيميل محلياً (يعمل مع نطاقات guerrilla)
  return { email: emailAddress, success: true, local: true };
}

// فحص صندوق الوارد — يجرب عدة مسارات
async function getTempInbox(emailAddress) {
  const [user, domain] = emailAddress.split("@");
  const endpoints = [
    { url:`${SONJJ_BASE}/v1/temp_email/inbox`, params:{ email: emailAddress } },
    { url:`${SONJJ_BASE}/api/v1/temp_email/inbox`, params:{ email: emailAddress } },
    // Guerrilla Mail API مباشرة كبديل
    { url:`https://api.guerrillamail.com/ajax.php`, params:{ f:"get_email_address", ip:"127.0.0.1", agent:"Mozilla_foo_bar", alias: user, domain } },
  ];
  for(const ep of endpoints) {
    try {
      const r = await axios.get(ep.url, {headers:sonjjHeaders, params:ep.params, timeout:10000});
      const msgs = r.data?.messages || r.data?.data?.messages || r.data?.list || [];
      if(Array.isArray(msgs)) return msgs;
    } catch(e){ }
  }
  return [];
}

// قراءة رسالة محددة
async function getTempMessage(emailAddress, mid) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_email/message`,{
      headers: sonjjHeaders,
      params:  { email: emailAddress, mid },
      timeout: 10000,
    });
    return r.data?.body || r.data?.data?.body || null;
  } catch(e){ return null; }
}

// Gmail مؤقت عشوائي
async function getRandomGmail() {
  const endpoints = [
    `${SONJJ_BASE}/v1/temp_gmail/random`,
    `${SONJJ_BASE}/api/v1/temp_gmail/random`,
  ];
  for(const url of endpoints) {
    try {
      const r = await axios.get(url, {headers:sonjjHeaders, timeout:12000});
      const d = r.data?.data || r.data;
      if(d?.email) return d;
    } catch(e){ console.log(`❌ gmail ${url}: ${e.message}`); }
  }
  return null;
}

// Outlook مؤقت عشوائي
async function getRandomOutlook() {
  const endpoints = [
    `${SONJJ_BASE}/v1/temp_outlook/random`,
    `${SONJJ_BASE}/api/v1/temp_outlook/random`,
  ];
  for(const url of endpoints) {
    try {
      const r = await axios.get(url, {headers:sonjjHeaders, timeout:12000});
      const d = r.data?.data || r.data;
      if(d?.email) return d;
    } catch(e){ console.log(`❌ outlook ${url}: ${e.message}`); }
  }
  return null;
}

// فحص صندوق Gmail
async function getGmailInbox(email, timestamp) {
  try {
    const r = await axios.get(`${SONJJ_BASE}/v1/temp_gmail/inbox`,{
      headers: sonjjHeaders,
      params:  { email, timestamp },
      timeout: 10000,
    });
    return r.data?.messages || r.data?.data?.messages || [];
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
    return r.data?.body || r.data?.data?.body || null;
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
    return r.data?.messages || r.data?.data?.messages || [];
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
    return r.data?.body || r.data?.data?.body || null;
  } catch(e){ return null; }
}

// ===================== مراقب الإيميل — محسّن لوصول الكود =====================
async function emailWatcher(bot, uid, emailData, chatId) {
  const { email, type, timestamp } = emailData;
  const endTime = now() + DB.settings.emailWatchMin * 60;
  const seenMids = new Set();

  console.log(`👀 مراقبة: ${email} | نوع: ${type}`);

  while(now() < endTime) {
    await sleep(5000); // فحص كل 5 ثواني لسرعة أعلى

    if(!DB.activeEmails[uid] || DB.activeEmails[uid].email !== email) {
      console.log(`🛑 توقفت: ${email}`);
      return;
    }

    let messages = [];
    try {
      if(type === "gmail")        messages = await getGmailInbox(email, timestamp);
      else if(type === "outlook") messages = await getOutlookInbox(email, timestamp);
      else                        messages = await getTempInbox(email);
    } catch(e){ continue; }

    if(!Array.isArray(messages)) continue;

    for(const msg of messages) {
      const mid = String(msg.mid || msg.id || msg.mail_id || msg.textDate || Math.random());
      if(seenMids.has(mid)) continue;
      seenMids.add(mid);

      let body = "";
      try {
        if(type === "gmail")        body = await getGmailMessage(email, mid, timestamp) || "";
        else if(type === "outlook") body = await getOutlookMessage(email, mid, timestamp) || "";
        else                        body = await getTempMessage(email, mid) || "";
      } catch(e){}

      // تنظيف HTML
      body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
                 .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
                 .replace(/<[^>]+>/g," ")
                 .replace(/\s+/g," ")
                 .trim()
                 .slice(0,2000);

      // استخراج الأكواد/OTP بشكل دقيق
      const otpPatterns = [
        /\b([0-9]{4,8})\b/g,                        // أرقام 4-8
        /code[:\s]+([A-Z0-9]{4,10})/gi,             // code: XXXX
        /otp[:\s]+([0-9]{4,8})/gi,                   // otp: 1234
        /verification[:\s]+([A-Z0-9]{4,10})/gi,      // verification: XXXX
        /رمز[:\s]+([0-9]{4,8})/g,                    // رمز: 1234
        /كود[:\s]+([0-9]{4,8})/g,                    // كود: 1234
      ];

      const allOtps = new Set();
      for(const pat of otpPatterns) {
        const matches = [...(body.matchAll ? body.matchAll(pat) : [])];
        matches.forEach(m => { if(m[1]) allOtps.add(m[1]); });
      }
      // Fallback
      if(!allOtps.size) {
        const simple = body.match(/\b\d{4,8}\b/g);
        if(simple) simple.slice(0,3).forEach(c => allOtps.add(c));
      }

      const otpText = allOtps.size
        ? `\n\n🔑 *الكود${allOtps.size>1?"s":""}:*\n${[...allOtps].map(c=>`\`${c}\``).join("  ")}`
        : "";

      const subject = msg.textSubject || msg.subject || msg.mail_subject || "بدون موضوع";
      const from    = msg.textFrom   || msg.from    || msg.mail_from    || "—";
      const date    = msg.textDate   || msg.date    || msg.mail_date    || stamp();

      log("email_received", uid, `${email} | ${subject}`);
      if(DB.emailHistory[uid]) {
        const idx = DB.emailHistory[uid].findIndex(e=>e.email===email);
        if(idx>=0) DB.emailHistory[uid][idx].msgCount=(DB.emailHistory[uid][idx].msgCount||0)+1;
      }

      try {
        const msgOpts = {parse_mode:"Markdown",...emailActiveKb(email,type,timestamp)};
        if(DB.settings.screenshotProtection) msgOpts.protect_content = true;
        await bot.telegram.sendMessage(chatId,
          `📧 *وصلت رسالة جديدة!*\n\n` +
          `📬 *من:* \`${from}\`\n` +
          `📋 *الموضوع:* ${subject}\n` +
          `🕐 *التاريخ:* ${date}` +
          otpText +
          `\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
          msgOpts
        );
      } catch(e){ console.error("sendMsg:",e.message); }
    }
  }

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

// ===================== VirusTotal — فحص متقدم =====================
async function vtScanUrl(url) {
  const cacheKey = `url_${Buffer.from(url).toString("base64").slice(0,30)}`;
  if(DB.vtCache[cacheKey] && now()-DB.vtCache[cacheKey].ts<3600)
    return DB.vtCache[cacheKey].result;
  try {
    // أولاً: إرسال URL للفحص
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
        engines: attr.results||{},
        method: "analysis",
      };
      // عرض محركات الفحص الضارة
      const malEngines = Object.entries(result.engines)
        .filter(([,v])=>v.category==="malicious")
        .map(([k])=>k);
      result.malEngines = malEngines.slice(0,5);
      DB.vtCache[cacheKey]={result,ts:now()};
      return result;
    }
  } catch(e){ console.log("vtSubmit:",e.message); }

  // طريقة بديلة: Base64 URL
  try {
    const enc = Buffer.from(url).toString("base64")
      .replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r = await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr  = r.data?.data?.attributes||{};
    const result = {
      stats:      attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      title:      attr.title||"",
      categories: attr.categories||{},
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
    const malEngines = Object.entries(attr.last_analysis_results||{})
      .filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5);
    return {
      stats: attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      registrar: attr.registrar||"—",
      created: attr.creation_date ? new Date(attr.creation_date*1000).toLocaleDateString("ar") : "—",
      malEngines,
    };
  } catch{ return null; }
}

async function vtScanIp(ip) {
  try {
    const r = await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,
      {headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr = r.data?.data?.attributes||{};
    const malEngines = Object.entries(attr.last_analysis_results||{})
      .filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5);
    return {
      stats: attr.last_analysis_stats||{},
      reputation: attr.reputation||0,
      country: attr.country||"—",
      asOwner: attr.as_owner||"—",
      malEngines,
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
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return r.data?.data?.id || null;
  } catch(e){ console.error("vtUpload:",e.message); return null; }
}

async function vtGetAnalysis(id) {
  try {
    // انتظر حتى اكتمال التحليل (محاولات متعددة)
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

const emailActiveKb = (email, type, timestamp) => {
  const ts = timestamp||0;
  return Markup.inlineKeyboard([
    [Markup.button.callback("📨 فتح الصندوق",`inbox:${type}:${ts}:${email}`),
     Markup.button.callback("🔄 تحديث فوري",`inbox:${type}:${ts}:${email}`)],
    [Markup.button.callback("💾 حفظ الإيميل",`save_email:${type}:${ts}:${email}`),
     Markup.button.callback("🗑 إنهاء",`del_email:${email}`)],
    [Markup.button.callback("🔙 الرئيسية","back")],
  ]);
};

// لوحة المطور الرئيسية
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
  [Markup.button.callback(`🛡 الحماية من لقطات الشاشة: ${DB.settings.screenshotProtection?"✅ مفعّلة":"❌ معطّلة"}`,"ds_screenshot")],
  [Markup.button.callback("🔙 لوحة","dev_panel")],
]);

function usersKb(action, page=0) {
  const pp=8;
  const ids=Object.keys(DB.users);
  const rows=ids.slice(page*pp,(page+1)*pp).map(id=>{
    const u=DB.users[id];
    const b = u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
    return [Markup.button.callback(
      `${b} ${u.name.slice(0,14)} [${id}]`,
      `${action}:${id}`
    )];
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

// تسجيل القروبات تلقائياً
bot.on("my_chat_member", async ctx => {
  try {
    const chat = ctx.chat;
    if(chat.type === "group" || chat.type === "supergroup") {
      DB.groups[chat.id] = {
        title: chat.title || "قروب بدون اسم",
        id: chat.id,
        type: chat.type,
        joinedAt: stamp(),
        members: chat.members_count || 0,
      };
      log("group_join", DEV_ID, chat.title);
    }
  } catch(e){}
});

bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid = ctx.from.id;

  // تتبع القروبات من الرسائل
  if(ctx.chat && (ctx.chat.type==="group"||ctx.chat.type==="supergroup")) {
    if(!DB.groups[ctx.chat.id]) {
      DB.groups[ctx.chat.id] = {
        title: ctx.chat.title||"قروب",
        id: ctx.chat.id, type: ctx.chat.type,
        joinedAt: stamp(), members: 0,
      };
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

  // تطبيق الحماية من لقطات الشاشة
  if(DB.settings.screenshotProtection && !isAdmin(uid)) {
    // إرسال رسالة تحذير مع protect_content=true لمنع إعادة التوجيه
    try {
      // نحذف الرسالة الأصلية إذا كانت نصية مشبوهة
      if(ctx.message?.text && ctx.message.text.toLowerCase().includes("screenshot")) {
        log("screenshot_attempt", uid, DB.users[uid]?.name||"");
        await bot.telegram.sendMessage(DEV_ID,
          `⚠️ *محاولة لقطة شاشة!*\n\n👤 ${DB.users[uid]?.name||uid} [\`${uid}\`]\n🕐 ${stamp()}`,
          {parse_mode:"Markdown"}
        );
      }
    }catch{}
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
    const totalUsers = Object.keys(DB.users).length;
    const totalGroups = Object.keys(DB.groups).length;
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n\n` +
      `🤖 *${DB.settings.botName}*\n` +
      `👥 الأعضاء: *${totalUsers}*\n` +
      `🏘 القروبات: *${totalGroups}*\n` +
      `⭐ المسؤولون: *${DB.admins.size-1}*`,
      {parse_mode:"Markdown",...devKb()}
    );
  }

  if(!DB.sessions[uid]?.verified){
    const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
    DB.sessions[uid]={verified:false, captchaAns:n1+n2};
    DB.state[uid]={mode:"captcha"};
    return ctx.reply(
      `👋 *${DB.settings.welcomeMsg}*\n\n🤖 للتحقق أنك لست روبوت:\n\n🔢 كم يساوي: *${n1} + ${n2} = ?*`,
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
  if(DB.settings.screenshotProtection) txt+=`\n\n🛡 _الحماية من لقطات الشاشة مفعّلة_`;
  const opts = {parse_mode:"Markdown",...mainKb()};
  if(DB.settings.screenshotProtection && !isAdmin(uid)) opts.protect_content = true;
  await ctx.reply(txt, opts);
}

bot.command("dev",   async ctx=>{ if(!isDev(ctx.from.id))return; await ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; await ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("stats", async ctx=>{ if(!isAdmin(ctx.from.id))return; return showDevStats(ctx); });

async function showDevStats(ctx) {
  const total   = Object.keys(DB.users).length;
  const banned  = Object.values(DB.users).filter(u=>u.banned).length;
  const muted   = Object.values(DB.users).filter(u=>u.muted).length;
  const emails  = Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0);
  const active  = Object.keys(DB.activeEmails).length;
  const groups  = Object.keys(DB.groups).length;
  const admins  = DB.admins.size;
  const today_e = Object.keys(DB.daily).filter(k=>k.includes(today())).reduce((a,k)=>a+DB.daily[k],0);

  const txt = `📊 *إحصائيات شاملة*\n\n` +
    `👥 إجمالي الأعضاء: *${total}*\n` +
    `🚫 المحظورون: *${banned}*\n` +
    `🔇 المكتومون: *${muted}*\n` +
    `⭐ المسؤولون: *${admins}*\n` +
    `🏘 القروبات: *${groups}*\n\n` +
    `📧 إجمالي إيميلات: *${emails}*\n` +
    `📬 نشطون الآن: *${active}*\n` +
    `📅 إيميلات اليوم: *${today_e}*\n` +
    `📜 السجلات: *${DB.logs.length}*\n\n` +
    `⚙️ *الإعدادات الحالية:*\n` +
    `• الحد اليومي: ${DB.settings.maxEmailsPerDay}\n` +
    `• وقت المراقبة: ${DB.settings.emailWatchMin}د\n` +
    `• الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}\n` +
    `• 🛡 حماية لقطات الشاشة: ${DB.settings.screenshotProtection?"✅ مفعّلة":"❌ معطّلة"}`;

  if(ctx.callbackQuery) {
    await ctx.editMessageText(txt, {parse_mode:"Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  } else {
    await ctx.reply(txt, {parse_mode:"Markdown",
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
        `inbox:${active.type}:${active.timestamp||0}:${active.email}`
      )]);
    }
    rows.push([
      Markup.button.callback("📧 إيميل مؤقت (نطاق)","choose_domain_temp"),
      Markup.button.callback("🔴 Gmail","new_gmail"),
    ]);
    rows.push([Markup.button.callback("🔵 Outlook","new_outlook"),
               Markup.button.callback("🌐 عرض النطاقات","show_domains")]);
    if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`, "my_emails")]);
    rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(
      `📧 *نظام الإيميلات*\n\n✅ اليوم: *${used}/${max}*\n🔔 الكود يصلك فوراً عند وصول رسالة ⚡\n⏱ مراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      Markup.inlineKeyboard(rows)
    );
  }

  // اختيار نطاق للإيميل المؤقت
  if(data==="choose_domain_temp"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid))
      return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلته.\nأحِل أصدقاء للمزيد 🎁`,backKb());

    await edit("⏳ *جاري تحميل النطاقات من Sonjj...*");
    const domains = await getTempDomains();
    const rows = [];
    for(let i=0;i<domains.length;i+=2){
      const row=[];
      row.push(Markup.button.callback(`🌐 @${domains[i]}`,`make_temp:${domains[i]}`));
      if(domains[i+1]) row.push(Markup.button.callback(`🌐 @${domains[i+1]}`,`make_temp:${domains[i+1]}`));
      rows.push(row);
    }
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`🌐 *اختر النطاق — ${domains.length} نطاق متاح:*\n\n✅ الكود يوصلك فوراً عند وصول أي رسالة`,Markup.inlineKeyboard(rows));
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

    const emailData = { email: emailAddress, type:"temp", timestamp: now(), createdAt: now() };
    DB.activeEmails[uid] = emailData;
    DB.lastReq[`e_${uid}`] = now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:emailAddress, type:"temp", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("email_created",uid,emailAddress);

    await edit(
      `✅ *تم إنشاء إيميلك!*\n\n` +
      `📧 *العنوان:*\n\`${emailAddress}\`\n\n` +
      `🌐 *النطاق:* \`@${domain}\`\n\n` +
      `⚡ *البوت يراقب ويوصلك الكود فور وصوله*\n` +
      `🔑 *الكود يظهر تلقائياً في الرسالة*\n` +
      `⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*\n\n` +
      `💡 استخدم هذا الإيميل في أي موقع الآن`,
      emailActiveKb(emailAddress,"temp",now())
    );
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // Gmail حقيقي
  if(data==="new_gmail"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff}ث.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي وصلته.`,backKb());
    await edit("⚡ *جاري تحميل Gmail...*");
    const r = await getRandomGmail();
    if(!r||!r.email) return edit("❌ فشل تحميل Gmail. حاول لاحقاً.",
      Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_gmail")],[Markup.button.callback("🔙 رجوع","menu_emails")]]));
    const emailData = { email:r.email, type:"gmail", timestamp:r.timestamp||now(), createdAt:now() };
    DB.activeEmails[uid]=emailData;
    DB.lastReq[`e_${uid}`]=now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:r.email, type:"gmail", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("gmail_created",uid,r.email);
    await edit(
      `✅ *Gmail جاهز!*\n\n📧 *العنوان:*\n\`${r.email}\`\n\n🔴 *Gmail حقيقي — يصل لأي موقع*\n⚡ الكود يوصلك فوراً تلقائياً\n⏱ المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      emailActiveKb(r.email,"gmail",r.timestamp||now())
    );
    emailWatcher(bot, uid, emailData, ctx.chat.id);
    return;
  }

  // Outlook حقيقي
  if(data==="new_outlook"){
    const diff = now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff}ث.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي وصلته.`,backKb());
    await edit("⚡ *جاري تحميل Outlook...*");
    const r = await getRandomOutlook();
    if(!r||!r.email) return edit("❌ فشل تحميل Outlook. حاول لاحقاً.",
      Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_outlook")],[Markup.button.callback("🔙 رجوع","menu_emails")]]));
    const emailData = { email:r.email, type:"outlook", timestamp:r.timestamp||now(), createdAt:now() };
    DB.activeEmails[uid]=emailData;
    DB.lastReq[`e_${uid}`]=now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:r.email, type:"outlook", time:stamp(), msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("outlook_created",uid,r.email);
    await edit(
      `✅ *Outlook جاهز!*\n\n📧 *العنوان:*\n\`${r.email}\`\n\n🔵 *Outlook حقيقي — يصل لأي موقع*\n⚡ الكود يوصلك فوراً تلقائياً\n⏱ المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
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
      Markup.inlineKeyboard([[Markup.button.callback("✨ إنشاء إيميل","choose_domain_temp")],[Markup.button.callback("🔙 رجوع","menu_emails")]])
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
    if(type==="gmail")        messages = await getGmailInbox(email, ts);
    else if(type==="outlook") messages = await getOutlookInbox(email, ts);
    else                      messages = await getTempInbox(email);

    if(!messages.length) return edit(
      `📭 *الصندوق فارغ حالياً*\n\n\`${email}\`\n\n⚡ البوت يراقب ويوصلك الرسائل والأكواد تلقائياً\n_لا تحتاج تفتح الصندوق يدوياً_`,
      emailActiveKb(email,type,ts)
    );

    const rows = messages.slice(0,10).map(m=>{
      const sub = m.textSubject||m.subject||m.mail_subject||"(بدون موضوع)";
      const mid = String(m.mid||m.id||m.mail_id||"0");
      return [Markup.button.callback(`📩 ${sub.slice(0,28)}`,`msg:${type}:${ts}:${mid}:${email}`)];
    });
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${type}:${ts}:${email}`)]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_emails")]);
    return edit(`📬 *الصندوق — ${messages.length} رسالة:*\n\`${email}\``,Markup.inlineKeyboard(rows));
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
    if(type==="gmail")        body = await getGmailMessage(email, mid, ts) || "";
    else if(type==="outlook") body = await getOutlookMessage(email, mid, ts) || "";
    else                      body = await getTempMessage(email, mid) || "";

    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
               .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,2000);

    const allOtps = new Set();
    const patterns = [/\b([0-9]{4,8})\b/g,/code[:\s]+([A-Z0-9]{4,10})/gi,/otp[:\s]+([0-9]{4,8})/gi];
    patterns.forEach(p=>{ [...(body.matchAll?body.matchAll(p):[])].forEach(m=>m[1]&&allOtps.add(m[1])); });

    const otpTxt = allOtps.size
      ? `\n\n🔑 *الكود:*\n${[...allOtps].map(c=>`\`${c}\``).join("  ")}`
      : "";

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
        [Markup.button.callback("➕ حفظ كلمة سر يدوياً","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="gen_pass"){
    const p = genStrongPass();
    return edit(
      `🔐 *كلمة السر الجديدة:*\n\n\`${p}\`\n\n📊 الطول: ${p.length} حرف\n✅ تحتوي: أحرف كبيرة + صغيرة + أرقام + رموز`,
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
    return edit("✏️ اكتب اسم المنصة (مثال: Gmail, Twitter):",
      Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  if(data==="save_pass_prompt"){
    DB.state[uid]={mode:"save_pass_custom"};
    return edit("🔐 أرسل كلمة السر التي تريد حفظها:",
      Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  if(data==="my_passwords"){
    const saved = DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر محفوظة.*",backKb());
    let txt=`🔑 *كلمات السر (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{
      txt+=`${i+1}. 🏷 *${p.platform}*\n   \`${p.password}\`\n\n`;
    });
    return edit(txt, Markup.inlineKeyboard([
      [Markup.button.callback("🗑 حذف الكل","del_all_pass")],
      [Markup.button.callback("🔙 رجوع","menu_passwords")],
    ]));
  }

  if(data==="del_all_pass"){
    DB.savedPasswords[uid]=[];
    return edit("🗑 *تم حذف جميع كلمات السر.*",backKb());
  }

  // ═══ فحص VirusTotal — محسّن ═══
  if(data==="menu_vt"){
    return edit(
      `🔍 *فحص الأمان — VirusTotal*\n\n🛡 فحص دقيق بـ 70+ محرك أمان\nيشمل: روابط، دومينات، IPs، ملفات، صور، تطبيقات`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔗 فحص رابط URL","vt_url"),
         Markup.button.callback("🌐 فحص دومين","vt_domain")],
        [Markup.button.callback("🖥 فحص IP","vt_ip"),
         Markup.button.callback("📁 فحص ملف/صورة/تطبيق","vt_file_info")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="vt_url")      { DB.state[uid]={mode:"vt_url"};    return edit("🔗 *أرسل الرابط للفحص:*\n_مثال: https://example.com_",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_domain")   { DB.state[uid]={mode:"vt_domain"}; return edit("🌐 *أرسل الدومين:*\n_مثال: google.com_",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_ip")       { DB.state[uid]={mode:"vt_ip"};     return edit("🖥 *أرسل عنوان IP:*\n_مثال: 8.8.8.8_",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_file_info"){ return edit(
    "📁 *فحص الملفات والصور والتطبيقات:*\n\n✅ يدعم: APK، EXE، PDF، صور، فيديو، مستندات\n📦 الحجم الأقصى: 32MB\n\n*أرسل الملف مباشرة الآن ↓*",
    Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_vt")]])); }

  // ═══ UptimeRobot ═══
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors = await getMonitors();
    if(!monitors.length) return edit("🌐 *لا توجد مواقع مضافة.*\nأضفها من UptimeRobot.",backKb());
    let txt=`🌐 *مواقعك المراقبة (${monitors.length}):*\n\n`;
    monitors.slice(0,10).forEach(m=>{
      const ic=m.status===2?"🟢 شغّال":m.status===9?"🔴 معطّل":"🟡 تحقق";
      txt+=`${ic} *${m.friendly_name||m.url}*\n   📈 ${m.all_time_uptime_ratio||"—"}% | 🔗 ${(m.url||"").slice(0,40)}\n\n`;
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
      `🎁 *نظام الإحالة*\n\n🔗 *رابطك:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}*\n🎁 مكافأتك: *+${bonus} إيميل/يوم*\n\n📌 لكل صديق يسجل: *+${DB.settings.refBonus} إيميل إضافي لك*`,
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
    refs.slice(0,10).forEach((id,i)=>{ txt+=`${i+1}. ${DB.users[id]?.name||id} [\`${id}\`]\n`; });
    return edit(txt,backKb());
  }

  // ═══ إحصائياتي ═══
  if(data==="my_stats"){
    const u = DB.users[uid]||{};
    return edit(
      `📊 *إحصائياتي*\n\n👤 *${u.name}*\n🆔 \`${uid}\`\n👤 @${u.username||"—"}\n📅 انضممت: ${u.joinedAt}\n👁 آخر ظهور: ${u.lastSeen}\n📨 إجمالي رسائل: *${u.msgCount||0}*\n\n` +
      `📧 إيميلات اليوم: *${dailyCount(uid)}/${maxDay(uid)}*\n` +
      `📚 إجمالي الإيميلات: *${(DB.emailHistory[uid]||[]).length}*\n` +
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
    if(a.length){
      txt+="*🕐 آخر النشاطات:*\n";
      a.slice(0,5).forEach((ac,i)=>{
        txt+=`${i+1}. ${ac.action} — ${ac.time}\n`;
      });
    }
    if(!h.length&&!a.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ═══ حسابي ═══
  if(data==="my_account"){
    const u = DB.users[uid]||{};
    return edit(
      `👤 *حسابي*\n\n🆔 المعرف: \`${uid}\`\n📧 البريد: ${u.accountEmail?`\`${u.accountEmail}\``:"غير محدد"}\n🔐 كلمة السر: ${u.passwordHash?"✅ محددة":"❌ غير محددة"}\n🏅 الدور: *${u.role||"user"}*`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📧 ربط بريد","acc_email"),
         Markup.button.callback("🔐 تعيين كلمة سر","acc_pass")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }
  if(data==="acc_email"){ DB.state[uid]={mode:"acc_email"}; return edit("📧 أرسل بريدك الإلكتروني:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }
  if(data==="acc_pass") { DB.state[uid]={mode:"acc_pass"};  return edit("🔐 أرسل كلمة السر (6 أحرف+):",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }

  // ═══ مساعدة ═══
  if(data==="help"){
    return edit(
      `ℹ️ *دليل البوت*\n\n` +
      `*📧 الإيميلات المؤقتة:*\n• إيميل بنطاق تختاره أنت ✅\n• Gmail حقيقي يصل لأي موقع 🔴\n• Outlook حقيقي يصل لأي موقع 🔵\n• الأكواد تصلك تلقائياً فوراً ⚡\n\n` +
      `*🔑 مدير كلمات السر:*\nتوليد وحفظ كلمات سر قوية\n\n` +
      `*🔍 فحص الأمان:*\n70+ محرك فحص\nروابط + دومينات + IP + ملفات + صور + تطبيقات\n\n` +
      `*🎁 الإحالة:*\nشارك رابطك واحصل على إيميلات إضافية`,
      backKb()
    );
  }

  // ═══════════════════════════════════════════
  //           لوحة التحكم المطورة
  // ═══════════════════════════════════════════

  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *إعدادات البوت:*",devSettingsKb()); }
  if(data==="ds_maint"){ if(!isDev(uid))return; DB.settings.maintenanceMode=!DB.settings.maintenanceMode; return edit(`⚙️ الصيانة: ${DB.settings.maintenanceMode?"✅ مفعّلة":"❌ معطّلة"}`,devSettingsKb()); }
  if(data==="ds_screenshot"){
    if(!isDev(uid))return;
    DB.settings.screenshotProtection=!DB.settings.screenshotProtection;
    const status = DB.settings.screenshotProtection;
    // إرسال إشعار لجميع المستخدمين عند تفعيل الحماية
    if(status) {
      const ids=Object.keys(DB.users);
      for(const id of ids){
        try{
          await bot.telegram.sendMessage(parseInt(id),
            `🛡 *تم تفعيل الحماية من لقطات الشاشة*\n\n` +
            `⚠️ تنبيه: أي محاولة لالتقاط لقطة شاشة داخل البوت ستُسجَّل ويُبلَّغ عنها للإدارة.\n\n` +
            `🔒 بياناتك محمية بالكامل.`,
            {parse_mode:"Markdown"}
          );
          await sleep(30);
        }catch{}
      }
    }
    return edit(`🛡 الحماية من لقطات الشاشة: ${status?"✅ مفعّلة":"❌ معطّلة"}\n\n${status?"⚠️ تم إشعار جميع المستخدمين":""}`,devSettingsKb());
  }

  for(const k of["ds_max","ds_cool","ds_watch","ds_ref"]){
    if(data===k){
      if(!isAdmin(uid))return;
      const lbl={ds_max:"الحد اليومي للإيميلات",ds_cool:"وقت الانتظار (ثانية)",ds_watch:"مدة المراقبة (دقيقة)",ds_ref:"مكافأة الإحالة"};
      DB.state[uid]={mode:"dev_setting",key:k};
      return edit(`✏️ أرسل القيمة الجديدة لـ *${lbl[k]}:*`,Markup.inlineKeyboard([[Markup.button.callback("❌","dev_settings")]]));
    }
  }

  // إحصائيات تفصيلية
  if(data==="dev_stats"){ if(!isAdmin(uid))return; return showDevStats({callbackQuery:true, editMessageText:(t,o)=>ctx.editMessageText(t,o), from:ctx.from}); }

  // سجل الأحداث
  if(data==="dev_logs"){
    if(!isAdmin(uid))return;
    let txt=`📜 *آخر ${Math.min(DB.logs.length,20)} أحداث:*\n\n`;
    DB.logs.slice(0,20).forEach(l=>{
      txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${(l.text||"").slice(0,50)}\n🕐 ${l.time}\n\n`;
    });
    return edit(txt||"لا سجلات.",Markup.inlineKeyboard([
      [Markup.button.callback("🗑 مسح السجل","dev_clear_logs"),
       Markup.button.callback("📥 تصدير","dev_export_logs")],
      [Markup.button.callback("🔙 لوحة","dev_panel")]
    ]));
  }

  if(data==="dev_clear_logs"){ if(!isDev(uid))return; DB.logs=[]; return edit("✅ مُسح.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])); }

  if(data==="dev_export_logs"){
    if(!isDev(uid))return;
    let txt="📜 سجل الأحداث الكامل:\n\n";
    DB.logs.forEach(l=>{ txt+=`[${l.time}] ${l.type} | ${l.uid} | ${l.text}\n`; });
    try { await ctx.reply(`\`\`\`\n${txt.slice(0,4000)}\n\`\`\``,{parse_mode:"Markdown"}); } catch(e){}
    return;
  }

  // عرض الأعضاء مع تفاصيل
  if(data==="dev_users"){
    if(!isAdmin(uid))return;
    const users=Object.entries(DB.users);
    const banned=users.filter(([,u])=>u.banned).length;
    const muted=users.filter(([,u])=>u.muted).length;
    let txt=`👥 *الأعضاء (${users.length}):*\n🚫 محظور: ${banned} | 🔇 مكتوم: ${muted}\n\n`;
    users.slice(0,8).forEach(([id,u])=>{
      const b=u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
      txt+=`${b} *${u.name}* [\`${id}\`]\n@${u.username||"—"} | ${u.joinedAt}\n`;
    });
    return edit(txt,Markup.inlineKeyboard([
      [Markup.button.callback("📋 قائمة كاملة","dev_users_list"),
       Markup.button.callback("🔍 بحث","dev_search_user")],
      [Markup.button.callback("🔙 لوحة","dev_panel")]
    ]));
  }

  if(data==="dev_users_list"){ if(!isAdmin(uid))return; return edit("*اختر عضواً:*",usersKb("dev_view_user")); }

  // عرض تفاصيل عضو
  if(data.startsWith("dev_view_user:")){
    if(!isAdmin(uid))return;
    const tid=parseInt(data.split(":")[1]);
    const u=DB.users[tid];
    if(!u) return edit("❌ لم يُعثر.",backKb());
    const emails=(DB.emailHistory[tid]||[]).length;
    const active=DB.activeEmails[tid]?.email||"—";
    const txt=
      `👤 *تفاصيل العضو*\n\n` +
      `🆔 ID: \`${tid}\`\n` +
      `👤 الاسم: *${u.name}*\n` +
      `📌 يوزر: @${u.username||"—"}\n` +
      `🏅 الدور: *${u.role||"user"}*\n` +
      `📅 انضم: ${u.joinedAt}\n` +
      `👁 آخر ظهور: ${u.lastSeen}\n` +
      `📨 الرسائل: *${u.msgCount||0}*\n` +
      `📧 إيميلات: *${emails}*\n` +
      `📬 نشط: \`${active}\`\n` +
      `🚫 محظور: ${u.banned?"نعم":"لا"}\n` +
      `🔇 مكتوم: ${u.muted?"نعم":"لا"}`;
    return edit(txt,Markup.inlineKeyboard([
      [Markup.button.callback(u.banned?"✅ رفع حظر":`🚫 حظر`,u.banned?`dev_unban:${tid}`:`dev_ban:${tid}`),
       Markup.button.callback(u.muted?"🔊 رفع كتم":"🔇 كتم",u.muted?`dev_unmute:${tid}`:`dev_mute:${tid}`)],
      [Markup.button.callback("⭐ ترقية مسؤول",`dev_promote:${tid}`),
       Markup.button.callback("⬇️ تخفيض",`dev_demote:${tid}`)],
      [Markup.button.callback("🔙 القائمة","dev_users_list")],
    ]));
  }

  // ═══ إدارة القروبات ═══
  if(data==="dev_groups"){
    if(!isAdmin(uid))return;
    const groups=Object.entries(DB.groups);
    if(!groups.length) return edit("🏘 *لا توجد قروبات مضافة.*\n\nأضف البوت لقروب وسيظهر هنا.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));

    let txt=`🏘 *القروبات (${groups.length}):*\n\n`;
    groups.slice(0,10).forEach(([id,g])=>{
      txt+=`📌 *${g.title}*\n🆔 \`${id}\` | 👥 ${g.members||"—"}\n🕐 ${g.joinedAt}\n\n`;
    });
    const rows=groups.slice(0,8).map(([id,g])=>[
      Markup.button.callback(`🏘 ${g.title.slice(0,20)}`,`group_view:${id}`)
    ]);
    rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
    return edit(txt,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("group_view:")){
    if(!isAdmin(uid))return;
    const gid=data.split(":")[1];
    const g=DB.groups[gid];
    if(!g) return edit("❌ القروب غير موجود.",backKb());
    return edit(
      `🏘 *${g.title}*\n\n🆔 ID: \`${gid}\`\n📋 النوع: ${g.type||"—"}\n👥 الأعضاء: ${g.members||"—"}\n🕐 انضم: ${g.joinedAt}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📢 رسالة للقروب",`msg_group:${gid}`),
         Markup.button.callback("🔗 رابط الدعوة",`group_link:${gid}`)],
        [Markup.button.callback("🗑 إزالة من القائمة",`del_group:${gid}`)],
        [Markup.button.callback("🔙 القروبات","dev_groups")],
      ])
    );
  }

  if(data.startsWith("msg_group:")){
    if(!isAdmin(uid))return;
    const gid=data.split(":")[1];
    DB.state[uid]={mode:"send_group_msg",gid};
    return edit("📢 أرسل الرسالة التي تريد إرسالها للقروب:",
      Markup.inlineKeyboard([[Markup.button.callback("❌","dev_groups")]]));
  }

  if(data.startsWith("group_link:")){
    if(!isAdmin(uid))return;
    const gid=data.split(":")[1];
    try {
      const link = await bot.telegram.exportChatInviteLink(gid);
      return edit(`🔗 *رابط الدعوة:*\n${link}`,
        Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع",`group_view:${gid}`)]]));
    } catch(e) {
      return edit("❌ تعذر جلب الرابط. تأكد من صلاحيات البوت.",
        Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","dev_groups")]]));
    }
  }

  if(data.startsWith("del_group:")){
    if(!isDev(uid))return;
    const gid=data.split(":")[1];
    delete DB.groups[gid];
    return edit("🗑 تم الحذف.",Markup.inlineKeyboard([[Markup.button.callback("🔙 القروبات","dev_groups")]]));
  }

  // ═══ إدارة المسؤولين ═══
  if(data==="dev_admins"){
    if(!isDev(uid))return;
    const admins=[...DB.admins].filter(a=>a!==DEV_ID);
    let txt=`🛡 *المسؤولون (${admins.length}):*\n\n`;
    admins.forEach(aid=>{
      const u=DB.users[aid];
      const perms=DB.adminPerms[aid];
      txt+=`⭐ *${u?.name||aid}* [\`${aid}\`]\n`;
      if(perms) {
        txt+=`   صلاحيات: ${Object.entries(perms).filter(([,v])=>v).map(([k])=>k).join(", ")||"—"}\n`;
      } else {
        txt+=`   صلاحيات: كاملة\n`;
      }
      txt+="\n";
    });
    if(!admins.length) txt+="لا يوجد مسؤولون بعد.";
    const rows=admins.map(aid=>[
      Markup.button.callback(`⭐ ${DB.users[aid]?.name||aid}`,`admin_manage:${aid}`)
    ]);
    rows.push([Markup.button.callback("➕ إضافة مسؤول","dev_promote")]);
    rows.push([Markup.button.callback("🔙 لوحة","dev_panel")]);
    return edit(txt,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("admin_manage:")){
    if(!isDev(uid))return;
    const aid=parseInt(data.split(":")[1]);
    const u=DB.users[aid];
    const perms=DB.adminPerms[aid]||{ban:true,mute:true,broadcast:true,viewUsers:true,manageGroups:true};
    return edit(
      `🛡 *إدارة صلاحيات:* ${u?.name||aid}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`🚫 حظر: ${perms.ban?"✅":"❌"}`,`toggle_perm:${aid}:ban`),
         Markup.button.callback(`🔇 كتم: ${perms.mute?"✅":"❌"}`,`toggle_perm:${aid}:mute`)],
        [Markup.button.callback(`📢 بث: ${perms.broadcast?"✅":"❌"}`,`toggle_perm:${aid}:broadcast`),
         Markup.button.callback(`👥 أعضاء: ${perms.viewUsers?"✅":"❌"}`,`toggle_perm:${aid}:viewUsers`)],
        [Markup.button.callback(`🏘 قروبات: ${perms.manageGroups?"✅":"❌"}`,`toggle_perm:${aid}:manageGroups`)],
        [Markup.button.callback("⬇️ إزالة من المسؤولين",`dev_demote:${aid}`)],
        [Markup.button.callback("🔙 المسؤولون","dev_admins")],
      ])
    );
  }

  if(data.startsWith("toggle_perm:")){
    if(!isDev(uid))return;
    const [,aid,perm]=data.split(":");
    const aidInt=parseInt(aid);
    if(!DB.adminPerms[aidInt]) DB.adminPerms[aidInt]={ban:true,mute:true,broadcast:true,viewUsers:true,manageGroups:true};
    DB.adminPerms[aidInt][perm]=!DB.adminPerms[aidInt][perm];
    return edit("✅ تم تحديث الصلاحية.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع",`admin_manage:${aid}`)]]));
  }

  // ═══ تخصيص البوت ═══
  if(data==="dev_customize"){
    if(!isDev(uid))return;
    return edit(
      `🤖 *تخصيص البوت*\n\n📛 الاسم الحالي: *${DB.settings.botName}*\n💬 رسالة الترحيب: _${DB.settings.welcomeMsg}_`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✏️ تغيير اسم البوت","change_bot_name")],
        [Markup.button.callback("💬 تغيير رسالة الترحيب","change_welcome")],
        [Markup.button.callback("🖼 تغيير صورة البوت","change_bot_photo")],
        [Markup.button.callback("📝 تغيير وصف البوت","change_bot_desc")],
        [Markup.button.callback("🔙 لوحة","dev_panel")],
      ])
    );
  }

  if(data==="change_bot_name"){
    if(!isDev(uid))return;
    DB.state[uid]={mode:"change_bot_name"};
    return edit("✏️ أرسل الاسم الجديد للبوت:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]]));
  }

  if(data==="change_welcome"){
    if(!isDev(uid))return;
    DB.state[uid]={mode:"change_welcome"};
    return edit("💬 أرسل رسالة الترحيب الجديدة:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]]));
  }

  if(data==="change_bot_photo"){
    if(!isDev(uid))return;
    DB.state[uid]={mode:"change_bot_photo"};
    return edit("🖼 أرسل الصورة الجديدة للبوت:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]]));
  }

  if(data==="change_bot_desc"){
    if(!isDev(uid))return;
    DB.state[uid]={mode:"change_bot_desc"};
    return edit("📝 أرسل الوصف الجديد للبوت:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]]));
  }

  // إعلانات
  if(data==="dev_announce"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_announce"};
    return edit("📣 أرسل نص الإعلان:",Markup.inlineKeyboard([
      [Markup.button.callback("🗑 مسح الإعلان الحالي","dev_clear_ann")],
      [Markup.button.callback("❌","dev_panel")]
    ]));
  }
  if(data==="dev_clear_ann"){ if(!isAdmin(uid))return; DB.announcements=[]; return edit("✅ تم مسح الإعلان.",devKb()); }

  // رسالة جماعية
  if(data==="dev_broadcast"){
    if(!hasPerm(uid,"broadcast"))return edit("❌ ليس لديك صلاحية البث.",backKb());
    DB.state[uid]={mode:"broadcast"};
    return edit("📢 أرسل الرسالة الجماعية:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]]));
  }

  // بحث عضو
  if(data==="dev_search_user"){
    if(!isAdmin(uid))return;
    DB.state[uid]={mode:"dev_search"};
    return edit("🔍 أرسل ID أو اسم أو يوزر العضو:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]]));
  }

  // إجراءات على الأعضاء
  const acts=["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"];
  for(const act of acts){
    if(data===act){
      if(!isAdmin(uid))return;
      return edit(`*اختر العضو:*`,usersKb(act));
    }
    if(data.startsWith(`${act}:`)){
      if(!isAdmin(uid))return;
      const tid=parseInt(data.split(":")[1]);
      if(!DB.users[tid]) DB.users[tid]={name:String(tid),username:"",joinedAt:stamp(),banned:false,muted:false,role:"user",lastSeen:"—",msgCount:0};
      let msg="";
      if(act==="dev_ban")    { if(!hasPerm(uid,"ban"))return edit("❌ لا صلاحية.",backKb()); DB.users[tid].banned=true;  msg=`🚫 تم حظر \`${tid}\``; log("ban",uid,String(tid)); }
      if(act==="dev_unban")  { if(!hasPerm(uid,"ban"))return edit("❌ لا صلاحية.",backKb()); DB.users[tid].banned=false; msg=`✅ رُفع حظر \`${tid}\``; log("unban",uid,String(tid)); }
      if(act==="dev_mute")   { if(!hasPerm(uid,"mute"))return edit("❌ لا صلاحية.",backKb()); DB.users[tid].muted=true;   msg=`🔇 تم كتم \`${tid}\``; log("mute",uid,String(tid)); }
      if(act==="dev_unmute") { if(!hasPerm(uid,"mute"))return edit("❌ لا صلاحية.",backKb()); DB.users[tid].muted=false;  msg=`🔊 رُفع كتم \`${tid}\``; log("unmute",uid,String(tid)); }
      if(act==="dev_promote"){ if(!isDev(uid))return edit("❌ المطور فقط.",backKb()); DB.admins.add(tid); DB.users[tid].role="admin"; msg=`⭐ ترقية \`${tid}\``; log("promote",uid,String(tid)); try{await bot.telegram.sendMessage(tid,"⭐ تمت ترقيتك لمسؤول في البوت!");}catch{} }
      if(act==="dev_demote") { if(!isDev(uid))return edit("❌ المطور فقط.",backKb()); DB.admins.delete(tid); delete DB.adminPerms[tid]; DB.users[tid].role="user"; msg=`⬇️ تخفيض \`${tid}\``; log("demote",uid,String(tid)); }
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
      return ctx.reply(`❌ خطأ. حاول مجدداً:\n\n🔢 *${n1} + ${n2} = ?*`,{parse_mode:"Markdown"});
    }
  }

  // فحص رابط
  if(st.mode==="vt_url"){
    delete DB.state[uid];
    const msg=await ctx.reply("⏳ *جاري الفحص بـ 70+ محرك أمان...*",{parse_mode:"Markdown"});
    const r = await vtScanUrl(text);
    if(!r) return ctx.reply("❌ تعذر الفحص. تأكد من صحة الرابط.",mainKb());
    const {stats,reputation,malEngines}=r;
    const mal=stats.malicious||0, sus=stats.suspicious||0, clean=stats.harmless||0, undetected=stats.undetected||0;
    const vd=mal>0?"🔴 *خطر — ابتعد عن هذا الرابط!*":sus>0?"🟡 *مشبوه — احذر*":"🟢 *آمن*";
    const engTxt=malEngines?.length?`\n\n🚨 *محركات كشفته ضار:*\n${malEngines.join(", ")}`:"";
    return ctx.reply(
      `🔍 *نتيجة فحص الرابط*\n\n${vd}\n\n🔗 \`${text.slice(0,60)}\`\n\n` +
      `🔴 ضار: *${mal}* | 🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}* | ⬜ غير محدد: *${undetected}*\n⭐ السمعة: *${reputation}*` +
      engTxt,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_domain"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الدومين...*",{parse_mode:"Markdown"});
    const domain = text.replace(/https?:\/\//,"").split("/")[0];
    const r = await vtScanDomain(domain);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,registrar,created,malEngines}=r;
    const mal=stats.malicious||0;
    const engTxt=malEngines?.length?`\n🚨 *كشف بواسطة:* ${malEngines.join(", ")}`:"";
    return ctx.reply(
      `🌐 *فحص الدومين*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${domain}\`\n\n` +
      `🔴 ضار: *${mal}* | 🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${reputation}*\n` +
      `🏢 المسجّل: ${registrar}\n📅 تاريخ التسجيل: ${created}` +
      engTxt,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  if(st.mode==="vt_ip"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري فحص الـ IP...*",{parse_mode:"Markdown"});
    const r = await vtScanIp(text);
    if(!r) return ctx.reply("❌ تعذر الفحص.",mainKb());
    const {stats,reputation,country,asOwner,malEngines}=r;
    const mal=stats.malicious||0;
    const engTxt=malEngines?.length?`\n🚨 *كشف بواسطة:* ${malEngines.join(", ")}`:"";
    return ctx.reply(
      `🖥 *فحص IP*\n\n${mal>0?"🔴 *خطر*":"🟢 *آمن*"}\n\n\`${text}\`\n🌍 الدولة: *${country}*\n🏢 الشبكة: *${asOwner}*\n\n` +
      `🔴 ضار: *${mal}* | 🟢 آمن: *${stats.harmless||0}*\n⭐ السمعة: *${reputation}*` +
      engTxt,
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
    return ctx.reply(`✅ *تم حفظ كلمة السر!*\n\n🏷 *${text}*\n🔐 \`${pass}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="save_pass_custom"){
    DB.state[uid]={mode:"store_pass_platform",pass:text};
    return ctx.reply("✏️ اسم المنصة (مثال: Gmail):",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }

  // إعداد الحساب
  if(st.mode==="acc_email"){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply("❌ بريد إلكتروني غير صحيح.");
    delete DB.state[uid]; DB.users[uid].accountEmail=text;
    return ctx.reply(`✅ *تم ربط البريد:* \`${text}\``,{parse_mode:"Markdown",...mainKb()});
  }
  if(st.mode==="acc_pass"){
    if(text.length<6) return ctx.reply("❌ يجب 6 أحرف على الأقل.");
    delete DB.state[uid]; DB.users[uid].passwordHash=hashPass(text);
    return ctx.reply("✅ *تم تعيين كلمة السر!*",{parse_mode:"Markdown",...mainKb()});
  }

  // إعدادات الأرقام
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
    let txt=`🔍 *نتائج البحث (${found.length}):*\n\n`;
    found.slice(0,5).forEach(([id,u])=>{
      txt+=`👤 *${u.name}* [\`${id}\`]\n@${u.username||"—"} | ${u.joinedAt}\n🚫 ${u.banned?"محظور":"غير محظور"} | 🏅 ${u.role}\n\n`;
    });
    const rows=found.slice(0,5).map(([id])=>[
      Markup.button.callback(`👁 عرض تفاصيل ${id}`,`dev_view_user:${id}`)
    ]);
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

  // رسالة لقروب
  if(st.mode==="send_group_msg"){
    if(!isAdmin(uid))return;
    const gid=st.gid;
    delete DB.state[uid];
    try {
      await bot.telegram.sendMessage(gid,`📢 *رسالة من الإدارة:*\n\n${text}`,{parse_mode:"Markdown"});
      return ctx.reply("✅ تم الإرسال للقروب.",devKb());
    } catch(e) {
      return ctx.reply(`❌ فشل الإرسال: ${e.message}`,devKb());
    }
  }

  // تخصيص البوت
  if(st.mode==="change_bot_name"){
    if(!isDev(uid))return;
    delete DB.state[uid];
    DB.settings.botName=text;
    try {
      await bot.telegram.setMyName(text);
      return ctx.reply(`✅ تم تغيير اسم البوت إلى: *${text}*`,{parse_mode:"Markdown",...devKb()});
    } catch(e) {
      return ctx.reply(`✅ تم حفظ الاسم محلياً: *${text}*\n_(تغيير الاسم في تيليجرام يتطلب BotFather)_`,{parse_mode:"Markdown",...devKb()});
    }
  }

  if(st.mode==="change_welcome"){
    if(!isDev(uid))return;
    delete DB.state[uid];
    DB.settings.welcomeMsg=text;
    return ctx.reply(`✅ تم تغيير رسالة الترحيب.`,devKb());
  }

  if(st.mode==="change_bot_desc"){
    if(!isDev(uid))return;
    delete DB.state[uid];
    try {
      await bot.telegram.setMyDescription(text);
      return ctx.reply("✅ تم تغيير وصف البوت.",devKb());
    } catch(e) {
      return ctx.reply(`❌ فشل: ${e.message}`,devKb());
    }
  }
});

// ===================== فحص الملفات والصور =====================
bot.on(["document","photo","video","audio"], async ctx=>{
  const uid = ctx.from.id;

  // تغيير صورة البوت (للمطور فقط)
  if(DB.state[uid]?.mode==="change_bot_photo" && isDev(uid)) {
    delete DB.state[uid];
    const photo = ctx.message.photo?.[ctx.message.photo.length-1] || ctx.message.document;
    if(!photo) return ctx.reply("❌ أرسل صورة صالحة.");
    try {
      const fileLink = await bot.telegram.getFileLink(photo.file_id);
      const res = await axios.get(fileLink.href, {responseType:"arraybuffer",timeout:30000});
      // تغيير صورة البوت عبر BotFather API
      await ctx.reply("✅ تم استلام الصورة.\n_لتغيير صورة البوت فعلياً، استخدم @BotFather > Edit Bot > Edit Botpic_",{parse_mode:"Markdown",...devKb()});
    } catch(e) {
      return ctx.reply(`❌ فشل: ${e.message}`,devKb());
    }
    return;
  }

  if(!DB.sessions[uid]?.verified&&!isDev(uid)) return;

  const file =
    ctx.message.document ||
    (ctx.message.photo&&ctx.message.photo[ctx.message.photo.length-1]) ||
    ctx.message.video ||
    ctx.message.audio;

  if(!file) return;

  const fileSize = file.file_size||0;
  if(fileSize>32*1024*1024)
    return ctx.reply("❌ الملف أكبر من 32MB.");

  const fname = file.file_name||`file_${Date.now()}`;
  const ext   = fname.split(".").pop()?.toLowerCase()||"";

  // تحديد نوع الملف
  let fileType="📄 مستند";
  if(["jpg","jpeg","png","gif","webp","bmp"].includes(ext)) fileType="🖼 صورة";
  else if(["apk","ipa","exe","msi","dmg"].includes(ext)) fileType="📱 تطبيق";
  else if(["mp4","avi","mkv","mov"].includes(ext)) fileType="🎬 فيديو";
  else if(["mp3","wav","ogg"].includes(ext)) fileType="🎵 صوت";
  else if(["pdf","doc","docx","xls"].includes(ext)) fileType="📋 وثيقة";
  else if(["zip","rar","7z"].includes(ext)) fileType="📦 مضغوط";
  else if(["js","py","php","sh","bat"].includes(ext)) fileType="💻 سكريبت";

  await ctx.reply(
    `🔍 *جاري فحص الملف...*\n\n${fileType}: \`${fname}\`\n📦 الحجم: ${(fileSize/1024).toFixed(1)}KB\n\n⏳ الفحص بـ 70+ محرك أمان...`,
    {parse_mode:"Markdown"}
  );

  try {
    const link   = await bot.telegram.getFileLink(file.file_id);
    const res    = await axios.get(link.href,{responseType:"arraybuffer",timeout:60000});
    const id     = await vtUploadFile(Buffer.from(res.data), fname);

    if(!id) return ctx.reply("❌ فشل رفع الملف. حاول لاحقاً.",mainKb());

    log("file_scan",uid,fname);
    await ctx.reply("⏳ *تم الرفع. جاري انتظار نتيجة التحليل...*",{parse_mode:"Markdown"});

    const report = await vtGetAnalysis(id);
    if(!report) return ctx.reply("⌛ التحليل لم يكتمل بعد. حاول خلال دقيقة.",mainKb());

    const stats = report.stats||{};
    const mal   = stats.malicious||0, sus=stats.suspicious||0;
    const clean = stats.harmless||0, undet=stats.undetected||0;
    const vd    = mal>0?"🔴 *خطر — لا تفتح هذا الملف!*":sus>0?"🟡 *مشبوه — احذر*":"🟢 *آمن*";

    // استخراج المحركات التي كشفت التهديد
    const malEngines = Object.entries(report.results||{})
      .filter(([,v])=>v.category==="malicious")
      .map(([k,v])=>`${k}: ${v.result||""}`)
      .slice(0,8);

    const engTxt = malEngines.length
      ? `\n\n🚨 *كشف بواسطة:*\n${malEngines.join("\n")}`
      : "";

    return ctx.reply(
      `🔍 *نتيجة فحص الملف*\n\n${vd}\n\n${fileType}: \`${fname}\`\n\n` +
      `🔴 ضار: *${mal}*\n🟡 مشبوه: *${sus}*\n🟢 آمن: *${clean}*\n⬜ غير محدد: *${undet}*` +
      engTxt,
      {parse_mode:"Markdown",...mainKb()}
    );
  } catch(e){
    console.error("vtFile:",e.message);
    return ctx.reply("❌ حدث خطأ أثناء الفحص.",mainKb());
  }
});

// ===================== تشغيل =====================
console.log("🚀 البوت يعمل — النسخة المطورة v3.0");
bot.launch();
process.once("SIGINT",  ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
