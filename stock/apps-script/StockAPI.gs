/**
 * TL Pathak Group — Stock Live API (Google Apps Script)
 * ------------------------------------------------------
 * Paste into Extensions → Apps Script of your TL Pathak Google Sheet
 * (the same sheet your dashboard reads). Then:
 *   1. LOGINS – to share the TL Pathak dashboard's accounts (same email + password, register → admin approves),
 *      first set Script properties APP_SHEET_ID and APP_TOKEN_SECRET (see "users & sign-in" below).
 *      Then run setup() once (approve permissions). It makes sure pathakh@gmail.com is an admin.
 *      Standalone (no APP_SHEET_ID): setup() creates pathakh@gmail.com and prints a ONE-TIME password
 *      in View → Logs; the app asks you to choose your own at first sign-in. (resetAdminPassword() prints a new one.)
 *   2. Project Settings → Script properties → set:
 *        GEMINI_KEY   = your Gemini API key (photo reading + "Ask the stock")
 *        GEMINI_MODEL = optional, default gemini-3.8-flash (any current model id from ai.google.dev/pricing)
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *      Copy the /exec URL into the stock app and the dashboard widget.
 *
 * Sheets created: Stock, Stock_Locations, Stock_Log, Purchase_Invoices, Purchases
 *   Purchases = one row per invoice line (group, rate, landed cost) → your dashboard reads buy prices from here.
 *   Purchase data, buy prices and price lists are only returned to admin accounts.
 * Users: shared with the dashboard's Users tab (linked mode) or Stock_Users here – passwords stored only as salted hashes.
 * Sales: Sales_Invoices (one row per bill), Sales (one row per line), Clients (one row per customer — your CRM list).
 */

const P = PropertiesService.getScriptProperties();
const SH_ITEMS = 'Stock', SH_LOC = 'Stock_Locations', SH_LOG = 'Stock_Log', SH_INV = 'Purchase_Invoices', SH_PUR = 'Purchases';
const INV_COLS = ['id','date','supplier','gstin','invoiceNo','locationId','locationName','subtotal','tax','freight','total','images','notes','by','createdAt','linesJson'];
const SINV_COLS = ['id','date','invoiceNo','seller','clientKey','clientName','clientGstin','clientPhone','locationId','locationName','subtotal','tax','freight','total','images','notes','by','createdAt','linesJson','stockOutJson'];
const SAL_COLS = ['invoiceId','date','invoiceNo','clientName','group','desc','serial','qty','rate','amount','gst','locationName'];
const CLI_COLS = ['key','name','contactPerson','phone','email','gstin','address','city','state','firstSeen','lastSale','updatedAt'];
const PL_COLS = ['id','manufacturer','brand','validFrom','currency','discount','terms','fileName','pages','itemCount','by','createdAt'];
const PLI_COLS = ['listId','manufacturer','validFrom','category','group','model','desc','specs','listPrice','gst','priceIncludesGst','netPrice','unit','notes','type','size'];
const SH_PL = 'Price_Lists', SH_PLI = 'Price_List_Items';
const SH_USR = 'Stock_Users', USR_COLS = ['email','name','role','location','active','salt','passHash','mustChange','createdAt','lastLogin'];
const OWNER_EMAIL = 'pathakh@gmail.com';
const ROLES = ['admin','staff','viewer'];
const SH_SINV = 'Sales_Invoices', SH_SAL = 'Sales', SH_CLI = 'Clients';
const PUR_COLS = ['invoiceId','date','supplier','invoiceNo','group','desc','hsn','qty','unit','rate','amount','gst','landedPerUnit','locationName'];
const ITEM_COLS = ['id','name','category','type','size','group','brand','model','serial','condition','specsJson','specsText',
  'locationId','locationName','qty','status','reservedFor','notes','photos','addedBy','updatedBy','createdAt','updatedAt','soldAt'];
const LOC_COLS = ['id','name','kind','city','createdAt'];
const LOG_COLS = ['at','by','action','itemId','itemName','qty','from','to','note','fromName','toName'];
const CATS = ["Machine Tools","CNC","Sheet Metal","Construction","Material Handling","Wood & uPVC","Recycling","Special Purpose","Spares & Tools","Other"];
const COND = ["New","Used","Refurbished","Display"];

/* ---------------- setup ---------------- */
function setup() {
  const ss = ss_();
  ensure_(ss, SH_ITEMS, ITEM_COLS);
  const loc = ensure_(ss, SH_LOC, LOC_COLS);
  ensure_(ss, SH_LOG, LOG_COLS);
  ensure_(ss, SH_INV, INV_COLS);
  ensure_(ss, SH_PUR, PUR_COLS);
  ensure_(ss, SH_SINV, SINV_COLS);
  ensure_(ss, SH_SAL, SAL_COLS);
  ensure_(ss, SH_CLI, CLI_COLS);
  ensure_(ss, SH_PL, PL_COLS);
  ensure_(ss, SH_PLI, PLI_COLS);
  if (loc.getLastRow() < 2) {
    const now = Date.now();
    [['howrah-hq','Howrah HQ Showroom','showroom','Salkia, Howrah'],['kolkata','Kolkata Showroom','showroom','Kolkata'],
     ['bengaluru','Bengaluru Showroom','showroom','Bengaluru'],['coimbatore','Coimbatore Showroom','showroom','Coimbatore'],
     ['cuttack','Cuttack Showroom','showroom','Cuttack'],['bhubaneswar','Bhubaneswar Showroom','showroom','Bhubaneswar'],
     ['ludhiana','Ludhiana Showroom','showroom','Ludhiana'],['howrah-wh','Howrah Main Warehouse','warehouse','Howrah']]
      .forEach(r => loc.appendRow([...r, now]));
  }
  folder_();
  folder_('INV_FOLDER', 'TL Pathak Purchase Invoices');
  folder_('SALE_FOLDER', 'TL Pathak Sales Invoices');
  if (!linked_()) ensure_(ss, SH_USR, USR_COLS);
  bump_();
  const owner = findUser_(OWNER_EMAIL);
  if (owner && linked_()) {
    if (owner.role !== 'admin' || !owner.active) upsertUser_({ email: OWNER_EMAIL, role: 'admin', active: true }, false);
    Logger.log('Linked to the dashboard accounts. Sign in as ' + OWNER_EMAIL + ' with your DASHBOARD password.');
  } else if (!owner) {
    const tmp = upsertUser_({ email: OWNER_EMAIL, name: 'Hitesh Pathak', role: 'admin', active: true }, true);
    Logger.log('Admin account created: ' + OWNER_EMAIL + '   ONE-TIME password: ' + tmp + '   (you will set your own at first sign-in)');
  } else Logger.log('Setup done. Admin ' + OWNER_EMAIL + ' already exists (run resetAdminPassword() if you forgot the password).');
  Logger.log('Add GEMINI_KEY in Project Settings → Script properties.');
}
function resetAdminPassword() {
  if (!linked_()) ensure_(ss_(), SH_USR, USR_COLS);
  const tmp = upsertUser_({ email: OWNER_EMAIL, name: (findUser_(OWNER_EMAIL) || {}).name || 'Hitesh Pathak', role: 'admin', active: true }, true);
  Logger.log('New ONE-TIME password for ' + OWNER_EMAIL + ': ' + tmp);
}
function ss_() { const id = P.getProperty('SHEET_ID'); return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet(); }
function ensure_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#0D2F6E').setFontColor('#ffffff'); }
  return sh;
}
function folder_(key, name) {
  key = key || 'PHOTO_FOLDER'; name = name || 'TL Pathak Stock Photos';
  let id = P.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(name);
  P.setProperty(key, f.getId());
  return f;
}
function bump_() { P.setProperty('VER', String(Date.now())); }

/* ---------------- http ---------------- */
function doGet(e) { return handle_(e.parameter || {}, false); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'Bad JSON' }); }
  return handle_(body, true);
}
function out_(o, cb) {
  const s = JSON.stringify(o);
  if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) return ContentService.createTextOutput(cb + '(' + s + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}
function handle_(p, isPost) {
  const cb = p.callback;
  try {
    const a = p.action || 'all';
    if (a === 'login') return out_(login_(String(p.email || ''), String(p.password || '')), cb);
    if (a === 'register') { const lk = LockService.getScriptLock(); lk.waitLock(20000); try { return out_(register_(p.name, p.email, String(p.password || '')), cb); } finally { lk.releaseLock(); } }
    if (a === 'mode') return out_({ ok: true, linked: linked_(), shared: linked_() && !!P.getProperty('APP_TOKEN_SECRET') }, cb);
    const me = session_(String(p.session || ''));
    if (!me) return out_({ ok: false, error: 'SIGNED_OUT' }, cb);
    if (a === 'logout') { P.deleteProperty('S_' + p.session); return out_({ ok: true }, cb); }
    if (a === 'changePassword') return out_(changePw_(me, String(p.old || ''), String(p.password || '')), cb);
    if (me.mustChange) return out_({ ok: false, error: 'CHANGE_PASSWORD' }, cb);
    if (a === 'me') return out_({ ok: true, user: pub_(me) }, cb);
    if (a === 'myLocation') { if (p.location) P.setProperty('LOC_' + me.email, String(p.location)); return out_({ ok: true }, cb); }
    const admin = me.role === 'admin', viewer = me.role === 'viewer', cost = admin || !!me.cost;
    if (a === 'users') { if (!admin) return out_({ ok: false, error: 'Admins only' }, cb); return out_({ ok: true, linked: linked_(), users: allUsers_().map(pub_) }, cb); }
    if (a === 'saveUser' || a === 'resetPassword') {
      if (!admin) return out_({ ok: false, error: 'Admins only' }, cb);
      const u = p.user || {}; if (a === 'resetPassword') { const ex = findUser_(p.email); if (!ex) throw new Error('No such user'); u.email = ex.email; }
      if (typeof u.active === 'string') u.active = u.active === 'true'; if (typeof u.cost === 'string') u.cost = u.cost === 'true';
      if (String(u.email).toLowerCase() === OWNER_EMAIL && (u.role !== 'admin' || u.active === false)) throw new Error('The owner account must stay an active admin');
      const isNew = !findUser_(u.email);
      const tmp = upsertUser_(u, a === 'resetPassword' || isNew);
      return out_({ ok: true, tempPassword: tmp || '', users: allUsers_().map(pub_) }, cb);
    }
    if (!isPost) {
      if (a === 'ver') return out_({ ok: true, ver: P.getProperty('VER') || '0' }, cb);
      if (a === 'all') return out_({ ok: true, data: state_(cost) }, cb);
      if (a === 'buyPrices') { if (!cost) return out_({ ok: false, error: 'Your login cannot see buy prices' }, cb); return out_({ ok: true, data: buyPrices_() }, cb); }
      if (a === 'summary') return out_({ ok: true, data: summary_(p.q || '', p.location || '') }, cb);
      return out_({ ok: false, error: 'Unknown action' }, cb);
    }
    if (viewer) return out_({ ok: false, error: 'Your account is view-only' });
    if (a === 'vision') return out_({ ok: true, result: vision_(String(p.prompt || ''), p.images || []) });
    if (a === 'json') return out_({ ok: true, result: jsonText_(String(p.prompt || '')) });
    if (a === 'transcribe') return out_({ ok: true, text: transcribe_(String(p.audio || '')) });
    if (a === 'text') return out_({ ok: true, answer: gemini_([{ text: String(p.prompt || '').slice(0, 200000) }], false) });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const by = String(me.name || me.email).slice(0, 40);
      let res = {};
      switch (a) {
        case 'addItem': res = addItem_(p.item || {}, p.photos || [], by); break;
        case 'adjust': res = adjust_(p.id, +p.delta || 0, by, p.photos); break;
        case 'updateItem': res = updateItem_(p.id, p.patch || {}, by); break;
        case 'move': res = move_(p.id, p.to, +p.qty || 1, p.status || 'In stock', p.note || '', by); break;
        case 'sell': res = sell_(p.id, +p.qty || 1, p.note || '', by); break;
        case 'reserve': res = reserve_(p.id, !!p.on, p.name || '', by); break;
        case 'deleteItem': if (!admin) throw new Error('Admins only'); res = deleteItem_(p.id, by); break;
        case 'saveLocation': if (!admin) throw new Error('Admins only'); res = saveLoc_(p.loc || {}); break;
        case 'deleteLocation': if (!admin) throw new Error('Admins only'); res = deleteLoc_(p.id); break;
        case 'savePurchase': if (!cost) throw new Error('Your login cannot see buy prices'); res = savePurchase_(p.rec || {}, p.photos || [], by); break;
        case 'saveSale': res = saveSale_(p.rec || {}, p.photos || [], by); break;
        case 'deleteSale': if (!admin) throw new Error('Admins only'); res = deleteSale_(p.id); break;
        case 'savePriceList': if (!cost) throw new Error('Your login cannot see buy prices'); res = savePriceList_(p.rec || {}, p.photos || [], by); break;
        case 'deletePriceList': if (!admin) throw new Error('Admins only'); res = deletePriceList_(p.id); break;
        case 'deletePurchase': if (!admin) throw new Error('Admins only'); res = deletePurchase_(p.id); break;
        default: throw new Error('Unknown action');
      }
      bump_();
      SpreadsheetApp.flush();
      return out_({ ok: true, res: res, data: state_(cost) });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) }, cb);
  }
}

/* ---------------- table helpers ---------------- */
function rows_(name, cols) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
  return v.map((r, ix) => { const o = { _row: ix + 2 }; cols.forEach((c, i) => o[c] = r[i]); return o; });
}
function toItem_(r) {
  let specs = [];
  try { specs = r.specsJson ? JSON.parse(r.specsJson) : []; } catch (e) {}
  return { id: String(r.id), name: r.name, category: r.category, type: r.type, size: r.size, group: r.group, brand: r.brand,
    model: String(r.model || ''), serial: String(r.serial || ''), condition: r.condition, specs: specs, locationId: r.locationId,
    qty: +r.qty || 0, status: r.status || 'In stock', reservedFor: r.reservedFor, notes: r.notes,
    photos: r.photos ? String(r.photos).split(' ').filter(Boolean) : [], addedBy: r.addedBy, updatedBy: r.updatedBy,
    createdAt: +r.createdAt || 0, updatedAt: +r.updatedAt || 0, soldAt: +r.soldAt || 0 };
}
function locs_() { return rows_(SH_LOC, LOC_COLS).map(r => ({ id: String(r.id), name: r.name, kind: r.kind || 'showroom', city: r.city })); }
function locName_(id) { const l = locs_().find(x => x.id === id); return l ? l.name : ''; }
function findItem_(id) { const r = rows_(SH_ITEMS, ITEM_COLS).find(x => String(x.id) === String(id)); if (!r) throw new Error('Item not found — refresh'); return r; }
function writeItem_(rowNum, it) {
  const sh = ss_().getSheetByName(SH_ITEMS);
  const specs = (it.specs || []).filter(s => s && (s.label || s.value));
  const rec = Object.assign({}, it, {
    specsJson: JSON.stringify(specs), specsText: specs.map(s => s.label + ': ' + s.value).join('; '),
    locationName: locName_(it.locationId), photos: (it.photos || []).join(' ')
  });
  const row = ITEM_COLS.map(c => rec[c] === undefined || rec[c] === null ? '' : rec[c]);
  if (rowNum) sh.getRange(rowNum, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}
function log_(o) {
  const sh = ss_().getSheetByName(SH_LOG);
  const rec = Object.assign({ at: Date.now() }, o, { fromName: o.from ? locName_(o.from) : '', toName: o.to ? locName_(o.to) : '' });
  sh.appendRow(LOG_COLS.map(c => rec[c] === undefined ? '' : rec[c]));
}
function state_(admin) {
  const items = rows_(SH_ITEMS, ITEM_COLS).map(toItem_);
  const lg = rows_(SH_LOG, LOG_COLS).slice(-150).reverse().map(r => ({ at: +r.at, by: r.by, action: r.action, itemId: String(r.itemId), itemName: r.itemName, qty: +r.qty || 0, from: r.from, to: r.to, note: r.note }));
  const st = { items: items, locations: locs_(), log: lg, ver: P.getProperty('VER') || '0' };
  st.sales = sales_(); st.clients = clients_();
  if (admin) { st.purchases = purchases_(); st.priceLists = priceLists_(); }
  return st;
}
function groupOf_(i) { return i.group || [i.type, i.size].filter(Boolean).join(' · ') || i.name || 'Ungrouped'; }
function isLive_(i) { return i.status !== 'Sold' && (+i.qty || 0) > 0; }

/* ---------------- photos ---------------- */
function savePhotos_(arr, label, inv) {
  const f = inv === 'sale' ? folder_('SALE_FOLDER', 'TL Pathak Sales Invoices') : inv ? folder_('INV_FOLDER', 'TL Pathak Purchase Invoices') : folder_(), urls = [];
  (arr || []).slice(0, inv ? 6 : 2).forEach((d, ix) => {
    const m = String(d).match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m) return;
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (label || 'machine').replace(/[^\w\- ]/g, '').slice(0, 40) + '_' + Date.now() + '_' + ix + '.jpg');
    const file = f.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push('https://lh3.googleusercontent.com/d/' + file.getId() + '=' + (inv ? 'w1600' : 'w800'));   // public image address: loads on any phone
  });
  return urls;
}

/* ---------------- actions ---------------- */
function addItem_(it, photos, by) {
  const now = Date.now();
  const item = {
    id: 'it' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(it.name || it.group || '').slice(0, 120), category: CATS.indexOf(it.category) >= 0 ? it.category : 'Other',
    type: it.type || '', size: it.size || '', group: it.group || it.name || '', brand: it.brand || '', model: it.model || '',
    serial: it.serial || '', condition: COND.indexOf(it.condition) >= 0 ? it.condition : 'New', specs: it.specs || [],
    locationId: it.locationId || '', qty: Math.max(1, +it.qty || 1), status: it.status || 'In stock', reservedFor: '',
    notes: it.notes || '', photos: savePhotos_(photos, it.name), addedBy: by, updatedBy: by, createdAt: now, updatedAt: now, soldAt: ''
  };
  if (!item.locationId) throw new Error('Location missing');
  writeItem_(0, item);
  log_({ by: by, action: 'add', itemId: item.id, itemName: item.name, qty: item.qty, to: item.locationId });
  return { id: item.id };
}
function adjust_(id, delta, by, photos) {
  const r = findItem_(id), it = toItem_(r);
  it.qty = Math.max(0, it.qty + delta);
  if (it.qty > 0 && it.status === 'Sold') it.status = 'In stock';
  if (photos && photos.length && !it.photos.length) it.photos = savePhotos_(photos, it.name);
  it.updatedAt = Date.now(); it.updatedBy = by;
  writeItem_(r._row, it);
  log_({ by: by, action: delta > 0 ? 'add' : 'remove', itemId: it.id, itemName: it.name, qty: Math.abs(delta), [delta > 0 ? 'to' : 'from']: it.locationId });
  return { qty: it.qty };
}
function updateItem_(id, patch, by) {
  const r = findItem_(id), it = toItem_(r), oldQty = it.qty;
  ['name','category','type','size','group','brand','model','serial','condition','specs','status','reservedFor','notes'].forEach(k => { if (patch[k] !== undefined) it[k] = patch[k]; });
  if (patch.qty !== undefined) it.qty = Math.max(0, +patch.qty || 0);
  if (it.status !== 'Reserved') it.reservedFor = '';
  it.updatedAt = Date.now(); it.updatedBy = by;
  writeItem_(r._row, it);
  log_({ by: by, action: 'edit', itemId: it.id, itemName: it.name, from: it.locationId, note: oldQty !== it.qty ? ('qty ' + oldQty + ' → ' + it.qty) : '' });
  return {};
}
function move_(id, to, n, st, note, by) {
  if (!to) throw new Error('Choose destination');
  const r = findItem_(id), it = toItem_(r), now = Date.now(), from = it.locationId;
  if (!isLive_(it)) throw new Error('Nothing left to move');
  n = Math.min(it.qty, Math.max(1, n));
  if (n >= it.qty) {
    it.locationId = to; it.status = st; it.updatedAt = now; it.updatedBy = by; writeItem_(r._row, it);
  } else {
    it.qty -= n; it.updatedAt = now; it.updatedBy = by; writeItem_(r._row, it);
    const all = rows_(SH_ITEMS, ITEM_COLS);
    const dr = all.find(x => { const d = toItem_(x); return d.id !== it.id && isLive_(d) && d.locationId === to && groupOf_(d) === groupOf_(it) && d.model === it.model && !d.serial && !it.serial && d.status === st && (d.condition || 'New') === (it.condition || 'New'); });
    if (dr) { const d = toItem_(dr); d.qty += n; d.updatedAt = now; d.updatedBy = by; writeItem_(dr._row, d); }
    else { const c = Object.assign({}, it, { id: 'it' + now.toString(36) + Math.random().toString(36).slice(2, 6), qty: n, locationId: to, status: st, createdAt: now, addedBy: by }); writeItem_(0, c); }
  }
  log_({ by: by, action: 'move', itemId: id, itemName: it.name, qty: n, from: from, to: to, note: note + (st === 'In transit' ? (note ? ' · ' : '') + 'in transit' : '') });
  return {};
}
function sell_(id, n, note, by) {
  const r = findItem_(id), it = toItem_(r);
  if (!isLive_(it)) throw new Error('Nothing left to sell');
  n = Math.min(it.qty, Math.max(1, n));
  it.qty -= n;
  if (it.qty <= 0) { it.status = 'Sold'; it.soldAt = Date.now(); }
  it.updatedAt = Date.now(); it.updatedBy = by;
  writeItem_(r._row, it);
  log_({ by: by, action: 'sell', itemId: id, itemName: it.name, qty: n, from: it.locationId, note: note });
  return {};
}
function reserve_(id, on, name, by) {
  const r = findItem_(id), it = toItem_(r);
  it.status = on ? 'Reserved' : 'In stock'; it.reservedFor = on ? name : '';
  it.updatedAt = Date.now(); it.updatedBy = by;
  writeItem_(r._row, it);
  log_({ by: by, action: 'reserve', itemId: id, itemName: it.name, qty: it.qty, from: it.locationId, note: on ? (name || 'reserved') : 'Released' });
  return {};
}
function deleteItem_(id, by) {
  const r = findItem_(id);
  ss_().getSheetByName(SH_ITEMS).deleteRow(r._row);
  log_({ by: by, action: 'delete', itemId: id, itemName: r.name, from: r.locationId });
  return {};
}
function saveLoc_(l) {
  const name = String(l.name || '').trim(); if (!name) throw new Error('Name needed');
  const sh = ss_().getSheetByName(SH_LOC);
  const ex = l.id ? rows_(SH_LOC, LOC_COLS).find(x => String(x.id) === String(l.id)) : null;
  if (ex) sh.getRange(ex._row, 2, 1, 3).setValues([[name, l.kind || 'showroom', l.city || '']]);
  else sh.appendRow([name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-3), name, l.kind || 'showroom', l.city || '', Date.now()]);
  return {};
}
function deleteLoc_(id) {
  const n = rows_(SH_ITEMS, ITEM_COLS).map(toItem_).filter(i => isLive_(i) && i.locationId === id).length;
  if (n) throw new Error('Move its ' + n + ' stock records out first');
  const ex = rows_(SH_LOC, LOC_COLS).find(x => String(x.id) === String(id));
  if (ex) ss_().getSheetByName(SH_LOC).deleteRow(ex._row);
  return {};
}

/* ---------------- summary (for dashboard / quote maker) ---------------- */
function summary_(q, location) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const locs = locs_(), ln = id => (locs.find(l => l.id === id) || {}).name || 'Unassigned';
  const groups = {};
  rows_(SH_ITEMS, ITEM_COLS).map(toItem_).filter(isLive_).forEach(i => {
    if (location && i.locationId !== location) return;
    if (words.length) {
      const hay = [i.name, groupOf_(i), i.type, i.size, i.brand, i.model, i.category, ln(i.locationId)].join(' ').toLowerCase();
      if (!words.every(w => hay.indexOf(w) >= 0)) return;
    }
    const g = groupOf_(i);
    const G = groups[g] = groups[g] || { group: g, category: i.category || 'Other', total: 0, free: 0, reserved: 0, inTransit: 0, byLocation: {}, photo: '' };
    G.total += i.qty;
    if (i.status === 'In stock') G.free += i.qty;
    if (i.status === 'Reserved') G.reserved += i.qty;
    if (i.status === 'In transit') G.inTransit += i.qty;
    const L = ln(i.locationId); G.byLocation[L] = (G.byLocation[L] || 0) + i.qty;
    if (!G.photo && i.photos.length) G.photo = i.photos[0];
  });
  const list = Object.keys(groups).map(k => groups[k]).sort((a, b) => a.category.localeCompare(b.category) || a.group.localeCompare(b.group));
  const byLoc = {}; list.forEach(g => Object.keys(g.byLocation).forEach(l => byLoc[l] = (byLoc[l] || 0) + g.byLocation[l]));
  return { groups: list, byLocation: byLoc, total: list.reduce((a, g) => a + g.total, 0), free: list.reduce((a, g) => a + g.free, 0), ver: P.getProperty('VER') || '0' };
}

/* ---------------- Gemini ---------------- */
function gemini_(parts, json, temp) {
  const key = P.getProperty('GEMINI_KEY');
  if (!key) throw new Error('GEMINI_KEY not set in Script properties');
  const model = P.getProperty('GEMINI_MODEL') || 'gemini-3.8-flash';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: json ? { responseMimeType: 'application/json', temperature: temp === undefined ? 0.2 : temp } : { temperature: temp === undefined ? 0.3 : temp } })
  });
  const j = JSON.parse(res.getContentText());
  if (j.error) throw new Error('Gemini: ' + j.error.message);
  const c = ((j.candidates || [])[0] || {}).content;
  if (!c || !c.parts) throw new Error('Gemini gave no answer — try a clearer photo');
  return c.parts.map(p => p.text || '').join('');
}
function vision_(prompt, images) {
  if (!images.length) throw new Error('No photo');
  const parts = [{ text: prompt.slice(0, 60000) }];
  images.slice(0, 6).forEach(d => { const m = String(d).match(/^data:(image\/[a-z]+);base64,(.+)$/); if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); });
  const txt = gemini_(parts, true).replace(/^```(json)?|```$/g, '').trim();
  try { return JSON.parse(txt); } catch (e) { const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(txt.slice(a, b + 1)); throw new Error('AI reply was unclear - try again'); }
}

/* ---------------- purchases (admin only) ---------------- */
function n_(v) { const x = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(x) ? x : 0; }
function purchases_() {
  return rows_(SH_INV, INV_COLS).map(r => {
    let lines = []; try { lines = r.linesJson ? JSON.parse(r.linesJson) : []; } catch (e) {}
    const d = r.date instanceof Date ? Utilities.formatDate(r.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r.date || '');
    return { id: String(r.id), date: d, supplier: r.supplier, gstin: r.gstin, invoiceNo: String(r.invoiceNo || ''), locationId: r.locationId,
      subtotal: n_(r.subtotal), tax: n_(r.tax), freight: n_(r.freight), total: n_(r.total), images: r.images ? String(r.images).split(' ').filter(Boolean) : [],
      notes: r.notes, by: r.by, createdAt: +r.createdAt || 0, lines: lines };
  });
}
function addOrInc_(it, qty, by) {
  const all = rows_(SH_ITEMS, ITEM_COLS), now = Date.now();
  const mr = all.find(x => { const d = toItem_(x); return isLive_(d) && d.locationId === it.locationId && groupOf_(d).toLowerCase() === groupOf_(it).toLowerCase() && !d.serial && d.status === 'In stock' && (d.condition || 'New') === 'New' && !d.model; });
  if (mr) { const d = toItem_(mr); d.qty += qty; d.updatedAt = now; d.updatedBy = by; writeItem_(mr._row, d); log_({ by: by, action: 'add', itemId: d.id, itemName: d.name, qty: qty, to: d.locationId }); return; }
  const item = { id: 'it' + now.toString(36) + Math.random().toString(36).slice(2, 6), name: it.name, category: it.category || 'Machine Tools', type: '', size: '', group: it.group, brand: '', model: '', serial: '', condition: 'New', specs: [], locationId: it.locationId, qty: qty, status: 'In stock', reservedFor: '', notes: it.notes || '', photos: [], addedBy: by, updatedBy: by, createdAt: now, updatedAt: now, soldAt: '' };
  writeItem_(0, item); log_({ by: by, action: 'add', itemId: item.id, itemName: item.name, qty: qty, to: item.locationId });
}
function savePurchase_(rec, photos, by) {
  const now = Date.now(), id = 'pi' + now.toString(36) + Math.random().toString(36).slice(2, 5);
  const lines = (rec.lines || []).slice(0, 60).map(l => ({ desc: String(l.desc || '').slice(0, 200), hsn: String(l.hsn || ''), qty: n_(l.qty), unit: String(l.unit || 'Nos'), rate: n_(l.rate), amount: n_(l.amount), gst: n_(l.gst), group: String(l.group || '').trim(), addStock: !!l.addStock }));
  const sub = lines.reduce((a, l) => a + l.amount, 0) || 1, freight = n_(rec.freight), ln = locName_(rec.locationId || '');
  const images = savePhotos_(photos, (rec.supplier || 'invoice') + ' ' + (rec.invoiceNo || ''), true);
  ss_().getSheetByName(SH_INV).appendRow([id, rec.date || '', rec.supplier || '', rec.gstin || '', "'" + (rec.invoiceNo || ''), rec.locationId || '', ln, n_(rec.subtotal), n_(rec.tax), freight, n_(rec.total), images.join(' '), rec.notes || '', by, now, JSON.stringify(lines)]);
  const pur = ss_().getSheetByName(SH_PUR);
  lines.forEach(l => { const landed = l.rate + (freight * l.amount / sub) / (l.qty || 1); pur.appendRow([id, rec.date || '', rec.supplier || '', "'" + (rec.invoiceNo || ''), l.group, l.desc, l.hsn, l.qty, l.unit, l.rate, l.amount, l.gst, Math.round(landed * 100) / 100, ln]); });
  lines.filter(l => l.addStock && l.group && l.qty > 0).forEach(l => addOrInc_({ name: l.desc || l.group, group: l.group, locationId: rec.locationId, notes: 'From invoice ' + (rec.invoiceNo || '') + ' · ' + (rec.supplier || '') }, Math.round(l.qty), by));
  log_({ by: by, action: 'purchase', itemName: (rec.supplier || 'Supplier') + ' inv ' + (rec.invoiceNo || ''), to: rec.locationId || '', note: lines.some(l => l.addStock) ? 'stock added' : '' });
  return { id: id };
}
function deletePurchase_(id) {
  const ss = ss_();
  const ir = rows_(SH_INV, INV_COLS).find(x => String(x.id) === String(id));
  if (ir) ss.getSheetByName(SH_INV).deleteRow(ir._row);
  const pr = rows_(SH_PUR, PUR_COLS).filter(x => String(x.invoiceId) === String(id)).map(x => x._row).sort((a, b) => b - a);
  pr.forEach(r => ss.getSheetByName(SH_PUR).deleteRow(r));
  return {};
}
function buyPrices_() {
  const g = {};
  rows_(SH_PUR, PUR_COLS).forEach(r => { if (!r.group) return; const d = r.date instanceof Date ? Utilities.formatDate(r.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r.date); (g[r.group] = g[r.group] || []).push({ rate: n_(r.rate), landed: n_(r.landedPerUnit), qty: n_(r.qty) || 1, supplier: r.supplier, date: d }); });
  return Object.keys(g).map(k => { const a = g[k].sort((x, y) => String(y.date).localeCompare(String(x.date))); const tq = a.reduce((s, x) => s + x.qty, 0) || 1;
    return { group: k, last: a[0].rate, lastLanded: a[0].landed, avg: Math.round(a.reduce((s, x) => s + x.rate * x.qty, 0) / tq), min: Math.min.apply(null, a.map(x => x.rate)), supplier: a[0].supplier, date: a[0].date, buys: a.length }; });
}

/* ---------------- sales & clients ---------------- */
function d_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || ''); }
function sales_() {
  const cl = rows_(SH_CLI, CLI_COLS);
  return rows_(SH_SINV, SINV_COLS).map(r => {
    let lines = [], so = []; try { lines = JSON.parse(r.linesJson || '[]'); so = JSON.parse(r.stockOutJson || '[]'); } catch (e) {}
    const c = (cl.find(x => String(x.key) === String(r.clientKey)) || {});
    return { id: String(r.id), date: d_(r.date), invoiceNo: String(r.invoiceNo || ''), seller: r.seller, clientKey: String(r.clientKey), locationId: r.locationId,
      client: { name: r.clientName || c.name || '', gstin: r.clientGstin || c.gstin || '', phone: String(r.clientPhone || c.phone || ''), email: c.email || '', address: c.address || '', city: c.city || '', state: c.state || '', contactPerson: c.contactPerson || '' },
      subtotal: n_(r.subtotal), tax: n_(r.tax), freight: n_(r.freight), total: n_(r.total), images: r.images ? String(r.images).split(' ').filter(Boolean) : [],
      notes: r.notes, by: r.by, createdAt: +r.createdAt || 0, lines: lines, stockOut: so };
  });
}
function clients_() {
  return rows_(SH_CLI, CLI_COLS).map(r => ({ id: String(r.key), key: String(r.key), name: r.name, contactPerson: r.contactPerson, phone: String(r.phone || ''), email: r.email, gstin: r.gstin, address: r.address, city: r.city, state: r.state, firstSeen: d_(r.firstSeen), lastSale: d_(r.lastSale) }));
}
function saveSale_(rec, photos, by) {
  const now = Date.now(), id = 'si' + now.toString(36) + Math.random().toString(36).slice(2, 5), ss = ss_();
  const c = rec.client || {}, key = String(rec.clientKey || ('n-' + String(c.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-'))).slice(0, 80);
  if (!c.name) throw new Error('Client name needed');
  // client upsert (keeps existing values when the new bill leaves a field blank)
  const cli = ss.getSheetByName(SH_CLI), ex = rows_(SH_CLI, CLI_COLS).find(x => String(x.key) === key);
  const merged = {}; CLI_COLS.forEach(k => merged[k] = ex ? ex[k] : '');
  ['name','contactPerson','phone','email','gstin','address','city','state'].forEach(k => { if (c[k]) merged[k] = (k === 'phone' ? "'" : '') + c[k]; });
  merged.key = key; merged.lastSale = rec.date || ''; merged.updatedAt = now; if (!ex) merged.firstSeen = rec.date || '';
  const crow = CLI_COLS.map(k => merged[k] === undefined ? '' : merged[k]);
  if (ex) cli.getRange(ex._row, 1, 1, crow.length).setValues([crow]); else cli.appendRow(crow);
  // stock out
  const lines = (rec.lines || []).slice(0, 60).map(l => ({ desc: String(l.desc || ''), hsn: String(l.hsn || ''), serial: String(l.serial || ''), qty: n_(l.qty), unit: String(l.unit || 'Nos'), rate: n_(l.rate), amount: n_(l.amount), gst: n_(l.gst), group: String(l.group || '').trim(), fromStock: !!l.fromStock }));
  const stockOut = [], rank = (i, l) => (l.serial && i.serial && i.serial.toLowerCase() === l.serial.toLowerCase() ? 0 : 10) + ({ 'In stock': 0, 'Reserved': 1, 'Demo': 2, 'In transit': 3 }[i.status] || 4);
  lines.filter(l => l.fromStock && l.group && l.qty > 0).forEach(l => {
    let need = Math.round(l.qty);
    rows_(SH_ITEMS, ITEM_COLS).map(r => ({ r: r, i: toItem_(r) })).filter(x => isLive_(x.i) && x.i.locationId === rec.locationId && groupOf_(x.i).toLowerCase() === l.group.toLowerCase())
      .sort((a, b) => rank(a.i, l) - rank(b.i, l)).forEach(x => {
        if (need <= 0) return; const t = Math.min(x.i.qty, need); x.i.qty -= t; need -= t;
        if (x.i.qty <= 0) { x.i.status = 'Sold'; x.i.soldAt = now; x.i.reservedFor = ''; }
        x.i.updatedAt = now; x.i.updatedBy = by; writeItem_(x.r._row, x.i); stockOut.push({ itemId: x.i.id, qty: t, line: l.desc });
        log_({ by: by, action: 'sell', itemId: x.i.id, itemName: x.i.name, qty: t, from: x.i.locationId, note: 'Inv ' + (rec.invoiceNo || '') + ' · ' + c.name });
      });
  });
  const images = savePhotos_(photos, c.name + ' ' + (rec.invoiceNo || ''), 'sale'), ln = locName_(rec.locationId || '');
  ss.getSheetByName(SH_SINV).appendRow([id, rec.date || '', "'" + (rec.invoiceNo || ''), rec.seller || '', key, c.name, c.gstin || '', "'" + (c.phone || ''), rec.locationId || '', ln, n_(rec.subtotal), n_(rec.tax), n_(rec.freight), n_(rec.total), images.join(' '), rec.notes || '', by, now, JSON.stringify(lines), JSON.stringify(stockOut)]);
  const sal = ss.getSheetByName(SH_SAL);
  lines.forEach(l => sal.appendRow([id, rec.date || '', "'" + (rec.invoiceNo || ''), c.name, l.group, l.desc, l.serial, l.qty, l.rate, l.amount, l.gst, ln]));
  if (!stockOut.length) log_({ by: by, action: 'sale', itemName: c.name + ' inv ' + (rec.invoiceNo || ''), from: rec.locationId || '' });
  return { id: id };
}
function deleteSale_(id) {
  const ss = ss_();
  const r = rows_(SH_SINV, SINV_COLS).find(x => String(x.id) === String(id));
  if (r) ss.getSheetByName(SH_SINV).deleteRow(r._row);
  rows_(SH_SAL, SAL_COLS).filter(x => String(x.invoiceId) === String(id)).map(x => x._row).sort((a, b) => b - a).forEach(n => ss.getSheetByName(SH_SAL).deleteRow(n));
  return {};
}

/* ---------------- manufacturer price lists (admin) ---------------- */
function jsonText_(prompt) {
  const txt = gemini_([{ text: prompt.slice(0, 200000) }], true).replace(/^```(json)?|```$/g, '').trim();
  try { return JSON.parse(txt); } catch (e) { const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(txt.slice(a, b + 1)); throw new Error('AI reply was unclear - try again'); }
}
function plNet_(it, disc) { const p = n_(it.listPrice), g = n_(it.gst); const ex = it.priceIncludesGst && g ? p / (1 + g / 100) : p; return Math.round(ex * (1 - n_(disc) / 100)); }
function priceLists_() {
  const items = rows_(SH_PLI, PLI_COLS);
  return rows_(SH_PL, PL_COLS).map(r => ({ id: String(r.id), manufacturer: r.manufacturer, brand: r.brand, validFrom: d_(r.validFrom), currency: r.currency || 'INR', discount: n_(r.discount), terms: r.terms, fileName: r.fileName,
    pages: r.pages ? String(r.pages).split(' ').filter(Boolean) : [], itemCount: +r.itemCount || 0, by: r.by, createdAt: +r.createdAt || 0,
    items: items.filter(i => String(i.listId) === String(r.id)).map(i => ({ category: i.category, group: i.group, model: String(i.model || ''), desc: i.desc, specs: i.specs, listPrice: n_(i.listPrice), gst: n_(i.gst), priceIncludesGst: i.priceIncludesGst === true || i.priceIncludesGst === 'TRUE', unit: i.unit, notes: i.notes, type: i.type, size: i.size })) }));
}
function savePriceList_(rec, photos, by) {
  const now = Date.now(), id = 'pl' + now.toString(36) + Math.random().toString(36).slice(2, 5), ss = ss_();
  const items = (rec.items || []).slice(0, 3000);
  const pages = savePhotos_(photos, (rec.manufacturer || 'price list') + ' price list', true);
  ss.getSheetByName(SH_PL).appendRow([id, rec.manufacturer || '', rec.brand || '', rec.validFrom || '', rec.currency || 'INR', n_(rec.discount), rec.terms || '', rec.fileName || '', pages.join(' '), items.length, by, now]);
  if (items.length) {
    const rows = items.map(i => [id, rec.manufacturer || '', rec.validFrom || '', i.category || '', i.group || '', "'" + (i.model || ''), i.desc || '', i.specs || '', n_(i.listPrice), n_(i.gst), !!i.priceIncludesGst, plNet_(i, rec.discount), i.unit || '', i.notes || '', i.type || '', i.size || '']);
    const sh = ss.getSheetByName(SH_PLI); sh.getRange(sh.getLastRow() + 1, 1, rows.length, PLI_COLS.length).setValues(rows);
  }
  return { id: id };
}
function deletePriceList_(id) {
  const ss = ss_();
  const r = rows_(SH_PL, PL_COLS).find(x => String(x.id) === String(id)); if (r) ss.getSheetByName(SH_PL).deleteRow(r._row);
  rows_(SH_PLI, PLI_COLS).filter(x => String(x.listId) === String(id)).map(x => x._row).sort((a, b) => b - a).forEach(n => ss.getSheetByName(SH_PLI).deleteRow(n));
  return {};
}

/* ---------------- users & sign-in ----------------
 * TWO MODES
 *  A) LINKED to the TL Pathak dashboard / sales app (recommended): set Script properties
 *       APP_SHEET_ID      = ID of the "TL Pathak App Data" Google Sheet (from its URL)
 *       APP_TOKEN_SECRET  = copy of TOKEN_SECRET from the dashboard's Apps Script properties
 *     → the SAME accounts (Users tab) work in both apps: register → admin approves → sign in.
 *       role "admin" = admin here; "can_view_cost" ticked = sees buy prices / purchase bills / price lists.
 *       A person already signed in to the dashboard on that browser is signed in here automatically.
 *  B) STANDALONE: accounts live in this sheet's Stock_Users tab.
 */
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function tru_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function linked_() { return !!P.getProperty('APP_SHEET_ID'); }
function appUsers_() {
  const sh = SpreadsheetApp.openById(P.getProperty('APP_SHEET_ID')).getSheetByName('Users');
  if (!sh) throw new Error('Users tab not found in the dashboard sheet (APP_SHEET_ID)');
  const v = sh.getDataRange().getValues(), h = (v[0] || []).map(x => String(x).trim());
  const rows = [];
  for (let r = 1; r < v.length; r++) { const o = { _row: r + 1 }; h.forEach((k, c) => o[k] = v[r][c]); if (o.email) rows.push(o); }
  return { sh: sh, h: h, rows: rows };
}
function setCells_(t, row, changes) { Object.keys(changes).forEach(k => { const c = t.h.indexOf(k); if (c >= 0) t.sh.getRange(row._row, c + 1).setValue(changes[k]); }); }
function hasStock_(access) { const a = String(access || '').trim(); return !a || a.split(',').map(x => x.trim()).indexOf('stock') >= 0; }
/* one shape for both modes: {id,email,name,role(admin|staff|viewer),cost,active,pending,location,mustChange,lastLogin} */
function userFrom_(raw) {
  if (linked_()) {
    const admin = String(raw.role || '').toLowerCase() === 'admin';
    return { id: String(raw.id || ''), email: norm_(raw.email), name: raw.full_name || raw.email, role: admin ? 'admin' : 'staff', cost: admin || tru_(raw.can_view_cost),
      active: tru_(raw.approved) && (admin || hasStock_(raw.access)), pending: !tru_(raw.approved), noStock: tru_(raw.approved) && !admin && !hasStock_(raw.access),
      location: P.getProperty('LOC_' + norm_(raw.email)) || '', mustChange: P.getProperty('MC_' + norm_(raw.email)) === '1', lastLogin: +(P.getProperty('LL_' + norm_(raw.email)) || 0),
      _salt: raw.salt, _hash: raw.password_hash, _raw: raw };
  }
  return { id: norm_(raw.email), email: norm_(raw.email), name: raw.name || raw.email, role: raw.role || 'staff', cost: raw.role === 'admin', active: tru_(raw.active),
    pending: !tru_(raw.active) && P.getProperty('PEND_' + norm_(raw.email)) === '1',
    location: raw.location || '', mustChange: tru_(raw.mustChange), lastLogin: +raw.lastLogin || 0, _salt: raw.salt, _hash: raw.passHash, _raw: raw };
}
function pub_(u) { return { email: u.email, name: u.name, role: u.role, cost: !!u.cost, active: !!u.active, pending: !!u.pending, noStock: !!u.noStock, location: u.location || '', mustChange: !!u.mustChange, lastLogin: u.lastLogin || 0 }; }
function allUsers_() { return linked_() ? appUsers_().rows.map(userFrom_) : rows_(SH_USR, USR_COLS).map(userFrom_); }
function findUser_(email) { const e = norm_(email); return e ? allUsers_().find(u => u.email === e) || null : null; }
/* hashing: linked mode uses the dashboard's exact scheme so passwords match in both apps */
function toHex_(b) { let s = ''; for (let i = 0; i < b.length; i++) { const x = (b[i] + 256) % 256; s += (x < 16 ? '0' : '') + x.toString(16); } return s; }
function hashDash_(pw, salt) { let v = salt + ':' + pw; for (let i = 0; i < 300; i++) v = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8)); return v; }
function hash_(pw, salt) { let h = salt + '|' + pw; for (let i = 0; i < 300; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8)); return h; }
function hashFor_(pw, salt) { return linked_() ? hashDash_(pw, salt) : hash_(pw, salt); }
function tempPw_() { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 10; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
function setPassword_(u, pw, mustChange) {
  const salt = Utilities.getUuid(), h = hashFor_(pw, salt);
  if (linked_()) { const t = appUsers_(), row = t.rows.find(r => norm_(r.email) === u.email); setCells_(t, row, { salt: salt, password_hash: h, updated_at: new Date().toISOString() }); }
  else { const sh = ss_().getSheetByName(SH_USR), row = rows_(SH_USR, USR_COLS).find(r => norm_(r.email) === u.email); sh.getRange(row._row, USR_COLS.indexOf('salt') + 1, 1, 2).setValues([[salt, h]]); }
  setMustChange_(u.email, mustChange);
}
function setMustChange_(email, on) {
  if (linked_()) { if (on) P.setProperty('MC_' + email, '1'); else P.deleteProperty('MC_' + email); return; }
  const row = rows_(SH_USR, USR_COLS).find(r => norm_(r.email) === email); if (row) ss_().getSheetByName(SH_USR).getRange(row._row, USR_COLS.indexOf('mustChange') + 1).setValue(!!on);
}
/* create or edit a user (admin). Returns a one-time password when one is issued. */
function upsertUser_(u, newTempPassword) {
  const email = norm_(u.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email');
  const ex = findUser_(email), now = Date.now();
  if (u.location !== undefined) { if (u.location) P.setProperty('LOC_' + email, u.location); else P.deleteProperty('LOC_' + email); }
  if (linked_()) {
    const t = appUsers_();
    if (!ex) {
      const row = { id: Utilities.getUuid(), email: email, full_name: String(u.name || email.split('@')[0]), role: u.role === 'admin' ? 'admin' : 'sales', approved: u.active !== false,
        can_view_cost: u.role === 'admin' || !!u.cost, can_edit_prices: u.role === 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), salt: '', password_hash: '' };
      let rowNo = 2; const ids = t.sh.getRange(2, 1, Math.max(t.sh.getLastRow() - 1, 1), 1).getValues();
      for (let i = 0; i < ids.length; i++) if (ids[i][0] !== '') rowNo = i + 3;   // the dashboard pre-fills checkbox rows
      t.sh.getRange(rowNo, 1, 1, t.h.length).setValues([t.h.map(k => row[k] === undefined ? '' : row[k])]);
    } else {
      const row = t.rows.find(r => norm_(r.email) === email), ch = { updated_at: new Date().toISOString() };
      if (u.name) ch.full_name = u.name;
      if (u.role) ch.role = u.role === 'admin' ? 'admin' : (String(row.role).toLowerCase() === 'admin' ? 'sales' : row.role || 'sales');
      if (u.active !== undefined) ch.approved = !!u.active;
      if (u.cost !== undefined || u.role === 'admin') ch.can_view_cost = u.role === 'admin' || !!u.cost;
      if (u.active && String(row.access || '').trim() && !hasStock_(row.access)) ch.access = String(row.access).trim() + ',stock';
      setCells_(t, row, ch);
    }
  } else {
    const sh = ss_().getSheetByName(SH_USR), raw = ex ? ex._raw : { email: email, createdAt: now, salt: '', passHash: '', mustChange: true, lastLogin: '' };
    raw.name = String(u.name || raw.name || email.split('@')[0]).slice(0, 60); raw.role = ROLES.indexOf(u.role) >= 0 ? u.role : (raw.role || 'staff');
    raw.location = u.location !== undefined ? u.location : (raw.location || ''); raw.active = u.active === undefined ? (ex ? ex.active : true) : !!u.active;
    const line = USR_COLS.map(k => raw[k] === undefined ? '' : raw[k]);
    if (ex) sh.getRange(raw._row, 1, 1, line.length).setValues([line]); else sh.appendRow(line);
  }
  let tmp = '';
  if (newTempPassword) { tmp = tempPw_(); setPassword_(findUser_(email), tmp, true); }
  if (u.active) P.deleteProperty('PEND_' + email);
  if (ex && u.active === false) endSessions_(email);
  return tmp;
}
function register_(name, email, pw) {
  email = norm_(email); name = String(name || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email' };
  if (!name) return { ok: false, error: 'Enter your name' };
  if (pw.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  if (findUser_(email)) return { ok: false, error: 'This email is already registered — sign in, or ask the admin to reset your password' };
  if (allUsers_().filter(u => u.pending).length >= 100) return { ok: false, error: 'Too many pending registrations — ask the admin' };
  upsertUser_({ email: email, name: name, role: 'staff', active: false }, false);
  if (!linked_()) P.setProperty('PEND_' + email, '1');
  setPassword_(findUser_(email), pw, false);
  return { ok: true, pending: true };
}
function issueSession_(u) {
  const sec = P.getProperty('APP_TOKEN_SECRET');
  if (linked_() && sec && u.id) {   // same token format as the dashboard → one sign-in works in both apps
    const payload = u.id + '.' + (Date.now() + 30 * 864e5);
    return { token: payload + '.' + toHex_(Utilities.computeHmacSha256Signature(payload, sec)), shared: true };
  }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  P.setProperty('S_' + token, JSON.stringify({ email: u.email, exp: Date.now() + 30 * 864e5 }));
  return { token: token, shared: false };
}
function login_(email, pw) {
  const e = norm_(email), cache = CacheService.getScriptCache(), k = 'lf_' + e, fails = +(cache.get(k) || 0);
  if (fails >= 8) return { ok: false, error: 'Too many wrong tries — wait 15 minutes' };
  const u = findUser_(e);
  if (!u || !u._hash || hashFor_(pw, u._salt) !== u._hash) { cache.put(k, String(fails + 1), 900); Utilities.sleep(400); return { ok: false, error: 'Wrong email or password' }; }
  cache.remove(k);
  if (u.pending) return { ok: false, error: 'Your account is waiting for admin approval' };
  if (u.noStock) return { ok: false, error: 'Your login does not include the stock app — ask the admin' };
  if (!u.active) return { ok: false, error: 'Your account is disabled — ask the admin' };
  const s = issueSession_(u);
  P.setProperty('LL_' + u.email, String(Date.now()));
  if (!linked_()) { const row = rows_(SH_USR, USR_COLS).find(r => norm_(r.email) === u.email); ss_().getSheetByName(SH_USR).getRange(row._row, USR_COLS.indexOf('lastLogin') + 1).setValue(Date.now()); }
  cleanSessions_();
  return { ok: true, session: s.token, shared: s.shared, user: pub_(u) };
}
function session_(token) {
  if (!token) return null;
  const sec = P.getProperty('APP_TOKEN_SECRET'), parts = String(token).split('.');
  if (linked_() && sec && parts.length === 3) {
    const payload = parts[0] + '.' + parts[1];
    if (toHex_(Utilities.computeHmacSha256Signature(payload, sec)) !== parts[2] || +parts[1] < Date.now()) return null;
    const u = allUsers_().find(x => x.id === parts[0]);
    return u && u.active ? u : null;
  }
  if (token.length < 40) return null;
  let s; try { s = JSON.parse(P.getProperty('S_' + token) || 'null'); } catch (e) { return null; }
  if (!s || s.exp < Date.now()) { if (s) P.deleteProperty('S_' + token); return null; }
  const u = findUser_(s.email);
  return u && u.active ? u : null;
}
function changePw_(me, old, pw) {
  if (hashFor_(old, me._salt) !== me._hash) return { ok: false, error: 'Current password is wrong' };
  if (pw.length < 8) return { ok: false, error: 'Use at least 8 characters' };
  if (pw === old) return { ok: false, error: 'Choose a new password' };
  setPassword_(me, pw, false);
  return { ok: true, user: pub_(Object.assign({}, me, { mustChange: false })) };
}
function endSessions_(email) { const all = P.getProperties(); Object.keys(all).forEach(k => { if (k.indexOf('S_') === 0) { try { if (JSON.parse(all[k]).email === email) P.deleteProperty(k); } catch (e) {} } }); }
function cleanSessions_() { const all = P.getProperties(), now = Date.now(); Object.keys(all).forEach(k => { if (k.indexOf('S_') === 0) { try { if (JSON.parse(all[k]).exp < now) P.deleteProperty(k); } catch (e) { P.deleteProperty(k); } } }); }

/* ---------------- voice → text ---------------- */
function transcribe_(d) {
  const m = d.match(/^data:(audio\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw new Error('No audio received');
  if (m[2].length > 8e6) throw new Error('Recording too long — keep it under 90 seconds');
  // No topic hints in this prompt on purpose: hints make the model "hear" words in silence or noise.
  const raw = gemini_([
    { text: 'Listen to this audio clip. First decide honestly whether it contains clear human speech. ' +
      'If it does, write exactly what was said as clear English (translate Hindi, Bengali or mixed speech to English), ' +
      'keeping numbers, units, codes and names exactly. Never guess, complete or add words that were not spoken. ' +
      'Reply ONLY JSON: {"speech": true or false, "text": "..."} — use {"speech": false, "text": ""} for silence, noise, music or tones.' },
    { inline_data: { mime_type: m[1], data: m[2] } }
  ], true);
  let o = {}; try { o = JSON.parse(String(raw).replace(/^```(json)?|```$/g, '').trim()); } catch (e) { return ''; }
  const t = String(o.text || '').trim();
  return o.speech === true && t && !/NO_SPEECH/i.test(t) ? t : '';
}
