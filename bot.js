"use strict";

// ============================================================
//  HERO SMS TELEGRAM BOT — ملف واحد كامل
//  المطور: 7411444902
// ============================================================

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const http = require("http");

// ===================== الإعدادات الأساسية =====================
const BOT_TOKEN   = "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y";
const HERO_API_KEY = "b7c49e0f481e15e7b96eAAb85e60570d";
const HERO_BASE   = "https://hero-sms.com/api/v1";
const DEVELOPER_ID = 7411444902;        // معرف المطور
const NUMBER_TTL  = 1200;               // 20 دقيقة
const PORT        = process.env.PORT || 8080;

// ===================== Keep-Alive =====================
http.createServer((_, res) => {
  res.writeHead(200); res.end("Bot is Running!");
}).listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Keep-alive: port ${PORT}`)
);

// ===================== قاعدة البيانات في الذاكرة =====================
const db = {
  users:          {},   // userId -> { name, username, joinedAt, banned, muted, role }
  activeNumbers:  {},   // userId -> { orderId, number, service, country, startTime, chatId, attempts }
  usedNumbers:    new Set(),  // أرقام تم استخدامها بالفعل
  history:        {},   // userId -> [{ number, service, time, gotSms }]
  stats:          {},   // userId -> { total, success, attempts }
  state:          {},   // userId -> { mode, ... }
  servicesCache:  { data: {}, ts: 0 },
  referrals:      {},   // referrerId -> [userId]
  referralOf:     {},   // userId -> referrerId
  referralPerks:  {},   // userId -> { extra: N }
  logs:           [],   // آخر 500 حدث
  admins:         new Set([DEVELOPER_ID]),  // المسؤولون
  settings: {
    maxPerUser: 10,       // حد الأرقام اليومية
    cooldownSec: 30,      // انتظار بين الطلبات
    autoCancel: true,     // إلغاء تلقائي بعد TTL
    referralBonus: 3,     // أرقام مكافأة لكل إحالة
    allowedCountries: [], // فارغ = كل الدول
  },
  lastRequest:    {},   // userId -> timestamp (cooldown)
  daily:          {},   // "userId_YYYY-MM-DD" -> count
};

// ===================== مساعدات عامة =====================
const now = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const ts = () => new Date().toLocaleString("ar-SA");

function log(type, userId, text) {
  const entry = { type, userId, text, time: ts() };
  db.logs.unshift(entry);
  if (db.logs.length > 500) db.logs.pop();
}

function ensureUser(ctx) {
  const u = ctx.from;
  if (!db.users[u.id]) {
    db.users[u.id] = {
      name: u.first_name || "مجهول",
      username: u.username || "",
      joinedAt: ts(),
      banned: false,
      muted: false,
      role: "user",
    };
  }
  // تحديث الاسم دائماً
  db.users[u.id].name = u.first_name || db.users[u.id].name;
  db.users[u.id].username = u.username || db.users[u.id].username;
}

function isDev(userId)   { return userId === DEVELOPER_ID; }
function isAdmin(userId) { return db.admins.has(userId) || isDev(userId); }
function isBanned(userId) { return db.users[userId]?.banned; }

function dailyKey(userId) { return `${userId}_${today()}`; }
function getDailyCount(userId) { return db.daily[dailyKey(userId)] || 0; }
function incDaily(userId) {
  const k = dailyKey(userId);
  db.daily[k] = (db.daily[k] || 0) + 1;
}
function getMaxPerUser(userId) {
  const bonus = db.referralPerks[userId]?.extra || 0;
  return db.settings.maxPerUser + bonus;
}

function formatLeft(startTime) {
  const r = NUMBER_TTL - (now() - startTime);
  if (r <= 0) return "⏰ انتهى";
  return `⏱ ${String(Math.floor(r/60)).padStart(2,"0")}:${String(r%60).padStart(2,"0")}`;
}

// ===================== Hero SMS API =====================
async function heroGet(endpoint, params = {}) {
  try {
    const r = await axios.get(`${HERO_BASE}/${endpoint}`, {
      params: { ...params, api_key: HERO_API_KEY },
      timeout: 8000,
    });
    return r.data;
  } catch (e) {
    console.error(`[API] ${endpoint}:`, e.message);
    return null;
  }
}

// — مع إعادة المحاولة التلقائية حتى 3 مرات —
async function heroGetRetry(endpoint, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const r = await heroGet(endpoint, params);
    if (r) return r;
    if (i < retries - 1) await sleep(1500);
  }
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function apiBalance()          { const d = await heroGet("balance"); return d?.balance ?? null; }
async function apiServices()         { return heroGetRetry("services"); }
async function apiCountries(svc)     { return heroGetRetry("countries", { service: svc }); }
async function apiGetNumber(svc, country) {
  return heroGetRetry("get-number", { service: svc, country, price: 0 });
}
async function apiSms(orderId)       { return heroGet("get-sms", { order_id: orderId }); }
async function apiCancel(orderId)    { return heroGet("cancel",  { order_id: orderId }); }

// ===================== خدمات مع كاش =====================
async function allServices() {
  if (now() - db.servicesCache.ts < 300 && Object.keys(db.servicesCache.data).length)
    return db.servicesCache.data;
  const d = await apiServices();
  if (d && typeof d === "object") {
    db.servicesCache = { data: d, ts: now() };
    return d;
  }
  return db.servicesCache.data;
}

async function freeServices() {
  const all = await allServices();
  return Object.fromEntries(
    Object.entries(all).filter(([, v]) => typeof v === "object" && parseFloat(v?.price ?? 1) === 0)
  );
}

// ===================== تصنيفات =====================
const CATS = {
  "سوشيال ميديا 📲": ["vk","ok","fb","instagram","tiktok","twitter","snapchat","telegram"],
  "مراسلة 💬":       ["whatsapp","viber","line","wechat","signal"],
  "بريد وحسابات 📧": ["google","gmail","yahoo","microsoft","apple"],
  "تسوق 🛒":         ["amazon","aliexpress","ebay","shopee"],
  "ألعاب 🎮":        ["steam","epicgames","pubg","fortnite","roblox"],
  "مال ومصارف 💳":   ["paypal","binance","coinbase","bank"],
};
function getCategory(code) {
  const l = code.toLowerCase();
  for (const [cat, kws] of Object.entries(CATS))
    if (kws.some(k => l.includes(k))) return cat;
  return "أخرى 🔧";
}
function searchSvc(q, svcs) {
  const lq = q.toLowerCase();
  return Object.fromEntries(
    Object.entries(svcs).filter(([c, v]) =>
      c.toLowerCase().includes(lq) ||
      (typeof v === "object" && (v?.name || "").toLowerCase().includes(lq))
    )
  );
}

// ===================== لوحات المفاتيح =====================
const mainKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("📱 احصل على رقم مجاني", "get_number_menu")],
  [Markup.button.callback("🔍 بحث سريع", "search_mode"),
   Markup.button.callback("💰 رصيدي", "balance")],
  [Markup.button.callback("📋 سجلي", "history"),
   Markup.button.callback("📊 إحصائياتي", "stats")],
  [Markup.button.callback("🎁 نظام الإحالة", "referral"),
   Markup.button.callback("ℹ️ مساعدة", "help")],
]);

const backKb = (cb = "back") => Markup.inlineKeyboard([
  [Markup.button.callback("🔙 الرئيسية", cb)]
]);

const devKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("👥 عرض الأعضاء", "dev_users"),
   Markup.button.callback("📊 إحصائيات عامة", "dev_stats")],
  [Markup.button.callback("💰 عرض الرصيد", "dev_balance"),
   Markup.button.callback("📜 السجل الكامل", "dev_logs")],
  [Markup.button.callback("🔨 حظر مستخدم", "dev_ban_prompt"),
   Markup.button.callback("✅ رفع الحظر", "dev_unban_prompt")],
  [Markup.button.callback("🔇 كتم مستخدم", "dev_mute_prompt"),
   Markup.button.callback("🔊 رفع الكتم", "dev_unmute_prompt")],
  [Markup.button.callback("⭐ ترقية لمسؤول", "dev_promote_prompt"),
   Markup.button.callback("⬇️ تخفيض رتبة", "dev_demote_prompt")],
  [Markup.button.callback("📢 رسالة جماعية", "dev_broadcast_prompt"),
   Markup.button.callback("⚙️ الإعدادات", "dev_settings")],
  [Markup.button.callback("🗑 مسح السجل", "dev_clear_logs"),
   Markup.button.callback("🚫 الأرقام المستخدمة", "dev_used_numbers")],
  [Markup.button.callback("🔙 الرئيسية", "back")],
]);

const devSettingsKb = () => Markup.inlineKeyboard([
  [Markup.button.callback(`📏 حد يومي: ${db.settings.maxPerUser}`, "ds_maxperuser"),
   Markup.button.callback(`⏳ انتظار: ${db.settings.cooldownSec}ث`, "ds_cooldown")],
  [Markup.button.callback(`🎁 مكافأة إحالة: ${db.settings.referralBonus}`, "ds_refbonus"),
   Markup.button.callback(`🚫 الإلغاء التلقائي: ${db.settings.autoCancel?"ON":"OFF"}`, "ds_autocancel")],
  [Markup.button.callback("🔙 لوحة التحكم", "dev_panel")],
]);

// ===================== مراقب SMS التلقائي — سريع جداً =====================
async function smsWatcher(bot, userId, orderId, number, service, chatId) {
  // فترات الاستطلاع: 5 ث أولاً ثم 10 ث — لالتقاط أسرع
  const intervals = [5,5,5,10,10,10,10,10,10,10];
  const maxExtra  = Math.floor((NUMBER_TTL - 100) / 10);

  async function checkOnce() {
    const r = await apiSms(orderId);
    return r?.sms || null;
  }

  // محاولات سريعة
  for (const wait of intervals) {
    await sleep(wait * 1000);
    if (!db.activeNumbers[userId] || db.activeNumbers[userId].orderId !== orderId) return;
    db.activeNumbers[userId].attempts = (db.activeNumbers[userId].attempts || 0) + 1;

    const sms = await checkOnce();
    if (sms) { await deliverSms(bot, userId, orderId, number, service, chatId, sms); return; }
  }

  // محاولات عادية
  for (let i = 0; i < maxExtra; i++) {
    await sleep(10000);
    if (!db.activeNumbers[userId] || db.activeNumbers[userId].orderId !== orderId) return;
    db.activeNumbers[userId].attempts = (db.activeNumbers[userId].attempts || 0) + 1;

    const sms = await checkOnce();
    if (sms) { await deliverSms(bot, userId, orderId, number, service, chatId, sms); return; }
  }

  // انتهى الوقت
  if (db.activeNumbers[userId]?.orderId === orderId) {
    delete db.activeNumbers[userId];
    log("timeout", userId, `رقم ${number} انتهى بدون رسالة`);
    try {
      await bot.telegram.sendMessage(chatId,
        `⏰ *انتهى وقت الرقم* \`${number}\` بدون رسالة.\n` +
        `يمكنك طلب رقم جديد من القائمة.`,
        { parse_mode: "Markdown", ...mainKb() }
      );
    } catch {}
  }
}

async function deliverSms(bot, userId, orderId, number, service, chatId, smsText) {
  delete db.activeNumbers[userId];
  // علّم الرقم مستخدم
  db.usedNumbers.add(number);
  // سجّل نجاح
  if (db.stats[userId]) {
    db.stats[userId].success = (db.stats[userId].success || 0) + 1;
  }
  // سجّل التاريخ
  if (db.history[userId]) {
    const last = db.history[userId].find(h => h.number === number);
    if (last) last.gotSms = true;
  }
  log("sms_received", userId, `${number} | ${service} | ${smsText.slice(0,30)}`);

  try {
    await bot.telegram.sendMessage(chatId,
      `🔔 *وصل الكود تلقائياً!*\n\n` +
      `📱 *الرقم:* \`${number}\`\n` +
      `🔧 *الخدمة:* \`${service}\`\n\n` +
      `📩 *الرسالة / الكود:*\n\`\`\`\n${smsText}\n\`\`\`\n\n` +
      `✅ تم توصيل الكود وإغلاق الرقم.`,
      { parse_mode: "Markdown", ...mainKb() }
    );
  } catch (e) { console.error("deliverSms:", e.message); }
}

// ===================== تسجيل الإحالة =====================
function processReferral(newUserId, refId) {
  if (!refId || refId === newUserId) return;
  if (db.referralOf[newUserId]) return; // مسجل مسبقاً
  db.referralOf[newUserId] = refId;
  if (!db.referrals[refId]) db.referrals[refId] = [];
  db.referrals[refId].push(newUserId);
  // مكافأة صاحب الإحالة
  if (!db.referralPerks[refId]) db.referralPerks[refId] = { extra: 0 };
  db.referralPerks[refId].extra += db.settings.referralBonus;
  log("referral", refId, `أحال المستخدم ${newUserId}`);
}

// ===================== البوت =====================
const bot = new Telegraf(BOT_TOKEN);

// --- middleware: تحقق حظر ---
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  ensureUser(ctx);
  if (isBanned(ctx.from.id) && !isDev(ctx.from.id)) {
    try { await ctx.reply("🚫 أنت محظور من استخدام البوت."); } catch {}
    return;
  }
  return next();
});

// ===================== /start =====================
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  ensureUser(ctx);
  delete db.state[userId];

  // إحالة؟
  const payload = ctx.startPayload;
  if (payload && payload.startsWith("ref_")) {
    const refId = parseInt(payload.slice(4));
    processReferral(userId, refId);
  }

  log("start", userId, db.users[userId]?.name);

  // مطور → لوحة مباشرة
  if (isDev(userId)) {
    return ctx.reply(
      `👑 *مرحباً بالمطور!*\n\nاختر من لوحة التحكم:`,
      { parse_mode: "Markdown", ...devKb() }
    );
  }

  await ctx.reply(
    `👋 *أهلاً بك في بوت الأرقام المجانية!*\n\n` +
    `🆓 أرقام مجانية لاستقبال SMS\n` +
    `⚡ التقاط الكود بثواني تلقائياً\n` +
    `🔔 إشعار فوري عند وصول الرسالة\n` +
    `🎁 نظام إحالة مع مكافآت\n` +
    `🔍 بحث سريع عن أي خدمة\n\n` +
    `اختر من القائمة:`,
    { parse_mode: "Markdown", ...mainKb() }
  );
});

// ===================== /dev — لوحة المطور =====================
bot.command("dev", async (ctx) => {
  if (!isDev(ctx.from.id)) return;
  await ctx.reply("👑 *لوحة تحكم المطور:*", { parse_mode: "Markdown", ...devKb() });
});

// ===================== /panel — للمسؤولين =====================
bot.command("panel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply("🛡 *لوحة المسؤول:*", { parse_mode: "Markdown", ...devKb() });
});

// ===================== معالج الأزرار =====================
bot.on("callback_query", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const data  = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  const edit = (text, extra = {}) =>
    ctx.editMessageText(text, { parse_mode: "Markdown", ...extra }).catch(() =>
      ctx.reply(text, { parse_mode: "Markdown", ...extra })
    );

  // ==================== الرئيسية ====================
  if (data === "back") {
    delete db.state[userId];
    return edit("👋 *القائمة الرئيسية:*", mainKb());
  }

  // ==================== رصيد ====================
  if (data === "balance") {
    const b = await apiBalance();
    return edit(
      b !== null ? `💰 *الرصيد الحالي:* \`${b}\`` : "❌ تعذر جلب الرصيد.",
      backKb()
    );
  }

  // ==================== قائمة الأرقام ====================
  if (data === "get_number_menu") {
    // cooldown
    const last = db.lastRequest[userId] || 0;
    const diff = now() - last;
    if (diff < db.settings.cooldownSec && !isAdmin(userId)) {
      return edit(`⏳ انتظر ${db.settings.cooldownSec - diff} ثانية قبل الطلب التالي.`, backKb());
    }
    // حد يومي
    if (getDailyCount(userId) >= getMaxPerUser(userId) && !isAdmin(userId)) {
      return edit(
        `🚫 *وصلت للحد اليومي* (${getMaxPerUser(userId)} أرقام).\n\nأحِل أصدقاء للحصول على مكافآت! 🎁`,
        backKb()
      );
    }
    await edit("⏳ جاري تحميل الخدمات المجانية...");
    const svcs = await freeServices();
    if (!Object.keys(svcs).length)
      return edit("😔 لا توجد خدمات مجانية حالياً.", backKb());
    return edit(
      `📂 *اختر التصنيف:*\n🆓 الخدمات المتاحة: *${Object.keys(svcs).length}*`,
      buildCatsKb(svcs)
    );
  }

  // ==================== تصنيف ====================
  if (data.startsWith("cat:")) {
    const cat = data.slice(4);
    const svcs = await freeServices();
    const filtered = cat === "all" ? svcs :
      Object.fromEntries(Object.entries(svcs).filter(([c]) => getCategory(c) === cat));
    if (!Object.keys(filtered).length)
      return edit("😔 لا توجد خدمات في هذا التصنيف.", backKb());
    const rows = Object.entries(filtered).slice(0, 15).map(([c, v]) => {
      const name  = v?.name || c;
      const count = v?.count || "";
      return [Markup.button.callback(`🆓 ${name}${count ? ` (${count})` : ""}`, `svc:${c}`)];
    });
    rows.push([Markup.button.callback("🔙 رجوع", "get_number_menu")]);
    return edit(`📋 *${cat}* — ${Object.keys(filtered).length} خدمة:`, Markup.inlineKeyboard(rows));
  }

  // ==================== اختيار خدمة ====================
  if (data.startsWith("svc:")) {
    const svcCode = data.slice(4);
    await edit("⏳ جاري جلب الدول...");
    const countries = await apiCountries(svcCode);
    let rows;
    if (countries && Object.keys(countries).length) {
      rows = Object.entries(countries).slice(0, 8).map(([cc, ci]) => {
        const name  = typeof ci === "object" ? ci?.name || cc : cc;
        const count = typeof ci === "object" ? ci?.count || "" : "";
        return [Markup.button.callback(`🌍 ${name}${count ? ` (${count})` : ""}`, `num:${svcCode}:${cc}`)];
      });
    } else {
      rows = [
        [Markup.button.callback("🇷🇺 روسيا",   `num:${svcCode}:ru`)],
        [Markup.button.callback("🇺🇸 أمريكا",   `num:${svcCode}:us`)],
        [Markup.button.callback("🇬🇧 بريطانيا", `num:${svcCode}:gb`)],
        [Markup.button.callback("🇩🇪 ألمانيا",  `num:${svcCode}:de`)],
        [Markup.button.callback("🌍 أي دولة",   `num:${svcCode}:any`)],
      ];
    }
    rows.push([Markup.button.callback("🔙 رجوع", "cat:all")]);
    return edit(`🌍 *اختر الدولة:* \`${svcCode}\``, Markup.inlineKeyboard(rows));
  }

  // ==================== طلب رقم ====================
  if (data.startsWith("num:")) {
    const [, svcCode, country] = data.split(":");
    db.lastRequest[userId] = now();
    await edit("⚡ *جاري طلب الرقم بأعلى سرعة...*");

    const result = await apiGetNumber(svcCode, country);
    if (!result?.order_id) {
      const msg = result?.message || "تعذر الاتصال بالخادم";
      return edit(`❌ *فشل طلب الرقم*\n\`${msg}\``, backKb());
    }

    const orderId    = String(result.order_id);
    const number     = result.number || "غير معروف";

    // فلترة الأرقام المستخدمة مسبقاً
    if (db.usedNumbers.has(number)) {
      await apiCancel(orderId);
      return edit(
        `⚠️ *هذا الرقم استُخدم مسبقاً.*\n\nجاري طلب رقم آخر...\n\n` +
        `اضغط زر الطلب مجدداً.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔄 طلب رقم جديد", data)],
          [Markup.button.callback("🔙 رجوع", "get_number_menu")],
        ])
      );
    }

    const startTime = now();
    db.activeNumbers[userId] = { orderId, number, service: svcCode, country, startTime, chatId: ctx.chat.id, attempts: 0 };
    incDaily(userId);

    if (!db.stats[userId]) db.stats[userId] = { total: 0, success: 0, attempts: 0 };
    db.stats[userId].total++;

    if (!db.history[userId]) db.history[userId] = [];
    db.history[userId].unshift({ number, service: svcCode, time: ts(), gotSms: false });
    db.history[userId] = db.history[userId].slice(0, 10);

    log("number_issued", userId, `${number} | ${svcCode} | ${country}`);

    await edit(
      `✅ *تم الحصول على الرقم!*\n\n` +
      `📱 *الرقم:* \`${number}\`\n` +
      `🔧 *الخدمة:* \`${svcCode}\`\n` +
      `🌍 *الدولة:* \`${country}\`\n` +
      `🆔 *الطلب:* \`${orderId}\`\n` +
      `${formatLeft(startTime)}\n\n` +
      `⚡ الكود سيصلك تلقائياً بثواني 🔔`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📩 تحقق الآن", `chk:${orderId}`),
         Markup.button.callback("❌ إلغاء", `cxl:${orderId}`)],
        [Markup.button.callback("🔄 تحديث المؤقت", `tmr:${orderId}`)],
        [Markup.button.callback("🔙 الرئيسية", "back")],
      ])
    );

    // مراقب في الخلفية
    smsWatcher(bot, userId, orderId, number, svcCode, ctx.chat.id);
    return;
  }

  // ==================== تحقق SMS =====================
  if (data.startsWith("chk:")) {
    const orderId = data.slice(4);
    await edit("🔍 *جاري البحث السريع عن الرسالة...*");
    let sms = null;
    for (let i = 0; i < 5; i++) {
      const r = await apiSms(orderId);
      if (r?.sms) { sms = r.sms; break; }
      if (i < 4) await sleep(1500);
    }
    const info     = db.activeNumbers[userId];
    const timeLeft = info ? formatLeft(info.startTime) : "";
    if (sms) {
      await deliverSms(bot, userId, orderId, info?.number || "", info?.service || "", ctx.chat.id, sms);
    } else {
      return edit(
        `⌛ *لم تصل رسالة بعد.*\n${timeLeft}\n\nالبوت يراقب تلقائياً ⚡`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔄 تحديث", `chk:${orderId}`),
           Markup.button.callback("❌ إلغاء", `cxl:${orderId}`)],
          [Markup.button.callback("🔙 الرئيسية", "back")],
        ])
      );
    }
    return;
  }

  // ==================== إلغاء ====================
  if (data.startsWith("cxl:")) {
    const orderId = data.slice(4);
    await apiCancel(orderId);
    delete db.activeNumbers[userId];
    log("cancel", userId, orderId);
    return edit("✅ تم إلغاء الرقم.", backKb());
  }

  // ==================== مؤقت ====================
  if (data.startsWith("tmr:")) {
    const orderId = data.slice(4);
    const info    = db.activeNumbers[userId];
    if (!info || info.orderId !== orderId)
      return edit("⚠️ الرقم لم يعد نشطاً.", backKb());
    return edit(
      `⏱ *المؤقت:* ${formatLeft(info.startTime)}\n📱 *الرقم:* \`${info.number}\``,
      Markup.inlineKeyboard([
        [Markup.button.callback("📩 تحقق", `chk:${orderId}`),
         Markup.button.callback("❌ إلغاء", `cxl:${orderId}`)],
        [Markup.button.callback("🔄 تحديث المؤقت", `tmr:${orderId}`)],
        [Markup.button.callback("🔙 الرئيسية", "back")],
      ])
    );
  }

  // ==================== بحث ====================
  if (data === "search_mode") {
    db.state[userId] = { mode: "search" };
    return edit(
      "🔍 *وضع البحث*\n\nأرسل اسم الخدمة أو التطبيق:\nمثال: `whatsapp` أو `google`",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء", "back")]])
    );
  }

  // ==================== سجل ====================
  if (data === "history") {
    const h = db.history[userId] || [];
    if (!h.length) return edit("📋 *لم تستخدم أي رقم بعد.*", backKb());
    let txt = "📋 *آخر 10 أرقام:*\n\n";
    h.forEach((e, i) => {
      txt += `${i+1}. \`${e.number}\` — ${e.service}\n` +
             `   🕐 ${e.time} ${e.gotSms ? "✅" : "⌛"}\n\n`;
    });
    return edit(txt, backKb());
  }

  // ==================== إحصائيات ====================
  if (data === "stats") {
    const s    = db.stats[userId]   || { total: 0, success: 0 };
    const info = db.activeNumbers[userId];
    const refs = (db.referrals[userId] || []).length;
    const bonus = db.referralPerks[userId]?.extra || 0;
    let txt = `📊 *إحصائياتك:*\n\n` +
              `📱 إجمالي الأرقام: *${s.total}*\n` +
              `✅ استقبلت SMS: *${s.success || 0}*\n` +
              `📅 اليوم: *${getDailyCount(userId)}/${getMaxPerUser(userId)}*\n` +
              `👥 إحالاتك: *${refs}*\n` +
              `🎁 مكافأة إضافية: *${bonus} أرقام*\n` +
              `🟢 رقم نشط: *${info ? "نعم" : "لا"}*\n`;
    if (info) txt += `${formatLeft(info.startTime)}\n📞 \`${info.number}\`\n`;
    return edit(txt, backKb());
  }

  // ==================== إحالة ====================
  if (data === "referral") {
    const link = `https://t.me/${(await bot.telegram.getMe()).username}?start=ref_${userId}`;
    const refs  = (db.referrals[userId] || []).length;
    const bonus = db.referralPerks[userId]?.extra || 0;
    return edit(
      `🎁 *نظام الإحالة:*\n\n` +
      `رابطك الخاص:\n\`${link}\`\n\n` +
      `👥 عدد إحالاتك: *${refs}*\n` +
      `🎁 أرقام مكافأة: *${bonus}*\n\n` +
      `📌 لكل صديق يدخل عبر رابطك تحصل على *${db.settings.referralBonus} أرقام إضافية* يومياً!`,
      backKb()
    );
  }

  // ==================== مساعدة ====================
  if (data === "help") {
    return edit(
      `ℹ️ *كيف يعمل البوت:*\n\n` +
      `1️⃣ اضغط *احصل على رقم مجاني*\n` +
      `2️⃣ اختر التصنيف ثم الخدمة\n` +
      `3️⃣ اختر الدولة\n` +
      `4️⃣ استخدم الرقم في التطبيق\n` +
      `5️⃣ الكود يصلك تلقائياً بثواني ⚡\n\n` +
      `🎁 *الإحالة:* شارك رابطك واحصل على مكافآت\n` +
      `📋 *السجل:* آخر 10 أرقام مع حالتها\n` +
      `⏱ الأرقام صالحة 20 دقيقة\n` +
      `✅ كل رقم وصله كود يُغلق ولا يظهر مجدداً`,
      backKb()
    );
  }

  // ==================== لوحة المطور ====================
  if (data === "dev_panel") {
    if (!isAdmin(userId)) return;
    return edit("👑 *لوحة التحكم:*", devKb());
  }

  if (data === "dev_users") {
    if (!isAdmin(userId)) return;
    const users = Object.entries(db.users);
    let txt = `👥 *الأعضاء (${users.length}):*\n\n`;
    users.slice(0, 20).forEach(([id, u]) => {
      const s = db.stats[id] || {};
      txt += `👤 ${u.name} | ID: \`${id}\`\n` +
             `   📅 انضم: ${u.joinedAt}\n` +
             `   📱 أرقام: ${s.total||0} | ✅ ${s.success||0}\n` +
             `   ${u.banned?"🚫 محظور":"✅ نشط"} ${u.muted?"🔇 مكتوم":""}\n\n`;
    });
    if (users.length > 20) txt += `... و ${users.length - 20} آخرين`;
    return edit(txt, Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]]));
  }

  if (data === "dev_stats") {
    if (!isAdmin(userId)) return;
    const totalUsers   = Object.keys(db.users).length;
    const totalNumbers = Object.values(db.stats).reduce((a, s) => a + (s.total||0), 0);
    const totalSuccess = Object.values(db.stats).reduce((a, s) => a + (s.success||0), 0);
    const active       = Object.keys(db.activeNumbers).length;
    const usedNums     = db.usedNumbers.size;
    const totalRefs    = Object.values(db.referrals).reduce((a, r) => a + r.length, 0);
    return edit(
      `📊 *إحصائيات عامة:*\n\n` +
      `👥 إجمالي الأعضاء: *${totalUsers}*\n` +
      `📱 إجمالي الأرقام: *${totalNumbers}*\n` +
      `✅ تم استقبال SMS: *${totalSuccess}*\n` +
      `🟢 أرقام نشطة الآن: *${active}*\n` +
      `🚫 أرقام مستهلكة: *${usedNums}*\n` +
      `🎁 إجمالي الإحالات: *${totalRefs}*\n` +
      `📜 السجلات المحفوظة: *${db.logs.length}*`,
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]])
    );
  }

  if (data === "dev_balance") {
    if (!isAdmin(userId)) return;
    const b = await apiBalance();
    return edit(
      b !== null ? `💰 *رصيد API:* \`${b}\`` : "❌ تعذر جلب الرصيد.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]])
    );
  }

  if (data === "dev_logs") {
    if (!isAdmin(userId)) return;
    const last = db.logs.slice(0, 15);
    let txt = `📜 *آخر ${last.length} أحداث:*\n\n`;
    last.forEach(l => {
      txt += `[${l.time}] *${l.type}* | ${l.userId}\n${l.text}\n\n`;
    });
    return edit(txt || "لا توجد سجلات.", Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]]));
  }

  if (data === "dev_clear_logs") {
    if (!isDev(userId)) return;
    db.logs = [];
    return edit("✅ تم مسح السجل.", Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]]));
  }

  if (data === "dev_used_numbers") {
    if (!isAdmin(userId)) return;
    const list = [...db.usedNumbers].slice(-20);
    return edit(
      `🚫 *آخر الأرقام المستهلكة (${db.usedNumbers.size}):*\n\n` +
      (list.length ? list.map(n => `\`${n}\``).join("\n") : "لا توجد"),
      Markup.inlineKeyboard([[Markup.button.callback("🔙 لوحة التحكم", "dev_panel")]])
    );
  }

  if (data === "dev_settings") {
    if (!isAdmin(userId)) return;
    return edit("⚙️ *الإعدادات:*", devSettingsKb());
  }

  // إعدادات — toggle / prompt
  if (data === "ds_autocancel") {
    if (!isAdmin(userId)) return;
    db.settings.autoCancel = !db.settings.autoCancel;
    return edit("⚙️ *الإعدادات:*", devSettingsKb());
  }

  if (["ds_maxperuser","ds_cooldown","ds_refbonus"].includes(data)) {
    if (!isAdmin(userId)) return;
    const map = { ds_maxperuser: "maxperuser", ds_cooldown: "cooldown", ds_refbonus: "refbonus" };
    db.state[userId] = { mode: "dev_setting", key: map[data] };
    return edit(
      `✏️ *أدخل القيمة الجديدة:*\n` +
      `(${data === "ds_maxperuser" ? "عدد الأرقام اليومية" :
         data === "ds_cooldown"    ? "وقت الانتظار بالثواني" : "مكافأة الإحالة"})`,
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء", "dev_settings")]])
    );
  }

  // prompts لحظر/كتم/ترقية
  for (const [act, label] of [
    ["ban","حظر"],["unban","رفع حظر"],
    ["mute","كتم"],["unmute","رفع كتم"],
    ["promote","ترقية"],["demote","تخفيض"]
  ]) {
    if (data === `dev_${act}_prompt`) {
      if (!isAdmin(userId)) return;
      db.state[userId] = { mode: act };
      return edit(
        `✏️ *أرسل معرف المستخدم (ID) لـ${label}:*`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء", "dev_panel")]])
      );
    }
  }

  if (data === "dev_broadcast_prompt") {
    if (!isAdmin(userId)) return;
    db.state[userId] = { mode: "broadcast" };
    return edit(
      "📢 *أرسل الرسالة الجماعية:*",
      Markup.inlineKeyboard([[Markup.button.callback("❌ إلغاء", "dev_panel")]])
    );
  }
});

// ===================== معالج النصوص =====================
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text   = ctx.message.text.trim();
  const state  = db.state[userId];

  if (!state) return;

  // بحث
  if (state.mode === "search") {
    delete db.state[userId];
    await ctx.reply(`🔍 *جاري البحث عن:* \`${text}\`...`, { parse_mode: "Markdown" });
    const svcs    = await freeServices();
    const results = searchSvc(text, svcs);
    const entries = Object.entries(results).slice(0, 10);
    if (!entries.length)
      return ctx.reply(`😔 لا توجد نتائج لـ *${text}*`, { parse_mode: "Markdown", ...mainKb() });
    const rows = entries.map(([c, v]) => {
      const name  = v?.name || c;
      const count = v?.count || "";
      return [Markup.button.callback(`🆓 ${name}${count ? ` (${count})` : ""}`, `svc:${c}`)];
    });
    rows.push([Markup.button.callback("🔙 الرئيسية", "back")]);
    return ctx.reply(
      `✅ *نتائج البحث (${Object.keys(results).length}):*`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard(rows) }
    );
  }

  // إعداد رقمي
  if (state.mode === "dev_setting") {
    if (!isAdmin(userId)) return;
    const val = parseInt(text);
    if (isNaN(val) || val < 1) return ctx.reply("❌ قيمة غير صحيحة.");
    if (state.key === "maxperuser") db.settings.maxPerUser = val;
    if (state.key === "cooldown")   db.settings.cooldownSec = val;
    if (state.key === "refbonus")   db.settings.referralBonus = val;
    delete db.state[userId];
    log("settings_change", userId, `${state.key} = ${val}`);
    return ctx.reply("✅ تم تحديث الإعداد.", devSettingsKb());
  }

  // حظر
  if (state.mode === "ban") {
    if (!isAdmin(userId)) return;
    const tid = parseInt(text);
    if (isNaN(tid)) return ctx.reply("❌ ID غير صحيح.");
    if (!db.users[tid]) db.users[tid] = { name: String(tid), username: "", joinedAt: ts(), banned: false, muted: false, role: "user" };
    db.users[tid].banned = true;
    delete db.state[userId];
    log("ban", userId, `حظر ${tid}`);
    return ctx.reply(`🚫 تم حظر \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // رفع الحظر
  if (state.mode === "unban") {
    if (!isAdmin(userId)) return;
    const tid = parseInt(text);
    if (db.users[tid]) db.users[tid].banned = false;
    delete db.state[userId];
    log("unban", userId, `رفع حظر ${tid}`);
    return ctx.reply(`✅ تم رفع الحظر عن \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // كتم
  if (state.mode === "mute") {
    if (!isAdmin(userId)) return;
    const tid = parseInt(text);
    if (!db.users[tid]) db.users[tid] = { name: String(tid), username: "", joinedAt: ts(), banned: false, muted: false, role: "user" };
    db.users[tid].muted = true;
    delete db.state[userId];
    log("mute", userId, `كتم ${tid}`);
    return ctx.reply(`🔇 تم كتم \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // رفع الكتم
  if (state.mode === "unmute") {
    if (!isAdmin(userId)) return;
    const tid = parseInt(text);
    if (db.users[tid]) db.users[tid].muted = false;
    delete db.state[userId];
    return ctx.reply(`🔊 تم رفع الكتم عن \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // ترقية لمسؤول
  if (state.mode === "promote") {
    if (!isDev(userId)) return;
    const tid = parseInt(text);
    db.admins.add(tid);
    if (!db.users[tid]) db.users[tid] = { name: String(tid), username: "", joinedAt: ts(), banned: false, muted: false, role: "admin" };
    db.users[tid].role = "admin";
    delete db.state[userId];
    log("promote", userId, `ترقية ${tid}`);
    try { await bot.telegram.sendMessage(tid, "⭐ تمت ترقيتك لمسؤول في البوت!"); } catch {}
    return ctx.reply(`⭐ تمت ترقية \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // تخفيض
  if (state.mode === "demote") {
    if (!isDev(userId)) return;
    const tid = parseInt(text);
    db.admins.delete(tid);
    if (db.users[tid]) db.users[tid].role = "user";
    delete db.state[userId];
    log("demote", userId, `تخفيض ${tid}`);
    return ctx.reply(`⬇️ تم تخفيض \`${tid}\``, { parse_mode: "Markdown", ...devKb() });
  }

  // رسالة جماعية
  if (state.mode === "broadcast") {
    if (!isAdmin(userId)) return;
    delete db.state[userId];
    const userIds = Object.keys(db.users);
    let sent = 0, fail = 0;
    await ctx.reply(`📢 جاري الإرسال لـ ${userIds.length} عضو...`);
    for (const uid of userIds) {
      try {
        await bot.telegram.sendMessage(parseInt(uid),
          `📢 *رسالة من الإدارة:*\n\n${text}`,
          { parse_mode: "Markdown" }
        );
        sent++;
        await sleep(50);
      } catch { fail++; }
    }
    log("broadcast", userId, `أُرسلت لـ ${sent} | فشل ${fail}`);
    return ctx.reply(`✅ أُرسلت لـ *${sent}* | فشل *${fail}*`, { parse_mode: "Markdown", ...devKb() });
  }
});

// ===================== دالة بناء لوحة التصنيفات =====================
function buildCatsKb(svcs) {
  const cats = {};
  for (const [code] of Object.entries(svcs)) {
    const c = getCategory(code);
    cats[c] = (cats[c] || 0) + 1;
  }
  const rows = Object.entries(cats).map(([cat, count]) =>
    [Markup.button.callback(`${cat} (${count})`, `cat:${cat}`)]
  );
  rows.push([Markup.button.callback("📋 عرض الكل", "cat:all")]);
  rows.push([Markup.button.callback("🔙 رجوع", "back")]);
  return Markup.inlineKeyboard(rows);
}

// ===================== تشغيل =====================
console.log("🚀 البوت يعمل...");
bot.launch();
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
