const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'followzone.db');
const db = new sqlite3.Database(dbPath);

// ==================== إنشاء الجداول ====================
function initDB() {
  db.serialize(() => {
    // جدول المستخدمين
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      referrer_id INTEGER,
      join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_verified INTEGER DEFAULT 0,
      FOREIGN KEY(referrer_id) REFERENCES users(id)
    )`);

    // جدول الطلبات
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      service_id INTEGER,
      service_name TEXT,
      link TEXT,
      price REAL,
      status TEXT DEFAULT 'قيد التنفيذ',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // جدول الخدمات
    db.run(`CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT,
      name_en TEXT,
      parent_category TEXT,
      price REAL,
      is_active INTEGER DEFAULT 1
    )`);

    // جدول طلبات الشحن
    db.run(`CREATE TABLE IF NOT EXISTS recharge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount REAL,
      currency TEXT,
      status TEXT DEFAULT 'معلق',
      receipt_message_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // جدول سجل العمليات (اختياري)
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // إدراج خدمات افتراضية إن كانت الجداول فارغة
    db.get(`SELECT COUNT(*) as count FROM services`, (err, row) => {
      if (err) return;
      if (row.count === 0) {
        const defaultServices = [
          // انستقرام
          { name_ar: 'متابعين انستقرام', name_en: 'Instagram Followers', parent: 'انستقرام', price: 5 },
          { name_ar: 'لايكات انستقرام', name_en: 'Instagram Likes', parent: 'انستقرام', price: 3 },
          { name_ar: 'مشاهدات انستقرام', name_en: 'Instagram Views', parent: 'انستقرام', price: 2 },
          // تيك توك
          { name_ar: 'متابعين تيك توك', name_en: 'TikTok Followers', parent: 'تيك توك', price: 6 },
          { name_ar: 'لايكات تيك توك', name_en: 'TikTok Likes', parent: 'تيك توك', price: 4 },
          { name_ar: 'مشاهدات تيك توك', name_en: 'TikTok Views', parent: 'تيك توك', price: 2.5 },
          // فيسبوك
          { name_ar: 'متابعين فيسبوك', name_en: 'Facebook Followers', parent: 'فيسبوك', price: 4 },
          { name_ar: 'لايكات فيسبوك', name_en: 'Facebook Likes', parent: 'فيسبوك', price: 2 },
          // تيليجرام
          { name_ar: 'مشتركين تيليجرام', name_en: 'Telegram Members', parent: 'تيليجرام', price: 7 },
          { name_ar: 'مشاهدات تيليجرام', name_en: 'Telegram Views', parent: 'تيليجرام', price: 3 },
          // ChatGPT
          { name_ar: 'اشتراك شات جي بي تي', name_en: 'ChatGPT Subscription', parent: 'ChatGPT', price: 15 },
          // تيليجرام بريميوم
          { name_ar: 'اشتراك تيليجرام بريميوم', name_en: 'Telegram Premium', parent: 'Telegram Premium', price: 20 },
        ];
        const stmt = db.prepare(`INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)`);
        defaultServices.forEach(s => {
          stmt.run(s.name_ar, s.name_en, s.parent, s.price);
        });
        stmt.finalize();
      }
    });
  });
}

// ==================== دوال المستخدمين ====================
function getUser(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function addUser(id, username, first_name, referrer_id = null) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT OR IGNORE INTO users (id, username, first_name, referrer_id) VALUES (?, ?, ?, ?)`,
      [id, username, first_name, referrer_id],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
  });
}

function updateBalance(id, amount) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function setVerified(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET is_verified = 1 WHERE id = ?`, [id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getUsersCount() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
}

// ==================== دوال الخدمات ====================
function getAllServices() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM services`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getServicesByCategory(category) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM services WHERE parent_category = ? AND is_active = 1`, [category], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getServiceById(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM services WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function addService(name_ar, name_en, parent_category, price) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)`,
      [name_ar, name_en, parent_category, price], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
  });
}

function toggleServiceActive(id, active) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE services SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function deleteService(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM services WHERE id = ?`, [id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ==================== دوال الطلبات ====================
function createOrder(user_id, service_id, service_name, link, price) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO orders (user_id, service_id, service_name, link, price) VALUES (?, ?, ?, ?, ?)`,
      [user_id, service_id, service_name, link, price], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
  });
}

function getOrdersByUser(user_id) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, [user_id], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getAllOrders() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function updateOrderStatus(order_id, status) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, order_id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getOrderById(order_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM orders WHERE id = ?`, [order_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ==================== دوال الشحن ====================
function addRechargeRequest(user_id, amount, currency) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO recharge_requests (user_id, amount, currency) VALUES (?, ?, ?)`,
      [user_id, amount, currency], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
  });
}

function getPendingRecharges() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM recharge_requests WHERE status = 'معلق'`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function acceptRecharge(request_id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE recharge_requests SET status = 'مقبول' WHERE id = ?`, [request_id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getRechargeById(request_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM recharge_requests WHERE id = ?`, [request_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ==================== دوال الإحصائيات ====================
function getTotalOrders() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM orders`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
}

function getTotalRevenue() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT SUM(price) as total FROM orders`, (err, row) => {
      if (err) reject(err);
      else resolve(row.total || 0);
    });
  });
}

// ==================== دوال المساعدة ====================
function getUserReferrals(user_id) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, first_name FROM users WHERE referrer_id = ?`, [user_id], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  initDB,
  getUser,
  addUser,
  updateBalance,
  setVerified,
  getUsersCount,
  getAllServices,
  getServicesByCategory,
  getServiceById,
  addService,
  toggleServiceActive,
  deleteService,
  createOrder,
  getOrdersByUser,
  getAllOrders,
  updateOrderStatus,
  getOrderById,
  addRechargeRequest,
  getPendingRecharges,
  acceptRecharge,
  getRechargeById,
  getTotalOrders,
  getTotalRevenue,
  getUserReferrals,
};