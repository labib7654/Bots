require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { initDB } = require('./database');
const { setupAdmin } = require('./admin');
const handlers = require('./handlers');

initDB();

const bot = new Telegraf(process.env.BOT_TOKEN);

// إضافة session middleware قبل stage
bot.use(session());
bot.use(handlers.stage.middleware());

// Middleware للتحقق من الروبوتات
bot.use(handlers.verificationMiddleware);

// ============ الأوامر والإجراءات ============
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

// إعداد أوامر الأدمن
setupAdmin(bot);

// تشغيل البوت
bot.launch()
  .then(() => console.log('✅ Follow Zone Bot is running...'))
  .catch(err => console.error(err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));