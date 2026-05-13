const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'followzone.db');
let db;

// حفظ قاعدة البيانات إلى الملف
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// تحميل قاعدة البيانات من الملف أو إنشاء جديدة
async function loadDB() {
  const SQL = await initSqlJs();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
}

// دوال مساعدة
function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const values = stmt.get();
    const row = {};
    cols.forEach((col, i) => row[col] = values[i]);
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const values = stmt.get();
    const row = {};
    cols.forEach((col, i) => row[col] = values[i]);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

// ====== التهيئة وإنشاء الجداول ======
async function initDB() {
  await loadDB();
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    referrer_id INTEGER,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_verified INTEGER DEFAULT 0
  )`);
  run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    service_id INTEGER,
    service_name TEXT,
    link TEXT,
    price REAL,
    status TEXT DEFAULT 'قيد التنفيذ',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT,
    name_en TEXT,
    parent_category TEXT,
    price REAL,
    is_active INTEGER DEFAULT 1
  )`);
  run(`CREATE TABLE IF NOT EXISTS recharge_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    currency TEXT,
    status TEXT DEFAULT 'معلق',
    receipt_message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // إضافة خدمات افتراضية إذا كانت فارغة
  const countRow = get('SELECT COUNT(*) as count FROM services');
  if (countRow.count === 0) {
    const services = [
      ['متابعين انستقرام', 'Instagram Followers', 'انستقرام', 5],
      ['لايكات انستقرام', 'Instagram Likes', 'انستقرام', 3],
      ['مشاهدات انستقرام', 'Instagram Views', 'انستقرام', 2],
      ['متابعين تيك توك', 'TikTok Followers', 'تيك توك', 6],
      ['لايكات تيك توك', 'TikTok Likes', 'تيك توك', 4],
      ['مشاهدات تيك توك', 'TikTok Views', 'تيك توك', 2.5],
      ['متابعين فيسبوك', 'Facebook Followers', 'فيسبوك', 4],
      ['لايكات فيسبوك', 'Facebook Likes', 'فيسبوك', 2],
      ['مشتركين تيليجرام', 'Telegram Members', 'تيليجرام', 7],
      ['مشاهدات تيليجرام', 'Telegram Views', 'تيليجرام', 3],
      ['اشتراك شات جي بي تي', 'ChatGPT Subscription', 'ChatGPT', 15],
      ['اشتراك تيليجرام بريميوم', 'Telegram Premium', 'Telegram Premium', 20],
    ];
    const stmt = db.prepare('INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)');
    services.forEach(s => stmt.run(s));
    stmt.free();
    saveDB();
  }
  saveDB();
}

// ====== دوال المستخدمين ======
function getUser(id) { return Promise.resolve(get('SELECT * FROM users WHERE id = ?', [id])); }
function addUser(id, username, first_name, referrer_id = null) {
  run('INSERT OR IGNORE INTO users (id, username, first_name, referrer_id) VALUES (?, ?, ?, ?)', [id, username, first_name, referrer_id]);
  return Promise.resolve();
}
function updateBalance(id, amount) {
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, id]);
  return Promise.resolve();
}
function setVerified(id) {
  run('UPDATE users SET is_verified = 1 WHERE id = ?', [id]);
  return Promise.resolve();
}
function getUsersCount() { return Promise.resolve(get('SELECT COUNT(*) as count FROM users').count); }
function getAllUsers() { return Promise.resolve(all('SELECT id FROM users')); }

// ====== دوال الخدمات ======
function getAllServices() { return Promise.resolve(all('SELECT * FROM services')); }
function getServicesByCategory(category) { return Promise.resolve(all('SELECT * FROM services WHERE parent_category = ? AND is_active = 1', [category])); }
function getServiceById(id) { return Promise.resolve(get('SELECT * FROM services WHERE id = ?', [id])); }
function addService(name_ar, name_en, parent_category, price) {
  run('INSERT INTO services (name_ar, name_en, parent_category, price) VALUES (?, ?, ?, ?)', [name_ar, name_en, parent_category, price]);
  return Promise.resolve();
}
function toggleServiceActive(id, active) {
  run('UPDATE services SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
  return Promise.resolve();
}

// ====== دوال الطلبات ======
function createOrder(user_id, service_id, service_name, link, price) {
  run('INSERT INTO orders (user_id, service_id, service_name, link, price) VALUES (?, ?, ?, ?, ?)', [user_id, service_id, service_name, link, price]);
  const result = get('SELECT last_insert_rowid() as id');
  return Promise.resolve(result.id);
}
function getOrdersByUser(user_id) { return Promise.resolve(all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [user_id])); }
function getAllOrders() { return Promise.resolve(all('SELECT * FROM orders ORDER BY created_at DESC')); }
function updateOrderStatus(order_id, status) { run('UPDATE orders SET status = ? WHERE id = ?', [status, order_id]); return Promise.resolve(); }
function getOrderById(order_id) { return Promise.resolve(get('SELECT * FROM orders WHERE id = ?', [order_id])); }

// ====== دوال الشحن ======
function addRechargeRequest(user_id, amount, currency) {
  run('INSERT INTO recharge_requests (user_id, amount, currency) VALUES (?, ?, ?)', [user_id, amount, currency]);
  const result = get('SELECT last_insert_rowid() as id');
  return Promise.resolve(result.id);
}
function getRechargeById(request_id) { return Promise.resolve(get('SELECT * FROM recharge_requests WHERE id = ?', [request_id])); }
function acceptRecharge(request_id) { run('UPDATE recharge_requests SET status = ? WHERE id = ?', ['مقبول', request_id]); return Promise.resolve(); }
function rejectRecharge(request_id) { run('UPDATE recharge_requests SET status = ? WHERE id = ?', ['مرفوض', request_id]); return Promise.resolve(); }

// ====== دوال الإحصائيات ======
function getTotalOrders() { return Promise.resolve(get('SELECT COUNT(*) as count FROM orders').count); }
function getTotalRevenue() { return Promise.resolve(get('SELECT SUM(price) as total FROM orders').total || 0); }
function getRecentLogs() { return Promise.resolve(all('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10')); }
function addLog(user_id, action, details) {
  run('INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)', [user_id, action, details]);
  return Promise.resolve();
}

// ====== دوال الإحالات ======
function getUserReferrals(user_id) { return Promise.resolve(all('SELECT id, first_name FROM users WHERE referrer_id = ?', [user_id])); }

module.exports = {
  initDB,
  getUser, addUser, updateBalance, setVerified, getUsersCount, getAllUsers,
  getAllServices, getServicesByCategory, getServiceById, addService, toggleServiceActive,
  createOrder, getOrdersByUser, getAllOrders, updateOrderStatus, getOrderById,
  addRechargeRequest, getRechargeById, acceptRecharge, rejectRecharge,
  getTotalOrders, getTotalRevenue, getRecentLogs, addLog,
  getUserReferrals,
};