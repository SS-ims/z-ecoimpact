const mysql = require('mysql2/promise');

// cPanel database credentials must be supplied through the Node.js app environment.
const requiredEnvironment = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing MySQL environment variables: ${missingEnvironment.join(', ')}`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10
});

// Verify both the MySQL connection and the tables required by the application.
async function testConnection() {
  await pool.query('SELECT 1');
  const [tables] = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = ?
     AND table_name IN ('products', 'purchases', 'purchase_items', 'contacts')`,
    [process.env.DB_DATABASE || 'z_ecoimpact']
  );
  const requiredTables = ['products', 'purchases', 'purchase_items', 'contacts'];
  const availableTables = new Set(tables.map((table) => table.TABLE_NAME || table.table_name));
  const missingTables = requiredTables.filter((table) => !availableTables.has(table));
  if (missingTables.length > 0) {
    const error = new Error(`Missing MySQL tables: ${missingTables.join(', ')}`);
    error.code = 'MISSING_TABLES';
    throw error;
  }
  return { database: process.env.DB_DATABASE || 'z_ecoimpact', tables: requiredTables };
}

async function getProducts() {
  const [rows] = await pool.query('SELECT id, name, description, price, image, featured FROM products');
  return rows;
}

async function getProductById(id) {
  const [rows] = await pool.query('SELECT id, name, description, price, image, featured FROM products WHERE id = ?', [id]);
  return rows[0];
}

async function addProduct(product) {
  await pool.query(
    'INSERT INTO products (id, name, description, price, image, featured) VALUES (?, ?, ?, ?, ?, ?)',
    [product.id, product.name, product.description, product.price, product.image, product.featured || 0]
  );
}

async function deleteProductById(id) {
  await pool.query('DELETE FROM products WHERE id = ?', [id]);
}

async function updateProductFeatured(id, featured) {
  await pool.query('UPDATE products SET featured = ? WHERE id = ?', [featured ? 1 : 0, id]);
}

// Insert a purchase and its items in a single transaction.
async function addPurchaseWithItems(purchase, items) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const createdAt = new Date();
    const [res] = await conn.query(
      'INSERT INTO purchases (name, email, address, total, created_at) VALUES (?, ?, ?, ?, ?)',
      [purchase.name, purchase.email, purchase.address, purchase.total, createdAt]
    );
    const purchaseId = res.insertId;
    for (const item of items) {
      await conn.query(
        'INSERT INTO purchase_items (purchase_id, product_id, name, price, qty, image) VALUES (?, ?, ?, ?, ?, ?)',
        [purchaseId, item.productId, item.name, item.price, item.qty, item.image]
      );
    }
    await conn.commit();
    return purchaseId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Retrieve a purchase and its line items.
async function getPurchaseById(id) {
  const [rows] = await pool.query('SELECT id, name, email, address, total, created_at FROM purchases WHERE id = ?', [id]);
  if (!rows || rows.length === 0) return null;
  const purchase = rows[0];
  const [items] = await pool.query('SELECT id, purchase_id, product_id, name, price, qty, image FROM purchase_items WHERE purchase_id = ?', [id]);
  purchase.items = items;
  return purchase;
}

// Store a contact form submission.
async function addContact(contact) {
  const createdAt = new Date();
  await pool.query('INSERT INTO contacts (name, email, message, created_at) VALUES (?, ?, ?, ?)', [contact.name, contact.email, contact.message, createdAt]);
}

// Export helper functions for use by the application. These provide a small
// abstraction over raw SQL so `server.js` can remain concise and focus on
// application logic. New exports include purchase and contact helpers.
module.exports = {
  pool,
  testConnection,
  getProducts,
  getProductById,
  addProduct,
  deleteProductById,
  updateProductFeatured,
  addPurchaseWithItems,
  getPurchaseById,
  addContact
};


