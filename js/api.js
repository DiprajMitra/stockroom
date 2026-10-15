/* ============================================================
   api.js  -  HTTP client for the Inventory Control System.

   The frontend never talks to the database directly.  Every
   read and write goes through /api/* on the Node/Express
   server in server.js, which in turn talks to the FreeSQL
   Oracle DB.  The server enforces role-based access: when
   the role is not allowed it returns HTTP 403.  This module
   converts those responses into the same ApiError shape the
   UI already knows how to handle.
   ============================================================ */

(() => {
  'use strict';

  class ApiError extends Error {
    constructor(message, status = 403) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  async function call(method, path, body) {
    const opt = {
      method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) {
      const msg = (data && data.error) || r.statusText || 'Request failed.';
      throw new ApiError(msg, r.status);
    }
    return data;
  }

  // ----- In-memory carts (sales / purchases) -----
  // These are session-scoped: they live only in the browser tab and
  // are flushed to the DB when the user clicks "Save".
  const _carts = {
    sales:     { customer_name: '', items: [] },
    purchases: { supplier_id: null, items: [] },
  };

  // ----- Overview cache (the server returns a single payload) -----
  let _ovCache = null;
  async function loadOverview() {
    if (!_ovCache) _ovCache = await call('GET', '/api/overview');
    return _ovCache;
  }
  function invalidateOverview() { _ovCache = null; }

  // Public surface - same names the original in-memory api.js exposed,
  // so script.js does not need to change.
  window.API = {
    ApiError,
    // auth
    login:        (u, p)         => call('POST', '/api/login', { username: u, password: p }),
    logout:       async ()       => { await call('POST', '/api/logout'); _carts.sales = { customer_name: '', items: [] }; _carts.purchases = { supplier_id: null, items: [] }; _ovCache = null; },
    currentUser:  async ()       => (await call('GET', '/api/me')) || null,
    permissions:  ()             => call('GET', '/api/permissions'),
    // products / categories / suppliers (CRUD)
    listProducts:    ()          => call('GET',  '/api/products'),
    saveProduct:     (d, e)      => call('POST', '/api/products', Object.assign({}, d, e ? { product_id: e.product_id || e.id } : {})),
    deleteProduct:   (id)        => call('DELETE', '/api/products/' + id),
    listCategories:  ()          => call('GET',  '/api/categories'),
    saveCategory:    (d, e)      => call('POST', '/api/categories', Object.assign({}, d, e ? { category_id: e.category_id || e.id } : {})),
    deleteCategory:  (id)        => call('DELETE', '/api/categories/' + id),
    listSuppliers:   ()          => call('GET',  '/api/suppliers'),
    saveSupplier:    (d, e)      => call('POST', '/api/suppliers', Object.assign({}, d, e ? { supplier_id: e.supplier_id || e.id } : {})),
    deleteSupplier:  (id)        => call('DELETE', '/api/suppliers/' + id),
    // purchases (read + cart + commit + restock)
    listPurchases:     ()        => call('GET',  '/api/purchases'),
    listPurchaseCarts: ()        => Promise.resolve(_carts.purchases),
    addToPurchaseCart: (item)    => {
      const c = _carts.purchases;
      if (c.items.length && c.supplier_id !== +item.supplier_id)
        return Promise.reject(new ApiError('One purchase has one supplier. Save or remove the current items first.', 400));
      c.supplier_id = +item.supplier_id;
      c.items.push({ pid: +item.product_id, qty: +item.quantity, cost: +item.unit_cost });
      return Promise.resolve();
    },
    removeFromPurchaseCart: (idx) => { _carts.purchases.items.splice(idx, 1); return Promise.resolve(); },
    commitPurchase: async () => {
      const c = _carts.purchases;
      if (!c.items.length) return Promise.reject(new ApiError('Add at least one item first.', 400));
      // For simplicity we send one big POST: items + supplier
      for (const it of c.items) {
        await call('POST', '/api/restock', { product_id: it.pid, supplier_id: c.supplier_id, quantity: it.qty, unit_cost: it.cost });
      }
      _carts.purchases = { supplier_id: null, items: [] };
      invalidateOverview();
      return null;
    },
    restockProduct: async (pid, sid, q, c) => {
      await call('POST', '/api/restock', { product_id: pid, supplier_id: sid, quantity: q, unit_cost: c });
      invalidateOverview();
    },
    // sales (read + cart + commit)
    listSales:     ()         => call('GET',  '/api/sales'),
    listSaleCarts: ()         => Promise.resolve(_carts.sales),
    addToSaleCart: (item)     => {
      _carts.sales.customer_name = item.customer_name || '';
      const ex = _carts.sales.items.find(i => i.pid === +item.product_id);
      if (ex) ex.qty += +item.quantity;
      else _carts.sales.items.push({ pid: +item.product_id, qty: +item.quantity });
      return Promise.resolve();
    },
    removeFromSaleCart: (idx) => { _carts.sales.items.splice(idx, 1); return Promise.resolve(); },
    commitSale: async () => {
      const c = _carts.sales;
      if (!c.items.length) return Promise.reject(new ApiError('Add at least one item first.', 400));
      // 1) create the sale (synthetic endpoint via direct SQL on the server)
      const newId = await call('POST', '/api/sales', { customer_name: c.customer_name || 'Walk-in', items: c.items });
      _carts.sales = { customer_name: '', items: [] };
      invalidateOverview();
      return newId;
    },
    // overview - return the same shape script.js expects
    overviewStats: async () => {
      const o = await loadOverview();
      const s = o.stats;
      return { totalToday: s.TOTALTODAY || 0, inventoryValue: s.INVENTORYVALUE || 0, products: s.PRODUCTS || 0, lowCount: s.LOWCOUNT || 0, taxAll: s.TAXALL || 0 };
    },
    overviewDailySales: async () => (await loadOverview()).days,
    overviewLowStock:   async () => (await loadOverview()).low,
    overviewRecent:     async () => (await loadOverview()).recent,
    overviewLastCost:   () => 0,   // unused by current UI
    // reports
    listReports: (f) => {
      const p = new URLSearchParams();
      if (f) { if (f.from) p.set('from', f.from); if (f.to) p.set('to', f.to); if (f.cat) p.set('cat', f.cat); }
      const q = p.toString(); return call('GET', '/api/reports' + (q ? '?' + q : ''));
    },
    // users (admin)
    listUsers:       ()        => call('GET',  '/api/users'),
    saveUser:        (d)       => call('POST', '/api/users', d),
    setUserRole:     (uid, r)  => call('PATCH', '/api/users/' + uid + '/role', { role: r }),
    deleteUser:      (id)      => call('DELETE', '/api/users/' + id),
  };
})();

