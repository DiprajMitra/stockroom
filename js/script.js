/* =============================================================================
   script.js - Inventory Control System (frontend behaviour)

   This file drives the UI.  It no longer mutates data directly; every read
   and every write goes through window.API, which is the simulated server in
   api.js.  That module enforces role-based access (admin, sales_staff,
   inventory_clerk) - mirroring the stored procedures in
   database/inventory_control_system.sql.  When the API throws an ApiError
   with status 403, the UI surfaces a "not allowed" toast; for other errors
   it surfaces the server message.
   ========================================================================== */

(() => {
'use strict';

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const esc   = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (+n).toFixed(2);
const r2    = n => Math.round(n*100)/100;
const today = () => new Date().toISOString().slice(0,10);

// Centralised API call.  Any 403 is surfaced as a "not allowed" toast and
// swallowed so a single denied call does not break the page; other errors
// are surfaced with their message and re-thrown so the caller can decide.
const api = window.API;
let P_cache = null; // memoised permissions for the current session
function perms() {
  if (P_cache) return P_cache;
  P_cache = api.permissions();
  return P_cache;
}
function invalidatePerms() { P_cache = null; }
function canSee(page) { const p = perms(); return p ? !!p.canSee[page] : false; }
function canEdit(page){ const p = perms(); return p ? !!p.canEdit[page] : false; }
function canRestock() { const p = perms(); return p ? !!p.canRestock : false; }
function isAdmin()    { const p = perms(); return p ? !!p.isAdmin : false; }

function callApi(fn, ...args) {
  try {
    return fn(...args);
  } catch (e) {
    if (e && e.name === 'ApiError') {
      msg(e.status === 403 ? 'Not allowed for your role.' : (e.message || 'Request failed.'), 1);
      return null;
    }
    throw e;
  }
}

// -- toast --
let tm;
const msg = (t, bad) => {
  const el = $('#toast');
  el.textContent = t;
  el.className = bad ? 'bad show' : 'show';
  clearTimeout(tm);
  tm = setTimeout(() => el.className = '', 4000);
};

// -- form / table builders --
const fld = (l, n, v, a='')  => `<label>${l}<input name="${n}" value="${esc(v)}" ${a}></label>`;
const sel = (l, n, items, v, a='') =>
  `<label>${l}<select name="${n}" ${a}>${items.map(([k,t]) => `<option value="${k}"${String(k)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
const tbl = (head, rows, q, act, empty) => {
  q = (q||'').toLowerCase();
  rows = rows.filter(r => !q || r.c.join(' ').replace(/<[^>]*>/g,' ').toLowerCase().includes(q));
  if (!rows.length) return `<p class="lead">${empty || 'Nothing to show.'}</p>`;
  return `<div class="tbl"><table><tr>${head.concat(act?['']:[]).map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.c.map(c=>`<td>${c}</td>`).join('')}${act?`<td>${act(r)}</td>`:''}</tr>`).join('')}</table></div>`;
};
const bt   = (a, k, t) => `<button type="button" class="alt" data-a="${a}" data-k="${k}">${t}</button>`;
const ico  = n  => `<svg class="ic"><use href="#i-${n}"/></svg>`;
const m    = n  => `<span class="m">BDT ${money(n)}</span>`;
const fD   = d  => new Date(d+'T00:00:00').toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'});
const wd   = d  => new Date(d+'T00:00:00').toLocaleDateString('en', {weekday:'short'});

const viewOnly = '<p class="lead">View only. Your role cannot change this page.</p>';

const setActive = () => {
  const h = location.hash.slice(1) || 'home';
  $$('.side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + h));
  const a = $('.side a.on');
  $('#crumb').textContent = a ? a.textContent.trim() : 'Overview';
};

// -- page modules --
// Each module exposes f() (form / inline panel), t() (table) and
// optionally b() (banner) / tb() (filter bar) / tf() (table footer) /
// x() (extra panel).  All data comes from API methods.

const P = {};

// ----------- PRODUCTS -----------
P.products = {
  arr: () => callApi(api.listProducts) || [],
  filter: p => {
    const f = window.SF = window.SF || { cat: '', lvl: '' };
    return (!f.cat || String(p.category_id) === f.cat) &&
           (!f.lvl || (f.lvl === 'low' ? p.current_stock <= p.reorder_level : p.current_stock > p.reorder_level));
  },
  f: e => {
    if (!canEdit('products')) return '';
    const cats = callApi(api.listCategories) || [];
    return `<h3>${e ? 'Edit' : 'Add a'} product</h3><form data-pg="products">${fld('Name','name',e&&e.name,'required')}${fld('SKU','sku',e&&e.sku,'required')}${sel('Category','category_id',cats.map(c=>[c.category_id,c.category_name]),e&&e.category_id,'required')}${fld('Unit price (৳)','unit_price',e&&e.unit_price,'type=number min=0 step=0.01 required')}${fld('Reorder level','reorder_level',e?e.reorder_level:10,'type=number min=0 required')}${fld('Tax override (%)','tax_rate_override',e&&e.tax_rate_override!=null?e.tax_rate_override:'','type=number min=0 max=100 step=0.01 placeholder=Optional')}<button>${e?'Update':'Save'} product</button>${e?bt('cancel','products:0','Cancel'):''}</form>`;
  },
  save: (d, e) => callApi(api.saveProduct, d, e || null),
  del: id => callApi(api.deleteProduct, id),
  head: ['Product','Category','Unit price','Tax rate','In stock','Status'],
  row: p => {
    const cats = callApi(api.listCategories) || [];
    const cat = cats.find(c => c.category_id === p.category_id) || { category_name: '?' };
    const rate = p.tax_rate_override != null ? p.tax_rate_override : cat.default_tax_rate;
    const lo = p.current_stock <= p.reorder_level;
    return { id: p.product_id, c: [
      `<div class="pc"><span class="ico">${ico('box')}</span><div><b>${esc(p.name)}</b><small>${esc(p.sku)}</small></div></div>`,
      `<span class="pill">${esc(cat.category_name)}</span>`,
      m(p.unit_price),
      `<span class="m">${rate}%</span>`,
      `<b class="m">${p.current_stock}</b> <span class="mut m">/ ${p.reorder_level} min</span>`,
      `<span class="st ${lo?'bad':'good'}"><i></i>${lo?'Restock':'In stock'}</span>`,
    ]};
  },
  t: () => {
    const rows = P.products.arr().filter(P.products.filter).map(P.products.row);
    const acts = (canEdit('products') || isAdmin())
      ? r => { const k = 'products:'+r.id; if (window.S_cd === k) return bt('yes',k,'Confirm delete')+bt('no',k,'Cancel');
              return (canEdit('products') ? bt('edit',k,'Edit') : '') + (isAdmin() ? bt('del',k,'Delete') : ''); }
      : null;
    return tbl(P.products.head, rows, (window.SQ = window.SQ || {}).products, acts, 'No products yet.');
  },
  tb: () => {
    const cats = callApi(api.listCategories) || [];
    const f = window.SF = window.SF || { cat: '', lvl: '' };
    return `<select data-pf="cat" aria-label="Category filter"><option value="">All categories</option>${cats.map(c=>`<option value="${c.category_id}"${String(c.category_id)===f.cat?' selected':''}>${esc(c.category_name)}</option>`).join('')}</select><select data-pf="lvl" aria-label="Stock level filter"><option value="">Any stock level</option><option value="low"${f.lvl==='low'?' selected':''}>Needs restock</option><option value="ok"${f.lvl==='ok'?' selected':''}>Healthy</option></select>`;
  },
};

// ----------- CATEGORIES -----------
P.categories = {
  arr: () => callApi(api.listCategories) || [],
  f: e => {
    if (!canEdit('categories')) return '';
    return `<h3>${e ? 'Edit' : 'Add a'} category</h3><form data-pg="categories">${fld('Category name','category_name',e&&e.category_name,'required')}${fld('Default tax rate (%)','default_tax_rate',e?e.default_tax_rate:'','type=number min=0 max=100 step=0.01 required')}<button>${e?'Update':'Save'} category</button>${e?bt('cancel','categories:0','Cancel'):''}</form>`;
  },
  save: (d, e) => callApi(api.saveCategory, d, e || null),
  del: id => callApi(api.deleteCategory, id),
  head: ['Category','Default tax','Products'],
  row: c => ({ id: c.category_id, c: [esc(c.category_name), c.default_tax_rate+'%', (callApi(api.listProducts) || []).filter(p => p.category_id === c.category_id).length] }),
  t: () => {
    const rows = P.categories.arr().map(P.categories.row);
    const acts = (canEdit('categories') || isAdmin())
      ? r => { const k = 'categories:'+r.id; if (window.S_cd === k) return bt('yes',k,'Confirm delete')+bt('no',k,'Cancel');
              return (canEdit('categories') ? bt('edit',k,'Edit') : '') + (isAdmin() ? bt('del',k,'Delete') : ''); }
      : null;
    return tbl(P.categories.head, rows, (window.SQ = window.SQ || {}).categories, acts, 'No categories yet.');
  },
};

// ----------- SUPPLIERS -----------
P.suppliers = {
  arr: () => callApi(api.listSuppliers) || [],
  f: e => {
    if (!canEdit('suppliers')) return '';
    return `<h3>${e ? 'Edit' : 'Add a'} supplier</h3><form data-pg="suppliers">${fld('Name','name',e&&e.name,'required')}${fld('Contact info','contact_info',e&&e.contact_info)}<button>${e?'Update':'Save'} supplier</button>${e?bt('cancel','suppliers:0','Cancel'):''}</form>`;
  },
  save: (d, e) => callApi(api.saveSupplier, d, e || null),
  del: id => callApi(api.deleteSupplier, id),
  xb: id => bt('hist','suppliers:'+id,'History'),
  head: ['Name','Contact','Purchases'],
  row: s => ({ id: s.supplier_id, c: [esc(s.name), esc(s.contact_info)||'-', (callApi(api.listPurchases) || []).filter(p => p.sup === s.supplier_id).length] }),
  t: () => {
    const rows = P.suppliers.arr().map(P.suppliers.row);
    const acts = (canEdit('suppliers') || isAdmin())
      ? r => { const k = 'suppliers:'+r.id; if (window.S_cd === k) return bt('yes',k,'Confirm delete')+bt('no',k,'Cancel');
              return (canEdit('suppliers') ? bt('edit',k,'Edit') : '') + (canEdit('suppliers') ? bt('hist',k,'History') : '') + (isAdmin() ? bt('del',k,'Delete') : ''); }
      : null;
    return tbl(P.suppliers.head, rows, (window.SQ = window.SQ || {}).suppliers, acts, 'No suppliers yet.');
  },
  x: () => {
    const hist = window.S_hist; if (hist == null) return '';
    const sups = callApi(api.listSuppliers) || [];
    const pur  = callApi(api.listPurchases)  || [];
    const s = sups.find(x => x.supplier_id === hist); if (!s) return '';
    const prods = callApi(api.listProducts) || [];
    return `<div class="panel"><h3>Purchases from ${esc(s.name)}</h3>${tbl(['#','Date','Items','Total'], pur.filter(p => p.sup === s.supplier_id).map(p => ({c: [p.id, p.date, p.items.map(i => esc((prods.find(x => x.product_id === i.pid) || {name:'?'}).name) + ' ×' + i.qty).join(', '), money(p.total)]})), '', null, 'No purchases from this supplier yet.')}${bt('hx','suppliers:0','Close')}</div>`;
  },
};

// ----------- PURCHASES -----------
P.purchases = {
  cart: 1,
  f: () => {
    if (!canEdit('purchases')) return '';
    const open = window.S_open = window.S_open || {};
    const cart = (callApi(api.listPurchaseCarts) || { supplier_id: null, items: [] });
    if (!(open.purchases || cart.items.length)) return '';
    const sups = callApi(api.listSuppliers) || [];
    const prods = callApi(api.listProducts)  || [];
    const sp = sups.find(s => s.supplier_id === cart.supplier_id);
    let h = `<h3>New purchase</h3><form data-pg="purchases">${sel('Supplier','supplier_id',sups.map(s=>[s.supplier_id,s.name]),cart.supplier_id,'required')}${sel('Product','product_id',prods.map(p=>[p.product_id,`${p.name} (stock ${p.current_stock})`]),'','required')}${fld('Quantity','quantity',1,'type=number min=1 required')}${fld('Unit cost (৳)','unit_cost','','type=number min=0 step=0.01 required')}<button>Add to purchase</button>${bt('cancel','purchases:0','Cancel')}</form>`;
    if (cart.items.length) {
      h += `<p class="lead">Supplier: ${esc(sp?sp.name:'?')}</p>` + tbl(['Item','Qty','Unit cost','Line cost'], cart.items.map((i,k)=>({id:k,c:[esc((prods.find(p=>p.product_id===i.pid)||{name:'?'}).name),i.qty,money(i.cost),money(i.qty*i.cost)]})), '', r => bt('crm','purchases:'+r.id,'Remove')) +
           `<p class="sum">Total cost ${money(cart.items.reduce((a,i)=>a+i.qty*i.cost,0))}</p><button type="button" data-a="csave" data-k="purchases:0">Save purchase</button>`;
    }
    return h;
  },
  save: d => callApi(api.addToPurchaseCart, d),
  commit: () => { callApi(api.commitPurchase); return null; },
  t: () => {
    const pur = callApi(api.listPurchases) || [];
    const sups = callApi(api.listSuppliers) || [];
    return tbl(['Reference','Supplier','Date','Items','Total'], pur.slice().reverse().map(p => ({c:[
      `<span class="pill m">PUR-${String(p.id).padStart(4,'0')}</span>`,
      `<b>${esc((sups.find(s=>s.supplier_id===p.sup)||{name:'removed supplier'}).name)}</b>`,
      fD(p.date), p.items.length + ' item' + (p.items.length===1?'':'s'),
      `<b class="m">BDT ${money(p.total)}</b>`,
    ]})), (window.SQ = window.SQ || {}).purchases, null, 'No purchases yet.');
  },
  b: () => {
    const pur = callApi(api.listPurchases) || [];
    return `<div class="band"><div><small>Recorded purchases</small><b>${pur.length}</b></div><div><small>Total spent</small><b>BDT ${money(pur.reduce((a,p)=>a+p.total,0))}</b></div><span>&#8601;</span></div>`;
  },
  tb: () => {
    const pur = callApi(api.listPurchases) || [];
    return pur.length + ' purchases';
  },
};

// ----------- SALES -----------
P.sales = {
  cart: 1,
  f: () => {
    if (!canEdit('sales')) return '';
    const open = window.S_open = window.S_open || {};
    const cart = (callApi(api.listSaleCarts) || { customer_name: '', items: [] });
    if (!(open.sales || cart.items.length)) return '';
    const prods = callApi(api.listProducts) || [];
    let h = `<h3>New sale</h3><form data-pg="sales">${fld('Customer','customer_name',cart.customer_name,'placeholder=Walk-in')}${sel('Product','product_id',prods.map(p=>[p.product_id,`${p.name} (stock ${p.current_stock})`]),'','required')}${fld('Quantity','quantity',1,'type=number min=1 required')}<button>Add item</button>${bt('cancel','sales:0','Cancel')}</form>`;
    if (cart.items.length) {
      const lines = cart.items.map(i => {
        const p = prods.find(x => x.product_id === i.pid) || {};
        const cats = callApi(api.listCategories) || [];
        const cat = cats.find(c => c.category_id === p.category_id) || { default_tax_rate: 0 };
        const r = (p.tax_rate_override != null) ? p.tax_rate_override : cat.default_tax_rate;
        const sub = (p.unit_price||0) * i.qty, tax = r2(sub * r / 100);
        return { p, r, sub, tax, line: sub+tax };
      });
      const sub = lines.reduce((a,l)=>a+l.sub,0), tax = lines.reduce((a,l)=>a+l.tax,0);
      h += tbl(['Item','Qty','Price','Tax %','Tax','Line total'], lines.map((l,k)=>({id:k,c:[esc(l.p.name||'?'), cart.items[k].qty, money(l.p.unit_price), l.r+'%', money(l.tax), money(l.line)]})), '', r => bt('crm','sales:'+r.id,'Remove')) +
           `<p class="sum">Subtotal ${money(sub)} | Tax ${money(tax)} | Grand total ${money(sub+tax)}</p><button type="button" data-a="csave" data-k="sales:0">Confirm sale</button>`;
    }
    return h;
  },
  save: d => callApi(api.addToSaleCart, d),
  commit: () => { callApi(api.commitSale); return null; },
  t: () => {
    const sales = callApi(api.listSales) || [];
    return tbl(['Reference','Customer','Date','Items','Subtotal','Tax','Total'], sales.slice().reverse().map(s => ({c:[
      `<span class="pill m">SALE-${String(s.id).padStart(4,'0')}</span>`,
      `<b>${esc(s.cust)}</b>`,
      fD(s.date), s.lines.length + ' item' + (s.lines.length===1?'':'s'),
      m(s.sub), m(s.tax),
      `<b class="m">BDT ${money(s.total)}</b>`,
    ]})), (window.SQ = window.SQ || {}).sales, r => bt('rc','sales:'+r.id,'Receipt'), 'No sales yet.');
  },
  b: () => {
    const sales = callApi(api.listSales) || [];
    return `<div class="band"><div><small>Recorded sales</small><b>${sales.length}</b></div><div><small>Total sales</small><b>BDT ${money(sales.reduce((a,s)=>a+s.total,0))}</b></div><div><small>Tax collected</small><b>BDT ${money(sales.reduce((a,s)=>a+s.tax,0))}</b></div><span>&#8599;</span></div>`;
  },
  tb: () => {
    const sales = callApi(api.listSales) || [];
    return sales.length + ' transactions';
  },
  x: () => {
    const rc = window.S_rc; if (rc == null) return '';
    const sales = callApi(api.listSales) || [];
    const s = sales.find(x => x.id === rc); if (!s) return '';
    const me = callApi(api.currentUser) || {};
    return `<div class="panel"><h3>Receipt #${s.id}</h3><p class="lead">${s.date} | ${esc(s.cust)} | served by ${esc(me.full_name||'a removed user')}</p>${tbl(['Item','Qty','Price','Tax %','Tax','Line total'],s.lines.map(l=>({c:[esc(l.name),l.qty,money(l.price),l.rate+'%',money(l.tax),money(l.line)]})))}<p class="sum">Subtotal ${money(s.sub)} | Tax ${money(s.tax)} | Grand total ${money(s.total)}</p><button type="button" data-a="print" data-k="sales:0">Print</button> ${bt('rcx','sales:0','Close')}</div>`;
  },
};

// ----------- REPORTS -----------
P.reports = {
  f: () => {
    const rf = window.SRF = window.SRF || { from: '', to: '', cat: '' };
    const cats = callApi(api.listCategories) || [];
    const includeSales = canSee('sales');
    return `<h3>Filters</h3><form>${fld('Sales from','from',rf.from,'type=date data-rf=from'+(includeSales?'':' disabled'))}${fld('Sales to','to',rf.to,'type=date data-rf=to'+(includeSales?'':' disabled'))}${sel('Category (stock list)','cat',[['','All categories']].concat(cats.map(c=>[c.category_id,c.category_name])),rf.cat,'data-rf=cat')}</form>`;
  },
  x: () => {
    const rf = window.SRF = window.SRF || { from: '', to: '', cat: '' };
    const R = callApi(api.listReports, rf) || { stockRows:[], lowRows:[], day:{}, best:{}, tax:{}, includeSales:false };
    const prods = callApi(api.listProducts) || [];
    const cats  = callApi(api.listCategories) || [];
    const catName = id => (cats.find(c => c.category_id === id) || { category_name: '?' }).category_name;
    const blk = (h, t) => `<div class="panel"><h3>${h}</h3>${t}</div>`;
    let out = '';
    out += blk('Current stock', tbl(['SKU','Name','Category','Stock','Reorder level'], R.stockRows.map(p => ({c:[esc(p.sku), esc(p.name), esc(catName(p.category_id)), p.current_stock, p.reorder_level]})), '', null, 'No products in this category.'));
    out += blk('Low-stock alerts', tbl(['SKU','Name','Stock','Reorder level'], R.lowRows.map(p => ({c:[esc(p.sku), esc(p.name), `<span class="low">${p.current_stock}</span>`, p.reorder_level]})), '', null, 'No items at or below reorder level.'));
    if (R.includeSales) {
      const none = 'No sales in this period.';
      out += blk('Sales per day', tbl(['Date','Orders','Revenue'], Object.entries(R.day).map(([k,v]) => ({c:[k, v.n, money(v.t)]})), '', null, none));
      out += blk('Best sellers (top 5)', tbl(['Product','Units sold'], Object.entries(R.best).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v]) => ({c:[esc(k), v]})), '', null, none));
      out += blk('Tax collected by category', tbl(['Category','Taxable amount','Tax collected'], Object.entries(R.tax).map(([k,v]) => ({c:[esc(k), money(v.b), money(v.x)]})), '', null, none));
    } else {
      out += blk('Sales & tax', '<p class="lead">Sales and tax data is not available for your role.</p>');
    }
    return out;
  },
};

// ----------- USERS -----------
P.users = {
  arr: () => callApi(api.listUsers) || [],
  edit: false,
  f: () => {
    if (!isAdmin()) return '';
    return `<h3>Add a user</h3><form data-pg="users">${fld('Username','username','','required')}${fld('Full name','full_name','','required')}${fld('Password','password','','type=password required minlength=4')}${sel('Role','role',[['admin','admin'],['sales_staff','sales_staff'],['inventory_clerk','inventory_clerk']],'sales_staff')}<button>Save user</button>${bt('cancel','users:0','Cancel')}</form>`;
  },
  save: d => callApi(api.saveUser, d),
  del: id => callApi(api.deleteUser, id),
  head: ['Username','Full name','Role'],
  row: u => ({ id: u.id, c: [esc(u.username), esc(u.full_name), `<select data-role="${u.id}" aria-label="Role of ${esc(u.username)}">${['admin','sales_staff','inventory_clerk'].map(r => `<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select>`] }),
};

// ============================================================
//   Generic renderer (form / table / actions)
// ============================================================
function renderModule(pg) {
  const root = $('#' + pg + ' .app');
  if (!root) return;
  const p = P[pg];
  if (!p) return;
  // Inline form (Add / Edit) - only if the role can edit this page
  const f = root.querySelector('.f'); if (f) f.innerHTML = canEdit(pg) ? (p.f ? p.f(null) : '') : '';
  // Each module renders its own table.  The module's `t` is responsible
  // for including (or omitting) the action column based on role.
  const t = root.querySelector('.t'); if (t && p.t) t.innerHTML = p.t();
  const tf = root.querySelector('.tf'); if (tf && p.tf) tf.innerHTML = p.tf();
  const tb = root.querySelector('.tb'); if (tb && p.tb) tb.innerHTML = p.tb();
  const b  = root.querySelector('.b');  if (b  && p.b)  b.innerHTML  = p.b();
  const x  = root.querySelector('.x');  if (x  && p.x)  x.innerHTML  = p.x();
}

// ============================================================
//   Role-based access - applied on every render
// ============================================================
function access() {
  // 1. Sidebar items + the group heading that contains them
  $$('.side a[href^="#"]').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    if (pg === 'home') { a.hidden = false; return; }
    a.hidden = !canSee(pg);
  });
  // Group label visible only if at least one link in it is visible.
  // (Skip the .grp containers that are just link groups without their own label.)
  $$('.side .grp').forEach(g => {
    const links = [...g.querySelectorAll('a')];
    g.hidden = !links.some(a => !a.hidden);
  });
  // The "Your business" eyebrow above the first group
  const eyebrow = $('.side .g0');
  if (eyebrow) {
    const firstGrp = $('.side .links .grp');
    eyebrow.hidden = firstGrp ? firstGrp.hidden : true;
  }

  // 2. "All options" cards on the home page
  $$('.opts a').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    a.closest('li').hidden = !canSee(pg);
  });

  // 3. Quick-action links (e.g. "+ Record a sale" CTA on home)
  $$('.cta[href^="#"]').forEach(a => {
    const pg = a.getAttribute('href').slice(1);
    if (pg === 'home') return;
    a.hidden = !canSee(pg);
  });

  // 4. Add buttons on each page header
  $$('button.cta[data-a="new"]').forEach(b => {
    const pg = (b.dataset.k || '').split(':')[0];
    b.hidden = !canEdit(pg);
  });

  // 5. Block direct URL access - if the current hash points to a page
  //    the role cannot see, bounce to #home.
  const h = location.hash.slice(1);
  if (h && h !== 'home' && P[h] != null && !canSee(h)) {
    location.hash = '#home';
  }
  setActive();
}

// ============================================================
//   Overview rendering
// ============================================================
function renderOv() {
  // Personal greeting + date
  const me = callApi(api.currentUser) || {};
  const hr = new Date().getHours();
  $('#greet').textContent = hr<12 ? 'Good morning.' : hr<18 ? 'Good afternoon.' : 'Good evening.';
  $('#eb').textContent = 'Inventory Control System | ' + new Date().toLocaleDateString('en',{weekday:'long'}) + ', at a glance';
  $('#dt').textContent = new Date().toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
  const ini = (me.full_name || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
  $('#av').textContent  = ini;
  $('#av2').textContent = ini;

  // Stats
  const s = callApi(api.overviewStats) || { totalToday: 0, inventoryValue: 0, products: 0, lowCount: 0, taxAll: 0 };
  const days = callApi(api.overviewDailySales) || [];
  const low  = callApi(api.overviewLowStock)   || [];
  const rec  = callApi(api.overviewRecent)     || [];

  const showSales = canSee('sales');
  const mx = Math.max(0, ...days.map(x => x.value));
  const max = mx || 1;

  const card = (l, v, sb, ic, c) => `<div class="stat"><div class="stat-h"><span>${l}</span><i class="${c}">${ico(ic)}</i></div><b>${v}</b><small>${sb}</small></div>`;
  const stats = `
    <div class="stats">
      ${showSales ? card('Sales today','BDT '+money(s.totalToday),'Gross sales recorded today','coin','i1') : ''}
      ${card('Inventory value','BDT '+money(s.inventoryValue),'At latest purchase cost','box','i2')}
      ${card('Products tracked', s.products, 'Across your catalog','box','i3')}
      ${card('Needs a restock', String(s.lowCount).padStart(2,'0'),'At or below reorder point','warn','i4')}
    </div>`;

  const chart = `
    <div class="g2">
      ${showSales ? `
        <div class="chart">
          <div class="chart-h"><div><small>Sales momentum</small><h3>Daily sales</h3></div><small>Last 7 days</small></div>
          <div class="plot"><div class="yax"><span>BDT ${money(mx)}</span><span>BDT ${money(mx/2)}</span><span>0</span></div>
            <div><div class="bars">${days.map((x,k) => `<div class="col${k===6?' now':''}"><i style="height:${Math.round(x.value/max*100)}%" title="BDT ${money(x.value)}"></i></div>`).join('')}</div>
            <div class="days">${days.map(x => `<span>${wd(x.date)}</span>`).join('')}</div></div></div>
        </div>` : `
        <div class="chart">
          <div class="chart-h"><div><small>Inventory</small><h3>Stock at a glance</h3></div></div>
          <p class="lead" style="margin-top:14px">Sales data is not available for your role.</p>
        </div>`}
      <div class="chart">
        <div class="chart-h"><div><small>Inventory watch</small><h3>Restock soon</h3></div><a class="link" href="#products">View catalog &#8599;</a></div>
        ${renderRestockList(low)}
      </div>
    </div>`;

  const recent = `
    <div class="g2">
      <div class="chart">
        <div class="chart-h"><div><small>The paper trail</small><h3>Recent activity</h3></div></div>
        ${rec.length ? rec.map(r => `<div class="row"><span class="circ ${r.kind==='s'?'in':'out'}">${r.kind==='s'?'&#8599;':'&#8601;'}</span><div class="grow"><b>${esc(r.text)}</b><small>${fD(r.date)} | ${r.kind==='s'?'Sale':'Purchase'}</small></div><span class="m">${r.kind==='s'?'+':'-'}BDT ${money(r.value)}</span></div>`).join('') : '<p class="lead">No activity yet.</p>'}
      </div>
      ${showSales ? `
        <div class="chart tint"><small class="k">Tax collected</small><b class="big">BDT ${money(s.taxAll)}</b><small>Collected to date across recorded sales.</small><div class="row" style="margin-top:22px"><a class="link" href="#reports">Explore tax reports &#8599;</a></div></div>
      ` : ''}
    </div>`;

  $('#ov').innerHTML = stats + chart + recent;
}

// Restock list - shows a "Restock" button on each row when the role can
// edit purchases, and renders the inline restock form when requested.
function renderRestockList(low) {
  if (!low.length) return '<p class="lead">Everything is above its reorder level.</p>';
  const sups = callApi(api.listSuppliers) || [];
  const showBtn = canRestock();
  const open = window.S_restock = window.S_restock || null; // currently open product id
  return low.map(p => {
    const isOpen = open === p.id;
    const pct = p.reorder ? Math.min(100, Math.round(p.stock / p.reorder * 100)) : 0;
    const form = isOpen ? `
      <form class="rf" data-restock="${p.id}">
        <label>Supplier<select name="supplier_id" required>
          ${sups.length ? sups.map(s => `<option value="${s.supplier_id}">${esc(s.name)}</option>`).join('') : '<option value="" disabled selected>No suppliers - add one first</option>'}
        </select></label>
        <label>Quantity received<input name="quantity" type="number" min="1" step="1" required placeholder="e.g. 20"></label>
        <label>Unit cost (৳)<input name="unit_cost" type="number" min="0" step="0.01" required placeholder="e.g. 500"></label>
        <div class="rf-actions">
          <button type="submit">Save restock</button>
          <button type="button" class="alt" data-a="restock-cancel" data-k="${p.id}">Cancel</button>
        </div>
      </form>` : '';
    return `
      <div class="row restock-row${isOpen?' open':''}" data-pid="${p.id}">
        <span class="ico">${ico('box')}</span>
        <div class="grow"><b>${esc(p.name)}</b><small>${esc(p.sku)}</small></div>
        <div class="rt">
          <div class="meter"><i style="width:${pct}%"></i></div>
          <small>${p.stock} left</small>
          ${showBtn ? (isOpen ? '' : `<button type="button" class="alt" data-a="restock" data-k="${p.id}">Restock</button>`) : ''}
        </div>
      </div>
      ${form ? `<div class="restock-form">${form}</div>` : ''}`;
  }).join('');
}

// ============================================================
//   Login / logout / navigation
// ============================================================
function renderAll() {
  renderOv();
  const me = callApi(api.currentUser);
  $('#un').textContent = me ? me.full_name : '';
  $('#ur').textContent = me ? me.role.replace('_',' ') : '';
  Object.keys(P).forEach(renderModule);
  access();
}

function login(u) {
  // The actual authentication happens via api.login() which throws on bad creds.
  // The UI just sets the body class and the new session.
  if (!u) {
    $('#lerr').textContent = 'Wrong username or password.';
    return;
  }
  $('#lerr').textContent = '';
  $('#lf').reset();
  document.body.classList.add('in');
  location.hash = '#home';
  invalidatePerms();
  renderAll();
  window.scrollTo(0, 0);
  $('#lf').elements.username.blur();
}

function logout() {
  callApi(api.logout);
  document.body.classList.remove('in');
  invalidatePerms();
  // Wipe transient UI state that the next user must not see.
  window.S_open = {}; window.SQ = {}; window.SF = {cat:'',lvl:''}; window.SRF = {from:'',to:'',cat:''};
  window.S_cd = null; window.S_rc = null; window.S_hist = null; window.S_restock = null;
  $('#print-receipt').innerHTML = '';
  document.body.classList.remove('printing-receipt');
  $$('.q').forEach(i => i.value = '');
  $('#lf').elements.username.focus();
}

// ============================================================
//   Static page scaffolding
// ============================================================
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
//   Event wiring
// ============================================================
document.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;
  // -- Login form --
  if (f.id === 'lf') {
    const d = Object.fromEntries(new FormData(f));
    const result = callApi(api.login, d.username, d.password);
    if (result) login(result);
    else if (!$('#lerr').textContent) $('#lerr').textContent = 'Wrong username or password.';
    return;
  }
  // -- Restock form (Overview) --
  if (f.classList && f.classList.contains('rf')) {
    const pid = +f.dataset.restock;
    const d = Object.fromEntries(new FormData(f));
    const before = callApi(api.overviewLowStock) || [];
    callApi(api.restockProduct, pid, d.supplier_id, d.quantity, d.unit_cost);
    window.S_restock = null;
    const after = callApi(api.overviewLowStock) || [];
    const wasLow = before.some(p => p.id === pid);
    const stillLow = after.some(p => p.id === pid);
    msg(wasLow && !stillLow ? 'Restock saved. Stock is now above reorder level.' : 'Restock saved. Stock updated.', 0);
    renderAll();
    return;
  }
  // -- Module form (Add / Edit) --
  const pg = f.dataset.pg;
  if (!pg || !P[pg]) return;
  const d = Object.fromEntries(new FormData(f));
  const result = callApi(P[pg].save, d, null);
  if (result === null) return; // API threw, already toasted
  window.S_ed = window.S_ed || {};
  window.S_ed[pg] = null;
  if (!P[pg].cart) window.S_open = window.S_open || {}, window.S_open[pg] = false;
  msg(P[pg].cart ? 'Item added.' : 'Saved.');
  renderAll();
});

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const [pg, i] = (b.dataset.k || '').split(':');
  const id = +i;

  if (a === 'logout')   { logout(); return; }
  if (a === 'fill')     { const f = $('#lf'); f.elements.username.value = pg; f.elements.password.value = i; return; }
  if (a === 'restock')  { window.S_restock = isNaN(id) ? +pg : id; renderAll(); return; }
  if (a === 'restock-cancel') { window.S_restock = null; renderAll(); return; }
  if (a === 'edit')     { window.S_ed = window.S_ed || {}; window.S_ed[pg] = id; window.S_cd = null; renderAll(); $('#'+pg+' .f').scrollIntoView({block:'center'}); return; }
  if (a === 'new')      { window.S_open = window.S_open || {}; window.S_open[pg] = !window.S_open[pg]; window.S_ed = window.S_ed || {}; window.S_ed[pg] = null; renderAll(); if (window.S_open[pg]) $('#'+pg+' .f').scrollIntoView({block:'center'}); return; }
  if (a === 'cancel')   { window.S_ed = window.S_ed || {}; window.S_ed[pg] = null; window.S_open = window.S_open || {}; window.S_open[pg] = false; if (pg === 'sales' || pg === 'purchases') { callApi((pg==='sales'?api.removeFromSaleCart:api.removeFromPurchaseCart), 0); } renderAll(); return; }
  if (a === 'del')      { window.S_cd = b.dataset.k; renderAll(); return; }
  if (a === 'no')       { window.S_cd = null; renderAll(); return; }
  if (a === 'yes')      {
    window.S_cd = null;
    if (P[pg] && P[pg].del) {
      const r = P[pg].del(id);
      if (r === null) return; // API error already toasted
      msg('Deleted.');
      renderAll();
    }
    return;
  }
  if (a === 'hist')     { window.S_hist = id; renderAll(); return; }
  if (a === 'hx')       { window.S_hist = null; renderAll(); return; }
  if (a === 'rc')       { window.S_rc = id; if (pg==='sales' && isAdmin()) $('#print-receipt').innerHTML = buildPrintReceipt(getSaleForPrint(id)); renderAll(); return; }
  if (a === 'rcx')      { window.S_rc = null; $('#print-receipt').innerHTML = ''; renderAll(); return; }
  if (a === 'crm') {
    if (pg === 'sales') callApi(api.removeFromSaleCart, id);
    else if (pg === 'purchases') callApi(api.removeFromPurchaseCart, id);
    renderAll();
    return;
  }
  if (a === 'csave') {
    if (P[pg] && P[pg].commit) {
      const r = P[pg].commit();
      if (r !== null && r !== undefined) { msg(r, 1); renderAll(); return; }
      window.S_open = window.S_open || {}; window.S_open[pg] = false;
      msg(pg === 'sales' ? 'Sale saved. Stock updated.' : 'Purchase saved. Stock updated.');
    }
    renderAll();
    return;
  }
  if (a === 'print') {
    if (isAdmin()) {
      const s = getSaleForPrint(id || window.S_rc);
      if (s) {
        $('#print-receipt').innerHTML = buildPrintReceipt(s);
        document.body.classList.add('printing-receipt');
        setTimeout(() => {
          try { window.print(); } catch (e) { msg('Printing is not available here.', 1); }
          document.body.classList.remove('printing-receipt');
        }, 50);
      }
    } else {
      document.body.classList.remove('printing-receipt');
      try { window.print(); } catch (e) { msg('Printing is not available here.', 1); }
    }
    return;
  }
  // Default - re-render so the click has visual effect.
  renderAll();
});

function getSaleForPrint(id) {
  const sales = callApi(api.listSales) || [];
  return sales.find(x => x.id === id) || null;
}

// buildPrintReceipt was referenced by the Print button but never defined.
// Produces a printable HTML receipt the user can submit to the OS print
// dialog (only the #print-receipt container is visible under @media print).
function buildPrintReceipt(s) {
  if (!s) return '';
  const me = callApi(api.currentUser) || {};
  const lines = (s.lines || []).map(l => `
    <tr>
      <td>${esc(l.name || ('Product #' + l.pid))}</td>
      <td style="text-align:right">${l.qty}</td>
      <td style="text-align:right">BDT ${money(l.price)}</td>
      <td style="text-align:right">${l.rate}%</td>
      <td style="text-align:right">BDT ${money(l.tax)}</td>
      <td style="text-align:right">BDT ${money(l.line)}</td>
    </tr>`).join('');
  return `
    <div class="receipt">
      <h2>Stockroom</h2>
      <p class="mut">Receipt for SALE-${String(s.id).padStart(4, '0')}</p>
      <p>Date: ${esc(s.date)} &middot; Customer: ${esc(s.cust || 'Walk-in')}</p>
      <p>Served by: ${esc(me.full_name || 'a removed user')}</p>
      <table>
        <thead><tr>
          <th align="left">Item</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Tax %</th>
          <th>Tax</th>
          <th>Line</th>
        </tr></thead>
        <tbody>${lines || '<tr><td colspan="6">No items</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="5" align="right">Subtotal</td><td align="right">BDT ${money(s.sub)}</td></tr>
          <tr><td colspan="5" align="right">Tax</td><td align="right">BDT ${money(s.tax)}</td></tr>
          <tr><td colspan="5" align="right"><b>Total</b></td><td align="right"><b>BDT ${money(s.total)}</b></td></tr>
        </tfoot>
      </table>
      <p class="mut">Thank you for your business.</p>
    </div>`;
}

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'me') {
    callApi(api.loginAs, t.value); // not exposed; ignore
  } else if (t.dataset.role) {
    if (isAdmin()) { callApi(api.setUserRole, t.dataset.role, t.value); msg('Role changed.'); access(); renderAll(); }
  } else if (t.dataset.pf) {
    window.SF = window.SF || {}; window.SF[t.dataset.pf] = t.value; renderAll();
  } else if (t.dataset.rf) {
    window.SRF = window.SRF || {}; window.SRF[t.dataset.rf] = t.value; renderAll();
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.classList && t.classList.contains('q')) {
    const pg = t.closest('.page').id;
    window.SQ = window.SQ || {}; window.SQ[pg] = t.value;
    $('#' + pg + ' .t').innerHTML = P[pg] && P[pg].t ? P[pg].t() : '';
  }
});

// Block direct URL access.  hashchange fires when the user types into the
// address bar or pastes a URL - we re-check on every change and bounce to
// #home if the role cannot see the requested page.
window.addEventListener('hashchange', () => { access(); renderAll(); });

// Initial render (no user yet - shows the login page).
access();
renderAll();
$('#lf').elements.username.focus();

})();
