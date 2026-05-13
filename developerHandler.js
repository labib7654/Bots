// developerHandler.js - لوحة تحكم المطور

const db = require('./database');

const DEVELOPER_ID = parseInt(process.env.DEVELOPER_ID) || 7411444902;

// ─── التحقق من المطور ────────────────────────────────────────
function isDeveloper(userId) {
  return userId === DEVELOPER_ID;
}

// ─── لوحة المطور الرئيسية ────────────────────────────────────
function devPanelKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['👨‍💻 لوحة المطور'],
      ],
      resize_keyboard: true,
    },
  };
}

function devPanelInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        // ── صلاحيات المطور الخاصة ──
        [
          { text: '🤖 معلومات البوت',     callback_data: 'dev_bot_info' },
          { text: '📊 إحصائيات السيرفر',  callback_data: 'dev_server_stats' },
        ],
        [
          { text: '➕ إضافة أدمن',        callback_data: 'dev_add_admin' },
          { text: '➖ حذف أدمن',          callback_data: 'dev_del_admin' },
        ],
        [
          { text: '🔴 إيقاف البوت',       callback_data: 'dev_stop_bot' },
          { text: '🟢 تشغيل البوت',       callback_data: 'dev_start_bot' },
        ],
        [
          { text: '🔧 وضع الصيانة ON/OFF', callback_data: 'dev_toggle_maintenance' },
          { text: '📋 سجلات النظام',      callback_data: 'dev_logs' },
        ],
        // ── صلاحيات الأدمن (نفسها) ──
        [
          { text: '👥 المستخدمين',        callback_data: 'admin_users' },
          { text: '📦 الخدمات',           callback_data: 'admin_services' },
        ],
        [
          { text: '📋 إدارة الطلبات',     callback_data: 'admin_orders' },
          { text: '💰 طلبات الشحن',       callback_data: 'admin_charge_reqs' },
        ],
        [
          { text: '🎟️ الكوبونات',         callback_data: 'admin_coupons' },
          { text: '🔗 المزودون',          callback_data: 'admin_providers' },
        ],
        [
          { text: '📣 إذاعة',             callback_data: 'admin_broadcast' },
          { text: '📝 السجلات',           callback_data: 'admin_logs' },
        ],
        [
          { text: '⚙️ الإعدادات',         callback_data: 'admin_settings' },
        ],
      ],
    },
  };
}

// ─── تسجيل المطور ────────────────────────────────────────────
function register(bot, adminHandler) {
  const devStates = new Map();

  // ── زر لوحة المطور ──
  bot.hears('👨‍💻 لوحة المطور', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return;
    await ctx.replyWithMarkdown(
      `*🛠️ لوحة المطور*\n\n` +
      `👨‍💻 مرحباً، أنت تمتلك صلاحيات كاملة.\n` +
      `🆔 أيدي المطور: \`${DEVELOPER_ID}\`\n\n` +
      `اختر ما تريد:`,
      devPanelInline()
    );
  });

  // ── /dev أمر مباشر ──
  bot.command('dev', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return;
    await ctx.replyWithMarkdown(
      `*🛠️ لوحة المطور*\n\nاختر ما تريد:`,
      devPanelInline()
    );
  });

  // ── معلومات البوت ──
  bot.action('dev_bot_info', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    const me = await bot.telegram.getMe();
    const users = db.getAllUsers ? db.getAllUsers() : [];
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    await ctx.replyWithMarkdown(
      `*🤖 معلومات البوت*\n\n` +
      `📛 الاسم: @${me.username}\n` +
      `🆔 أيدي البوت: \`${me.id}\`\n` +
      `👥 المستخدمين: ${users.length}\n` +
      `⏱️ وقت التشغيل: ${h}h ${m}m ${s}s\n` +
      `🟢 الحالة: يعمل\n` +
      `📅 التاريخ: ${new Date().toLocaleString('ar-SA')}`,
      devPanelInline()
    );
  });

  // ── إحصائيات السيرفر ──
  bot.action('dev_server_stats', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    const mem = process.memoryUsage();
    const toMB = (b) => (b / 1024 / 1024).toFixed(2);
    await ctx.replyWithMarkdown(
      `*📊 إحصائيات السيرفر*\n\n` +
      `🖥️ المنصة: ${process.platform}\n` +
      `📦 Node.js: ${process.version}\n` +
      `🧠 RAM المستخدم: ${toMB(mem.heapUsed)} MB\n` +
      `🧠 RAM الكلي: ${toMB(mem.heapTotal)} MB\n` +
      `💾 RSS: ${toMB(mem.rss)} MB\n` +
      `⚙️ PID: ${process.pid}`,
      devPanelInline()
    );
  });

  // ── إضافة أدمن ──
  bot.action('dev_add_admin', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    devStates.set(ctx.from.id, { step: 'waiting_new_admin_id' });
    await ctx.reply('➕ أرسل أيدي المستخدم الذي تريد تعيينه أدمناً:', {
      reply_markup: { force_reply: true },
    });
  });

  // ── حذف أدمن ──
  bot.action('dev_del_admin', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    devStates.set(ctx.from.id, { step: 'waiting_del_admin_id' });
    await ctx.reply('➖ أرسل أيدي الأدمن الذي تريد حذفه:', {
      reply_markup: { force_reply: true },
    });
  });

  // ── إيقاف البوت ──
  bot.action('dev_stop_bot', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(
      `⚠️ *هل أنت متأكد من إيقاف البوت؟*`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔴 نعم، أوقف البوت', callback_data: 'dev_confirm_stop' },
              { text: '❌ إلغاء',             callback_data: 'dev_cancel_stop' },
            ],
          ],
        },
      }
    );
  });

  bot.action('dev_confirm_stop', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    await ctx.reply('🔴 جاري إيقاف البوت...');
    if (db.addLog) db.addLog(ctx.from.id, 'DEV_STOP_BOT', 'تم إيقاف البوت بواسطة المطور');
    setTimeout(() => process.exit(0), 1500);
  });

  bot.action('dev_cancel_stop', async (ctx) => {
    await ctx.answerCbQuery('✅ تم الإلغاء');
    await ctx.reply('✅ تم إلغاء الإيقاف.', devPanelInline());
  });

  // ── تشغيل البوت (رسالة توضيحية) ──
  bot.action('dev_start_bot', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(
      `🟢 *البوت يعمل حالياً بشكل طبيعي.*\n\nإذا كان البوت متوقفاً، يجب تشغيله من السيرفر مباشرة عبر:\n\`\`\`\nnpm start\n\`\`\``,
      devPanelInline()
    );
  });

  // ── وضع الصيانة ──
  bot.action('dev_toggle_maintenance', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    const config = db.getBotConfig ? db.getBotConfig() : {};
    const current = config.maintenance || false;
    if (db.updateConfig) db.updateConfig('maintenance', !current);
    if (db.addLog) db.addLog(ctx.from.id, 'DEV_MAINTENANCE', !current ? 'تفعيل' : 'تعطيل');
    await ctx.replyWithMarkdown(
      `🔧 *وضع الصيانة:* ${!current ? '✅ تم التفعيل' : '❌ تم التعطيل'}`,
      devPanelInline()
    );
  });

  // ── سجلات النظام ──
  bot.action('dev_logs', async (ctx) => {
    if (!isDeveloper(ctx.from.id)) return ctx.answerCbQuery('🚫 ليس لديك صلاحية.');
    await ctx.answerCbQuery();
    const logs = db.getLogs ? db.getLogs().slice(0, 15) : [];
    if (!logs.length) return ctx.reply('📋 لا توجد سجلات حتى الآن.', devPanelInline());
    let msg = `*📋 آخر سجلات النظام:*\n\n`;
    logs.forEach(l => {
      msg += `• \`${l.action}\` — ${l.detail || ''}\n  🕐 ${new Date(l.at || l.createdAt).toLocaleString('ar-SA')}\n\n`;
    });
    await ctx.replyWithMarkdown(msg, devPanelInline());
  });

  // ── معالجة النصوص الخاصة بالمطور ──
  function handleDevText(ctx, text) {
    const userId = ctx.from.id;
    if (!isDeveloper(userId)) return false;
    const state = devStates.get(userId);
    if (!state) return false;

    // إضافة أدمن
    if (state.step === 'waiting_new_admin_id') {
      const targetId = parseInt(text.trim());
      if (isNaN(targetId)) { ctx.reply('❌ أيدي غير صحيح.'); return true; }
      if (db.setSupervisor) db.setSupervisor(targetId, true);
      if (db.addLog) db.addLog(userId, 'DEV_ADD_ADMIN', `${targetId}`);
      devStates.delete(userId);
      ctx.replyWithMarkdown(`✅ تم تعيين \`${targetId}\` أدمناً بنجاح.`, devPanelInline());
      // إشعار المستخدم
      try { bot.telegram.sendMessage(targetId, `🎉 تم تعيينك أدمناً في البوت بواسطة المطور.`); } catch(e) {}
      return true;
    }

    // حذف أدمن
    if (state.step === 'waiting_del_admin_id') {
      const targetId = parseInt(text.trim());
      if (isNaN(targetId)) { ctx.reply('❌ أيدي غير صحيح.'); return true; }
      if (db.setSupervisor) db.setSupervisor(targetId, false);
      if (db.addLog) db.addLog(userId, 'DEV_DEL_ADMIN', `${targetId}`);
      devStates.delete(userId);
      ctx.replyWithMarkdown(`✅ تم حذف الأدمن \`${targetId}\` بنجاح.`, devPanelInline());
      return true;
    }

    return false;
  }

  return { devStates, handleDevText, isDeveloper };
}

module.exports = { register, isDeveloper, DEVELOPER_ID };
