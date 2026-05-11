"use strict";

// ============================================================
//  بوت تيليجرام شامل المطور v5.0
//  مع: قاعدة بيانات JSON | تحقق مرة واحدة | تسجيل دخول/إنشاء حساب
//  AI غير محدود | نظام قروبات متكامل | تحكم شامل للمطور
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
const AI_KEY      = "sk-f7307872f8004ecd92c0764b0f03f7f5"; // مفتاح الذكاء الاصطناعي
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

// ===================== قاعدة البيانات (JSON دائمة) =====================
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const data = JSON.parse(raw);
      // تحويل Set من array
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
    toSave.admins = [...DB.admins]; // Set → Array للحفظ
    fs.writeFileSync(DB_FILE, JSON.stringify(toSave, null, 2), "utf8");
  } catch(e) { console.error("saveDB error:", e.message); }
}

// حفظ تلقائي كل 30 ثانية
setInterval(saveDB, 30000);

const defaultDB = {
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
  adminPerms:    {},
  announcements: [],
  groups:        {},
  groupSettings: {},  // إعدادات كل قروب
  groupMembers:  {},  // أعضاء كل قروب
  groupBanned:   {},  // محظورون في القروب
  groupMuted:    {},  // مكتومون في القروب
  groupWatchwords:{}, // كلمات مراقبة لكل قروب
  groupBadwords:  {}, // كلمات إساءة لكل قروب
  adminActionLog: {}, // سجل تصرفات المشرفين
  aiConversations:{}, // محادثات AI لكل مستخدم
  muteSchedules:  {}, // جدولة كتم/فك كتم جماعي
  groupOwnerPanel:{}, // إعدادات لوحة المالك
  settings: {
    maxEmailsPerDay:      30,
    cooldown:             8,
    emailWatchMin:        25,
    refBonus:             5,
    maintenanceMode:      false,
    screenshotProtection: false,
    botName:              "بوت شامل v5",
    welcomeMsg:           "أهلاً بك في البوت! 🎉",
  },
  lastReq:  {},
  daily:    {},
  vtCache:  {},
  state:    {},
};

const loaded = loadDB();
const DB = loaded || defaultDB;
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
      passwordHash:null, accountEmail:null, accountPassword:null,
      lastSeen:stamp(), msgCount:0, verified:false,
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
  const names=["user","bot","temp","mail","acc"];
  const name=names[Math.floor(Math.random()*names.length)];
  return `${name}${randStr(6)}@botaccount.io`;
}

// ===================== MailSlurp =====================
async function msCreateInbox(expiresInMinutes=25) {
  for(let attempt=1;attempt<=3;attempt++){
    try {
      const expiresAt=new Date(Date.now()+expiresInMinutes*60*1000).toISOString();
      const r=await axios.post(`${MS_BASE}/inboxes`,
        {expiresAt,useDomainPool:true,isPublic:false,inboxType:"HTTP_INBOX"},
        {headers:msHeaders,timeout:20000});
      if(!r.data?.emailAddress||!r.data?.id){
        console.error(`msCreateInbox attempt ${attempt}: missing data`,r.data);
        continue;
      }
      return {email:r.data.emailAddress,inboxId:r.data.id,expiresAt:r.data.expiresAt};
    } catch(e){
      console.error(`msCreateInbox attempt ${attempt}:`,e.response?.status,e.message);
      if(e.response?.status===401) return null; // مفتاح خاطئ — لا فائدة من إعادة المحاولة
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
    // MailSlurp يعيد { content: [...] } أو مصفوفة مباشرة
    const content=r.data?.content??r.data;
    return Array.isArray(content)?content:[];
  } catch(e){
    console.error("msGetEmails:",e.response?.status,e.message);
    return [];
  }
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
  const clean=text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
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
      }catch(e){ console.error("sendMsg:",e.message); }
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
async function aiChat(uid, userMessage) {
  if(!DB.aiConversations[uid]) DB.aiConversations[uid]=[];
  DB.aiConversations[uid].push({role:"user",content:userMessage});

  const messages=[
    {role:"system",content:"أنت مساعد ذكي خبير ومتعدد المهارات. أجب باللغة العربية بشكل مختصر ومفيد. أنت مساعد AI متقدم."},
    ...DB.aiConversations[uid].slice(-10)
  ];

  try {
    const r=await axios.post(`${AI_BASE}/chat/completions`,{
      model: AI_MODEL,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
      stream: false,
    },{
      headers:{
        "Authorization":`Bearer ${AI_KEY}`,
        "Content-Type":"application/json",
        "Accept":"application/json",
      },
      timeout:60000,
      validateStatus: s=>s<500,
    });

    if(r.status===401||r.status===403){
      console.error("AI auth error:",r.status,r.data);
      DB.aiConversations[uid].pop(); // أزل رسالة المستخدم الفاشلة
      return "❌ مفتاح الذكاء الاصطناعي غير صالح. يرجى التواصل مع المطور.";
    }
    if(r.status===429){
      DB.aiConversations[uid].pop();
      return "⏳ تم تجاوز حد الطلبات، انتظر قليلاً ثم حاول مجدداً.";
    }
    if(!r.data?.choices?.length){
      console.error("AI empty response:",JSON.stringify(r.data));
      DB.aiConversations[uid].pop();
      return "❌ لم أتلقَّ رداً من الذكاء الاصطناعي. حاول مجدداً.";
    }

    const reply=r.data.choices[0].message?.content?.trim()||"لم أتمكن من الرد.";
    DB.aiConversations[uid].push({role:"assistant",content:reply});
    if(DB.aiConversations[uid].length>20) DB.aiConversations[uid]=DB.aiConversations[uid].slice(-20);
    return reply;
  } catch(e){
    DB.aiConversations[uid].pop(); // أزل رسالة المستخدم الفاشلة
    const status=e.response?.status;
    const errData=e.response?.data;
    console.error("AI error:",status,errData||e.message);
    if(status===401||status===403) return "❌ مفتاح الذكاء الاصطناعي غير صالح.";
    if(status===429) return "⏳ تم تجاوز حد الطلبات، حاول بعد قليل.";
    if(e.code==="ECONNABORTED"||e.code==="ETIMEDOUT") return "⏱ انتهت مهلة الاتصال بالذكاء الاصطناعي. حاول مجدداً.";
    return "❌ خطأ في الاتصال بالذكاء الاصطناعي. حاول مجدداً.";
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
      const result={
        stats:attr.stats||{},reputation:0,
        malEngines:Object.entries(attr.results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
      };
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
    return {
      stats:attr.last_analysis_stats||{},reputation:attr.reputation||0,registrar:attr.registrar||"—",
      created:attr.creation_date?new Date(attr.creation_date*1000).toLocaleDateString("ar"):"—",
      malEngines:Object.entries(attr.last_analysis_results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
    };
  }catch{ return null; }
}

async function vtScanIp(ip) {
  try {
    const r=await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
    const attr=r.data?.data?.attributes||{};
    return {
      stats:attr.last_analysis_stats||{},reputation:attr.reputation||0,country:attr.country||"—",
      asOwner:attr.as_owner||"—",
      malEngines:Object.entries(attr.last_analysis_results||{}).filter(([,v])=>v.category==="malicious").map(([k])=>k).slice(0,5),
    };
  }catch{ return null; }
}

async function vtUploadFile(buffer,filename) {
  try {
    const FormData=require("form-data");
    const form=new FormData();
    form.append("file",buffer,{filename:filename||"file"});
    const r=await axios.post("https://www.virustotal.com/api/v3/files",form,{
      headers:{...form.getHeaders(),"x-apikey":VT_KEY},
      timeout:120000,maxContentLength:Infinity,maxBodyLength:Infinity,
    });
    return r.data?.data?.id||null;
  }catch(e){ return null; }
}

async function vtGetAnalysis(id) {
  try {
    for(let i=0;i<8;i++){
      const r=await axios.get(`https://www.virustotal.com/api/v3/analyses/${id}`,{headers:{"x-apikey":VT_KEY},timeout:12000});
      const attr=r.data?.data?.attributes;
      if(attr?.status==="completed") return attr;
      await sleep(5000);
    }
  }catch(e){}
  return null;
}

// ===================== نظام تتبع عضوية القروبات =====================

// جلب رتبة شخص من Telegram مباشرة (التحقق الحقيقي)
async function getTelegramMemberStatus(gid, uid) {
  try {
    const member = await bot.telegram.getChatMember(gid, uid);
    return member; // { status, user, can_delete_messages, ... }
  } catch(e) {
    return null;
  }
}

// تحديث رتبة شخص في قروب معين من Telegram
async function syncMemberRole(gid, uid) {
  const member = await getTelegramMemberStatus(gid, uid);
  if(!member) return null;
  if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};
  const status = member.status; // creator/administrator/member/restricted/left/kicked
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

// جلب كل قروبات مستخدم معين مع رتبته فيها
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

// نص وصف رتبة شخص
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

// تحديث قائمة أعضاء القروب الكاملة من Telegram
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
      if(m.status==="creator"&&DB.groups[gid]){
        DB.groups[gid].ownerId=uid;
      }
    }
    saveDB();
    return admins;
  } catch(e){
    console.error("syncGroupAdmins:",gid,e.message);
    return [];
  }
}


// ===================== جدولة الكتم الجماعي التلقائي =====================
async function checkMuteSchedules() {
  const nowTs = now();
  for(const [gid, schedules] of Object.entries(DB.muteSchedules||{})){
    for(const [sid, sch] of Object.entries(schedules||{})){
      if(!sch.active) continue;
      if(!sch.muteDone && sch.muteAt && nowTs >= sch.muteAt){
        sch.muteDone = true;
        try{
          const members = Object.values(DB.groupMembers[gid]||{}).filter(m=>
            m.status==="member" && !m.isAdmin && !m.isOwner
          );
          let count=0;
          for(const m of members){
            try{
              await bot.telegram.restrictChatMember(gid, m.id, {
                permissions:{can_send_messages:false},
                until_date: sch.unmuteAt||0,
              });
              if(!DB.groupMuted[gid]) DB.groupMuted[gid]={};
              DB.groupMuted[gid][m.id]=stamp();
              count++;
            }catch{}
          }
          sch.mutedCount=count;
          const owner = DB.groups[gid]?.ownerId;
          if(owner){
            try{ await bot.telegram.sendMessage(owner,
              `🔇 *كتم جماعي مجدول*\n\n🏘 ${DB.groups[gid]?.title||gid}\n✅ تم كتم *${count}* عضو\n⏰ سيُفك: ${sch.unmuteAt?new Date(sch.unmuteAt*1000).toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"}):"يدوياً"}`,
              {parse_mode:"Markdown"}); }catch{}
          }
        }catch(e){ console.error("muteSchedule:",e.message); }
        saveDB();
      }
      if(sch.muteDone && !sch.unmuteDone && sch.unmuteAt && nowTs >= sch.unmuteAt){
        sch.unmuteDone = true; sch.active = false;
        try{
          const muted = Object.keys(DB.groupMuted[gid]||{});
          let count=0;
          for(const mid of muted){
            try{
              await bot.telegram.restrictChatMember(gid, parseInt(mid), {
                permissions:{can_send_messages:true,can_send_media_messages:true,
                  can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true},
              });
              delete DB.groupMuted[gid][mid];
              count++;
            }catch{}
          }
          const owner = DB.groups[gid]?.ownerId;
          if(owner){
            try{ await bot.telegram.sendMessage(owner,
              `🔊 *فك الكتم الجماعي التلقائي*\n\n🏘 ${DB.groups[gid]?.title||gid}\n✅ رُفع الكتم عن *${count}* عضو`,
              {parse_mode:"Markdown"}); }catch{}
          }
        }catch(e){ console.error("unmuteSchedule:",e.message); }
        saveDB();
      }
    }
  }
}
setInterval(checkMuteSchedules, 60000);

// ===================== أدوات تعديل القروب/القناة =====================
async function changeGroupPhoto(gid, fileId) {
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const res = await axios.get(fileLink.href, {responseType:"arraybuffer",timeout:30000});
    await bot.telegram.setChatPhoto(gid, {source: Buffer.from(res.data)});
    return {ok:true};
  } catch(e) { return {ok:false, error:e.message}; }
}

async function changeGroupTitle(gid, title) {
  try { await bot.telegram.setChatTitle(gid, title); return {ok:true}; }
  catch(e) { return {ok:false, error:e.message}; }
}

async function changeGroupDescription(gid, desc) {
  try { await bot.telegram.setChatDescription(gid, desc); return {ok:true}; }
  catch(e) { return {ok:false, error:e.message}; }
}

// رصد كامل للأعضاء: ID + يوزر + رتبة + رابط
function buildMemberReport(gid) {
  const g = DB.groups[gid]||{};
  const members = Object.values(DB.groupMembers[gid]||{});
  const active = members.filter(m=>m.status!=="left"&&m.status!=="kicked");
  let report = `📋 *تقرير أعضاء ${g.title||gid}*\n🆔 \`${gid}\`\n`;
  if(g.username) report += `🔗 @${g.username}\n`;
  report += `👥 العدد: *${active.length}*\n\n`;
  active.forEach((m,i)=>{
    const role = m.isOwner||m.status==="creator"?"👑":m.isAdmin||m.status==="administrator"?"⭐":m.isBot?"🤖":"👤";
    report += `${i+1}. ${role} *${m.name}*\n   🆔 \`${m.id}\``;
    if(m.username) report += `\n   @${m.username}`;
    if(m.customTitle) report += `\n   🏷 "${m.customTitle}"`;
    report += `\n   📅 ${m.joinedAt||"—"}\n`;
  });
  return report;
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
  [Markup.button.callback("📧 إيميل مؤقت","menu_emails"),
   Markup.button.callback("🤖 تحدث مع AI","menu_ai")],
  [Markup.button.callback("🔑 كلمات السر","menu_passwords"),
   Markup.button.callback("🔍 فحص أمان","menu_vt")],
  [Markup.button.callback("🌐 مراقبة مواقع","menu_uptime"),
   Markup.button.callback("📊 إحصائياتي","my_stats")],
  [Markup.button.callback("🎁 الإحالة","referral"),
   Markup.button.callback("📋 سجلي","my_history")],
  [Markup.button.callback("👤 حسابي","my_account"),
   Markup.button.callback("ℹ️ مساعدة","help")],
]);

const backKb=()=>Markup.inlineKeyboard([[Markup.button.callback("🔙 الرئيسية","back")]]);

const emailActiveKb=(email,inboxId)=>Markup.inlineKeyboard([
  [Markup.button.callback("📨 فتح الصندوق",`inbox:${inboxId}`),
   Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)],
  [Markup.button.callback("💾 حفظ الإيميل",`save_email:${inboxId}:${email}`),
   Markup.button.callback("🗑 إنهاء",`del_email:${inboxId}`)],
  [Markup.button.callback("🔙 الرئيسية","back")],
]);

const devKb=()=>Markup.inlineKeyboard([
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
  [Markup.button.callback("🏘 إدارة القروبات","dev_groups"),
   Markup.button.callback("🛡 المسؤولون","dev_admins")],
  [Markup.button.callback("📣 إعلانات","dev_announce"),
   Markup.button.callback("🔍 بحث عضو","dev_search_user")],
  [Markup.button.callback("⚙️ إعدادات","dev_settings"),
   Markup.button.callback("🤖 تخصيص البوت","dev_customize")],
  [Markup.button.callback("💾 نسخ احتياطي","dev_backup"),
   Markup.button.callback("📥 استيراد DB","dev_import_db")],
  [Markup.button.callback("🤖 إعدادات AI","dev_ai_settings")],
]);

const devSettingsKb=()=>Markup.inlineKeyboard([
  [Markup.button.callback(`🔧 الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}`,"ds_maint")],
  [Markup.button.callback(`📧 الحد اليومي: ${DB.settings.maxEmailsPerDay}`,"ds_max"),
   Markup.button.callback(`⏱ الانتظار: ${DB.settings.cooldown}ث`,"ds_cool")],
  [Markup.button.callback(`⏰ مراقبة: ${DB.settings.emailWatchMin}د`,"ds_watch"),
   Markup.button.callback(`🎁 مكافأة: ${DB.settings.refBonus}`,"ds_ref")],
  [Markup.button.callback(`🛡 حماية لقطات: ${DB.settings.screenshotProtection?"✅":"❌"}`,"ds_screenshot")],
  [Markup.button.callback("🔙 لوحة","dev_panel")],
]);

// لوحة تحكم القروب للمشرف/المالك
function groupControlKb(gid, uid) {
  const g = DB.groups[gid]||{};
  const isOwner = g.ownerId == uid || isDev(uid);
  const rows = [
    [Markup.button.callback("👥 الأعضاء",`grp_members:${gid}`),
     Markup.button.callback("👑 المشرفون",`grp_admins:${gid}`)],
    [Markup.button.callback("🔍 تحقق من رتبة",`grp_check_role:${gid}`),
     Markup.button.callback("🔄 تحديث المشرفين",`grp_sync_admins:${gid}`)],
    [Markup.button.callback("🚫 طرد عضو",`grp_kick:${gid}`),
     Markup.button.callback("🔇 كتم عضو",`grp_mute_member:${gid}`)],
    [Markup.button.callback("🔊 رفع كتم",`grp_unmute_member:${gid}`),
     Markup.button.callback("📊 إحصائيات",`grp_stats:${gid}`)],
    [Markup.button.callback("👁 كلمات مراقبة",`grp_watchwords:${gid}`),
     Markup.button.callback("🚨 كلمات إساءة",`grp_badwords:${gid}`)],
    [Markup.button.callback("📋 تقرير الأعضاء",`grp_member_report:${gid}`),
     Markup.button.callback("🔗 رابط الدعوة",`group_link:${gid}`)],
  ];
  if(isOwner){
    rows.push([Markup.button.callback("⭐ ترقية مشرف",`grp_promote:${gid}`),
               Markup.button.callback("⬇️ إزالة مشرف",`grp_demote:${gid}`)]);
    rows.push([Markup.button.callback("🛡 حماية البوتات",`grp_antibot:${gid}`),
               Markup.button.callback("⚙️ إعدادات الحماية",`grp_protection:${gid}`)]);
    // لوحة المالك الحصرية
    rows.push([Markup.button.callback("👑 ═══ لوحة المالك ═══","noop_owner")]);
    rows.push([Markup.button.callback("✏️ تغيير اسم القروب",`grp_change_title:${gid}`),
               Markup.button.callback("📝 تغيير الوصف",`grp_change_desc:${gid}`)]);
    rows.push([Markup.button.callback("🖼 تغيير صورة القروب",`grp_change_photo:${gid}`),
               Markup.button.callback("📌 تثبيت رسالة",`grp_pin_msg:${gid}`)]);
    rows.push([Markup.button.callback("🔇 كتم جماعي مجدول",`grp_mass_mute:${gid}`),
               Markup.button.callback("🔊 فك كتم جماعي",`grp_mass_unmute:${gid}`)]);
    rows.push([Markup.button.callback("📤 تصدير قائمة الأعضاء",`grp_export_members:${gid}`),
               Markup.button.callback("📢 رسالة للقروب",`msg_group:${gid}`)]);
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

// ─── تتبع القروبات وأعضائها ───
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
      // محاولة جلب بيانات المجموعة
      try {
        const fullChat = await bot.telegram.getChat(gid);
        if(fullChat.type==="supergroup") {
          DB.groups[gid].username = fullChat.username||null;
        }
        DB.groups[gid].title = fullChat.title||DB.groups[gid].title;
      }catch{}
      // مزامنة قائمة المشرفين فور انضمام البوت
      await syncGroupAdmins(gid);
      log("group_join",DEV_ID,chat.title);
      saveDB();
    }
  }catch(e){}
});

// تتبع الأعضاء الجدد في القروبات
bot.on("chat_member", async ctx=>{
  try {
    const chat=ctx.chat;
    const member=ctx.chatMember;
    const gid=String(chat.id);
    if(!DB.groups[gid]) DB.groups[gid]={title:chat.title||"قروب",id:gid,type:chat.type,joinedAt:stamp(),members:0,ownerId:null};
    if(!DB.groupMembers[gid]) DB.groupMembers[gid]={};

    const user=member.new_chat_member?.user||member.from;
    if(!user) return;
    const uid=user.id;
    const status=member.new_chat_member?.status;
    const oldStatus=member.old_chat_member?.status;
    const inviter=member.from;

    // ─── عضو جديد انضم ───
    if(["member","restricted"].includes(status)&&["left","kicked",""].includes(oldStatus||"")){
      DB.groupMembers[gid][uid]={
        name:user.first_name||"مجهول",
        username:user.username||"",
        id:uid,
        joinedAt:stamp(),
        addedBy:inviter?.id||null,
        addedByName:inviter?.first_name||"—",
        status:"member",
        isAdmin:false,
        isOwner:false,
        adminPerms:null,
        isBot:user.is_bot||false,
      };

      // حماية: اكتشاف إضافة بوتات
      if(user.is_bot && DB.groupSettings[gid]?.antiBot){
        try{
          await bot.telegram.banChatMember(gid,uid);
          await bot.telegram.sendMessage(gid,`🛡 تم إزالة البوت @${user.username||uid} تلقائياً`);
        }catch{}
      }

      // فحص نظام الحماية التلقائية من إضافة كثيرة
      if(inviter && inviter.id !== uid && DB.groupSettings[gid]?.antiSpamAdd){
        const addKey=`addcount_${gid}_${inviter.id}_${Math.floor(Date.now()/60000)}`;
        DB.daily[addKey]=(DB.daily[addKey]||0)+1;
        if(DB.daily[addKey]>5){
          try{
            await bot.telegram.promoteChatMember(gid,inviter.id,{
              can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,
              can_promote_members:false,can_change_info:false,can_invite_users:false,can_pin_messages:false,
            });
            await bot.telegram.sendMessage(gid,`⚠️ تم إزالة صلاحيات @${inviter.username||inviter.id} بسبب الإضافة المتكررة`);
          }catch{}
        }
      }
      saveDB();
    }

    // ─── تحديث حالة المشرف — مزامنة مباشرة من Telegram ───
    if(status==="administrator"||status==="creator"){
      await syncMemberRole(gid, uid);
      if(status==="creator"&&DB.groups[gid]) DB.groups[gid].ownerId=uid;

      // سجل تصرفات المشرفين
      if(!DB.adminActionLog[gid]) DB.adminActionLog[gid]=[];
    }

    // ─── مراقبة إزالة المشرفين ───
    if(oldStatus==="administrator"&&status==="member"){
      if(DB.groupMembers[gid][uid]){
        DB.groupMembers[gid][uid].status="member";
        DB.groupMembers[gid][uid].isAdmin=false;
        DB.groupMembers[gid][uid].adminPerms=null;
      }
      if(DB.groupSettings[gid]?.monitorDemote){
        const demoteKey=`demotecount_${gid}_${inviter?.id}_${today()}`;
        DB.daily[demoteKey]=(DB.daily[demoteKey]||0)+1;
        const limit=DB.groupSettings[gid]?.demoteLimit||3;
        if(DB.daily[demoteKey]>=limit){
          try{
            await bot.telegram.promoteChatMember(gid,inviter.id,{
              can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,
            });
            await bot.telegram.sendMessage(gid,`⚠️ تم إزالة صلاحيات @${inviter?.username||inviter?.id} بسبب تكرار إزالة المشرفين`);
          }catch{}
        }
      }
    }

    if(status==="left"||status==="kicked"){
      if(DB.groupMembers[gid][uid]) DB.groupMembers[gid][uid].status=status;
    }

    saveDB();
  }catch(e){ console.error("chat_member:",e.message); }
});

// مراقبة رسائل القروبات للكلمات المحظورة والمراقبة
bot.on("message", async(ctx,next)=>{
  try {
    const chat=ctx.chat;
    if(chat&&(chat.type==="group"||chat.type==="supergroup")){
      const gid=String(chat.id);
      const uid=ctx.from?.id;
      const text=ctx.message?.text||ctx.message?.caption||"";

      if(!text||!uid) return next();

      // لا تطبّق قواعد الكلمات على المشرفين والمالك
      const memberData=DB.groupMembers[gid]?.[uid];
      const isGroupAdmin=memberData?.isAdmin||memberData?.isOwner||memberData?.status==="creator"||memberData?.status==="administrator";
      if(!isGroupAdmin){
        // كلمات الإساءة — يُكتم العضو مؤقتاً
        const badwords=DB.groupBadwords[gid]||[];
        const ltext=text.toLowerCase();
        if(badwords.some(w=>ltext.includes(w.toLowerCase()))){
          try{
            await ctx.deleteMessage();
            await bot.telegram.restrictChatMember(gid,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+300});
            await ctx.reply(`⚠️ @${ctx.from.username||ctx.from.first_name} رسالتك تحتوي على كلمات محظورة. تم كتمك 5 دقائق.`);
          }catch{}
        }
      }

      // كلمات المراقبة — ترسل للمطور/المالك سراً (حتى لو مشرف)
      const watchwords=DB.groupWatchwords[gid]||[];
      const ltext2=text.toLowerCase();
      if(watchwords.some(w=>ltext2.includes(w.toLowerCase()))){
        const g=DB.groups[gid]||{};
        const ownerId=g.ownerId||DEV_ID;
        const senderRole=isGroupAdmin?"⭐ مشرف":"👤 عضو";
        try{
          await bot.telegram.sendMessage(ownerId,
            `👁 *كلمة مراقبة رُصدت*\n\n🏘 القروب: *${g.title||gid}*\n${senderRole}: ${ctx.from.first_name} [${uid}]\n@${ctx.from.username||"—"}\n📝 الرسالة:\n${text.slice(0,300)}`,
            {parse_mode:"Markdown"});
        }catch{}
      }
    }
  }catch(e){}
  return next();
});

// Middleware عام
bot.use(async(ctx,next)=>{
  if(!ctx.from) return next();
  ensureUser(ctx);
  const uid=ctx.from.id;
  if(ctx.chat&&(ctx.chat.type==="group"||ctx.chat.type==="supergroup")){
    const gid=String(ctx.chat.id);
    if(!DB.groups[gid]){
      DB.groups[gid]={title:ctx.chat.title||"قروب",id:gid,type:ctx.chat.type,joinedAt:stamp(),members:0,ownerId:null};
    }
  }
  if(isBanned(uid)&&!isDev(uid)){ try{ await ctx.reply("🚫 أنت محظور."); }catch{} return; }
  if(DB.settings.maintenanceMode&&!isAdmin(uid)){ try{ await ctx.reply("🔧 البوت في وضع الصيانة."); }catch{} return; }
  return next();
});

// ===================== /start =====================
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
      log("referral",rid,`أحال ${uid}`);
      try{ await bot.telegram.sendMessage(rid,`🎉 انضم صديق! +${DB.settings.refBonus} إيميلات إضافية`); }catch{}
    }
  }

  log("start",uid,DB.users[uid]?.name);

  if(isDev(uid)){
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n\n🤖 *${DB.settings.botName}*\n`+
      `👥 الأعضاء: *${Object.keys(DB.users).length}*\n`+
      `🏘 القروبات: *${Object.keys(DB.groups).length}*\n⭐ المسؤولون: *${DB.admins.size-1}*`,
      {parse_mode:"Markdown",...devKb()}
    );
  }

  // ── التحقق يتم مرة واحدة فقط ──
  const user=DB.users[uid];
  if(user?.verified){
    return showMain(ctx);
  }

  // المستخدم لم يتحقق بعد
  const n1=Math.floor(Math.random()*9)+1, n2=Math.floor(Math.random()*9)+1;
  if(!DB.sessions[uid]) DB.sessions[uid]={};
  DB.sessions[uid].captchaAns=n1+n2;
  DB.state[uid]={mode:"captcha"};
  return ctx.reply(
    `👋 *${DB.settings.welcomeMsg}*\n\n🤖 للتحقق أنك لست روبوت (مرة واحدة فقط):\n\n🔢 *${n1} + ${n2} = ?*`,
    {parse_mode:"Markdown"}
  );
});

async function showMain(ctx){
  const uid=ctx.from.id;
  const ann=DB.announcements[0];
  let txt=`🏠 *القائمة الرئيسية*\nأهلاً *${ctx.from.first_name}* 👋`;
  if(ann) txt+=`\n\n📣 ${ann}`;
  if(DB.settings.screenshotProtection) txt+=`\n\n🛡 _الحماية مفعّلة_`;
  const opts={parse_mode:"Markdown",...mainKb()};
  if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
  await ctx.reply(txt,opts);
}

// بعد التحقق: اختيار إنشاء حساب أو تسجيل دخول
async function showRegisterOrLogin(ctx){
  return ctx.reply(
    `✅ *تم التحقق بنجاح!*\n\n🎉 أهلاً بك!\nاختر العملية التالية:`,
    {parse_mode:"Markdown",...Markup.inlineKeyboard([
      [Markup.button.callback("✨ إنشاء حساب جديد","register_new")],
      [Markup.button.callback("🔑 تسجيل دخول (استعادة حساب)","login_existing")],
    ])}
  );
}

bot.command("dev",   async ctx=>{ if(!isDev(ctx.from.id))return; ctx.reply("👑 *لوحة المطور:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("panel", async ctx=>{ if(!isAdmin(ctx.from.id))return; ctx.reply("🛡 *لوحة المسؤول:*",{parse_mode:"Markdown",...devKb()}); });
bot.command("stats", async ctx=>{ if(!isAdmin(ctx.from.id))return; showDevStats(ctx); });
bot.command("ai",    async ctx=>{
  const uid=ctx.from.id;
  const user=DB.users[uid];
  if(!user?.verified&&!isDev(uid)) return ctx.reply("❌ يجب التسجيل أولاً.");
  DB.state[uid]={mode:"ai_chat"};
  return ctx.reply(
    `🤖 *مرحباً بك في الذكاء الاصطناعي!*\n\n💬 أرسل سؤالك الآن\n_اكتب /stop للخروج_`,
    {parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("❌ خروج","menu_ai_stop")]])}
  );
});
bot.command("stop",  async ctx=>{ delete DB.state[ctx.from.id]; return ctx.reply("✅ تم الخروج.",mainKb()); });

async function showDevStats(ctx) {
  const total=Object.keys(DB.users).length;
  const banned=Object.values(DB.users).filter(u=>u.banned).length;
  const muted=Object.values(DB.users).filter(u=>u.muted).length;
  const verified=Object.values(DB.users).filter(u=>u.verified).length;
  const emails=Object.values(DB.emailHistory).reduce((a,h)=>a+h.length,0);
  const active=Object.keys(DB.activeEmails).length;
  const groups=Object.keys(DB.groups).length;
  const today_e=Object.keys(DB.daily).filter(k=>k.includes(today())).reduce((a,k)=>a+DB.daily[k],0);
  const txt=
    `📊 *إحصائيات شاملة*\n\n`+
    `👥 إجمالي الأعضاء: *${total}*\n✅ متحققون: *${verified}*\n`+
    `🚫 المحظورون: *${banned}* | 🔇 المكتومون: *${muted}*\n`+
    `⭐ المسؤولون: *${DB.admins.size}* | 🏘 القروبات: *${groups}*\n\n`+
    `📧 إيميلات كلي: *${emails}* | نشطون الآن: *${active}*\n`+
    `📅 إيميلات اليوم: *${today_e}* | السجلات: *${DB.logs.length}*\n\n`+
    `⚙️ *الإعدادات:*\n• الحد اليومي: ${DB.settings.maxEmailsPerDay}\n`+
    `• المراقبة: ${DB.settings.emailWatchMin}د | الصيانة: ${DB.settings.maintenanceMode?"✅":"❌"}\n`+
    `• 🛡 حماية لقطات: ${DB.settings.screenshotProtection?"✅":"❌"}\n`+
    `• 🤖 AI: نشط ✅`;
  if(ctx.callbackQuery){
    await ctx.editMessageText(txt,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  } else {
    await ctx.reply(txt,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة","dev_panel")]])});
  }
}

// ===================== الأزرار =====================
bot.on("callback_query", async ctx=>{
  await ctx.answerCbQuery().catch(()=>{});
  const data=ctx.callbackQuery.data;
  const uid=ctx.from.id;
  const edit=(t,ex={})=>ctx.editMessageText(t,{parse_mode:"Markdown",...ex}).catch(()=>ctx.reply(t,{parse_mode:"Markdown",...ex}));

  if(data==="noop") return;
  if(data==="back"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }
  if(data==="dev_panel"){ if(!isAdmin(uid))return; return edit("👑 *لوحة التحكم:*",devKb()); }

  // ─── إنشاء حساب جديد ───
  if(data==="register_new"){
    const accEmail=genAccountEmail();
    const accPass=genStrongPass();
    DB.users[uid].accountEmail=accEmail;
    DB.users[uid].accountPassword=accPass;
    DB.users[uid].passwordHash=hashPass(accPass);
    DB.users[uid].verified=true;
    saveDB();
    log("register",uid,accEmail);
    await ctx.reply(
      `✅ *تم إنشاء حسابك بنجاح!*\n\n`+
      `📧 *الإيميل:* \`${accEmail}\`\n`+
      `🔑 *كلمة السر:* \`${accPass}\`\n\n`+
      `⚠️ *احفظهم جيداً! ستحتاجهم لاستعادة حسابك لاحقاً*`,
      {parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("✅ فهمت، الرئيسية","goto_main")]])}
    );
    return;
  }

  if(data==="goto_main"){ return showMain(ctx); }

  // ─── تسجيل دخول (استعادة حساب) ───
  if(data==="login_existing"){
    DB.state[uid]={mode:"login_email"};
    return edit("📧 أدخل الإيميل المرتبط بحسابك:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء","back")]]));
  }

  // ─── AI ───
  if(data==="menu_ai"){
    const user=DB.users[uid];
    if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    DB.state[uid]={mode:"ai_chat"};
    const convLen=(DB.aiConversations[uid]||[]).length;
    return edit(
      `🤖 *الذكاء الاصطناعي*\n\n💬 محادثة مستمرة واحدة\n📝 الرسائل: *${Math.floor(convLen/2)}*\n\n_أرسل سؤالك الآن_`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🗑 مسح المحادثة","ai_clear_conv")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  if(data==="menu_ai_stop"){ delete DB.state[uid]; return edit("🏠 *القائمة الرئيسية:*",mainKb()); }

  if(data==="ai_clear_conv"){
    DB.aiConversations[uid]=[];
    saveDB();
    return edit("✅ *تم مسح المحادثة.*\n\nيمكنك البدء من جديد.",
      Markup.inlineKeyboard([
        [Markup.button.callback("💬 محادثة جديدة","menu_ai")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ])
    );
  }

  // ─── إيميلات ───
  if(data==="menu_emails"){
    const user=DB.users[uid];
    if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    const active=DB.activeEmails[uid];
    const saved=(DB.savedEmails[uid]||[]).length;
    const used=dailyCount(uid),max=maxDay(uid);
    const rows=[];
    if(active){ rows.push([Markup.button.callback(`📬 إيميلك النشط: ${active.email.slice(0,30)}`,`inbox:${active.inboxId}`)]); }
    rows.push([Markup.button.callback("⚡ إيميل مؤقت جديد","new_temp_email")]);
    if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`,"my_emails")]);
    rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]);
    rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
    return edit(
      `📧 *نظام الإيميلات*\n\n✅ اليوم: *${used}/${max}*\n🔔 الكود يوصلك تلقائياً ⚡\n⏱ مراقبة: *${DB.settings.emailWatchMin} دقيقة*`,
      Markup.inlineKeyboard(rows)
    );
  }

  if(data==="new_temp_email"){
    const user=DB.users[uid];
    if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
    const diff=now()-(DB.lastReq[`e_${uid}`]||0);
    if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلته.`,backKb());
    await edit("⚡ *جاري إنشاء الإيميل...*");
    const result=await msCreateInbox(DB.settings.emailWatchMin);
    if(!result||!result.email){
      return edit("❌ *فشل إنشاء الإيميل!*\nحاول لاحقاً.",
        Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_temp_email")],[Markup.button.callback("🔙","menu_emails")]]));
    }
    if(DB.activeEmails[uid]?.inboxId) msDeleteInbox(DB.activeEmails[uid].inboxId).catch(()=>{});
    const emailData={email:result.email,inboxId:result.inboxId,createdAt:now()};
    DB.activeEmails[uid]=emailData;
    DB.lastReq[`e_${uid}`]=now();
    incDaily(uid);
    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[];
    DB.emailHistory[uid].unshift({email:result.email,type:"mailslurp",time:stamp(),msgCount:0});
    DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
    log("email_created",uid,result.email);
    saveDB();
    const opts={parse_mode:"Markdown",...emailActiveKb(result.email,result.inboxId)};
    if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
    await edit(
      `✅ *تم إنشاء إيميلك!*\n\n📧 *العنوان:*\n\`${result.email}\`\n\n`+
      `⚡ *البوت يراقب ويوصلك الكود فور وصوله*\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,opts);
    emailWatcher(bot,uid,emailData,ctx.chat.id);
    return;
  }

  if(data.startsWith("inbox:")){
    const inboxId=data.slice(6);
    await edit("📨 *جاري فتح الصندوق...*");
    const emails=await msGetEmails(inboxId);
    if(!emails.length){
      const active=DB.activeEmails[uid];
      return edit(`📭 *الصندوق فارغ حالياً*\n\n\`${active?.email||"الإيميل"}\`\n\n⚡ البوت يراقب تلقائياً`,
        emailActiveKb(active?.email||"",inboxId));
    }
    const rows=emails.slice(0,10).map(m=>[Markup.button.callback(`📩 ${(m.subject||"بدون موضوع").slice(0,28)}`,`msg:${m.id}:${inboxId}`)]);
    rows.push([Markup.button.callback("🔄 تحديث",`inbox:${inboxId}`)]);
    rows.push([Markup.button.callback("🔙","menu_emails")]);
    return edit(`📬 *الصندوق — ${emails.length} رسالة:*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("msg:")){
    const parts=data.split(":");
    const emailId=parts[1],inboxId=parts[2];
    await edit("📖 *جاري قراءة الرسالة...*");
    const fullEmail=await msGetEmail(emailId);
    if(!fullEmail) return edit("❌ تعذر قراءة الرسالة.",backKb());
    const body=(fullEmail.body||fullEmail.bodyPlainText||"")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,1500);
    const otps=extractOTP(fullEmail.body||"");
    const otpTxt=otps.length?`\n\n🔑 *الكود:*\n${otps.map(c=>`\`${c}\``).join("  ")}`:"";
    return edit(
      `📩 *الرسالة*\n\n📬 *من:* \`${fullEmail.from||"—"}\`\n📋 *الموضوع:* ${fullEmail.subject||"بدون موضوع"}`+otpTxt+
      `\n\n📝 *المحتوى:*\n\`\`\`\n${body||"(فارغ)"}\n\`\`\``,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 الصندوق",`inbox:${inboxId}`)]])
    );
  }

  if(data.startsWith("save_email:")){
    const parts=data.split(":");const inboxId=parts[1];const email=parts.slice(2).join(":");
    if(!DB.savedEmails[uid]) DB.savedEmails[uid]=[];
    if(DB.savedEmails[uid].find(e=>e.email===email)) return edit("✅ محفوظ مسبقاً.",emailActiveKb(email,inboxId));
    DB.state[uid]={mode:"save_email_label",email,inboxId};
    return edit("✏️ أرسل تسمية لهذا الإيميل:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_emails")]]));
  }

  if(data==="my_emails"){
    const saved=DB.savedEmails[uid]||[];
    if(!saved.length) return edit("📂 *لا توجد إيميلات محفوظة.*",backKb());
    const rows=saved.map((e,i)=>[Markup.button.callback(`📧 ${e.label} — ${e.email.slice(0,20)}`,`open_saved:${i}`)]);
    rows.push([Markup.button.callback("🔙","menu_emails")]);
    return edit(`📂 *محفوظاتي (${saved.length}):*`,Markup.inlineKeyboard(rows));
  }

  if(data.startsWith("open_saved:")){
    const idx=parseInt(data.split(":")[1]);const e=DB.savedEmails[uid]?.[idx];
    if(!e) return edit("❌",backKb());
    return edit(`📧 *${e.label}*\n\n\`${e.email}\`\n🕐 ${e.savedAt}`,
      Markup.inlineKeyboard([[Markup.button.callback("🗑 حذف",`del_saved:${idx}`),Markup.button.callback("🔙","my_emails")]]));
  }

  if(data.startsWith("del_saved:")){
    if(DB.savedEmails[uid]) DB.savedEmails[uid].splice(parseInt(data.split(":")[1]),1);
    saveDB(); return edit("🗑 تم الحذف.",backKb());
  }

  if(data.startsWith("del_email:")){
    const inboxId=data.slice(10);
    if(DB.activeEmails[uid]?.inboxId===inboxId){
      msDeleteInbox(inboxId).catch(()=>{});
      delete DB.activeEmails[uid];
      saveDB();
    }
    return edit("🗑 *تم إنهاء الإيميل.*",backKb());
  }

  if(data==="email_history"){
    const h=DB.emailHistory[uid]||[];
    if(!h.length) return edit("📊 *لا يوجد سجل.*",backKb());
    let txt=`📊 *سجل الإيميلات (${h.length}):*\n\n`;
    h.slice(0,10).forEach((e,i)=>{ txt+=`${i+1}. 📧 \`${e.email}\`\n   📩 ${e.msgCount||0} رسالة | 🕐 ${e.time}\n\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_emails")]]));
  }

  // ─── كلمات السر ───
  if(data==="menu_passwords"){
    const saved=DB.savedPasswords[uid]||[];
    return edit(`🔑 *مدير كلمات السر*\n\n💾 محفوظة: *${saved.length}*`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔐 توليد كلمة سر قوية","gen_pass")],
        [Markup.button.callback("💾 كلمات السر المحفوظة","my_passwords")],
        [Markup.button.callback("➕ حفظ كلمة سر يدوياً","save_pass_prompt")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ]));
  }

  if(data==="gen_pass"){
    const p=genStrongPass();
    return edit(`🔐 *كلمة السر:*\n\n\`${p}\`\n\n📊 الطول: ${p.length}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💾 حفظها",`store_pass:${p}`)],
        [Markup.button.callback("🔄 أخرى","gen_pass")],
        [Markup.button.callback("🔙","menu_passwords")],
      ]));
  }

  if(data.startsWith("store_pass:")){
    DB.state[uid]={mode:"store_pass_platform",pass:data.slice(11)};
    return edit("✏️ اكتب اسم المنصة:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]]));
  }
  if(data==="save_pass_prompt"){ DB.state[uid]={mode:"save_pass_custom"}; return edit("🔐 أرسل كلمة السر:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_passwords")]])); }

  if(data==="my_passwords"){
    const saved=DB.savedPasswords[uid]||[];
    if(!saved.length) return edit("💾 *لا توجد كلمات سر.*",backKb());
    let txt=`🔑 *كلمات السر (${saved.length}):*\n\n`;
    saved.forEach((p,i)=>{ txt+=`${i+1}. 🏷 *${p.platform}*\n   \`${p.password}\`\n\n`; });
    return edit(txt,Markup.inlineKeyboard([[Markup.button.callback("🗑 حذف الكل","del_all_pass")],[Markup.button.callback("🔙","menu_passwords")]]));
  }
  if(data==="del_all_pass"){ DB.savedPasswords[uid]=[]; saveDB(); return edit("🗑 تم الحذف.",backKb()); }

  // ─── VirusTotal ───
  if(data==="menu_vt"){
    return edit(`🔍 *فحص الأمان — VirusTotal*\n\n🛡 70+ محرك أمان`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔗 فحص رابط","vt_url"),Markup.button.callback("🌐 فحص دومين","vt_domain")],
        [Markup.button.callback("🖥 فحص IP","vt_ip"),Markup.button.callback("📁 فحص ملف","vt_file_info")],
        [Markup.button.callback("🔙 الرئيسية","back")],
      ]));
  }
  if(data==="vt_url"){ DB.state[uid]={mode:"vt_url"}; return edit("🔗 أرسل الرابط:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_domain"){ DB.state[uid]={mode:"vt_domain"}; return edit("🌐 أرسل الدومين:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_ip"){ DB.state[uid]={mode:"vt_ip"}; return edit("🖥 أرسل IP:",Markup.inlineKeyboard([[Markup.button.callback("❌","menu_vt")]])); }
  if(data==="vt_file_info"){ return edit("📁 أرسل الملف مباشرة ↓",Markup.inlineKeyboard([[Markup.button.callback("🔙","menu_vt")]])); }

  // ─── UptimeRobot ───
  if(data==="menu_uptime"){
    await edit("⏳ *جاري جلب المواقع...*");
    const monitors=await getMonitors();
    if(!monitors.length) return edit("🌐 *لا توجد مواقع.*",backKb());
    let txt=`🌐 *مواقعك (${monitors.length}):*\n\n`;
    monitors.slice(0,10).forEach(m=>{
      const ic=m.status===2?"🟢":m.status===9?"🔴":"🟡";
      txt+=`${ic} *${m.friendly_name||m.url}*\n   📈 ${m.all_time_uptime_ratio||"—"}%\n\n`;
    });
    return edit(txt,backKb());
  }

  // ─── الإحالة ───
  if(data==="referral"){
    const me=await bot.telegram.getMe();
    const link=`https://t.me/${me.username}?start=ref_${uid}`;
    const refs=(DB.referrals[uid]||[]).length;
    const bonus=DB.referralPerks[uid]?.extra||0;
    return edit(
      `🎁 *نظام الإحالة*\n\n🔗 *رابطك:*\n\`${link}\`\n\n👥 إحالاتك: *${refs}* | 🎁 مكافأتك: *+${bonus}*`,
      Markup.inlineKeyboard([[Markup.button.callback("👥 إحالاتي","my_referrals")],[Markup.button.callback("🔙","back")]]));
  }
  if(data==="my_referrals"){
    const refs=DB.referrals[uid]||[];
    if(!refs.length) return edit("👥 *لم تُحِل أحداً بعد.*",backKb());
    let txt=`👥 *إحالاتي (${refs.length}):*\n\n`;
    refs.slice(0,10).forEach((id,i)=>{ txt+=`${i+1}. ${DB.users[id]?.name||id}\n`; });
    return edit(txt,backKb());
  }

  // ─── إحصائياتي ───
  if(data==="my_stats"){
    const u=DB.users[uid]||{};
    return edit(
      `📊 *إحصائياتي*\n\n👤 *${u.name}*\n🆔 \`${uid}\`\n📅 انضممت: ${u.joinedAt}\n`+
      `📧 إيميلات اليوم: *${dailyCount(uid)}/${maxDay(uid)}*\n`+
      `📚 إجمالي: *${(DB.emailHistory[uid]||[]).length}*\n`+
      `💾 محفوظات: *${(DB.savedEmails[uid]||[]).length}*\n`+
      `🔑 كلمات سر: *${(DB.savedPasswords[uid]||[]).length}*\n`+
      `👥 إحالات: *${(DB.referrals[uid]||[]).length}*\n`+
      `🏅 الدور: *${u.role||"user"}*`,backKb());
  }

  // ─── سجلي ───
  if(data==="my_history"){
    const h=DB.emailHistory[uid]||[];const a=DB.activityLog[uid]||[];
    let txt="📋 *سجلي*\n\n";
    if(h.length){ txt+="*📧 آخر الإيميلات:*\n"; h.slice(0,5).forEach((e,i)=>{ txt+=`${i+1}. 📧 \`${e.email}\` — ${e.time}\n`; }); txt+="\n"; }
    if(a.length){ txt+="*🕐 آخر النشاطات:*\n"; a.slice(0,5).forEach((ac,i)=>{ txt+=`${i+1}. ${ac.action} — ${ac.time}\n`; }); }
    if(!h.length&&!a.length) txt+="لم تستخدم أي خدمة بعد.";
    return edit(txt,backKb());
  }

  // ─── حسابي ───
  if(data==="my_account"){
    const u=DB.users[uid]||{};
    return edit(
      `👤 *حسابي*\n\n🆔 \`${uid}\`\n📧 ${u.accountEmail?`\`${u.accountEmail}\``:"غير محدد"}\n`+
      `🔐 ${u.passwordHash?"✅ مُعيّنة":"❌"}\n🏅 ${u.role||"user"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📋 إظهار بيانات حسابي","show_account_data")],
        [Markup.button.callback("📧 تغيير الإيميل","acc_email"),Markup.button.callback("🔐 تغيير السر","acc_pass")],
        [Markup.button.callback("🔙","back")],
      ]));
  }

  if(data==="show_account_data"){
    const u=DB.users[uid]||{};
    return edit(
      `🔐 *بيانات حسابك*\n\n📧 *الإيميل:* \`${u.accountEmail||"غير محدد"}\`\n🔑 *كلمة السر:* \`${u.accountPassword||"غير محددة"}\`\n\n⚠️ _احتفظ بهذه البيانات_`,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 حسابي","my_account")]]));
  }

  if(data==="acc_email"){ DB.state[uid]={mode:"acc_email"}; return edit("📧 أرسل بريدك الجديد:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }
  if(data==="acc_pass") { DB.state[uid]={mode:"acc_pass"};  return edit("🔐 أرسل كلمة السر الجديدة:",Markup.inlineKeyboard([[Markup.button.callback("❌","my_account")]])); }

  // ─── مساعدة ───
  if(data==="help"){
    return edit(
      `ℹ️ *دليل البوت v5*\n\n`+
      `*🤖 AI:* ذكاء اصطناعي متقدم غير محدود\n`+
      `*📧 الإيميلات:* إيميل حقيقي مع استقبال تلقائي للأكواد\n`+
      `*🔑 كلمات السر:* توليد وحفظ آمن\n`+
      `*🔍 فحص الأمان:* 70+ محرك\n`+
      `*🏘 القروبات:* نظام إدارة متكامل\n`+
      `*🎁 الإحالة:* إيميلات إضافية\n\n`+
      `✅ التحقق يتم مرة واحدة فقط`,backKb());
  }

  // ══════════ لوحة التحكم ══════════
  if(data==="dev_settings"){ if(!isAdmin(uid))return; return edit("⚙️ *إعدادات البوت:*",devSettingsKb()); }

  if(data==="ds_maint"){
    if(!isDev(uid))return;
    DB.settings.maintenanceMode=!DB.settings.maintenanceMode;
    saveDB();
    const maintTxt = DB.settings.maintenanceMode ? "✅" : "❌";
    return edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                