"use strict";

// ============================================================
//  بوت تيليجرام شامل — ملف واحد كامل
//  Hero SMS + 1secmail + VirusTotal + UptimeRobot
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");

// ===================== الإعدادات =====================
const BOT_TOKEN    = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const HERO_KEY     = "b7c49e0f481e15e7b96eAAb85e60570d";
const HERO_BASE    = "https://hero-sms.com/api/v1";
const VT_KEY       = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY       = "u3469811-ab163c31f24d6012491f0807";
const DEV_ID       = 7411444902;
const NUMBER_TTL   = 1200; // 20 دقيقة
const PORT         = process.env.PORT || 8080;

// نطاقات 1secmail
const MAIL_DOMAINS = [
  "1secmail.com","1secmail.org","1secmail.net",
  "wwjmp.com","esiix.com","xojxe.com","yoggm.com"
];

// ===================== Keep-Alive =====================
http.createServer((_,res)=>{ res.writeHead(200); res.end("Bot Running!"); })
  .listen(PORT,"0.0.0.0",()=>console.log(`✅ Port ${PORT}`));

// ===================== قاعدة البيانات =====================
const DB = {
  users:         {},   // id -> { name, username, joinedAt, banned, muted, role, passwordHash, email, accountEmail }
  sessions:      {},   // id -> { verified: bool, step, tempData }
  activeNums:    {},   // id -> { orderId, number, service, country, startTime, chatId, attempts }
  activeEmails:  {},   // id -> { login, domain, createdAt }
  savedEmails:   {},   // id -> [{ login, domain, label, savedAt }]
  savedPasswords:{},   // id -> [{ platform, password, savedAt }]
  usedNumbers:   new Set(),
  history:       {},   // id -> [...]
  mailHistory:   {},   // id -> [...]
  stats:         {},   // id -> { nums, emails, success }
  state:         {},   // id -> { mode, data }
  svcCache:      { d:{}, ts:0 },
  referrals:     {},   // refId -> [userId]
  referralOf:    {},   // userId -> refId
  referralPerks: {},   // userId -> { extra }
  logs:          [],
  admins:        new Set([DEV_ID]),
  settings: { maxPerDay:10, cooldown:30, refBonus:3, autoCancel:true },
  lastReq:       {},
  daily:         {},
};

// ===================== مساعدات =====================
const now    = () => Math.floor(Date.now()/1000);
const today  = () => new Date().toISOString().slice(0,10);
const stamp  = () => new Date().toLocaleString("ar-SA");
const sleep  = ms => new Promise(r=>setTimeout(r,ms));

function addLog(type, uid, text) {
  DB.logs.unshift({ type, uid, text, time: stamp() });
  if (DB.logs.length > 500) DB.logs.pop();
}

function ensureUser(ctx) {
  const u = ctx.from;
  if (!DB.users[u.id]) {
    DB.users[u.id] = {
      name: u.first_name||"مجهول", username: u.username||"",
      joinedAt: stamp(), banned:false, muted:false, role:"user",
      passwordHash:null, accountEmail:null,
    };
    addLog("join", u.id, u.first_name);
  }
  DB.users[u.id].name     = u.first_name || DB.users[u.id].name;
  DB.users[u.id].username = u.username   || DB.users[u.id].username;
}

const isDev   = id => id === DEV_ID;
const isAdmin = id => DB.admins.has(id) || isDev(id);
const isBanned= id => DB.users[id]?.banned;

function dailyCount(id)  { return DB.daily[`${id}_${today()}`]||0; }
function incDaily(id)    { const k=`${id}_${today()}`; DB.daily[k]=(DB.daily[k]||0)+1; }
function maxPerDay(id)   { return DB.settings.maxPerDay+(DB.referralPerks[id]?.extra||0); }

function hashPass(p)  { return crypto.createHash("sha256").update(p+"SALT_BOT_2025").digest("hex"); }
function fmtLeft(t)   {
  const r = NUMBER_TTL-(now()-t);
  if (r<=0) return "⏰ انتهى";
  return `⏱ ${String(Math.floor(r/60)).padStart(2,"0")}:${String(r%60).padStart(2,"0")}`;
}
function randStr(len=8) {
  return crypto.randomBytes(len).toString("base64").replace(/[^a-z0-9]/gi,"").slice(0,len).toLowerCase();
}
function genStrongPass() {
  const up="ABCDEFGHJKLMNPQRSTUVWXYZ", lo="abcdefghjkmnpqrstuvwxyz",
        nu="23456789", sp="@#$!_-";
  let p = "";
  for(let i=0;i<4;i++) p += up[Math.floor(Math.random()*up.length)];
  for(let i=0;i<4;i++) p += lo[Math.floor(Math.random()*lo.length)];
  for(let i=0;i<3;i++) p += nu[Math.floor(Math.random()*nu.length)];
  for(let i=0;i<2;i++) p += sp[Math.floor(Math.random()*sp.length)];
  return p.split("").sort(()=>Math.random()-0.5).join("");
}

// ===================== Hero SMS API =====================
async function heroGet(ep, params={}, tries=3) {
  for(let i=0;i<tries;i++){
    try {
      const r = await axios.get(`${HERO_BASE}/${ep}`,{params:{...params,api_key:HERO_KEY},timeout:8000});
      return r.data;
    } catch(e){ if(i<tries-1) await sleep(1500); }
  }
  return null;
}
const apiBalance   = async()=>{ const d=await heroGet("balance"); return d?.balance??null; };
const apiSvcs      = async()=>heroGet("services");
const apiCountries = async s=>heroGet("countries",{service:s});
const apiGetNum    = async(s,c)=>heroGet("get-number",{service:s,country:c,price:0});
const apiSms       = async o=>heroGet("get-sms",{order_id:o});
const apiCancel    = async o=>heroGet("cancel",{order_id:o});

async function allSvcs() {
  if(now()-DB.svcCache.ts<300 && Object.keys(DB.svcCache.d).length) return DB.svcCache.d;
  const d=await apiSvcs();
  if(d&&typeof d==="object"){ DB.svcCache={d,ts:now()}; return d; }
  return DB.svcCache.d;
}
async function freeSvcs() {
  const all=await allSvcs();
  return Object.fromEntries(Object.entries(all).filter(([,v])=>typeof v==="object"&&parseFloat(v?.price??1)===0));
}

// ===================== 1secmail API =====================
async function mailGen() {
  const login  = randStr(10);
  const domain = MAIL_DOMAINS[Math.floor(Math.random()*MAIL_DOMAINS.length)];
  return { login, domain, address:`${login}@${domain}` };
}
async function mailInbox(login, domain) {
  try {
    const r = await axios.get(`https://www.1secmail.com/api/v1/`,{
      params:{action:"getMessages",login,domain}, timeout:8000
    });
    return Array.isArray(r.data)?r.data:[];
  } catch{ return []; }
}
async function mailRead(login, domain, id) {
  try {
    const r = await axios.get(`https://www.1secmail.com/api/v1/`,{
      params:{action:"readMessage",login,domain,id}, timeout:8000
    });
    return r.data||null;
  } catch{ return null; }
}
async function mailDomains() {
  try {
    const r = await axios.get("https://www.1secmail.com/api/v1/",{params:{action:"getDomainList"},timeout:5000});
    return Array.isArray(r.data)?r.data:MAIL_DOMAINS;
  } catch{ return MAIL_DOMAINS; }
}

// ===================== VirusTotal =====================
async function vtScan(url) {
  try {
    const enc  = Buffer.from(url).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r    = await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,{
      headers:{"x-apikey":VT_KEY}, timeout:10000
    });
    const stats = r.data?.data?.attributes?.last_analysis_stats||{};
    return stats;
  } catch(e){ return null; }
}

// ===================== UptimeRobot =====================
async function uptimeCheck(url) {
  try {
    const r = await axios.post("https://api.uptimerobot.com/v2/getMonitors",
      `api_key=${UR_KEY}&format=json&response_times=1`,
      { headers:{"Content-Type":"application/x-www-form-urlencoded"}, timeout:8000 }
    );
    return r.data?.monitors||[];
  } catch{ return []; }
}

// ===================== تصنيفات الخدمات =====================
const CATS = {
  "سوشيال ميديا 📲":["vk","ok","fb","instagram","tiktok","twitter","snapchat","telegram"],
  "مراسلة 💬":      ["whatsapp","viber","line","wechat","signal"],
  "بريد وحسابات 📧":["google","gmail","yahoo","microsoft","apple"],
  "تسوق 🛒":        ["amazon","aliexpress","ebay","shopee"],
  "ألعاب 🎮":       ["steam","epic","pubg","fortnite","roblox"],
  "مال 💳":         ["paypal","binance","coinbase","bank"],
};
function getCat(c){ const l=c.toLowerCase(); for(const[k,v]of Object.entries(CATS))if(v.some(x=>l.includes(x)))return k; return "أخرى 🔧"; }
function searchSvc(q,svcs){ const lq=q.toLowerCase(); return Object.fromEntries(Object.entries(svcs).filter(([c,v])=>c.toLowerCase().includes(lq)||(v?.name||"").toLowerCase().includes(lq))); }

// ===================== مراقب SMS =====================
async function smsWatcher(bot, uid, orderId, number, svc, chatId) {
  const fast=[5,5,5,10,10,10];
  const extra=Math.floor((NUMBER_TTL-80)/10);
  const check=async()=>{ const r=await apiSms(orderId); return r?.sms||null; };

  for(const w of fast){
    await sleep(w*1000);
    if(!DB.activeNums[uid]||DB.activeNums[uid].orderId!==orderId) return;
    DB.activeNums[uid].attempts=(DB.activeNums[uid].attempts||0)+1;
    const sms=await check();
    if(sms){ await deliverSms(bot,uid,orderId,number,svc,chatId,sms); return; }
  }
  for(let i=0;i<extra;i++){
    await sleep(10000);
    if(!DB.activeNums[uid]||DB.activeNums[uid].orderId!==orderId) return;
    DB.activeNums[uid].attempts=(DB.activeNums[uid].attempts||0)+1;
    const sms=await check();
    if(sms){ await deliverSms(bot,uid,orderId,number,svc,chatId,sms); return; }
  }
  if(DB.activeNums[uid]?.orderId===orderId){
    delete DB.activeNums[uid];
    addLog("timeout",uid,`${number} | ${svc}`);
    try{ await bot.telegram.sendMessage(chatId,`⏰ انتهى وقت الرقم \`${number}\` بدون رسالة.`,{parse_mode:"Markdown",...mainKb()}); }catch{}
  }
}

async function deliverSms(bot,uid,orderId,number,svc,chatId,sms){
  delete DB.activeNums[uid];
  DB.usedNumbers.add(number);
  if(DB.stats[uid]) DB.stats[uid].success=(DB.stats[uid].success||0)+1;
  if(DB.history[uid]){ const h=DB.history[uid].find(x=>x.number===number); if(h) h.gotSms=true; }
  addLog("sms",uid,`${number} | ${svc} | ${sms.slice(0,30)}`);
  try{
    await bot.telegram.sendMessage(chatId,
      `🔔 *وصل الكود تلقائياً!*\n\n📱 *الرقم:* \`${number}\`\n🔧 *الخدمة:* \`${svc}\`\n\n📩 *الرسالة:*\n\`\`\`\n${sms}\n\`\`\``,
      {parse_mode:"Markdown",...mainKb()}
    );
  }catch(e){console.error("deliverSms:",e.message);}
}

// مراقب إيميل تلقائي
async function emailWatcher(bot, uid, login, domain, chatId, maxMin=10){
  const end=now()+maxMin*60;
  let lastIds=new Set();
  while(now()<end){
    await sleep(8000);
    if(!DB.activeEmails[uid]||DB.activeEmails[uid].login!==login) return;
    const msgs=await mailInbox(login,domain);
    for(const m of msgs){
      if(!lastIds.has(m.id)){
        lastIds.add(m.id);
        const full=await mailRead(login,domain,m.id);
        const body=(full?.textBody||full?.htmlBody||"").slice(0,500).replace(/<[^>]+>/g,"");
        addLog("email_received",uid,`${login}@${domain} | ${m.subject}`);
        try{
          await bot.telegram.sendMessage(chatId,
            `📧 *وصلت رسالة جديدة!*\n\n📬 *من:* \`${m.from}\`\n📋 *الموضوع:* ${m.subject}\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
            {parse_mode:"Markdown",...emailActiveKb(login,domain)}
          );
        }catch{}
      }
    }
  }
}

// ===================== لوحات المفاتيح =====================
const mainKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback("📱 أرقام مؤقتة","menu_nums"),Markup.button.callback("📧 إيميلات مؤقتة","menu_emails")],
  [Markup.button.callback("🔑 مدير كلمات السر","menu_passwords"),Markup.button.callback("🔍 فحص رابط","menu_virustotal")],
  [Markup.button.callback("📊 إحصائياتي","stats"),Markup.button.callback("🎁 الإحالة","referral")],
  [Markup.button.callback("📋 سجلي","history"),Markup.button.callback("ℹ️ مساعدة","help")],
]);

const backKb=()=>Markup.inlineKeyboard([[Markup.button.callback("🔙 الرئيسية","back")]]);

const emailActiveKb=(login,domain)=>Markup.inlineKeyboard([
  [Markup.button.callback("📨 فتح الصندوق",`inbox:${login}:${domain}`)],
  [Markup.button.callback("💾 حفظ الإيميل",`save_email:${login}:${domain}`)],
  [Markup.button.callback("🗑 حذف الإيميل",`del_email:${login}:${domain}`)],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

const devKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback("👥 الأعضاء","dev_users"),Markup.button.callback("📊 إحصائيات","dev_stats")],
  [Markup.button.callback("💰 الرصيد","dev_balance"),Markup.button.callback("📜 السجل","dev_logs")],
  [Markup.button.callback("🔨 حظر","dev_ban"),Markup.button.callback("✅ رفع حظر","dev_unban")],
  [Markup.button.callback("🔇 كتم","dev_mute"),Markup.button.callback("🔊 رفع كتم","dev_unmute")],
  [Markup.button.callback("⭐ ترقية","dev_promote"),Markup.button.callback("⬇️ تخفيض","dev_demote")],
  [Markup.button.callback("📢 رسالة جماعية","dev_broadcast"),Markup.button.callback("⚙️ إعدادات","dev_settings")],
  [Markup.button.callback("🗑 مسح السجل","dev_clear_logs"),Markup.button.callback("🚫 الأرقام المستهلكة","dev_used")],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

const devSettingsKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback(`📏 حد يومي: ${DB.settings.maxPerDay}`,"ds_max"),
   Markup.button.callback(`⏳ انتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`🎁 مكافأة إحالة: ${DB.settings.refBonus}`,"ds_ref"),
   Markup.button.callback(`🔄 إلغاء تلقائي: ${DB.settings.autoCancel?"✅":"❌"}`,"ds_auto")],
  [Markup.button.callback("🔙 لوحة التحكم","dev_panel")],
]);

// لوحة مفاتيح لعرض المستخدمين مع إجراء
function usersKb(action, page=0) {
  const ids=Object.keys(DB.users);
  const perPage=8;
  const slice=ids.slice(page*perPage,(page+1)*perPage);
  const rows=slice.map(id=>{
    const u=DB.users[id];
    const badge=u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
    return [Markup.button.callback(`${badge} ${u.name} (${id})`,`${action}:${id}`)];
  });
  const nav=[];
  if(page>0) nav.push(Markup.button.callback("◀️ السابق",`upage:${action}:${page-1}`));
  if((page+1)*perPage<ids.length) nav.push(Markup.button.callback("▶️ التالي",`upage:${action}:${page+1}`));
  if(nav.length) rows.push(nav);
  rows.push([Markup.button.callback("🔙 لوحة التحكم","dev_panel")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== البوت =====================
const bot=new Telegraf(BOT_TOKEN);

// middleware
bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  if(isBanned(ctx.from.id)&&!isDev(ctx.from.id)){
    try{ await ctx.reply("🚫 أنت محظور."); }catch{}
    return;
  }
  return next();
});

// /start
bot.start(async ctx=>{
  const uid=ctx.from.id;
  delete DB.state[uid];
  const payload=ctx.startPayload;
  if(payload?.startsWith("ref_")){
    const rid=parseInt(payload.slice(4));
    if(rid!==uid&&!DB.referralOf[uid]){
      DB.referralOf[uid]=rid;
      if(!DB.referrals[rid]) DB.referrals[rid]=[];
      DB.referrals[rid].push(uid);
      if(!DB.referralPerks[rid]) DB.referralPerks[rid]={extra:0};
      DB.referralPerks[rid].extra+=DB.settings.refBonus;
      addLog("referral",rid,`أحال ${uid}`);
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق عبر رابطك! حصلت على ${DB.settings.refBonus} أرقام إضافية 🎁`); }catch{}
    }
  }
  addLog("start",uid,DB.users[uid]?.name);
  if(isDev(uid)) return ctx.reply("👑 *مرحباً بالمطور!*",{parse_mode:"Markdown",...devKb()});
  // نظام تحقق بسيط (anti-bot)
  if(!DB.sessions[uid]?.verified){
    DB.sessions[uid]={verified:false,step:"captcha"};
    const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
    DB.sessions[uid].captchaAns=n1+n2;
    DB.state[uid]={mode:"captcha"};
    return ctx.reply(
      `👋 *أهلاً! للتحقق أنك لست روبوت:*\n\n🔢 كم يساوي: *${n1} + ${n2} = ?*`,
      {parse_mode:"Markdown"}
    );
  }
  showMain(ctx);
});

async function showMain(ctx){
  await ctx.reply(
    `🏠 *القائمة الرئيسية*\n\nاختر الخدمة التي تريدها:`,
    {parse_mode:"Markdown",...mainKb()}
  );
}

// /dev
bot.command("dev",async ctx=>{ if(!isDev(ctx.from.id))return; await ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel",async ctx=>{ if(!isAdmin(ctx.from.id))return; await ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });

// ===================== معالج الأزرار =====================
bot.on("callback_query",async ctx=>{
  await ctx.answerCbQuery().catch(()=>{});
  const data=ctx.callbackQuery.data;
  const uid=ctx.from.id;
  const edit=(text,extra={})=>ctx.editMessageText(text,{parse_mode:"Markdown",...extra}).catch(()=>ctx.reply(text,{parse_mode:"Markdown",...extra}));

  // ───── رئيسية ─────
  if(data==="back"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }

  // ───── قائمة أرقام ─────
  if(data==="menu_nums"){
    const diff=now()-(DB.lastReq[uid]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid))
      return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxPerDay(uid)&&!isAdmin(uid))
      return edit(`🚫 وصلت للحد اليومي (${maxPerDay(uid)}).\nأحِل أصدقاء للحصول على المزيد 🎁`,backKb());
    await edit("⏳ جاري تحميل الخدمات...");
    const svcs=await freeSvcs();
    if(!Object.keys(svcs).length) return edit("😔 لا توجد خدمات مجانية حالياً.",backKb());
    return edit(`📂 *اختر التصنيف:*\n🆓 الخدمات المتاحة: *${Object.keys(svcs).length}*`,buildCatsKb(svcs));
  }

  if(data.startsWith("cat:")){
    const cat=data.slice(4);
    const svcs=await freeSvcs();
    const f=cat==="all"?svcs:Object.fromEntries(Object.entries(svcs).filter(([c])=>getCat(c)===cat));
    if(!Object.keys(f).length) return edit("😔 لا توجد خدمات.",backKb());
    const rows=Object.entries(f).slice(0,15).map(([c,v])=>[
      Markup.button.callback(`🆓 ${v?.name||c}${v?.count?` (${v.count})`:""}`,`svc:${c}`)
    ]);
    rows.push([Markup.button.callback("🔙 رجوع","menu_nums")]);
    return edit(`📋 *${cat}* — ${Object.keys(f).length} خدمة:`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("svc:")){
    const svc=data.slice(4);
    await edit("⏳ جاري جلب الدول...");
    const cs=await apiCountries(svc);
    let rows;
    if(cs&&Object.keys(cs).length){
      rows=Object.entries(cs).slice(0,8).map(([cc,ci])=>[
        Markup.button.callback(`🌍 ${ci?.name||cc}${ci?.count?` (${ci.count})`:""}`,`num:${svc}:${cc}`)
      ]);
    } else {
      rows=[["ru","🇷🇺 روسيا"],["us","🇺🇸 أمريكا"],["gb","🇬🇧 بريطانيا"],["de","🇩🇪 ألمانيا"]]
        .map(([cc,l])=>[Markup.button.callback(l,`num:${svc}:${cc}`)]);
    }
    rows.push([Markup.button.callback("🔙 رجوع","cat:all")]);
    return edit(`🌍 *اختر الدولة:* \`${svc}\``,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("num:")){
    const[,svc,country]=data.split(":");
    DB.lastReq[uid]=now();
    await edit("⚡ *جاري طلب الرقم...*");
    const res=await apiGetNum(svc,country);
    if(!res?.order_id) return edit(`❌ فشل: ${res?.message||"تعذر الاتصال"}`,backKb());
    const orderId=String(res.order_id), number=res.number||"غير معروف";
    if(DB.usedNumbers.has(number)){
      await apiCancel(orderId);
      return edit("⚠️ هذا الرقم مستخدم مسبقاً.\nاضغط طلب رقم جديد:",Markup.inlineKeyboard([
        [Markup.button.callback("🔄 طلب آخر",data)],[Markup.button.callback("🔙 رجوع","menu_nums")]
      ]));
    }
    const st=now();
    DB.activeNums[uid]={orderId,number,service:svc,country,startTime:st,chatId:ctx.chat.id,attempts:0};
    incDaily(uid);
    if(!DB.stats[uid]) DB.stats[uid]={nums:0,emails:0,success:0};
    DB.stats[uid].nums++;
    if(!DB.history[uid]) DB.history[uid]=[];
    DB.history[uid].unshift({number,service:svc,time:stamp(),gotSms:false});
    DB.history[uid]=DB.history[uid].slice(0,10);
    addLog("num_issued",uid,`${number}|${svc}|${country}`);
    await edit(
      `✅ *تم الحصول على الرقم!*\n\n📱 *الرقم:* \`${number}\`\n🔧 *الخدمة:* \`${svc}\`\n🌍 *الدولة:* \`${country}\`\n🆔 *الطلب:* \`${orderId}\`\n${fmtLeft(st)}\n\n⚡ الكود سيصلك تلقائياً بثواني 🔔`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📩 تحقق الآن",`chk:${orderId}`),Markup.button.callback("❌ إلغاء",`cxl:${orderId}`)],
        [Markup.button.callback("⏱ المؤقت",`tmr:${orderId}`)],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
    smsWatcher(bot,uid,orderId,number,svc,ctx.chat.id);
    return;
  }

  if(data.startsWith("chk:")){
    const orderId=data.slice(4);
    await edit("🔍 *جاري الفحص...*");
    let sms=null;
    for(let i=0;i<5;i++){ const r=await apiSms(orderId); if(r?.sms){sms=r.sms;break;} if(i<4)await sleep(1500); }
    const info=DB.activeNums[uid];
    if(sms){ await deliverSms(bot,uid,orderId,info?.number||"",info?.service||"",ctx.chat.id,sms); return; }
    return edit(`⌛ لم تصل رسالة بعد.\n${info?fmtLeft(info.startTime):""}\nالبوت يراقب تلقائياً ⚡`,
      Markup.inlineKeyboard([[Markup.button.callback("🔄 تحديث",`chk:${orderId}`),Markup.button.callback("❌ إلغاء",`cxl:${orderId}`)],[Markup.button.callback("🔙 رئيسية","back")]])
    );
  }

  if(data.startsWith("cxl:")){ await apiCancel(data.slice(4)); delete DB.activeNums[uid]; addLog("cancel",uid,data.slice(4)); return edit("✅ تم الإلغاء.",backKb()); }
  if(data.startsWith("tmr:")){
    const info=DB.activeNums[uid];
    if(!info) return edit("⚠️ لا يوجد رقم نشط.",backKb());
    return edit(`⏱ *المؤقت:* ${fmtLeft(info.startTime)}\n📱 \`${info.number}\``,
      Markup.inlineKeyboard([[Markup.button.callback("📩 تحقق",`chk:${info.orderId}`),Markup.button.callback("❌ إلغاء",`cxl:${info.orderId}`)],[Markup.button.callback("⏱ تحديث",`tmr:${info.orderId}`)],[Markup.button.callback("🔙 رئيسية","back")]])
    );
  }

  // ───── إيميلات ─────
  if(data==="menu_emails"){
    const saved=DB.savedEmails[uid]||[];
    const rows=[];
    if(saved.length){
      rows.push([Markup.button.callback(`📂 إيميلاتي المحفوظة (${saved.length})`, "my_emails")]);
    }
    rows.push([Markup.button.callback("✨ إنشاء إيميل جديد","new_email")]);
    rows.push([Markup.button.callback("🔄 الحصول على نطاقات متاحة","email_domains")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit("📧 *نظام الإيميلات المؤقتة:*\n\nإيميلات مجانية فورية، تصلك الرسائل تلقائياً 🔔",Markup.inlineKeyboard(rows));
  }

  if(data==="new_email"){
    await edit("⚡ *جاري إنشاء إيميل جديد...*");
    const{login,domain,address}=await mailGen();
    DB.activeEmails[uid]={login,domain,createdAt:now()};
    if(!DB.stats[uid]) DB.stats[uid]={nums:0,emails:0,success:0};
    DB.stats[uid].emails++;
    if(!DB.mailHistory[uid]) DB.mailHistory[uid]=[];
    DB.mailHistory[uid].unshift({address,time:stamp()});
    DB.mailHistory[uid]=DB.mailHistory[uid].slice(0,10);
    addLog("email_created",uid,address);
    await edit(
      `✅ *تم إنشاء الإيميل!*\n\n📧 *العنوان:*\n\`${address}\`\n\n` +
      `📋 *اسم المستخدم:* \`${login}\`\n🌐 *النطاق:* \`${domain}\`\n\n` +
      `⚡ ستصلك الرسائل تلقائياً عند وصولها 🔔\n⏱ صالح لمدة 10 دقائق`,
      emailActiveKb(login,domain)
    );
    emailWatcher(bot,uid,login,domain,ctx.chat.id,10);
    return;
  }

  if(data==="email_domains"){
    const doms=await mailDomains();
    return edit(`🌐 *النطاقات المتاحة:*\n\n${doms.map(d=>`• \`@${d}\``).join("\n")}`,backKb());
  }

  if(data.startsWith("inbox:")){
    const[,login,domain]=data.split(":");
    await edit("📨 *جاري فتح الصندوق...*");
    const msgs=await mailInbox(login,domain);
    if(!msgs.length) return edit(`📭 *الصندوق فارغ*\n\`${login}@${domain}\`\n\nانتظر وصول رسائل...`,emailActiveKb(login,domain));
    const rows=msgs.slice(0,8).map(m=>[
      Markup.button.callback(`📩 ${m.subject.slice(0,30)} — ${m.from.slice(0,20)}`,`msg:${login}:${domain}:${m.id}`)
    ]);
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${login}:${domain}`)]);
    rows.push([Markup.button.callback("🔙 رجوع",`email_menu:${login}:${domain}`)]);
    return edit(`📬 *الصندوق (${msgs.length} رسالة):*\n\`${login}@${domain}\``,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("msg:")){
    const[,login,domain,id]=data.split(":");
    await edit("📖 *جاري قراءة الرسالة...*");
    const msg=await mailRead(login,domain,parseInt(id));
    if(!msg) return edit("❌ تعذر قراءة الرسالة.",backKb());
    const body=(msg.textBody||msg.htmlBody||"(فارغ)").slice(0,800).replace(/<[^>]+>/g,"");
    return edit(
      `📩 *رسالة جديدة*\n\n👤 *من:* \`${msg.from}\`\n📋 *الموضوع:* ${msg.subject}\n🕐 *الوقت:* ${msg.date||""}\n\n📝 *المحتوى:*\n\`\`\`\n${body}\n\`\`\``,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 الصندوق",`inbox:${login}:${domain}`)]])
    );
  }

  if(data.startsWith("save_email:")){
    const[,login,domain]=data.split(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    const exists=DB.savedEmails[uid].find(e=>e.login===login&&e.domain===domain);
    if(exists) return edit("✅ الإيميل محفوظ مسبقاً.",emailActiveKb(login,domain));
    DB.state[uid]={mode:"save_email_label",login,domain};
    return edit("✏️ أرسل اسم/تسمية لهذا الإيميل:\nمثال: حساب نتفليكس",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","back")]]));
  }

  if(data==="my_emails"){
    const saved=DB.savedEmails[uid]||[];
    if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows=saved.map((e,i)=>[
      Markup.button.callback(`📧 ${e.label} — ${e.login}@${e.domain}`,`open_saved:${i}`)
    ]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(`📂 *إيميلاتي المحفوظة (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("open_saved:")){
    const idx=parseInt(data.split(":")[1]);
    const e=DB.savedEmails[uid]?.[idx];
    if(!e) return edit("❌ لم يُعثر على الإيميل.",backKb());
    return edit(`📧 *الإيميل:* \`${e.login}@${e.domain}\`\n🏷 *الاسم:* ${e.label}\n🕐 *حُفظ:* ${e.savedAt}`,emailActiveKb(e.login,e.domain));
  }

  if(data.startsWith("del_email:")){
    const[,login,domain]=data.split(":");
    if(DB.activeEmails[uid]?.login===login) delete DB.activeEmails[uid];
    DB.savedEmails[uid]=(DB.savedEmails[uid]||[]).filter(e=>!(e.login===login&&e.domain===domain));
    addLog("email_deleted",uid,`${login}@${domain}`);
    return edit("🗑 *تم حذف الإيميل.*",backKb());
  }

  // ───── مدير كلمات السر ─────
  if(data==="menu_passwords"){
    const saved=DB.savedPasswords[uid]||[];
    return edit(
      `🔑 *مدير كلمات السر*\n\n✅ كلمات السر محفوظة: *${saved.length}*\n\nاختر:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔐 توليد كلمة سر قوية","gen_pass")],
        [Markup.button.callback("💾 كلمات السر المحفوظة","my_passwords")],
        [Markup.button.callback("➕ حفظ كلمة سر جديدة","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="gen_pass"){
    const p=genStrongPass();
    return edit(
      `🔐 *كلمة السر القوية:*\n\n\`${p}\`\n\n📋 انسخها وحفظها في المدير!`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💾 حفظها في مدير السر",`store_pass:${p}`)],
        [Markup.button.callback("🔄 توليد أخرى","gen_pass")],
        [Markup.button.callback("🔙 رجوع","menu_passwords")],
      ])
    );
  }

  if(data.startsWith("store_pass:")){
    const pass=data.slice(11);
    DB.state[uid]={mode:"store_pass_platform",pass};
    return edit("✏️ أرسل اسم المنصة/الموقع لهذه الكلمة:\nمثال: Netflix أو إنستغرام",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]]));
  }

  if(data==="save_pass_prompt"){
    DB.state[uid]={mode:"save_pass_custom"};
    return edit("✏️ أرسل كلمة السر التي تريد حفظها:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]]));
  }

  if(data==="my_passwords"){
    const saved=DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر محفوظة.*",backKb());
    let txt=`🔑 *كلمات السر المحفوظة (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{ txt+=`${i+1}. 🏷 *${p.platform}*\n   🔐 \`${p.password}\`\n   🕐 ${p.savedAt}\n\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 رجوع","menu_passwords")]]));
  }

  // ───── فحص الروابط ─────
  if(data==="menu_virustotal"){
    DB.state[uid]={mode:"vt_scan"};
    return edit("🔍 *فحص الروابط بـ VirusTotal*\n\nأرسل الرابط الذي تريد فحصه:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","back")]]));
  }

  // ───── رصيد ─────
  if(data==="balance"){
    const b=await apiBalance();
    return edit(b!==null?`💰 *الرصيد:* \`${b}\``:"❌ تعذر جلب الرصيد.",backKb());
  }

  // ───── إحصائيات ─────
  if(data==="stats"){
    const s=DB.stats[uid]||{nums:0,emails:0,success:0};
    const refs=(DB.referrals[uid]||[]).length;
    const bonus=DB.referralPerks[uid]?.extra||0;
    const info=DB.activeNums[uid];
    const mailInfo=DB.activeEmails[uid];
    return edit(
      `📊 *إحصائياتك:*\n\n📱 أرقام مستخدمة: *${s.nums}*\n📧 إيميلات أنشأتها: *${s.emails}*\n✅ رسائل استقبلت: *${s.success||0}*\n📅 اليوم: *${dailyCount(uid)}/${maxPerDay(uid)}*\n👥 إحالاتك: *${refs}*\n🎁 مكافأة: *${bonus} أرقام*\n🟢 رقم نشط: *${info?"نعم":"لا"}*\n📬 إيميل نشط: *${mailInfo?"نعم":"لا"}*`,
      backKb()
    );
  }

  // ───── سجل ─────
  if(data==="history"){
    const h=DB.history[uid]||[];
    const m=DB.mailHistory[uid]||[];
    let txt="📋 *سجلي:*\n\n";
    if(h.length){ txt+="*📱 آخر أرقام:*\n"; h.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. \`${e.number}\` — ${e.service}\n   🕐 ${e.time} ${e.gotSms?"✅":"⌛"}\n`; }); txt+="\n"; }
    if(m.length){ txt+="*📧 آخر إيميلات:*\n"; m.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. \`${e.address}\`\n   🕐 ${e.time}\n`; }); }
    if(!h.length&&!m.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ───── إحالة ─────
  if(data==="referral"){
    const me=await bot.telegram.getMe();
    const link=`https://t.me/${me.username}?start=ref_${uid}`;
    const refs=(DB.referrals[uid]||[]).length;
    const bonus=DB.referralPerks[uid]?.extra||0;
    return edit(
      `🎁 *نظام الإحالة:*\n\n🔗 رابطك:\n\`${link}\`\n\n👥 إحالاتك: *${refs}*\n🎁 مكافأة: *+${bonus} أرقام يومياً*\n\n📌 لكل صديق يدخل عبر رابطك تحصل على *${DB.settings.refBonus} أرقام إضافية*!`,
      backKb()
    );
  }

  // ───── مساعدة ─────
  if(data==="help"){
    return edit(
      `ℹ️ *دليل البوت:*\n\n*📱 أرقام مؤقتة:*\nأرقام مجانية لاستقبال SMS بشكل فوري\n\n*📧 إيميلات مؤقتة:*\nإيميلات مؤقتة تستقبل الرسائل تلقائياً\n\n*🔑 مدير السر:*\nتوليد وحفظ كلمات سر قوية مع اسم المنصة\n\n*🔍 فحص الروابط:*\nفحص أي رابط بـ VirusTotal\n\n*🎁 الإحالة:*\nشارك رابطك واحصل على أرقام إضافية\n\n*⚡ التقاط تلقائي:*\nالكود أو الرسالة تصلك فوراً بثواني`,
      backKb()
    );
  }

  // ───── بحث ─────
  if(data==="search_mode"){
    DB.state[uid]={mode:"search"};
    return edit("🔍 *بحث عن خدمة:*\n\nأرسل اسم التطبيق أو الخدمة:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","back")]]));
  }

  // ───── لوحة المطور ─────
  if(data==="dev_panel"){ if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *الإعدادات:*",devSettingsKb()); }
  if(data==="ds_auto"){ if(!isAdmin(uid))return; DB.settings.autoCancel=!DB.settings.autoCancel; return edit("⚙️ *الإعدادات:*",devSettingsKb()); }

  for(const k of["ds_max","ds_cool","ds_ref"]){
    if(data===k){
      if(!isAdmin(uid))return;
      const labels={ds_max:"الحد اليومي",ds_cool:"الانتظار (ثانية)",ds_ref:"مكافأة الإحالة"};
      DB.state[uid]={mode:"dev_setting",key:k};
      return edit(`✏️ أرسل القيمة الجديدة لـ *${labels[k]}*:`,Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_settings")]]));
    }
  }

  if(data==="dev_balance"){ if(!isAdmin(uid))return; const b=await apiBalance(); return edit(b!==null?`💰 *رصيد API:* \`${b}\``:"❌ فشل.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])); }

  if(data==="dev_stats"){
    if(!isAdmin(uid))return;
    const total=Object.keys(DB.users).length;
    const nums=Object.values(DB.stats).reduce((a,s)=>a+(s.nums||0),0);
    const succ=Object.values(DB.stats).reduce((a,s)=>a+(s.success||0),0);
    const emails=Object.values(DB.stats).reduce((a,s)=>a+(s.emails||0),0);
    return edit(
      `📊 *إحصائيات عامة:*\n\n👥 الأعضاء: *${total}*\n📱 أرقام: *${nums}*\n📧 إيميلات: *${emails}*\n✅ رسائل: *${succ}*\n🟢 نشطون: *${Object.keys(DB.activeNums).length}*\n🚫 أرقام مستهلكة: *${DB.usedNumbers.size}*\n📜 السجلات: *${DB.logs.length}*`,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])
    );
  }

  if(data==="dev_logs"){
    if(!isAdmin(uid))return;
    const last=DB.logs.slice(0,12);
    let txt=`📜 *آخر ${last.length} أحداث:*\n\n`;
    last.forEach(l=>{ txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${l.text}\n🕐 ${l.time}\n\n`; });
    return edit(txt||"لا توجد سجلات.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  if(data==="dev_clear_logs"){ if(!isDev(uid))return; DB.logs=[]; return edit("✅ تم مسح السجل.",Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])); }

  if(data==="dev_used"){
    if(!isAdmin(uid))return;
    const list=[...DB.usedNumbers].slice(-20);
    return edit(`🚫 *آخر الأرقام المستهلكة (${DB.usedNumbers.size}):*\n\n${list.length?list.map(n=>`\`${n}\``).join("\n"):"لا توجد"}`,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }

  // عرض المستخدمين مع إجراء (الضغط مباشرة)
  for(const act of["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"]){
    if(data===act){
      if(!isAdmin(uid))return;
      const labels={dev_ban:"🔨 حظر",dev_unban:"✅ رفع حظر",dev_mute:"🔇 كتم",dev_unmute:"🔊 رفع كتم",dev_promote:"⭐ ترقية",dev_demote:"⬇️ تخفيض"};
      return edit(`${labels[act]}\n\n*اختر المستخدم:*`,usersKb(act));
    }
  }

  // تنفيذ الإجراء على مستخدم محدد
  for(const act of["dev_ban","dev_unban","dev_mute","dev_unmute","dev_promote","dev_demote"]){
    if(data.startsWith(`${act}:`)){
      if(!isAdmin(uid))return;
      const tid=parseInt(data.split(":")[1]);
      if(!DB.users[tid]) DB.users[tid]={name:String(tid),username:"",joinedAt:stamp(),banned:false,muted:false,role:"user"};
      let msg="";
      if(act==="dev_ban")     { DB.users[tid].banned=true;  msg=`🚫 تم حظر \`${tid}\``; addLog("ban",uid,`حظر ${tid}`); }
      if(act==="dev_unban")   { DB.users[tid].banned=false; msg=`✅ رُفع الحظر عن \`${tid}\``; addLog("unban",uid,`رفع حظر ${tid}`); }
      if(act==="dev_mute")    { DB.users[tid].muted=true;   msg=`🔇 تم كتم \`${tid}\``; addLog("mute",uid,`كتم ${tid}`); }
      if(act==="dev_unmute")  { DB.users[tid].muted=false;  msg=`🔊 رُفع الكتم عن \`${tid}\``; }
      if(act==="dev_promote") {
        if(!isDev(uid)) return edit("❌ فقط المطور يمكنه الترقية.",backKb());
        DB.admins.add(tid); DB.users[tid].role="admin"; msg=`⭐ تمت ترقية \`${tid}\``;
        addLog("promote",uid,`ترقية ${tid}`);
        try{ await bot.telegram.sendMessage(tid,"⭐ تمت ترقيتك لمسؤول!"); }catch{}
      }
      if(act==="dev_demote")  {
        if(!isDev(uid)) return edit("❌ فقط المطور يمكنه التخفيض.",backKb());
        DB.admins.delete(tid); DB.users[tid].role="user"; msg=`⬇️ تم تخفيض \`${tid}\``;
        addLog("demote",uid,`تخفيض ${tid}`);
      }
      return edit(msg,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
    }
  }

  // صفحات المستخدمين
  if(data.startsWith("upage:")){
    const[,act,page]=data.split(":");
    return edit(`*اختر المستخدم:*`,usersKb(act,parseInt(page)));
  }

  if(data==="dev_broadcast"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"broadcast"}; return edit("📢 أرسل الرسالة الجماعية:",Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_panel")]])); }

  if(data==="dev_users"){
    if(!isAdmin(uid))return;
    const users=Object.entries(DB.users);
    let txt=`👥 *الأعضاء (${users.length}):*\n\n`;
    users.slice(0,15).forEach(([id,u])=>{
      const s=DB.stats[id]||{};
      txt+=`${u.banned?"🚫":isAdmin(parseInt(id))?"⭐":"👤"} *${u.name}*\n   ID: \`${id}\` | 📱${s.nums||0} 📧${s.emails||0}\n   انضم: ${u.joinedAt}\n\n`;
    });
    if(users.length>15) txt+=`... و ${users.length-15} آخرين`;
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]]));
  }
});

// ===================== معالج النصوص =====================
bot.on("text",async ctx=>{
  const uid=ctx.from.id;
  const text=ctx.message.text.trim();
  const state=DB.state[uid];
  if(!state) return;

  // ── captcha ──
  if(state.mode==="captcha"){
    const ans=parseInt(text);
    if(ans===DB.sessions[uid]?.captchaAns){
      DB.sessions[uid].verified=true;
      delete DB.state[uid];
      addLog("verified",uid,DB.users[uid]?.name);
      await ctx.reply("✅ *تم التحقق!*",{parse_mode:"Markdown"});
      return showMain(ctx);
    } else {
      const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
      DB.sessions[uid].captchaAns=n1+n2;
      return ctx.reply(`❌ إجابة خاطئة. حاول مجدداً:\n\n🔢 *${n1} + ${n2} = ?*`,{parse_mode:"Markdown"});
    }
  }

  // ── بحث ──
  if(state.mode==="search"){
    delete DB.state[uid];
    await ctx.reply(`🔍 *جاري البحث عن:* \`${text}\`...`,{parse_mode:"Markdown"});
    const svcs=await freeSvcs();
    const res=searchSvc(text,svcs);
    if(!Object.keys(res).length) return ctx.reply(`😔 لا نتائج لـ *${text}*`,{parse_mode:"Markdown",...mainKb()});
    const rows=Object.entries(res).slice(0,10).map(([c,v])=>[
      Markup.button.callback(`🆓 ${v?.name||c}${v?.count?` (${v.count})`:""}`,`svc:${c}`)
    ]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return ctx.reply(`✅ *نتائج (${Object.keys(res).length}):*`,{parse_mode:"Markdown",...Markup.inlineKeyboard(rows)});
  }

  // ── فحص رابط ──
  if(state.mode==="vt_scan"){
    delete DB.state[uid];
    await ctx.reply("⏳ *جاري الفحص...*",{parse_mode:"Markdown"});
    const stats=await vtScan(text);
    if(!stats) return ctx.reply("❌ تعذر الفحص. تأكد من صحة الرابط.",{...mainKb()});
    const mal=stats.malicious||0, sus=stats.suspicious||0, clean=stats.harmless||0;
    const verdict=mal>0?"🔴 خطر":sus>0?"🟡 مشبوه":"🟢 آمن";
    return ctx.reply(
      `🔍 *نتيجة الفحص:*\n\n🔗 \`${text.slice(0,60)}\`\n\n${verdict}\n\n🔴 ضار: *${mal}*\n🟡 مشبوه: *${sus}*\n🟢 نظيف: *${clean}*`,
      {parse_mode:"Markdown",...mainKb()}
    );
  }

  // ── حفظ اسم الإيميل ──
  if(state.mode==="save_email_label"){
    const{login,domain}=state;
    delete DB.state[uid];
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    DB.savedEmails[uid].push({login,domain,label:text,savedAt:stamp()});
    addLog("email_saved",uid,`${login}@${domain} | ${text}`);
    return ctx.reply(`✅ *تم حفظ الإيميل*\n\n📧 \`${login}@${domain}\`\n🏷 *${text}*`,{parse_mode:"Markdown",...emailActiveKb(login,domain)});
  }

  // ── حفظ كلمة سر (مع اسم منصة) ──
  if(state.mode==="store_pass_platform"){
    const pass=state.pass;
    delete DB.state[uid];
    if(!DB.savedPasswords[uid]) DB.savedPasswords[uid]=[];
    DB.savedPasswords[uid].push({platform:text,password:pass,savedAt:stamp()});
    addLog("pass_saved",uid,text);
    return ctx.reply(`✅ *تم الحفظ!*\n\n🏷 *${text}*\n🔐 \`${pass}\``,{parse_mode:"Markdown",...mainKb()});
  }

  // ── حفظ كلمة سر مخصصة ──
  if(state.mode==="save_pass_custom"){
    DB.state[uid]={mode:"store_pass_platform",pass:text};
    return ctx.reply("✏️ أرسل اسم المنصة/الموقع:",{...Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","menu_passwords")]])});
  }

  // ── إعداد رقمي (المطور) ──
  if(state.mode==="dev_setting"){
    if(!isAdmin(uid))return;
    const val=parseInt(text);
    if(isNaN(val)||val<1) return ctx.reply("❌ قيمة غير صحيحة.");
    if(state.key==="ds_max")  DB.settings.maxPerDay=val;
    if(state.key==="ds_cool") DB.settings.cooldown=val;
    if(state.key==="ds_ref")  DB.settings.refBonus=val;
    delete DB.state[uid];
    addLog("settings",uid,`${state.key}=${val}`);
    return ctx.reply("✅ تم التحديث.",devSettingsKb());
  }

  // ── رسالة جماعية ──
  if(state.mode==="broadcast"){
    if(!isAdmin(uid))return;
    delete DB.state[uid];
    const ids=Object.keys(DB.users);
    await ctx.reply(`📢 جاري الإرسال لـ ${ids.length} عضو...`);
    let sent=0,fail=0;
    for(const id of ids){
      try{ await bot.telegram.sendMessage(parseInt(id),`📢 *رسالة من الإدارة:*\n\n${text}`,{parse_mode:"Markdown"}); sent++; await sleep(50); }
      catch{ fail++; }
    }
    addLog("broadcast",uid,`أُرسلت ${sent} | فشل ${fail}`);
    return ctx.reply(`✅ أُرسلت لـ *${sent}* | فشل *${fail}*`,{parse_mode:"Markdown",...devKb()});
  }
});

// ===================== بناء لوحة التصنيفات =====================
function buildCatsKb(svcs){
  const cats={};
  for(const[c]of Object.entries(svcs)){ const cat=getCat(c); cats[cat]=(cats[cat]||0)+1; }
  const rows=Object.entries(cats).map(([cat,n])=>[Markup.button.callback(`${cat} (${n})`,`cat:${cat}`)]);
  rows.push([Markup.button.callback("📋 عرض الكل","cat:all"),Markup.button.callback("🔍 بحث","search_mode")]);
  rows.push([Markup.button.callback("🔙 رجوع","back")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== تشغيل =====================
console.log("🚀 البوت يعمل...");
bot.launch();
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
