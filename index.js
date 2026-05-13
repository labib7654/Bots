require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const http = require('http');
const { initDB } = require('./database');
const { setupAdmin } = require('./admin');
const handlers = require('./handlers');

// ===== Keep-Alive Server (ضروري لـ Render المجاني) =====
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Follow Zone Bot is running!');
});
server.listen(PORT, () => {
  console.log('Keep-alive server on port', PORT);
});

// ===== تشغيل البوت =====
(async () => {
  try {
    await initDB();
    console.log('قاعدة البيانات جاهزة');
  } catch (err) {
    console.error('خطأ في تحميل قاعدة البيانات:', err);
    process.exit(1);
  }

  if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN غير موجود في متغيرات البيئة');
    process.exit(1);
  }
  if (!process.env.ADMIN_ID) {
    console.error('ADMIN_ID غير موجود في متغيرات البيئة');
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

  // معالجة الأخطاء - يمنع تعطل البوت
  bot.catch((err, ctx) => {
    console.error('خطأ في البوت:', ctx && ctx.updateType, err.message);
  });

  // تشغيل البوت
  await bot.launch();
  console.log('Follow Zone Bot يعمل...');

  // إيقاف آمن
  process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
})();
