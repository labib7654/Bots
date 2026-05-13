diff --git a/bot.js b/bot.js
index 673985856957c3fcea2f5b0762b8bb7f6ed8428e..7f42bbe7d2b9c5753afd913d57bb339691c451c3 100644
--- a/bot.js
+++ b/bot.js
@@ -1,48 +1,48 @@
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
-const BOT_TOKEN   = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
-const MS_API_KEY  = "sk_jmXm1Im3hxzT7Lnf_6T6dD3ab7Xzf4ACe0or8TEqBNX9L6hwW9rw1ddfKtiGjs3bCyJTOKuQNKZ1mMSkV";
+const BOT_TOKEN   = process.env.BOT_TOKEN || "";
+const MS_API_KEY  = process.env.MS_API_KEY || "";
 const MS_BASE     = "https://api.mailslurp.com";
-const VT_KEY      = "4158807647a3b9b2e4ed33bb0094db123bbc9197456d20ebd57c78676e786588";
-const UR_KEY      = "u3469811-ab163c31f24d6012491f0807";
-const AI_KEY      = "sk-f7307872f8004ecd92c0764b0f03f7f5";
+const VT_KEY      = process.env.VT_KEY || "";
+const UR_KEY      = process.env.UR_KEY || "";
+const AI_KEY      = process.env.AI_KEY || "";
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
@@ -99,94 +99,111 @@ const defaultDB = {
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
-if (!DB.settings.aiEnabled)           DB.settings.aiEnabled = true;
-if (!DB.settings.maxAiMsgsPerDay)     DB.settings.maxAiMsgsPerDay = 100;
+if (!DB.settings || typeof DB.settings !== "object") DB.settings = {};
+if (DB.settings.aiEnabled === undefined) DB.settings.aiEnabled = true;
+if (DB.settings.maxAiMsgsPerDay === undefined) DB.settings.maxAiMsgsPerDay = 100;
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
+const activeWatchers = new Map();
+const emailCreateLocks = new Set();
 
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
 
+async function refreshGroupOwner(gid) {
+  try {
+    const admins = await bot.telegram.getChatAdministrators(gid);
+    const creator = admins.find((m) => m.status === "creator");
+    if (creator) {
+      if (!DB.groups[String(gid)]) DB.groups[String(gid)] = { id: String(gid) };
+      DB.groups[String(gid)].ownerId = creator.user.id;
+      saveDB();
+      return creator.user;
+    }
+  } catch {}
+  return null;
+}
+
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
 
@@ -254,93 +271,106 @@ async function msGetEmail(emailId) {
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
 
-async function emailWatcher(bot,uid,emailData,chatId) {
+function stopEmailWatcher(uid){
+  const watcher=activeWatchers.get(String(uid));
+  if(!watcher) return;
+  clearInterval(watcher.timer);
+  activeWatchers.delete(String(uid));
+}
+
+function startEmailWatcher(bot,uid,emailData,chatId) {
+  const uidKey=String(uid);
+  stopEmailWatcher(uidKey);
   const {email,inboxId,createdAt}=emailData;
-  const endTime=now()+DB.settings.emailWatchMin*60;
-  const seenIds=new Set();
-  let sinceTime=new Date(createdAt*1000).toISOString();
-  while(now()<endTime){
-    if(!DB.activeEmails[uid]||DB.activeEmails[uid].inboxId!==inboxId) return;
-    await sleep(5000);
-    let emails=[];
-    try{ emails=await msGetEmails(inboxId,sinceTime); }catch(e){ continue; }
-    for(const preview of emails){
+  const endAt=Date.now()+DB.settings.emailWatchMin*60*1000;
+  const state={running:false,seenIds:new Set(),sinceTime:new Date(createdAt*1000).toISOString(),timer:null};
+
+  state.timer=setInterval(async()=>{
+    if(state.running) return;
+    state.running=true;
+    try{
+      if(Date.now()>=endAt){
+        if(DB.activeEmails[uid]?.inboxId===inboxId){
+          await msDeleteInbox(inboxId);
+          delete DB.activeEmails[uid];
+          saveDB();
+          await bot.telegram.sendMessage(chatId,`⏰ *انتهت مدة الإيميل*\n\n\`${email}\`\n\nأنشئ جديداً 📧`,{parse_mode:"Markdown",...mainKb()}).catch(()=>{});
+        }
+        return stopEmailWatcher(uidKey);
+      }
+      if(!DB.activeEmails[uid]||DB.activeEmails[uid].inboxId!==inboxId) return stopEmailWatcher(uidKey);
+      const emails=await msGetEmails(inboxId,state.sinceTime);
+      for(const preview of emails){
       const eid=String(preview.id);
-      if(seenIds.has(eid)) continue;
-      seenIds.add(eid);
-      if(preview.createdAt) sinceTime=preview.createdAt;
+      if(state.seenIds.has(eid)) continue;
+      state.seenIds.add(eid);
+      if(preview.createdAt) state.sinceTime=preview.createdAt;
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
-      try{
-        const msgOpts={parse_mode:"Markdown",...emailActiveKb(email,inboxId)};
-        if(DB.settings.screenshotProtection) msgOpts.protect_content=true;
-        await bot.telegram.sendMessage(chatId,
-          `📧 *وصلت رسالة جديدة!*\n\n📬 *من:* \`${from}\`\n📋 *الموضوع:* ${subject}`+otpText+
-          `\n\n📝 *المحتوى:*\n\`\`\`\n${cleanBody||"(فارغ)"}\n\`\`\``,msgOpts);
-      }catch(e){}
+      const msgOpts={parse_mode:"Markdown",...emailActiveKb(email,inboxId)};
+      if(DB.settings.screenshotProtection) msgOpts.protect_content=true;
+      await bot.telegram.sendMessage(chatId,
+        `📧 *وصلت رسالة جديدة!*\n\n📬 *من:* \`${from}\`\n📋 *الموضوع:* ${subject}`+otpText+
+        `\n\n📝 *المحتوى:*\n\`\`\`\n${cleanBody||"(فارغ)"}\n\`\`\``,msgOpts).catch(()=>{});
     }
-  }
-  if(DB.activeEmails[uid]?.inboxId===inboxId){
-    await msDeleteInbox(inboxId);
-    delete DB.activeEmails[uid];
-    saveDB();
-    try{ await bot.telegram.sendMessage(chatId,`⏰ *انتهت مدة الإيميل*\n\n\`${email}\`\n\nأنشئ جديداً 📧`,{parse_mode:"Markdown",...mainKb()}); }catch{}
-  }
+    } finally { state.running=false; }
+  },5000);
+  activeWatchers.set(uidKey,state);
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
@@ -559,51 +589,51 @@ async function syncGroupAdmins(gid) {
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
-  [Markup.button.callback("📧 إيميل مؤقت","menu_emails"), Markup.button.callback("🤖 تحدث مع AI","menu_ai")],
+  [Markup.button.callback("📧 الإيميل (موقوف)","menu_emails"), Markup.button.callback("🤖 AI (موقوف)","menu_ai")],
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
@@ -794,146 +824,140 @@ bot.start(async ctx=>{
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
-bot.command("ai", async ctx=>{
-  const uid=ctx.from.id; const user=DB.users[uid];
-  if(!user?.verified&&!isDev(uid)) return ctx.reply("❌ يجب التسجيل أولاً.");
-  DB.state[uid]={mode:"ai_chat"}; const mode=DB.aiModes[uid]||"general";
-  return ctx.reply(`🤖 *مرحباً بك في الذكاء الاصطناعي!*\n\n🎯 الوضع الحالي: *${AI_MODE_LABELS[mode]}*\n💬 أرسل سؤالك الآن\n_اكتب /stop للخروج_`,{parse_mode:"Markdown",...Markup.inlineKeyboard([[Markup.button.callback("🔄 تغيير الوضع","ai_change_mode")],[Markup.button.callback("❌ خروج","menu_ai_stop")]])});
-});
+bot.command("ai", async ctx=> ctx.reply("⚠️ ميزة الذكاء الاصطناعي موقوفة حالياً من المطور."));
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
+
+bot.command("owner", async ctx=>{
+  if(!ctx.chat || (ctx.chat.type!=="group" && ctx.chat.type!=="supergroup")) return ctx.reply("ℹ️ هذا الأمر يعمل داخل القروبات فقط.");
+  const gid=String(ctx.chat.id); const owner=await refreshGroupOwner(gid);
+  const savedOwner=DB.groups[gid]?.ownerId;
+  if(owner) return ctx.reply(`👑 مالك القروب الحالي: ${owner.first_name}\n🆔 \`${owner.id}\``,{parse_mode:"Markdown"});
+  if(savedOwner) return ctx.reply(`👑 مالك القروب (من قاعدة البيانات): \`${savedOwner}\``,{parse_mode:"Markdown"});
+  return ctx.reply("⚠️ تعذر معرفة المالك الآن. تأكد أن البوت لديه صلاحيات كافية.");
+});
+
+bot.command("verifyowner", async ctx=>{
+  if(!ctx.chat || (ctx.chat.type!=="group" && ctx.chat.type!=="supergroup")) return ctx.reply("ℹ️ هذا الأمر يعمل داخل القروبات فقط.");
+  const uid=ctx.from.id; const gid=String(ctx.chat.id);
+  const owner=await refreshGroupOwner(gid);
+  const ownerId=owner?.id || DB.groups[gid]?.ownerId;
+  if(!ownerId) return ctx.reply("❌ لم أستطع جلب المالك حالياً.");
+  if(String(ownerId)!==String(uid) && !isDev(uid)) return ctx.reply("❌ هذا الأمر للمالك فقط.");
+  if(!DB.groups[gid]) DB.groups[gid]={id:gid,title:ctx.chat.title||"قروب",type:ctx.chat.type,joinedAt:stamp(),members:0,ownerId:null,msgCount:0};
+  DB.groups[gid].ownerId=uid; saveDB();
+  return ctx.reply("✅ تم التحقق منك كمالك القروب وتحديث البيانات.");
+});
+
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
-  if(data==="menu_ai"){
-    const user=DB.users[uid];
-    if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
-    if(!DB.settings.aiEnabled&&!isAdmin(uid)) return edit("❌ الذكاء الاصطناعي معطّل حالياً.",backKb());
-    DB.state[uid]={mode:"ai_chat"}; const convLen=(DB.aiConversations[uid]||[]).length; const mode=DB.aiModes[uid]||"general"; const aiToday=aiDailyCount(uid); const aiMax=DB.settings.maxAiMsgsPerDay;
-    return edit(`🤖 *الذكاء الاصطناعي*\n\n🎯 الوضع: *${AI_MODE_LABELS[mode]}*\n💬 الرسائل في الجلسة: *${Math.floor(convLen/2)}*\n📊 اليوم: *${aiToday}/${isAdmin(uid)?"∞":aiMax}*\n\n_أرسل سؤالك الآن_`, Markup.inlineKeyboard([[Markup.button.callback("🔄 تغيير الوضع","ai_change_mode")],[Markup.button.callback("🗑 مسح المحادثة","ai_clear_conv"),Markup.button.callback("❌ خروج","back")]]));
-  }
+  if(data==="menu_ai") return edit("⚠️ ميزة الذكاء الاصطناعي موقوفة حالياً.",backKb());
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
-  if(data==="menu_emails"){
-    const user=DB.users[uid]; if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
-    const active=DB.activeEmails[uid]; const saved=(DB.savedEmails[uid]||[]).length; const used=dailyCount(uid),max=maxDay(uid);
-    const rows=[]; if(active) rows.push([Markup.button.callback(`📬 إيميلك النشط: ${active.email.slice(0,30)}`,`inbox:${active.inboxId}`)]); rows.push([Markup.button.callback("⚡ إيميل مؤقت جديد","new_temp_email")]); if(saved) rows.push([Markup.button.callback(`📂 محفوظاتي (${saved})`,"my_emails")]); rows.push([Markup.button.callback("📊 سجل إيميلاتي","email_history")]); rows.push([Markup.button.callback("🔙 الرئيسية","back")]);
-    return edit(`📧 *نظام الإيميلات*\n\n✅ اليوم: *${used}/${max}*\n🔔 الكود يوصلك تلقائياً ⚡\n⏱ مراقبة: *${DB.settings.emailWatchMin} دقيقة*`, Markup.inlineKeyboard(rows));
-  }
+  if(data==="menu_emails") return edit("⚠️ ميزة الإيميلات موقوفة حالياً لمنع التعليق.",backKb());
   if(data==="new_temp_email"){
-    const user=DB.users[uid]; if(!user?.verified&&!isDev(uid)) return edit("❌ يجب التسجيل أولاً.",backKb());
-    const diff=now()-(DB.lastReq[`e_${uid}`]||0); if(diff<DB.settings.cooldown&&!isAdmin(uid)) return edit(`⏳ انتظر ${DB.settings.cooldown-diff} ثانية.`,backKb());
-    if(dailyCount(uid)>=maxDay(uid)&&!isAdmin(uid)) return edit(`🚫 الحد اليومي (${maxDay(uid)}) وصلته.`,backKb());
-    await edit("⚡ *جاري إنشاء الإيميل...*"); const result=await msCreateInbox(DB.settings.emailWatchMin);
-    if(!result||!result.email) return edit("❌ *فشل إنشاء الإيميل!*\nحاول لاحقاً.", Markup.inlineKeyboard([[Markup.button.callback("🔄 إعادة","new_temp_email")],[Markup.button.callback("🔙","menu_emails")]]));
-    if(DB.activeEmails[uid]?.inboxId) msDeleteInbox(DB.activeEmails[uid].inboxId).catch(()=>{});
-    const emailData={email:result.email,inboxId:result.inboxId,createdAt:now()}; DB.activeEmails[uid]=emailData; DB.lastReq[`e_${uid}`]=now(); incDaily(uid);
-    if(!DB.emailHistory[uid]) DB.emailHistory[uid]=[]; DB.emailHistory[uid].unshift({email:result.email,type:"mailslurp",time:stamp(),msgCount:0}); DB.emailHistory[uid]=DB.emailHistory[uid].slice(0,20);
-    log("email_created",uid,result.email); saveDB();
-    const opts={parse_mode:"Markdown",...emailActiveKb(result.email,result.inboxId)}; if(DB.settings.screenshotProtection&&!isAdmin(uid)) opts.protect_content=true;
-    await edit(`✅ *تم إنشاء إيميلك!*\n\n📧 *العنوان:*\n\`${result.email}\`\n\n⚡ *البوت يراقب ويوصلك الكود فور وصوله*\n⏱ مدة المراقبة: *${DB.settings.emailWatchMin} دقيقة*`,opts);
-    emailWatcher(bot,uid,emailData,ctx.chat.id);
-    return;
+    return edit("⚠️ تم تعطيل إنشاء الإيميل حالياً بسبب مشاكل الاستقرار.",backKb());
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
@@ -1407,53 +1431,52 @@ bot.on("text", async (ctx, next) => {
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
-    if (!DB.settings.aiEnabled && !isAdmin(uid)) { delete DB.state[uid]; return ctx.reply("❌ الذكاء الاصطناعي معطّل.", mainKb()); }
-    if (aiDailyCount(uid) >= DB.settings.maxAiMsgsPerDay && !isAdmin(uid)) { delete DB.state[uid]; return ctx.reply("🚫 تم استهلاك الحد اليومي للـ AI.", mainKb()); }
-    await ctx.replyWithChatAction("typing"); const reply = await aiChat(uid, text); ctx.reply(reply, { parse_mode: "Markdown" }).catch(() => {}); return;
+    delete DB.state[uid];
+    return ctx.reply("⚠️ ميزة الذكاء الاصطناعي موقوفة حالياً.", mainKb());
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
@@ -1563,32 +1586,46 @@ bot.on("document", async (ctx, next) => {
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
+const missingOptionalKeys=[];
+if(!MS_API_KEY) missingOptionalKeys.push("MS_API_KEY");
+if(!VT_KEY) missingOptionalKeys.push("VT_KEY");
+if(!UR_KEY) missingOptionalKeys.push("UR_KEY");
+if(!AI_KEY) missingOptionalKeys.push("AI_KEY");
+if(missingOptionalKeys.length){
+  console.warn(`⚠️ مفاتيح غير مفعلة: ${missingOptionalKeys.join(", ")} — بعض الميزات لن تعمل.`);
+}
+
+if(!BOT_TOKEN){
+  console.error("❌ BOT_TOKEN is missing. Set BOT_TOKEN environment variable.");
+  process.exit(1);
+}
+
 bot.launch()
   .then(() => console.log(`✅ ${DB.settings.botName} يعمل الآن`))
   .catch(err => console.error("خطأ في launch:", err));
 
 console.log("🚀 البوت جاهز");
 process.once('SIGINT', () => bot.stop('SIGINT'));
-process.once('SIGTERM', () => bot.stop('SIGTERM'));
\ No newline at end of file
+process.once('SIGTERM', () => bot.stop('SIGTERM'));
