// index.js - بوت المتجر الرئيسي
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const products = require('./products');
const { createOrder, updateStatus, getAllOrders, getUserOrders, statusEmoji, statusText } = require('./orders');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const DEVELOPER_ID = parseInt(process.env.DEVELOPER_ID);
const PORT         = parseInt(process.env.PORT) || 3000;

const bot = new Telegraf(BOT_TOKEN);
const userStates = new Map();

// ─── لوحات المفاتيح ───────────────────────────────────────────
const mainKeyboard = Markup.keyboard([
  ['🛍️ المنتجات', '🔍 البحث'],
  ['📦 طلباتي',   '📞 التواصل'],
  ['ℹ️ عن المتجر'],
]).resize();

const productButtons = (id, available) => Markup.inlineKeyboard([
  available
    ? [Markup.button.callback('🛒 اطلب الآن', `order_${id}`)]
    : [Markup.button.callback('❌ غير متوفر', 'unavailable')],
  [Markup.button.callback('🔙 رجوع للمنتجات', 'back_products')],
]);

const confirmButtons = (id) => Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد الطلب', `confirm_${id}`),
   Markup.button.callback('❌ إلغاء', 'cancel_order')],
]);

const adminOrderButtons = (orderId) => Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد', `adm_ok_${orderId}`),
   Markup.button.callback('📦 تسليم', `adm_del_${orderId}`)],
  [Markup.button.callback('❌ إلغاء', `adm_cancel_${orderId}`)],
]);

// ─── لوج ────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const u = ctx.from;
  const t = ctx.message?.text || ctx.callbackQuery?.data || '—';
  console.log(`[${new Date().toLocaleTimeString()}] ${u?.first_name} (${u?.id}) | ${t}`);
  await next();
});

// ─── /start ─────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const isAdmin = ctx.from.id === DEVELOPER_ID;
  await ctx.replyWithMarkdown(
    `✨ *أهلاً ${ctx.from.first_name}!*\n\n🛍️ مرحبًا بك في متجرنا المميز\n\n${isAdmin ? '👑 *أنت مسجل كمطور البوت*\nاستخدم /admin للوحة التحكم\n\n' : ''}اختر من القائمة أدناه 👇`,
    mainKeyboard
  );
});

// ─── /admin ──────────────────────────────────────────────────────
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== DEVELOPER_ID) return ctx.reply('⛔ للمطور فقط!');
  const all = getAllOrders();
  const pending   = all.filter(o => o.status === 'pending').length;
  const delivered = all.filter(o => o.status === 'delivered').length;
  const revenue   = all.filter(o => o.status === 'delivered').reduce((s, o) => s + o.price, 0);

  await ctx.replyWithMarkdown(
    `👑 *لوحة تحكم المطور*\n\n⏳ انتظار: ${pending}\n📦 مسلّم: ${delivered}\n📋 الكل: ${all.length}\n💰 الإيرادات: ${revenue}$`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 جميع الطلبات', 'adm_all')],
      [Markup.button.callback('📈 الإحصائيات',   'adm_stats')],
    ])
  );
});

// ─── عرض المنتجات ────────────────────────────────────────────────
async function showProducts(ctx) {
  const buttons = products.map(p => [
    Markup.button.callback(`${p.available ? '✅' : '❌'} ${p.emoji} ${p.name} — ${p.price}${p.currency}`, `product_${p.id}`)
  ]);
  await ctx.replyWithMarkdown('🛍️ *اختر المنتج:*', Markup.inlineKeyboard(buttons));
}

bot.hears('🛍️ المنتجات', showProducts);

// ─── البحث ───────────────────────────────────────────────────────
bot.hears('🔍 البحث', async (ctx) => {
  userStates.set(ctx.from.id, 'searching');
  await ctx.reply('🔍 أرسل كلمة البحث:', { reply_markup: { force_reply: true } });
});

// ─── طلباتي ──────────────────────────────────────────────────────
bot.hears('📦 طلباتي', async (ctx) => {
  const myOrders = getUserOrders(ctx.from.id);
  if (!myOrders.length) return ctx.reply('📦 لا يوجد طلبات بعد!\n\nاضغط 🛍️ المنتجات للتسوق');
  let msg = `📦 *طلباتك (${myOrders.length})*\n\n`;
  myOrders.slice(0, 10).forEach(o => {
    msg += `🔢 \`#${o.orderId}\` — ${o.productName}\n💰 ${o.price}$ | ${statusEmoji[o.status]} ${statusText[o.status]}\n\n`;
  });
  await ctx.replyWithMarkdown(msg);
});

// ─── عن المتجر ───────────────────────────────────────────────────
bot.hears('ℹ️ عن المتجر', async (ctx) => {
  await ctx.replyWithMarkdown(
    `ℹ️ *عن المتجر*\n\n✨ نقدم أفضل المنتجات الرقمية\n\n• 🚀 تسليم فوري\n• 💯 ضمان الجودة\n• 📞 دعم 24/7\n• 💰 أسعار منافسة`,
    mainKeyboard
  );
});

// ─── التواصل ─────────────────────────────────────────────────────
bot.hears('📞 التواصل', async (ctx) => {
  await ctx.replyWithMarkdown(
    '📞 *تواصل معنا*\n\nأرسل رسالتك وسنرد عليك قريباً 👇',
    Markup.inlineKeyboard([[Markup.button.callback('📨 إرسال رسالة', 'send_support')]])
  );
});

// ─── Callback Queries ─────────────────────────────────────────────
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // ── عرض منتج ──
  if (data.startsWith('product_')) {
    const p = products.find(x => x.id === parseInt(data.split('_')[1]));
    if (!p) return ctx.answerCbQuery('❌ المنتج غير موجود');
    await ctx.replyWithMarkdown(
      `${p.emoji} *${p.name}*\n\n📝 ${p.description}\n\n💰 السعر: *${p.price} ${p.currency}*\n📦 الحالة: ${p.available ? '✅ متوفر' : '❌ غير متوفر'}`,
      productButtons(p.id, p.available)
    );
    await ctx.answerCbQuery();

  // ── بدء الطلب ──
  } else if (data.startsWith('order_')) {
    const p = products.find(x => x.id === parseInt(data.split('_')[1]));
    if (!p || !p.available) return ctx.answerCbQuery('❌ غير متوفر');
    await ctx.replyWithMarkdown(
      `🛒 *تأكيد الطلب*\n\n${p.emoji} ${p.name}\n💰 السعر: *${p.price} ${p.currency}*\n\n⚠️ سيتم التواصل معك بعد التأكيد لإتمام الدفع\n\nهل تريد تأكيد الطلب؟`,
      confirmButtons(p.id)
    );
    await ctx.answerCbQuery();

  // ── تأكيد الطلب ──
  } else if (data.startsWith('confirm_')) {
    const p = products.find(x => x.id === parseInt(data.split('_')[1]));
    if (!p) return ctx.answerCbQuery('❌ خطأ');
    const order = createOrder(ctx.from.id, ctx.from.username, p.id, p.name, p.price);

    await ctx.replyWithMarkdown(
      `✅ *تم استلام طلبك!*\n\n🔢 رقم الطلب: \`#${order.orderId}\`\n${p.emoji} ${p.name}\n💰 ${p.price} ${p.currency}\n⏳ سيتم التواصل معك قريباً`,
      mainKeyboard
    );
    await ctx.answerCbQuery('✅ تم تسجيل طلبك!');

    // إشعار المطور
    try {
      await bot.telegram.sendMessage(DEVELOPER_ID,
        `🔔 *طلب جديد!*\n\n🔢 \`#${order.orderId}\`\n👤 ${ctx.from.first_name}${ctx.from.username ? ` @${ctx.from.username}` : ''}\n🆔 \`${ctx.from.id}\`\n${p.emoji} ${p.name}\n💰 ${p.price}$`,
        { parse_mode: 'Markdown', reply_markup: adminOrderButtons(order.orderId).reply_markup }
      );
    } catch (e) { console.error('إشعار المطور فشل:', e.message); }

  // ── إلغاء الطلب ──
  } else if (data === 'cancel_order') {
    await ctx.answerCbQuery('❌ تم الإلغاء');
    await ctx.reply('❌ تم إلغاء الطلب', mainKeyboard);

  // ── رجوع ──
  } else if (data === 'back_products') {
    await showProducts(ctx);
    await ctx.answerCbQuery();

  } else if (data === 'back_main') {
    await ctx.reply('🏠 القائمة الرئيسية', mainKeyboard);
    await ctx.answerCbQuery();

  } else if (data === 'unavailable') {
    await ctx.answerCbQuery('❌ هذا المنتج غير متوفر حالياً');

  // ── دعم ──
  } else if (data === 'send_support') {
    userStates.set(ctx.from.id, 'support');
    await ctx.answerCbQuery();
    await ctx.reply('✍️ أرسل رسالتك الآن:', { reply_markup: { force_reply: true } });

  // ── أوامر المطور ──
  } else if (data === 'adm_all') {
    const all = getAllOrders();
    if (!all.length) { await ctx.answerCbQuery('لا يوجد طلبات'); return; }
    let msg = `📋 *جميع الطلبات (${all.length})*\n\n`;
    all.slice(0, 15).forEach(o => {
      msg += `\`#${o.orderId}\` ${statusEmoji[o.status]} ${o.username} | ${o.productName} | ${o.price}$\n`;
    });
    await ctx.replyWithMarkdown(msg);
    await ctx.answerCbQuery();

  } else if (data === 'adm_stats') {
    const all = getAllOrders();
    const revenue = all.filter(o => o.status === 'delivered').reduce((s, o) => s + o.price, 0);
    await ctx.replyWithMarkdown(
      `📈 *الإحصائيات*\n\n📋 إجمالي الطلبات: ${all.length}\n⏳ انتظار: ${all.filter(o=>o.status==='pending').length}\n✅ مؤكد: ${all.filter(o=>o.status==='confirmed').length}\n📦 مسلّم: ${all.filter(o=>o.status==='delivered').length}\n❌ ملغي: ${all.filter(o=>o.status==='cancelled').length}\n\n💰 الإيرادات: ${revenue}$`
    );
    await ctx.answerCbQuery();

  // ── تأكيد المطور ──
  } else if (data.startsWith('adm_ok_')) {
    const order = updateStatus(data.split('adm_ok_')[1], 'confirmed');
    if (!order) return ctx.answerCbQuery('❌ الطلب غير موجود');
    await ctx.answerCbQuery('✅ تم التأكيد');
    try {
      await bot.telegram.sendMessage(order.userId, `✅ *تم تأكيد طلبك \`#${order.orderId}\`!*\n\nسيتم التواصل معك قريباً لإتمام الدفع 🎉`, { parse_mode: 'Markdown' });
    } catch (e) {}

  // ── تسليم المطور ──
  } else if (data.startsWith('adm_del_')) {
    const order = updateStatus(data.split('adm_del_')[1], 'delivered');
    if (!order) return ctx.answerCbQuery('❌ الطلب غير موجود');
    await ctx.answerCbQuery('📦 تم التسليم');
    try {
      await bot.telegram.sendMessage(order.userId, `📦 *تم تسليم طلبك \`#${order.orderId}\`!*\n\nشكراً لتسوقك معنا ❤️`, { parse_mode: 'Markdown' });
    } catch (e) {}

  // ── إلغاء المطور ──
  } else if (data.startsWith('adm_cancel_')) {
    const order = updateStatus(data.split('adm_cancel_')[1], 'cancelled');
    if (!order) return ctx.answerCbQuery('❌ الطلب غير موجود');
    await ctx.answerCbQuery('❌ تم الإلغاء');
    try {
      await bot.telegram.sendMessage(order.userId, `❌ *تم إلغاء طلبك \`#${order.orderId}\`*\n\nللاستفسار تواصل معنا عبر الدعم.`, { parse_mode: 'Markdown' });
    } catch (e) {}

  } else {
    await ctx.answerCbQuery();
  }
});

// ─── الرسائل النصية ───────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const state = userStates.get(userId);

  // بحث
  if (state === 'searching') {
    userStates.delete(userId);
    const q = text.toLowerCase();
    const results = products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    if (!results.length) return ctx.reply(`❌ لم أجد نتائج لـ: "${text}"`);
    const buttons = results.map(p => [
      Markup.button.callback(`${p.available ? '✅' : '❌'} ${p.emoji} ${p.name} — ${p.price}$`, `product_${p.id}`)
    ]);
    await ctx.replyWithMarkdown(`🔍 *${results.length} نتيجة لـ "${text}":*`, Markup.inlineKeyboard(buttons));
    return;
  }

  // دعم
  if (state === 'support') {
    userStates.delete(userId);
    try {
      await bot.telegram.sendMessage(DEVELOPER_ID,
        `📨 *رسالة دعم!*\n\n👤 ${ctx.from.first_name}${ctx.from.username ? ` @${ctx.from.username}` : ''}\n🆔 \`${userId}\`\n\n💬 ${text}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply('✅ تم إرسال رسالتك! سنرد قريباً 🙏', mainKeyboard);
    } catch (e) {
      await ctx.reply('❌ حدث خطأ، حاول مرة أخرى');
    }
    return;
  }

  await ctx.reply('🤔 استخدم القائمة أدناه أو /start للبداية', mainKeyboard);
});

// ─── Express Health Check ─────────────────────────────────────────
const app = express();
app.get('/',       (_, res) => res.json({ status: '✅ البوت يعمل', time: new Date().toISOString() }));
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.listen(PORT, () => console.log(`🌐 السيرفر على البورت ${PORT}`));

// ─── تشغيل البوت ─────────────────────────────────────────────────
bot.launch().then(async () => {
  const me = await bot.telegram.getMe();
  console.log(`🤖 البوت يعمل: @${me.username}`);
}).catch(err => {
  console.error('❌ خطأ:', err.message);
  process.exit(1);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
