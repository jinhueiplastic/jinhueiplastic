// ===== 設定區 =====
const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const SHEET1_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const SHEET2_ID = '1z4-qAYgzzKh5wSeLaIGUkPnAfeM-Rb_CRaawTonVMI0';

const CONTENT_PAGES = ['Content', 'About Us', 'Business Scope', 'Product Catalog', 'Join Us', 'Contact Us'];

// 商品欄位在 Categories 分頁裡的欄位順序（0-based），推送/拉回都用這份對照表
const PRODUCT_COLUMNS = [
  'category_name_zh', 'erp_code', 'catalog_code', 'name_zh',
  'on_alibaba', 'will_upload_alibaba', 'name_en', 'pcs_per_pack', 'unit',
  'image_url', 'desc_zh', 'desc_en',
  'dim_l', 'dim_w', 'dim_h', 'weight_kg', 'price_twd', 'price_usd',
  'item_weight', 'height_cm', 'size', 'colour', 'depth', 'thickness',
  'material', 'advantages', 'usage', 'notes', 'description',
  'moq', 'shipments', 'remark', 'sample_website', 'keywords',
  'store1_url', 'store2_url', 'store3_url', 'store4_url',
];
const NUMERIC_FIELDS = ['dim_l', 'dim_w', 'dim_h', 'weight_kg', 'price_twd', 'price_usd'];
const BOOLEAN_FIELDS = ['on_alibaba', 'will_upload_alibaba'];

// POS 下單用的商品子集合，放在 Sheet 2 的另一個分頁，欄位順序跟 Categories 分頁完全一樣
const POS_ITEMS_TAB = 'POS items';

// ===== 主選單 =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔄 Supabase 同步')
    .addItem('同步所有資料（推送到 Supabase）', 'syncAll')
    .addItem('只同步網站內容', 'syncSiteContent')
    .addItem('只推送產品資料到 Supabase', 'syncProducts')
    .addSeparator()
    .addItem('⬇️ 從 Supabase 拉回產品資料', 'pullProductsFromSupabase')
    .addSeparator()
    .addItem('只推送 POS items 到 Supabase', 'syncPosItems')
    .addItem('⬇️ 從 Supabase 拉回 POS items', 'pullPosItemsFromSupabase')
    .addToUi();
}

function syncAll() {
  syncSiteContent();
  syncProducts();
  SpreadsheetApp.getUi().alert('✅ 全部同步完成！');
}

// ===== 同步 Sheet 1：網站內容（未改動，仍是整批清空重寫） =====
function syncSiteContent() {
  const ss = SpreadsheetApp.openById(SHEET1_ID);
  let allRows = [];

  CONTENT_PAGES.forEach(pageName => {
    const sheet = ss.getSheetByName(pageName);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] && !row[1] && !row[2]) continue;
      allRows.push({
        page:      pageName,
        row_index: i,
        row_key:   String(row[0] || '').trim(),
        chinese:   String(row[1] || '').trim(),
        english:   String(row[2] || '').trim(),
        image:     String(row[3] || '').trim(),
        link:      String(row[4] || '').trim()
      });
    }
  });

  supabaseRequest('DELETE', '/rest/v1/site_content?id=neq.00000000-0000-0000-0000-000000000000', null);
  batchInsert('/rest/v1/site_content', allRows);
  Logger.log('網站內容同步完成，共 ' + allRows.length + ' 筆');
}

// ===== 推送 Sheet 2「Categories」→ Supabase（upsert，不會刪除既有資料） =====
function syncProducts() {
  const ss = SpreadsheetApp.openById(SHEET2_ID);
  const sheet = ss.getSheetByName('Categories');
  if (!sheet) { Logger.log('找不到 Categories 分頁'); return; }

  const data = sheet.getDataRange().getValues();

  const uniqueCats = [...new Set(
    data.slice(1).map(r => String(r[0]).trim()).filter(c => c)
  )];

  const catRows = uniqueCats.map((name, i) => ({ name_zh: name, sort_order: i }));
  let catResult = batchUpsertOnConflict('/rest/v1/categories', catRows, 'name_zh');

  const categoryMap = {};
  catResult.forEach(c => { categoryMap[c.name_zh] = c.id; });
  if (uniqueCats.some(name => !(name in categoryMap))) {
    const allCats = supabaseRequest('GET', '/rest/v1/categories?select=id,name_zh', null);
    if (allCats) allCats.forEach(c => { categoryMap[c.name_zh] = c.id; });
  }

  const products = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const catName = String(r[0]).trim();
    const erp = String(r[1] || '').trim();
    if (!catName || !erp) continue; // erp_code 是比對鍵，沒填就跳過，避免用空值互相覆蓋

    const product = { category_id: categoryMap[catName] || null };
    PRODUCT_COLUMNS.forEach((key, ci) => {
      const raw = r[ci];
      if (NUMERIC_FIELDS.includes(key)) {
        product[key] = parseFloat(raw) || null;
      } else if (BOOLEAN_FIELDS.includes(key)) {
        product[key] = raw === true || raw === 'TRUE' || raw === '是';
      } else {
        product[key] = String(raw || '').trim();
      }
    });
    // 注意：這裡故意不帶 is_active，避免每次同步把後台已下架的商品重新打開
    products.push(product);
  }

  // 用「erp_code + 分類」當比對鍵：同一個 erp_code 可以同時掛在不同分類底下，
  // 各自是獨立的一列，只用 erp_code 當鍵會把它們錯誤地合併成一筆。
  batchUpsertOnConflict('/rest/v1/products', products, 'erp_code,category_name_zh');
  Logger.log('產品同步完成，共 ' + products.length + ' 筆（依 erp_code+分類 upsert，不會刪除既有資料）');
}

// ===== 拉回 Supabase → Sheet 2「Categories」 =====
function pullProductsFromSupabase() {
  const ss = SpreadsheetApp.openById(SHEET2_ID);
  const sheet = ss.getSheetByName('Categories');
  if (!sheet) { SpreadsheetApp.getUi().alert('找不到 Categories 分頁'); return; }

  const products = supabaseRequest('GET', '/rest/v1/products?select=*&order=erp_code.asc', null);
  if (!products) {
    SpreadsheetApp.getUi().alert('讀取 Supabase 失敗，詳情請看「執行項目」的紀錄');
    return;
  }

  // 用「erp_code + 分類」當比對鍵（跟推送方向的 on_conflict 一致），
  // 因為同一個 erp_code 可能同時掛在不同分類底下，各是不同一列。
  const keyOf = (erp, cat) => erp + '||' + cat;

  const data = sheet.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    const erp = String(data[i][1] || '').trim();
    const cat = String(data[i][0] || '').trim();
    if (erp) rowByKey[keyOf(erp, cat)] = i + 1; // 試算表列號（1-based）
  }

  const toRowValues = p => PRODUCT_COLUMNS.map(key => {
    const v = p[key];
    if (BOOLEAN_FIELDS.includes(key)) return !!v;
    if (NUMERIC_FIELDS.includes(key)) return (v === null || v === undefined) ? '' : v;
    return v || '';
  });

  let updated = 0, appended = 0;
  const newRows = [];

  products.forEach(p => {
    const erp = String(p.erp_code || '').trim();
    if (!erp) return;
    const cat = String(p.category_name_zh || '').trim();
    const values = toRowValues(p);
    const rowNum = rowByKey[keyOf(erp, cat)];
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
      updated++;
    } else {
      newRows.push(values);
      appended++;
    }
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  SpreadsheetApp.getUi().alert('✅ 拉回完成：更新 ' + updated + ' 筆，新增 ' + appended + ' 筆');
}

// ===== 推送 Sheet 2「POS items」→ Supabase pos_items（upsert，不會刪除既有資料） =====
// POS items 只是 POS 可下單商品的子集合，跟 Categories/products 是分開獨立的資料，
// 官網跟「修改商品資料」頁面都不會用到 pos_items，只有 POS 下單頁面會讀。
// 欄位跟 Categories 分頁一樣，所以直接沿用同一份 PRODUCT_COLUMNS 對照表；
// 這裡沒有分類 id 對應，category_name_zh 就單純存文字。
function syncPosItems() {
  const ss = SpreadsheetApp.openById(SHEET2_ID);
  const sheet = ss.getSheetByName(POS_ITEMS_TAB);
  if (!sheet) { Logger.log('找不到 ' + POS_ITEMS_TAB + ' 分頁'); return; }

  const data = sheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const catName = String(r[0]).trim();
    const erp = String(r[1] || '').trim();
    if (!catName || !erp) continue;

    const item = {};
    PRODUCT_COLUMNS.forEach((key, ci) => {
      const raw = r[ci];
      if (NUMERIC_FIELDS.includes(key)) {
        item[key] = parseFloat(raw) || null;
      } else if (BOOLEAN_FIELDS.includes(key)) {
        item[key] = raw === true || raw === 'TRUE' || raw === '是';
      } else {
        item[key] = String(raw || '').trim();
      }
    });
    items.push(item);
  }

  batchUpsertOnConflict('/rest/v1/pos_items', items, 'erp_code,category_name_zh');
  Logger.log('POS items 同步完成，共 ' + items.length + ' 筆');
}

// ===== 拉回 Supabase pos_items → Sheet 2「POS items」 =====
function pullPosItemsFromSupabase() {
  const ss = SpreadsheetApp.openById(SHEET2_ID);
  const sheet = ss.getSheetByName(POS_ITEMS_TAB);
  if (!sheet) { SpreadsheetApp.getUi().alert('找不到 ' + POS_ITEMS_TAB + ' 分頁'); return; }

  const items = supabaseRequest('GET', '/rest/v1/pos_items?select=*&order=erp_code.asc', null);
  if (!items) {
    SpreadsheetApp.getUi().alert('讀取 Supabase 失敗，詳情請看「執行項目」的紀錄');
    return;
  }

  const keyOf = (erp, cat) => erp + '||' + cat;

  const data = sheet.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    const erp = String(data[i][1] || '').trim();
    const cat = String(data[i][0] || '').trim();
    if (erp) rowByKey[keyOf(erp, cat)] = i + 1;
  }

  const toRowValues = p => PRODUCT_COLUMNS.map(key => {
    const v = p[key];
    if (BOOLEAN_FIELDS.includes(key)) return !!v;
    if (NUMERIC_FIELDS.includes(key)) return (v === null || v === undefined) ? '' : v;
    return v || '';
  });

  let updated = 0, appended = 0;
  const newRows = [];

  items.forEach(p => {
    const erp = String(p.erp_code || '').trim();
    if (!erp) return;
    const cat = String(p.category_name_zh || '').trim();
    const values = toRowValues(p);
    const rowNum = rowByKey[keyOf(erp, cat)];
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
      updated++;
    } else {
      newRows.push(values);
      appended++;
    }
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  SpreadsheetApp.getUi().alert('✅ 拉回完成：更新 ' + updated + ' 筆，新增 ' + appended + ' 筆');
}

// ===== 工具函數 =====
function supabaseRequest(method, path, body) {
  const options = {
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    muteHttpExceptions: true
  };
  if (body) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(SUPABASE_URL + path, options);
  const code = res.getResponseCode();
  if (code >= 400) {
    Logger.log('錯誤 ' + code + ': ' + res.getContentText());
    return null;
  }
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}

// 一般 INSERT（用在 site_content，該表格每次都是先清空再整批寫入）
function batchInsert(path, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    supabaseRequest('POST', path, batch);
  }
}

// upsert：依指定欄位比對，存在就更新、不存在就新增，不會刪除其他既有資料
function supabaseUpsert(path, rows, onConflictCol) {
  if (!rows.length) return [];
  const options = {
    method: 'post',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  };
  const url = SUPABASE_URL + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'on_conflict=' + onConflictCol;
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code >= 400) {
    Logger.log('Upsert 錯誤 ' + code + ': ' + res.getContentText());
    return [];
  }
  try { return JSON.parse(res.getContentText()); } catch (e) { return []; }
}

function batchUpsertOnConflict(path, rows, onConflictCol, batchSize = 500) {
  let all = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    all = all.concat(supabaseUpsert(path, batch, onConflictCol));
  }
  return all;
}
