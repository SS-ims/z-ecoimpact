// Load environment variables from a `.env` file when present. This must be
// done before reading `process.env` values used elsewhere in the file.
require('dotenv').config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

// Accept both the MAIL_* names used by this app and the SMTP_* names commonly
// provided by cPanel. The MAIL_* values take priority when both are present.
const mailHost = process.env.MAIL_HOST || process.env.SMTP_HOST;
const mailPort = process.env.MAIL_PORT || process.env.SMTP_PORT;
const mailSecure = process.env.MAIL_SECURE || process.env.SMTP_SECURE;
const mailUser = process.env.MAIL_USER || process.env.SMTP_USER;
const mailPassword = process.env.MAIL_PASSWORD || process.env.SMTP_PASS;
const mailTransport = mailHost && mailUser && mailPassword
  ? nodemailer.createTransport({
      host: mailHost,
      port: Number(mailPort || 465),
      secure: mailSecure !== "false",
      auth: {
        user: mailUser,
        pass: mailPassword
      }
    })
  : null;
const contactRecipient = process.env.CONTACT_RECIPIENT || "zaqueuaugusto94@gmail.com";
const mailFrom = process.env.MAIL_FROM || process.env.SMTP_FROM || mailUser;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "db.json");
const adapter = new FileSync(dbPath);
const db = low(adapter);

// Optional MySQL integration:
// - Set the environment variable `USE_MYSQL=true` to enable MySQL-backed
//   product data instead of the built-in lowdb JSON file.
// - When enabled we attempt to require the helper at `./db/mysql.js` which
//   exports a connection pool and convenience functions (getProducts, etc.).
// - If the helper cannot be loaded or an error occurs, `mysqlDb` will be
//   left `null` and the application will fall back to the existing lowdb
//   JSON store. This keeps the change backwards-compatible.
const useMySQL = process.env.USE_MYSQL === "true";
let mysqlDb = null;
if (useMySQL) {
  try {
    // Load the MySQL helper module (created as db/mysql.js)
    mysqlDb = require(path.join(__dirname, "db", "mysql"));
    console.log("MySQL enabled for products");
  } catch (err) {
    // Production must not silently write to the local JSON fallback when MySQL was requested.
    console.error("Failed to load MySQL helper:", err.message || err);
    throw err;
  }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "development-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use("/styles", express.static(path.join(__dirname, "styles")));
app.use("/scripts", express.static(path.join(__dirname, "scripts")));
app.use("/images", express.static(path.join(__dirname, "images")));

app.use((req, res, next) => {
  if (!req.session.cart) {
    req.session.cart = [];
  }
  res.locals.cartCount = req.session.cart.reduce((sum, item) => sum + item.qty, 0);
  res.locals.formatCurrency = (value) => `$${Number(value).toFixed(2)}`;
  next();
});

// Provide a deployment-safe health check without exposing database credentials.
app.get("/api/health", async (req, res) => {
  if (!mysqlDb) {
    return res.status(503).json({ status: "error", storage: "lowdb", message: "MySQL is disabled" });
  }
  try {
    const database = await mysqlDb.testConnection();
    res.json({ status: "ok", storage: "mysql", database: database.database, tables: database.tables });
  } catch (err) {
    console.error("MySQL health check failed:", err.message || err);
    res.status(503).json({ status: "error", storage: "mysql", message: err.message || "Database unavailable" });
  }
});

function initDb() {
  // ensure local lowdb defaults include contacts for fallback storage
  db.defaults({ products: [], purchases: [], purchase_items: [], contacts: [] }).write();
  const products = db.get("products").value();
  if (!products || products.length === 0) {
    db.get("products")
      .push(
        {
          id: "p1",
          name: "Solar Panel 320W",
          description: "High-efficiency monocrystalline panel",
          price: 189,
          image: "images/product1.jpg",
          featured: 1
        },
        {
          id: "p2",
          name: "Hybrid Inverter",
          description: "Smart inverter with battery support",
          price: 499,
          image: "images/product2.jpg",
          featured: 1
        },
        {
          id: "p3",
          name: "4K Security Camera",
          description: "Weatherproof 4K camera with night vision",
          price: 129,
          image: "images/product3.jpg",
          featured: 1
        },
        {
          id: "p4",
          name: "Battery 10kWh",
          description: "Reliable energy storage for solar systems",
          price: 899,
          image: "images/product1.jpg",
          featured: 0
        }
      )
      .write();
  }
}

function mergeCartItem(cart, product, qty) {
  const existing = cart.find((item) => item.productId === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty
    });
  }
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect("/admin/login");
}

app.get("/admin/login", (req, res) => {
  if (req.session.isAdmin) return res.redirect("/admin");
  res.render("admin-login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const validCredentials = process.env.ADMIN_USER && process.env.ADMIN_PASSWORD
    && username === process.env.ADMIN_USER
    && password === process.env.ADMIN_PASSWORD;

  if (!validCredentials) {
    return res.status(401).render("admin-login", { error: "Invalid administrator credentials" });
  }

  req.session.isAdmin = true;
  res.redirect("/admin");
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

// Home route: prefer MySQL when available, otherwise use lowdb JSON data.
app.get("/", async (req, res) => {
  if (mysqlDb) {
    try {
      // Try fetching products from MySQL and render featured ones.
      const rows = await mysqlDb.getProducts();
      const featured = rows.filter((r) => Number(r.featured) === 1);
      return res.render("index", { featured });
    } catch (err) {
      // On any DB error, log and fall back to lowdb below.
      console.error(err);
      // fallthrough to lowdb
    }
  }
  // Default: read featured products from local lowdb JSON file.
  const featured = db.get("products").filter({ featured: 1 }).value();
  res.render("index", { featured });
});

// Products listing: use MySQL when present, otherwise fall back to lowdb.
app.get("/products", async (req, res) => {
  if (mysqlDb) {
    try {
      const products = await mysqlDb.getProducts();
      return res.render("products", { products });
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const products = db.get("products").value();
  res.render("products", { products });
});

// Product detail: attempt MySQL lookup first, then lowdb. This keeps behavior
// consistent whether MySQL is enabled or not.
app.get("/products/:id", async (req, res) => {
  if (mysqlDb) {
    try {
      const product = await mysqlDb.getProductById(req.params.id);
      if (!product) return res.status(404).render("product", { product: null });
      return res.render("product", { product });
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const product = db.get("products").find({ id: req.params.id }).value();
  if (!product) {
    return res.status(404).render("product", { product: null });
  }
  res.render("product", { product });
});

app.get("/services", (req, res) => {
  res.render("services");
});

app.get("/about", (req, res) => {
  res.render("about");
});

app.get("/contact", (req, res) => {
  res.render("contact");
});

app.get("/cart", (req, res) => {
  res.redirect("/about");
});

// Admin view: show products from MySQL when enabled, otherwise from lowdb.
app.get("/admin", requireAdmin, async (req, res) => {
  if (mysqlDb) {
    try {
      const products = await mysqlDb.getProducts();
      return res.render("admin", { products });
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const products = db.get("products").value();
  res.render("admin", { products });
});

// Add product: when MySQL is enabled, insert into MySQL (if not exists).
// Otherwise the product is added to the local lowdb JSON store.
app.post("/admin/products", requireAdmin, async (req, res) => {
  const { id, name, description, price, image, featured } = req.body;
  if (mysqlDb) {
    try {
      const existing = await mysqlDb.getProductById(id);
      if (!existing) {
        await mysqlDb.addProduct({ id, name, description, price: Number(price), image, featured: featured ? 1 : 0 });
      }
      return res.redirect("/admin");
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb if MySQL operations fail
    }
  }
  const exists = db.get("products").find({ id }).value();
  if (!exists) {
    db.get("products")
      .push({
        id,
        name,
        description,
        price: Number(price),
        image,
        featured: featured ? 1 : 0
      })
      .write();
  }
  res.redirect("/admin");
});

// Delete product: attempt deletion in MySQL first when enabled, else remove
// from the local lowdb JSON store.
app.post("/admin/products/:id/delete", requireAdmin, async (req, res) => {
  if (mysqlDb) {
    try {
      await mysqlDb.deleteProductById(req.params.id);
      return res.redirect("/admin");
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  db.get("products").remove({ id: req.params.id }).write();
  res.redirect("/admin");
});

// Toggle featured flag: keep behavior identical whether using MySQL or lowdb.
app.post("/admin/products/:id/feature", requireAdmin, async (req, res) => {
  if (mysqlDb) {
    try {
      const product = await mysqlDb.getProductById(req.params.id);
      if (product) {
        await mysqlDb.updateProductFeatured(req.params.id, product.featured ? 0 : 1);
      }
      return res.redirect("/admin");
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const product = db.get("products").find({ id: req.params.id }).value();
  if (product) {
    db.get("products")
      .find({ id: req.params.id })
      .assign({ featured: product.featured ? 0 : 1 })
      .write();
  }
  res.redirect("/admin");
});

// API endpoint: /api/products - returns product list from MySQL when enabled
// or from lowdb otherwise.
app.get("/api/products", async (req, res) => {
  if (mysqlDb) {
    try {
      const products = await mysqlDb.getProducts();
      return res.json({ products });
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const products = db.get("products").value();
  res.json({ products });
});

// API endpoint: /api/products/:id - returns a single product by id from the
// enabled storage backend (MySQL preferred, lowdb fallback).
app.get("/api/products/:id", async (req, res) => {
  if (mysqlDb) {
    try {
      const product = await mysqlDb.getProductById(req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      return res.json({ product });
    } catch (err) {
      console.error(err);
      // fallthrough to lowdb
    }
  }
  const product = db.get("products").find({ id: req.params.id }).value();
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }
  res.json({ product });
});

app.get("/api/cart", (req, res) => {
  res.json({ items: req.session.cart, total: cartTotal(req.session.cart) });
});

// The route is async because MySQL product lookups return promises.
app.post("/api/cart/add", async (req, res) => {
  const { productId, qty } = req.body;
  const quantity = Math.max(1, Number(qty || 1));
  const product = mysqlDb
    ? await mysqlDb.getProductById(productId)
    : db.get("products").find({ id: productId }).value();
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }
  mergeCartItem(req.session.cart, product, quantity);
  res.json({ items: req.session.cart, total: cartTotal(req.session.cart) });
});

app.post("/api/cart/update", (req, res) => {
  const { productId, qty } = req.body;
  const quantity = Math.max(1, Number(qty || 1));
  const item = req.session.cart.find((entry) => entry.productId === productId);
  if (!item) {
    return res.status(404).json({ message: "Item not found" });
  }
  item.qty = quantity;
  res.json({ items: req.session.cart, total: cartTotal(req.session.cart) });
});

app.post("/api/cart/remove", (req, res) => {
  const { productId } = req.body;
  req.session.cart = req.session.cart.filter((entry) => entry.productId !== productId);
  res.json({ items: req.session.cart, total: cartTotal(req.session.cart) });
});



// Checkout: when MySQL is enabled, persist the purchase and its items
// transactionally to MySQL; otherwise use the existing lowdb JSON fallback.
app.post("/api/checkout", async (req, res) => {
  const { name, email, address } = req.body;
  if (!name || !email || !address) {
    return res.status(400).json({ message: "Missing checkout details" });
  }
  if (!req.session.cart.length) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  const total = cartTotal(req.session.cart);
  if (mysqlDb) {
    try {
      // build purchase and items payloads compatible with mysql helper
      const purchase = { name, email, address, total };
      const items = req.session.cart.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        image: item.image
      }));
      const purchaseId = await mysqlDb.addPurchaseWithItems(purchase, items);
      req.session.cart = [];
      return res.json({ message: "Purchase complete", purchaseId, total });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Failed to persist purchase" });
    }
  }

  // Fallback to lowdb (existing behavior)
  const currentMaxId = db.get("purchases").map("id").max().value() || 0;
  const purchaseId = currentMaxId + 1;
  db.get("purchases")
    .push({
      id: purchaseId,
      name,
      email,
      address,
      total,
      created_at: new Date().toISOString()
    })
    .write();

  req.session.cart.forEach((item) => {
    db.get("purchase_items")
      .push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        purchase_id: purchaseId,
        product_id: item.productId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        image: item.image
      })
      .write();
  });

  req.session.cart = [];
  res.json({ message: "Purchase complete", purchaseId, total });
});

app.get("/api/purchases/:id", async (req, res) => {
  const id = Number(req.params.id);
  const purchase = mysqlDb
    ? await mysqlDb.getPurchaseById(id)
    : db.get("purchases").find({ id }).value();
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found" });
  }
  const items = mysqlDb
    ? purchase.items
    : db.get("purchase_items").filter({ purchase_id: id }).value();
  res.json({ purchase, items });
});

// Contact/chat endpoint: persist contact submissions when possible.
// - If `USE_MYSQL=true` the submission is saved to the `contacts` table.
// - Otherwise the app will append the submission to the local `data/db.json` contacts array.
// This keeps a record of inbound messages for later review.
app.post("/api/chat", async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ message: "Name, email, and message are required" });
  }

  // Persist the contact submission to MySQL if available, otherwise lowdb.
  if (mysqlDb) {
    try {
      await mysqlDb.addContact({ name, email, message });
    } catch (err) {
      console.error('Failed to save contact to MySQL:', err);
      return res.status(503).json({ message: "Unable to save contact message" });
    }
  } else {
    // lowdb fallback: store with a timestamp
    db.get('contacts')
      .push({ id: Date.now() + Math.floor(Math.random() * 1000), name, email, message, created_at: new Date().toISOString() })
      .write();
  }

  // Send the notification only after persistence succeeds, so an email cannot
  // announce a contact message that was not actually recorded in the database.
  if (!mailTransport) {
    return res.status(503).json({ message: "Message saved, but email delivery is not configured" });
  }

  try {
    // Use the configured mailbox as the sender and the visitor as replyTo;
    // this avoids Gmail rejecting messages that impersonate the visitor.
    await mailTransport.sendMail({
      from: mailFrom,
      to: contactRecipient,
      replyTo: email,
      subject: `New contact message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    });
  } catch (err) {
    console.error("Failed to send contact email:", err);
    return res.status(502).json({ message: "Message saved, but email delivery failed" });
  }

  res.json({ reply: "Thanks for your message. A Z Ecoimpact specialist will reply shortly." });
});

app.get("/api/location", (req, res) => {
  res.json({
    name: "Z Ecoimpact Consulting LDA",
    address: "Maputo, Mozambique",
    phone: "+258 84 000 0000",
    hours: "Mon-Fri 08:00 - 17:00",
    mapUrl: "https://maps.google.com/?q=Maputo%2C%20Mozambique"
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error");
});

async function startServer() {
  initDb();
  if (mysqlDb) {
    await mysqlDb.testConnection();
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Application startup failed:", err.message || err);
  process.exitCode = 1;
});
