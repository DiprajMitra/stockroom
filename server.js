/* =============================================================================
   server.js - Inventory Control System backend

   This is a small Node/Express server that:
     * Serves the static frontend (index.html, css/, js/) from this directory.
     * Exposes /api/* endpoints that talk to the FreeSQL Oracle database
       using the oracledb driver and the role-checking stored procedures
       defined in database/inventory_control_system_oracle.sql.

   Role-based access is enforced two ways:
     1. On the server, every endpoint checks the role from the session
        and refuses with HTTP 403 if the role is not allowed.
     2. The Oracle stored procedures additionally call check_role() and
        raise ORA-20001 with a "403:" message; the server maps that to
        a 403 response as well, so even if the server check is bypassed
        the database still refuses.

   To run:  npm install express oracledb   then   node server.js
   ============================================================================= */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const oracledb = require('oracledb');

// Load .env (gitignored) so ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING
// and (optionally) TNS_ADMIN don't have to be exported manually for every run.
// Existing process.env values win, so production deploys that inject vars
// at the platform level are unaffected.
require('dotenv').config();

// FreeSQL exposes Oracle 26ai over public TCPS with a server-side TLS
// certificate.  Client mTLS is NOT required, so we do not need a wallet
// folder to connect.  Two paths are supported:
//
//   1. EZ connect string (default).  Pass the full TCPS URL via
//      ORACLE_CONNECT_STRING.  No tnsnames.ora, no wallet, no TNS_ADMIN.
//
//   2. TNS alias from a FreeSQL wallet.  Set TNS_ADMIN to the unzipped
//      wallet folder and ORACLE_TNS_ALIAS to a TCPS alias.  initOracleClient
//      will load the wallet.  Use this path when you want cert pinning
//      via SSL_SERVER_DN_MATCH.
if (process.env.TNS_ADMIN) {
  oracledb.initOracleClient({
    configDir:      process.env.TNS_ADMIN,
    walletLocation: process.env.TNS_ADMIN,
  });
}

// Credentials are read from the environment (see .env, which is gitignored).
// ORACLE_CONNECT_STRING takes precedence; ORACLE_TNS_ALIAS is only used when
// no EZ string is supplied.
const DB = {
  user:          process.env.ORACLE_USER,
  password:      process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING
              || process.env.ORACLE_TNS_ALIAS
              || 'tcps://db.freesql.com:2484/26ai_un3c1',
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- Sessions (in-memory, fine for the classroom demo) -------------------
const sessions = new Map(); // token -> { user_id, role }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function getSession(req) {
  const h = req.headers.cookie || '';
  const m = h.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  return m ? sessions.get(m[1]) : null;
}
function setSession(res, sess) {
  const tok = newToken();
  sessions.set(tok, sess);
  res.setHeader('Set-Cookie', 'sid=' + tok + '; Path=/; HttpOnly; SameSite=Strict');
}
function clearSession(req, res) {
  const h = req.headers.cookie || '';
  const m = h.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (m) sessions.delete(m[1]);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
}
function requireRole(req, res, allowed) {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'Not signed in.' }); return null; }
  if (allowed && !allowed.includes(s.role)) {
    res.status(403).json({ error: 'Not allowed for your role.' });
    return null;
  }
  return s;
}

// --- Oracle helpers -------------------------------------------------------
let pool;
async function db() {
  if (!pool) pool = await oracledb.createPool({ ...DB, poolMin: 1, poolMax: 4 });
  return pool;
}
async function withConn(fn) {
  const p = await db();
  const c = await p.getConnection();
  try { return await fn(c); }
  finally { try { await c.close(); } catch {} }
}
async function setRoleAndRun(c, role, fn) {
  // Set the role package variable, run `fn(connection)`, then clear it.
  // The role is per-connection (per-session package state) - we always
  // reset it on the way out so a pooled connection can't leak the wrong
  // role into a later request.
  await c.execute(`BEGIN app_ctx_pkg.set_role(:r); END;`, { r: role });
  try { return await fn(c); }
  finally {
    try { await c.execute(`BEGIN app_ctx_pkg.set_role(NULL); END;`); }
    catch (e) { console.error('[setRoleAndRun] failed to clear role:', e.message); }
  }
}
function mapOraError(e, res) {
  const m = (e && e.message) || '';
  // Strip the ORA-XXXXX: prefix and the "400:" / "403:" status hint we
  // embed in the message, so the user only sees the human text.
  const clean = s => s.replace(/^ORA-\d+:\s*/, '').replace(/^(400|403):\s*/, '');
  if (/^ORA-20001:\s*403:/.test(m)) { res.status(403).json({ error: clean(m) }); return true; }
  if (/^ORA-20002:\s*400:/.test(m)) { res.status(400).json({ error: clean(m) }); return true; }
  if (/^ORA-01403:.*no data found/.test(m)) { res.status(404).json({ error: 'Not found.' }); return true; }
  return false;
}

// node-oracledb returns JSON expressions (JSON_ARRAYAGG, JSON_OBJECT) as
// strings.  The frontend wants real arrays, so parse them.  Be defensive
// in case the column is null (no rows) or already an object.
function parseJson(v) {
  if (v == null) return [];
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return []; }
}

// --- View+Edit permission matrix (mirrors api.js) -------------------------
const VIEW = {
  admin:           ['products','categories','suppliers','purchases','sales','reports','users'],
  sales_staff:     ['products','sales','reports'],
  inventory_clerk: ['products','categories','suppliers','purchases','reports'],
};
const EDIT = {
  admin:           ['products','categories','suppliers','purchases','sales','users'],
  sales_staff:     ['sales'],
  inventory_clerk: ['products','suppliers','purchases'],
};
function canSee(role, page) { return role === 'admin' || (VIEW[role] || []).includes(page); }
function canEdit(role, page) { return role === 'admin' || (EDIT[role] || []).includes(page); }

// --- API -----------------------------------------------------------------

// auth
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    const rows = await withConn(async c => {
      const r = await c.execute(
        `SELECT u.user_id, u.username, u.full_name, r.role_name
           FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE LOWER(u.username) = LOWER(:u) AND u.password_hash = :p`,
        { u: username, p: password },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return r.rows;
    });
    if (!rows.length) return res.status(401).json({ error: 'Wrong username or password.' });
    const u = rows[0];
    setSession(res, { user_id: u.USER_ID, role: u.ROLE_NAME, full_name: u.FULL_NAME, username: u.USERNAME });
    res.json({ user_id: u.USER_ID, username: u.USERNAME, full_name: u.FULL_NAME, role: u.ROLE_NAME });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.json(null);
  res.json({ user_id: s.user_id, username: s.username, full_name: s.full_name, role: s.role });
});
app.get('/api/permissions', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  res.json({
    me: { user_id: s.user_id, username: s.username, full_name: s.full_name, role: s.role },
    isAdmin: s.role === 'admin',
    canSee: {
      home: true, products: canSee(s.role, 'products'), categories: canSee(s.role, 'categories'),
      suppliers: canSee(s.role, 'suppliers'), purchases: canSee(s.role, 'purchases'),
      sales: canSee(s.role, 'sales'), reports: canSee(s.role, 'reports'), users: canSee(s.role, 'users'),
    },
    canEdit: {
      products: canEdit(s.role, 'products'), categories: canEdit(s.role, 'categories'),
      suppliers: canEdit(s.role, 'suppliers'), purchases: canEdit(s.role, 'purchases'),
      sales: canEdit(s.role, 'sales'), users: canEdit(s.role, 'users'),
    },
    canRestock: canEdit(s.role, 'purchases'),
    canDelete: s.role === 'admin',
  });
});

// products
app.get('/api/products', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'sales_staff', 'inventory_clerk']); if (!s) return;
  try {
    const rows = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      // NOTE: every column is aliased with double-quotes so it stays
      // lower-case in the returned JS keys (Oracle folds unquoted
      // identifiers to upper-case).
      const r = await cn.execute(
        `SELECT product_id        AS "product_id",
                name              AS "name",
                sku               AS "sku",
                category_id       AS "category_id",
                unit_price        AS "unit_price",
                tax_rate_override AS "tax_rate_override",
                reorder_level     AS "reorder_level",
                current_stock     AS "current_stock"
           FROM products ORDER BY name`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows;
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/products', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  const d = req.body || {};
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      if (d.product_id) {
        await cn.execute(
          `UPDATE products
              SET name = :n, sku = :s, category_id = :c, unit_price = :p,
                  reorder_level = :r, tax_rate_override = :t
            WHERE product_id = :id`,
          { n: d.name, s: d.sku, c: +d.category_id, p: +d.unit_price,
            r: +d.reorder_level, t: d.tax_rate_override === '' || d.tax_rate_override == null ? null : +d.tax_rate_override,
            id: +d.product_id },
          { autoCommit: true });
      } else {
        await cn.execute(
          `INSERT INTO products (name, sku, category_id, unit_price, reorder_level, tax_rate_override, created_by)
           VALUES (:n, :s, :c, :p, :r, :t, :u)`,
          { n: d.name, s: d.sku, c: +d.category_id, p: +d.unit_price,
            r: +d.reorder_level,
            t: d.tax_rate_override === '' || d.tax_rate_override == null ? null : +d.tax_rate_override,
            u: s.user_id },
          { autoCommit: true });
      }
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.delete('/api/products/:id', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(`DELETE FROM products WHERE product_id = :id`,
        { id: +req.params.id }, { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// categories
app.get('/api/categories', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  try {
    const rows = await withConn(c => setRoleAndRun(c, s.role, async cn => {
      const r = await cn.execute(
        `SELECT category_id      AS "category_id",
                category_name    AS "category_name",
                default_tax_rate AS "default_tax_rate"
           FROM categories ORDER BY category_name`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows;
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/categories', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  const d = req.body || {};
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      if (d.category_id) {
        await cn.execute(`UPDATE categories SET category_name=:n, default_tax_rate=:t WHERE category_id=:id`,
          { n: d.category_name, t: +d.default_tax_rate, id: +d.category_id }, { autoCommit: true });
      } else {
        await cn.execute(`INSERT INTO categories (category_name, default_tax_rate) VALUES (:n, :t)`,
          { n: d.category_name, t: +d.default_tax_rate }, { autoCommit: true });
      }
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.delete('/api/categories/:id', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(`DELETE FROM categories WHERE category_id = :id`, { id: +req.params.id }, { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// suppliers
app.get('/api/suppliers', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  try {
    const rows = await withConn(c => setRoleAndRun(c, s.role, async cn => {
      const r = await cn.execute(
        `SELECT supplier_id  AS "supplier_id",
                name         AS "name",
                contact_info AS "contact_info"
           FROM suppliers ORDER BY name`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows;
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/suppliers', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  const d = req.body || {};
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      if (d.supplier_id) {
        await cn.execute(`UPDATE suppliers SET name=:n, contact_info=:c WHERE supplier_id=:id`,
          { n: d.name, c: d.contact_info || null, id: +d.supplier_id }, { autoCommit: true });
      } else {
        await cn.execute(`INSERT INTO suppliers (name, contact_info) VALUES (:n, :c)`,
          { n: d.name, c: d.contact_info || null }, { autoCommit: true });
      }
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.delete('/api/suppliers/:id', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(`DELETE FROM suppliers WHERE supplier_id = :id`, { id: +req.params.id }, { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// purchases
app.get('/api/purchases', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  try {
    const rows = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      const r = await cn.execute(`
        SELECT pu.purchase_id AS "id", pu.supplier_id AS "sup", pu.user_id AS "uid",
               TO_CHAR(pu.purchase_date, 'YYYY-MM-DD') AS "date",
               pu.total_cost AS "total",
               JSON_ARRAYAGG(
                 JSON_OBJECT('pid' VALUE pi.product_id, 'qty' VALUE pi.quantity, 'cost' VALUE pi.unit_cost)
                 ORDER BY pi.purchase_item_id
               ) AS "items_json"
          FROM purchases pu
          JOIN purchase_items pi ON pi.purchase_id = pu.purchase_id
         GROUP BY pu.purchase_id, pu.supplier_id, pu.user_id, pu.purchase_date, pu.total_cost
         ORDER BY pu.purchase_id`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows.map(x => ({ id: x.id, sup: x.sup, uid: x.uid, date: x.date, total: x.total, items: parseJson(x.items_json) }));
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/restock', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'inventory_clerk']); if (!s) return;
  const { product_id, supplier_id, quantity, unit_cost } = req.body || {};
  // basic validation
  if (!product_id || !supplier_id || !quantity || quantity <= 0 || unit_cost == null || unit_cost < 0) {
    return res.status(400).json({ error: 'product_id, supplier_id, quantity (>0) and unit_cost (>=0) are required.' });
  }
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      // 1) Insert the purchase header.  RETURNING gives us the new id.
      //    This top-level INSERT goes through the BEFORE-INSERT trigger
      //    on purchases which calls check_role(...).
      const r = await cn.execute(
        `INSERT INTO purchases (supplier_id, user_id)
              VALUES (:s, :u)
           RETURNING purchase_id INTO :pid`,
        { s: +supplier_id, u: s.user_id,
          pid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
        { autoCommit: false });
      const pid = r.outBinds.pid[0];
      // 2) Insert the matching line item.  The AFTER-INSERT trigger on
      //    purchase_items updates products.current_stock and the
      //    purchase total_cost.  Keep both inserts in the same tx so
      //    a failure on the second rolls the first back too.
      await cn.execute(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost)
              VALUES (:pid, :prod, :q, :c)`,
        { pid, prod: +product_id, q: +quantity, c: +unit_cost },
        { autoCommit: false });
      await cn.commit();
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// sales
app.post('/api/sales', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'sales_staff']); if (!s) return;
  const d = req.body || {};
  if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json({ error: 'No items.' });
  for (const it of d.items) {
    if (!it.pid || !it.qty || it.qty <= 0) {
      return res.status(400).json({ error: 'Every line needs a product and a positive quantity.' });
    }
  }
  try {
    const newId = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      // 1) Insert the sale header.  RETURNING gives us the new id.
      //    The BEFORE-INSERT trigger on sales calls check_role(...).
      const r = await cn.execute(
        `INSERT INTO sales (user_id, customer_name)
              VALUES (:u, :c)
           RETURNING sale_id INTO :sid`,
        { u: s.user_id, c: d.customer_name || 'Walk-in',
          sid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
        { autoCommit: false });
      const sid = r.outBinds.sid[0];
      // 2) Insert each line item.  The BEFORE-INSERT trigger fills
      //    price/tax/total; the AFTER-INSERT trigger decreases stock
      //    and updates the sales header totals.  If any line fails
      //    (e.g. insufficient stock) we roll back the whole thing.
      for (const it of d.items) {
        await cn.execute(
          `INSERT INTO sale_items (sale_id, product_id, quantity)
                VALUES (:s, :p, :q)`,
          { s: sid, p: +it.pid, q: +it.qty },
          { autoCommit: false });
      }
      // 3) Commit once at the end.
      await cn.commit();
      return sid;
    }));
    res.json({ id: newId });
  } catch (e) {
    mapOraError(e, res) || res.status(500).json({ error: e.message });
  }
});
app.get('/api/sales', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'sales_staff']); if (!s) return;
  try {
    const rows = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      const r = await cn.execute(`
        SELECT s.sale_id AS "id", s.user_id AS "uid",
               TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS "date",
               s.customer_name AS "cust",
               s.order_subtotal AS "sub", s.total_tax AS "tax", s.grand_total AS "total",
               JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'pid' VALUE si.product_id, 'name' VALUE p.name,
                   'cat'  VALUE c.category_name,
                   'qty'  VALUE si.quantity, 'price' VALUE si.unit_price,
                   'rate' VALUE si.tax_rate, 'sub' VALUE si.subtotal,
                   'tax'  VALUE si.tax_amount, 'line' VALUE si.line_total)
                 ORDER BY si.sale_item_id
               ) AS "lines_json"
          FROM sales s
          JOIN sale_items si ON si.sale_id = s.sale_id
          JOIN products   p  ON p.product_id = si.product_id
          JOIN categories c  ON c.category_id = p.category_id
         GROUP BY s.sale_id, s.user_id, s.sale_date, s.customer_name,
                  s.order_subtotal, s.total_tax, s.grand_total
         ORDER BY s.sale_id`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows.map(x => ({ id: x.id, uid: x.uid, date: x.date, cust: x.cust, sub: x.sub, tax: x.tax, total: x.total, lines: parseJson(x.lines_json) }));
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// overview (single endpoint, mirrors the in-memory api.overviewStats/Daily/Low/Recent)
app.get('/api/overview', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'sales_staff', 'inventory_clerk']); if (!s) return;
  const showSales = canSee(s.role, 'sales');
  try {
    const out = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      // Stats
      const statsSql = `
        SELECT
          (SELECT COUNT(*) FROM products) AS products,
          (SELECT COUNT(*) FROM products WHERE current_stock <= reorder_level) AS lowCount,
          (SELECT NVL(SUM(current_stock * COALESCE((
                    SELECT MAX(pi.unit_cost) FROM purchase_items pi WHERE pi.product_id = p.product_id
                  ), p.unit_price)), 0)
             FROM products p) AS inventoryValue,
          ${showSales ? `(SELECT NVL(SUM(grand_total), 0) FROM sales WHERE TRUNC(sale_date) = TRUNC(SYSDATE))` : `0`} AS totalToday,
          ${showSales ? `(SELECT NVL(SUM(total_tax), 0) FROM sales)` : `0`} AS taxAll
        FROM DUAL`;
      console.log('[/api/overview] stats SQL:\n' + statsSql);
      const stats = await cn.execute(statsSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const r0 = stats.rows[0];
      // 7-day sales series
      const days = [];
      if (showSales) {
        for (let k = 6; k >= 0; k--) {
          const dr = await cn.execute(
            `SELECT NVL(SUM(grand_total), 0) AS "v" FROM sales WHERE TRUNC(sale_date) = TRUNC(SYSDATE) - :k`,
            { k: k }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
          const d = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
          days.push({ date: d, value: dr.rows[0].v });
        }
      } else {
        for (let k = 6; k >= 0; k--) {
          days.push({ date: new Date(Date.now() - k * 864e5).toISOString().slice(0, 10), value: 0 });
        }
      }
      // low stock
      const low = await cn.execute(`
        SELECT product_id    AS "id",
               name          AS "name",
               sku           AS "sku",
               current_stock AS "stock",
               reorder_level AS "reorder"
          FROM products WHERE current_stock <= reorder_level ORDER BY name`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      // recent activity
      let rec = [];
      if (showSales) {
        const rs = await cn.execute(`
          (SELECT 's' AS "kind", sale_id AS "id", TO_CHAR(sale_date, 'YYYY-MM-DD') AS "date",
                  'Sale to ' || customer_name AS "text", grand_total AS "value"
             FROM sales)
          UNION ALL
          (SELECT 'p' AS "kind", pu.purchase_id AS "id", TO_CHAR(pu.purchase_date, 'YYYY-MM-DD') AS "date",
                  'Stock received from ' || sp.name AS "text", pu.total_cost AS "value"
             FROM purchases pu JOIN suppliers sp ON sp.supplier_id = pu.supplier_id)
          ORDER BY "date" DESC, "id" DESC
          FETCH FIRST 5 ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        rec = rs.rows;
      } else {
        const rs = await cn.execute(`
          SELECT 'p' AS "kind", pu.purchase_id AS "id", TO_CHAR(pu.purchase_date, 'YYYY-MM-DD') AS "date",
                 'Stock received from ' || sp.name AS "text", pu.total_cost AS "value"
            FROM purchases pu JOIN suppliers sp ON sp.supplier_id = pu.supplier_id
           ORDER BY pu.purchase_date DESC, pu.purchase_id DESC
           FETCH FIRST 5 ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        rec = rs.rows;
      }
      return { stats: r0, days, low: low.rows, recent: rec };
    }));
    res.json(out);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// reports
app.get('/api/reports', async (req, res) => {
  const s = requireRole(req, res, ['admin', 'sales_staff', 'inventory_clerk']); if (!s) return;
  const f = req.query || {};
  const showSales = canSee(s.role, 'sales');
  try {
    const out = await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      const stock = await cn.execute(`
        SELECT p.product_id, p.sku, p.name, p.category_id, p.current_stock, p.reorder_level
          FROM products p
         WHERE :c IS NULL OR TO_CHAR(p.category_id) = :c
         ORDER BY p.name`,
        { c: f.cat || null }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const low = await cn.execute(`
        SELECT product_id, sku, name, current_stock, reorder_level
          FROM products WHERE current_stock <= reorder_level`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const out2 = { stockRows: stock.rows, lowRows: low.rows, day: {}, best: {}, tax: {}, includeSales: showSales };
      if (showSales) {
        const day = await cn.execute(`
          SELECT TO_CHAR(sale_date, 'YYYY-MM-DD') AS d, COUNT(*) AS n, SUM(grand_total) AS t
            FROM sales
           WHERE (:f IS NULL OR TO_CHAR(sale_date, 'YYYY-MM-DD') >= :f)
             AND (:t IS NULL OR TO_CHAR(sale_date, 'YYYY-MM-DD') <= :t)
           GROUP BY TO_CHAR(sale_date, 'YYYY-MM-DD')
           ORDER BY 1`, { f: f.from || null, t: f.to || null }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        out2.day = Object.fromEntries(day.rows.map(x => [x.D, { n: x.N, t: x.T }]));
        const best = await cn.execute(`
          SELECT p.name AS n, SUM(si.quantity) AS q
            FROM sale_items si JOIN products p ON p.product_id = si.product_id
           GROUP BY p.name ORDER BY q DESC FETCH FIRST 5 ROWS ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        out2.best = Object.fromEntries(best.rows.map(x => [x.N, x.Q]));
        const tax = await cn.execute(`
          SELECT c.category_name AS n, SUM(si.subtotal) AS b, SUM(si.tax_amount) AS x
            FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
              JOIN products p ON p.product_id = si.product_id
              JOIN categories c ON c.category_id = p.category_id
           GROUP BY c.category_name ORDER BY 1`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        out2.tax = Object.fromEntries(tax.rows.map(x => [x.N, { b: x.B, x: x.X }]));
      }
      return out2;
    }));
    res.json(out);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// users (admin only)
app.get('/api/users', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    const rows = await withConn(c => setRoleAndRun(c, s.role, async cn => {
      const r = await cn.execute(
        `SELECT u.user_id AS "id", u.username, u.full_name, r.role_name AS role
           FROM users u JOIN roles r ON r.role_id = u.role_id ORDER BY u.username`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows;
    }));
    res.json(rows);
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.post('/api/users', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  const d = req.body || {};
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(
        `INSERT INTO users (username, password_hash, full_name, role_id)
         VALUES (:u, :p, :f, (SELECT role_id FROM roles WHERE role_name = :r))`,
        { u: d.username, p: d.password, f: d.full_name, r: d.role },
        { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.patch('/api/users/:id/role', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(
        `UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name = :r) WHERE user_id = :id`,
        { r: req.body.role, id: +req.params.id }, { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});
app.delete('/api/users/:id', async (req, res) => {
  const s = requireRole(req, res, ['admin']); if (!s) return;
  try {
    await withConn(async c => setRoleAndRun(c, s.role, async cn => {
      await cn.execute(`DELETE FROM users WHERE user_id = :id`, { id: +req.params.id }, { autoCommit: true });
    }));
    res.json({ ok: true });
  } catch (e) { mapOraError(e, res) || res.status(500).json({ error: e.message }); }
});

// --- Start server --------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inventory server on http://localhost:${PORT}`));
