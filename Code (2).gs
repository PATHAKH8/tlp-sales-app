/**
 * TL Pathak Sales App - backend (Google Apps Script, bound to the "TL Pathak App Data" spreadsheet)
 *
 * What it does:
 *   - Logins: users register in the app; you approve them in the Users tab (tick "approved").
 *   - Cloud sync: dealers, company settings and the sheet list live in tabs of this spreadsheet.
 *   - Purchase rates: the product catalog is read here, on Google's side. Cost columns are
 *     removed before the data is sent, unless the user is an admin or has "can_view_cost" ticked.
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 */

// ---------- Settings you may change ----------
// Catalog spreadsheets the app may read. Sheets added in the app's admin screen are allowed automatically.
var MASTER_SHEET_IDS = ['1rc06IMufPw-KEmPgOEtDzoitoMIDm45SpJ3CcaLP32g'];
// A column is treated as a purchase-rate column when its header matches this.
var COST_HEADER = /cost|purchase|standard_price|buy\s*price|buying|dealer\s*price|landed/i;
var SESSION_DAYS = 30;
// ---------------------------------------------

var TABLES = { profiles: 'Users', dealers: 'Dealers', company_settings: 'Company', google_sheet_sources: 'SheetSources', companies: 'Companies', quotes: 'Quotes', clients: 'Clients', leads: 'Leads' };
var LEAD_FOLDER_NAME = 'TL Pathak Leads (cards and notes)';
var QUOTE_FOLDER_NAME = 'TL Pathak Quotations';
var HEADERS = {
  Users: ['id', 'email', 'full_name', 'role', 'approved', 'can_view_cost', 'can_edit_prices', 'dealer_id', 'created_at', 'updated_at', 'salt', 'password_hash', 'company_id', 'can_see_all_quotes'],
  Companies: ['id', 'name', 'branch', 'address', 'city', 'state_code', 'pincode', 'gstin', 'email', 'phone', 'website', 'bank_account_name', 'bank_branch', 'bank_account_no', 'bank_ifsc', 'cover_city', 'quote_prefix', 'jurisdiction', 'is_default', 'active', 'created_at', 'updated_at'],
  Quotes: ['id', 'quote_no', 'date', 'valid_until', 'company_id', 'company_name', 'customer', 'contact', 'customer_state', 'customer_gstin', 'machine', 'qty', 'amount', 'grand_total', 'design', 'status', 'follow_up', 'notes', 'pdf_url', 'pdf_file_id', 'created_by', 'created_by_name', 'created_at', 'updated_at', 'customer_state_code', 'customer_address', 'customer_phone', 'customer_email', 'items_text', 'lead_id', 'form_json'],
  Clients: ['id', 'name', 'contact', 'phone', 'email', 'address', 'city', 'state_code', 'gstin', 'notes', 'source', 'created_by', 'created_by_name', 'created_at', 'updated_at'],
  Leads: ['id', 'kind', 'name', 'company', 'designation', 'phone', 'email', 'website', 'address', 'gstin', 'requirement', 'items_text', 'raw_text', 'image_url', 'image_file_id', 'status', 'quote_no', 'event', 'created_by', 'created_by_name', 'created_at', 'updated_at'],
  Dealers: ['id', 'name', 'dealer_code', 'location_type', 'contact_person', 'address', 'city', 'state', 'pincode', 'phone', 'whatsapp', 'email', 'gstin', 'logo_url', 'markup_percent', 'transport_charge', 'gst_percent', 'quotation_terms', 'notes', 'active', 'created_at', 'updated_at'],
  Company: ['id', 'logo_url', 'google_sheet_url', 'updated_at'],
  SheetSources: ['id', 'sheet_id', 'gid', 'sheet_url', 'category_name', 'active', 'sort_order', 'last_status', 'last_error', 'product_count', 'last_synced_at', 'created_at', 'updated_at']
};
var SECRET_COLUMNS = ['salt', 'password_hash'];
var PROFILE_EDITABLE = ['full_name', 'role', 'approved', 'can_view_cost', 'can_edit_prices', 'dealer_id', 'company_id', 'can_see_all_quotes', 'updated_at'];
var QUOTE_OWNER_EDITABLE = ['status', 'follow_up', 'notes', 'updated_at'];
var TEXT_TABS = { Clients: true, Leads: true };   // phone numbers and GSTINs must stay as typed

// ---------- Menu and one-time setup ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('TL Pathak App')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Reset a user password', 'resetPasswordMenu')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var heads = HEADERS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
      heads.forEach(function (h) { if (have.indexOf(h) === -1) { have.push(h); sh.getRange(1, have.length).setValue(h).setFontWeight('bold'); } });
    }
  });
  var company = ss.getSheetByName('Company');
  if (company.getLastRow() < 2) company.appendRow([1, '', '', new Date().toISOString()]);
  var users = ss.getSheetByName('Users');
  users.getRange(2, 5, 500, 3).insertCheckboxes();           // approved, can_view_cost, can_edit_prices
  users.hideColumns(11, 2);                                   // salt, password_hash
  getSecret_();
  getQuoteFolder_();
  try { SpreadsheetApp.getUi().alert('Set-up complete. Now deploy the script as a web app.'); } catch (e) {}
}

function resetPasswordMenu() {
  var ui = SpreadsheetApp.getUi();
  var email = ui.prompt('Reset password', 'User email:', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return;
  var pass = ui.prompt('Reset password', 'New password (at least 8 characters):', ui.ButtonSet.OK_CANCEL);
  if (pass.getSelectedButton() !== ui.Button.OK) return;
  var newPass = pass.getResponseText();
  if (newPass.length < 8) { ui.alert('Password must be at least 8 characters.'); return; }
  var t = readTable_('Users');
  var user = findUserByEmail_(t, email.getResponseText());
  if (!user) { ui.alert('No user with that email.'); return; }
  var salt = Utilities.getUuid();
  updateRow_(t, user, { salt: salt, password_hash: hashPassword_(newPass, salt), updated_at: new Date().toISOString() });
  ui.alert('Password updated for ' + user.email + '.');
}

// ---------- Web entry points ----------
function doGet() {
  return ContentService.createTextOutput('TL Pathak app backend is running.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = route_(req);
  } catch (err) {
    out = { error: { message: String(err && err.message ? err.message : err) } };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  switch (req.action) {
    case 'register': return register_(req);
    case 'login': return login_(req);
    case 'me': return me_(req);
    case 'db': return db_(req);
    case 'sheet': return sheet_(req);
    case 'user_create': return userCreate_(req);
    case 'user_password': return userPassword_(req);
    case 'quote_number': return quoteNumber_(req);
    case 'quote_save': return quoteSave_(req);
    case 'lead_save': return leadSave_(req);
    case 'clients_import': return clientsImport_(req);
    case 'sheet_rows': return sheetRows_(req);
    default: throw new Error('Unknown action.');
  }
}

// ---------- Accounts ----------
function register_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var name = String(req.name || '').trim();
  var password = String(req.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!name) throw new Error('Enter your name.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_('Users');
    if (findUserByEmail_(t, email)) throw new Error('This email is already registered.');
    var pending = t.rows.filter(function (r) { return r.approved !== true; }).length;
    if (pending >= 100) throw new Error('Too many pending registrations. Ask the administrator.');
    var first = t.rows.length === 0;                           // the first account becomes the administrator
    var salt = Utilities.getUuid();
    var now = new Date().toISOString();
    var row = {
      id: Utilities.getUuid(), email: email, full_name: name, role: first ? 'admin' : 'sales',
      approved: first, can_view_cost: first, can_edit_prices: first, dealer_id: '',
      created_at: now, updated_at: now, salt: salt, password_hash: hashPassword_(password, salt)
    };
    appendRow_(t, row);
    return { data: { user: { id: row.id, email: email }, first_admin: first }, error: null };
  } finally {
    lock.releaseLock();
  }
}

function login_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + email;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= 8) throw new Error('Too many wrong attempts. Try again in 10 minutes.');
  var user = findUserByEmail_(readTable_('Users'), email);
  if (!user || !user.password_hash || hashPassword_(String(req.password || ''), user.salt) !== user.password_hash) {
    cache.put(failKey, String(fails + 1), 600);
    throw new Error('Wrong email or password.');
  }
  cache.remove(failKey);
  return { data: { token: makeToken_(user.id), user: { id: user.id, email: user.email } }, error: null };
}

function me_(req) {
  var user = requireUser_(req.token, false);
  return { data: { user: { id: user.id, email: user.email } }, error: null };
}

function requireUser_(token, mustBeApproved) {
  var uid = readToken_(token);
  var t = readTable_('Users');
  var user = null;
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === uid) user = t.rows[i];
  if (!user) throw new Error('Please sign in again.');
  if (mustBeApproved && user.approved !== true) throw new Error('Your account is awaiting administrator approval.');
  return user;
}

function isAdmin_(user) { return String(user.role || '').toLowerCase() === 'admin' && user.approved === true; }
function canSeeCost_(user) { return isAdmin_(user) || user.can_view_cost === true; }

function hashPassword_(password, salt) {
  var value = salt + ':' + password;
  for (var i = 0; i < 300; i++) {
    value = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
  }
  return value;
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) { var b = (bytes[i] + 256) % 256; s += (b < 16 ? '0' : '') + b.toString(16); }
  return s;
}

function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

function sign_(payload) { return toHex_(Utilities.computeHmacSha256Signature(payload, getSecret_())); }

function makeToken_(uid) {
  var payload = uid + '.' + (Date.now() + SESSION_DAYS * 86400000);
  return payload + '.' + sign_(payload);
}

function readToken_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Please sign in again.');
  var payload = parts[0] + '.' + parts[1];
  if (sign_(payload) !== parts[2] || Number(parts[1]) < Date.now()) throw new Error('Please sign in again.');
  return parts[0];
}

// ---------- Tables stored as tabs ----------
function readTable_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sh && HEADERS[tab]) {                                    // new tabs (Clients, Leads) are created the first time they are needed
    sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(tab);
    sh.getRange(1, 1, 1, HEADERS[tab].length).setValues([HEADERS[tab]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (TEXT_TABS[tab]) sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).setNumberFormat('@');
  }
  if (!sh) throw new Error('Tab "' + tab + '" is missing. Run TL Pathak App > Set up / repair tabs.');
  var values = sh.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {}, empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[r][c];
      if (v instanceof Date) v = v.toISOString();
      if (v === '') v = null; else if (v !== false) empty = false;
      obj[headers[c]] = v;
    }
    if (empty) continue;                                       // blank row (e.g. unticked checkboxes only)
    Object.defineProperty(obj, '_row', { value: r + 1, enumerable: false });
    rows.push(obj);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

function ensureColumns_(t, obj) {
  Object.keys(obj).forEach(function (k) {
    if (t.headers.indexOf(k) === -1) {
      t.headers.push(k);
      t.sheet.getRange(1, t.headers.length).setValue(k).setFontWeight('bold');
    }
  });
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && v.length > 49000) throw new Error('A value is too long to store (an image may be too large).');
  return v;
}

function appendRow_(t, obj) {
  ensureColumns_(t, obj);
  var line = t.headers.map(function (h) { return cell_(obj[h]); });
  var rowNo = Math.max(t.sheet.getLastRow(), 1) + 1;
  if (t.sheet.getName() === 'Users') {                         // checkboxes pre-fill rows, so find the first free one
    rowNo = 2;
    var ids = t.sheet.getRange(2, 1, Math.max(t.sheet.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] !== '') rowNo = i + 3;
  }
  t.sheet.getRange(rowNo, 1, 1, line.length).setValues([line]);
}

function updateRow_(t, row, changes) {
  ensureColumns_(t, changes);
  Object.keys(changes).forEach(function (k) {
    t.sheet.getRange(row._row, t.headers.indexOf(k) + 1).setValue(cell_(changes[k]));
    row[k] = changes[k];
  });
}

function findUserByEmail_(t, email) {
  email = String(email || '').trim().toLowerCase();
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].email || '').toLowerCase() === email) return t.rows[i];
  return null;
}

function publicRow_(row) {
  var out = {};
  Object.keys(row).forEach(function (k) { if (SECRET_COLUMNS.indexOf(k) === -1) out[k] = row[k]; });
  return out;
}

// ---------- Generic data access used by the app ----------
function db_(req) {
  var tab = TABLES[req.table];
  if (!tab) throw new Error('Unknown table.');
  var isProfiles = req.table === 'profiles';
  var user = requireUser_(req.token, !isProfiles);
  var admin = isAdmin_(user);
  var op = req.op || 'select';
  var filters = req.filters || [];
  var matches = function (row) {
    for (var i = 0; i < filters.length; i++) if (String(row[filters[i][0]]) !== String(filters[i][1])) return false;
    return true;
  };
  var finish = function (rows) {
    rows = rows.map(publicRow_);
    if (req.single) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'No matching row found.' } };
    return { data: rows, error: null };
  };

  if (op === 'select') {
    var t = readTable_(tab);
    var rows = t.rows.filter(matches);
    if (isProfiles && !admin) rows = rows.filter(function (r) { return String(r.id) === String(user.id); });
    if ((req.table === 'quotes' || req.table === 'leads') && !admin && user.can_see_all_quotes !== true) rows = rows.filter(function (r) { return String(r.created_by) === String(user.id); });
    if (req.order) {
      var col = req.order.col, dir = req.order.asc === false ? -1 : 1;
      rows.sort(function (a, b) {
        var x = a[col] === null || a[col] === undefined ? '' : a[col], y = b[col] === null || b[col] === undefined ? '' : b[col];
        return (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
    }
    return finish(rows);
  }

  var ownQuoteEdit = req.table === 'quotes' && op === 'update' && !admin;
  var isClients = req.table === 'clients', isLeads = req.table === 'leads';
  var staffWrite = !admin && ((isClients && op !== 'delete') || (isLeads && (op === 'update' || op === 'delete')));   // staff keep the client list and their own leads up to date
  if (!admin && !ownQuoteEdit && !staffWrite) throw new Error('Administrator access required.');
  if (isLeads && (op === 'insert' || op === 'upsert')) throw new Error('Leads are saved from the scanner screen.');
  if (req.table === 'quotes' && (op === 'insert' || op === 'upsert')) throw new Error('Quotes are saved from the quotation screen.');
  if (isProfiles && (op === 'insert' || op === 'upsert')) throw new Error('duplicate: accounts are created by registration.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var tw = readTable_(tab);
    var now = new Date().toISOString();
    if (op === 'insert' || op === 'upsert') {
      var items = Array.isArray(req.payload) ? req.payload : [req.payload];
      var made = [];
      items.forEach(function (item) {
        var existing = null;
        if (op === 'upsert' && req.conflict) {
          var keys = String(req.conflict).split(',');
          tw.rows.forEach(function (r) {
            if (keys.every(function (k) { return String(r[k] === null ? '' : r[k]) === String(item[k] === null || item[k] === undefined ? '' : item[k]); })) existing = r;
          });
        }
        if (existing) { updateRow_(tw, existing, item); made.push(existing); }
        else {
          var row = { id: Utilities.getUuid(), created_at: now };
          Object.keys(item).forEach(function (k) { if (k !== 'id' || item[k]) row[k] = item[k]; });
          if (isClients) { row.created_by = user.id; row.created_by_name = user.full_name || user.email; }
          appendRow_(tw, row);
          tw.rows.push(row);
          made.push(row);
        }
      });
      return finish(made);
    }
    if (op === 'update') {
      var changes = req.payload || {};
      if (isProfiles) {
        var safe = {};
        PROFILE_EDITABLE.forEach(function (k) { if (k in changes) safe[k] = changes[k]; });
        changes = safe;
      }
      delete changes.id;
      var hit = tw.rows.filter(matches);
      if (ownQuoteEdit) {
        var safeQ = {};
        QUOTE_OWNER_EDITABLE.forEach(function (k) { if (k in changes) safeQ[k] = changes[k]; });
        changes = safeQ;
        hit = hit.filter(function (r) { return String(r.created_by) === String(user.id); });
        if (!hit.length) throw new Error('You can only update your own quotations.');
      }
      if (isLeads && !admin) hit = hit.filter(function (r) { return String(r.created_by) === String(user.id); });
      hit.forEach(function (r) { updateRow_(tw, r, changes); });
      return finish(hit);
    }
    if (op === 'delete') {
      if (!filters.length) throw new Error('Refusing to delete every row.');
      var gone = tw.rows.filter(matches);
      if (isLeads && !admin) gone = gone.filter(function (r) { return String(r.created_by) === String(user.id); });
      if (isProfiles && gone.some(function (r) { return String(r.id) === String(user.id); })) throw new Error('You cannot delete your own account.');
      gone.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { tw.sheet.deleteRow(r._row); });
      return { data: null, error: null };
    }
    throw new Error('Unsupported operation.');
  } finally {
    lock.releaseLock();
  }
}

// ---------- Catalog (purchase rates are removed here unless the user may see them) ----------
function allowedSheetIds_() {
  var ids = {};
  MASTER_SHEET_IDS.forEach(function (id) { ids[id] = true; });
  readTable_('SheetSources').rows.forEach(function (r) { if (r.sheet_id) ids[String(r.sheet_id)] = true; });
  var company = readTable_('Company').rows[0];
  if (company && company.google_sheet_url) {
    var m, re = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)|"id"\s*:\s*"([a-zA-Z0-9_-]+)"/g;
    while ((m = re.exec(String(company.google_sheet_url)))) ids[m[1] || m[2]] = true;
  }
  return ids;
}

function sheet_(req) {
  var user = requireUser_(req.token, true);
  var id = String(req.id || '');
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) throw new Error('Invalid sheet ID.');
  if (id === SpreadsheetApp.getActiveSpreadsheet().getId()) throw new Error('This spreadsheet cannot be used as a catalog.');
  if (!isAdmin_(user) && !allowedSheetIds_()[id]) throw new Error('This sheet is not in the approved catalog list.');
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (err) { throw new Error('The script owner cannot open this sheet. Share it with the account that deployed the script.'); }
  var hideCost = !canSeeCost_(user);
  var wantGid = req.gid === undefined || req.gid === null || req.gid === '' ? null : String(req.gid);
  var sheets = ss.getSheets();
  if (wantGid !== null) {
    var only = sheets.filter(function (s) { return String(s.getSheetId()) === wantGid; });
    if (only.length) sheets = only;
  } else if (req.first) {
    sheets = sheets.slice(0, 1);
  }
  var tabs = sheets.map(function (sh) {
    var range = sh.getDataRange();
    var values = range.getDisplayValues();
    var formulas = range.getFormulas();
    var rich = range.getRichTextValues();
    var hidden = {};
    if (hideCost) {
      for (var r = 0; r < Math.min(values.length, 25); r++) {
        for (var c = 0; c < values[r].length; c++) if (COST_HEADER.test(values[r][c])) hidden[c] = true;
      }
    }
    var links = [], forms = [];
    for (var r2 = 0; r2 < values.length; r2++) {
      for (var c2 = 0; c2 < values[r2].length; c2++) {
        if (hidden[c2]) { values[r2][c2] = ''; continue; }
        var f = formulas[r2][c2];
        if (f && /^=\s*(HYPERLINK|IMAGE)\s*\(/i.test(f)) forms.push([r2, c2, f]);
        var rt = rich[r2][c2];
        if (rt) {
          var url = rt.getLinkUrl();
          if (!url) {
            var runs = rt.getRuns();
            for (var k = 0; k < runs.length && !url; k++) url = runs[k].getLinkUrl();
          }
          if (url) links.push([r2, c2, url]);
        }
      }
    }
    return { name: sh.getName(), gid: String(sh.getSheetId()), values: values, formulas: forms, links: links };
  });
  return { data: { tabs: tabs, cost_hidden: hideCost }, error: null };
}

// ---------- Team management (administrators) ----------
function userCreate_(req) {
  var admin = requireUser_(req.token, true);
  if (!isAdmin_(admin)) throw new Error('Administrator access required.');
  var email = String(req.email || '').trim().toLowerCase();
  var name = String(req.name || '').trim();
  var password = String(req.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!name) throw new Error('Enter the name.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_('Users');
    if (findUserByEmail_(t, email)) throw new Error('This email is already registered.');
    var salt = Utilities.getUuid(), now = new Date().toISOString();
    var row = {
      id: Utilities.getUuid(), email: email, full_name: name, role: req.role === 'admin' ? 'admin' : 'sales',
      approved: true, can_view_cost: req.can_view_cost === true, can_edit_prices: req.can_edit_prices === true, dealer_id: '',
      created_at: now, updated_at: now, salt: salt, password_hash: hashPassword_(password, salt),
      company_id: String(req.company_id || ''), can_see_all_quotes: req.can_see_all_quotes === true
    };
    appendRow_(t, row);
    return { data: publicRow_(row), error: null };
  } finally {
    lock.releaseLock();
  }
}

function userPassword_(req) {
  var admin = requireUser_(req.token, true);
  if (!isAdmin_(admin)) throw new Error('Administrator access required.');
  var password = String(req.password || '');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  var t = readTable_('Users'), user = null;
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === String(req.user_id)) user = t.rows[i];
  if (!user) throw new Error('User not found.');
  var salt = Utilities.getUuid();
  updateRow_(t, user, { salt: salt, password_hash: hashPassword_(password, salt), updated_at: new Date().toISOString() });
  return { data: { id: user.id }, error: null };
}

// ---------- Quotation register ----------
function getQuoteFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('QUOTE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder(QUOTE_FOLDER_NAME);
  props.setProperty('QUOTE_FOLDER_ID', folder.getId());
  return folder;
}

// Issues the next quotation number, e.g. TLPG/QT/26-27/1111 then -2, -3 for the same day. Never repeats.
function quoteNumber_(req) {
  requireUser_(req.token, true);
  var prefix = String(req.prefix || 'TLPG/QT/').replace(/[^A-Za-z0-9\/_-]/g, '').slice(0, 20) || 'TLPG/QT/';
  if (!/\/$/.test(prefix)) prefix += '/';
  var m = String(req.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Invalid quotation date.');
  var y = Number(m[1]), fy = Number(m[2]) >= 4 ? y : y - 1;
  var base = prefix + String(fy).slice(-2) + '-' + String(fy + 1).slice(-2) + '/' + m[2] + m[3];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var n = Number(props.getProperty('seq_' + base) || 0) + 1;
    props.setProperty('seq_' + base, String(n));
    return { data: { quote_no: n === 1 ? base : base + '-' + n }, error: null };
  } finally {
    lock.releaseLock();
  }
}

function quoteSave_(req) {
  var user = requireUser_(req.token, true);
  var q = req.quote || {};
  if (!q.quote_no || !q.customer) throw new Error('Quotation number and customer are required.');
  var url = '', fileId = '';
  if (req.pdf_base64) {
    var name = String(req.filename || ('Quotation_' + q.quote_no + '.pdf')).replace(/[\\\/:*?"<>|]+/g, '-');
    var blob = Utilities.newBlob(Utilities.base64Decode(req.pdf_base64), 'application/pdf', name);
    var file = getQuoteFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    url = file.getUrl(); fileId = file.getId();
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_('Quotes'), now = new Date().toISOString(), row = { id: Utilities.getUuid() };
    ['quote_no', 'date', 'valid_until', 'company_id', 'company_name', 'customer', 'contact', 'customer_state', 'customer_gstin', 'machine', 'qty', 'amount', 'grand_total', 'design', 'customer_state_code', 'customer_address', 'customer_phone', 'customer_email', 'items_text', 'lead_id', 'form_json'].forEach(function (k) { row[k] = q[k] === undefined ? '' : q[k]; });
    row.status = 'Sent'; row.follow_up = ''; row.notes = '';
    row.pdf_url = url; row.pdf_file_id = fileId;
    row.created_by = user.id; row.created_by_name = user.full_name || user.email;
    row.created_at = now; row.updated_at = now;
    appendRow_(t, row);
    try { rememberClient_({ name: q.customer, contact: q.contact, phone: q.customer_phone, email: q.customer_email, address: q.customer_address, state_code: q.customer_state_code, gstin: q.customer_gstin, source: 'Quotation' }, user); } catch (e) {}
    if (q.lead_id) { try { var tl = readTable_('Leads'); tl.rows.forEach(function (r) { if (String(r.id) === String(q.lead_id)) updateRow_(tl, r, { status: 'Quoted', quote_no: q.quote_no, updated_at: now }); }); } catch (e2) {} }
    return { data: row, error: null };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Clients ----------
function clientKey_(c) {
  var g = String(c.gstin || '').replace(/\s+/g, '').toUpperCase();
  return g ? 'g:' + g : 'n:' + String(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + String(c.phone || '').replace(/\D+/g, '').slice(-10);
}
var CLIENT_FIELDS = ['name', 'contact', 'phone', 'email', 'address', 'city', 'state_code', 'gstin', 'notes', 'source'];

// Adds the customer to the client list, or fills the blanks of the existing entry. Caller holds the lock.
function rememberClient_(c, user) {
  if (!c || !String(c.name || '').trim()) return;
  var t = readTable_('Clients'), key = clientKey_(c), nameKey = String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, ''), found = null;
  t.rows.forEach(function (r) { if (!found && (clientKey_(r) === key || String(r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === nameKey)) found = r; });
  var now = new Date().toISOString();
  if (found) {
    var ch = {};
    CLIENT_FIELDS.forEach(function (k) { if (k !== 'source' && c[k] && !found[k]) ch[k] = String(c[k]); });
    if (Object.keys(ch).length) { ch.updated_at = now; updateRow_(t, found, ch); }
    return;
  }
  var row = { id: Utilities.getUuid(), created_by: user.id, created_by_name: user.full_name || user.email, created_at: now, updated_at: now };
  CLIENT_FIELDS.forEach(function (k) { row[k] = c[k] ? String(c[k]) : ''; });
  appendRow_(t, row);
}

// Bulk import of an old client list (Excel, CSV, Google Sheet, Odoo or Tally export). Skips clients already in the list.
function clientsImport_(req) {
  var user = requireUser_(req.token, true);
  if (!isAdmin_(user)) throw new Error('Administrator access required.');
  var list = Array.isArray(req.clients) ? req.clients : [];
  if (list.length > 5000) throw new Error('Import up to 5,000 clients at a time.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_('Clients'), seen = {}, now = new Date().toISOString(), lines = [], skipped = 0;
    t.rows.forEach(function (r) { seen[clientKey_(r)] = true; });
    ensureColumns_(t, { id: 1, created_by: 1, created_by_name: 1, created_at: 1, updated_at: 1, name: 1, contact: 1, phone: 1, email: 1, address: 1, city: 1, state_code: 1, gstin: 1, notes: 1, source: 1 });
    list.forEach(function (c) {
      if (!c || !String(c.name || '').trim()) { skipped++; return; }
      var k = clientKey_(c);
      if (seen[k]) { skipped++; return; }
      seen[k] = true;
      var row = { id: Utilities.getUuid(), created_by: user.id, created_by_name: user.full_name || user.email, created_at: now, updated_at: now };
      CLIENT_FIELDS.forEach(function (f) { row[f] = c[f] ? String(c[f]).slice(0, 2000) : ''; });
      if (!row.source) row.source = 'Import';
      lines.push(t.headers.map(function (h) { return cell_(row[h]); }));
    });
    if (lines.length) {
      var start = Math.max(t.sheet.getLastRow(), 1) + 1;
      t.sheet.getRange(start, 1, lines.length, t.headers.length).setNumberFormat('@').setValues(lines);
    }
    return { data: { added: lines.length, skipped: skipped }, error: null };
  } finally {
    lock.releaseLock();
  }
}

// Reads the first tab (or the tab in the link) of a Google Sheet the owner of this script can open, for the client import.
function sheetRows_(req) {
  var user = requireUser_(req.token, true);
  if (!isAdmin_(user)) throw new Error('Administrator access required.');
  var m = String(req.url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (!m) throw new Error('That does not look like a Google Sheet link.');
  var ss;
  try { ss = SpreadsheetApp.openById(m[1]); } catch (e) { throw new Error('This sheet cannot be opened. Share it with the Google account that owns the app, then try again.'); }
  var gid = (String(req.url).match(/[#&?]gid=(\d+)/) || [])[1], sh = ss.getSheets()[0];
  if (gid) ss.getSheets().forEach(function (x) { if (String(x.getSheetId()) === gid) sh = x; });
  var values = sh.getDataRange().getDisplayValues();
  if (values.length > 5001) values = values.slice(0, 5001);
  return { data: { name: ss.getName() + ' / ' + sh.getName(), rows: values }, error: null };
}

// ---------- Leads: visiting cards and handwritten notes ----------
function getLeadFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LEAD_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder(LEAD_FOLDER_NAME);
  props.setProperty('LEAD_FOLDER_ID', folder.getId());
  return folder;
}

function leadSave_(req) {
  var user = requireUser_(req.token, true);
  var L = req.lead || {};
  if (!String(L.name || L.company || L.phone || L.requirement || L.raw_text || '').trim() && !req.image_base64) throw new Error('Nothing to save.');
  var url = '', fileId = '';
  if (req.image_base64) {
    var blob = Utilities.newBlob(Utilities.base64Decode(req.image_base64), 'image/jpeg', (L.kind === 'note' ? 'Note_' : 'Card_') + String(L.company || L.name || 'lead').replace(/[\\\/:*?"<>|]+/g, '-').slice(0, 50) + '_' + new Date().getTime() + '.jpg');
    var file = getLeadFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    url = file.getUrl(); fileId = file.getId();
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_('Leads'), now = new Date().toISOString(), row = { id: Utilities.getUuid() };
    ['kind', 'name', 'company', 'designation', 'phone', 'email', 'website', 'address', 'gstin', 'requirement', 'items_text', 'raw_text', 'event'].forEach(function (k) { row[k] = L[k] === undefined || L[k] === null ? '' : String(L[k]).slice(0, 8000); });
    row.kind = row.kind === 'note' ? 'note' : 'card';
    row.image_url = url; row.image_file_id = fileId; row.status = 'New'; row.quote_no = '';
    row.created_by = user.id; row.created_by_name = user.full_name || user.email; row.created_at = now; row.updated_at = now;
    appendRow_(t, row);
    if (row.kind === 'card' && req.add_client !== false) { try { rememberClient_({ name: row.company || row.name, contact: row.name, phone: row.phone, email: row.email, address: row.address, gstin: row.gstin, source: 'Visiting card' + (row.event ? ' - ' + row.event : '') }, user); } catch (e) {} }
    return { data: row, error: null };
  } finally {
    lock.releaseLock();
  }
}
