const { Scenes, Markup } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');

// ============ مشهد تقديم الطلب ============
const orderWizard = new Scenes.WizardScene(
  'order-wizard',
  // الخطوة 1: استلام service_id من callback
  async (ctx) => {
    ctx.wizard.state.serviceId = ctx.match[1]; // تم التقاطه في action
    const service = await db.getServiceById(ctx.wizard.state.serviceId);
    if (!service) {
      await ctx.reply('الخدمة غير موجودة.');
      return ctx.scene.leave();
    }
    await ctx.reply(`📝 أدخل الرابط أو المعرف المطلوب لخدمة *${service.name_ar}*:`, { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  // الخطوة 2: استلام الرابط
  async (ctx) => {
    const link = ctx.message.text.trim();
    const serviceId = ctx.wizard.state.serviceId;
    const userId = ctx.from.id;

    const user = await db.getUser(userId);
    const service = await db.getServiceById(serviceId);

    if (user.balance < service.price) {
      await ctx.reply(`⚠️ رصيدك غير كافٍ. سعر الخدمة ${service.price}$ ورصيدك ${user.balance}$.\nيرجى شحن رصيدك أولاً.`);
      return ctx.scene.leave();
    }

    // خصم الرصيد وإنشاء الطلب
    await db.updateBalance(userId, -service.price);
    const orderId = await db.createOrder(userId, service.id, service.name_ar, link, service.price);

    // معالجة مكافأة الإحالة إذا كانت أول طلب
    const orderCount = (await db.getOrdersByUser(userId)).length;
    if (orderCount === 1 && user.referrer_id) {
      const bonus = service.price * 0.1;
      await db.updateBalance(user.referrer_id, bonus);
      // إشعار المحيل (اختياري)
      try {
        await ctx.telegram.sendMessage(user.referrer_id,
          `🎉 مبروك! حصلت على مكافأة إحالة بقيمة ${bonus}$ من طلب المستخدم ${user.first_name || user.username || userId}`
        );
      } catch (e) { /* لا شيء */ }
    }

    await ctx.reply(`✅ تم إنشاء طلبك بنجاح!\nالخدمة: ${service.name_ar}\nالرابط: ${link}\nالسعر: ${service.price}$\nالحالة: قيد التنفيذ\nرقم الطلب: ${orderId}`, kb.mainMenu());
    // تسجيل النشاط
    ctx.scene.leave();
  }
);

// ============ مشهد الشحن ============
const rechargeWizard = new Scenes.WizardScene(
  'recharge-wizard',
  // خطوة 1: اختيار العملة (قادم من callback)
  async (ctx) => {
    // تم اختيار العملة من callback سابقاً ووصلت إلى هنا
    // نستقبل العملة من state
    const currency = ctx.wizard.state.currency;
    await ctx.reply(`💱 اخترت ${currency}. الآن أدخل المبلغ الذي ترغب في شحنه:`);
    return ctx.wizard.next();
  },
  // خطوة 2: استلام المبلغ
  async (ctx) => {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('يرجى إدخال مبلغ صحيح.');
      return;
    }
    const currency = ctx.wizard.state.currency;
    const userId = ctx.from.id;
    
    // إنشاء طلب شحن
    const reqId = await db.addRechargeRequest(userId, amount, currency);
    ctx.wizard.state.reqId = reqId;

    // تعليمات حسب العملة
    let instruction = '';
    if (currency === 'USDT') {
      instruction = `يرجى تحويل ${amount} USDT إلى المحفظة التالية:\n\`0x1234567890ABCDEF\` (عنوان تجريبي)\nثم أرسل لقطة شاشة للإيصال هنا.`;
    } else {
      instruction = `يرجى تحويل ${amount} ${currency} إلى الرقم التالي:\n+963 999 999 999\nوأرسل صورة الإيصال هنا.`;
    }
    await ctx.reply(instruction);
    await ctx.reply('📎 أرسل الآن صورة الإيصال (أو اكتب "تخطي" لإرسال الطلب بدون إيصال):');
    return ctx.wizard.next();
  },
  // خطوة 3: استلام الإيصال (صورة أو نص)
  async (ctx) => {
    const reqId = ctx.wizard.state.reqId;
    const userId = ctx.from.id;
    let receiptMsgId = null;
    if (ctx.message.photo) {
      // حفظ معرف الرسالة التي تحتوي الصورة
      receiptMsgId = ctx.message.message_id;
    } else if (ctx.message.text && ctx.message.text !== 'تخطي') {
      receiptMsgId = ctx.message.message_id; // حتى لو نص
    }
    // تحديث الطلب بمعرف الإيصال (اختياري)
    // يمكن إرسال إشعار للأدمن
    const adminId = process.env.ADMIN_ID;
    try {
      await ctx.telegram.sendMessage(adminId,
        `📥 طلب شحن جديد:\nالمستخدم: ${ctx.from.first_name} (${userId})\nالمبلغ: ${ctx.wizard.state.currency} ${ctx.message.text || '?'}\nرقم الطلب: ${reqId}`,
        kb.rechargeApprove(reqId)
      );
    } catch (e) { console.log(e); }
    await ctx.reply('✅ تم إرسال طلب الشحن للمراجعة. سنقوم بإضافة الرصيد بعد التأكيد.', kb.mainMenu());
    return ctx.scene.leave();
  }
);

module.exports = { orderWizard, rechargeWizard };