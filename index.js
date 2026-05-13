// index.js - الملف الرئيسي

require('dotenv').config();
const { Telegraf } = require('telegraf');
const express      = require('express');
const db           = require('./database');
const kb           = require('./keyboards');
const userHandler  = require('./userHandler');
const adminHandler = require('./adminHandler');
const devHandler   = require('./developerHandler');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const ADMIN_ID     = parseInt(process.env.ADMIN_ID);
const DEVELOPER_ID = parseInt(process.env.DEVELOPER_ID) || 7411444902;
const PORT         = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN مش موجود في .env'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ─── لوج + حظر ────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const u = ctx.from;
  if (u && db.isBanned(u.id)) {
    return ctx.reply('🚫 أنت محظور من استخدام هذا البوت.');
  }
  const t = ctx.message?.text || ctx.callbackQuery?.data || '—';
  console.log(`[${new Date().toLocaleTimeString()}] ${u?.first_name}(${u?.id}) | ${t}`);
  await next();
});

// ─── /start ───────────────────────────────────────────────────
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  // المطور يحصل على لوحة المطور
  if (userId === DEVELOPER_ID) {
    db.getOrCreateUser && db.getOrCreateUser(userId, ctx.from.username, ctx.from.first_name);
    return ctx.replyWithMarkdown(
      `*🛠️ مرحباً بك أيها المطور!*\n\n` +
      `👨‍💻 لديك صلاحيات كاملة على البوت.\n` +
      `🆔 أيدك: \`${userId}\`\n\n` +
      `اضغط الزر أدناه للوصول إلى لوحة التحكم:`,
      {
        reply_markup: {
          keyboard: [['👨‍💻 لوحة المطور'], ['🏠 الرئيسية']],
          resize_keyboard: true,
        },
      }
    );
  }

  // الأدمن يحصل على لوحة الأدمن
  if (userId === ADMIN_ID) {
    const { adminPanelKeyboard } = require('./adminHandler');
    return ctx.replyWithMarkdown(
      `*👑 مرحباً بك أيها الأدمن!*`,
      adminPanelKeyboard()
    );
  }

  // المستخدم العادي
  db.getOrCreateUser && db.getOrCreateUser(userId, ctx.from.username, ctx.from.first_name);
  const config = db.getBotConfig ? db.getBotConfig() : {};
  const welcomeMsg = config.welcomeMsg || `أهلاً بك في بوت Follow Zone! 🎉`;
  const user = db.getUser ? db.getUser(userId) : { balance: 0 };
  await ctx.replyWithMarkdown(
    `${welcomeMsg}\n\n💰 رصيدك الحالي: \`${user?.balance || 0}$\``,
    kb.userMain
  );
});

// ─── تسجيل الهاندلرز ─────────────────────────────────────────
const userStates  = userHandler.register(bot);
const adminStates = adminHandler.register(bot);
const { devStates, handleDevText, isDeveloper } = devHandler.register(bot, adminHandler);

// ─── معالجة الرسائل النصية ────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text   = ctx.message.text;

  // ══ حالات المطور (تُعالج أولاً) ══════════════════════════
  if (isDeveloper(userId)) {
    // حالات المطور الخاصة
    const handled = handleDevText(ctx, text);
    if (handled) return;

    // حالات الأدمن (المطور يملكها أيضاً)
    const aState = adminStates.get(userId);
    const { adminPanelKeyboard } = require('./adminHandler');

    if (aState) {
      const step = aState.step;

      if (step === 'waiting_user_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح، أرسل رقم.');
        adminStates.set(userId, { step: 'waiting_amount', targetUserId: targetId });
        return ctx.replyWithMarkdown(`💰 أرسل المبلغ للمستخدم \`${targetId}\`:`, { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_amount') {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) return ctx.reply('❌ مبلغ غير صحيح.');
        const targetUser = db.addBalance(aState.targetUserId, amount);
        adminStates.delete(userId);
        if (!targetUser) return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.', adminPanelKeyboard());
        db.addLog(userId, 'MANUAL_CHARGE', `${aState.targetUserId} — ${amount}$`);
        await ctx.replyWithMarkdown(
          `✅ *تم شحن الرصيد!*\n🆔 ${aState.targetUserId}\n💰 المبلغ: ${amount}$\n💳 الرصيد الجديد: ${targetUser.balance}$`,
          adminPanelKeyboard()
        );
        try { await bot.telegram.sendMessage(aState.targetUserId, `✅ *تم شحن رصيدك!*\n💰 المبلغ: \`${amount}$\`\n💳 رصيدك الآن: \`${targetUser.balance}$\``, { parse_mode: 'Markdown' }); } catch (e) {}
        return;
      }

      if (step === 'waiting_broadcast') {
        const allUsers = db.getAllUsers();
        adminStates.delete(userId);
        let sent = 0, failed = 0;
        await ctx.reply(`📣 جاري الإرسال لـ ${allUsers.length} مستخدم...`);
        for (const u of allUsers) {
          try { await bot.telegram.sendMessage(u.id, text, { parse_mode: 'Markdown' }); sent++; } catch (e) { failed++; }
          await new Promise(r => setTimeout(r, 50));
        }
        db.addLog(userId, 'BROADCAST', `أُرسل: ${sent} | فشل: ${failed}`);
        return ctx.replyWithMarkdown(`✅ *تمت الإذاعة!*\n✅ أُرسل: ${sent}\n❌ فشل: ${failed}`, adminPanelKeyboard());
      }

      if (step === 'waiting_supervisor_id_add') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setSupervisor(targetId, true);
        adminStates.delete(userId);
        db.addLog(userId, 'SUPERVISOR_ADD', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم تعيين \`${targetId}\` مشرفاً.`, adminPanelKeyboard());
      }

      if (step === 'waiting_supervisor_id_del') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setSupervisor(targetId, false);
        adminStates.delete(userId);
        db.addLog(userId, 'SUPERVISOR_DEL', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم إزالة المشرف \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_ban_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setBanned(targetId, true);
        adminStates.delete(userId);
        db.addLog(userId, 'BAN', `${targetId}`);
        return ctx.replyWithMarkdown(`🚫 تم حظر المستخدم \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_unban_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setBanned(targetId, false);
        adminStates.delete(userId);
        db.addLog(userId, 'UNBAN', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم رفع حظر المستخدم \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_coupon_code') {
        adminStates.set(userId, { step: 'waiting_coupon_discount', code: text.trim().toUpperCase() });
        return ctx.reply(`🎟️ أرسل نسبة الخصم (مثل: 20 تعني 20%):`, { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_coupon_discount') {
        const disc = parseFloat(text.trim());
        if (isNaN(disc) || disc <= 0 || disc > 100) return ctx.reply('❌ نسبة غير صحيحة (1-100).');
        adminStates.set(userId, { ...aState, step: 'waiting_coupon_maxuses', discount: disc });
        return ctx.reply('🎟️ أرسل الحد الأقصى للاستخدامات (0 = غير محدود):', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_coupon_maxuses') {
        const maxUses = parseInt(text.trim());
        if (isNaN(maxUses) || maxUses < 0) return ctx.reply('❌ رقم غير صحيح.');
        db.addCoupon(aState.code, aState.discount, maxUses);
        adminStates.delete(userId);
        db.addLog(userId, 'COUPON_ADD', `${aState.code} — ${aState.discount}%`);
        return ctx.replyWithMarkdown(
          `✅ *تم إنشاء الكوبون!*\n🎟️ الكود: \`${aState.code}\`\nالخصم: ${aState.discount}%\nالاستخدامات: ${maxUses === 0 ? '∞' : maxUses}`,
          adminPanelKeyboard()
        );
      }

      if (step === 'waiting_coupon_del') {
        const code = text.trim().toUpperCase();
        const ok   = db.deleteCoupon(code);
        adminStates.delete(userId);
        db.addLog(userId, 'COUPON_DEL', code);
        return ctx.reply(ok ? `✅ تم حذف الكوبون ${code}.` : `❌ الكوبون ${code} غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_coupon_toggle') {
        const code = text.trim().toUpperCase();
        const c    = db.toggleCoupon(code);
        adminStates.delete(userId);
        return ctx.reply(c ? `✅ الكوبون ${code} الآن: ${c.enabled ? 'نشط' : 'معطّل'}.` : `❌ الكوبون ${code} غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_provider_name') {
        adminStates.set(userId, { step: 'waiting_provider_url', name: text.trim() });
        return ctx.reply('🌐 أرسل رابط API المزود:', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_provider_url') {
        adminStates.set(userId, { ...aState, step: 'waiting_provider_key', apiUrl: text.trim() });
        return ctx.reply('🔑 أرسل مفتاح API:', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_provider_key') {
        db.addProvider(aState.name, aState.apiUrl, text.trim());
        adminStates.delete(userId);
        db.addLog(userId, 'PROVIDER_ADD', aState.name);
        return ctx.replyWithMarkdown(`✅ تم إضافة المزود *${aState.name}*.`, adminPanelKeyboard());
      }

      if (step === 'waiting_provider_del') {
        const ok = db.deleteProvider(text.trim());
        adminStates.delete(userId);
        return ctx.reply(ok ? `✅ تم حذف المزود.` : `❌ المزود غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_welcome_msg') {
        db.updateConfig('welcomeMsg', text.trim());
        adminStates.delete(userId);
        return ctx.reply(`✅ تم تحديث رسالة الترحيب.`, adminPanelKeyboard());
      }

      if (step === 'waiting_minorder') {
        const val = parseFloat(text.trim());
        if (isNaN(val) || val < 0) return ctx.reply('❌ قيمة غير صحيحة.');
        db.updateConfig('minOrder', val);
        adminStates.delete(userId);
        return ctx.reply(`✅ تم تحديث الحد الأدنى للطلب: ${val}$`, adminPanelKeyboard());
      }

      if (step === 'waiting_search_orders_user') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        const orders = db.getUserOrders(targetId);
        adminStates.delete(userId);
        if (!orders.length) return ctx.reply(`لا يوجد طلبات للمستخدم ${targetId}.`, adminPanelKeyboard());
        const statusIcon = { pending: '⏳', doing: '🔄', delivered: '✅', cancelled: '❌' };
        let msg = `📋 *طلبات المستخدم \`${targetId}\` (${orders.length})*\n\n`;
        orders.slice(0, 10).forEach(o => {
          msg += `\`#${o.id}\` ${statusIcon[o.status] || '•'} ${o.serviceName}\n💰 ${o.price}$ | 🔗 ${o.link}\n\n`;
        });
        return ctx.replyWithMarkdown(msg, adminPanelKeyboard());
      }
    }
  }

  // ══ حالات الأدمن العادي ════════════════════════════════════
  if (userId === ADMIN_ID) {
    const aState = adminStates.get(userId);
    const { adminPanelKeyboard } = require('./adminHandler');

    if (aState) {
      const step = aState.step;

      if (step === 'waiting_user_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح، أرسل رقم.');
        adminStates.set(userId, { step: 'waiting_amount', targetUserId: targetId });
        return ctx.replyWithMarkdown(`💰 أرسل المبلغ للمستخدم \`${targetId}\`:`, { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_amount') {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) return ctx.reply('❌ مبلغ غير صحيح.');
        const targetUser = db.addBalance(aState.targetUserId, amount);
        adminStates.delete(userId);
        if (!targetUser) return ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.', adminPanelKeyboard());
        db.addLog(userId, 'MANUAL_CHARGE', `${aState.targetUserId} — ${amount}$`);
        await ctx.replyWithMarkdown(
          `✅ *تم شحن الرصيد!*\n🆔 ${aState.targetUserId}\n💰 المبلغ: ${amount}$\n💳 الرصيد الجديد: ${targetUser.balance}$`,
          adminPanelKeyboard()
        );
        try { await bot.telegram.sendMessage(aState.targetUserId, `✅ *تم شحن رصيدك!*\n💰 المبلغ: \`${amount}$\`\n💳 رصيدك الآن: \`${targetUser.balance}$\``, { parse_mode: 'Markdown' }); } catch (e) {}
        return;
      }

      if (step === 'waiting_broadcast') {
        const allUsers = db.getAllUsers();
        adminStates.delete(userId);
        let sent = 0, failed = 0;
        await ctx.reply(`📣 جاري الإرسال لـ ${allUsers.length} مستخدم...`);
        for (const u of allUsers) {
          try { await bot.telegram.sendMessage(u.id, text, { parse_mode: 'Markdown' }); sent++; } catch (e) { failed++; }
          await new Promise(r => setTimeout(r, 50));
        }
        db.addLog(userId, 'BROADCAST', `أُرسل: ${sent} | فشل: ${failed}`);
        return ctx.replyWithMarkdown(`✅ *تمت الإذاعة!*\n✅ أُرسل: ${sent}\n❌ فشل: ${failed}`, adminPanelKeyboard());
      }

      if (step === 'waiting_supervisor_id_add') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setSupervisor(targetId, true);
        adminStates.delete(userId);
        db.addLog(userId, 'SUPERVISOR_ADD', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم تعيين \`${targetId}\` مشرفاً.`, adminPanelKeyboard());
      }

      if (step === 'waiting_supervisor_id_del') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setSupervisor(targetId, false);
        adminStates.delete(userId);
        db.addLog(userId, 'SUPERVISOR_DEL', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم إزالة المشرف \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_ban_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setBanned(targetId, true);
        adminStates.delete(userId);
        db.addLog(userId, 'BAN', `${targetId}`);
        return ctx.replyWithMarkdown(`🚫 تم حظر المستخدم \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_unban_id') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        db.setBanned(targetId, false);
        adminStates.delete(userId);
        db.addLog(userId, 'UNBAN', `${targetId}`);
        return ctx.replyWithMarkdown(`✅ تم رفع حظر المستخدم \`${targetId}\`.`, adminPanelKeyboard());
      }

      if (step === 'waiting_coupon_code') {
        adminStates.set(userId, { step: 'waiting_coupon_discount', code: text.trim().toUpperCase() });
        return ctx.reply(`🎟️ أرسل نسبة الخصم (مثل: 20 تعني 20%):`, { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_coupon_discount') {
        const disc = parseFloat(text.trim());
        if (isNaN(disc) || disc <= 0 || disc > 100) return ctx.reply('❌ نسبة غير صحيحة (1-100).');
        adminStates.set(userId, { ...aState, step: 'waiting_coupon_maxuses', discount: disc });
        return ctx.reply('🎟️ أرسل الحد الأقصى للاستخدامات (0 = غير محدود):', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_coupon_maxuses') {
        const maxUses = parseInt(text.trim());
        if (isNaN(maxUses) || maxUses < 0) return ctx.reply('❌ رقم غير صحيح.');
        db.addCoupon(aState.code, aState.discount, maxUses);
        adminStates.delete(userId);
        db.addLog(userId, 'COUPON_ADD', `${aState.code} — ${aState.discount}%`);
        return ctx.replyWithMarkdown(
          `✅ *تم إنشاء الكوبون!*\n🎟️ الكود: \`${aState.code}\`\nالخصم: ${aState.discount}%\nالاستخدامات: ${maxUses === 0 ? '∞' : maxUses}`,
          adminPanelKeyboard()
        );
      }

      if (step === 'waiting_coupon_del') {
        const code = text.trim().toUpperCase();
        const ok   = db.deleteCoupon(code);
        adminStates.delete(userId);
        db.addLog(userId, 'COUPON_DEL', code);
        return ctx.reply(ok ? `✅ تم حذف الكوبون ${code}.` : `❌ الكوبون ${code} غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_coupon_toggle') {
        const code = text.trim().toUpperCase();
        const c    = db.toggleCoupon(code);
        adminStates.delete(userId);
        return ctx.reply(c ? `✅ الكوبون ${code} الآن: ${c.enabled ? 'نشط' : 'معطّل'}.` : `❌ الكوبون ${code} غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_provider_name') {
        adminStates.set(userId, { step: 'waiting_provider_url', name: text.trim() });
        return ctx.reply('🌐 أرسل رابط API المزود:', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_provider_url') {
        adminStates.set(userId, { ...aState, step: 'waiting_provider_key', apiUrl: text.trim() });
        return ctx.reply('🔑 أرسل مفتاح API:', { reply_markup: { force_reply: true } });
      }

      if (step === 'waiting_provider_key') {
        db.addProvider(aState.name, aState.apiUrl, text.trim());
        adminStates.delete(userId);
        db.addLog(userId, 'PROVIDER_ADD', aState.name);
        return ctx.replyWithMarkdown(`✅ تم إضافة المزود *${aState.name}*.`, adminPanelKeyboard());
      }

      if (step === 'waiting_provider_del') {
        const ok = db.deleteProvider(text.trim());
        adminStates.delete(userId);
        return ctx.reply(ok ? `✅ تم حذف المزود.` : `❌ المزود غير موجود.`, adminPanelKeyboard());
      }

      if (step === 'waiting_welcome_msg') {
        db.updateConfig('welcomeMsg', text.trim());
        adminStates.delete(userId);
        return ctx.reply(`✅ تم تحديث رسالة الترحيب.`, adminPanelKeyboard());
      }

      if (step === 'waiting_minorder') {
        const val = parseFloat(text.trim());
        if (isNaN(val) || val < 0) return ctx.reply('❌ قيمة غير صحيحة.');
        db.updateConfig('minOrder', val);
        adminStates.delete(userId);
        return ctx.reply(`✅ تم تحديث الحد الأدنى للطلب: ${val}$`, adminPanelKeyboard());
      }

      if (step === 'waiting_search_orders_user') {
        const targetId = parseInt(text.trim());
        if (isNaN(targetId)) return ctx.reply('❌ أيدي غير صحيح.');
        const orders = db.getUserOrders(targetId);
        adminStates.delete(userId);
        if (!orders.length) return ctx.reply(`لا يوجد طلبات للمستخدم ${targetId}.`, adminPanelKeyboard());
        const statusIcon = { pending: '⏳', doing: '🔄', delivered: '✅', cancelled: '❌' };
        let msg = `📋 *طلبات المستخدم \`${targetId}\` (${orders.length})*\n\n`;
        orders.slice(0, 10).forEach(o => {
          msg += `\`#${o.id}\` ${statusIcon[o.status] || '•'} ${o.serviceName}\n💰 ${o.price}$ | 🔗 ${o.link}\n\n`;
        });
        return ctx.replyWithMarkdown(msg, adminPanelKeyboard());
      }
    }
  }

  // ══ حالات المستخدم (انتظار الرابط) ══════════════════════
  const uState = userStates.get(userId);
  if (uState?.step === 'waiting_link') {
    const link = text.trim();
    uState.link = link;
    const user = db.getUser(userId);

    if (db.getBotConfig().maintenance) {
      return ctx.reply('🔧 البوت في وضع الصيانة مؤقتاً. حاول لاحقاً.');
    }

    if (user.balance < uState.price) {
      userStates.delete(userId);
      return ctx.replyWithMarkdown(
        `❌ *رصيدك غير كافٍ!*\n💰 رصيدك: \`${user.balance}$\`\n💳 السعر: \`${uState.price}$\`\n\nاشحن رصيدك أولاً.`,
        kb.userMain
      );
    }

    await ctx.replyWithMarkdown(
      `📝 *تأكيد الطلب:*\n\n📌 ${uState.serviceName}\n🔗 ${link}\n💰 السعر: \`${uState.price}$\`\n💳 رصيدك: \`${user.balance}$\`\n\nهل تريد تأكيد الطلب؟`,
      kb.confirmOrderKeyboard(uState.serviceId)
    );
    return;
  }

  // ── رسالة افتراضية ──
  await ctx.reply('اختر من القائمة أدناه 👇', kb.userMain);
});

// ─── Express ──────────────────────────────────────────────────
const app = express();
app.get('/',       (_, res) => res.json({ status: '✅ يعمل', time: new Date().toISOString() }));
app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(PORT, () => console.log(`🌐 سيرفر على البورت ${PORT}`));

// ─── تشغيل ────────────────────────────────────────────────────
bot.launch().then(async () => {
  const me = await bot.telegram.getMe();
  console.log(`🤖 البوت يعمل: @${me.username}`);
  console.log(`👑 الأدمن ID: ${ADMIN_ID}`);
  console.log(`👨‍💻 المطور ID: ${DEVELOPER_ID}`);

  // إشعار المطور عند تشغيل البوت
  try {
    await bot.telegram.sendMessage(
      DEVELOPER_ID,
      `🟢 *البوت تم تشغيله بنجاح!*\n⏱️ ${new Date().toLocaleString('ar-SA')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {}

}).catch(err => {
  console.error('❌ خطأ في التشغيل:', err.message);
  process.exit(1);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
