require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { initDB } = require('./database');
const { setupAdmin } = require('./admin');
const handlers = require('./handlers');

(async () => {
  // انتظار تحميل قاعدة البيانات (sql.js غير متزامن)
  await initDB();

  if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN غير موجود في ملف .env');
    process.exit(1);
  }
  if (!process.env.ADMIN_ID) {
    console.error('❌ ADMIN_ID غير موجود في ملف .env');
    process.exit(1);
  }

  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Middleware
  bot.use(session());
  bot.use(handlers.stage.middleware());
  bot.use(handlers.verificationMiddleware);

  // الأوامر
  bot.start(handlers.startHandler);
  bot.action('services', handlers.showCategories);
  bot.action(/category_(.+)/, handlers.showServicesInCategory);
  bot.action(/service_(\d+)/, handlers.chooseService);
  bot.action('back_main', handlers.backMain);
  bot.action('back_categories', handlers.backCategories);
  bot.action('recharge', handlers.rechargeMenu);
  bot.action(/recharge_(.+)/, handlers.rechargeCurrencyChosen);
  bot.action('myorders', handlers.myOrders);
  bot.action('account', handlers.account);
  bot.action('referral', handlers.referral);

  // إدارة
  setupAdmin(bot);

  // تشغيل
  bot.launch()
    .then(() => console.log('✅ Follow Zone Bot running...'))
    .catch(err => console.error(err));

  // إيقاف آمن
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();