/**
 * Sayyam Fragrance POS - Node.js Express Backend
 * Run: node server.js
 * Then open: http://localhost:3000
 * 
 * Dependencies (install with: npm install express better-sqlite3 uuid):
 *   - express
 *   - better-sqlite3
 *   - uuid
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
// MySQL not used — SQLite is the primary database
const mysqlDb = null;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'artisan-pos-salt').digest('hex');
}

// Ensure database folder exists
fs.mkdirSync(path.join(__dirname, 'db'), { recursive: true });

const app = express();

// ─── CORS — allow domain & localhost ─────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-auth-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
// Serve from both root and public/ folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ─── MySQL Example Route (optional) ───────────────────────────────────────────
app.post('/add-product', (req, res) => {
  if (!mysqlDb) return res.status(500).json({ error: 'MySQL is not configured. Please run with local MySQL or use SQLite mode.' });
  const { name, price, quantity } = req.body;
  if (!name || !price || !quantity) return res.status(400).json({ error: 'name, price, quantity required' });
  const sql = 'INSERT INTO products (id, name, price, barcode, category, stock) VALUES (?, ?, ?, ?, ?, ?)';
  mysqlDb.query(sql, [uuidv4(), name, price, null, null, quantity], (err, result) => {
    if (err) {
      console.log('MySQL insert error', err);
      return res.status(500).json({ error: 'MySQL insert failed', details: err.message });
    }
    res.json({ message: 'Product Added', insertId: result.insertId });
  });
});

// ─── SQLite Database Setup ────────────────────────────────────────────────────
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'db', 'pos.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      cost REAL DEFAULT 0,
      barcode TEXT UNIQUE,
      category TEXT,
      stock INTEGER DEFAULT 0,
      image TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      total REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL NOT NULL,
      payment_method TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );
  `);

  // Ensure image column exists (migration)
  try {
    db.prepare('ALTER TABLE products ADD COLUMN image TEXT').run();
  } catch (e) {
    // ignore if already exists
  }
  // Ensure cost column exists (migration)
  try {
    db.prepare('ALTER TABLE products ADD COLUMN cost REAL DEFAULT 0').run();
  } catch (e) {
    // ignore if already exists
  }
  // Ensure discount column exists in sales (migration)
  try {
    db.prepare('ALTER TABLE sales ADD COLUMN discount REAL DEFAULT 0').run();
  } catch (e) {
    // ignore if already exists
  }

  // Seed demo products if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
  if (count.c === 0) {
    const insert = db.prepare(`INSERT INTO products (id, name, price, barcode, category, stock) VALUES (?, ?, ?, ?, ?, ?)`);
    const demos = [
      [uuidv4(), 'Sourdough Bread', 4.50, '100001', 'Bread', 25],
      [uuidv4(), 'Croissant', 2.75, '100002', 'Pastry', 40],
      [uuidv4(), 'Blueberry Muffin', 3.25, '100003', 'Muffin', 30],
      [uuidv4(), 'Cinnamon Roll', 3.50, '100004', 'Pastry', 20],
      [uuidv4(), 'Baguette', 3.00, '100005', 'Bread', 15],
      [uuidv4(), 'Chocolate Cake Slice', 5.50, '100006', 'Cake', 12],
      [uuidv4(), 'Espresso', 3.00, '100007', 'Beverage', 100],
      [uuidv4(), 'Latte', 4.50, '100008', 'Beverage', 100],
    ];
    demos.forEach(d => insert.run(...d));
  }

  // Seed default users if none exist
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount.c === 0) {
    const insertUser = db.prepare(`INSERT INTO users (id, username, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?)`);
    insertUser.run(uuidv4(), 'admin', hashPassword('admin123'), 'admin', 'Admin User');
    insertUser.run(uuidv4(), 'cashier', hashPassword('cashier123'), 'cashier', 'Cashier User');
    console.log('✅ Default users created: admin/admin123 and cashier/cashier123');
  }

  console.log('✅ SQLite database ready');
} catch (e) {
  console.warn('⚠️  SQLite initialization failed (falling back to in-memory mock)');
  console.warn('    This can happen if better-sqlite3 is not installed or cannot access the database file.');
  console.warn('    Full error:', e);
  db = null;
}

const forceFileDB = process.env.USE_FILE_DB === '1' || process.env.USE_FILE_DB === 'true';
if (forceFileDB) {
  console.warn('⚠️  USE_FILE_DB is enabled; using file-based storage for products.');
  db = null;
}

const PRODUCT_FILE = path.join(__dirname, 'db', 'products.json');
const SALES_FILE = path.join(__dirname, 'db', 'sales.json');
const SALE_ITEMS_FILE = path.join(__dirname, 'db', 'sale_items.json');
let memProducts = [];
let memSales = [];
let memSaleItems = [];

function loadJsonArray(filePath, fallback = []) {
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error(`Failed to load ${path.basename(filePath)}:`, err.message);
  }
  return fallback;
}

function loadFileProducts() {
  try {
    if (fs.existsSync(PRODUCT_FILE)) {
      const text = fs.readFileSync(PRODUCT_FILE, 'utf8');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to load products.json:', err.message);
  }
  return [
    { id: '1', name: 'Sourdough Bread', price: 4.50, barcode: '100001', category: 'Bread', stock: 25, created_at: new Date().toISOString() },
    { id: '2', name: 'Croissant', price: 2.75, barcode: '100002', category: 'Pastry', stock: 40, created_at: new Date().toISOString() },
    { id: '3', name: 'Blueberry Muffin', price: 3.25, barcode: '100003', category: 'Muffin', stock: 30, created_at: new Date().toISOString() },
    { id: '4', name: 'Cinnamon Roll', price: 3.50, barcode: '100004', category: 'Pastry', stock: 20, created_at: new Date().toISOString() },
    { id: '5', name: 'Baguette', price: 3.00, barcode: '100005', category: 'Bread', stock: 15, created_at: new Date().toISOString() },
    { id: '6', name: 'Chocolate Cake Slice', price: 5.50, barcode: '100006', category: 'Cake', stock: 12, created_at: new Date().toISOString() },
    { id: '7', name: 'Espresso', price: 3.00, barcode: '100007', category: 'Beverage', stock: 100, created_at: new Date().toISOString() },
    { id: '8', name: 'Latte', price: 4.50, barcode: '100008', category: 'Beverage', stock: 100, created_at: new Date().toISOString() },
  ];
}

function saveFileProducts(items) {
  try {
    fs.writeFileSync(PRODUCT_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save products.json:', err.message);
  }
}

function saveFileSales(items) {
  try {
    fs.writeFileSync(SALES_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sales.json:', err.message);
  }
}

function saveFileSaleItems(items) {
  try {
    fs.writeFileSync(SALE_ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sale_items.json:', err.message);
  }
}

memProducts = loadFileProducts();
memSales = loadJsonArray(SALES_FILE, []);
memSaleItems = loadJsonArray(SALE_ITEMS_FILE, []);

// ─── Helper: use DB or JSON/memory data ─────────────────────────────────────────
const getProducts = (search = '') => {
  if (db) {
    if (search) return db.prepare(`SELECT * FROM products WHERE name LIKE ? OR barcode LIKE ? OR category LIKE ? ORDER BY name`).all(`%${search}%`, `%${search}%`, `%${search}%`);
    return db.prepare(`SELECT * FROM products ORDER BY name`).all();
  }
  if (!search) return memProducts;
  const q = search.toLowerCase();
  return memProducts.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.category || '').toLowerCase().includes(q));
};

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const memSessions = {}; // fallback sessions for in-memory mode
const memUsers = [
  { id: '1', username: 'admin', password_hash: hashPassword('admin123'), role: 'admin', full_name: 'Admin User', active: 1 },
  { id: '2', username: 'cashier', password_hash: hashPassword('cashier123'), role: 'cashier', full_name: 'Cashier User', active: 1 },
];

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  let user = null;
  if (db) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (session) user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.user_id);
  } else {
    if (memSessions[token]) user = memUsers.find(u => u.id === memSessions[token] && u.active === 1);
  }
  if (!user) return res.status(401).json({ error: 'Invalid or expired session' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = hashPassword(password);
  let user = null;
  if (db) {
    user = db.prepare('SELECT * FROM users WHERE username = ? AND password_hash = ? AND active = 1').get(username, hash);
  } else {
    user = memUsers.find(u => u.username === username && u.password_hash === hash && u.active === 1);
  }
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const token = uuidv4();
  if (db) {
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  } else {
    memSessions[token] = user.id;
  }
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['x-auth-token'];
  if (db) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  else delete memSessions[token];
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, username: u.username, role: u.role, full_name: u.full_name });
});

// ─── User Management Routes (Admin only) ─────────────────────────────────────
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  if (db) return res.json(db.prepare('SELECT id, username, role, full_name, active, created_at FROM users ORDER BY created_at').all());
  res.json(memUsers.map(({ password_hash, ...u }) => u));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, full_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin', 'cashier'].includes(role)) return res.status(400).json({ error: 'Role must be admin or cashier' });
  const id = uuidv4();
  const hash = hashPassword(password);
  if (db) {
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?)').run(id, username, hash, role || 'cashier', full_name || '');
      const u = db.prepare('SELECT id, username, role, full_name, active, created_at FROM users WHERE id = ?').get(id);
      res.json(u);
    } catch (e) {
      res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Username already exists' : e.message });
    }
  } else {
    if (memUsers.find(u => u.username === username)) return res.status(400).json({ error: 'Username already exists' });
    const u = { id, username, password_hash: hash, role: role || 'cashier', full_name: full_name || '', active: 1, created_at: new Date().toISOString() };
    memUsers.push(u);
    const { password_hash, ...safe } = u;
    res.json(safe);
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { username, password, role, full_name, active } = req.body;
  if (db) {
    try {
      if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
      db.prepare('UPDATE users SET username = ?, role = ?, full_name = ?, active = ? WHERE id = ?').run(username, role, full_name || '', active !== undefined ? (active ? 1 : 0) : 1, id);
      const u = db.prepare('SELECT id, username, role, full_name, active, created_at FROM users WHERE id = ?').get(id);
      res.json(u);
    } catch (e) {
      res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Username already exists' : e.message });
    }
  } else {
    const idx = memUsers.findIndex(u => u.id === id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    if (password) memUsers[idx].password_hash = hashPassword(password);
    memUsers[idx] = { ...memUsers[idx], username, role, full_name: full_name || '', active: active !== undefined ? (active ? 1 : 0) : 1 };
    const { password_hash, ...safe } = memUsers[idx];
    res.json(safe);
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (db) db.prepare('DELETE FROM users WHERE id = ?').run(id);
  else { const idx = memUsers.findIndex(u => u.id === id); if (idx !== -1) memUsers.splice(idx, 1); }
  res.json({ success: true });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Products
app.get('/api/products', (req, res) => {
  const { search } = req.query;
  res.json(getProducts(search));
});

app.get('/api/products/barcode/:barcode', (req, res) => {
  const { barcode } = req.params;
  const product = db
    ? db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode)
    : memProducts.find(p => p.barcode === barcode);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/products', (req, res) => {
  const { name, price, cost, barcode, category, stock, image } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
  const id = uuidv4();
  const imgValue = image ? image : null;
  if (db) {
    try {
      db.prepare('INSERT INTO products (id, name, price, cost, barcode, category, stock, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, price, parseFloat(cost) || 0, barcode || null, category || '', stock || 0, imgValue);
      res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  } else {
    const p = { id, name, price: parseFloat(price), cost: parseFloat(cost) || 0, barcode, category, stock: parseInt(stock) || 0, image: imgValue, created_at: new Date().toISOString() };
    memProducts.push(p);
    saveFileProducts(memProducts);
    res.json(p);
  }
});

app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, price, cost, barcode, category, stock, image } = req.body;
  const imgValue = image ? image : null;
  if (db) {
    db.prepare('UPDATE products SET name=?, price=?, cost=?, barcode=?, category=?, stock=?, image=? WHERE id=?').run(name, price, parseFloat(cost) || 0, barcode || null, category || '', stock || 0, imgValue, id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } else {
    const idx = memProducts.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    memProducts[idx] = { ...memProducts[idx], name, price: parseFloat(price), cost: parseFloat(cost) || 0, barcode, category, stock: parseInt(stock) || 0, image: imgValue };
    saveFileProducts(memProducts);
    res.json(memProducts[idx]);
  }
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  if (db) {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  } else {
    memProducts = memProducts.filter(p => p.id !== id);
    saveFileProducts(memProducts);
  }
  res.json({ success: true });
});

// Sales
app.post('/api/sales', (req, res) => {
  const { items, subtotal, discount, tax, total, payment_method } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'No items in sale' });

  const saleId = uuidv4();
  const now = new Date().toISOString();

  if (db) {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO sales (id, total, subtotal, discount, tax, payment_method) VALUES (?, ?, ?, ?, ?, ?)').run(saleId, total, subtotal, discount || 0, tax, payment_method || 'cash');
      for (const item of items) {
        db.prepare('INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uuidv4(), saleId, item.product_id, item.product_name, item.quantity, item.price, item.subtotal);
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.product_id);
      }
    });
    tx();
    res.json({ id: saleId, success: true });
  } else {
    memSales.push({ id: saleId, total, subtotal, discount: discount || 0, tax, payment_method: payment_method || 'cash', created_at: now });
    for (const item of items) {
      memSaleItems.push({ id: uuidv4(), sale_id: saleId, ...item });
      const p = memProducts.find(p => p.id === item.product_id);
      if (p) p.stock = Math.max(0, p.stock - item.quantity);
    }
    saveFileProducts(memProducts);
    saveFileSales(memSales);
    saveFileSaleItems(memSaleItems);
    res.json({ id: saleId, success: true });
  }
});

app.get('/api/sales/:id', (req, res) => {
  const { id } = req.params;
  if (db) {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    return res.json({ ...sale, items });
  }
  const sale = memSales.find(s => s.id === id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const items = memSaleItems.filter(i => i.sale_id === id);
  res.json({ ...sale, items });
});

app.get('/api/sales', (req, res) => {
  const { date, from, to } = req.query;
  // Support single date OR from/to range
  const dateFrom = from || date || null;
  const dateTo = to || date || null;
  if (db) {
    let sales;
    if (dateFrom && dateTo) {
      sales = db.prepare(`SELECT s.*, GROUP_CONCAT(si.product_name) as product_names FROM sales s LEFT JOIN sale_items si ON s.id = si.sale_id WHERE date(s.created_at) BETWEEN ? AND ? GROUP BY s.id ORDER BY s.created_at DESC`).all(dateFrom, dateTo);
    } else {
      sales = db.prepare(`SELECT s.*, GROUP_CONCAT(si.product_name) as product_names FROM sales s LEFT JOIN sale_items si ON s.id = si.sale_id GROUP BY s.id ORDER BY s.created_at DESC LIMIT 500`).all();
    }
    res.json(sales);
  } else {
    let sales = memSales;
    if (dateFrom && dateTo) {
      sales = sales.filter(s => {
        const d = s.created_at.slice(0, 10);
        return d >= dateFrom && d <= dateTo;
      });
    }
    const result = [...sales].reverse().map(s => {
      const items = memSaleItems.filter(i => i.sale_id === s.id);
      return { ...s, product_names: items.map(i => i.product_name).join(',') };
    });
    res.json(result);
  }
});

app.get('/api/sales/:id/items', (req, res) => {
  const { id } = req.params;
  if (db) {
    // sale info bhi attach karo taake frontend discount calculate kar sake
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    res.json(items.map(item => ({ ...item, sale })));
  } else {
    const sale = memSales.find(s => s.id === id);
    res.json(memSaleItems.filter(i => i.sale_id === id).map(item => ({ ...item, sale })));
  }
});

app.delete('/api/reports/clear', (req, res) => {
  try {
    if (db) {
      const clearAll = db.transaction(() => {
        db.prepare('DELETE FROM sale_items').run();
        db.prepare('DELETE FROM sales').run();
      });
      clearAll();
    } else {
      memSaleItems = [];
      memSales = [];
      saveFileSales(memSales);
      saveFileSaleItems(memSaleItems);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear sales data', details: err.message });
  }
});

app.get('/api/reports/daily', (req, res) => {
  const { date, from, to } = req.query;
  const dateFrom = from || date || new Date().toISOString().split('T')[0];
  const dateTo = to || date || dateFrom;
  if (db) {
    const summary = db.prepare(`
      SELECT COUNT(*) as total_transactions,
             SUM(total) as total_revenue,
             SUM(tax) as total_tax,
             SUM(total - tax) as total_revenue_excl_tax,
             AVG(total) as avg_sale
      FROM sales WHERE date(created_at) BETWEEN ? AND ?`).get(dateFrom, dateTo);
    const byDate = db.prepare(`
      SELECT date(created_at) as sale_date,
             COUNT(*) as transactions,
             SUM(total) as revenue,
             SUM(tax) as tax
      FROM sales WHERE date(created_at) BETWEEN ? AND ?
      GROUP BY sale_date ORDER BY sale_date`).all(dateFrom, dateTo);
    const topProducts = db.prepare(`
      SELECT si.product_name, si.product_id,
             SUM(si.quantity) as total_qty,
             SUM(si.subtotal - (si.subtotal / NULLIF(s.subtotal, 0)) * IFNULL(s.discount, 0)) as revenue,
             SUM(si.quantity * IFNULL(p.cost,0)) as total_cost
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE date(s.created_at) BETWEEN ? AND ?
      GROUP BY si.product_id ORDER BY total_qty DESC`).all(dateFrom, dateTo);
    const byPayment = db.prepare(`
      SELECT payment_method, COUNT(*) as transactions, SUM(total) as total
      FROM sales WHERE date(created_at) BETWEEN ? AND ?
      GROUP BY payment_method ORDER BY total DESC`).all(dateFrom, dateTo);
    const byHour = db.prepare(`
      SELECT strftime('%H', created_at) as hour,
             COUNT(*) as transactions, SUM(total) as revenue
      FROM sales WHERE date(created_at) BETWEEN ? AND ?
      GROUP BY hour ORDER BY hour`).all(dateFrom, dateTo);
    res.json({ dateFrom, dateTo, summary, byDate, topProducts, byPayment, byHour });
  } else {
    const rangedSales = memSales.filter(s => {
      const d = s.created_at.slice(0, 10);
      return d >= dateFrom && d <= dateTo;
    });
    const revenue = rangedSales.reduce((a, s) => a + (parseFloat(s.total) || 0), 0);
    const tax = rangedSales.reduce((a, s) => a + (parseFloat(s.tax) || 0), 0);
    res.json({
      dateFrom, dateTo,
      summary: {
        total_transactions: rangedSales.length,
        total_revenue: revenue,
        total_tax: tax,
        total_revenue_excl_tax: revenue - tax,
        avg_sale: rangedSales.length ? revenue / rangedSales.length : 0
      },
      byDate: [], topProducts: [], byPayment: [], byHour: []
    });
  }
});

// Serve frontend — catch-all for SPA routes
app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
  return res.sendFile(rootPath);
});

app.get(/^\/(?!api\/).*/, (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
  return res.sendFile(rootPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🥐 Sayyam Fragrance POS running at http://localhost:${PORT}\n`);
});
