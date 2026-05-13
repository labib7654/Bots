const { Scenes } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');
const { orderWizard, rechargeWizard } = require('./user');

// ------------------ تجميع المشاهد ------------------
const stage = new Scenes.Stage([orderWizard, rechargeWizard]);

// ------------------ Middleware التحقق ------------------
async function verificationMiddleware(ctx, next) {
  if (!ctx.from) return next();

  // الأدمن لا يحتاج للتحقق
  if (ctx.from.id === parseInt(process.env.ADMIN_ID)) return next();

  const user = await db.getUser(ctx.from.id);

  // إذا كان المستخدم محققاً بالفعل نكمل
  if (user && user.is_verified) return next();

  // إذا أرسل رسالة نصية وتحتوي على الإجابة
  if (ctx.message && ctx.message.text) {
    const answer = parseInt(ctx.message.text.trim());
    if (answer === 14) {
      await db.setVerified(ctx.from.id);
      await ctx.reply('✅ تم التحقق بنجاح، أهلاً بك في المتجر!');
      return next();
    } else {
      await ctx.reply('❌ إجابة خاطئة. ما ناتج 5 + 9؟');
      return; // لا نكمل المعالجة
    }
  }

  // إذا ضغط على زر قبل التحقق
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('الرجاء الإجابة عن سؤال التحقق أولاً: ما ناتج 5 + 9؟');
    return;
  }

  // إذا كان أول دخول أو لم يجب بعد
  await ctx.reply('🛡️ للتحقق أنك لست بوتاً، أجب عن السؤال: ما ناتج 5 + 9؟');
  return;
}

// ------------------ معالج البدء ------------------
async function startHandler(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';

  // استخراج معرف المُحيل من الرابط العميق إن وجد
  let referrerId = null;
  if (ctx.startPayload) {
    const parsed = parseInt(ctx.startPayload);
    if (!isNaN(parsed)) referrerId = parsed;
  }

  // إضافة المستخدم (أو تحديث وجوده)
  await db.addUser(userId, username, firstName, referrerId);

  const isAdmin = userId === parseInt(process.env.ADMIN_ID);
  const user = await db.getUser(userId);

  await ctx.replyWithMarkdown(
    `👋 أهلاً بك في *Follow Zone*!\n💰 رصيدك الحالي: ${user.balance.toFixed(2)} دولار\nالعملة: ${user.currency}`,
    kb.mainMenu(isAdmin)
  );
}

// ------------------ الخدمات (فئات) ------------------
async function showCategories(ctx) {
  const services = await db.getAllServices();
  if (!services || services.length === 0) {
    return ctx.editMessageText('⚠️ لا توجد خدمات متاحة حالياً.', kb.mainMenu());
  }
  // استخراج أسماء الفئات الفريدة
  const categories = [...new Set(services.map(s => s.parent_category))];
  await ctx.editMessageText('📂 اختر الفئة:', kb.categoriesMenu(categories));
}

// ------------------ خدمات داخل فئة ------------------
async function showServicesInCategory(ctx) {
  const category = ctx.match[1]; // تم التقاطه من regex category_(.+)
  const services = await db.getServicesByCategory(category);
  if (services.length === 0) {
    return ctx.editMessageText(`⚠️ لا توجد خدمات ضمن فئة "${category}" حالياً.`, kb.categoriesMenu([]));
  }
  await ctx.editMessageText(`🛒 خدمات ${category}:`, kb.servicesMenu(services));
}

// ------------------ اختيار خدمة (بدء مشهد الطلب) ------------------
async function chooseService(ctx) {
  const serviceId = ctx.match[1]; // من regex service_(\d+)
  ctx.scene.enter('order-wizard', { serviceId });
}

// ------------------ أزرار الرجوع ------------------
async function backMain(ctx) {
  const isAdmin = ctx.from.id === parseInt(process.env.ADMIN_ID);
  await ctx.editMessageText('🏠 القائمة الرئيسية:', kb.mainMenu(isAdmin));
}

async function backCategories(ctx) {
  // نعيد عرض الفئات كما لو ضغط زر الخدمات
  await showCategories(ctx);
}

// ------------------ الشحن ------------------
async function rechargeMenu(ctx) {
  await ctx.editMessageText('💱 اختر عملة الشحن:', kb.currencyMenu());
}

async function rechargeCurrencyChosen(ctx) {
  const currency = ctx.match[1]; // USD, SYP, USDT مباشرة
  ctx.scene.enter('recharge-wizard', { currency });
}

// ------------------ طلباتي ------------------
async function myOrders(ctx) {
  const orders = await db.getOrdersByUser(ctx.from.id);
  if (!orders || orders.length === 0) {
    return ctx.editMessageText('📭 ليس لديك أي طلبات بعد.', kb.mainMenu());
  }
  let text = '📋 طلباتك:\n\n';
  for (const o of orders) {
    const line = `🔹 #${o.id} | ${o.service_name}\n   الحالة: ${o.status} | السعر: ${o.price}$\n   الرابط: ${o.link}\n\n`;
    if ((text + line).length > 3800) {
      text += '... وطلبات أخرى. استخدم لوحة التحكم لعرض الكل.';
      break;
    }
    text += line;
  }
  await ctx.editMessageText(text, kb.mainMenu());
}

// ------------------ حسابي ------------------
async function account(ctx) {
  const user = await db.getUser(ctx.from.id);
  await ctx.editMessageText(
    `👤 معلومات حسابك:\n\n` +
    `• الاسم: ${user.first_name || '---'}\n` +
    `• اليوزر: @${user.username || 'لا يوجد'}\n` +
    `• الرصيد: ${user.balance.toFixed(2)}$\n` +
    `• العملة: ${user.currency}\n` +
    `• تاريخ الانضمام: ${user.join_date || '---'}`,
    kb.mainMenu()
  );
}

// ------------------ الإحالات ------------------
async function referral(ctx) {
  const userId = ctx.from.id;
  const referrals = await db.getUserReferrals(userId);
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${userId}`;
  await ctx.editMessageText(
    `🔗 رابط الإحالة الخاص بك:\n\`${refLink}\`\n\n` +
    `👥 عدد المسجلين عبر رابطك: ${referrals.length}\n` +
    `💵 ستحصل على 10% من قيمة أول طلب لكل شخص يسجل عبر رابطك.`,
    { parse_mode: 'Markdown', ...kb.mainMenu() }
  );
}

// ------------------ تصدير ------------------
module.exports = {
  stage,
  verificationMiddleware,
  startHandler,
  showCategories,
  showServicesInCategory,
  chooseService,
  backMain,
  backCategories,
  rechargeMenu,
  rechargeCurrencyChosen,
  myOrders,
  account,
  referral,
};