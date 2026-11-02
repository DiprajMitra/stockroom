const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client = null;
function getClient() {
  if (!client) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are missing in .env');
    }
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }
  return client;
}

// Map PostgreSQL / Supabase errors to HTTP status and friendly message
function mapSupabaseError(error) {
  if (!error) return null;
  const msg = error.message || '';
  if (error.code === '23505' || msg.includes('unique constraint') || msg.includes('duplicate key')) {
    return { status: 400, message: 'A record with this name, SKU, or username already exists.' };
  }
  if (error.code === '23503' || msg.includes('violates foreign key constraint') || msg.includes('referential integrity')) {
    return { status: 400, message: 'Cannot delete or alter this record because other records depend on it (e.g. sales, purchases, or catalog items).' };
  }
  return { status: 500, message: msg || 'Database operation failed.' };
}

// Helper to format ISO date to YYYY-MM-DD
const toYMD = d => d ? new Date(d).toISOString().slice(0, 10) : '';

const adapter = {
  // Auth
  login: async (username, password) => {
    const sb = getClient();
    const { data, error } = await sb
      .from('users')
      .select('user_id, username, full_name, role_id, roles(role_name)')
      .ilike('username', username)
      .eq('password_hash', password);
    if (error) throw error;
    if (!data || !data.length) return null;
    const u = data[0];
    const roleName = (u.roles && u.roles.role_name) ? u.roles.role_name : 'sales_staff';
    return {
      user_id: u.user_id,
      username: u.username,
      full_name: u.full_name,
      role: roleName
    };
  },

  // Products
  getProducts: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('products')
      .select(`
        product_id, name, sku, category_id, unit_price,
        tax_rate_override, reorder_level, current_stock,
        categories ( category_name, default_tax_rate )
      `)
      .order('product_id');
    if (error) throw error;
    return (data || []).map(p => ({
      product_id: p.product_id,
      name: p.name,
      sku: p.sku,
      category_id: p.category_id,
      category_name: p.categories ? p.categories.category_name : 'Unknown',
      default_tax_rate: p.categories ? +p.categories.default_tax_rate : 0,
      unit_price: +p.unit_price,
      tax_rate_override: p.tax_rate_override != null ? +p.tax_rate_override : null,
      reorder_level: p.reorder_level,
      current_stock: p.current_stock
    }));
  },

  saveProduct: async (d, userId) => {
    const sb = getClient();
    const payload = {
      name: d.name,
      sku: d.sku,
      category_id: +d.category_id,
      unit_price: +d.unit_price,
      reorder_level: +d.reorder_level,
      tax_rate_override: (d.tax_rate_override === '' || d.tax_rate_override == null) ? null : +d.tax_rate_override
    };
    if (d.product_id) {
      payload.updated_at = new Date().toISOString();
      const { error } = await sb.from('products').update(payload).eq('product_id', +d.product_id);
      if (error) throw error;
    } else {
      payload.created_by = userId || 1;
      payload.current_stock = 0;
      const { error } = await sb.from('products').insert(payload);
      if (error) throw error;
    }
    return { ok: true };
  },

  deleteProduct: async (id) => {
    const sb = getClient();
    const { error } = await sb.from('products').delete().eq('product_id', +id);
    if (error) throw error;
    return { ok: true };
  },

  // Categories
  getCategories: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('categories')
      .select('category_id, category_name, default_tax_rate')
      .order('category_name');
    if (error) throw error;
    return (data || []).map(c => ({
      category_id: c.category_id,
      category_name: c.category_name,
      default_tax_rate: +c.default_tax_rate
    }));
  },

  saveCategory: async (d) => {
    const sb = getClient();
    const payload = {
      category_name: d.category_name,
      default_tax_rate: +d.default_tax_rate
    };
    if (d.category_id) {
      const { error } = await sb.from('categories').update(payload).eq('category_id', +d.category_id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('categories').insert(payload);
      if (error) throw error;
    }
    return { ok: true };
  },

  deleteCategory: async (id) => {
    const sb = getClient();
    const { error } = await sb.from('categories').delete().eq('category_id', +id);
    if (error) throw error;
    return { ok: true };
  },

  // Suppliers
  getSuppliers: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('suppliers')
      .select('supplier_id, name, contact_info')
      .order('supplier_id');
    if (error) throw error;
    return data || [];
  },

  saveSupplier: async (d) => {
    const sb = getClient();
    const payload = {
      name: d.name,
      contact_info: d.contact_info || null
    };
    if (d.supplier_id) {
      const { error } = await sb.from('suppliers').update(payload).eq('supplier_id', +d.supplier_id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('suppliers').insert(payload);
      if (error) throw error;
    }
    return { ok: true };
  },

  deleteSupplier: async (id) => {
    const sb = getClient();
    const { error } = await sb.from('suppliers').delete().eq('supplier_id', +id);
    if (error) throw error;
    return { ok: true };
  },

  // Restock / Purchases
  restock: async (productId, supplierId, quantity, unitCost, userId) => {
    const sb = getClient();
    // 1) Create purchase header
    const { data: pur, error: purErr } = await sb
      .from('purchases')
      .insert({
        supplier_id: +supplierId,
        user_id: userId || 1,
        total_cost: 0
      })
      .select('purchase_id')
      .single();
    if (purErr) throw purErr;

    // 2) Insert line item (trigger automatically increments current_stock and updates total_cost)
    const { error: itemErr } = await sb
      .from('purchase_items')
      .insert({
        purchase_id: pur.purchase_id,
        product_id: +productId,
        quantity: +quantity,
        unit_cost: +unitCost
      });
    if (itemErr) throw itemErr;

    return { ok: true };
  },

  getPurchases: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('purchases')
      .select(`
        purchase_id, supplier_id, user_id, purchase_date, total_cost,
        purchase_items ( product_id, quantity, unit_cost )
      `)
      .order('purchase_id');
    if (error) throw error;
    return (data || []).map(p => ({
      id: p.purchase_id,
      sup: p.supplier_id,
      uid: p.user_id,
      date: toYMD(p.purchase_date),
      total: +p.total_cost,
      items: (p.purchase_items || []).map(i => ({
        pid: i.product_id,
        qty: i.quantity,
        cost: +i.unit_cost
      }))
    }));
  },

  // Sales
  createSale: async (userId, customerName, items) => {
    const sb = getClient();
    // 1) Create sale header
    const { data: sale, error: saleErr } = await sb
      .from('sales')
      .insert({
        user_id: userId || 1,
        customer_name: customerName || 'Walk-in',
        order_subtotal: 0,
        total_tax: 0,
        grand_total: 0
      })
      .select('sale_id')
      .single();
    if (saleErr) throw saleErr;

    // 2) Insert items (trigger computes unit price, tax, total and updates stock and sales header)
    for (const it of items) {
      const { error: lineErr } = await sb
        .from('sale_items')
        .insert({
          sale_id: sale.sale_id,
          product_id: +it.pid,
          quantity: +it.qty
        });
      if (lineErr) throw lineErr;
    }

    return sale.sale_id;
  },

  getSales: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('sales')
      .select(`
        sale_id, user_id, customer_name, sale_date,
        order_subtotal, total_tax, grand_total,
        users ( full_name ),
        sale_items (
          sale_item_id, product_id, quantity, unit_price, tax_rate, subtotal, tax_amount, line_total,
          products ( name, categories ( category_name ) )
        )
      `)
      .order('sale_id');
    if (error) throw error;

    return (data || []).map(s => {
      const lines = (s.sale_items || []).map(si => ({
        pid: si.product_id,
        name: si.products ? si.products.name : ('Product #' + si.product_id),
        cat: (si.products && si.products.categories) ? si.products.categories.category_name : '',
        qty: si.quantity,
        price: +si.unit_price,
        rate: +si.tax_rate,
        sub: +si.subtotal,
        tax: +si.tax_amount,
        line: +si.line_total
      }));
      return {
        id: s.sale_id,
        uid: s.user_id,
        cashier: s.users ? s.users.full_name : 'System Operator',
        date: toYMD(s.sale_date),
        cust: s.customer_name || 'Walk-in',
        sub: +s.order_subtotal,
        tax: +s.total_tax,
        total: +s.grand_total,
        lines
      };
    });
  },

  // Overview dashboard
  getOverview: async (showSales) => {
    const sb = getClient();
    const [prodsRes, salesRes, recPurRes] = await Promise.all([
      sb.from('products').select('product_id, name, sku, current_stock, reorder_level, unit_price'),
      showSales ? sb.from('sales').select('sale_id, grand_total, total_tax, sale_date, customer_name') : Promise.resolve({ data: [] }),
      sb.from('purchases').select('purchase_id, total_cost, purchase_date, suppliers(name)').order('purchase_id', { ascending: false }).limit(6)
    ]);

    const prods = prodsRes.data || [];
    const sales = salesRes.data || [];
    const recPurs = recPurRes.data || [];

    const lowStock = prods.filter(p => p.current_stock <= p.reorder_level);
    const todayStr = toYMD(new Date());

    const totalToday = showSales
      ? sales.filter(s => toYMD(s.sale_date) === todayStr).reduce((acc, s) => acc + (+s.grand_total || 0), 0)
      : 0;
    const taxAll = showSales
      ? sales.reduce((acc, s) => acc + (+s.total_tax || 0), 0)
      : 0;
    const inventoryValue = prods.reduce((acc, p) => acc + (p.current_stock * +p.unit_price), 0);

    // 7-day sales
    const days = [];
    for (let k = 6; k >= 0; k--) {
      const d = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
      const val = showSales
        ? sales.filter(s => toYMD(s.sale_date) === d).reduce((acc, s) => acc + (+s.grand_total || 0), 0)
        : 0;
      days.push({ date: d, value: val });
    }

    // Recent activity trail
    const recSales = showSales
      ? sales.slice(-6).map(s => ({
          kind: 's',
          id: s.sale_id,
          text: `Sale to ${s.customer_name || 'Walk-in'}`,
          value: +s.grand_total,
          date: toYMD(s.sale_date)
        }))
      : [];

    const recPurchases = recPurs.map(p => ({
      kind: 'p',
      id: p.purchase_id,
      text: `Stock received from ${p.suppliers ? p.suppliers.name : 'Supplier'}`,
      value: +p.total_cost,
      date: toYMD(p.purchase_date)
    }));

    const recent = [...recSales, ...recPurchases]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id - a.id))
      .slice(0, 8);

    return {
      stats: {
        products: prods.length,
        lowCount: lowStock.length,
        inventoryValue: Math.round(inventoryValue * 100) / 100,
        totalToday: Math.round(totalToday * 100) / 100,
        taxAll: Math.round(taxAll * 100) / 100,
        PRODUCTS: prods.length,
        LOWCOUNT: lowStock.length,
        INVENTORYVALUE: Math.round(inventoryValue * 100) / 100,
        TOTALTODAY: Math.round(totalToday * 100) / 100,
        TAXALL: Math.round(taxAll * 100) / 100
      },
      days,
      low: lowStock.map(p => ({
        id: p.product_id,
        name: p.name,
        sku: p.sku,
        stock: p.current_stock,
        reorder: p.reorder_level
      })),
      recent
    };
  },

  // Reports
  getReports: async (filters, showSales) => {
    const sb = getClient();
    const { from, to, cat } = filters || {};

    let prodQuery = sb.from('products').select('product_id, name, sku, category_id, current_stock, reorder_level, unit_price, categories(category_name, default_tax_rate)').order('name');
    if (cat) prodQuery = prodQuery.eq('category_id', +cat);
    const { data: prods, error: pErr } = await prodQuery;
    if (pErr) throw pErr;
    const prodList = prods || [];

    const stockRows = prodList.map(p => ({
      product_id: p.product_id,
      sku: p.sku,
      name: p.name,
      category_id: p.category_id,
      category_name: p.categories ? p.categories.category_name : '',
      current_stock: p.current_stock,
      reorder_level: p.reorder_level
    }));

    const lowRows = prodList
      .filter(p => p.current_stock <= p.reorder_level)
      .map(p => ({
        product_id: p.product_id,
        sku: p.sku,
        name: p.name,
        current_stock: p.current_stock,
        reorder_level: p.reorder_level
      }));

    let day = {};
    let best = {};
    let tax = {};

    if (showSales) {
      let salesQuery = sb.from('sales').select('sale_id, sale_date, grand_total, total_tax');
      if (from) salesQuery = salesQuery.gte('sale_date', from + 'T00:00:00');
      if (to) salesQuery = salesQuery.lte('sale_date', to + 'T23:59:59');
      const { data: salesData, error: sErr } = await salesQuery;
      if (sErr) throw sErr;
      const sales = salesData || [];

      for (const s of sales) {
        const d = toYMD(s.sale_date);
        day[d] = day[d] || { n: 0, t: 0 };
        day[d].n++;
        day[d].t += +s.grand_total;
      }

      // Best sellers
      const { data: siData } = await sb.from('sale_items').select('product_id, quantity, subtotal, products(name)');
      const itemMap = {};
      for (const si of (siData || [])) {
        const name = si.products ? si.products.name : ('Product #' + si.product_id);
        itemMap[name] = (itemMap[name] || 0) + si.quantity;
      }
      best = itemMap;

      // Tax by category
      const { data: catsData } = await sb.from('categories').select('category_id, category_name');
      const { data: taxData } = await sb.from('sale_items').select('tax_amount, subtotal, products(category_id)');
      const catTaxMap = {};
      const catNameMap = {};
      for (const c of (catsData || [])) {
        catTaxMap[c.category_id] = { b: 0, x: 0 };
        catNameMap[c.category_id] = c.category_name;
      }
      for (const t of (taxData || [])) {
        const cid = t.products ? t.products.category_id : null;
        if (cid && catTaxMap[cid]) {
          catTaxMap[cid].b += +t.subtotal;
          catTaxMap[cid].x += +t.tax_amount;
        }
      }
      for (const [cid, val] of Object.entries(catTaxMap)) {
        const name = catNameMap[cid] || 'Category #' + cid;
        if (val.b > 0 || val.x > 0) {
          tax[name] = val;
        }
      }
    }

    return { stockRows, lowRows, day, best, tax, includeSales: showSales };
  },

  // Users (Admin Control Panel)
  getUsers: async () => {
    const sb = getClient();
    const { data, error } = await sb
      .from('users')
      .select('user_id, username, full_name, roles(role_name)')
      .order('user_id');
    if (error) throw error;
    return (data || []).map(u => ({
      id: u.user_id,
      username: u.username,
      full_name: u.full_name,
      role: (u.roles && u.roles.role_name) ? u.roles.role_name : 'sales_staff'
    }));
  },

  saveUser: async (d) => {
    const sb = getClient();
    const { data: roles, error: rErr } = await sb.from('roles').select('role_id').eq('role_name', d.role).single();
    if (rErr || !roles) throw new Error('Invalid role specified.');

    const { data: newUser, error } = await sb
      .from('users')
      .insert({
        username: d.username,
        password_hash: d.password,
        full_name: d.full_name,
        role_id: roles.role_id
      })
      .select('user_id')
      .single();
    if (error) throw error;
    return { id: newUser.user_id, username: d.username };
  },

  setUserRole: async (userId, roleName) => {
    const sb = getClient();
    const { data: roles, error: rErr } = await sb.from('roles').select('role_id').eq('role_name', roleName).single();
    if (rErr || !roles) throw new Error('Invalid role specified.');

    const { error } = await sb
      .from('users')
      .update({ role_id: roles.role_id })
      .eq('user_id', +userId);
    if (error) throw error;
    return { ok: true };
  },

  deleteUser: async (id) => {
    const sb = getClient();
    const { error } = await sb.from('users').delete().eq('user_id', +id);
    if (error) throw error;
    return { ok: true };
  }
};

module.exports = {
  adapter,
  mapSupabaseError
};
