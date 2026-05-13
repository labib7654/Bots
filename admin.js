const { Markup } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');

// كائن مؤقت لحفظ العمليات المعلقة لكل أدمن (إضافة خدمة، إضافة رصيد، إلخ)
const adminPending = new Map();

/**
 * دالة مساعدة لانتظار رد نصي واحد من الأدمن
 * تُضاف عند الحاجة وتُحذف مباشرة بعد الاستلام
 */
function waitForAdminText(bot, adminId, actionType) {
  adminPending.set(adminId, actionType);
}

/**
 * إعداد جميع أوامر الأدمن وربطها بالبوت
 */
function setupAdmin(bot) {
  const ADMIN_ID = parseInt(process.env.ADMIN_ID);

  // ========================
  // 1. لوحة التحكم الرئيسية
  // ========================
  bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    await ctx.editMessageText('⚙️ لوحة إدارة Follow Zone', kb.adminPanel());
  });

  // ========================
  // 2. إضافة خدمة
  // ========================
  bot.action('admin_add_service', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    await ctx.reply('أرسل بيانات الخدمة بالصيغة:\n`الاسم_عربي | الاسم_انجليزي | الفئة_الأم | السعر`\nمثال: متابعين تويتر | Twitter Followers | تويتر | 10');
    waitForAdminText(bot, ADMIN_ID, 'add_service');
  });

  // ========================
  // 3. تفعيل / تعطيل خدمة
  // ========================
  bot.action('admin_toggle_service', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    const services = await db.getAllServices();
    if (services.length === 0) return ctx.reply('لا توجد خدمات بعد.');
    const buttons = services.map(s => [
      Markup.button.callback(`${s.name_ar} (${s.is_active ? 'مفعل' : 'معطل'})`, `toggle_service_${s.id}`)
    ]);
    buttons.push([Markup.button.callback('🔙 رجوع', 'admin_panel')]);
    await ctx.reply('اختر الخدمة لتغيير حالتها:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/toggle_service_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const serviceId = ctx.match[1];
    const service = await db.getServiceById(serviceId);
    if (!service) return ctx.answerCbQuery('الخدمة غير موجودة');
    await db.toggleServiceActive(serviceId, !service.is_active);
    await ctx.answerCbQuery(`تم ${service.is_active ? 'تعطيل' : 'تفعيل'} الخدمة بنجاح`);
    // حذف رسالة القائمة القديمة لتجنب التكدس
    try { await ctx.deleteMessage(); } catch (e) {}
  });

  // ========================
  // 4. قائمة الطلبات مع إمكانية الإتمام
  // ========================
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
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    const orderId = ctx.match[1];
    await db.updateOrderStatus(orderId, 'مكتمل');
    await ctx.answerCbQuery('تم تحديث الطلب إلى مكتمل.');
    const order = await db.getOrderById(orderId);
    if (order) {
      try {
        await ctx.telegram.sendMessage(order.user_id, `✅ تم إتمام طلبك رقم #${orderId} (${order.service_name}) بنجاح.`);
      } catch (e) { /* قد يكون المستخدم حظر البوت */ }
    }
    // تحديث رسالة الأزرار لتختفي بعد المعالجة
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}
  });

  // ========================
  // 5. إضافة رصيد لمستخدم
  // ========================
  bot.action('admin_add_balance', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    await ctx.reply('أرسل معرف المستخدم ثم المبلغ مفصولين بمسافة:\nمثال: `123456789 10`');
    waitForAdminText(bot, ADMIN_ID, 'add_balance');
  });

  // ========================
  // 6. إحصائيات
  // ========================
  bot.action('admin_stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = await db.getUsersCount();
    const orders = await db.getTotalOrders();
    const revenue = await db.getTotalRevenue();
    await ctx.reply(
      `📊 إحصائيات البوت:\n\n` +
      `👥 المستخدمون: ${users}\n` +
      `📦 إجمالي الطلبات: ${orders}\n` +
      `💰 إجمالي الأرباح: ${revenue}$`
    );
  });

  // ========================
  // 7. إرسال إشعار جماعي (بث)
  // ========================
  bot.action('admin_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('أرسل الآن الرسالة التي تريد إرسالها إلى جميع المستخدمين (نص، صورة، إلخ):');
    waitForAdminText(bot, ADMIN_ID, 'broadcast');
  });

  // ========================
  // 8. سجل العمليات
  // ========================
  bot.action('admin_log', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const logs = await db.getRecentLogs();
    if (!logs || logs.length === 0) return ctx.reply('لا توجد سجلات بعد.');
    let text = '📜 آخر ١٠ عمليات:\n\n';
    logs.forEach(r => {
      text += `🕒 ${r.created_at} | المستخدم: ${r.user_id || '---'} | ${r.action}: ${r.details}\n`;
    });
    await ctx.reply(text);
  });

  // ========================
  // 9. قبول / رفض طلب شحن
  // ========================
  bot.action(/approve_recharge_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    const reqId = ctx.match[1];
    const req = await db.getRechargeById(reqId);
    if (!req || req.status !== 'معلق') return ctx.answerCbQuery('الطلب غير موجود أو تمت معالجته');

    await db.acceptRecharge(reqId);
    await db.updateBalance(req.user_id, req.amount);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(`✅ تمت الموافقة على شحن ${req.amount} ${req.currency} للمستخدم ${req.user_id}`);
    try {
      await ctx.telegram.sendMessage(req.user_id, `💰 تم شحن رصيدك بمبلغ ${req.amount} ${req.currency} بنجاح.`);
    } catch (e) {}
  });

  bot.action(/reject_recharge_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
    const reqId = ctx.match[1];
    await db.rejectRecharge(reqId);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply('❌ تم رفض طلب الشحن.');
  });

  // ========================
  // معالج النصوص للإجراءات المعلقة (بث، إضافة خدمة، إضافة رصيد)
  // ========================
  bot.on('text', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const pending = adminPending.get(ADMIN_ID);
    if (!pending) return;

    // نستدعي الدالة المناسبة بناءً على نوع العملية المعلقة
    const text = ctx.message.text.trim();

    if (pending === 'broadcast') {
      adminPending.delete(ADMIN_ID);
      const users = await db.getAllUsers();
      let sent = 0;
      for (const user of users) {
        try {
          await ctx.telegram.copyMessage(user.id, ctx.chat.id, ctx.message.message_id);
          sent++;
        } catch (e) { /* skip blocked users */ }
        // تأخير بسيط لتجنب الضغط على API
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await ctx.reply(`✅ تم إرسال الرسالة إلى ${sent} مستخدم.`);
    }
    else if (pending === 'add_service') {
      adminPending.delete(ADMIN_ID);
      const parts = text.split('|').map(s => s.trim());
      if (parts.length !== 4) {
        return ctx.reply('❌ صيغة خاطئة. تأكد من إرسال: الاسم_عربي | الاسم_انجليزي | الفئة_الأم | السعر');
      }
      const [name_ar, name_en, parent, priceStr] = parts;
      const price = parseFloat(priceStr);
      if (isNaN(price) || price <= 0) {
        return ctx.reply('❌ السعر غير صحيح، يجب أن يكون رقماً موجباً.');
      }
      await db.addService(name_ar, name_en, parent, price);
      await ctx.reply(`✅ تمت إضافة الخدمة "${name_ar}" بنجاح.`);
    }
    else if (pending === 'add_balance') {
      adminPending.delete(ADMIN_ID);
      const parts = text.split(' ').filter(s => s.length > 0);
      if (parts.length !== 2) {
        return ctx.reply('❌ صيغة خاطئة. تأكد من إرسال: ID_المستخدم المبلغ');
      }
      const targetId = parseInt(parts[0]);
      const amount = parseFloat(parts[1]);
      if (isNaN(targetId) || isNaN(amount)) {
        return ctx.reply('❌ المعرف أو المبلغ غير صحيح.');
      }
      const targetUser = await db.getUser(targetId);
      if (!targetUser) {
        return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.');
      }
      await db.updateBalance(targetId, amount);
      await ctx.reply(`✅ تم إضافة ${amount}$ إلى رصيد المستخدم ${targetId}.`);
      try {
        await ctx.telegram.sendMessage(targetId, `💰 تم إضافة ${amount}$ إلى رصيدك من قبل الإدارة.`);
      } catch (e) {}
    }
  });

  // ========================
  // زر الرجوع العام (للإدارة)
  // ========================
  bot.action('back_main', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return; // يُترك للمستخدم العادي في handlers.js
    // يفضل هنا عدم التعارض مع handlers، سنتركها للـ handlers العامة
  });
}

module.exports = { setupAdmin };