const { Scenes, session } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');
const { orderWizard, rechargeWizard } = require('./user');

// تجميع المشاهد
const stage = new Scenes.Stage([orderWizard, rechargeWizard]);

// Middleware للتحقق من التحقق (سؤال 5+9)
async function verificationMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const user = await db.getUser(ctx.from.id);
  if (user && user.is_verified) return next();
  // إذا لم يتحقق بعد
  if (ctx.message && ctx.message.text) {
    const answer = parseInt(ctx.message.text);
    if (answer === 14) {
      await db.setVerified(ctx.from.id);
      await ctx.reply('✅ تم التحقق بنجاح، أهلاً بك!');
      // متابعة العملية التي كان يريدها
      return next();
    } else {
      await ctx.reply('❌ إجابة خاطئة. ما ناتج 5 + 9؟');
      return; // لا نكمل
    }
  } else if (ctx.callbackQuery) {
    // إذا ضغط زر قبل التحقق نطلب منه الإجابة أولاً
    await ctx.answerCbQuery('الرجاء الإجابة عن سؤال التحقق أولاً: ما ناتج 5 + 9؟');
    return;
  }
  // أول دخول
  await ctx.reply('🛡️ للتحقق أنك لست بوتاً، أجب عن السؤال: ما ناتج 5 + 9؟');
  return;
}

// معالجة بدء البوت
async function startHandler(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';

  // فحص الإحالة
  let referrerId = null;
  if (ctx.startPayload) {
    referrerId = parseInt(ctx.startPayload);
    if (isNaN(referrerId)) referrerId = null;
  }

  // تسجيل المستخدم أو تحديثه
  await db.addUser(userId, username, firstName, referrerId);

  const isAdmin = userId === parseInt(process.env.ADMIN_ID);
  const user = await db.getUser(userId);

  // رسالة ترحيب مع الرصيد
  await ctx.replyWithMarkdown(
    `👋 أهلاً بك في *Follow Zone*!\n💰 رصيدك الحالي: ${user.balance} دولار\nالعملة: ${user.currency}`,
    kb.mainMenu(isAdmin)
  );
}

// عرض الخدمات - الفئات
async function showCategories(ctx) {
  // نجلب أسماء الفئات الفريدة
  const services = await db.getAllServices();
  const categories = [...new Set(services.map(s => s.parent_category))];
  await ctx.editMessageText('اختر الفئة:', kb.categoriesMenu(categories));
}

// عند اختيار فئة
async function showServicesInCategory(ctx) {
  const category = ctx.match[1];
  const services = await db.getServicesByCategory(category);
  if (services.length === 0) {
    return ctx.editMessageText('لا توجد خدمات في هذه الفئة حالياً.', kb.categoriesMenu([]));
  }
  await ctx.editMessageText(`خدمات ${category}:`, kb.servicesMenu(services));
}

// اختيار خدمة محددة -> بدء مشهد الطلب
async function chooseService(ctx) {
  const serviceId = ctx.match[1];
  ctx.scene.enter('order-wizard', { serviceId });
}

// أزرار الرجوع
async function backMain(ctx) {
  const isAdmin = ctx.from.id === parseInt(process.env.ADMIN_ID);
  await ctx.editMessageText('القائمة الرئيسية:', kb.mainMenu(isAdmin));
}
async function backCategories(ctx) {
  await showCategories(ctx);
}

// ============ الشحن ============
async function rechargeMenu(ctx) {
  await ctx.editMessageText('اختر عملة الشحن:', kb.currencyMenu());
}

async function rechargeCurrencyChosen(ctx) {
  const currency = ctx.match[1]; // recharge_USD -> USD
  const cur = currency.split('_')[1];
  ctx.scene.enter('recharge-wizard', { currency: cur });
}

// ============ الطلبات ============
async function myOrders(ctx) {
  const orders = await db.getOrdersByUser(ctx.from.id);
  if (orders.length === 0) return ctx.editMessageText('ليس لديك طلبات بعد.', kb.mainMenu());
  let text = '📋 طلباتك:\n\n';
  orders.forEach(o => {
    text += `🔹 #${o.id} | ${o.service_name} | ${o.status} | ${o.price}$\nالرابط: ${o.link}\n\n`;
  });
  await ctx.editMessageText(text, kb.mainMenu());
}

// ============ الحساب ============
async function account(ctx) {
  const user = await db.getUser(ctx.from.id);
  await ctx.editMessageText(
    `👤 معلومات حسابك:\nالاسم: ${user.first_name}\nالمعرف: @${user.username || 'لا يوجد'}\nالرصيد: ${user.balance}$\nالعملة: ${user.currency}\nتاريخ الانضمام: ${user.join_date}`,
    kb.mainMenu()
  );
}

// ============ الإحالات ============
async function referral(ctx) {
  const userId = ctx.from.id;
  const referrals = await db.getUserReferrals(userId);
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${userId}`;
  await ctx.editMessageText(
    `🔗 رابط الإحالة الخاص بك:\n${refLink}\n\n👥 عدد المحالين: ${referrals.length}\nستحصل على 10% من قيمة أول طلب لكل شخص يسجل عبر رابطك.`,
    kb.mainMenu()
  );
}

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