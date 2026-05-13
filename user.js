const { Scenes, Markup } = require('telegraf');
const db = require('./database');
const kb = require('./keyboards');

const orderWizard = new Scenes.WizardScene(
  'order-wizard',
  async (ctx) => {
    // استلام serviceId من scene state وليس من match
    ctx.wizard.state.serviceId = ctx.scene.state.serviceId;
    const service = await db.getServiceById(ctx.wizard.state.serviceId);
    if (!service) {
      await ctx.reply('الخدمة غير موجودة.');
      return ctx.scene.leave();
    }
    await ctx.reply(`📝 أدخل الرابط أو المعرف المطلوب لخدمة *${service.name_ar}*:`, { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
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

    await db.updateBalance(userId, -service.price);
    const orderId = await db.createOrder(userId, service.id, service.name_ar, link, service.price);

    const orderCount = (await db.getOrdersByUser(userId)).length;
    if (orderCount === 1 && user.referrer_id) {
      const bonus = service.price * 0.1;
      await db.updateBalance(user.referrer_id, bonus);
      try {
        await ctx.telegram.sendMessage(user.referrer_id,
          `🎉 مبروك! حصلت على مكافأة إحالة بقيمة ${bonus}$ من طلب المستخدم ${user.first_name || userId}`
        );
      } catch (e) { /* ignore */ }
    }

    await ctx.reply(
      `✅ تم إنشاء طلبك بنجاح!\nالخدمة: ${service.name_ar}\nالرابط: ${link}\nالسعر: ${service.price}$\nالحالة: قيد التنفيذ\nرقم الطلب: ${orderId}`,
      kb.mainMenu()
    );
    return ctx.scene.leave();
  }
);

const rechargeWizard = new Scenes.WizardScene(
  'recharge-wizard',
  async (ctx) => {
    // نقل العملة من scene.state إلى wizard.state
    ctx.wizard.state.currency = ctx.scene.state.currency;
    const currency = ctx.wizard.state.currency;
    await ctx.reply(`💱 اخترت ${currency}. الآن أدخل المبلغ الذي ترغب في شحنه:`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('يرجى إدخال مبلغ صحيح.');
      return;
    }
    const currency = ctx.wizard.state.currency;
    const userId = ctx.from.id;

    const reqId = await db.addRechargeRequest(userId, amount, currency);
    ctx.wizard.state.reqId = reqId;

    let instruction = '';
    if (currency === 'USDT') {
      instruction = `يرجى تحويل ${amount} USDT إلى المحفظة:\n\`0x1234567890ABCDEF\`\nثم أرسل لقطة شاشة للإيصال هنا.`;
    } else {
      instruction = `يرجى تحويل ${amount} ${currency} إلى الرقم:\n+963 999 999 999\nوأرسل صورة الإيصال هنا.`;
    }
    await ctx.reply(instruction);
    await ctx.reply('📎 أرسل الآن صورة الإيصال (أو اكتب "تخطي" للإرسال بدون إيصال):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reqId = ctx.wizard.state.reqId;
    const userId = ctx.from.id;
    const adminId = process.env.ADMIN_ID;

    try {
      await ctx.telegram.sendMessage(adminId,
        `📥 طلب شحن جديد:\nالمستخدم: ${ctx.from.first_name} (${userId})\nالمبلغ: ${ctx.wizard.state.currency} ${ctx.wizard.state.reqId}\nرقم الطلب: ${reqId}`,
        kb.rechargeApprove(reqId)
      );
    } catch (e) { console.log(e); }

    await ctx.reply('✅ تم إرسال طلب الشحن للمراجعة. سنقوم بإضافة الرصيد بعد التأكيد.', kb.mainMenu());
    return ctx.scene.leave();
  }
);

module.exports = { orderWizard, rechargeWizard };