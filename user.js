const { Scenes } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');

// ==================== مشهد إنشاء الطلب ====================
const orderWizard = new Scenes.WizardScene(
  'order-wizard',
  // الخطوة 1: استلام serviceId من scene state وطلب الرابط
  async (ctx) => {
    // ننقل القيمة من scene.state إلى wizard.state
    ctx.wizard.state.serviceId = ctx.scene.state.serviceId;
    const service = await db.getServiceById(ctx.wizard.state.serviceId);
    if (!service) {
      await ctx.reply('⚠️ الخدمة غير موجودة.');
      return ctx.scene.leave();
    }
    await ctx.reply(
      `📝 أدخل الرابط أو المعرف المطلوب لخدمة *${service.name_ar}*:`,
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },
  // الخطوة 2: استلام الرابط ومعالجة الطلب
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('يرجى إرسال الرابط نصاً.');
      return;
    }
    const link = ctx.message.text.trim();
    const serviceId = ctx.wizard.state.serviceId;
    const userId = ctx.from.id;

    const user = await db.getUser(userId);
    const service = await db.getServiceById(serviceId);

    if (user.balance < service.price) {
      await ctx.reply(
        `⚠️ رصيدك غير كافٍ.\nسعر الخدمة: ${service.price}$\nرصيدك: ${user.balance.toFixed(2)}$\nيرجى شحن رصيدك أولاً.`
      );
      return ctx.scene.leave();
    }

    // نتحقق مما إذا كان هذا أول طلب (لمكافأة الإحالة)
    const existingOrders = await db.getOrdersByUser(userId);
    const isFirstOrder = existingOrders.length === 0;

    // خصم الرصيد وإنشاء الطلب
    await db.updateBalance(userId, -service.price);
    const orderId = await db.createOrder(userId, service.id, service.name_ar, link, service.price);

    // مكافأة الإحالة لأول طلب فقط
    if (isFirstOrder && user.referrer_id) {
      const bonus = parseFloat((service.price * 0.1).toFixed(2));
      await db.updateBalance(user.referrer_id, bonus);
      try {
        await ctx.telegram.sendMessage(
          user.referrer_id,
          `🎉 مبروك! حصلت على مكافأة إحالة بقيمة ${bonus}$ من طلب المستخدم ${user.first_name || userId}.`
        );
      } catch (e) {
        // ربما المستخدم حظر البوت
      }
    }

    // تسجيل النشاط
    await db.addLog(userId, 'إنشاء طلب', `خدمة: ${service.name_ar}, السعر: ${service.price}$, الرابط: ${link}`);

    await ctx.reply(
      `✅ تم إنشاء طلبك بنجاح!\n` +
      `الخدمة: ${service.name_ar}\n` +
      `الرابط: ${link}\n` +
      `السعر: ${service.price}$\n` +
      `الحالة: قيد التنفيذ\n` +
      `رقم الطلب: ${orderId}`,
      kb.mainMenu()
    );
    return ctx.scene.leave();
  }
);

// ==================== مشهد الشحن ====================
const rechargeWizard = new Scenes.WizardScene(
  'recharge-wizard',
  // الخطوة 1: استلام العملة وطلب المبلغ
  async (ctx) => {
    // ننقل العملة من scene.state إلى wizard.state
    ctx.wizard.state.currency = ctx.scene.state.currency;
    const currency = ctx.wizard.state.currency;
    await ctx.reply(`💱 اخترت ${currency}. الآن أدخل المبلغ الذي ترغب في شحنه:`);
    return ctx.wizard.next();
  },
  // الخطوة 2: استلام المبلغ
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('يرجى إدخال المبلغ رقماً.');
      return;
    }
    const amount = parseFloat(ctx.message.text.trim());
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('يرجى إدخال مبلغ صحيح أكبر من صفر.');
      return;
    }
    const currency = ctx.wizard.state.currency;
    const userId = ctx.from.id;

    // إنشاء طلب شحن
    const reqId = await db.addRechargeRequest(userId, amount, currency);
    ctx.wizard.state.reqId = reqId;
    ctx.wizard.state.amount = amount;

    let instruction = '';
    if (currency === 'USDT') {
      instruction = `يرجى تحويل ${amount} USDT إلى المحفظة:\n\`0x1234567890ABCDEF\` (مثال)\nثم أرسل لقطة شاشة للإيصال هنا.`;
    } else {
      instruction = `يرجى تحويل ${amount} ${currency} إلى الرقم:\n+963 999 999 999\nوأرسل صورة الإيصال هنا.`;
    }
    await ctx.reply(instruction);
    await ctx.reply('📎 أرسل الآن صورة الإيصال (أو اكتب "تخطي" للإرسال بدون إيصال):');
    return ctx.wizard.next();
  },
  // الخطوة 3: استلام الإيصال وإرسال إشعار للأدمن
  async (ctx) => {
    const reqId = ctx.wizard.state.reqId;
    const userId = ctx.from.id;
    const currency = ctx.wizard.state.currency;
    const amount = ctx.wizard.state.amount;

    const adminId = process.env.ADMIN_ID;
    if (!adminId) {
      await ctx.reply('⚠️ خطأ: معرف الأدمن غير مضبوط في المتغيرات.');
      return ctx.scene.leave();
    }

    const caption =
      `📥 طلب شحن جديد:\n` +
      `المستخدم: ${ctx.from.first_name || userId} (ID: ${userId})\n` +
      `المبلغ: ${amount} ${currency}\n` +
      `رقم الطلب: ${reqId}`;

    try {
      if (ctx.message && ctx.message.photo) {
        // المستخدم أرسل صورة إيصال
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const approveMarkup = kb.rechargeApprove(reqId);
        await ctx.telegram.sendPhoto(adminId, fileId, {
          caption,
          reply_markup: approveMarkup.reply_markup
        });
      } else {
        // المستخدم كتب "تخطي" أو أرسل نصاً
        await ctx.telegram.sendMessage(adminId, caption, kb.rechargeApprove(reqId));
      }
    } catch (e) {
      console.error('فشل إرسال إشعار للأدمن:', e.message);
    }

    await ctx.reply('✅ تم إرسال طلب الشحن للمراجعة. سنقوم بإضافة الرصيد بعد التأكيد.', kb.mainMenu());
    return ctx.scene.leave();
  }
);

module.exports = { orderWizard, rechargeWizard };