const db = require('./database');
const kb = require('./keyboards');

function setupAdmin(bot) {
  const ADMIN_ID = parseInt(process.env.ADMIN_ID);

  // لوحة الإدارة
  bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    await ctx.editMessageText('⚙️ لوحة إدارة Follow Zone', kb.adminPanel());
  });

  // ============ إضافة خدمة ============
  bot.action('admin_add_service', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('أرسل بيانات الخدمة بالشكل:\n`الاسم_عربي | الاسم_انجليزي | الفئة_الأم | السعر`');
    // ننتظر رد المستخدم
    bot.on('text', async (msgCtx) => {
      if (msgCtx.from.id !== ADMIN_ID) return;
      const text = msgCtx.message.text;
      const parts = text.split('|').map(s => s.trim());
      if (parts.length !== 4) return msgCtx.reply('صيغة خاطئة، حاول مرة أخرى.');
      const [name_ar, name_en, parent, price] = parts;
      const priceNum = parseFloat(price);
      if (isNaN(priceNum)) return msgCtx.reply('السعر غير صحيح.');
      await db.addService(name_ar, name_en, parent, priceNum);
      await msgCtx.reply('✅ تمت إضافة الخدمة بنجاح.');
    }, { once: true });
  });

  // ============ تفعيل/تعطيل خدمة ============
  bot.action('admin_toggle_service', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const services = await db.getAllServices();
    const buttons = services.map(s => [
      Markup.button.callback(`${s.name_ar} (${s.is_active ? 'مفعل' : 'معطل'})`, `toggle_service_${s.id}`)
    ]);
    buttons.push([Markup.button.callback('رجوع', 'admin_panel')]);
    await ctx.reply('اختر الخدمة لتغيير حالتها:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/toggle_service_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const serviceId = ctx.match[1];
    const service = await db.getServiceById(serviceId);
    await db.toggleServiceActive(serviceId, !service.is_active);
    await ctx.answerCbQuery(`تم ${service.is_active ? 'تعطيل' : 'تفعيل'} الخدمة.`);
    // إعادة عرض القائمة
  });

  // ============ قائمة الطلبات ============
  bot.action('admin_orders', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const orders = await db.getAllOrders();
    if (orders.length === 0) return ctx.reply('لا توجد طلبات.');
    let text = '📦 قائمة الطلبات:\n\n';
    orders.forEach(o => {
      text += `#${o.id} | ${o.service_name} | ${o.status} | ${o.price}$ | المستخدم: ${o.user_id}\n`;
    });
    const keyboard = orders.map(o => [
      Markup.button.callback(`✅ إتمام #${o.id}`, `complete_order_${o.id}`)
    ]);
    keyboard.push([Markup.button.callback('🔙 رجوع', 'admin_panel')]);
    await ctx.reply(text, Markup.inlineKeyboard(keyboard));
  });

  bot.action(/complete_order_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const orderId = ctx.match[1];
    await db.updateOrderStatus(orderId, 'مكتمل');
    await ctx.answerCbQuery('تم تحديث الطلب إلى مكتمل.');
    // إشعار المستخدم
    const order = await db.getOrderById(orderId);
    try {
      await ctx.telegram.sendMessage(order.user_id, `✅ تم إتمام طلبك رقم ${orderId} بنجاح.`);
    } catch (e) {}
  });

  // ============ إضافة رصيد ============
  bot.action('admin_add_balance', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('أرسل معرف المستخدم ثم المبلغ مفصولين بمسافة:\nمثال: `123456 10`');
    bot.on('text', async (msgCtx) => {
      if (msgCtx.from.id !== ADMIN_ID) return;
      const [uid, amt] = msgCtx.message.text.split(' ');
      const userId = parseInt(uid);
      const amount = parseFloat(amt);
      if (isNaN(userId) || isNaN(amount)) return msgCtx.reply('مدخلات غير صالحة.');
      await db.updateBalance(userId, amount);
      await msgCtx.reply(`✅ تم إضافة ${amount}$ إلى المستخدم ${userId}`);
    }, { once: true });
  });

  // ============ إحصائيات ============
  bot.action('admin_stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = await db.getUsersCount();
    const orders = await db.getTotalOrders();
    const revenue = await db.getTotalRevenue();
    await ctx.reply(`📊 الإحصائيات:\n👥 المستخدمون: ${users}\n📦 الطلبات: ${orders}\n💰 إجمالي الأرباح: ${revenue}$`);
  });

  // ============ بث ============
  bot.action('admin_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('أرسل الرسالة التي تريد إرسالها لجميع المستخدمين (نص، صورة، إلخ):');
    bot.on('message', async (msgCtx) => {
      if (msgCtx.from.id !== ADMIN_ID) return;
      // جلب جميع المستخدمين
      db.db.all(`SELECT id FROM users`, async (err, rows) => {
        if (err) return;
        for (const user of rows) {
          try {
            await ctx.telegram.copyMessage(user.id, msgCtx.chat.id, msgCtx.message.message_id);
          } catch (e) {}
        }
        await msgCtx.reply('✅ تم الإرسال.');
      });
    }, { once: true });
  });

  // قبول شحن
  bot.action(/approve_recharge_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    const reqId = ctx.match[1];
    const req = await db.getRechargeById(reqId);
    if (!req || req.status !== 'معلق') return ctx.answerCbQuery('الطلب غير موجود أو تمت معالجته.');
    await db.acceptRecharge(reqId);
    await db.updateBalance(req.user_id, req.amount);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(`✅ تمت الموافقة على شحن ${req.amount} ${req.currency} للمستخدم ${req.user_id}`);
    try {
      await ctx.telegram.sendMessage(req.user_id, `💰 تم شحن رصيدك بمبلغ ${req.amount} ${req.currency} بنجاح.`);
    } catch (e) {}
  });

  // رفض شحن (اختياري)
  bot.action(/reject_recharge_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const reqId = ctx.match[1];
    await db.run(`UPDATE recharge_requests SET status = 'مرفوض' WHERE id = ?`, [reqId]);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply('تم رفض الطلب.');
  });

  // سجل العمليات بسيط (يمكن تطويره)
  bot.action('admin_log', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    // نعرض آخر 10 سجلات
    db.db.all(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10`, (err, rows) => {
      if (err || rows.length === 0) return ctx.reply('لا توجد سجلات.');
      let text = '📜 سجل العمليات:\n\n';
      rows.forEach(r => { text += `[${r.created_at}] ${r.action}: ${r.details}\n`; });
      ctx.reply(text);
    });
  });
}

module.exports = { setupAdmin };