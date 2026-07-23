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

// POS 選項，欄位：erp_code | <軸名稱1> | <軸名稱2> | ... | 圖片網址 | 排序
// 中間的軸欄位是動態的，不再限定「規格/孔徑/顏色」3 欄——想要幾種軸、軸叫什麼名字都可以
// （例如型號、W、H、L、A排水孔位、備註…），欄位直接填實際值（不是打記號）：
//   一列只填其中一欄 → 定義一個可點選項目（圖片網址是這個選項的示意圖）
//   一列填兩欄以上   → 一筆完整組合（例如規格+顏色都填 = 那個規格搭那個顏色的實拍照；
//                      也可以只是資訊，不一定要有照片，例如型號+W+H+L）
// 表頭中間那些軸名稱欄位會在「⬇️ 拉回」的時候，直接照 Supabase 目前有的軸自動重新產生。
const POS_VARIANTS_TAB = 'POS variants';

// ===== 網站（Supabase）資料一有異動就自動拉回 Google Sheet =====
// 要生效需要兩個一次性設定，兩個都要在你自己的帳號裡手動點，程式碼本身沒辦法幫你做：
//
// 步驟 1：把這個檔案部署成「網頁應用程式」
//   Apps Script 編輯器右上角「部署」→「新增部署」，類型選「網頁應用程式」，
//   「執行身分」選你自己，「誰可以存取」選「所有人」，按部署，會拿到一個網址
//   （長得像 https://script.google.com/macros/s/xxxxx/exec）。
//   之後如果又改了這個檔案，要「管理部署」→ 針對同一個部署按編輯（鉛筆圖示）→
//   版本選「新版本」再部署一次，網址才會套用新的程式碼（重新整理網址不會自動生效）。
//
// 步驟 2：到 Supabase 後台設定 Database Webhook
//   左側選單 Database → Webhooks → Create a new hook，對 products／pos_items／
//   pos_item_variants 這 3 張表各自新增一個：Events 勾 Insert、Update、Delete，
//   Type 選 HTTP Request，Method 選 POST，URL 貼上步驟 1 拿到的網址，
//   後面自己加上 ?secret=（換成跟下面 WEBHOOK_SECRET 一樣的一串亂碼）。
//
// 網址要帶 ?secret=xxx 是避免別人猜到這個網址就能亂觸發同步
// （Apps Script 網頁應用程式讀不到自訂的 Header，密鑰只能放在網址上），
// 記得把下面這個字串換成你自己想的一串，不要用預設值。
const WEBHOOK_SECRET = 'giohoioghidfogjhisaqzz';

// 從網頁應用程式（doPost）或定時觸發器呼叫拉回函式時，沒有「使用中的試算表視窗」，
// 直接呼叫 SpreadsheetApp.getUi() 會噴錯，統一包一層安全版本，取不到 UI 就安靜略過、寫進執行紀錄就好。
function safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    Logger.log(message);
  }
}

function doPost(e) {
  const secret = e && e.parameter && e.parameter.secret;
  if (secret !== WEBHOOK_SECRET) {
    return ContentService.createTextOutput('forbidden');
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad payload');
  }

  const table = payload && payload.table;

  // 短時間內同一張表被連續改好幾筆（例如一次儲存好幾列規格），Supabase 會一列送一次事件，
  // 先搶鎖，搶不到代表已經有另一次同步在跑了，這次先略過（多半沒差，因為那一次通常也會把
  // 最新狀態一起拉回去；真的很不巧漏掉的話，下一次任何異動或手動「⬇️ 拉回」都會補齊）。
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return ContentService.createTextOutput('busy, skipped');
  }
  try {
    if (table === 'products') {
      pullProductsFromSupabase();
    } else if (table === 'pos_items') {
      pullPosItemsFromSupabase();
    } else if (table === 'pos_item_variants') {
      pullPosVariantsFromSupabase();
    }
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput('ok');
}

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
    .addSeparator()
    .addItem('只推送 POS variants 到 Supabase', 'syncPosVariants')
    .addItem('⬇️ 從 Supabase 拉回 POS variants', 'pullPosVariantsFromSupabase')
    .addToUi();
}

function syncAll() {
  syncSiteContent();
  syncProducts();
  safeAlert('✅ 全部同步完成！');
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
  if (!sheet) { safeAlert('找不到 Categories 分頁'); return; }

  const products = supabaseRequest('GET', '/rest/v1/products?select=*&order=erp_code.asc', null);
  if (!products) {
    safeAlert('讀取 Supabase 失敗，詳情請看「執行項目」的紀錄');
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

  safeAlert('✅ 拉回完成：更新 ' + updated + ' 筆，新增 ' + appended + ' 筆');
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
  if (!sheet) { safeAlert('找不到 ' + POS_ITEMS_TAB + ' 分頁'); return; }

  const items = supabaseRequest('GET', '/rest/v1/pos_items?select=*&order=erp_code.asc', null);
  if (!items) {
    safeAlert('讀取 Supabase 失敗，詳情請看「執行項目」的紀錄');
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

  safeAlert('✅ 拉回完成：更新 ' + updated + ' 筆，新增 ' + appended + ' 筆');
}

// 頭尾固定欄位，中間的軸欄位是動態的（見下面 posVariantsAxisColumns）。
const POS_VARIANTS_FIXED_HEADERS_HEAD = ['erp_code'];
const POS_VARIANTS_FIXED_HEADERS_TAIL = ['圖片網址', '排序'];

// 找不到「POS variants」分頁就自動新增一個，並補上最基本的表頭（還沒有任何軸）。
// 實際的軸欄位要跑一次「⬇️ 拉回」才會自動出現；分頁已經有內容的話完全不動。
function ensurePosVariantsSheet() {
  const ss = SpreadsheetApp.openById(SHEET2_ID);
  let sheet = ss.getSheetByName(POS_VARIANTS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(POS_VARIANTS_TAB);
  }

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const isEmpty = firstRow.every(v => String(v || '').trim() === '');
  if (isEmpty) {
    const headers = POS_VARIANTS_FIXED_HEADERS_HEAD.concat(POS_VARIANTS_FIXED_HEADERS_TAIL);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
  }

  return sheet;
}

// 讀目前表頭，算出中間那些「軸名稱」欄位分別在第幾欄（跳過第一欄 erp_code、最後兩欄 圖片網址/排序）。
function posVariantsAxisColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const minCols = POS_VARIANTS_FIXED_HEADERS_HEAD.length + POS_VARIANTS_FIXED_HEADERS_TAIL.length;
  if (lastCol <= minCols) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const axisStart = POS_VARIANTS_FIXED_HEADERS_HEAD.length; // 0-based
  const axisEnd = lastCol - POS_VARIANTS_FIXED_HEADERS_TAIL.length; // 不含
  const cols = [];
  for (let i = axisStart; i < axisEnd; i++) {
    if (headers[i]) cols.push({ name: headers[i], col: i });
  }
  return cols;
}

// ===== 推送 Sheet 2「POS variants」→ Supabase pos_item_variants =====
function syncPosVariants() {
  const sheet = ensurePosVariantsSheet();
  const axisCols = posVariantsAxisColumns(sheet);
  if (!axisCols.length) {
    Logger.log('POS variants 目前沒有任何軸欄位可以推送（表頭中間是空的，先跑一次「⬇️ 拉回」或自己在表頭中間加欄位）。');
    return;
  }

  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const erp = String(r[0] || '').trim();
    if (!erp) continue;

    const axisValues = {};
    axisCols.forEach(({ name, col }) => {
      const v = String(r[col] || '').trim();
      if (v) axisValues[name] = v;
    });
    if (!Object.keys(axisValues).length) continue; // 至少要有一個軸有值

    rows.push({
      erp_code: erp,
      axis_values: axisValues,
      image_url: String(r[r.length - 2] || '').trim(),
      sort_order: Number(r[r.length - 1]) || 0,
    });
  }

  batchUpsertOnConflict('/rest/v1/pos_item_variants', rows, 'erp_code,axis_values');
  Logger.log('POS variants 同步完成，共 ' + rows.length + ' 筆');
}

// ===== 拉回 Supabase pos_item_variants → Sheet 2「POS variants」 =====
// 軸欄位可能會變多變少，所以這裡是整份重新產生（表頭＋所有列），不是像其他分頁那樣只補差異，
// 這樣才能保證表頭一定跟 Supabase 目前的軸完全對得上，不會有欄位對不齊的問題。
function pullPosVariantsFromSupabase() {
  const sheet = ensurePosVariantsSheet();

  const rows = supabaseRequest('GET', '/rest/v1/pos_item_variants?select=*&order=erp_code.asc', null);
  if (!rows) {
    safeAlert('讀取 Supabase 失敗，詳情請看「執行項目」的紀錄');
    return;
  }

  // 算出所有商品目前用過的軸名稱聯集（依第一次出現的順序排列），當成新的表頭中間欄位。
  const axisNames = [];
  const seen = {};
  rows.forEach(v => {
    Object.keys(v.axis_values || {}).forEach(name => {
      if (!seen[name]) { seen[name] = true; axisNames.push(name); }
    });
  });

  const headers = POS_VARIANTS_FIXED_HEADERS_HEAD.concat(axisNames, POS_VARIANTS_FIXED_HEADERS_TAIL);

  const dataRows = rows
    .filter(v => String(v.erp_code || '').trim() && Object.keys(v.axis_values || {}).length)
    .map(v => {
      const row = new Array(headers.length).fill('');
      row[0] = v.erp_code;
      axisNames.forEach((name, i) => {
        row[POS_VARIANTS_FIXED_HEADERS_HEAD.length + i] = (v.axis_values || {})[name] || '';
      });
      row[headers.length - 2] = v.image_url || '';
      row[headers.length - 1] = v.sort_order || 0;
      return row;
    });

  sheet.clear();
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  if (dataRows.length) {
    sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
  }

  safeAlert('✅ 拉回完成：共 ' + dataRows.length + ' 筆，' + axisNames.length + ' 種軸（' + axisNames.join('、') + '）');
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
