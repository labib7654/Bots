// orders.js - إدارة الطلبات

const orders = new Map();
let counter = 1000;

function createOrder(userId, username, productId, productName, price) {
  const orderId = ++counter;
  const order = {
    orderId,
    userId,
    username: username || 'مجهول',
    productId,
    productName,
    price,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  orders.set(orderId, order);
  return order;
}

function getOrder(orderId) {
  return orders.get(parseInt(orderId));
}

function updateStatus(orderId, status) {
  const order = orders.get(parseInt(orderId));
  if (order) {
    order.status = status;
    return order;
  }
  return null;
}

function getAllOrders() {
  return Array.from(orders.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getUserOrders(userId) {
  return Array.from(orders.values()).filter(o => o.userId === userId);
}

const statusEmoji = { pending: '⏳', confirmed: '✅', delivered: '📦', cancelled: '❌' };
const statusText  = { pending: 'في الانتظار', confirmed: 'مؤكد', delivered: 'تم التسليم', cancelled: 'ملغي' };

module.exports = { createOrder, getOrder, updateStatus, getAllOrders, getUserOrders, statusEmoji, statusText };
