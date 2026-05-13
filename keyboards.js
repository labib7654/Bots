const { Markup } = require('telegraf');

function mainMenu(isAdmin = false) {
  const buttons = [
    [Markup.button.callback('🛒 الخدمات', 'services')],
    [Markup.button.callback('📋 طلباتي', 'myorders'), Markup.button.callback('💰 شحن الرصيد', 'recharge')],
    [Markup.button.callback('👤 حسابي', 'account'), Markup.button.callback('🔗 الإحالات', 'referral')],
  ];
  if (isAdmin) buttons.push([Markup.button.callback('⚙️ لوحة الإدارة', 'admin_panel')]);
  return Markup.inlineKeyboard(buttons);
}

function categoriesMenu(categories) {
  const buttons = categories.map(cat => [Markup.button.callback(cat, `category_${cat}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع للقائمة', 'back_main')]);
  return Markup.inlineKeyboard(buttons);
}

function servicesMenu(services) {
  const buttons = services.map(s => [
    Markup.button.callback(`${s.name_ar} - ${s.price}$`, `service_${s.id}`)
  ]);
  buttons.push([Markup.button.callback('🔙 رجوع للفئات', 'back_categories')]);
  return Markup.inlineKeyboard(buttons);
}

function currencyMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💵 USD', 'recharge_USD')],
    [Markup.button.callback('💷 SYP', 'recharge_SYP')],
    [Markup.button.callback('₮ USDT', 'recharge_USDT')],
    [Markup.button.callback('🔙 رجوع', 'back_main')],
  ]);
}

function adminPanel() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة خدمة', 'admin_add_service')],
    [Markup.button.callback('🔄 تفعيل/تعطيل خدمة', 'admin_toggle_service')],
    [Markup.button.callback('📦 قائمة الطلبات', 'admin_orders')],
    [Markup.button.callback('💸 إضافة رصيد لمستخدم', 'admin_add_balance')],
    [Markup.button.callback('📊 إحصائيات', 'admin_stats')],
    [Markup.button.callback('📢 إرسال إشعار جماعي', 'admin_broadcast')],
    [Markup.button.callback('📜 سجل العمليات', 'admin_log')],
    [Markup.button.callback('🔙 رجوع', 'back_main')],
  ]);
}

function rechargeApprove(requestId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ قبول', `approve_recharge_${requestId}`),
     Markup.button.callback('❌ رفض', `reject_recharge_${requestId}`)]
  ]);
}

module.exports = {
  mainMenu,
  categoriesMenu,
  servicesMenu,
  currencyMenu,
  adminPanel,
  rechargeApprove,
};