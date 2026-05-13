// products.js - قاعدة بيانات المنتجات (عدّلها حسب رغبتك)

const products = [
  {
    id: 1,
    name: '🎬 اشتراك Netflix شهري',
    description: 'اشتراك نتفليكس HD لمدة شهر\n✅ يعمل على جميع الأجهزة\n✅ جودة HD\n✅ دعم فوري',
    price: 15,
    currency: 'دولار',
    emoji: '🎬',
    category: 'اشتراكات',
    available: true,
  },
  {
    id: 2,
    name: '🎮 بطاقة Steam 10$',
    description: 'بطاقة ستيم بقيمة 10 دولار\n✅ رمز فوري\n✅ تعمل عالمياً\n✅ صالحة للأبد',
    price: 12,
    currency: 'دولار',
    emoji: '🎮',
    category: 'ألعاب',
    available: true,
  },
  {
    id: 3,
    name: '🎵 اشتراك Spotify شهري',
    description: 'سبوتيفاي بريميوم لشهر\n✅ بدون إعلانات\n✅ تحميل غير محدود\n✅ جودة عالية',
    price: 10,
    currency: 'دولار',
    emoji: '🎵',
    category: 'اشتراكات',
    available: true,
  },
  {
    id: 4,
    name: '🔒 VPN Premium سنوي',
    description: 'VPN مميز لسنة كاملة\n✅ سرعة عالية\n✅ 50+ دولة\n✅ حماية كاملة',
    price: 25,
    currency: 'دولار',
    emoji: '🔒',
    category: 'برامج',
    available: true,
  },
  {
    id: 5,
    name: '📱 بطاقة Google Play 5$',
    description: 'جوجل بلاي 5 دولار\n✅ رمز فوري\n✅ لجميع الحسابات',
    price: 6,
    currency: 'دولار',
    emoji: '📱',
    category: 'ألعاب',
    available: false,
  },
];

module.exports = products;
