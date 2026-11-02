/* =============================================================================
   script.js - Inventory Control System (Frontend Application Controller)
   Role-Based Access: admin, sales_staff, inventory_clerk
   Connected to FreeSQL Oracle 26ai Database via server.js / api.js
   ========================================================================== */

(() => {
'use strict';

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (+n || 0).toFixed(2);
const r2    = n => Math.round((+n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

const api = window.API;
let P_cache = null; // memoized permissions for active session
let currentUserCache = null;

async function loadPerms() {
  if (P_cache) return P_cache;
  try {
    P_cache = await api.permissions();
  } catch (e) {
    P_cache = null;
  }
  return P_cache;
}

function invalidatePerms() {
  P_cache = null;
  currentUserCache = null;
}

function canSee(page) {
  return P_cache ? !!(P_cache.canSee && P_cache.canSee[page]) : false;
}

function canEdit(page) {
  return P_cache ? !!(P_cache.canEdit && P_cache.canEdit[page]) : false;
}

function canRestock() {
  return P_cache ? !!P_cache.canRestock : false;
}

function isAdmin() {
  return P_cache ? !!P_cache.isAdmin : false;
}

async function getCurrentUser() {
  if (currentUserCache) return currentUserCache;
  try {
    currentUserCache = await api.currentUser();
  } catch {
    currentUserCache = null;
  }
  return currentUserCache;
}

async function callApi(fn, ...args) {
  try {
    return await fn(...args);
  } catch (e) {
    if (e && e.name === 'ApiError') {
      msg(e.status === 403 ? 'Access denied for your role.' : (e.message || 'Request failed.'), 1);
      return null;
    }
    throw e;
  }
}

// -- Toast notifications --
let tm;
const msg = (t, bad) => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = t;
  el.className = bad ? 'bad show' : 'show';
  clearTimeout(tm);
  tm = setTimeout(() => el.className = '', 4000);
};

// -- Form / Table HTML helpers --
const fld = (l, n, v, a='')  => `<label>${l}<input name="${n}" value="${esc(v)}" ${a}></label>`;
const sel = (l, n, items, v, a='') =>
  `<label>${l}<select name="${n}" ${a}>${items.map(([k,t]) => `<option value="${k}"${String(k)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;

const tbl = (head, rows, q, act, empty) => {
  q = (q || '').toLowerCase();
  rows = rows.filter(r => !q || r.c.join(' ').replace(/<[^>]*>/g, ' ').toLowerCase().includes(q));
  if (!rows.length) return `<p class="lead">${empty || 'Nothing to show.'}</p>`;
  return `<div class="tbl"><table><thead><tr>${head.concat(act ? ['Actions'] : []).map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.c.map(c => `<td>${c}</td>`).join('')}${act ? `<td>${act(r)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
};

const bt   = (a, k, t, extraClass='alt') => `<button type="button" class="${extraClass}" data-a="${a}" data-k="${k}">${t}</button>`;
const ico  = n  => `<svg class="ic"><use href="#i-${n}"/></svg>`;
const m    = n  => `<span class="m">BDT ${money(n)}</span>`;
const fD   = d  => d ? new Date(d + 'T00:00:00').toLocaleDateString('en', {month:'short', day:'numeric', year:'numeric'}) : '-';
const wd   = d  => d ? new Date(d + 'T00:00:00').toLocaleDateString('en', {weekday:'short'}) : '-';

const setActive = () => {
  const h = location.hash.slice(1) || 'home';
  $$('.side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + h));
  const a = $('.side a.on');
  $('#crumb').textContent = a ? a.textContent.trim() : 'Overview';
};

// -- Application Page Modules --
const P = {};

// ============================================================
//   1. PRODUCTS
// ============================================================
P.products = {
  arr: () => callApi(api.listProducts),
  filter: p => {
    const f = window.SF = window.SF || { cat: '', lvl: '' };
    return (!f.cat || String(p.category_id) === f.cat) &&
           (!f.lvl || (f.lvl === 'low' ? p.current_stock <= p.reorder_level : p.current_stock > p.reorder_level));
  },
  f: async (e) => {
    if (!canEdit('products')) return '';
    const open = window.S_open = window.S_open || {};
    if (!open.products && !e) return '';
    const cats = (await callApi(api.listCategories)) || [];
    return `<h3>${e ? 'Edit Product' : 'Add New Product'}</h3>
    <form data-pg="products">
      ${e ? `<input type="hidden" name="product_id" value="${e.product_id}">` : ''}
      ${fld('Product Name', 'name', e && e.name, 'required placeholder="e.g. Basmati Rice 5kg"')}
      ${fld('SKU Code', 'sku', e && e.sku, 'required placeholder="e.g. GRC-001"')}
      ${sel('Category', 'category_id', cats.map(c => [c.category_id, c.category_name]), e && e.category_id, 'required')}
      ${fld('Unit Price (৳)', 'unit_price', e && e.unit_price, 'type=number min=0 step=0.01 required placeholder="0.00"')}
      ${fld('Reorder Threshold Level', 'reorder_level', e ? e.reorder_level : 10, 'type=number min=0 required')}
      ${fld('Tax Override % (Optional)', 'tax_rate_override', e && e.tax_rate_override != null ? e.tax_rate_override : '', 'type=number min=0 max=100 step=0.01 placeholder="Leave blank for category default"')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="submit">${e ? 'Update Product' : 'Save Product'}</button>
        ${bt('cancel', 'products:0', 'Cancel')}
      </div>
    </form>`;
  },
  save: (d, e) => callApi(api.saveProduct, d, e || null),
  del: id => callApi(api.deleteProduct, id),
  head: ['Product / SKU', 'Category', 'Unit Price', 'Effective Tax', 'In Stock', 'Status'],
  row: (p, cats) => {
    const cat = (cats || []).find(c => c.category_id === p.category_id) || { category_name: p.category_name || '?', default_tax_rate: p.default_tax_rate || 0 };
    const rate = p.tax_rate_override != null ? p.tax_rate_override : cat.default_tax_rate;
    const lo = p.current_stock <= p.reorder_level;
    return {
      id: p.product_id,
      c: [
        `<div class="pc"><span class="ico">${ico('box')}</span><div><b>${esc(p.name)}</b><small>${esc(p.sku)}</small></div></div>`,
        `<span class="pill">${esc(p.category_name || cat.category_name)}</span>`,
        m(p.unit_price),
        `<span class="m">${rate}%</span>`,
        `<b class="m">${p.current_stock}</b> <span class="mut m">/ ${p.reorder_level} min</span>`,
        `<span class="st ${lo ? 'bad' : 'good'}"><i></i>${lo ? 'Restock Needed' : 'In Stock'}</span>`,
      ]
    };
  },
  t: async () => {
    const [products, cats] = await Promise.all([
      callApi(api.listProducts),
      canSee('categories') ? callApi(api.listCategories) : Promise.resolve([]),
    ]);
    const prods = (products || []).filter(P.products.filter);
    const catList = cats || [];
    const rows = prods.map(p => P.products.row(p, catList));
    const acts = (canEdit('products') || isAdmin())
      ? r => {
          const k = 'products:' + r.id;
          if (window.S_cd === k) return bt('yes', k, 'Confirm Delete', 'bad') + ' ' + bt('no', k, 'Cancel');
          return (canEdit('products') ? bt('edit', k, 'Edit') : '') + (isAdmin() ? ' ' + bt('del', k, 'Delete') : '');
        }
      : null;
    return tbl(P.products.head, rows, (window.SQ = window.SQ || {}).products, acts, 'No products found.');
  },
  tb: async () => {
    const cats = canSee('categories') ? ((await callApi(api.listCategories)) || []) : [];
    const f = window.SF = window.SF || { cat: '', lvl: '' };
    return `<select data-pf="cat" aria-label="Category filter"><option value="">All Categories</option>${cats.map(c => `<option value="${c.category_id}"${String(c.category_id) === f.cat ? ' selected' : ''}>${esc(c.category_name)}</option>`).join('')}</select><select data-pf="lvl" aria-label="Stock level filter"><option value="">Any Stock Level</option><option value="low"${f.lvl === 'low' ? ' selected' : ''}>Needs Restock</option><option value="ok"${f.lvl === 'ok' ? ' selected' : ''}>Healthy Stock</option></select>`;
  },
};

// ============================================================
//   2. CATEGORIES
// ============================================================
P.categories = {
  arr: () => callApi(api.listCategories),
  f: async (e) => {
    if (!canEdit('categories')) return '';
    const open = window.S_open = window.S_open || {};
    if (!open.categories && !e) return '';
    return `<h3>${e ? 'Edit Category' : 'Add New Category'}</h3>
    <form data-pg="categories">
      ${e ? `<input type="hidden" name="category_id" value="${e.category_id}">` : ''}
      ${fld('Category Name', 'category_name', e && e.category_name, 'required placeholder="e.g. Groceries"')}
      ${fld('Default Tax Rate (%)', 'default_tax_rate', e ? e.default_tax_rate : '', 'type=number min=0 max=100 step=0.01 required placeholder="e.g. 5.00"')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="submit">${e ? 'Update Category' : 'Save Category'}</button>
        ${bt('cancel', 'categories:0', 'Cancel')}
      </div>
    </form>`;
  },
  save: (d, e) => callApi(api.saveCategory, d, e || null),
  del: id => callApi(api.deleteCategory, id),
  head: ['Category Name', 'Default Tax Rate', 'Total Assigned Products'],
  t: async () => {
    const [cats, products] = await Promise.all([
      callApi(api.listCategories),
      callApi(api.listProducts),
    ]);
    const catList = cats || [];
    const prodList = products || [];
    const rows = catList.map(c => ({
      id: c.category_id,
      c: [
        `<b>${esc(c.category_name)}</b>`,
        `<span class="m">${c.default_tax_rate}%</span>`,
        `${prodList.filter(p => p.category_id === c.category_id).length} items`,
      ]
    }));
    const acts = (canEdit('categories') || isAdmin())
      ? r => {
          const k = 'categories:' + r.id;
          if (window.S_cd === k) return bt('yes', k, 'Confirm Delete', 'bad') + ' ' + bt('no', k, 'Cancel');
          return (canEdit('categories') ? bt('edit', k, 'Edit') : '') + (isAdmin() ? ' ' + bt('del', k, 'Delete') : '');
        }
      : null;
    return tbl(P.categories.head, rows, (window.SQ = window.SQ || {}).categories, acts, 'No categories recorded.');
  },
};

// ============================================================
//   3. SUPPLIERS
// ============================================================
P.suppliers = {
  arr: () => callApi(api.listSuppliers),
  f: async (e) => {
    if (!canEdit('suppliers')) return '';
    const open = window.S_open = window.S_open || {};
    if (!open.suppliers && !e) return '';
    return `<h3>${e ? 'Edit Supplier' : 'Add New Supplier'}</h3>
    <form data-pg="suppliers">
      ${e ? `<input type="hidden" name="supplier_id" value="${e.supplier_id}">` : ''}
      ${fld('Company / Supplier Name', 'name', e && e.name, 'required placeholder="e.g. Rahim Traders"')}
      ${fld('Contact Information', 'contact_info', e && e.contact_info, 'placeholder="Phone, email or address"')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="submit">${e ? 'Update Supplier' : 'Save Supplier'}</button>
        ${bt('cancel', 'suppliers:0', 'Cancel')}
      </div>
    </form>`;
  },
  save: (d, e) => callApi(api.saveSupplier, d, e || null),
  del: id => callApi(api.deleteSupplier, id),
  head: ['Supplier Name', 'Contact Info', 'Purchase Orders'],
  t: async () => {
    const [sups, purs] = await Promise.all([
      callApi(api.listSuppliers),
      canSee('purchases') ? callApi(api.listPurchases) : Promise.resolve([]),
    ]);
    const supList = sups || [];
    const purList = purs || [];
    const rows = supList.map(s => ({
      id: s.supplier_id,
      c: [
        `<b>${esc(s.name)}</b>`,
        esc(s.contact_info) || '<span class="mut">-</span>',
        `${purList.filter(p => p.sup === s.supplier_id).length} orders`,
      ]
    }));
    const acts = (canEdit('suppliers') || isAdmin())
      ? r => {
          const k = 'suppliers:' + r.id;
          if (window.S_cd === k) return bt('yes', k, 'Confirm Delete', 'bad') + ' ' + bt('no', k, 'Cancel');
          return (canEdit('suppliers') ? bt('edit', k, 'Edit') : '') +
                 (canSee('purchases') ? ' ' + bt('hist', k, 'History') : '') +
                 (isAdmin() ? ' ' + bt('del', k, 'Delete') : '');
        }
      : null;
    return tbl(P.suppliers.head, rows, (window.SQ = window.SQ || {}).suppliers, acts, 'No suppliers found.');
  },
  x: async () => {
    const hist = window.S_hist;
    if (hist == null) return '';
    const [sups, purs, prods] = await Promise.all([
      callApi(api.listSuppliers),
      callApi(api.listPurchases),
      callApi(api.listProducts),
    ]);
    const supList = sups || [];
    const purList = purs || [];
    const prodList = prods || [];
    const s = supList.find(x => x.supplier_id === hist);
    if (!s) return '';
    const orders = purList.filter(p => p.sup === s.supplier_id);
    return `<div class="panel" style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3>Purchase History: ${esc(s.name)}</h3>
        ${bt('hx', 'suppliers:0', 'Close History')}
      </div>
      ${tbl(['PO Reference', 'Date', 'Supplied Items', 'Total Spent'], orders.map(p => ({
        c: [
          `<span class="pill m">PUR-${String(p.id).padStart(4,'0')}</span>`,
          fD(p.date),
          (p.items || []).map(i => {
            const itemProd = prodList.find(x => x.product_id === i.pid);
            return esc(itemProd ? itemProd.name : ('Product #' + i.pid)) + ' &times; ' + i.qty;
          }).join(', ') || 'No line items',
          `<b class="m">BDT ${money(p.total)}</b>`,
        ]
      })), '', null, 'No recorded purchase orders from this supplier.')}
    </div>`;
  },
};

// ============================================================
//   4. PURCHASES (Inbound Restocking)
// ============================================================
P.purchases = {
  cart: 1,
  f: async () => {
    if (!canEdit('purchases')) return '';
    const open = window.S_open = window.S_open || {};
    const cart = (await callApi(api.listPurchaseCarts)) || { supplier_id: null, items: [] };
    if (!(open.purchases || cart.items.length)) return '';
    const [sups, prods] = await Promise.all([
      callApi(api.listSuppliers),
      callApi(api.listProducts),
    ]);
    const supList = sups || [];
    const prodList = prods || [];
    const sp = supList.find(s => s.supplier_id === cart.supplier_id);
    let h = `<h3>Create New Purchase Order</h3>
    <form data-pg="purchases">
      ${sel('Supplier', 'supplier_id', supList.map(s => [s.supplier_id, s.name]), cart.supplier_id, 'required')}
      ${sel('Product to Receive', 'product_id', prodList.map(p => [p.product_id, `${p.name} (Current stock: ${p.current_stock})`]), '', 'required')}
      ${fld('Quantity Received', 'quantity', 1, 'type=number min=1 required')}
      ${fld('Unit Cost (৳)', 'unit_cost', '', 'type=number min=0 step=0.01 required placeholder="e.g. 450.00"')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="submit">Add to Order</button>
        ${bt('cancel', 'purchases:0', 'Cancel')}
      </div>
    </form>`;

    if (cart.items.length) {
      h += `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <p class="lead"><strong>Selected Supplier:</strong> ${esc(sp ? sp.name : 'Unknown')}</p>` +
        tbl(['Product', 'Quantity', 'Unit Cost', 'Line Cost'], cart.items.map((i, k) => ({
          id: k,
          c: [
            esc((prodList.find(p => p.product_id === i.pid) || {name: 'Product #' + i.pid}).name),
            i.qty,
            money(i.cost),
            `<b class="m">BDT ${money(i.qty * i.cost)}</b>`
          ]
        })), '', r => bt('crm', 'purchases:' + r.id, 'Remove', 'bad')) +
        `<p class="sum" style="font-size:16px;font-weight:700;margin:12px 0">Order Total: BDT ${money(cart.items.reduce((a, i) => a + i.qty * i.cost, 0))}</p>
        <button type="button" class="cta" data-a="csave" data-k="purchases:0">Confirm & Save Purchase</button>
      </div>`;
    }
    return h;
  },
  save: d => callApi(api.addToPurchaseCart, d),
  commit: () => callApi(api.commitPurchase),
  t: async () => {
    const [purs, sups] = await Promise.all([
      callApi(api.listPurchases),
      callApi(api.listSuppliers),
    ]);
    const purList = purs || [];
    const supList = sups || [];
    return tbl(['PO Reference', 'Supplier', 'Date Received', 'Items Count', 'Total Spent'], purList.slice().reverse().map(p => ({
      c: [
        `<span class="pill m">PUR-${String(p.id).padStart(4, '0')}</span>`,
        `<b>${esc((supList.find(s => s.supplier_id === p.sup) || {name: 'Removed Supplier'}).name)}</b>`,
        fD(p.date),
        (p.items || []).length + ' item' + ((p.items || []).length === 1 ? '' : 's'),
        `<b class="m">BDT ${money(p.total)}</b>`,
      ]
    })), (window.SQ = window.SQ || {}).purchases, null, 'No recorded purchase orders.');
  },
  b: async () => {
    const purs = (await callApi(api.listPurchases)) || [];
    return `<div class="band"><div><small>Recorded Purchases</small><b>${purs.length}</b></div><div><small>Total Inventory Inflow</small><b>BDT ${money(purs.reduce((a, p) => a + (p.total || 0), 0))}</b></div><span>&#8601;</span></div>`;
  },
  tb: async () => {
    const purs = (await callApi(api.listPurchases)) || [];
    return purs.length + ' purchase records';
  },
};

// ============================================================
//   5. SALES & RECEIPTS (Outbound Billing)
// ============================================================
P.sales = {
  cart: 1,
  f: async () => {
    if (!canEdit('sales')) return '';
    const open = window.S_open = window.S_open || {};
    const cart = (await callApi(api.listSaleCarts)) || { customer_name: '', items: [] };
    if (!(open.sales || cart.items.length)) return '';
    const [prods, cats] = await Promise.all([
      callApi(api.listProducts),
      canSee('categories') ? callApi(api.listCategories) : Promise.resolve([]),
    ]);
    const prodList = prods || [];
    const catList = cats || [];
    let h = `<h3>Point of Sale &bull; New Invoice</h3>
    <form data-pg="sales">
      ${fld('Customer Name', 'customer_name', cart.customer_name, 'placeholder="Walk-in Customer"')}
      ${sel('Product to Sell', 'product_id', prodList.map(p => [p.product_id, `${p.name} (Stock: ${p.current_stock} | ৳${money(p.unit_price)})`]), '', 'required')}
      ${fld('Quantity', 'quantity', 1, 'type=number min=1 required')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="submit">Add Item to Cart</button>
        ${bt('cancel', 'sales:0', 'Cancel')}
      </div>
    </form>`;

    if (cart.items.length) {
      const lines = cart.items.map(i => {
        const p = prodList.find(x => x.product_id === i.pid) || {};
        const cat = catList.find(c => c.category_id === p.category_id) || { default_tax_rate: p.default_tax_rate || 0 };
        const r = (p.tax_rate_override != null) ? p.tax_rate_override : (cat.default_tax_rate || 0);
        const sub = (p.unit_price || 0) * i.qty;
        const tax = r2(sub * r / 100);
        return { p, r, sub, tax, line: sub + tax };
      });
      const sub = lines.reduce((a, l) => a + l.sub, 0);
      const tax = lines.reduce((a, l) => a + l.tax, 0);
      h += `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">` +
        tbl(['Product', 'Qty', 'Unit Price', 'Tax %', 'Tax', 'Line Total'], lines.map((l, k) => ({
          id: k,
          c: [
            `<b>${esc(l.p.name || 'Product')}</b>`,
            cart.items[k].qty,
            money(l.p.unit_price),
            `${l.r}%`,
            money(l.tax),
            `<b class="m">BDT ${money(l.line)}</b>`
          ]
        })), '', r => bt('crm', 'sales:' + r.id, 'Remove', 'bad')) +
        `<div class="sum" style="font-size:15px;margin:14px 0">
          <span>Subtotal: BDT ${money(sub)}</span> &bull; 
          <span>VAT/Tax: BDT ${money(tax)}</span> &bull; 
          <strong style="font-size:17px;color:var(--accent)">Grand Total: BDT ${money(sub + tax)}</strong>
        </div>
        <button type="button" class="cta" data-a="csave" data-k="sales:0">Complete Sale & Print Receipt</button>
      </div>`;
    }
    return h;
  },
  save: d => callApi(api.addToSaleCart, d),
  commit: () => callApi(api.commitSale),
  t: async () => {
    const sales = (await callApi(api.listSales)) || [];
    return tbl(['Invoice #', 'Customer', 'Date', 'Items Sold', 'Subtotal', 'Tax', 'Grand Total'], sales.slice().reverse().map(s => ({
      id: s.id,
      c: [
        `<span class="pill m">SALE-${String(s.id).padStart(4, '0')}</span>`,
        `<b>${esc(s.cust || 'Walk-in')}</b>`,
        fD(s.date),
        (s.lines || []).length + ' item' + ((s.lines || []).length === 1 ? '' : 's'),
        m(s.sub),
        m(s.tax),
        `<b class="m" style="color:var(--accent)">BDT ${money(s.total)}</b>`,
      ]
    })), (window.SQ = window.SQ || {}).sales, r => bt('rc', 'sales:' + r.id, '<svg class="ic" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px"><use href="#i-coin"/></svg> View Receipt', 'cta'), 'No sales transactions recorded.');
  },
  b: async () => {
    const sales = (await callApi(api.listSales)) || [];
    return `<div class="band"><div><small>Total Invoices</small><b>${sales.length}</b></div><div><small>Gross Revenue</small><b>BDT ${money(sales.reduce((a, s) => a + (s.total || 0), 0))}</b></div><div><small>Collected Tax</small><b>BDT ${money(sales.reduce((a, s) => a + (s.tax || 0), 0))}</b></div><span>&#8599;</span></div>`;
  },
  tb: async () => {
    const sales = (await callApi(api.listSales)) || [];
    return sales.length + ' transactions completed';
  },
  x: async () => {
    const rc = window.S_rc;
    if (rc == null) return '';
    const sales = (await callApi(api.listSales)) || [];
    const s = sales.find(x => x.id === rc);
    if (!s) return '';
    const cashierName = s.cashier || 'System Operator';

    const itemRows = (s.lines || []).map(l => `
      <tr>
        <td><b>${esc(l.name || ('Item #' + l.pid))}</b><br><small class="mut">${esc(l.cat || '')}</small></td>
        <td style="text-align:center">${l.qty}</td>
        <td style="text-align:right">BDT ${money(l.price)}</td>
        <td style="text-align:right">${l.rate}%</td>
        <td style="text-align:right">BDT ${money(l.tax)}</td>
        <td style="text-align:right"><b>BDT ${money(l.line)}</b></td>
      </tr>`).join('');

    return `
    <div class="receipt-box" id="active-receipt-card">
      <div class="rh">
        <div>
          <h3>Sales Receipt &bull; Stockroom</h3>
          <small class="mut">University of Asia Pacific Inventory System</small>
        </div>
        <span class="tag">SALE-${String(s.id).padStart(4, '0')}</span>
      </div>
      <div class="r-meta">
        <div><strong>Date:</strong> <span>${fD(s.date)}</span></div>
        <div><strong>Customer:</strong> <span>${esc(s.cust || 'Walk-in')}</span></div>
        <div><strong>Served by:</strong> <span>${esc(cashierName)}</span></div>
        <div><strong>Payment Status:</strong> <span style="color:#2a9d8f;font-weight:700">&bull; Paid / Settled</span></div>
      </div>
      <div class="r-items">
        <table>
          <thead>
            <tr>
              <th>Item Description</th>
              <th style="text-align:center">Qty</th>
              <th style="text-align:right">Unit Price</th>
              <th style="text-align:right">Tax %</th>
              <th style="text-align:right">Tax</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="6" style="text-align:center">No line items</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="r-tot">
        <div>Order Subtotal: <b>BDT ${money(s.sub)}</b></div>
        <div>VAT / Calculated Tax: <b>BDT ${money(s.tax)}</b></div>
        <div class="gt">Total Paid: BDT ${money(s.total)}</div>
      </div>
      <div class="r-acts">
        <button type="button" class="cta" data-a="print" data-k="sales:${s.id}">
          <svg class="ic" style="margin-right:6px"><use href="#i-coin"/></svg> Print Official Receipt
        </button>
        ${bt('rcx', 'sales:0', 'Close Preview')}
      </div>
    </div>`;
  },
};

// ============================================================
//   6. REPORTS & ANALYTICS
// ============================================================
P.reports = {
  f: async () => {
    const rf = window.SRF = window.SRF || { from: '', to: '', cat: '' };
    const cats = canSee('categories') ? ((await callApi(api.listCategories)) || []) : [];
    const includeSales = canSee('sales');
    return `<h3>Filter Insights</h3>
    <form>
      ${fld('Sales From', 'from', rf.from, 'type=date data-rf=from' + (includeSales ? '' : ' disabled'))}
      ${fld('Sales To', 'to', rf.to, 'type=date data-rf=to' + (includeSales ? '' : ' disabled'))}
      ${sel('Stock Category', 'cat', [['', 'All Categories']].concat(cats.map(c => [c.category_id, c.category_name])), rf.cat, 'data-rf=cat')}
    </form>`;
  },
  x: async () => {
    const rf = window.SRF = window.SRF || { from: '', to: '', cat: '' };
    const [R, cats] = await Promise.all([
      callApi(api.listReports, rf),
      canSee('categories') ? callApi(api.listCategories) : Promise.resolve([]),
    ]);
    const report = R || { stockRows:[], lowRows:[], day:{}, best:{}, tax:{}, includeSales:false };
    const catList = cats || [];
    const catName = id => (catList.find(c => c.category_id === id) || { category_name: '?' }).category_name;
    const blk = (h, t) => `<div class="panel" style="margin-bottom:18px"><h3>${h}</h3>${t}</div>`;
    let out = '';

    out += blk('Current Warehouse Stock', tbl(['SKU', 'Product Name', 'Category', 'Stock Level', 'Reorder Point'], (report.stockRows || []).map(p => ({
      c: [
        esc(p.sku || p.SKU),
        `<b>${esc(p.name || p.NAME)}</b>`,
        esc(p.category_name || catName(p.category_id || p.CATEGORY_ID)),
        `<b>${p.current_stock ?? p.CURRENT_STOCK}</b>`,
        p.reorder_level ?? p.REORDER_LEVEL
      ]
    })), '', null, 'No products found in this category.'));

    out += blk('Low Stock Reorder Triggers', tbl(['SKU', 'Product Name', 'Stock Status', 'Reorder Threshold'], (report.lowRows || []).map(p => ({
      c: [
        esc(p.sku || p.SKU),
        `<b>${esc(p.name || p.NAME)}</b>`,
        `<span class="low" style="font-weight:700;color:#eb5e55">${p.current_stock ?? p.CURRENT_STOCK} remaining</span>`,
        p.reorder_level ?? p.REORDER_LEVEL
      ]
    })), '', null, 'All catalog items are comfortably above their reorder thresholds.'));

    if (report.includeSales) {
      const none = 'No sales recorded during this selected date range.';
      out += blk('Daily Sales Revenue', tbl(['Date', 'Completed Orders', 'Gross Revenue'], Object.entries(report.day || {}).map(([k, v]) => ({
        c: [fD(k), v.n, `<b class="m">BDT ${money(v.t)}</b>`]
      })), '', null, none));

      out += blk('Top 5 Best-Selling Products', tbl(['Product Name', 'Units Sold'], Object.entries(report.best || {}).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({
        c: [`<b>${esc(k)}</b>`, `<b>${v}</b> units`]
      })), '', null, none));

      out += blk('VAT / Tax Revenue Breakdown', tbl(['Category', 'Taxable Sales Amount', 'Tax Collected'], Object.entries(report.tax || {}).map(([k, v]) => ({
        c: [esc(k), m(v.b), `<b class="m" style="color:var(--accent)">BDT ${money(v.x)}</b>`]
      })), '', null, none));
    } else {
      out += blk('Financial & Tax Intelligence', '<p class="lead">Detailed sales revenue and tax reports are restricted to authorized financial roles.</p>');
    }
    return out;
  },
};

// ============================================================
//   7. USERS & ACCESS CONTROL (Admin Control Panel)
// ============================================================
P.users = {
  arr: () => callApi(api.listUsers),
  b: async () => {
    if (!isAdmin()) return '';
    const users = (await callApi(api.listUsers)) || [];
    const total = users.length;
    const admins = users.filter(u => u.role === 'admin').length;
    const sales = users.filter(u => u.role === 'sales_staff').length;
    const clerks = users.filter(u => u.role === 'inventory_clerk').length;

    return `
    <div class="admin-grid">
      <div class="ac">
        <span class="ico" style="background:var(--accent);color:#fff">${ico('users')}</span>
        <div><small>Total Staff Accounts</small><b>${total}</b></div>
      </div>
      <div class="ac">
        <span class="ico" style="background:#eb5e55;color:#fff">${ico('tag')}</span>
        <div><small>System Administrators</small><b>${admins}</b></div>
      </div>
      <div class="ac">
        <span class="ico" style="background:#2a9d8f;color:#fff">${ico('bag')}</span>
        <div><small>Sales Staff (POS)</small><b>${sales}</b></div>
      </div>
      <div class="ac">
        <span class="ico" style="background:#e76f51;color:#fff">${ico('truck')}</span>
        <div><small>Inventory Clerks</small><b>${clerks}</b></div>
      </div>
    </div>`;
  },
  f: async () => {
    if (!isAdmin()) return '';
    const open = window.S_open = window.S_open || {};
    if (!open.users) return '';

    return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="margin-bottom:16px">
        <h3 style="margin:0 0 4px">Staff Account Provisioning Control Panel</h3>
        <p class="lead" style="margin:0">Create new operator credentials with cryptographic database role enforcement.</p>
      </div>
      <form data-pg="users">
        ${fld('Username (System Handle)', 'username', '', 'required pattern="[a-zA-Z0-9_.-]+" placeholder="e.g. rohit"')}
        ${fld('Full Name', 'full_name', '', 'required placeholder="e.g. Rohit Sharma"')}
        ${fld('Initial Password', 'password', '', 'type=password required minlength=4 placeholder="Minimum 4 characters"')}
        ${sel('Assigned System Role', 'role', [
          ['admin', '🛡️ Administrator — Full System Control & Configuration'],
          ['sales_staff', '💼 Sales Staff — POS Terminal, Sales Orders & Receipts'],
          ['inventory_clerk', '📦 Inventory Clerk — Warehouse Inbound, Purchases & Catalog']
        ], 'sales_staff', 'required')}
        <div style="display:flex;gap:10px;margin-top:12px">
          <button type="submit" class="cta">Create Staff Account</button>
          ${bt('cancel', 'users:0', 'Cancel')}
        </div>
      </form>
    </div>`;
  },
  save: d => callApi(api.saveUser, d),
  del: id => callApi(api.deleteUser, id),
  head: ['User ID', 'Staff Member', 'Role & Permissions', 'Quick Role Switcher'],
  t: async () => {
    if (!isAdmin()) return '<p class="lead">Access restricted to system administrators.</p>';
    const [users, me] = await Promise.all([
      callApi(api.listUsers),
      getCurrentUser(),
    ]);
    const userList = users || [];
    const myId = me ? me.user_id : null;

    const rows = userList.map(u => {
      const ini = (u.full_name || u.username || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
      const isSelf = myId === u.id;
      return {
        id: u.id,
        isSelf,
        c: [
          `<span class="pill m">#${u.id}</span>`,
          `<div class="user-cell"><span class="u-av">${ini}</span><div class="u-meta"><b>${esc(u.full_name)}</b><small>@${esc(u.username)}</small></div></div>`,
          `<span class="role-badge ${u.role}">${u.role.replace('_', ' ')}</span>`,
          `<select data-role="${u.id}" ${isSelf ? 'disabled title="You cannot change your own role"' : ''} aria-label="Role of ${esc(u.username)}">
            <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin (Full Access)</option>
            <option value="sales_staff"${u.role === 'sales_staff' ? ' selected' : ''}>Sales Staff (POS Only)</option>
            <option value="inventory_clerk"${u.role === 'inventory_clerk' ? ' selected' : ''}>Inventory Clerk (Stock Only)</option>
          </select>`
        ]
      };
    });

    const acts = r => {
      if (r.isSelf) {
        return '<span class="pill" style="opacity:0.7">Current Session</span>';
      }
      const k = 'users:' + r.id;
      if (window.S_cd === k) return bt('yes', k, 'Confirm Delete', 'bad') + ' ' + bt('no', k, 'Cancel');
      return bt('del', k, 'Delete Account', 'bad');
    };

    return tbl(P.users.head, rows, (window.SQ = window.SQ || {}).users, acts, 'No staff users found.');
  },
};

// ============================================================
//   Generic Module Renderer
// ============================================================
async function renderModule(pg) {
  if (!canSee(pg)) return;
  const root = $('#' + pg + ' .app');
  if (!root) return;
  const p = P[pg];
  if (!p) return;

  // Find if an item is currently being edited
  const editId = (window.S_ed || {})[pg];
  let editItem = null;
  if (editId) {
    if (pg === 'products') {
      const list = (await callApi(api.listProducts)) || [];
      editItem = list.find(x => x.product_id === editId);
    } else if (pg === 'categories') {
      const list = (await callApi(api.listCategories)) || [];
      editItem = list.find(x => x.category_id === editId);
    } else if (pg === 'suppliers') {
      const list = (await callApi(api.listSuppliers)) || [];
      editItem = list.find(x => x.supplier_id === editId);
    }
  }

  // Inline form (Add / Edit)
  const f = root.querySelector('.f');
  if (f && p.f) {
    if (canEdit(pg) || (pg === 'users' && isAdmin())) {
      f.innerHTML = await p.f(editItem);
    } else {
      f.innerHTML = '';
    }
  }

  // Table, banners, filters, extra panels
  const b  = root.querySelector('.b');  if (b  && p.b)  b.innerHTML  = await p.b();
  const tb = root.querySelector('.tb'); if (tb && p.tb) tb.innerHTML = await p.tb();
  const t  = root.querySelector('.t');  if (t  && p.t)  t.innerHTML  = await p.t();
  const tf = root.querySelector('.tf'); if (tf && p.tf) tf.innerHTML = await p.tf();
  const x  = root.querySelector('.x');  if (x  && p.x)  x.innerHTML  = await p.x();
}

// ============================================================
//   Role-Based Access Enforcement
// ============================================================
function access() {
  // 1. Sidebar navigation links
  $$('.side a[href^="#"]').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    if (pg === 'home') { a.hidden = false; return; }
    a.hidden = !canSee(pg);
  });

  // Group container visibility
  $$('.side .grp').forEach(g => {
    const links = [...g.querySelectorAll('a')];
    g.hidden = !links.some(a => !a.hidden);
  });

  const eyebrow = $('.side .g0');
  if (eyebrow) {
    const firstGrp = $('.side .links .grp');
    eyebrow.hidden = firstGrp ? firstGrp.hidden : true;
  }

  // 2. Options cards on home page
  $$('.opts a').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    const li = a.closest('li');
    if (li) li.hidden = !canSee(pg);
  });

  // 3. Quick-action link on home (+ Record a sale)
  $$('.cta[href^="#"]').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    if (pg === 'home') return;
    a.hidden = !canSee(pg);
  });

  // 4. Primary header Add buttons
  $$('button.cta[data-a="new"]').forEach(b => {
    const pg = (b.dataset.k || '').split(':')[0];
    b.hidden = !canEdit(pg);
  });

  // 5. Block direct URL hash tampering
  const h = location.hash.slice(1);
  if (h && h !== 'home' && P[h] != null && !canSee(h)) {
    location.hash = '#home';
  }
  setActive();
}

// ============================================================
//   Overview Dashboard
// ============================================================
async function renderOv() {
  const me = (await getCurrentUser()) || {};
  const hr = new Date().getHours();
  $('#greet').textContent = hr < 12 ? 'Good morning.' : hr < 18 ? 'Good afternoon.' : 'Good evening.';
  $('#eb').textContent = 'Inventory Control System | ' + new Date().toLocaleDateString('en', {weekday:'long'}) + ', at a glance';
  $('#dt').textContent = new Date().toLocaleDateString('en', {weekday:'short', month:'short', day:'numeric'});
  const ini = (me.full_name || me.username || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  $('#av').textContent  = ini;
  $('#av2').textContent = ini;
  const pdAv = $('#pd-av'); if (pdAv) pdAv.textContent = ini;
  const pdName = $('#pd-name'); if (pdName) pdName.textContent = me.full_name || me.username || 'Staff User';
  const pdUser = $('#pd-username'); if (pdUser) pdUser.textContent = '@' + (me.username || 'user');
  const pdRole = $('#pd-role'); if (pdRole) pdRole.textContent = (me.role || '').replace('_', ' ').toUpperCase();

  const [s, days, low, rec] = await Promise.all([
    callApi(api.overviewStats),
    callApi(api.overviewDailySales),
    callApi(api.overviewLowStock),
    callApi(api.overviewRecent),
  ]);
  const stats = s || { totalToday: 0, inventoryValue: 0, products: 0, lowCount: 0, taxAll: 0 };
  const dayList = days || [];
  const lowList = low || [];
  const recList = rec || [];

  const showSales = canSee('sales');
  const mx = Math.max(0, ...dayList.map(x => x.value));
  const max = mx || 1;

  const card = (l, v, sb, ic, c) => `<div class="stat"><div class="stat-h"><span>${l}</span><i class="${c}">${ico(ic)}</i></div><b>${v}</b><small>${sb}</small></div>`;
  const statsHtml = `
    <div class="stats">
      ${showSales ? card('Sales Recorded Today', 'BDT ' + money(stats.totalToday), 'Gross transactions settled today', 'coin', 'i1') : ''}
      ${card('Total Inventory Value', 'BDT ' + money(stats.inventoryValue), 'Valued at acquisition cost', 'box', 'i2')}
      ${card('Cataloged Products', stats.products, 'Active tracked SKUs', 'box', 'i3')}
      ${card('Low Stock Threshold', String(stats.lowCount).padStart(2, '0'), 'Items requiring restocking', 'warn', 'i4')}
    </div>`;

  const chart = `
    <div class="g2">
      ${showSales ? `
        <div class="chart">
          <div class="chart-h"><div><small>Sales Velocity</small><h3>Daily Revenue Momentum</h3></div><small>Last 7 days</small></div>
          <div class="plot"><div class="yax"><span>BDT ${money(mx)}</span><span>BDT ${money(mx/2)}</span><span>0</span></div>
            <div><div class="bars">${dayList.map((x, k) => `<div class="col${k === 6 ? ' now' : ''}"><i style="height:${Math.round(x.value / max * 100)}%" title="BDT ${money(x.value)}"></i></div>`).join('')}</div>
            <div class="days">${dayList.map(x => `<span>${wd(x.date)}</span>`).join('')}</div></div></div>
        </div>` : `
        <div class="chart">
          <div class="chart-h"><div><small>Warehouse</small><h3>Operational Inventory Status</h3></div></div>
          <p class="lead" style="margin-top:14px">Financial and sales momentum data is restricted to sales & management personnel.</p>
        </div>`}
      <div class="chart">
        <div class="chart-h"><div><small>Inventory Watch</small><h3>Urgent Restock Items</h3></div><a class="link" href="#products">Full Catalog &#8599;</a></div>
        ${await renderRestockList(lowList)}
      </div>
    </div>`;

  const recent = `
    <div class="g2">
      <div class="chart">
        <div class="chart-h"><div><small>Operational Audit</small><h3>Recent Transaction Trail</h3></div></div>
        ${recList.length ? recList.map(r => `<div class="row"><span class="circ ${r.kind === 's' ? 'in' : 'out'}">${r.kind === 's' ? '&#8599;' : '&#8601;'}</span><div class="grow"><b>${esc(r.text)}</b><small>${fD(r.date)} | ${r.kind === 's' ? 'Outbound Customer Sale' : 'Inbound Supplier Restock'}</small></div><span class="m">${r.kind === 's' ? '+' : '-'}BDT ${money(r.value)}</span></div>`).join('') : '<p class="lead">No transactions recorded yet.</p>'}
      </div>
      ${showSales ? `
        <div class="chart tint"><small class="k">Collected VAT / Tax</small><b class="big">BDT ${money(stats.taxAll)}</b><small>Total government tax collected to date across settled invoices.</small><div class="row" style="margin-top:22px"><a class="link" href="#reports">Open Tax Breakdown &#8599;</a></div></div>
      ` : ''}
    </div>`;

  $('#ov').innerHTML = statsHtml + chart + recent;
}

async function renderRestockList(low) {
  if (!low.length) return '<p class="lead">All products are healthy and above their reorder thresholds.</p>';
  const sups = canSee('suppliers') ? ((await callApi(api.listSuppliers)) || []) : [];
  const showBtn = canRestock();
  const open = window.S_restock = window.S_restock || null;
  return low.map(p => {
    const isOpen = open === p.id;
    const pct = p.reorder ? Math.min(100, Math.round(p.stock / p.reorder * 100)) : 0;
    const form = isOpen ? `
      <form class="rf" data-restock="${p.id}" style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px">
        <label>Supplier
          <select name="supplier_id" required>
            ${sups.length ? sups.map(s => `<option value="${s.supplier_id}">${esc(s.name)}</option>`).join('') : '<option value="" disabled selected>No suppliers configured</option>'}
          </select>
        </label>
        <label>Units Received
          <input name="quantity" type="number" min="1" step="1" required placeholder="e.g. 50">
        </label>
        <label>Unit Acquisition Cost (৳)
          <input name="unit_cost" type="number" min="0" step="0.01" required placeholder="e.g. 120.00">
        </label>
        <div class="rf-actions" style="display:flex;gap:8px;margin-top:8px">
          <button type="submit" class="cta">Save Inflow</button>
          <button type="button" class="alt" data-a="restock-cancel" data-k="${p.id}">Cancel</button>
        </div>
      </form>` : '';
    return `
      <div class="row restock-row${isOpen ? ' open' : ''}" data-pid="${p.id}">
        <span class="ico">${ico('box')}</span>
        <div class="grow"><b>${esc(p.name)}</b><small>${esc(p.sku)}</small></div>
        <div class="rt">
          <div class="meter"><i style="width:${pct}%"></i></div>
          <small>${p.stock} units left</small>
          ${showBtn ? (isOpen ? '' : `<button type="button" class="alt" data-a="restock" data-k="${p.id}">Restock</button>`) : ''}
        </div>
      </div>
      ${form ? `<div class="restock-form">${form}</div>` : ''}`;
  }).join('');
}

// ============================================================
//   Print Receipt Builder (Exact CSS Match)
// ============================================================
function buildPrintReceipt(s) {
  if (!s) return '';
  const lines = (s.lines || []).map(l => `
    <tr>
      <td><b>${esc(l.name || ('Product #' + l.pid))}</b></td>
      <td style="text-align:center">${l.qty}</td>
      <td style="text-align:right">BDT ${money(l.price)}</td>
      <td style="text-align:right">${l.rate}%</td>
      <td style="text-align:right">BDT ${money(l.tax)}</td>
      <td style="text-align:right"><b>BDT ${money(l.line)}</b></td>
    </tr>`).join('');

  return `
    <div class="ph">
      <div>
        <h1>Stockroom.</h1>
        <small>INVENTORY CONTROL SYSTEM &bull; SALES RECEIPT</small>
      </div>
      <div style="text-align:right">
        <small>INVOICE: SALE-${String(s.id).padStart(4, '0')}</small><br>
        <small>DATE: ${fD(s.date)}</small>
      </div>
    </div>
    <p style="margin:0 0 12px;font-size:12px">
      <strong>Customer:</strong> ${esc(s.cust || 'Walk-in')} &nbsp;|&nbsp;
      <strong>Cashier:</strong> ${esc(s.cashier || 'System Operator')}
    </p>
    <table>
      <thead>
        <tr>
          <th align="left">Item</th>
          <th align="center">Qty</th>
          <th align="right">Unit Price</th>
          <th align="right">Tax Rate</th>
          <th align="right">Tax Amount</th>
          <th align="right">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${lines || '<tr><td colspan="6" align="center">No items</td></tr>'}
      </tbody>
    </table>
    <div class="sum">
      <div>Subtotal: BDT ${money(s.sub)}</div>
      <div>VAT / Tax: BDT ${money(s.tax)}</div>
      <div style="font-size:15px;font-weight:700;margin-top:6px">Grand Total Paid: BDT ${money(s.total)}</div>
    </div>
    <div class="pf-print">
      <span>Stockroom Control Desk &bull; University of Asia Pacific</span>
      <span>Thank you for your business!</span>
    </div>`;
}

// ============================================================
//   Receipt Modal & Profile Dropdown Controls
// ============================================================
function toggleProfileDropdown() {
  const dd = $('#profile-dropdown');
  const tr = $('#profile-trigger');
  if (!dd) return;
  const isOpen = dd.classList.toggle('open');
  if (tr) tr.setAttribute('aria-expanded', String(isOpen));
}

function closeProfileDropdown() {
  const dd = $('#profile-dropdown');
  const tr = $('#profile-trigger');
  if (dd) dd.classList.remove('open');
  if (tr) tr.setAttribute('aria-expanded', 'false');
}

async function showReceiptModal(saleId) {
  const modal = $('#receipt-modal');
  if (!modal) return;
  const sales = (await callApi(api.listSales)) || [];
  const s = sales.find(x => x.id === +saleId);
  if (!s) {
    msg('Could not find sales receipt #' + saleId, 1);
    return;
  }
  const cashierName = s.cashier || 'System Operator';
  const itemRows = (s.lines || []).map(l => `
    <tr>
      <td><b>${esc(l.name || ('Item #' + l.pid))}</b><br><small class="mut">${esc(l.cat || '')}</small></td>
      <td style="text-align:center">${l.qty}</td>
      <td style="text-align:right">BDT ${money(l.price)}</td>
      <td style="text-align:right">${l.rate}%</td>
      <td style="text-align:right">BDT ${money(l.tax)}</td>
      <td style="text-align:right"><b>BDT ${money(l.line)}</b></td>
    </tr>`).join('');

  modal.innerHTML = `
    <div class="modal-backdrop" id="receipt-backdrop" role="presentation">
      <div class="modal-dialog">
        <div class="receipt-box" id="modal-receipt-card" style="box-shadow:0 24px 60px rgba(0,0,0,0.45);border-radius:16px;background:var(--card);margin:0">
          <div class="rh">
            <div>
              <h3 style="margin:0 0 4px">Sales Receipt &bull; Stockroom</h3>
              <small class="mut">University of Asia Pacific Inventory System</small>
            </div>
            <span class="tag">SALE-${String(s.id).padStart(4, '0')}</span>
          </div>
          <div class="r-meta">
            <div><strong>Date:</strong> <span>${fD(s.date)}</span></div>
            <div><strong>Customer:</strong> <span>${esc(s.cust || 'Walk-in')}</span></div>
            <div><strong>Served by:</strong> <span>${esc(cashierName)}</span></div>
            <div><strong>Payment Status:</strong> <span style="color:#2a9d8f;font-weight:700">&bull; Paid / Settled</span></div>
          </div>
          <div class="r-items">
            <table>
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th style="text-align:center">Qty</th>
                  <th style="text-align:right">Unit Price</th>
                  <th style="text-align:right">Tax %</th>
                  <th style="text-align:right">Tax</th>
                  <th style="text-align:right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || '<tr><td colspan="6" style="text-align:center">No line items</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="r-tot">
            <div>Order Subtotal: <b>BDT ${money(s.sub)}</b></div>
            <div>VAT / Calculated Tax: <b>BDT ${money(s.tax)}</b></div>
            <div class="gt">Total Paid: BDT ${money(s.total)}</div>
          </div>
          <div class="r-acts" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px">
            <button type="button" class="cta" data-a="print" data-k="sales:${s.id}">
              <svg class="ic" style="width:16px;height:16px;margin-right:6px;vertical-align:-2px"><use href="#i-coin"/></svg> Print Official Receipt
            </button>
            <button type="button" class="alt" data-a="close-receipt-modal">Close Receipt</button>
          </div>
        </div>
      </div>
    </div>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeReceiptModal() {
  const modal = $('#receipt-modal');
  if (modal) {
    modal.hidden = true;
    modal.innerHTML = '';
  }
  document.body.classList.remove('modal-open');
}

// ============================================================
//   Master Application State & Render
// ============================================================
async function renderAll() {
  const me = await getCurrentUser();
  if (!me) {
    document.body.classList.remove('in');
    return;
  }
  document.body.classList.add('in');
  $('#un').textContent = me.full_name || me.username || '';
  $('#ur').textContent = (me.role || '').replace('_', ' ');

  await loadPerms();
  await renderOv();

  // Render visible page modules concurrently
  const visiblePages = Object.keys(P).filter(pg => canSee(pg));
  await Promise.all(visiblePages.map(pg => renderModule(pg)));
  access();
}

async function login(u) {
  if (!u) {
    $('#lerr').textContent = 'Invalid username or password.';
    return;
  }
  $('#lerr').textContent = '';
  $('#lf').reset();
  invalidatePerms();
  document.body.classList.add('in');
  location.hash = '#home';
  await renderAll();
  window.scrollTo(0, 0);
}

async function logout() {
  await callApi(api.logout);
  invalidatePerms();
  closeProfileDropdown();
  closeReceiptModal();
  document.body.classList.remove('in');
  window.S_open = {};
  window.SQ = {};
  window.SF = {cat:'', lvl:''};
  window.SRF = {from:'', to:'', cat:''};
  window.S_cd = null;
  window.S_rc = null;
  window.S_hist = null;
  window.S_restock = null;
  window.S_ed = {};
  $('#print-receipt').innerHTML = '';
  document.body.classList.remove('printing-receipt');
  $$('.q').forEach(i => i.value = '');
  $('#lf').elements.username.focus();
}

// Initial Scaffold
Object.keys(P).forEach(pg => {
  const root = $('#' + pg + ' .app');
  if (!root) return;
  root.innerHTML = (pg === 'reports')
    ? '<div class="panel f"></div><div class="x"></div>'
    : '<div class="b"></div><div class="panel f"></div><div class="card"><div class="bar"><div class="sw">' + ico('search') + '<input class="q" placeholder="Search..." aria-label="Search"></div><div class="tb"></div></div><div class="t"></div><div class="tf"></div></div><div class="x"></div>';
  const q = $('#' + pg + ' .q');
  if (q) q.placeholder = (pg === 'products') ? 'Search name or SKU...' : (pg === 'sales' ? 'Search customers...' : 'Search...');
});

// ============================================================
//   Global Event Wiring
// ============================================================
document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;

  // Login form
  if (f.id === 'lf') {
    const d = Object.fromEntries(new FormData(f));
    const result = await callApi(api.login, d.username, d.password);
    if (result) await login(result);
    else if (!$('#lerr').textContent) $('#lerr').textContent = 'Invalid username or password.';
    return;
  }

  // Restock form (Overview)
  if (f.classList && f.classList.contains('rf')) {
    const pid = +f.dataset.restock;
    const d = Object.fromEntries(new FormData(f));
    await callApi(api.restockProduct, pid, d.supplier_id, d.quantity, d.unit_cost);
    window.S_restock = null;
    msg('Inventory stock replenished successfully.');
    invalidatePerms();
    await renderAll();
    return;
  }

  // Standard entity form (Products, Categories, Suppliers, Users)
  const pg = f.dataset.pg;
  if (!pg || !P[pg]) return;
  const d = Object.fromEntries(new FormData(f));
  const isEditing = !!(d.product_id || d.category_id || d.supplier_id);
  const result = await P[pg].save(d, d);
  if (result === null) return;

  window.S_ed = window.S_ed || {};
  window.S_ed[pg] = null;
  window.S_open = window.S_open || {};
  window.S_open[pg] = false;

  msg(isEditing ? 'Record updated successfully.' : (P[pg].cart ? 'Item added to order.' : 'New record created successfully.'));
  invalidatePerms();
  await renderAll();
});

document.addEventListener('click', async (ev) => {
  // 1. Profile trigger toggle
  if (ev.target.closest('#profile-trigger')) {
    toggleProfileDropdown();
    return;
  }
  // 2. Click outside profile container -> close dropdown
  if (!ev.target.closest('.profile-menu-container')) {
    closeProfileDropdown();
  }

  // 3. Receipt modal backdrop or close button
  if (ev.target.id === 'receipt-backdrop' || ev.target.closest('[data-a="close-receipt-modal"]')) {
    closeReceiptModal();
    return;
  }

  const b = ev.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const [pg, i] = (b.dataset.k || '').split(':');
  const id = +i;

  if (a === 'logout') {
    await logout();
    return;
  }

  if (a === 'fill') {
    const f = $('#lf');
    f.elements.username.value = pg;
    f.elements.password.value = i;
    return;
  }

  if (a === 'restock') {
    window.S_restock = isNaN(id) ? +pg : id;
    await renderAll();
    return;
  }

  if (a === 'restock-cancel') {
    window.S_restock = null;
    await renderAll();
    return;
  }

  if (a === 'new') {
    window.S_open = window.S_open || {};
    window.S_open[pg] = !window.S_open[pg];
    window.S_ed = window.S_ed || {};
    window.S_ed[pg] = null;
    await renderAll();
    if (window.S_open[pg]) {
      const fEl = $('#' + pg + ' .f');
      if (fEl) fEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  if (a === 'edit') {
    window.S_ed = window.S_ed || {};
    window.S_ed[pg] = id;
    window.S_open = window.S_open || {};
    window.S_open[pg] = true;
    window.S_cd = null;
    await renderAll();
    const fEl = $('#' + pg + ' .f');
    if (fEl) fEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (a === 'cancel') {
    window.S_ed = window.S_ed || {};
    window.S_ed[pg] = null;
    window.S_open = window.S_open || {};
    window.S_open[pg] = false;
    if (pg === 'sales') await callApi(api.removeFromSaleCart, 0);
    if (pg === 'purchases') await callApi(api.removeFromPurchaseCart, 0);
    await renderAll();
    return;
  }

  if (a === 'del') {
    window.S_cd = b.dataset.k;
    await renderAll();
    return;
  }

  if (a === 'no') {
    window.S_cd = null;
    await renderAll();
    return;
  }

  if (a === 'yes') {
    window.S_cd = null;
    if (P[pg] && P[pg].del) {
      const r = await P[pg].del(id);
      if (r !== null) {
        msg('Record deleted successfully.');
        invalidatePerms();
        await renderAll();
      }
    }
    return;
  }

  if (a === 'hist') {
    window.S_hist = id;
    await renderAll();
    setTimeout(() => {
      const xEl = $('#suppliers .x');
      if (xEl) xEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return;
  }

  if (a === 'hx') {
    window.S_hist = null;
    await renderAll();
    return;
  }

  // View Receipt on-screen & in modal
  if (a === 'rc') {
    window.S_rc = id;
    await renderAll();
    await showReceiptModal(id);
    return;
  }

  // Close Receipt preview
  if (a === 'rcx') {
    window.S_rc = null;
    closeReceiptModal();
    $('#print-receipt').innerHTML = '';
    await renderAll();
    return;
  }

  // Remove item from cart
  if (a === 'crm') {
    if (pg === 'sales') await callApi(api.removeFromSaleCart, id);
    else if (pg === 'purchases') await callApi(api.removeFromPurchaseCart, id);
    await renderAll();
    return;
  }

  // Commit sale / purchase
  if (a === 'csave') {
    if (P[pg] && P[pg].commit) {
      const r = await P[pg].commit();
      if (r !== null) {
        window.S_open = window.S_open || {};
        window.S_open[pg] = false;
        if (pg === 'sales') {
          const saleId = (r && r.id != null) ? r.id : (typeof r === 'number' ? r : null);
          if (saleId != null) window.S_rc = saleId;
          msg('Sale recorded successfully! Official receipt is ready.');
          await renderAll();
          if (saleId != null) await showReceiptModal(saleId);
          return;
        } else {
          msg('Purchase order recorded. Stock updated.');
        }
      }
    }
    invalidatePerms();
    await renderAll();
    return;
  }

  // Print Receipt handler
  if (a === 'print') {
    const sales = (await callApi(api.listSales)) || [];
    const targetId = id || window.S_rc;
    const s = sales.find(x => x.id === targetId);
    if (s) {
      $('#print-receipt').innerHTML = buildPrintReceipt(s);
      document.body.classList.add('printing-receipt');

      const cleanup = () => {
        document.body.classList.remove('printing-receipt');
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(() => {
        try {
          window.print();
        } catch {
          msg('Printing is not supported in this browser environment.', 1);
        }
        setTimeout(cleanup, 1500);
      }, 100);
    } else {
      msg('Could not find sales receipt to print.', 1);
    }
    return;
  }

  await renderAll();
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.role) {
    if (isAdmin()) {
      const uid = +t.dataset.role;
      const r = await callApi(api.setUserRole, uid, t.value);
      if (r !== null) {
        msg('Staff role updated to ' + t.value + '.');
      }
      invalidatePerms();
      await renderAll();
    }
  } else if (t.dataset.pf) {
    window.SF = window.SF || {};
    window.SF[t.dataset.pf] = t.value;
    await renderAll();
  } else if (t.dataset.rf) {
    window.SRF = window.SRF || {};
    window.SRF[t.dataset.rf] = t.value;
    await renderAll();
  }
});

document.addEventListener('input', async (ev) => {
  const t = ev.target;
  if (t.classList && t.classList.contains('q')) {
    const pg = t.closest('.page').id;
    window.SQ = window.SQ || {};
    window.SQ[pg] = t.value;
    if (P[pg] && P[pg].t) {
      $('#' + pg + ' .t').innerHTML = await P[pg].t();
    }
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeReceiptModal();
    closeProfileDropdown();
  }
});

window.addEventListener('hashchange', async () => {
  access();
  await renderAll();
});

// App Startup: Verify session & render or display login
async function initApp() {
  const me = await getCurrentUser();
  if (me && me.user_id) {
    document.body.classList.add('in');
    await loadPerms();
    await renderAll();
  } else {
    document.body.classList.remove('in');
    access();
    $('#lf').elements.username.focus();
  }
}

initApp();

})();
