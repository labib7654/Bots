require('dotenv').config();
const { Telegraf } = require('telegraf');
const { initDB } = require('./database');
const { setupAdmin } = require('./admin');
const handlers = require('./handlers');

// تهيئة قاعدة البيانات
initDB();

const bot = new Telegraf(process.env.BOT_TOKEN);

// استخدام المراحل (scenes)
bot.use(handlers.stage.middleware());

// Middleware للتحقق من الروبوتات
bot.use(handlers.verificationMiddleware);

// ============ الأوامر والإجراءات ============
bot.start(handlers.startHandler);

// قائمة الخدمات
bot.action('services', handlers.showCategories);
bot.action(/category_(.+)/, handlers.showServicesInCategory);
bot.action(/service_(\d+)/, handlers.chooseService);

// أزرار التنقل
bot.action('back_main', handlers.backMain);
bot.action('back_categories', handlers.backCategories);

// الشحن
bot.action('recharge', handlers.rechargeMenu);
bot.action(/recharge_(.+)/, handlers.rechargeCurrencyChosen);

// طلباتي
bot.action('myorders', handlers.myOrders);

// حسابي
bot.action('account', handlers.account);

// الإحالات
bot.action('referral', handlers.referral);

// إعداد أوامر الأدمن
setupAdmin(bot);

// تشغيل البوت
bot.launch()
  .then(() => console.log('✅ Follow Zone Bot is running...'))
  .catch(err => console.error(err));

// إيقاف آمن
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));