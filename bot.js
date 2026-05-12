"use strict";

// ============================================================
//  بوت تيليجرام شامل المطور v6.0
//  مع: قاعدة بيانات JSON | تحقق مرة واحدة | تسجيل دخول/إنشاء حساب
//  AI غير محدود | نظام قروبات متكامل | تحكم شامل للمطور
//  ✅ مُطوَّر ومُصحَّح بالكامل
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios  = require("axios");
const http   = require("http");
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

// ===================== الإعدادات =====================
const BOT_TOKEN   = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const MS_API_KEY  = "sk_jmXm1Im3hxzT7Lnf_6T6dD3ab7Xzf4ACe0or8TEqBNX9L6hwW9rw1ddfKtiGjs3bCyJTOKuQNKZ1mMSkV";
const MS_BASE     = "https://api.mailslurp.com";
const VT_KEY      = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
const UR_KEY      = "u3469811-ab163c31f24d6012491f0807";
const AI_KEY      = "sk-f7307872f8004ecd92c0764b0f03f7f5";
const AI_BASE     = "https://api.deepseek.com/v1";
const AI_MODEL    = "deepseek-chat";
const DEV_ID      = 7411444902;
const PORT        = process.env.PORT || 8080;
const DB_FILE     = "./database.json";

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
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.admins)) data.admins = new Set(data.admins);
      else data.admins = new Set([DEV_ID]);
      return data;
    }
  } catch(e) { console.error("loadDB error:", e.message); }
  return null;
}

function saveDB() {
  try {
    const toSave = { ...DB };
    toSave.admins = [...DB.admins];
    fs.writeFileSync(DB_FILE, JSON.stringify(toSave, null, 2), "utf8");
  } catch(e) { console.error("saveDB error:", e.message); }
}

setInterval(saveDB, 30000);

const defaultDB = {
  users:          {},
  sessions:       {},
  activeEmails:   {},
  savedEmails:    {},
  savedPasswords: {},
  emailHistory:   {},
  activityLog:    {},
  referrals:      {},
  referralOf:     {},
  referralPerks:  {},
  logs:           [],
  admins:         new Set([DEV_ID]),
  adminPerms:     {},
  announcements:  [],
  groups:         {},
  groupSettings:  {},
  groupMembers:   {},
  groupBanned:    {},
  groupMuted:     {},
  groupWatchwords:{},
  groupBadwords:  {},
  adminActionLog: {},
  aiConversations:{},
  aiModes:        {},
  notes:          {},
  reminders:      {},
  polls:          {},
  grpWelcome:     {},
  grpRules:       {},
  userNotes:      {},
  settings: {
    maxEmailsPerDay:      30,
    cooldown:             8,
    emailWatchMin:        25,
    refBonus:             5,
    maintenanceMode:      false,
    screenshotProtection: false,
    botName:              "بوت شامل v6",
    welcomeMsg:           "أهلاً بك في البوت! 🎉",
    aiEnabled:            true,
    maxAiMsgsPerDay:      100,
    autoDeleteBadwords:   true,
  },
  lastReq:  {},
  daily:    {},
  vtCache:  {},
  state:    {},
};

const loaded = loadDB();
const DB = loaded || defaultDB;
if (!DB.aiModes)    DB.aiModes = {};
if (!DB.notes)      DB.notes = {};
if (!DB.reminders)  DB.reminders = {};
if (!DB.polls)      DB.polls = {};
if (!DB.grpWelcome) DB.grpWelcome = {};
if (!DB.grpRules)   DB.grpRules = {};
if (!DB.userNotes)  DB.userNotes = {};
if (!DB.settings.aiEnabled)           DB.settings.aiEnabled = true;
if (!DB.settings.maxAiMsgsPerDay)     DB.settings.maxAiMsgsPerDay = 100;
if (DB.settings.autoDeleteBadwords === undefined) DB.settings.autoDeleteBadwords = true;
if (!loaded) {
  DB.admins = new Set([DEV_ID]);
  saveDB();
}

// ===================== مساعدات =====================
const now   = () => Math.floor(Date.now()/1000);
const today = () => new Date().toISOString().slice(0,10);
const stamp = () => new Date().toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function log(type, uid, text) {
  DB.logs.unshift({type,uid,text,time:stamp()});
  if(DB.logs.length>3000) DB.logs.pop();
  if(!DB.activityLog[uid]) DB.activityLog[uid]=[];
  DB.activityLog[uid].unshift({action:type,detail:text,time:stamp()});
  if(DB.activityLog[uid].length>200) DB.activityLog[uid].pop();
}

function ensureUser(ctx) {
  const u = ctx.from;
  if(!DB.users[u.id]){
    DB.users[u.id]={
      name:u.first_name||"مجهول", username:u.username||"",
      joinedAt:stamp(), banned:false, muted:false, role:"user",
      passwordHash:null, accountEmail:null, accountPassword:null,
      lastSeen:stamp(), msgCount:0, verified:false,
      aiMsgCount:0, aiMsgDate:"",
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

function aiDailyCount(id){
  const u=DB.users[id];
  if(!u) return 0;
  if(u.aiMsgDate!==today()){ u.aiMsgCount=0; u.aiMsgDate=today(); }
  return u.aiMsgCount||0;
}
function incAiDaily(id){
  const u=DB.users[id];
  if(!u) return;
  if(u.aiMsgDate!==today()){ u.aiMsgCount=0; u.aiMsgDate=today(); }
  u.aiMsgCount=(u.aiMsgCount||0)+1;
}

function hashPass(p){ return crypto.createHash("sha256").update(p+"SALT_V5").digest("hex"); }
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

function genAccountEmail(){
  const names=["user","bot","temp","mail","acc","alpha","pro"];
  const name=names[Math.floor(Math.random()*names.length)];
  return `${name}${randStr(6)}@botaccount.io`;
}

function passwordStrength(p){
  let score=0;
  if(p.length>=8) score++;
  if(p.length>=12) score++;
  if(/[A-Z]/.test(p)) score++;
  if(/[a-z]/.test(p)) score++;
  if(/[0-9]/.test(p)) score++;
  if(/[^A-Za-z0-9]/.test(p)) score++;
  if(score<=2) return {label:"ضعيفة 🔴",score};
  if(score<=4) return {label:"متوسطة 🟡",score};
  return {label:"قوية 🟢",score};
}

// ===================== MailSlurp =====================
async function msCreateInbox(expiresInMinutes=25) {
  for(let attempt=1;attempt<=3;attempt++){
    try {
      const expiresAt=new Date(Date.now()+expiresInMinutes*60*1000).toISOString();
      const r=await axios.post(`${MS_BASE}/inboxes`,
        {expiresAt,useDomainPool:true,isPublic:false,inboxType:"HTTP_INBOX"},
        {headers:msHeaders,timeout:20000});
      if(!r.data?.emailAddress||!r.data?.id) continue;
      return {email:r.data.emailAddress,inboxId:r.data.id,expiresAt:r.data.expiresAt};
    } catch(e){
      if(e.response?.status===401) return null;
      if(attempt<3) await sleep(2000);
    }
  }
  return null;
}

async function msGetEmails(inboxId,since) {
  try {
    const params={inboxId,size:20,sort:"DESC",unreadOnly:false};
    if(since) params.since=since;
    const r=await axios.get(`${MS_BASE}/emails`,{headers:msHeaders,params,timeout:15000});
    const content=r.data?.content??r.data;
    return Array.isArray(content)?content:[];
  } catch(e){ return []; }
}

async function msGetEmail(emailId) {
  try {
    const r=await axios.get(`${MS_BASE}/emails/${emailId}`,{headers:msHeaders,timeout:10000});
    return r.data;
  } catch(e){ return null; }
}

async function msDeleteInbox(inboxId) {
  try { await axios.delete(`${MS_BASE}/inboxes/${inboxId}`,{headers:msHeaders,timeout:10000}); return true; }
  catch(e){ return false; }
}

function extractOTP(text) {
  if(!text) return [];
  const clean=text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
  const patterns=[
    /(?:verification|confirm|otp|code|رمز|كود|pin|token)[^0-9A-Z]*([A-Z0-9]{4,10})/gi,
    /\b([0-9]{4,8})\b/g,
    /([A-Z0-9]{6,10})\b/g,
  ];
  const found=new Set();
  for(const pat of patterns){
    for(const m of [...clean.matchAll(pat)]) if(m[1]&&m[1].length>=4) found.add(m[1]);
  }
  return [...found].slice(0,5);
}

async function emailWatcher(bot,uid,emailData,chatId) {
  const {email,inboxId,createdAt}=emailData;
  const endTime=now()+DB.settings.emailWatchMin*60;
  const seenIds=new Set();
  let sinceTime=new Date(createdAt*1000).toISOString();
  while(now()<endTime){
    if(!DB.activeEmails[uid]||DB.activeEmails[uid].inboxId!==inboxId) return;
    await sleep(5000);
    let emails=[];
    try{ emails=await msGetEmails(inboxId,sinceTime); }catch(e){ continue; }
    for(const preview of emails){
      const eid=String(preview.id);
      if(seenIds.has(eid)) continue;
      seenIds.add(eid);
      if(preview.createdAt) sinceTime=preview.createdAt;
      const fullEmail=await msGetEmail(eid);
      if(!fullEmail) continue;
      const subject=fullEmail.subject||preview.subject||"بدون موضوع";
      const from=fullEmail.from||preview.from||"—";
      const body=fullEmail.body||fullEmail.bodyPlainText||"";
      const otps=extractOTP(body);
      const otpText=otps.length?`\n\n🔑 *الكود:*\n${otps.map(c=>`\`${c}\``).join("  ")}`:"";
      const cleanBody=body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,1500);
      log("email_received",uid,`${email}|${subject}`);
      if(DB.emailHistory[uid]){
        const idx=DB.emailHistory[uid].findIndex(e=>e.email===email);
        if(idx>=0) DB.emailHistory[uid][idx].msgCount=(DB.emailHistory[uid][idx].msgCount||0)+1;
      }
      try{
        const msgOpts={parse_mode:"Markdown",...emailActiveKb(email,inboxId)};
        if(DB.settings.screenshotProtection) msgOpts.protect_content=true;
        await bot.telegram.sendMessage(chatId,
          `📧 *وصلت رسالة جديدة!*\n\n📬 *من:* \`${from}\`\n📋 *الموضوع:* ${subject}`+otpText+
          `\n\n📝 *المحتوى:*\n\`\`\`\n${cleanBody||"(فارغ)"}\n\`\`\``,msgOpts);
      }catch(e){}
    }
  }
  if(DB.activeEmails[uid]?.inboxId===inboxId){
    await msDeleteInbox(inboxId);
    delete DB.activeEmails[uid];
    saveDB();
    try{ await bot.telegram.sendMessage(chatId,`⏰ *انتهت مدة الإيميل*\n\n\`${email}\`\n\nأنشئ جديداً 📧`,{parse_mode:"Markdown",...mainKb()}); }catch{}
  }
}

// ===================== AI (DeepSeek) =====================
const AI_SYSTEMS = {
  general:  "أنت مساعد ذكي خبير ومتعدد المهارات. أجب باللغة العربية بشكل مختصر ومفيد. أنت مساعد AI متقدم.",
  code:     "أنت مبرمج خبير متخصص في البرمجة. اشرح الكود وصحح الأخطاء وأكتب برامج احترافية. استخدم اللغة العربية في الشرح وأكتب الكود بالإنجليزية.",
  translate:"أنت مترجم محترف متعدد اللغات. ترجم بدقة عالية مع الحفاظ على المعنى والأسلوب. إذا لم تُحدد اللغة، ترجم للإنجليزية إذا كان النص عربياً والعكس.",
  creative: "أنت كاتب مبدع متخصص في الشعر والقصص والمحتوى الأدبي. أكتب بأسلوب إبداعي جميل باللغة العربية.",
  analysis: "أنت محلل بيانات وأعمال خبير. حلل المعلومات وقدم رؤى عميقة وتوصيات مبنية على المنطق والحقائق.",
};

const AI_MODE_LABELS = {
  general:  "🤖 عام",
  code:     "💻 برمجة",
  translate:"🌐 ترجمة",
  creative: "✍️ إبداعي",
  analysis: "📊 تحليل",
};

async function aiChat(uid, userMessage) {
  if(!DB.aiConversations[uid]) DB.aiConversations[uid]=[];
  const mode = DB.aiModes[uid] || "general";
  const systemPrompt = AI_SYSTEMS[mode] || AI_SYSTEMS.general;

  DB.aiConversations[uid].push({role:"user",content:userMessage});
  const messages=[
    {role:"system",content:systemPrompt},
    ...DB.aiConversations[uid].slice(-14)
  ];

  try {
    const r=await axios.post(`${AI_BASE}/chat/completions`,{
      model: AI_MODEL,
      messages,
      max_tokens: 3000,
      temperature: mode==="translate"?0.3:mode==="code"?0.2:0.7,
      stream: false,
    },{
      headers:{
        "Authorization":`Bearer ${AI_KEY}`,
        "Content-Type":"application/json",
        "Accept":"application/json",
      },
      timeout:90000,
      validateStatus: s=>s<500,
    });

    if(r.status===401||r.status===403){ DB.aiConversations[uid].pop(); return "❌ مفتاح الذكاء الاصطناعي غير صالح."; }
    if(r.status===429){ DB.aiConversations[uid].pop(); return "⏳ تم تجاوز حد الطلبات."; }
    if(!r.data?.choices?.length){ DB.aiConversations[uid].pop(); return "❌ لم أتلقَّ رداً."; }

    const reply=r.data.choices[0].message?.content?.trim()||"لم أتمكن من الرد.";
    DB.aiConversations[uid].push({role:"assistant",content:reply});
    if(DB.aiConversations[uid].length>28) DB.aiConversations[uid]=DB.aiConversations[uid].slice(-28);
    incAiDaily(uid);
    return reply;
  } catch(e){
    DB.aiConversations[uid].pop();
    const status=e.response?.status;
    if(status===401||status===403) return "❌ مفتاح الذكاء الاصطناعي غير صالح.";
    if(status===429) return "⏳ تم تجاوز حد الطلبات.";
    if(e.code==="ECONNABORTED"||e.code==="ETIMEDOUT") return "⏱ انتهت مهلة الاتصال.";
    return "❌ خطأ في الاتصال بالذكاء الاصطناعي.";
  }
}

// ===================== VirusTotal =====================
async function vtScanUrl(url) {
  const cacheKey=`url_${Buffer.from(url).toString("base64").slice(0,30)}`;
  if(DB.vtCache[cacheKey]&&now()-DB.vtCache[cacheKey].ts<3600) return DB.vtCache[cacheKey].result;
  try {
    const submitRes=await axios.post("https://www.virustotal.com/api/v3/urls",
      new URLSearchParams({url}).toString(),
      {headers:{"x-apikey":VT_KEY,"Content-Type":"application/x-www-form-urlencoded"},timeout:15000});
    const analysisId=submitRes.data?.data?.id;
    if(analysisId){
      await sleep(3000);
      const analysisRes=await axios.get(`https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        {headers:{"x-apikey":VT_KEY},timeout:12000});
      const attr=analysisRes.data?.data?.attributes||{};
      const result={stats:attr.stats||{},reputation:0,malEngines:Object.entries(attr.results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5)};
      DB.vtCache[cacheKey]={result,ts:now()};
      return result;
    }
  }catch(e){}
  try {
    const enc=Buffer.from(url).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const r=await axios.get(`https://www.virustotal.com/api/v3/urls/${enc}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr=r.data?.data?.attributes||{};
    const result={stats:attr.last_analysis_stats||{},reputation:attr.reputation||0,malEngines:[]};
    DB.vtCache[cacheKey]={result,ts:now()};
    return result;
  }catch{ return null; }
}

async function vtScanDomain(domain) {
  try {
    const r=await axios.get(`https://www.virustotal.com/api/v3/domains/${domain}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr=r.data?.data?.attributes||{};
    return {stats:attr.last_analysis_stats||{},reputation:attr.reputation||0,registrar:attr.registrar||"—",created:attr.creation_date?new Date(attr.creation_date*1000).toLocaleDateString("ar"):"—",malEngines:Object.entries(attr.last_analysis_results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5)};
  }catch{ return null; }
}

async function vtScanIp(ip) {
  try {
    const r=await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr=r.data?.data?.attributes||{};
    return {stats:attr.last_analysis_stats||{},reputation:attr.reputation||0,country:attr.country||"—",asOwner:attr.as_owner||"—",malEngines:Object.entries(attr.last_analysis_results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5)};
  }catch{ return null; }
}

async function vtUploadFile(buffer,filename) {
  try {
    const FormData=require("form-data");
    const form=new FormData();
    form.append("file",buffer,{filename:filename||"file"});
    const r=await axios.post("https://www.virustotal.com/api/v3/files",form,
      {headers:{...form.getHeaders(),"x-apikey":VT_KEY},timeout:120000,maxContentLength:Infinity,maxBodyLength:Infinity});
    return r.data?.data?.id||null;
  }catch(e){ return null; }
}

async function vtGetAnalysis(id) {
  try {
    for(let i=0;i<10;i++){
      const r=await axios.get(`https://www.virustotal.com/api/v3/analyses/${id}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
      const attr=r.data?.data?.attributes;
      if(attr?.status==="completed") return attr;
      await sleep(5000);
    }
  }catch(e){}
  return null;
}

// ===================== نظام تتبع عضوية القروبات =====================
async function getTelegramMemberStatus(gid, uid) {
  try { return await bot.telegram.getChatMember(gid, uid); } catch(e) { return null; }
}

async function syncMemberRole(gid, uid) {
  const member = await getTelegramMemberStatus(gid, uid);
  if(!member) return null;
  if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};
  const status = member.status;
  const existing = DB.groupMembers[gid][uid]||{};
  DB.groupMembers[gid][uid] = {
    ...existing,
    id: uid,
    name: member.user.first_name||existing.name||String(uid),
    username: member.user.username||existing.username||"",
    status,
    isAdmin: status==="administrator"||status==="creator",
    isOwner: status==="creator",
    adminPerms: status==="administrator"?{
      can_manage_chat: member.can_manage_chat||false,
      can_delete_messages: member.can_delete_messages||false,
      can_restrict_members: member.can_restrict_members||false,
      can_promote_members: member.can_promote_members||false,
      can_change_info: member.can_change_info||false,
      can_invite_users: member.can_invite_users||false,
      can_pin_messages: member.can_pin_messages||false,
      can_post_messages: member.can_post_messages||false,
      is_anonymous: member.is_anonymous||false,
    }:null,
    customTitle: member.custom_title||null,
    lastSync: stamp(),
  };
  return DB.groupMembers[gid][uid];
}

function getUserGroupsInfo(uid) {
  const result=[];
  for(const [gid,g] of Object.entries(DB.groups)){
    const memberData = DB.groupMembers[gid]?.[uid];
    if(memberData && memberData.status!=="left" && memberData.status!=="kicked"){
      result.push({
        gid,
        title: g.title||"قروب",
        status: memberData.status,
        isAdmin: memberData.isAdmin||false,
        isOwner: memberData.isOwner||false,
        adminPerms: memberData.adminPerms||null,
        customTitle: memberData.customTitle||null,
        joinedAt: memberData.joinedAt||"—",
      });
    }
  }
  return result;
}

function describeRole(memberData) {
  if(!memberData) return "غير عضو";
  const s=memberData.status;
  if(s==="creator") return "👑 مالك القروب";
  if(s==="administrator"){
    const p=memberData.adminPerms||{};
    const parts=[];
    if(p.can_delete_messages) parts.push("حذف رسائل");
    if(p.can_restrict_members) parts.push("تقييد أعضاء");
    if(p.can_promote_members) parts.push("ترقية مشرفين");
    if(p.can_pin_messages) parts.push("تثبيت رسائل");
    if(p.can_invite_users) parts.push("دعوة أعضاء");
    if(p.can_manage_chat) parts.push("إدارة القروب");
    if(p.is_anonymous) parts.push("مجهول الهوية");
    const title=memberData.customTitle?` "${memberData.customTitle}"`:"";
    return `⭐ مشرف${title}${parts.length?`\n   📋 صلاحيات: ${parts.join(", ")}`:"\n   📋 بلا صلاحيات إضافية"}`;
  }
  if(s==="member") return "👤 عضو عادي";
  if(s==="restricted") return "⚠️ مقيّد";
  if(s==="left") return "🚶 غادر";
  if(s==="kicked") return "🚫 مطرود";
  return s;
}

async function syncGroupAdmins(gid) {
  try {
    const admins = await bot.telegram.getChatAdministrators(gid);
    if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};
    for(const m of admins){
      const uid=m.user.id;
      const existing=DB.groupMembers[gid][uid]||{};
      DB.groupMembers[gid][uid]={
        ...existing,
        id:uid,
        name:m.user.first_name||existing.name||String(uid),
        username:m.user.username||existing.username||"",
        status:m.status,
        isAdmin:true,
        isOwner:m.status==="creator",
        adminPerms:m.status==="administrator"?{
          can_manage_chat:m.can_manage_chat||false,
          can_delete_messages:m.can_delete_messages||false,
          can_restrict_members:m.can_restrict_members||false,
          can_promote_members:m.can_promote_members||false,
          can_change_info:m.can_change_info||false,
          can_invite_users:m.can_invite_users||false,
          can_pin_messages:m.can_pin_messages||false,
          can_post_messages:m.can_post_messages||false,
          is_anonymous:m.is_anonymous||false,
        }:null,
        customTitle:m.custom_title||null,
        isBot:m.user.is_bot||false,
        lastSync:stamp(),
      };
      if(m.status==="creator"&&DB.groups[gid]) DB.groups[gid].ownerId=uid;
    }
    saveDB();
    return admins;
  } catch(e){ return []; }
}

async function getMonitors() {
  try {
    const r=await axios.post("https://api.uptimerobot.com/v2/getMonitors",
      `api_key=${UR_KEY}&format=json&response_times=1&all_time_uptime_ratio=1`,
      {headers:{"Content-Type":"application/x-www-form-urlencoded"},timeout:10000});
    return r.data?.monitors||[];
  }catch{ return []; }
}

// ===================== لوحات المفاتيح =====================
const mainKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback("📧 إيميل مؤقت","menu_emails"), Markup.button.callback("🤖 تحدث مع AI","menu_ai")],
  [Markup.button.callback("🔑 كلمات السر","menu_passwords"), Markup.button.callback("🔍 فحص أمان","menu_vt")],
  [Markup.button.callback("🌐 مراقبة مواقع","menu_uptime"), Markup.button.callback("📝 ملاحظاتي","menu_notes")],
  [Markup.button.callback("📊 إحصائياتي","my_stats"), Markup.button.callback("🎁 الإحالة","referral")],
  [Markup.button.callback("📋 سجلي","my_history"), Markup.button.callback("👤 حسابي","my_account")],
  [Markup.button.callback("ℹ️ مساعدة","help")],
]);

const backKb=()=>Markup.inlineKeyboard([[Markup.button.callback("🔙 الرئيسية","back")]]);

const emailActiveKb=(email,inboxId)=>Markup.inlineKeyboard([
  [Markup.button.callback("📨 فتح الصندوق",`inbox:${inboxId}`), Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)],
  [Markup.button.callback("💾 حفظ الإيميل",`save_email:${inboxId}:${email}`), Markup.button.callback("🗑 إنهاء",`del_email:${inboxId}`)],
  [Markup.button.callback("📋 نسخ العنوان",`copy_email:${email}`), Markup.button.callback("🔙 الرئيسية","back")],
]);

const devKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback("👥 الأعضاء","dev_users"), Markup.button.callback("📊 إحصائيات","dev_stats")],
  [Markup.button.callback("📜 السجل","dev_logs"), Markup.button.callback("📢 رسالة جماعية","dev_broadcast")],
  [Markup.button.callback("🔨 حظر","dev_ban"), Markup.button.callback("✅ رفع حظر","dev_unban")],
  [Markup.button.callback("🔇 كتم","dev_mute"), Markup.button.callback("🔊 رفع كتم","dev_unmute")],
  [Markup.button.callback("⭐ ترقية مسؤول","dev_promote"), Markup.button.callback("⬇️ تخفيض","dev_demote")],
  [Markup.button.callback("🏘 إدارة القروبات","dev_groups"), Markup.button.callback("🛡 المسؤولون","dev_admins")],
  [Markup.button.callback("📣 إعلانات","dev_announce"), Markup.button.callback("🔍 بحث عضو","dev_search_user")],
  [Markup.button.callback("⚙️ إعدادات","dev_settings"), Markup.button.callback("🤖 تخصيص البوت","dev_customize")],
  [Markup.button.callback("💾 نسخ احتياطي","dev_backup"), Markup.button.callback("🤖 إعدادات AI","dev_ai_settings")],
  [Markup.button.callback("📈 تقرير أسبوعي","dev_weekly_report")],
]);

const devSettingsKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback(`🔧 الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,"ds_maint")],
  [Markup.button.callback(`📧 الحد اليومي: ${DB.settings.maxEmailsPerDay}`,"ds_max"), Markup.button.callback(`⏱ الانتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`⏰ مراقبة: ${DB.settings.emailWatchMin}د`,"ds_watch"), Markup.button.callback(`🎁 مكافأة: ${DB.settings.refBonus}`,"ds_ref")],
  [Markup.button.callback(`🛡 حماية لقطات: ${DB.settings.screenshotProtection?"✅":"❌"}`,"ds_screenshot")],
  [Markup.button.callback(`🤖 AI: ${DB.settings.aiEnabled?"✅":"❌"}`,"ds_ai_toggle"), Markup.button.callback(`🗑 حذف كلمات الإساءة: ${DB.settings.autoDeleteBadwords?"✅":"❌"}`,"ds_autodel")],
  [Markup.button.callback(`💬 حد AI/يوم: ${DB.settings.maxAiMsgsPerDay}`,"ds_ai_limit")],
  [Markup.button.callback("🔙 لوحة","dev_panel")],
]);

function groupControlKb(gid, uid) {
  const g = DB.groups[gid]||{};
  const isOwner = g.ownerId == uid || isDev(uid);
  const rows = [
    [Markup.button.callback("👥 الأعضاء",`grp_members:${gid}`), Markup.button.callback("👑 المشرفون",`grp_admins:${gid}`)],
    [Markup.button.callback("🔍 تحقق من رتبة",`grp_check_role:${gid}`), Markup.button.callback("🔄 تحديث المشرفين",`grp_sync_admins:${gid}`)],
    [Markup.button.callback("🚫 طرد عضو",`grp_kick:${gid}`), Markup.button.callback("🔇 كتم عضو",`grp_mute_member:${gid}`)],
    [Markup.button.callback("🔊 رفع كتم",`grp_unmute_member:${gid}`), Markup.button.callback("🚷 حظر عضو",`grp_ban_member:${gid}`)],
    [Markup.button.callback("✅ رفع حظر",`grp_unban_member:${gid}`), Markup.button.callback("📊 إحصائيات",`grp_stats:${gid}`)],
    [Markup.button.callback("👁 كلمات مراقبة",`grp_watchwords:${gid}`), Markup.button.callback("🚨 كلمات إساءة",`grp_badwords:${gid}`)],
    [Markup.button.callback("👋 رسالة ترحيب",`grp_welcome:${gid}`), Markup.button.callback("📋 قواعد القروب",`grp_rules:${gid}`)],
    [Markup.button.callback("📢 إرسال رسالة",`msg_group:${gid}`), Markup.button.callback("🔗 رابط دعوة",`group_link:${gid}`)],
  ];
  if(isOwner){
    rows.push([Markup.button.callback("⭐ ترقية مشرف",`grp_promote:${gid}`), Markup.button.callback("⬇️ إزالة مشرف",`grp_demote:${gid}`)]);
    rows.push([Markup.button.callback("🛡 حماية البوتات",`grp_antibot:${gid}`), Markup.button.callback("⚙️ إعدادات الحماية",`grp_protection:${gid}`)]);
    rows.push([Markup.button.callback("🗑 حذف من القائمة",`del_group:${gid}`)]);
  }
  rows.push([Markup.button.callback("🔙 رجوع","dev_groups")]);
  return Markup.inlineKeyboard(rows);
}

function usersKb(action,page=0) {
  const pp=8;
  const ids=Object.keys(DB.users);
  const rows=ids.slice(page*pp,(page+1)*pp).map(id=>{
    const u=DB.users[id];
    const b=u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤";
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

// ─── تتبع القروبات ───
bot.on("my_chat_member", async ctx=>{
  try {
    const chat=ctx.chat;
    if(chat.type==="group"||chat.type==="supergroup"){
      const gid=String(chat.id);
      if(!DB.groups[gid]){
        DB.groups[gid]={
          title:chat.title||"قروب",id:gid,type:chat.type,
          joinedAt:stamp(),members:0,ownerId:null,
          addedBy:ctx.myChatMember?.from?.id||null,
        };
      }
      try { const fullChat = await bot.telegram.getChat(gid); DB.groups[gid].title = fullChat.title||DB.groups[gid].title; }catch{}
      await syncGroupAdmins(gid);
      log("group_join",DEV_ID,chat.title);
      saveDB();
      try{ await bot.telegram.sendMessage(DEV_ID,`🆕 *تمت إضافة البوت لقروب جديد!*\n\n🏘 *${chat.title}*\n🆔 \`${gid}\`\n📅 ${stamp()}`,{parse_mode:"Markdown"}); }catch{}
    }
  }catch(e){}
});

// ─── تتبع الأعضاء الجدد ───
bot.on("chat_member", async ctx=>{
  try {
    const chat=ctx.chat; const member=ctx.chatMember; const gid=String(chat.id);
    if(!DB.groups[gid]) DB.groups[gid]={title:chat.title||"قروب",id:gid,type:chat.type,joinedAt:stamp(),members:0,ownerId:null};
    if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};
    const user=member.new_chat_member?.user||member.from;
    if(!user) return;
    const uid=user.id; const status=member.new_chat_member?.status; const oldStatus=member.old_chat_member?.status; const inviter=member.from;

    if(["member","restricted"].includes(status)&&["left","kicked",""].includes(oldStatus||"")){
      DB.groupMembers[gid][uid]={name:user.first_name||"مجهول",username:user.username||"",id:uid,joinedAt:stamp(),addedBy:inviter?.id||null,addedByName:inviter?.first_name||"—",status:"member",isAdmin:false,isOwner:false,adminPerms:null,isBot:user.is_bot||false};
      const welcomeMsg = DB.grpWelcome[gid];
      if(welcomeMsg && !user.is_bot){
        try{
          const personalMsg = welcomeMsg.replace("{name}", user.first_name||"عزيزي").replace("{username}", user.username ? `@${user.username}` : user.first_name||"").replace("{group}", chat.title||"");
          await bot.telegram.sendMessage(gid, personalMsg, {parse_mode:"Markdown"});
        }catch{}
      }
      if(user.is_bot && DB.groupSettings[gid]?.antiBot){ try{ await bot.telegram.banChatMember(gid,uid); await bot.telegram.sendMessage(gid,`🛡 تم إزالة البوت @${user.username||uid} تلقائياً`); }catch{} }
      if(inviter && inviter.id !== uid && DB.groupSettings[gid]?.antiSpamAdd){
        const addKey=`addcount_${gid}_${inviter.id}_${Math.floor(Date.now()/60000)}`;
        DB.daily[addKey]=(DB.daily[addKey]||0)+1;
        if(DB.daily[addKey]>5){ try{ await bot.telegram.promoteChatMember(gid,inviter.id,{can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,can_promote_members:false,can_change_info:false,can_invite_users:false,can_pin_messages:false}); await bot.telegram.sendMessage(gid,`⚠️ تم إزالة صلاحيات @${inviter.username||inviter.id} بسبب الإضافة المتكررة`); }catch{} }
      }
      saveDB();
    }

    if(status==="administrator"||status==="creator"){ await syncMemberRole(gid, uid); if(status==="creator"&&DB.groups[gid]) DB.groups[gid].ownerId=uid; }
    if(oldStatus==="administrator"&&status==="member"){
      if(DB.groupMembers[gid][uid]){ DB.groupMembers[gid][uid].status="member"; DB.groupMembers[gid][uid].isAdmin=false; DB.groupMembers[gid][uid].adminPerms=null; }
      if(DB.groupSettings[gid]?.monitorDemote){
        const demoteKey=`demotecount_${gid}_${inviter?.id}_${today()}`; DB.daily[demoteKey]=(DB.daily[demoteKey]||0)+1;
        if(DB.daily[demoteKey]>=(DB.groupSettings[gid]?.demoteLimit||3)){ try{ await bot.telegram.promoteChatMember(gid,inviter.id,{can_manage_chat:false,can_delete_messages:false,can_restrict_members:false}); await bot.telegram.sendMessage(gid,`⚠️ تم إزالة صلاحيات @${inviter?.username||inviter?.id} بسبب تكرار إزالة المشرفين`); }catch{} }
      }
    }
    if(status==="left"||status==="kicked"){ if(DB.groupMembers[gid][uid]) DB.groupMembers[gid][uid].status=status; }
    saveDB();
  }catch(e){}
});

// ─── مراقبة رسائل القروبات ───
bot.on("message", async(ctx,next)=>{
  try {
    const chat=ctx.chat;
    if(chat&&(chat.type==="group"||chat.type==="supergroup")){
      const gid=String(chat.id); const uid=ctx.from?.id; const text=ctx.message?.text||ctx.message?.caption||"";
      if(!uid) return next();
      if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};
      if(!DB.groupMembers[gid][uid]) DB.groupMembers[gid][uid]={name:ctx.from.first_name||"مجهول",username:ctx.from.username||"",id:uid,joinedAt:stamp(),status:"member",isAdmin:false,isOwner:false,adminPerms:null,isBot:false};
      if(!text) return next();
      const memberData=DB.groupMembers[gid]?.[uid];
      const isGroupAdmin=memberData?.isAdmin||memberData?.isOwner||memberData?.status==="creator"||memberData?.status==="administrator";
      if(!isGroupAdmin){
        const badwords=DB.groupBadwords[gid]||[];
        const ltext=text.toLowerCase();
        if(badwords.some(w=>ltext.includes(w.toLowerCase()))){
          try{
            if(DB.settings.autoDeleteBadwords) await ctx.deleteMessage();
            await bot.telegram.restrictChatMember(gid,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+300});
            const warnMsg = await ctx.reply(`⚠️ @${ctx.from.username||ctx.from.first_name} رسالتك تحتوي على كلمات محظورة. تم كتمك 5 دقائق.`);
            setTimeout(async()=>{ try{ await bot.telegram.deleteMessage(gid, warnMsg.message_id); }catch{} }, 10000);
          }catch{}
        }
      }
      const watchwords=DB.groupWatchwords[gid]||[];
      const ltext2=text.toLowerCase();
      if(watchwords.some(w=>ltext2.includes(w.toLowerCase()))){
        const g=DB.groups[gid]||{}; const ownerId=g.ownerId||DEV_ID; const senderRole=isGroupAdmin?"⭐ مشرف":"👤 عضو";
        try{ await bot.telegram.sendMessage(ownerId,`👁 *كلمة مراقبة رُصدت*\n\n🏘 القروب: *${g.title||gid}*\n${senderRole}: ${ctx.from.first_name} [${uid}]\n@${ctx.from.username||"—"}\n📝 الرسالة:\n${text.slice(0,300)}`,{parse_mode:"Markdown"}); }catch{}
      }
      if(!DB.groups[gid].msgCount) DB.groups[gid].msgCount=0;
      DB.groups[gid].msgCount++;
    }
  }catch(e){}
  return next();
});

// ─── Middleware عام ───
bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid=ctx.from.id;
  if(ctx.chat&&(ctx.chat.type==="group"||ctx.chat.type==="supergroup")){
    const gid=String(ctx.chat.id);
    if(!DB.groups[gid]) DB.groups[gid]={title:ctx.chat.title||"قروب",id:gid,type:ctx.chat.type,joinedAt:stamp(),members:0,ownerId:null,msgCount:0};
  }
  if(isBanned(uid)&&!isDev(uid)){ try{ await ctx.reply("🚫 أنت محظور من استخدام البوت."); }catch{} return; }
  if(DB.settings.maintenanceMode&&!isAdmin(uid)){ try{ await ctx.reply("🔧 البوت في وضع الصيانة. سيعود قريباً."); }catch{} return; }
  return next();
});

// ===================== /start =====================
bot.start(async ctx=>{
  const uid=ctx.from.id; delete DB.state[uid]; const payload=ctx.startPayload;
  if(payload?.startsWith("ref_")){
    const rid=parseInt(payload.slice(4));
    if(rid!==uid&&!DB.referralOf[uid]){
      DB.referralOf[uid]=rid; if(!DB.referrals[rid]) DB.referrals[rid]=[]; DB.referrals[rid].push(uid);
      if(!DB.referralPerks[rid]) DB.referralPerks[rid]={extra:0}; DB.referralPerks[rid].extra+=DB.settings.refBonus;
      log("referral",rid,`أحال ${uid}`);
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق! +${DB.settings.refBonus} إيميلات إضافية`); }catch{}
    }
  }
  log("start",uid,DB.users[uid]?.name);
  if(isDev(uid)) return ctx.reply(`👑 *مرحباً بالمطور!*\n\n🤖 *${DB.settings.botName}*\n👥 الأعضاء: *${Object.keys(DB.users).length}*\n🏘 القروبات: *${Object.keys(DB.groups).length}*\n⭐ المسؤولون: *${DB.admins.size-1}*\n📊 السجلات: *${DB.logs.length}*`,{parse_mode:"Markdown",...devKb()});
  const user=DB.users[uid];
  if(user?.verified) return showMain(ctx);
  const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
  if(!DB.sessions[uid]) DB.sessions[uid]={}; DB.sessions[uid].captchaAns=n1+n2; DB.state[uid]={mode:"captcha"};
  return ctx.reply(`👋 *${DB.settings.welcomeMsg}*\n\n🤖 للتحقق أنك لست روبوت (مرة واحدة فقط):\n\n🔢 *${n1} + ${n2} = ?*`,{parse_mode:"Markdown"});
});

async function showMain(ctx){
  const uid=ctx.from.id; const ann=DB.announcements[0];
  let txt=`🏠 *القائمة الرئيسية*\nأهلاً *${ctx.from.first_name}* 👋`;
  if(ann) txt+=`\n\n📣 *إعلان:* ${ann}`;
  if(DB.settings.screenshotProtection) txt+=`\n\n🛡 _الحماية مفعّلة_`;
  const opts={parse_mode:"Markdown",...mainKb()};
  if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
  await ctx.reply(txt,opts);
}

async function showRegisterOrLogin(ctx){
  return ctx.reply(`✅ *تم التحقق بنجاح!*\n\n🎉 أهلاً بك!\nاختر العملية التالية:`,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("✨ إنشاء حساب جديد","register_new")],[Markup.button.callback("🔑 تسجيل دخول (استعادة حساب)","login_existing")]])});
}

// ─── الأوامر ───
bot.command("dev", async ctx=>{ if(!isDev(ctx.from.id))return; ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("stats", async ctx=>{ if(!isAdmin(ctx.from.id))return; showDevStats(ctx); });
bot.command("stop", async ctx=>{ delete DB.state[ctx.from.id]; return ctx.reply("✅ تم الخروج.",mainKb()); });
bot.command("ai", async ctx=>{
  const uid=ctx.from.id; const user=DB.users[uid];
  if(!user?.verified&&!isDev(uid)) return ctx.reply("❌ يجب التسجيل أولاً.");
  DB.state[uid]={mode:"ai_chat"}; const mode=DB.aiModes[uid]||"general";
  return ctx.reply(`🤖 *مرحباً بك في الذكاء الاصطناعي!*\n\n🎯 الوضع الحالي: *${AI_MODE_LABELS[mode]}*\n💬 أرسل سؤالك الآن\n_اكتب /stop للخروج_`,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔄 تغيير الوضع","ai_change_mode")],[Markup.button.callback("❌ خروج","menu_ai_stop")]])});
});
bot.command("note", async ctx=>{
  const uid=ctx.from.id;
  if(!DB.users[uid]?.verified&&!isDev(uid)) return ctx.reply("❌ يجب التسجيل أولاً.");
  const text=ctx.message.text.slice(6).trim();
  if(!text) return ctx.reply("📝 الاستخدام: /note نص الملاحظة");
  if(!DB.notes[uid]) DB.notes[uid]=[];
  DB.notes[uid].unshift({text,time:stamp(),id:Date.now()});
  if(DB.notes[uid].length>50) DB.notes[uid].pop();
  saveDB();
  return ctx.reply(`✅ *تم حفظ الملاحظة!*\n\n📝 ${text}`,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("📝 كل ملاحظاتي","menu_notes")]])});
});
bot.command("id", async ctx=>{
  const uid=ctx.from.id; let txt=`🆔 *معرّفك:* \`${uid}\``;
  if(ctx.message.reply_to_message){ const r=ctx.message.reply_to_message.from; txt+=`\n\n👤 *معرّف الشخص المذكور:* \`${r.id}\`\n📛 ${r.first_name}`; }
  if(ctx.chat.type!=="private") txt+=`\n\n🏘 *معرّف القروب:* \`${ctx.chat.id}\``;
  return ctx.reply(txt,{parse_mode:"Markdown"});
});
bot.command("info", async ctx=>{
  const uid=ctx.from.id; const u=DB.users[uid]||{}; const mode=DB.aiModes[uid]||"general";
  return ctx.reply(`👤 *معلوماتك*\n\n🆔 \`${uid}\`\n📛 ${u.name||"—"}\n@${u.username||"—"}\n📅 انضممت: ${u.joinedAt||"—"}\n🏅 الدور: ${u.role||"user"}\n✅ التحقق: ${u.verified?"✅":"❌"}\n📧 إيميلات اليوم: ${dailyCount(uid)}/${maxDay(uid)}\n🤖 AI اليوم: ${aiDailyCount(uid)}/${DB.settings.maxAiMsgsPerDay}\n🎯 وضع AI: ${AI_MODE_LABELS[mode]}`,{parse_mode:"Markdown",...mainKb()});
});

async function showDevStats(ctx) {
  const total=Object.keys(DB.users).length; const banned=Object.values(DB.users).filter(u=>u.banned).length; const muted=Object.values(DB.users).filter(u=>u.muted).length; const verified=Object.values(DB.users).filter(u=>u.verified).length; const emails=Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0); const active=Object.keys(DB.activeEmails).length; const groups=Object.keys(DB.groups).length; const totalGroupMembers=Object.values(DB.groupMembers).reduce((a,gm)=>a+Object.keys(gm).length,0); const totalAiMsgs=Object.values(DB.aiConversations).reduce((a,c)=>a+c.length,0);
  const txt=`📊 *إحصائيات شاملة v6*\n\n👥 إجمالي الأعضاء: *${total}*\n✅ متحققون: *${verified}*\n🚫 المحظورون: *${banned}* | 🔇 المكتومون: *${muted}*\n⭐ المسؤولون: *${DB.admins.size}* | 🏘 القروبات: *${groups}*\n👥 إجمالي أعضاء القروبات: *${totalGroupMembers}*\n\n📧 إيميلات كلي: *${emails}* | نشطون الآن: *${active}*\n🤖 رسائل AI: *${totalAiMsgs}* | 📝 ملاحظات: *${Object.values(DB.notes).reduce((a,n)=>a+n.length,0)}*\n\n⚙️ *الإعدادات:*\n• الحد اليومي: ${DB.settings.maxEmailsPerDay}\n• المراقبة: ${DB.settings.emailWatchMin}د | الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}\n• 🛡 حماية لقطات: ${DB.settings.screenshotProtection?"✅":"❌"}\n• 🤖 AI: ${DB.settings.aiEnabled?"نشط ✅":"معطّل ❌"}`;
  if(ctx.callbackQuery) await ctx.editMessageText(txt,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  else await ctx.reply(txt,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
}

// ===================== الأزرار =====================
bot.on("callback_query", async ctx=>{
  await ctx.answerCbQuery().catch(()=>{});
  const data=ctx.callbackQuery.data; const uid=ctx.from.id;
  const edit=(t,ex={})=>ctx.editMessageText(t,{parse_mode:"Markdown",...ex}).catch(()=>ctx.reply(t,{parse_mode:"Markdown",...ex}));

  if(data==="noop") return;
  if(data==="back"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }
  if(data==="dev_panel"){ if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }

  // ─── إنشاء حساب / تسجيل دخول ───
  if(data==="register_new"){
    const accEmail=genAccountEmail(); const accPass=genStrongPass();
    DB.users[uid].accountEmail=accEmail; DB.users[uid].accountPassword=accPass; DB.users[uid].passwordHash=hashPass(accPass); DB.users[uid].verified=true;
    saveDB(); log("register",uid,accEmail);
    await ctx.reply(`✅ *تم إنشاء حسابك بنجاح!*\n\n📧 *الإيميل:* \`${accEmail}\`\n🔑 *كلمة السر:* \`${accPass}\`\n\n⚠️ *احفظهم جيداً!*\n💡 _يمكنك تغيير هذه البيانات في إعدادات حسابك_`,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("✅ فهمت، الرئيسية","goto_main")]])});
    return;
  }
  if(data==="goto_main"){ return showMain(ctx); }
  if(data==="login_existing"){ DB.state[uid]={mode:"login_email"}; return edit("📧 أدخل الإيميل المرتبط بحسابك:", Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","back")]])); }

  // ─── AI ───
  if(data==="menu_ai"){
    const user=DB.users[uid];
    if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    if(!DB.settings.aiEnabled&&!isAdmin(uid)) return edit("❌ الذكاء الاصطناعي معطّل حالياً.",backKb());
    DB.state[uid]={mode:"ai_chat"}; const convLen=(DB.aiConversations[uid]||[]).length; const mode=DB.aiModes[uid]||"general"; const aiToday=aiDailyCount(uid); const aiMax=DB.settings.maxAiMsgsPerDay;
    return edit(`🤖 *الذكاء الاصطناعي*\n\n🎯 الوضع: *${AI_MODE_LABELS[mode]}*\n💬 الرسائل في الجلسة: *${Math.floor(convLen/2)}*\n📊 اليوم: *${aiToday}/${isAdmin(uid)?"∞":aiMax}*\n\n_أرسل سؤالك الآن_`, Markup.inlineKeyboard([[Markup.button.callback("🔄 تغيير الوضع","ai_change_mode")],[Markup.button.callback("🗑 مسح المحادثة","ai_clear_conv"),Markup.button.callback("❌ خروج","back")]]));
  }
  if(data==="menu_ai_stop"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }
  if(data==="ai_clear_conv"){ DB.aiConversations[uid]=[]; saveDB(); return edit("✅ *تم مسح المحادثة.*", Markup.inlineKeyboard([[Markup.button.callback("💬 محادثة جديدة","menu_ai")],[Markup.button.callback("🔙 الرئيسية","back")]])); }
  if(data==="ai_change_mode"){
    const current=DB.aiModes[uid]||"general"; const rows=Object.entries(AI_MODE_LABELS).map(([k,v])=>[Markup.button.callback(`${k===current?"✅ ":""}${v}`,`ai_set_mode:${k}`)]); rows.push([Markup.button.callback("🔙","menu_ai")]);
    return edit("🎯 *اختر وضع الذكاء الاصطناعي:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("ai_set_mode:")){
    const mode=data.split(":")[1]; if(!AI_SYSTEMS[mode]) return; DB.aiModes[uid]=mode; DB.aiConversations[uid]=[]; saveDB(); DB.state[uid]={mode:"ai_chat"};
    return edit(`✅ *تم تغيير الوضع إلى: ${AI_MODE_LABELS[mode]}*\n\n_تم مسح المحادثة السابقة_\n\nأرسل سؤالك الآن:`, Markup.inlineKeyboard([[Markup.button.callback("🔄 تغيير الوضع","ai_change_mode")],[Markup.button.callback("❌ خروج","back")]]));
  }

  // ─── إيميلات ───
  if(data==="menu_emails"){
    const user=DB.users[uid]; if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    const active=DB.activeEmails[uid]; const saved=(DB.savedEmails[uid]||[]).length; const used=dailyCount(uid),max=maxDay(uid);
    const rows=[]; if(active) rows.push([Markup.button.callback(`📬 إيميلك النشط: ${active.email.slice(0,30)}`,`inbox:${active.inboxId}`)]); rows.push([Markup.button.callback("⚡ إيميل مؤقت جديد","new_temp_email")]); if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`,"my_emails")]); rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]); rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(`📧 *نظام الإيميلات*\n\n✅ اليوم: *${used}/${max}*\n🔔 الكود يوصلك تلقائياً ⚡\n⏱ مراقبة: *${DB.settings.emailWatchMin} دقيقة*`, Markup.inlineKeyboard(rows));
  }
  if(data==="new_temp_email"){
    const user=DB.users[uid]; if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    const diff=now()-(DB.lastReq[`e_${uid}`]||0); if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلته.`,backKb());
    await edit("⚡ *جاري إنشاء الإيميل...*"); const result=await msCreateInbox(DB.settings.emailWatchMin);
    if(!result||!result.email) return edit("❌ *فشل إنشاء الإيميل!*\nحاول لاحقاً.", Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_temp_email")],[Markup.button.callback("🔙","menu_emails")]]));
    if(DB.activeEmails[uid]?.inboxId) msDeleteInbox(DB.activeEmails[uid].inboxId).catch(()=>{});
    const emailData={email:result.email,inboxId:result.inboxId,createdAt:now()}; DB.activeEmails[uid]=emailData; DB.lastReq[`e_${uid}`]=now(); incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[]; DB.emailHistory[uid].unshift({email:result.email,type:"mailslurp",time:stamp(),msgCount:0}); DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("email_created",uid,result.email); saveDB();
    const opts={parse_mode:"Markdown",...emailActiveKb(result.email,result.inboxId)}; if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
    await edit(`✅ *تم إنشاء إيميلك!*\n\n📧 *العنوان:*\n\`${result.email}\`\n\n⚡ *البوت يراقب ويوصلك الكود فور وصوله*\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,opts);
    emailWatcher(bot,uid,emailData,ctx.chat.id);
    return;
  }
  if(data.startsWith("copy_email:")){ const email=data.slice(11); return ctx.answerCbQuery(`📋 ${email}`,{show_alert:true}).catch(()=>{}); }
  if(data.startsWith("inbox:")){
    const inboxId=data.slice(6); await edit("📨 *جاري فتح الصندوق...*"); const emails=await msGetEmails(inboxId);
    if(!emails.length){ const active=DB.activeEmails[uid]; return edit(`📭 *الصندوق فارغ حالياً*\n\n\`${active?.email||"الإيميل"}\`\n\n⚡ البوت يراقب تلقائياً`, emailActiveKb(active?.email||"",inboxId)); }
    const rows=emails.slice(0,10).map(m=>[Markup.button.callback(`📩 ${(m.subject||"بدون موضوع").slice(0,28)}`,`msg:${m.id}:${inboxId}`)]); rows.push([Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)]); rows.push([Markup.button.callback("🔙","menu_emails")]);
    return edit(`📬 *الصندوق — ${emails.length} رسالة:*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("msg:")){
    const parts=data.split(":"); const emailId=parts[1],inboxId=parts[2];
    await edit("📖 *جاري قراءة الرسالة...*"); const fullEmail=await msGetEmail(emailId);
    if(!fullEmail) return edit("❌ تعذر قراءة الرسالة.",backKb());
    const body=(fullEmail.body||fullEmail.bodyPlainText||"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,1500);
    const otps=extractOTP(fullEmail.body||""); const otpTxt=otps.length?`\n\n🔑 *الكود:*\n${otps.map(c=>`\`${c}\``).join("  ")}`:"";
    const receivedAt=fullEmail.createdAt?new Date(fullEmail.createdAt).toLocaleString("ar"):"—";
    return edit(`📩 *الرسالة*\n\n📬 *من:* \`${fullEmail.from||"—"}\`\n📋 *الموضوع:* ${fullEmail.subject||"بدون موضوع"}\n🕐 *وصلت:* ${receivedAt}`+otpTxt+`\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``, Markup.inlineKeyboard([[Markup.button.callback("🔙 الصندوق",`inbox:${inboxId}`)]]));
  }
  if(data.startsWith("save_email:")){
    const parts=data.split(":"); const inboxId=parts[1]; const email=parts.slice(2).join(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    if(DB.savedEmails[uid].find(e=>e.email===email)) return edit("✅ محفوظ مسبقاً.",emailActiveKb(email,inboxId));
    DB.state[uid]={mode:"save_email_label",email,inboxId};
    return edit("✏️ أرسل تسمية لهذا الإيميل:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_emails")]]));
  }
  if(data==="my_emails"){
    const saved=DB.savedEmails[uid]||[]; if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows=saved.map((e,i)=>[Markup.button.callback(`📧 ${e.label} — ${e.email.slice(0,20)}`,`open_saved:${i}`)]); rows.push([Markup.button.callback("🔙","menu_emails")]);
    return edit(`📂 *محفوظاتي (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("open_saved:")){
    const idx=parseInt(data.split(":")[1]); const e=DB.savedEmails[uid]?.[idx]; if(!e) return edit("❌",backKb());
    return edit(`📧 *${e.label}*\n\n\`${e.email}\`\n🕐 ${e.savedAt}`, Markup.inlineKeyboard([[Markup.button.callback("📋 نسخ",`copy_email:${e.email}`)],[Markup.button.callback("🗑 حذف",`del_saved:${idx}`),Markup.button.callback("🔙","my_emails")]]));
  }
  if(data.startsWith("del_saved:")){ if(DB.savedEmails[uid]) DB.savedEmails[uid].splice(parseInt(data.split(":")[1]),1); saveDB(); return edit("🗑 تم الحذف.",backKb()); }
  if(data.startsWith("del_email:")){
    const inboxId=data.slice(10); if(DB.activeEmails[uid]?.inboxId===inboxId){ msDeleteInbox(inboxId).catch(()=>{}); delete DB.activeEmails[uid]; saveDB(); }
    return edit("🗑 *تم إنهاء الإيميل.*",backKb());
  }
  if(data==="email_history"){
    const h=DB.emailHistory[uid]||[]; if(!h.length) return edit("📊 *لا يوجد سجل.*",backKb());
    let txt=`📊 *سجل الإيميلات (${h.length}):*\n\n`; h.slice(0,10).forEach((e,i)=>{ txt+=`${i+1}. 📧 \`${e.email}\`\n   📩 ${e.msgCount||0} رسالة | 🕐 ${e.time}\n\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_emails")]]));
  }

  // ─── كلمات السر ───
  if(data==="menu_passwords"){
    const saved=DB.savedPasswords[uid]||[];
    return edit(`🔑 *مدير كلمات السر*\n\n💾 محفوظة: *${saved.length}*`, Markup.inlineKeyboard([
      [Markup.button.callback("🔐 توليد كلمة سر قوية","gen_pass")],[Markup.button.callback("💾 كلمات السر المحفوظة","my_passwords")],
      [Markup.button.callback("➕ حفظ كلمة سر يدوياً","save_pass_prompt")],[Markup.button.callback("🔍 بحث في كلمات السر","search_pass")],
      [Markup.button.callback("🔙 الرئيسية","back")],
    ]));
  }
  if(data==="gen_pass"){
    const p=genStrongPass(); const strength=passwordStrength(p);
    return edit(`🔐 *كلمة السر المولّدة:*\n\n\`${p}\`\n\n📊 الطول: ${p.length} | القوة: ${strength.label}`, Markup.inlineKeyboard([
      [Markup.button.callback("💾 حفظها",`store_pass:${p}`)],[Markup.button.callback("📋 نسخ",`copy_pass:${p}`)],
      [Markup.button.callback("🔄 أخرى","gen_pass")],[Markup.button.callback("🔙","menu_passwords")],
    ]));
  }
  if(data.startsWith("copy_pass:")){ const p=data.slice(10); return ctx.answerCbQuery(`🔑 ${p}`,{show_alert:true}).catch(()=>{}); }
  if(data.startsWith("store_pass:")){ DB.state[uid]={mode:"store_pass_platform",pass:data.slice(11)}; return edit("✏️ اكتب اسم المنصة:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]])); }
  if(data==="save_pass_prompt"){ DB.state[uid]={mode:"save_pass_custom"}; return edit("🔐 أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]])); }
  if(data==="my_passwords"){
    const saved=DB.savedPasswords[uid]||[]; if(!saved.length) return edit("💾 *لا توجد كلمات سر.*",backKb());
    let txt=`🔑 *كلمات السر (${saved.length}):*\n\n`; saved.forEach((p,i)=>{ const strength=passwordStrength(p.password); txt+=`${i+1}. 🏷 *${p.platform}*\n   \`${p.password}\` ${strength.label}\n   📅 ${p.savedAt||"—"}\n\n`; });
    return edit(txt, Markup.inlineKeyboard([[Markup.button.callback("🗑 حذف الكل","del_all_pass")],[Markup.button.callback("🔙","menu_passwords")]]));
  }
  if(data==="del_all_pass"){ DB.savedPasswords[uid]=[]; saveDB(); return edit("🗑 تم الحذف.",backKb()); }
  if(data==="search_pass"){ DB.state[uid]={mode:"search_pass"}; return edit("🔍 اكتب اسم المنصة للبحث:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]])); }

  // ─── ملاحظات ───

  if(data==="menu_notes"){
    const notes=DB.notes[uid]||[]; const rows=[];
    if(notes.length) rows.push([Markup.button.callback(`📋 ملاحظاتي (${notes.length})`,`notes_list:0`)]);
    rows.push([Markup.button.callback("➕ إضافة ملاحظة","add_note")]); rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(`📝 *ملاحظاتي*\n\n💾 محفوظة: *${notes.length}*\n\n💡 _يمكنك أيضاً استخدام /note نص_`,Markup.inlineKeyboard(rows));
  }
  if(data==="add_note"){ DB.state[uid]={mode:"add_note"}; return edit("📝 أرسل نص الملاحظة:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_notes")]])); }
  if(data.startsWith("notes_list:")){
    const page=parseInt(data.split(":")[1])||0; const notes=DB.notes[uid]||[]; const pp=5;
    if(!notes.length) return edit("📝 *لا توجد ملاحظات.*",backKb());
    const rows=notes.slice(page*pp,(page+1)*pp).map((n,i)=>[Markup.button.callback(`📝 ${n.text.slice(0,30)}`,`note_view:${page*pp+i}`)]);
    const nav=[]; if(page>0) nav.push(Markup.button.callback("◀️",`notes_list:${page-1}`)); nav.push(Markup.button.callback(`${page+1}/${Math.ceil(notes.length/pp)}`,"noop")); if((page+1)*pp<notes.length) nav.push(Markup.button.callback("▶️",`notes_list:${page+1}`)); if(nav.length) rows.push(nav);
    rows.push([Markup.button.callback("🔙","menu_notes")]); return edit(`📝 *ملاحظاتي (${notes.length}):*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("note_view:")){
    const idx=parseInt(data.split(":")[1]); const note=(DB.notes[uid]||[])[idx]; if(!note) return edit("❌",backKb());
    return edit(`📝 *الملاحظة ${idx+1}*\n\n${note.text}\n\n🕐 ${note.time}`, Markup.inlineKeyboard([[Markup.button.callback("🗑 حذف",`note_del:${idx}`)],[Markup.button.callback("🔙","notes_list:0")]]));
  }
  if(data.startsWith("note_del:")){ if(DB.notes[uid]) DB.notes[uid].splice(parseInt(data.split(":")[1]),1); saveDB(); return edit("🗑 تم حذف الملاحظة.",Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_notes")]])); }

  // ─── VirusTotal ───
  if(data==="menu_vt"){
    return edit(`🔍 *فحص الأمان — VirusTotal*\n\n🛡 70+ محرك أمان`, Markup.inlineKeyboard([
      [Markup.button.callback("🔗 فحص رابط","vt_url"),Markup.button.callback("🌐 فحص دومين","vt_domain")],
      [Markup.button.callback("🖥 فحص IP","vt_ip"),Markup.button.callback("📁 فحص ملف","vt_file_info")],
      [Markup.button.callback("📊 نتائج مؤخراً","vt_cache_stats")],[Markup.button.callback("🔙 الرئيسية","back")],
    ]));
  }
  if(data==="vt_url"){ DB.state[uid]={mode:"vt_url"}; return edit("🔗 أرسل الرابط:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_domain"){ DB.state[uid]={mode:"vt_domain"}; return edit("🌐 أرسل الدومين (مثال: google.com):",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_ip"){ DB.state[uid]={mode:"vt_ip"}; return edit("🖥 أرسل عنوان IP:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_file_info"){ return edit("📁 *أرسل الملف مباشرة للفحص ↓*\n\n_الحجم الأقصى: 32MB_",Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_vt")]])); }
  if(data==="vt_cache_stats"){
    const cacheCount=Object.keys(DB.vtCache).length;
    return edit(`📊 *سجل الفحوصات*\n\n💾 فحوصات مخزّنة: *${cacheCount}*\n⏱ صلاحية الكاش: ساعة`, Markup.inlineKeyboard([[Markup.button.callback("🗑 مسح الكاش","vt_clear_cache")],[Markup.button.callback("🔙","menu_vt")]]));
  }
  if(data==="vt_clear_cache"){ if(!isAdmin(uid)) return; DB.vtCache={}; saveDB(); return edit("✅ تم مسح كاش الفحص.",Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_vt")]])); }

  // ─── UptimeRobot ───
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*"); const monitors=await getMonitors();
    if(!monitors.length) return edit("🌐 *لا توجد مواقع.*",backKb());
    let txt=`🌐 *مواقعك (${monitors.length}):*\n\n`; monitors.slice(0,10).forEach(m=>{ const ic=m.status===2?"🟢":m.status===9?"🔴":"🟡"; const uptime=m.all_time_uptime_ratio?`${m.all_time_uptime_ratio}%`:"—"; txt+=`${ic} *${m.friendly_name||m.url}*\n   📈 ${uptime} | 🔗 ${(m.url||"").slice(0,35)}\n\n`; });
    const online=monitors.filter(m=>m.status===2).length; const offline=monitors.filter(m=>m.status===9).length; txt+=`✅ يعمل: *${online}* | ❌ متوقف: *${offline}*`;
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔄 تحديث","menu_uptime")],[Markup.button.callback("🔙","back")]]));
  }

  // ─── الإحالة ───
  if(data==="referral"){
    const me=await bot.telegram.getMe(); const link=`https://t.me/${me.username}?start=ref_${uid}`; const refs=(DB.referrals[uid]||[]).length; const bonus=DB.referralPerks[uid]?.extra||0;
    return edit(`🎁 *نظام الإحالة*\n\n🔗 *رابطك:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}* | 🎁 مكافأتك: *+${bonus} إيميل يومياً*\n\n💡 _شارك الرابط مع أصدقائك_`, Markup.inlineKeyboard([[Markup.button.callback("👥 إحالاتي","my_referrals")],[Markup.button.callback("🔙","back")]]));
  }
  if(data==="my_referrals"){
    const refs=DB.referrals[uid]||[]; if(!refs.length) return edit("👥 *لم تُحِل أحداً بعد.*\n\n_شارك رابطك وادعُ أصدقائك!_",backKb());
    let txt=`👥 *إحالاتي (${refs.length}):*\n\n`; refs.slice(0,10).forEach((id,i)=>{ txt+=`${i+1}. ${DB.users[id]?.name||id} ${DB.users[id]?.verified?"✅":""}\n`; });
    return edit(txt,backKb());
  }

  // ─── إحصائياتي ───
  if(data==="my_stats"){
    const u=DB.users[uid]||{}; const groups=getUserGroupsInfo(uid); const aiToday=aiDailyCount(uid); const mode=DB.aiModes[uid]||"general";
    return edit(`📊 *إحصائياتي*\n\n👤 *${u.name}*\n🆔 \`${uid}\`\n📅 انضممت: ${u.joinedAt}\n📧 إيميلات اليوم: *${dailyCount(uid)}/${maxDay(uid)}*\n📚 إجمالي: *${(DB.emailHistory[uid]||[]).length}*\n💾 محفوظات: *${(DB.savedEmails[uid]||[]).length}*\n🔑 كلمات سر: *${(DB.savedPasswords[uid]||[]).length}*\n📝 ملاحظات: *${(DB.notes[uid]||[]).length}*\n👥 إحالات: *${(DB.referrals[uid]||[]).length}*\n🏘 القروبات: *${groups.length}*\n🤖 AI اليوم: *${aiToday}/${isAdmin(uid)?"∞":DB.settings.maxAiMsgsPerDay}*\n🎯 وضع AI: *${AI_MODE_LABELS[mode]}*\n🏅 الدور: *${u.role||"user"}*`,backKb());
  }

  // ─── سجلي ───
  if(data==="my_history"){
    const h=DB.emailHistory[uid]||[]; const a=DB.activityLog[uid]||[]; let txt="📋 *سجلي*\n\n";
    if(h.length){ txt+="*📧 آخر الإيميلات:*\n"; h.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. 📧 \`${e.email}\` — ${e.time}\n`; }); txt+="\n"; }
    if(a.length){ txt+="*🕐 آخر النشاطات:*\n"; a.slice(0,5).forEach((ac,i)=>{ txt+=`${i+1}. ${ac.action} — ${ac.time}\n`; }); }
    if(!h.length&&!a.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ─── حسابي ───
  if(data==="my_account"){
    const u=DB.users[uid]||{}; const passSet=!!u.passwordHash;
    return edit(`👤 *حسابي*\n\n🆔 \`${uid}\`\n📧 ${u.accountEmail?`\`${u.accountEmail}\``:"غير محدد"}\n🔐 كلمة السر: ${passSet?"✅ مُعيّنة":"❌ غير مُعيّنة"}\n🏅 ${u.role||"user"}\n📅 ${u.joinedAt}`, Markup.inlineKeyboard([[Markup.button.callback("📋 إظهار بيانات حسابي","show_account_data")],[Markup.button.callback("📧 تغيير الإيميل","acc_email"),Markup.button.callback("🔐 تغيير السر","acc_pass")],[Markup.button.callback("🔙","back")]]));
  }
  if(data==="show_account_data"){
    const u=DB.users[uid]||{};
    return edit(`🔐 *بيانات حسابك*\n\n📧 *الإيميل:* \`${u.accountEmail||"غير محدد"}\`\n🔑 *كلمة السر:* \`${u.accountPassword||"غير محددة"}\`\n\n⚠️ _احتفظ بهذه البيانات. لا تشاركها مع أحد!_`, Markup.inlineKeyboard([[Markup.button.callback("🔙 حسابي","my_account")]]));
  }
  if(data==="acc_email"){ DB.state[uid]={mode:"acc_email"}; return edit("📧 أرسل بريدك الجديد:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }
  if(data==="acc_pass") { DB.state[uid]={mode:"acc_pass"};  return edit("🔐 أرسل كلمة السر الجديدة (6 أحرف+):",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }

  // ─── مساعدة ───
  if(data==="help"){
    return edit(`ℹ️ *دليل البوت v6*\n\n*🤖 AI متعدد الأوضاع:*\n عام | برمجة | ترجمة | إبداعي | تحليل\n\n*📧 الإيميلات:* إيميل حقيقي مع استقبال تلقائي للأكواد\n\n*🔑 كلمات السر:* توليد وحفظ وبحث آمن\n\n*🔍 فحص الأمان:* روابط | دومينات | IP | ملفات (70+ محرك)\n\n*🌐 مراقبة المواقع:* حالة مواقعك عبر UptimeRobot\n\n*📝 الملاحظات:* حفظ ملاحظاتك الشخصية\n\n*🏘 القروبات:* إدارة متكاملة للقروبات\n\n*🎁 الإحالة:* إيميلات إضافية بدعوة الأصدقاء\n\n*📟 الأوامر:*\n/id — معرّفك\n/note — ملاحظة سريعة\n/info — معلوماتك\n/ai — الذكاء الاصطناعي\n/stop — خروج من الوضع الحالي\n\n✅ التحقق يتم مرة واحدة فقط`,backKb());
  }

  // ══════════ لوحة التحكم ══════════
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *إعدادات البوت:*",devSettingsKb()); }
  if(data==="ds_maint"){ if(!isDev(uid))return; DB.settings.maintenanceMode=!DB.settings.maintenanceMode; saveDB(); return edit(`⚙️ الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,devSettingsKb()); }
  if(data==="ds_screenshot"){ if(!isDev(uid))return; DB.settings.screenshotProtection=!DB.settings.screenshotProtection; saveDB(); return edit(`🛡 الحماية: ${DB.settings.screenshotProtection?"✅":"❌"}`,devSettingsKb()); }
  if(data==="ds_ai_toggle"){ if(!isDev(uid))return; DB.settings.aiEnabled=!DB.settings.aiEnabled; saveDB(); return edit(`🤖 AI: ${DB.settings.aiEnabled?"✅ مفعّل":"❌ معطّل"}`,devSettingsKb()); }
  if(data==="ds_autodel"){ if(!isDev(uid))return; DB.settings.autoDeleteBadwords=!DB.settings.autoDeleteBadwords; saveDB(); return edit(`🗑 حذف تلقائي: ${DB.settings.autoDeleteBadwords?"✅":"❌"}`,devSettingsKb()); }
  for(const k of["ds_max","ds_cool","ds_watch","ds_ref","ds_ai_limit"]){
    if(data===k){ if(!isAdmin(uid))return;
      const lbl={ds_max:"الحد اليومي للإيميلات",ds_cool:"وقت الانتظار (ثانية)",ds_watch:"مدة المراقبة (دقيقة)",ds_ref:"مكافأة الإحالة",ds_ai_limit:"الحد اليومي لرسائل AI"};
      DB.state[uid]={mode:"dev_setting",key:k}; return edit(`✏️ أرسل القيمة لـ *${lbl[k]}:*`,Markup.inlineKeyboard([[Markup.button.callback("❌","dev_settings")]]));
    }
  }
  if(data==="dev_stats"){ if(!isAdmin(uid))return; return showDevStats({callbackQuery:true,editMessageText:(t,o)=>ctx.editMessageText(t,o),from:ctx.from}); }
  if(data==="dev_logs"){
    if(!isAdmin(uid))return; let txt=`📜 *آخر ${Math.min(DB.logs.length,20)} أحداث:*\n\n`; DB.logs.slice(0,20).forEach(l=>{ txt+=`▪️ *${l.type}* | \`${l.uid}\`\n${(l.text||"").slice(0,50)}\n🕐 ${l.time}\n\n`; });
    return edit(txt||"لا سجلات.",Markup.inlineKeyboard([[Markup.button.callback("🗑 مسح","dev_clear_logs"),Markup.button.callback("📥 تصدير","dev_export_logs")],[Markup.button.callback("🔙","dev_panel")]]));
  }
  if(data==="dev_clear_logs"){ if(!isDev(uid))return; DB.logs=[]; saveDB(); return edit("✅ مُسح.",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data==="dev_export_logs"){
    if(!isDev(uid))return; let txt="📜 سجل الأحداث:\n\n"; DB.logs.forEach(l=>{ txt+=`[${l.time}] ${l.type} | ${l.uid} | ${l.text}\n`; });
    try{ await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(txt),filename:`logs_${today()}.txt`},{caption:"📜 سجل الأحداث"}); }catch(e){ await ctx.reply(`❌ فشل التصدير: ${e.message}`); } return;
  }

  // ─── نظام النسخ الاحتياطية ───
  if(data==="dev_backup"){
    if(!isDev(uid))return;
    const userCount=Object.keys(DB.users).length; const groupCount=Object.keys(DB.groups).length; const logsCount=DB.logs.length;
    const notesCount=Object.values(DB.notes).reduce((a,n)=>a+n.length,0); const passCount=Object.values(DB.savedPasswords).reduce((a,p)=>a+p.length,0); const emailHistoryCount=Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0); const dbSize=JSON.stringify(DB).length;
    return edit(`💾 *نظام النسخ الاحتياطية*\n\n📊 *محتوى قاعدة البيانات:*\n👥 المستخدمون: *${userCount}*\n🏘 القروبات: *${groupCount}*\n📝 الملاحظات: *${notesCount}*\n🔑 كلمات السر: *${passCount}*\n📧 سجل الإيميلات: *${emailHistoryCount}*\n📜 السجلات: *${logsCount}*\n💽 حجم البيانات: *${(dbSize/1024).toFixed(1)} KB*\n\n🕐 آخر حفظ: كل 30 ثانية تلقائياً`, Markup.inlineKeyboard([
      [Markup.button.callback("📤 تنزيل نسخة كاملة","backup_full"), Markup.button.callback("📤 نسخة المستخدمين فقط","backup_users")],
      [Markup.button.callback("📤 نسخة القروبات","backup_groups"), Markup.button.callback("📤 نسخة الإعدادات","backup_settings")],
      [Markup.button.callback("📥 استعادة من ملف","backup_restore")],
      [Markup.button.callback("🗑 حذف البيانات القديمة","backup_cleanup")],[Markup.button.callback("🔙 لوحة","dev_panel")],
    ]));
  }
  if(data==="backup_full"){
    if(!isDev(uid))return;
    try{
      await edit("⏳ *جاري تحضير النسخة الاحتياطية الكاملة...*"); const toSave={...DB}; toSave.admins=[...DB.admins]; const backupData=JSON.stringify(toSave,null,2); const filename=`backup_full_${today()}_${Date.now()}.json`;
      await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(backupData,"utf8"),filename},{caption:`✅ *نسخة احتياطية كاملة*\n📅 ${stamp()}\n💽 الحجم: ${(backupData.length/1024).toFixed(1)} KB\n👥 ${Object.keys(DB.users).length} مستخدم\n\n⚠️ احتفظ بهذا الملف — يمكن استعادة كل البيانات منه`,parse_mode:"Markdown"});
      log("backup_full",uid,"نسخة كاملة"); return edit("✅ *تم إرسال النسخة الاحتياطية الكاملة!*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]]));
    }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]])); }
  }
  if(data==="backup_users"){
    if(!isDev(uid))return;
    try{
      await edit("⏳ *جاري تحضير نسخة المستخدمين...*"); const usersData={users:DB.users,savedEmails:DB.savedEmails,savedPasswords:DB.savedPasswords,emailHistory:DB.emailHistory,notes:DB.notes,referrals:DB.referrals,referralOf:DB.referralOf,referralPerks:DB.referralPerks,aiModes:DB.aiModes,exportedAt:stamp(),exportType:"users_only"}; const backupData=JSON.stringify(usersData,null,2); const filename=`backup_users_${today()}.json`;
      await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(backupData,"utf8"),filename},{caption:`✅ *نسخة بيانات المستخدمين*\n📅 ${stamp()}\n👥 ${Object.keys(DB.users).length} مستخدم`,parse_mode:"Markdown"});
      log("backup_users",uid,"نسخة مستخدمين"); return edit("✅ *تم إرسال نسخة المستخدمين!*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]]));
    }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]])); }
  }
  if(data==="backup_groups"){
    if(!isDev(uid))return;
    try{
      await edit("⏳ *جاري تحضير نسخة القروبات...*"); const groupsData={groups:DB.groups,groupMembers:DB.groupMembers,groupSettings:DB.groupSettings,groupBanned:DB.groupBanned,groupMuted:DB.groupMuted,groupWatchwords:DB.groupWatchwords,groupBadwords:DB.groupBadwords,grpWelcome:DB.grpWelcome,grpRules:DB.grpRules,exportedAt:stamp(),exportType:"groups_only"}; const backupData=JSON.stringify(groupsData,null,2); const filename=`backup_groups_${today()}.json`;
      await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(backupData,"utf8"),filename},{caption:`✅ *نسخة بيانات القروبات*\n📅 ${stamp()}\n🏘 ${Object.keys(DB.groups).length} قروب`,parse_mode:"Markdown"});
      log("backup_groups",uid,"نسخة قروبات"); return edit("✅ *تم إرسال نسخة القروبات!*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]]));
    }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]])); }
  }
  if(data==="backup_settings"){
    if(!isDev(uid))return;
    try{
      const settingsData={settings:DB.settings,admins:[...DB.admins],adminPerms:DB.adminPerms,announcements:DB.announcements,exportedAt:stamp(),exportType:"settings_only"}; const backupData=JSON.stringify(settingsData,null,2); const filename=`backup_settings_${today()}.json`;
      await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(backupData,"utf8"),filename},{caption:`✅ *نسخة الإعدادات*\n📅 ${stamp()}`,parse_mode:"Markdown"});
      log("backup_settings",uid,"نسخة إعدادات"); return edit("✅ *تم إرسال نسخة الإعدادات!*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]]));
    }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_backup")]])); }
  }
  if(data==="backup_restore"){ if(!isDev(uid))return; DB.state[uid]={mode:"backup_restore"}; return edit(`📥 *استعادة النسخة الاحتياطية*\n\n⚠️ *تحذير مهم:*\n• الاستعادة ستُدمج البيانات مع الموجودة\n• المستخدمون الجدد لن يُحذفوا\n• البيانات المستعادة ستُضاف للقاعدة الحالية\n\n📋 *أنواع الملفات المدعومة:*\n• نسخة كاملة (backup_full)\n• نسخة مستخدمين (backup_users)\n• نسخة قروبات (backup_groups)\n• نسخة إعدادات (backup_settings)\n\n📤 *أرسل ملف JSON الآن:*`, Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","dev_backup")]])); }
  if(data==="backup_cleanup"){
    if(!isDev(uid))return;
    return edit(`🗑 *تنظيف البيانات*\n\n⚠️ اختر ما تريد تنظيفه:`, Markup.inlineKeyboard([
      [Markup.button.callback("🗑 مسح السجلات القديمة","cleanup_logs")],[Markup.button.callback("🗑 مسح كاش VT","cleanup_vt")],
      [Markup.button.callback("🗑 مسح جلسات الإيميلات المنتهية","cleanup_emails")],[Markup.button.callback("🗑 مسح بيانات AI القديمة","cleanup_ai")],
      [Markup.button.callback("🔙","dev_backup")],
    ]));
  }
  if(data==="cleanup_logs"){ if(!isDev(uid))return; const before=DB.logs.length; DB.logs=DB.logs.slice(0,500); const after=DB.logs.length; saveDB(); return edit(`✅ تم حذف *${before-after}* سجل قديم. (تبقى ${after})`,Markup.inlineKeyboard([[Markup.button.callback("🔙","backup_cleanup")]])); }
  if(data==="cleanup_vt"){ if(!isDev(uid))return; const before=Object.keys(DB.vtCache).length; DB.vtCache={}; saveDB(); return edit(`✅ تم مسح *${before}* نتيجة فحص مؤقتة.`,Markup.inlineKeyboard([[Markup.button.callback("🔙","backup_cleanup")]])); }
  if(data==="cleanup_emails"){ if(!isDev(uid))return; let cleaned=0; for(const uid2 of Object.keys(DB.activeEmails)){ const email=DB.activeEmails[uid2]; if(email&&now()-email.createdAt>DB.settings.emailWatchMin*60+60){ delete DB.activeEmails[uid2]; cleaned++; } } saveDB(); return edit(`✅ تم تنظيف *${cleaned}* جلسة إيميل منتهية.`,Markup.inlineKeyboard([[Markup.button.callback("🔙","backup_cleanup")]])); }
  if(data==="cleanup_ai"){ if(!isDev(uid))return; let cleaned=0; for(const uid2 of Object.keys(DB.aiConversations)){ if(DB.aiConversations[uid2].length>0){ DB.aiConversations[uid2]=[]; cleaned++; } } saveDB(); return edit(`✅ تم مسح محادثات AI لـ *${cleaned}* مستخدم.`,Markup.inlineKeyboard([[Markup.button.callback("🔙","backup_cleanup")]])); }

  if(data==="dev_users"){
    if(!isAdmin(uid))return; const users=Object.entries(DB.users); const banned=users.filter(([,u])=>u.banned).length; const verified=users.filter(([,u])=>u.verified).length;
    let txt=`👥 *الأعضاء (${users.length}):*\n✅ متحققون: ${verified} | 🚫 ${banned} محظور\n\n`; users.slice(0,8).forEach(([id,u])=>{ const b=u.banned?"🚫":u.muted?"🔇":isAdmin(parseInt(id))?"⭐":"👤"; txt+=`${b} *${u.name}* [\`${id}\`]\n@${u.username||"—"} | ${u.verified?"✅":"❌"}\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("📋 قائمة كاملة","dev_users_list"),Markup.button.callback("🔍 بحث","dev_search_user")],[Markup.button.callback("📤 تصدير بيانات","dev_export_users")],[Markup.button.callback("🔙","dev_panel")]]));
  }
  if(data==="dev_users_list"){ if(!isAdmin(uid))return; return edit("*اختر عضواً:*",usersKb("dev_view_user")); }
  if(data==="dev_export_users"){
    if(!isDev(uid))return;
    try{ const headers="ID,الاسم,Username,انضم,محظور,متحقق,Role\n"; const rows=Object.entries(DB.users).map(([id,u])=>`${id},"${u.name||""}","${u.username||""}","${u.joinedAt||""}",${u.banned?1:0},${u.verified?1:0},"${u.role||"user"}"`).join("\n"); await bot.telegram.sendDocument(ctx.chat.id,{source:Buffer.from(headers+rows),filename:`users_${today()}.csv`},{caption:`👥 بيانات ${Object.keys(DB.users).length} مستخدم`}); }catch(e){ await ctx.reply(`❌ فشل: ${e.message}`); } return;
  }

  if(data.startsWith("dev_view_user:")){
    if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); const u=DB.users[tid]; if(!u) return edit("❌ لم يُعثر.",backKb());
    const userGroups=getUserGroupsInfo(tid); const adminGroups=userGroups.filter(g=>g.isAdmin); const adminNote=DB.userNotes[tid]||"لا توجد ملاحظات";
    return edit(`👤 *${u.name}*\n🆔 \`${tid}\`\n@${u.username||"—"}\n📅 ${u.joinedAt}\n📧 ${(DB.emailHistory[tid]||[]).length} إيميل | 💬 ${u.msgCount||0} رسالة\n🚫 ${u.banned?"محظور":"—"} | 🔇 ${u.muted?"مكتوم":"—"} | ✅ ${u.verified?"متحقق":"غير متحقق"}\n🏘 القروبات: *${userGroups.length}* | ⭐ مشرف في: *${adminGroups.length}*\n📝 ملاحظة: _${adminNote}_`, Markup.inlineKeyboard([
      [Markup.button.callback(u.banned?"✅ رفع حظر":"🚫 حظر",u.banned?`dev_unban:${tid}`:`dev_ban:${tid}`), Markup.button.callback(u.muted?"🔊 رفع كتم":"🔇 كتم",u.muted?`dev_unmute:${tid}`:`dev_mute:${tid}`)],
      [Markup.button.callback("⭐ ترقية",`dev_promote:${tid}`),Markup.button.callback("⬇️ تخفيض",`dev_demote:${tid}`)],
      [Markup.button.callback("📝 إضافة ملاحظة",`add_user_note:${tid}`), Markup.button.callback("📨 إرسال رسالة",`msg_user:${tid}`)],
      [Markup.button.callback("🏘 قروباته",`user_groups:${tid}`)],[Markup.button.callback("🔙","dev_users_list")],
    ]));
  }
  if(data.startsWith("add_user_note:")){ if(!isAdmin(uid))return; const tid=data.split(":")[1]; DB.state[uid]={mode:"add_user_note",tid}; return edit("📝 أرسل الملاحظة:",Markup.inlineKeyboard([[Markup.button.callback("❌",`dev_view_user:${tid}`)]])); }
  if(data.startsWith("msg_user:")){ if(!isAdmin(uid))return; const tid=data.split(":")[1]; DB.state[uid]={mode:"msg_user",tid}; return edit("📨 أرسل الرسالة:",Markup.inlineKeyboard([[Markup.button.callback("❌",`dev_view_user:${tid}`)]])); }

  // ─── القروبات ───
  if(data==="dev_groups"){
    if(!isAdmin(uid))return; const groups=Object.entries(DB.groups); if(!groups.length) return edit("🏘 *لا توجد قروبات.*",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]]));
    let txt=`🏘 *القروبات (${groups.length}):*\n\n`; groups.slice(0,10).forEach(([id,g])=>{ txt+=`📌 *${g.title}*\n🆔 \`${id}\`\n👥 ${Object.keys(DB.groupMembers[id]||{}).length} عضو | 💬 ${g.msgCount||0} رسالة\n\n`; });
    const rows=groups.slice(0,8).map(([id,g])=>[Markup.button.callback(`🏘 ${g.title.slice(0,20)}`,`group_view:${id}`)]); rows.push([Markup.button.callback("🔙","dev_panel")]); return edit(txt,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("group_view:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const g=DB.groups[gid]; if(!g) return edit("❌",backKb());
    const members=Object.values(DB.groupMembers[gid]||{}); const admins=members.filter(m=>m.isAdmin||m.status==="creator"||m.status==="administrator"); const activeMembers=members.filter(m=>m.status!=="left"&&m.status!=="kicked");
    let ownerName="غير معروف"; if(g.ownerId&&DB.groupMembers[gid]?.[g.ownerId]) ownerName=DB.groupMembers[gid][g.ownerId].name;
    const txt=`🏘 *${g.title}*\n🆔 \`${gid}\`\n👑 المالك: *${ownerName}*\n👥 الأعضاء: *${activeMembers.length}*\n👑 المشرفون: *${admins.length}*\n💬 الرسائل: *${g.msgCount||0}*\n📅 انضم البوت: ${g.joinedAt}`;
    return edit(txt, groupControlKb(gid, uid));
  }

  // ─── أعضاء القروب ───
  if(data.startsWith("grp_members:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const g=DB.groups[gid]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status!=="left"&&m.status!=="kicked");
    let txt=`👥 *أعضاء ${g?.title||gid} (${members.length}):*\n\n`; members.slice(0,15).forEach((m,i)=>{ const role=m.isOwner?"👑":m.isAdmin?"⭐":"👤"; txt+=`${i+1}. ${role}${m.isBot?"🤖":""} *${m.name}*\n   🆔 \`${m.id}\` | @${m.username||"—"}\n   📅 ${m.joinedAt}\n\n`; });
    if(members.length>15) txt+=`_...و ${members.length-15} آخرين_`; return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }

  // ─── عرض قروبات مستخدم ───
  if(data.startsWith("user_groups:")){
    if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); const u=DB.users[tid]; const groups=getUserGroupsInfo(tid);
    if(!groups.length) return edit(`🏘 *${u?.name||tid}* غير موجود في أي قروب مسجّل.`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`dev_view_user:${tid}`)]]));
    let txt=`🏘 *قروبات ${u?.name||tid}:*\n\n`; groups.forEach((g,i)=>{ const role=g.isOwner?"👑 مالك":g.isAdmin?"⭐ مشرف":"👤 عضو"; txt+=`${i+1}. *${g.title}*\n   🆔 \`${g.gid}\`\n   ${role}`; if(g.isAdmin&&g.adminPerms){ const p=g.adminPerms; const perms=[]; if(p.can_delete_messages) perms.push("حذف"); if(p.can_restrict_members) perms.push("تقييد"); if(p.can_promote_members) perms.push("ترقية"); if(p.can_pin_messages) perms.push("تثبيت"); if(p.can_manage_chat) perms.push("إدارة"); if(p.is_anonymous) perms.push("مجهول"); if(g.customTitle) txt+=` "${g.customTitle}"`; if(perms.length) txt+=`\n   📋 ${perms.join("، ")}`; } txt+=`\n   📅 ${g.joinedAt||"—"}\n\n`; });
    const adminCount=groups.filter(g=>g.isAdmin).length; txt+=`\n📊 إجمالي: *${groups.length}* قروب | ⭐ مشرف في: *${adminCount}*`; return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙",`dev_view_user:${tid}`)]]));
  }

  // ─── التحقق من رتبة ───
  if(data.startsWith("grp_check_role:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status!=="left"&&m.status!=="kicked");
    const rows=members.slice(0,12).map(m=>[Markup.button.callback(`${m.isOwner?"👑":m.isAdmin?"⭐":"👤"} ${m.name.slice(0,22)}`,`grp_role_detail:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]);
    return edit(`🔍 *اختر عضواً للتحقق من رتبته:*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_role_detail:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    await edit("⏳ *جاري التحقق من Telegram...*"); const freshData=await syncMemberRole(gid,tid); const localData=DB.groupMembers[gid]?.[tid];
    if(!localData&&!freshData) return edit("❌ لم يُعثر على العضو.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const d=freshData||localData; const roleDesc=describeRole(d);
    let txt=`🔍 *نتيجة التحقق من Telegram*\n\n👤 *${d.name||"—"}*\n🆔 \`${tid}\`\n@${d.username||"—"}\n\n🏅 *الرتبة:* ${roleDesc}\n📅 الانضمام: ${d.joinedAt||"—"}\n🔄 آخر تحديث: ${d.lastSync||"—"}`;
    if(d.isAdmin&&d.adminPerms){ const p=d.adminPerms; txt+=`\n\n📋 *صلاحياته التفصيلية:*\n${p.can_manage_chat?"✅":"❌"} إدارة القروب\n${p.can_delete_messages?"✅":"❌"} حذف الرسائل\n${p.can_restrict_members?"✅":"❌"} تقييد الأعضاء\n${p.can_promote_members?"✅":"❌"} ترقية مشرفين\n${p.can_change_info?"✅":"❌"} تغيير معلومات القروب\n${p.can_invite_users?"✅":"❌"} دعوة أعضاء\n${p.can_pin_messages?"✅":"❌"} تثبيت رسائل\n${p.is_anonymous?"✅":"❌"} مجهول الهوية`; }
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_sync_admins:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; await edit("⏳ *جاري تحديث بيانات المشرفين من Telegram...*"); const admins=await syncGroupAdmins(gid);
    return edit(`✅ *تم التحديث!*\n\n👑 المشرفون الآن: *${admins.length}*`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_admins:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const g=DB.groups[gid]; const admins=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.isAdmin||m.status==="creator"||m.status==="administrator");
    let txt=`👑 *مشرفو ${g?.title||gid} (${admins.length}):*\n\n`; admins.forEach((m,i)=>{ const roleLabel=m.isOwner||m.status==="creator"?"👑 مالك":"⭐ مشرف"; txt+=`${i+1}. ${roleLabel} *${m.name}*\n   🆔 \`${m.id}\` | @${m.username||"—"}\n`; if(m.customTitle) txt+=`   🏷 "${m.customTitle}"\n`; if(m.adminPerms){ const p=m.adminPerms; const perms=[]; if(p.can_delete_messages) perms.push("حذف"); if(p.can_restrict_members) perms.push("تقييد"); if(p.can_promote_members) perms.push("ترقية"); if(p.can_pin_messages) perms.push("تثبيت"); if(p.can_manage_chat) perms.push("إدارة"); if(p.is_anonymous) perms.push("مجهول"); if(perms.length) txt+=`   📋 ${perms.join("، ")}\n`; } txt+=`   🔄 ${m.lastSync||"—"}\n\n`; });
    if(!admins.length) txt+="لا يوجد مشرفون مسجّلون.\n_استخدم زر تحديث المشرفين أولاً_"; return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔄 تحديث من Telegram",`grp_sync_admins:${gid}`)],[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }

  // ─── إحصائيات القروب ───
  if(data.startsWith("grp_stats:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const g=DB.groups[gid]; const members=Object.values(DB.groupMembers[gid]||{});
    const adminCount=members.filter(m=>m.isAdmin||m.isOwner||m.status==="creator"||m.status==="administrator").length; const bots=members.filter(m=>m.isBot); const activeMembers=members.filter(m=>m.status!=="left"&&m.status!=="kicked"); const leftMembers=members.filter(m=>m.status==="left"||m.status==="kicked"); const banned=Object.keys(DB.groupBanned[gid]||{}).length; const muted=Object.keys(DB.groupMuted[gid]||{}).length; const watchwords=(DB.groupWatchwords[gid]||[]).length; const badwords=(DB.groupBadwords[gid]||[]).length; const hasWelcome=!!DB.grpWelcome[gid]; const hasRules=!!DB.grpRules[gid];
    return edit(`📊 *إحصائيات ${g?.title||gid}*\n\n👥 الأعضاء النشطون: *${activeMembers.length}*\n👑 المشرفون: *${adminCount}*\n🤖 البوتات: *${bots.length}*\n🚶 المغادرون: *${leftMembers.length}*\n🚫 المحظورون: *${banned}* | 🔇 المكتومون: *${muted}*\n\n💬 إجمالي الرسائل: *${g?.msgCount||0}*\n👁 كلمات مراقبة: *${watchwords}*\n🚨 كلمات إساءة: *${badwords}*\n\n👋 رسالة ترحيب: ${hasWelcome?"✅":"❌"}\n📋 قواعد القروب: ${hasRules?"✅":"❌"}`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }

  // ─── طرد عضو ───
  if(data.startsWith("grp_kick:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status!=="left"&&m.status!=="kicked"&&!m.isAdmin&&!m.isOwner);
    if(!members.length) return edit("👥 *لا يوجد أعضاء للطرد.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=members.slice(0,12).map(m=>[Markup.button.callback(`👤 ${m.name.slice(0,20)}`,`grp_do_kick:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit("🚫 *اختر العضو للطرد:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_kick:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{ await bot.telegram.banChatMember(gid,tid); await bot.telegram.unbanChatMember(gid,tid); if(DB.groupMembers[gid]?.[tid]){ DB.groupMembers[gid][tid].status="kicked"; DB.groupMembers[gid][tid].isAdmin=false; } saveDB(); log("kick",uid,`${tid} من ${gid}`); return edit(`✅ *تم طرد العضو*`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل الطرد: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── كتم عضو ───
  if(data.startsWith("grp_mute_member:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status!=="left"&&m.status!=="kicked"&&!m.isAdmin&&!m.isOwner);
    if(!members.length) return edit("🔇 *لا يوجد أعضاء للكتم.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=members.slice(0,12).map(m=>[Markup.button.callback(`👤 ${m.name.slice(0,20)}`,`grp_do_mute:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit("🔇 *اختر العضو للكتم:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_mute:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{ await bot.telegram.restrictChatMember(gid,tid,{permissions:{can_send_messages:false},until_date:0}); if(!DB.groupMuted[gid]) DB.groupMuted[gid]={}; DB.groupMuted[gid][tid]=stamp(); saveDB(); log("mute_grp",uid,`${tid} في ${gid}`); return edit(`✅ *تم كتم العضو دائمياً*\n\nاستخدم رفع الكتم لإعادة صلاحياته.`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل الكتم: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── رفع كتم ───
  if(data.startsWith("grp_unmute_member:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const muted=Object.keys(DB.groupMuted[gid]||{});
    if(!muted.length) return edit("✅ *لا يوجد مكتومون.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=muted.slice(0,12).map(mid=>{ const m=DB.groupMembers[gid]?.[mid]; return [Markup.button.callback(`🔊 ${m?.name||mid}`,`grp_do_unmute:${gid}:${mid}`)]; }); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit(`🔊 *المكتومون (${muted.length}):\nاختر عضواً لرفع الكتم:*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_unmute:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{ await bot.telegram.restrictChatMember(gid,tid,{permissions:{can_send_messages:true,can_send_media_messages:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_change_info:false,can_invite_users:true,can_pin_messages:false}}); if(DB.groupMuted[gid]) delete DB.groupMuted[gid][tid]; saveDB(); log("unmute_grp",uid,`${tid} في ${gid}`); return edit(`✅ *رُفع الكتم بنجاح*`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل رفع الكتم: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── حظر عضو في القروب ───
  if(data.startsWith("grp_ban_member:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status!=="left"&&m.status!=="kicked"&&!m.isOwner);
    if(!members.length) return edit("🚷 *لا يوجد أعضاء للحظر.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=members.slice(0,12).map(m=>[Markup.button.callback(`${m.isAdmin?"⭐":"👤"} ${m.name.slice(0,20)}`,`grp_do_ban:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit("🚷 *اختر العضو للحظر الدائم:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_ban:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{ await bot.telegram.banChatMember(gid,tid); if(!DB.groupBanned[gid]) DB.groupBanned[gid]={}; DB.groupBanned[gid][tid]={bannedAt:stamp(),bannedBy:uid}; if(DB.groupMembers[gid]?.[tid]){ DB.groupMembers[gid][tid].status="kicked"; DB.groupMembers[gid][tid].isAdmin=false; } saveDB(); log("ban_grp",uid,`${tid} في ${gid}`); return edit(`🚷 *تم حظر العضو بشكل دائم*\n\nلإعادته استخدم زر رفع الحظر.`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل الحظر: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── رفع حظر عضو في القروب ───
  if(data.startsWith("grp_unban_member:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const banned=Object.keys(DB.groupBanned[gid]||{});
    if(!banned.length) return edit("✅ *لا يوجد محظورون.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=banned.slice(0,12).map(bid=>{ const m=DB.groupMembers[gid]?.[bid]; return [Markup.button.callback(`🚷 ${m?.name||bid}`,`grp_do_unban:${gid}:${bid}`)]; }); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit(`✅ *المحظورون (${banned.length}):\nاختر عضواً لرفع الحظر:*`,Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_unban:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{ await bot.telegram.unbanChatMember(gid,tid); if(DB.groupBanned[gid]) delete DB.groupBanned[gid][tid]; if(DB.groupMembers[gid]?.[tid]) DB.groupMembers[gid][tid].status="left"; saveDB(); log("unban_grp",uid,`${tid} في ${gid}`); return edit(`✅ *رُفع الحظر بنجاح*\n\nيمكن للعضو الآن الانضمام مجدداً.`, Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل رفع الحظر: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── ترقية مشرف ───
  if(data.startsWith("grp_promote:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const members=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.status==="member"&&!m.isBot&&!m.isAdmin);
    if(!members.length) return edit("👥 *لا يوجد أعضاء للترقية.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=members.slice(0,12).map(m=>[Markup.button.callback(`👤 ${m.name.slice(0,20)}`,`grp_do_promote:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit("⭐ *اختر العضو للترقية لمشرف:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_promote:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{
      await bot.telegram.promoteChatMember(gid,tid,{can_manage_chat:true,can_delete_messages:true,can_restrict_members:true,can_invite_users:true,can_pin_messages:true,can_change_info:false,can_promote_members:false});
      if(!DB.groupMembers[gid][tid]) DB.groupMembers[gid][tid]={id:tid,name:String(tid),username:"",status:"administrator"};
      DB.groupMembers[gid][tid].status="administrator"; DB.groupMembers[gid][tid].isAdmin=true; DB.groupMembers[gid][tid].adminPerms={can_manage_chat:true,can_delete_messages:true,can_restrict_members:true,can_invite_users:true,can_pin_messages:true,can_change_info:false,can_promote_members:false};
      saveDB(); log("promote_grp",uid,`${tid} في ${gid}`); return edit(`⭐ *تمت ترقية العضو لمشرف بنجاح!*`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    }catch(e){ return edit(`❌ فشل الترقية: ${e.message}\n\n_تأكد أن البوت لديه صلاحية ترقية المشرفين_`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── إزالة مشرف ───
  if(data.startsWith("grp_demote:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const admins=Object.values(DB.groupMembers[gid]||{}).filter(m=>m.isAdmin&&!m.isOwner&&m.status!=="creator");
    if(!admins.length) return edit("⭐ *لا يوجد مشرفون لإزالتهم.*",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    const rows=admins.slice(0,12).map(m=>[Markup.button.callback(`⭐ ${m.name.slice(0,20)}`,`grp_do_demote:${gid}:${m.id}`)]); rows.push([Markup.button.callback("🔙",`group_view:${gid}`)]); return edit("⬇️ *اختر المشرف لإزالة صلاحياته:*",Markup.inlineKeyboard(rows));
  }
  if(data.startsWith("grp_do_demote:")){
    if(!isAdmin(uid))return; const parts=data.split(":"); const gid=parts[1]; const tid=parseInt(parts[2]);
    try{
      await bot.telegram.promoteChatMember(gid,tid,{can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,can_promote_members:false,can_change_info:false,can_invite_users:false,can_pin_messages:false});
      if(DB.groupMembers[gid]?.[tid]){ DB.groupMembers[gid][tid].status="member"; DB.groupMembers[gid][tid].isAdmin=false; DB.groupMembers[gid][tid].adminPerms=null; } saveDB(); log("demote_grp",uid,`${tid} في ${gid}`);
      return edit(`⬇️ *تمت إزالة صلاحيات المشرف بنجاح*`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]]));
    }catch(e){ return edit(`❌ فشل إزالة الصلاحيات: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  }

  // ─── كلمات المراقبة ───
  if(data.startsWith("grp_watchwords:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const words=DB.groupWatchwords[gid]||[];
    let txt=`👁 *كلمات المراقبة في ${DB.groups[gid]?.title||gid}*\n\n`; txt+=words.length?words.map((w,i)=>`${i+1}. \`${w}\``).join("\n"):"لا توجد كلمات مراقبة."; txt+="\n\n_عند ذكر هذه الكلمات يُرسل تنبيه لك سراً_";
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("➕ إضافة كلمة",`grp_add_watchword:${gid}`), Markup.button.callback("🗑 مسح الكل",`grp_clear_watchwords:${gid}`)],[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_add_watchword:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.state[uid]={mode:"add_watchword",gid}; return edit("✏️ أرسل الكلمة للمراقبة:",Markup.inlineKeyboard([[Markup.button.callback("❌",`grp_watchwords:${gid}`)]])); }
  if(data.startsWith("grp_clear_watchwords:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.groupWatchwords[gid]=[]; saveDB(); return edit("✅ تم مسح كلمات المراقبة.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }

  // ─── كلمات الإساءة ───
  if(data.startsWith("grp_badwords:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const words=DB.groupBadwords[gid]||[];
    let txt=`🚨 *كلمات الإساءة في ${DB.groups[gid]?.title||gid}*\n\n`; txt+=words.length?words.map((w,i)=>`${i+1}. \`${w}\``).join("\n"):"لا توجد كلمات إساءة."; txt+="\n\n_من يقول هذه الكلمات يُكتم تلقائياً ٥ دقائق_";
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("➕ إضافة كلمة",`grp_add_badword:${gid}`), Markup.button.callback("🗑 مسح الكل",`grp_clear_badwords:${gid}`)],[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_add_badword:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.state[uid]={mode:"add_badword",gid}; return edit("✏️ أرسل الكلمة المحظورة:",Markup.inlineKeyboard([[Markup.button.callback("❌",`grp_badwords:${gid}`)]])); }
  if(data.startsWith("grp_clear_badwords:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.groupBadwords[gid]=[]; saveDB(); return edit("✅ تم مسح كلمات الإساءة.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }

  // ─── رسالة ترحيب مخصصة ───
  if(data.startsWith("grp_welcome:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const current=DB.grpWelcome[gid]||"";
    return edit(`👋 *رسالة الترحيب — ${DB.groups[gid]?.title||gid}*\n\n${current?`*الحالية:*\n_${current}_`:"لا توجد رسالة ترحيب."}\n\n_المتغيرات: {name}، {username}، {group}_`, Markup.inlineKeyboard([[Markup.button.callback("✏️ تعيين رسالة ترحيب",`grp_set_welcome:${gid}`)],[current?Markup.button.callback("🗑 حذف",`grp_del_welcome:${gid}`):Markup.button.callback("🔙",`group_view:${gid}`)],[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_set_welcome:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.state[uid]={mode:"set_grp_welcome",gid}; return edit("✏️ أرسل رسالة الترحيب:",Markup.inlineKeyboard([[Markup.button.callback("❌",`grp_welcome:${gid}`)]])); }
  if(data.startsWith("grp_del_welcome:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; delete DB.grpWelcome[gid]; saveDB(); return edit("✅ تم حذف رسالة الترحيب.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }

  // ─── قواعد القروب ───
  if(data.startsWith("grp_rules:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; const rules=DB.grpRules[gid]||"";
    return edit(`📋 *قواعد ${DB.groups[gid]?.title||gid}*\n\n${rules?rules:"لا توجد قواعد محددة."}`, Markup.inlineKeyboard([[Markup.button.callback("✏️ تعيين القواعد",`grp_set_rules:${gid}`)],[Markup.button.callback("📢 إرسال للقروب",`grp_send_rules:${gid}`)],[rules?Markup.button.callback("🗑 حذف القواعد",`grp_del_rules:${gid}`):Markup.button.callback("🔙",`group_view:${gid}`)],[Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_set_rules:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.state[uid]={mode:"set_grp_rules",gid}; return edit("📋 أرسل قواعد القروب:",Markup.inlineKeyboard([[Markup.button.callback("❌",`grp_rules:${gid}`)]])); }
  if(data.startsWith("grp_del_rules:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; delete DB.grpRules[gid]; saveDB(); return edit("✅ تم حذف القواعد.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }
  if(data.startsWith("grp_send_rules:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; const rules=DB.grpRules[gid]; if(!rules) return edit("❌ لم تُحدد قواعد بعد.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`grp_rules:${gid}`)]])); try{ await bot.telegram.sendMessage(gid,`📋 *قواعد المجموعة:*\n\n${rules}`,{parse_mode:"Markdown"}); return edit("✅ تم إرسال القواعد.",Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`grp_rules:${gid}`)]])); } }

  // ─── إعدادات الحماية ───
  if(data.startsWith("grp_protection:")){
    if(!isAdmin(uid))return; const gid=data.split(":")[1]; if(!DB.groupSettings[gid]) DB.groupSettings[gid]={}; const gs=DB.groupSettings[gid];
    return edit(`⚙️ *إعدادات الحماية — ${DB.groups[gid]?.title||gid}*`, Markup.inlineKeyboard([
      [Markup.button.callback(`🤖 مكافحة البوتات: ${gs.antiBot?"✅":"❌"}`,`grp_toggle:antiBot:${gid}`)],
      [Markup.button.callback(`🛡 مكافحة الإضافة الكثيرة: ${gs.antiSpamAdd?"✅":"❌"}`,`grp_toggle:antiSpamAdd:${gid}`)],
      [Markup.button.callback(`👁 مراقبة إزالة المشرفين: ${gs.monitorDemote?"✅":"❌"}`,`grp_toggle:monitorDemote:${gid}`)],
      [Markup.button.callback("🔙",`group_view:${gid}`)]]));
  }
  if(data.startsWith("grp_toggle:")){ if(!isAdmin(uid))return; const parts=data.split(":"); const setting=parts[1]; const gid=parts[2]; if(!DB.groupSettings[gid]) DB.groupSettings[gid]={}; DB.groupSettings[gid][setting]=!DB.groupSettings[gid][setting]; saveDB(); return ctx.answerCbQuery("تم التحديث").then(()=>ctx.editMessageReplyMarkup(groupControlKb(gid,uid).reply_markup).catch(()=>{})); }

  // ─── إرسال رسالة للقروب ───
  if(data.startsWith("msg_group:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; DB.state[uid]={mode:"msg_group",gid}; return edit("📨 أرسل الرسالة التي تريد إرسالها للقروب:",Markup.inlineKeyboard([[Markup.button.callback("❌",`group_view:${gid}`)]])); }

  // ─── رابط دعوة ───
  if(data.startsWith("group_link:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; try{ const inviteLink=await bot.telegram.exportChatInviteLink(gid); return edit(`🔗 *رابط دعوة ${DB.groups[gid]?.title||gid}:*\n\`${inviteLink}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); }catch(e){ return edit(`❌ فشل: ${e.message}`,Markup.inlineKeyboard([[Markup.button.callback("🔙",`group_view:${gid}`)]])); } }

  // ─── حذف من القائمة ───
  if(data.startsWith("del_group:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; delete DB.groups[gid]; delete DB.groupMembers[gid]; saveDB(); return edit("✅ تم حذف القروب من القائمة.",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_groups")]])); }

  // ─── أزرار المطور العامة ───
  if(data==="dev_broadcast"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"dev_broadcast"}; return edit("📢 أرسل الرسالة التي تريد إذاعتها لجميع المستخدمين:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]])); }
  if(data==="dev_search_user"){ if(!isAdmin(uid))return; DB.state[uid]={mode:"dev_search_user"}; return edit("🔍 أرسل اسم أو معرف المستخدم:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]])); }
  if(data==="dev_customize"){ if(!isDev(uid))return; return edit("⚙️ *تخصيص البوت*", Markup.inlineKeyboard([[Markup.button.callback("✏️ تغيير اسم البوت","dev_customize_name")],[Markup.button.callback("✏️ تغيير رسالة الترحيب","dev_customize_welcome")],[Markup.button.callback("🔙","dev_panel")]])); }
  if(data==="dev_customize_name"){ if(!isDev(uid))return; DB.state[uid]={mode:"dev_customize_name"}; return edit("✏️ أرسل اسم البوت الجديد:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]])); }
  if(data==="dev_customize_welcome"){ if(!isDev(uid))return; DB.state[uid]={mode:"dev_customize_welcome"}; return edit("✏️ أرسل رسالة الترحيب الجديدة:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_customize")]])); }
  if(data==="dev_ai_settings"){ if(!isDev(uid))return; return edit(`🤖 *إعدادات AI*\n\nالوضع: ${DB.settings.aiEnabled?"✅ مفعّل":"❌ معطّل"} | الحد: ${DB.settings.maxAiMsgsPerDay} رسالة/يوم`, Markup.inlineKeyboard([[Markup.button.callback("تفعيل/تعطيل AI","ds_ai_toggle")],[Markup.button.callback("الحد اليومي","ds_ai_limit")],[Markup.button.callback("🔙","dev_panel")]])); }
  if(data==="dev_weekly_report"){ if(!isDev(uid))return; return edit("📈 التقرير الأسبوعي غير متوفر حالياً (قيد التطوير).",Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_ban:")){ if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); DB.users[tid].banned=true; saveDB(); return edit(`🚫 تم حظر المستخدم \`${tid}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_unban:")){ if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); DB.users[tid].banned=false; saveDB(); return edit(`✅ تم رفع الحظر عن \`${tid}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_mute:")){ if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); DB.users[tid].muted=true; saveDB(); return edit(`🔇 تم كتم \`${tid}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_unmute:")){ if(!isAdmin(uid))return; const tid=parseInt(data.split(":")[1]); DB.users[tid].muted=false; saveDB(); return edit(`🔊 تم رفع الكتم عن \`${tid}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_promote:")){ if(!isDev(uid))return; const tid=parseInt(data.split(":")[1]); DB.admins.add(tid); saveDB(); return edit(`⭐ تم ترقية \`${tid}\` لمسؤول`,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data.startsWith("dev_demote:")){ if(!isDev(uid))return; const tid=parseInt(data.split(":")[1]); DB.admins.delete(tid); saveDB(); return edit(`⬇️ تم تخفيض \`${tid}\``,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data==="dev_admins"){ if(!isDev(uid))return; let txt=`🛡 *المسؤولون:*\n\n`; [...DB.admins].forEach(id=>{ txt+=`⭐ \`${id}\` ${DB.users[id]?.name||""}\n`; }); return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙","dev_panel")]])); }
  if(data==="dev_announce"){ if(!isDev(uid))return; DB.state[uid]={mode:"dev_announce"}; return edit("📣 أرسل نص الإعلان:",Markup.inlineKeyboard([[Markup.button.callback("❌","dev_panel")]])); }
  if(data.startsWith("grp_antibot:")){ if(!isAdmin(uid))return; const gid=data.split(":")[1]; if(!DB.groupSettings[gid]) DB.groupSettings[gid]={}; DB.groupSettings[gid].antiBot=!DB.groupSettings[gid].antiBot; saveDB(); return ctx.answerCbQuery("تم التحديث").then(()=>ctx.editMessageReplyMarkup(groupControlKb(gid,uid).reply_markup).catch(()=>{})); }
  if(data.startsWith("upage:")){ const parts=data.split(":"); const action=parts[1]; const page=parseInt(parts[2]); return edit("*اختر عضواً:*",usersKb(action,page)); }
});

// ===================== معالج النصوص =====================
bot.on("text", async (ctx, next) => {
  const uid = ctx.from?.id; if (!uid) return next();
  const text = ctx.message.text.trim();
  const state = DB.state[uid]; if (!state) return next();
  const { mode } = state;

  if (mode === "captcha") {
    const ans = parseInt(text); const correct = DB.sessions[uid]?.captchaAns;
    if (ans === correct) { delete DB.state[uid]; delete DB.sessions[uid].captchaAns; return showRegisterOrLogin(ctx); }
    else return ctx.reply("❌ إجابة خاطئة، حاول مرة أخرى.");
  }
  if (mode === "login_email") {
    const matchedUser = Object.entries(DB.users).find(([id, u]) => u.accountEmail === text);
    if (!matchedUser) return ctx.reply("❌ لم نجد حساباً بهذا الإيميل.");
    DB.state[uid] = { mode: "login_pass", foundId: matchedUser[0] };
    return ctx.reply("🔐 أدخل كلمة السر:");
  }
  if (mode === "login_pass") {
    const u = DB.users[state.foundId];
    if (hashPass(text) === u.passwordHash) {
      DB.users[uid] = { ...DB.users[uid], ...u, id: uid, name: ctx.from.first_name, username: ctx.from.username, verified: true };
      delete DB.state[uid]; saveDB();
      return ctx.reply("✅ تم استعادة حسابك بنجاح!", mainKb());
    } else return ctx.reply("❌ كلمة سر خاطئة.");
  }
  if (mode === "ai_chat") {
    if (!DB.settings.aiEnabled && !isAdmin(uid)) { delete DB.state[uid]; return ctx.reply("❌ الذكاء الاصطناعي معطّل.", mainKb()); }
    if (aiDailyCount(uid) >= DB.settings.maxAiMsgsPerDay && !isAdmin(uid)) { delete DB.state[uid]; return ctx.reply("🚫 تم استهلاك الحد اليومي للـ AI.", mainKb()); }
    await ctx.replyWithChatAction("typing"); const reply = await aiChat(uid, text); ctx.reply(reply, { parse_mode: "Markdown" }).catch(() => {}); return;
  }
  if (mode === "save_email_label") {
    const { email, inboxId } = state; if (!DB.savedEmails[uid]) DB.savedEmails[uid] = [];
    DB.savedEmails[uid].push({ email, label: text, savedAt: stamp() }); delete DB.state[uid]; saveDB();
    return ctx.reply(`✅ تم حفظ الإيميل تحت "${text}"`, emailActiveKb(email, inboxId));
  }
  if (mode === "save_pass_custom") {
    if (text.length < 3) return ctx.reply("❌ كلمة السر قصيرة جداً.");
    DB.state[uid] = { mode: "store_pass_platform", pass: text };
    return ctx.reply("✏️ اكتب اسم المنصة:", Markup.inlineKeyboard([[Markup.button.callback("❌", "menu_passwords")]]));
  }
  if (mode === "store_pass_platform") {
    if (!DB.savedPasswords[uid]) DB.savedPasswords[uid] = [];
    DB.savedPasswords[uid].push({ platform: text, password: state.pass, savedAt: stamp() }); delete DB.state[uid]; saveDB();
    return ctx.reply(`✅ تم حفظ كلمة السر لـ "${text}"`, mainKb());
  }
  if (mode === "search_pass") {
    const saved = DB.savedPasswords[uid] || []; const results = saved.filter(p => p.platform.toLowerCase().includes(text.toLowerCase()));
    if (!results.length) { delete DB.state[uid]; return ctx.reply("🔍 لا توجد نتائج.", mainKb()); }
    delete DB.state[uid]; let txt = `🔍 *نتائج البحث:*\n\n`; results.forEach((p, i) => { const strength = passwordStrength(p.password); txt += `${i + 1}. 🏷 *${p.platform}*\n   \`${p.password}\` ${strength.label}\n   📅 ${p.savedAt || "—"}\n\n`; });
    return ctx.reply(txt, { parse_mode: "Markdown" });
  }
  if (mode === "add_note") {
    if (!DB.notes[uid]) DB.notes[uid] = []; DB.notes[uid].unshift({ text, time: stamp(), id: Date.now() }); if (DB.notes[uid].length > 50) DB.notes[uid].pop(); delete DB.state[uid]; saveDB();
    return ctx.reply("✅ تم حفظ الملاحظة.", mainKb());
  }
  if (mode === "vt_url") {
    delete DB.state[uid]; await ctx.replyWithChatAction("typing"); const result = await vtScanUrl(text);
    let reply; if (!result) reply = "❌ تعذر الفحص."; else { const mal = result.stats.malicious || 0; const total = Object.values(result.stats).reduce((a, b) => a + b, 0); reply = `🔍 *نتيجة فحص الرابط:*\n\n🔗 \`${text}\`\n🛡 المحركات الخبيثة: *${mal}/${total}*\n${result.malEngines.length ? "⚠️ " + result.malEngines.join(", ") : "✅ نظيف"}`; }
    return ctx.reply(reply, { parse_mode: "Markdown" });
  }
  if (mode === "vt_domain") {
    delete DB.state[uid]; await ctx.replyWithChatAction("typing"); const result = await vtScanDomain(text);
    let reply; if (!result) reply = "❌ تعذر الفحص."; else { const mal = result.stats.malicious || 0; const total = Object.values(result.stats).reduce((a, b) => a + b, 0); reply = `🌐 *فحص الدومين*\n\n🔗 \`${text}\`\n🛡 الخبيثة: ${mal}/${total}\n📅 الإنشاء: ${result.created}`; }
    return ctx.reply(reply, { parse_mode: "Markdown" });
  }
  if (mode === "vt_ip") {
    delete DB.state[uid]; await ctx.replyWithChatAction("typing"); const result = await vtScanIp(text);
    let reply; if (!result) reply = "❌ تعذر الفحص."; else { const mal = result.stats.malicious || 0; const total = Object.values(result.stats).reduce((a, b) => a + b, 0); reply = `🖥 *فحص IP*\n\`${text}\`\n🛡 الخبيثة: ${mal}/${total}\n🌍 الدولة: ${result.country}`; }
    return ctx.reply(reply, { parse_mode: "Markdown" });
  }
  if (mode === "acc_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return ctx.reply("❌ صيغة بريد غير صالحة.");
    DB.users[uid].accountEmail = text; delete DB.state[uid]; saveDB(); return ctx.reply("✅ تم تغيير بريدك.", mainKb());
  }
  if (mode === "acc_pass") {
    if (text.length < 6) return ctx.reply("❌ كلمة السر أقل من 6 أحرف.");
    DB.users[uid].accountPassword = text; DB.users[uid].passwordHash = hashPass(text); delete DB.state[uid]; saveDB(); return ctx.reply("✅ تم تغيير كلمة السر.", mainKb());
  }
  if (mode === "dev_setting") {
    if (!isAdmin(uid)) return next(); const num = parseInt(text); if (isNaN(num)) return ctx.reply("❌ أدخل رقماً صحيحاً.");
    const { key } = state; if (key === "ds_max") DB.settings.maxEmailsPerDay = num; else if (key === "ds_cool") DB.settings.cooldown = num; else if (key === "ds_watch") DB.settings.emailWatchMin = num; else if (key === "ds_ref") DB.settings.refBonus = num; else if (key === "ds_ai_limit") DB.settings.maxAiMsgsPerDay = num;
    delete DB.state[uid]; saveDB(); return ctx.reply("✅ تم التحديث.", devSettingsKb());
  }
  if (mode === "add_watchword") {
    const gid = state.gid; if (!DB.groupWatchwords[gid]) DB.groupWatchwords[gid] = []; DB.groupWatchwords[gid].push(text); delete DB.state[uid]; saveDB();
    return ctx.reply(`👁 تمت إضافة "${text}"`, Markup.inlineKeyboard([[Markup.button.callback("🔙", `grp_watchwords:${gid}`)]]));
  }
  if (mode === "add_badword") {
    const gid = state.gid; if (!DB.groupBadwords[gid]) DB.groupBadwords[gid] = []; DB.groupBadwords[gid].push(text); delete DB.state[uid]; saveDB();
    return ctx.reply(`🚨 تمت إضافة "${text}"`, Markup.inlineKeyboard([[Markup.button.callback("🔙", `grp_badwords:${gid}`)]]));
  }
  if (mode === "set_grp_welcome") {
    const gid = state.gid; DB.grpWelcome[gid] = text; delete DB.state[uid]; saveDB();
    const preview = text.replace("{name}", ctx.from.first_name).replace("{username}", ctx.from.username || ctx.from.first_name).replace("{group}", DB.groups[gid]?.title || "قروب");
    ctx.replyWithMarkdown(`👋 *معاينة:*\n${preview}`);
    return ctx.reply("✅ تم تعيين رسالة الترحيب.", Markup.inlineKeyboard([[Markup.button.callback("🔙", `group_view:${gid}`)]]));
  }
  if (mode === "set_grp_rules") {
    const gid = state.gid; DB.grpRules[gid] = text; delete DB.state[uid]; saveDB();
    return ctx.reply("✅ تم تعيين القواعد.", Markup.inlineKeyboard([[Markup.button.callback("🔙", `group_view:${gid}`)]]));
  }
  if (mode === "dev_broadcast") {
    delete DB.state[uid]; let success = 0, fail = 0;
    for (const id of Object.keys(DB.users)) { try { await bot.telegram.sendMessage(id, text, { parse_mode: "Markdown" }); success++; await sleep(100); } catch { fail++; } }
    return ctx.reply(`📢 تم الإرسال إلى ${success} مستخدم.\n❌ فشل: ${fail}`);
  }
  if (mode === "msg_user") {
    const tid = state.tid; delete DB.state[uid];
    try { await bot.telegram.sendMessage(tid, `📨 رسالة من المطور:\n\n${text}`); return ctx.reply("✅ تم الإرسال."); } catch (e) { return ctx.reply("❌ فشل الإرسال."); }
  }
  if (mode === "add_user_note") {
    const tid = state.tid; DB.userNotes[tid] = text; delete DB.state[uid]; saveDB();
    return ctx.reply("✅ تمت إضافة الملاحظة.", Markup.inlineKeyboard([[Markup.button.callback("🔙", `dev_view_user:${tid}`)]]));
  }
  if (mode === "msg_group") {
    const gid = state.gid; delete DB.state[uid];
    try { await bot.telegram.sendMessage(gid, text); return ctx.reply("✅ تم الإرسال للقروب."); } catch (e) { return ctx.reply("❌ فشل الإرسال."); }
  }
  if (mode === "dev_search_user") {
    delete DB.state[uid]; const results = Object.entries(DB.users).filter(([id, u]) => { const s = text.toLowerCase(); return String(id).includes(s) || (u.name && u.name.toLowerCase().includes(s)) || (u.username && u.username.toLowerCase().includes(s)); }).slice(0, 10);
    if (!results.length) return ctx.reply("🔍 لا توجد نتائج."); let txt = `🔍 *نتائج البحث:*\n\n`; results.forEach(([id, u]) => { txt += `👤 *${u.name}* [\`${id}\`]\n@${u.username || "—"}\n\n`; });
    return ctx.reply(txt, { parse_mode: "Markdown" });
  }
  if (mode === "dev_customize_name") { DB.settings.botName = text; delete DB.state[uid]; saveDB(); return ctx.reply(`✅ تم تغيير اسم البوت إلى: ${text}`); }
  if (mode === "dev_customize_welcome") { DB.settings.welcomeMsg = text; delete DB.state[uid]; saveDB(); return ctx.reply("✅ تم تغيير رسالة الترحيب."); }
  if (mode === "dev_announce") {
    delete DB.state[uid]; const announcement = `📢 ${text}`; DB.announcements.unshift(announcement); if (DB.announcements.length > 5) DB.announcements.pop(); saveDB();
    let success = 0, fail = 0; for (const id of Object.keys(DB.users)) { try { await bot.telegram.sendMessage(id, announcement, { parse_mode: "Markdown" }); success++; await sleep(100); } catch { fail++; } }
    return ctx.reply(`📣 تم إرسال الإعلان إلى ${success} مستخدم.\n❌ فشل: ${fail}`);
  }

  return next();
});

// ===================== استعادة النسخ الاحتياطية =====================
bot.on("document", async (ctx, next) => {
  const uid = ctx.from?.id; if (!uid) return next();
  const state = DB.state[uid]; if (!state || state.mode !== "backup_restore") return next();
  const doc = ctx.message.document; if (!doc) return ctx.reply("❌ لم يتم العثور على ملف.");
  if (!doc.file_name?.endsWith(".json")) return ctx.reply("❌ الملف يجب أن يكون بصيغة JSON.");
  if (doc.file_size > 15 * 1024 * 1024) return ctx.reply("❌ حجم الملف كبير جداً. الحد الأقصى 15 ميجابايت.");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await axios.get(fileLink.href, { responseType: "text", timeout: 30000 });
    const backupData = JSON.parse(response.data);
    const backupOld = `database_before_restore_${Date.now()}.json`;
    fs.writeFileSync(backupOld, JSON.stringify(DB, null, 2), "utf8");

    if (backupData.users)         Object.assign(DB.users, backupData.users);
    if (backupData.savedEmails)   Object.assign(DB.savedEmails, backupData.savedEmails);
    if (backupData.savedPasswords)Object.assign(DB.savedPasswords, backupData.savedPasswords);
    if (backupData.emailHistory)  Object.assign(DB.emailHistory, backupData.emailHistory);
    if (backupData.notes)         Object.assign(DB.notes, backupData.notes);
    if (backupData.referrals)     Object.assign(DB.referrals, backupData.referrals);
    if (backupData.referralOf)    Object.assign(DB.referralOf, backupData.referralOf);
    if (backupData.referralPerks) Object.assign(DB.referralPerks, backupData.referralPerks);
    if (backupData.aiModes)       Object.assign(DB.aiModes, backupData.aiModes);
    if (backupData.groups)        Object.assign(DB.groups, backupData.groups);
    if (backupData.groupMembers)  Object.assign(DB.groupMembers, backupData.groupMembers);
    if (backupData.groupSettings) Object.assign(DB.groupSettings, backupData.groupSettings);
    if (backupData.groupBanned)   Object.assign(DB.groupBanned, backupData.groupBanned);
    if (backupData.groupMuted)    Object.assign(DB.groupMuted, backupData.groupMuted);
    if (backupData.groupWatchwords)Object.assign(DB.groupWatchwords, backupData.groupWatchwords);
    if (backupData.groupBadwords) Object.assign(DB.groupBadwords, backupData.groupBadwords);
    if (backupData.grpWelcome)    Object.assign(DB.grpWelcome, backupData.grpWelcome);
    if (backupData.grpRules)      Object.assign(DB.grpRules, backupData.grpRules);
    if (backupData.settings)      DB.settings = { ...DB.settings, ...backupData.settings };
    if (backupData.admins)        DB.admins = new Set(backupData.admins);
    if (backupData.adminPerms)    Object.assign(DB.adminPerms, backupData.adminPerms);
    if (backupData.announcements) DB.announcements = backupData.announcements;

    saveDB();
    delete DB.state[uid];
    await ctx.reply(`✅ *تم استعادة النسخة الاحتياطية بنجاح!*\n\n👥 تم دمج البيانات.\n⚙️ تم تحديث الإعدادات.\n📌 البيانات القديمة لم تُحذف.`, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Restore error:", e);
    return ctx.reply("❌ فشل في معالجة الملف. تأكد من صلاحية JSON.");
  }
});

// ===================== تشغيل البوت =====================
bot.launch()
  .then(() => console.log(`✅ ${DB.settings.botName} يعمل الآن`))
  .catch(err => console.error("خطأ في launch:", err));

console.log("🚀 البوت جاهز");
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));