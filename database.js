const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// استخدام /tmp لتجنب ضياع البيانات على Render
const dbPath = path.resolve('/tmp', 'followzone.db');
const db = new sqlite3.Database(dbPath);

// ========== تهيئة الجداول ==========
function initDB() {
  db.serialize(() => {
    // المستخدمين
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      referrer_id INTEGER,
      join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_verified INTEGER DEFAULT 0
    )`);

    // الطلبات
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      service_id INTEGER,
      service_name TEXT,
      link TEXT,
      price REAL,
      status TEXT DEFAULT 'قيد التنفيذ',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // الخدمات
    db.run(`CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT,
      name_en TEXT,
      parent_category TEXT,
      price REAL,
      is_active INTEGER DEFAULT 1
    )`);

    // طلبات الشحن
    db.run(`CREATE TABLE IF NOT EXISTS recharge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount REAL,
      currency TEXT,
      status TEXT DEFAULT 'معلق',
      receipt_message_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // سجل العمليات
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // إدراج خدمات افتراضية إن كانت الجداول فارغة
    db.get(`SELECT COUNT(*) as count FROM services`, (err, row) => {
      if (err || row.count > 0) return;
      const defaultServices = [
        { name_ar: 'متابعين انستقرام', name_en: 'Instagram Followers', parent: 'انستقرام', price: 5 },
        { name_ar: 'لايكات انستقرام', name_en: 'Instagram Likes', parent: 'انستقرام', price: 3 },
        { name_ar: 'مشاهدات انستقرام', name_en: 'Instagram Views', parent: 'انستقرام', price: 2 },
        { name_ar: 'متابعين تيك توك', name_en: 'TikTok Followers', parent: 'تيك توك', price: 6 },
        { name_ar: 'لايكات تيك توك', name_en: 'TikTok Likes', parent: 'تيك توك', price: 4 },
        { name_ar: 'مشاهدات تيك توك', name_en: 'TikTok Views', parent: 'تيك توك', price: 2.5 },
        { name_ar: 'متابعين فيسبوك', name_en: 'Facebook Followers', parent: 'فيسبوك', price: 4 },
        { name_ar: 'لايكات فيسبوك', name_en: 'Facebook Likes', parent: 'فيسبوك', price: 2 },
        { name_ar: 'مشتركين تيليجرام', name_en: 'Telegram Members', parent: 'تيليجرام', price: 7 },
        { name_ar: 'مشاهدات تيليجرام', name_en: 'Telegram Views', parent: 'تيليجرام', price: 3 },
        { name_ar: 'اشتراك شات جي بي تي', name_en: 'ChatGPT Subscription', parent: 'ChatGPT', price: 15 },
        { name_ar: 'اشتراك تيليجرام بريميوم', name_en: 'Telegram Premium', parent: 'Telegram Premium', price: 20 }
      ];
      const stmt = db.prepare(`INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)`);
      defaultServices.forEach(s => stmt.run(s.name_ar, s.name_en, s.parent, s.price));
      stmt.finalize();
    });
  });
}

// ========== دوال المستخدمين ==========
function getUser(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => err ? reject(err) : resolve(row));
  });
}

function addUser(id, username, first_name, referrer_id = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO users (id, username, first_name, referrer_id) VALUES (?, ?, ?, ?)`,
      [id, username, first_name, referrer_id],
      function (err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

function updateBalance(id, amount) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, id], (err) => err ? reject(err) : resolve());
  });
}

function setVerified(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET is_verified = 1 WHERE id = ?`, [id], (err) => err ? reject(err) : resolve());
  });
}

function getUsersCount() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => err ? reject(err) : resolve(row.count));
  });
}

function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id FROM users`, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

// ========== دوال الخدمات ==========
function getAllServices() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM services`, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function getServicesByCategory(category) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM services WHERE parent_category = ? AND is_active = 1`, [category], (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function getServiceById(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM services WHERE id = ?`, [id], (err, row) => err ? reject(err) : resolve(row));
  });
}

function addService(name_ar, name_en, parent_category, price) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)`,
      [name_ar, name_en, parent_category, price],
      function (err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

function toggleServiceActive(id, active) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE services SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id], (err) => err ? reject(err) : resolve());
  });
}

// ========== دوال الطلبات ==========
function createOrder(user_id, service_id, service_name, link, price) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO orders (user_id, service_id, service_name, link, price) VALUES (?, ?, ?, ?, ?)`,
      [user_id, service_id, service_name, link, price],
      function (err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

function getOrdersByUser(user_id) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, [user_id], (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function getAllOrders() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function updateOrderStatus(order_id, status) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, order_id], (err) => err ? reject(err) : resolve());
  });
}

function getOrderById(order_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM orders WHERE id = ?`, [order_id], (err, row) => err ? reject(err) : resolve(row));
  });
}

// ========== دوال الشحن ==========
function addRechargeRequest(user_id, amount, currency) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO recharge_requests (user_id, amount, currency) VALUES (?, ?, ?)`,
      [user_id, amount, currency],
      function (err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

function getRechargeById(request_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM recharge_requests WHERE id = ?`, [request_id], (err, row) => err ? reject(err) : resolve(row));
  });
}

function acceptRecharge(request_id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE recharge_requests SET status = 'مقبول' WHERE id = ?`, [request_id], (err) => err ? reject(err) : resolve());
  });
}

function rejectRecharge(request_id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE recharge_requests SET status = 'مرفوض' WHERE id = ?`, [request_id], (err) => err ? reject(err) : resolve());
  });
}

// ========== دوال الإحصائيات والسجلات ==========
function getTotalOrders() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM orders`, (err, row) => err ? reject(err) : resolve(row.count));
  });
}

function getTotalRevenue() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT SUM(price) as total FROM orders`, (err, row) => err ? reject(err) : resolve(row.total || 0));
  });
}

function getRecentLogs() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10`, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function addLog(user_id, action, details) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)`,
      [user_id, action, details],
      function (err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

// ========== دوال الإحالات ==========
function getUserReferrals(user_id) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, first_name FROM users WHERE referrer_id = ?`, [user_id], (err, rows) => err ? reject(err) : resolve(rows));
  });
}

// ========== تصدير ==========
module.exports = {
  initDB,
  getUser,
  addUser,
  updateBalance,
  setVerified,
  getUsersCount,
  getAllUsers,
  getAllServices,
  getServicesByCategory,
  getServiceById,
  addService,
  toggleServiceActive,
  createOrder,
  getOrdersByUser,
  getAllOrders,
  updateOrderStatus,
  getOrderById,
  addRechargeRequest,
  getRechargeById,
  acceptRecharge,
  rejectRecharge,
  getTotalOrders,
  getTotalRevenue,
  getRecentLogs,
  addLog,
  getUserReferrals,
};