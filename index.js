require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { initDB } = require('./database');
const { setupAdmin } = require('./admin');
const handlers = require('./handlers');

// تهيئة قاعدة البيانات
initDB();

// إنشاء البوت
const bot = new Telegraf(process.env.BOT_TOKEN);

// !important: session middleware قبل stage
bot.use(session());
bot.use(handlers.stage.middleware());

// Middleware التحقق من الروبوت
bot.use(handlers.verificationMiddleware);

// ============ الأوامر والإجراءات ============

// أمر البدء
bot.start(handlers.startHandler);

// التنقل بين القوائم
bot.action('services', handlers.showCategories);
bot.action(/category_(.+)/, handlers.showServicesInCategory);
bot.action(/service_(\d+)/, handlers.chooseService);
bot.action('back_main', handlers.backMain);
bot.action('back_categories', handlers.backCategories);

// الشحن
bot.action('recharge', handlers.rechargeMenu);
bot.action(/recharge_(.+)/, handlers.rechargeCurrencyChosen);

// طلباتي - حسابي - الإحالات
bot.action('myorders', handlers.myOrders);
bot.action('account', handlers.account);
bot.action('referral', handlers.referral);

// إعداد أوامر الأدمن
setupAdmin(bot);

// ============ تشغيل البوت ============
bot.launch()
  .then(() => {
    console.log('✅ Follow Zone Bot is running...');
    console.log(`🔗 Bot username: @${bot.botInfo?.username}`);
  })
  .catch((err) => {
    console.error('❌ فشل تشغيل البوت:', err);
  });

// إيقاف آمن عند إنهاء العملية
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));