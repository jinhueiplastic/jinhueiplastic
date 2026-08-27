const PRODUCT_FIELDS = [
    { key: 'category_name_zh', label: '分類（中文）' },
    { key: 'category_name_en', label: '分類（英文）' },
    { key: 'erp_code',         label: 'ERP 貨號' },
    { key: 'catalog_code',     label: '型錄貨號' },
    { key: 'name_zh',          label: '中文品名' },
    { key: 'name_en',          label: '英文品名' },
    { key: 'order_display_name', label: '下單名稱', hint: '不填的話 POS 下單／查詢訂單／區域表單顯示中文品名' },
    { key: 'keywords',         label: '關鍵字', hint: '別名，幫助 POS 下單搜尋到，不會顯示在畫面上' },
    { key: 'image_url',        label: '圖片網址' },
    { key: 'desc_zh',          label: '中文說明', textarea: true },
    { key: 'desc_en',          label: '英文說明', textarea: true },
];

let allProducts = [];
let editingId = null;
let modalDirty = false; // 表單或規格選項有沒有還沒儲存的修改
let selectedCategoryFilter = null; // null = 全部
let showOnlyPendingPos = false; // 只顯示「來自 POS 下單，待補齊資料」的商品（點那個標記進來的）

// 從 POS 下單商品卡片按「編輯」過來的話網址會帶 ?edit=<id>：進頁面時自動打開那個商品的編輯
// 視窗（initProductsPage），存檔成功後也直接導回 POS 下單（productForm 的 submit handler），
// 不用使用者自己再點導覽列切回去。
const editIdFromUrl = new URLSearchParams(location.search).get('edit');

const statusMsg   = document.getElementById('status-msg');
const tbody       = document.getElementById('product-tbody');
const searchInput = document.getElementById('search-input');

const modal        = document.getElementById('edit-modal');
const modalTitle    = document.getElementById('modal-title');
const productForm   = document.getElementById('product-form');
const formError      = document.getElementById('form-error');

// 商品欄位分成上下兩塊（form-fields-top／form-fields-bottom），中間夾著 POS 規格／孔徑／顏色選項，
// 順序才會是：分類～名稱 → 圖片 → POS 規格／孔徑／顏色選項 → 中文說明…等其餘欄位。
// 查詢欄位（.querySelector 之類）沿用 formFields 這個名字，但範圍擴大到整個表單，兩塊都找得到。
const formFieldsTop    = document.getElementById('form-fields-top');
const formFieldsBottom = document.getElementById('form-fields-bottom');
const formFields = productForm;

// 表單裡任何欄位（包含動態產生的商品欄位、規格表格編輯工具的儲存格）有異動就標記為未儲存。
// 「訂單單位」是全店共用、新增刪除立即生效的，不算這個商品表單的異動，排除在外。
function isDirtyTrackedEvent(e) {
    return !e.target.closest('#unit-section');
}
productForm.addEventListener('input', (e) => { if (isDirtyTrackedEvent(e)) modalDirty = true; });
productForm.addEventListener('change', (e) => { if (isDirtyTrackedEvent(e)) modalDirty = true; });

function setStatus(msg) {
    statusMsg.textContent = msg;
}

async function loadProducts() {
    setStatus('載入商品資料中…');
    // row_index 是 Google Sheet「POS items」分頁同步過來的列順序。改成主要排序依據
    // （不先照分類排），這樣分類本身出現的順序、還有同分類底下商品的順序，
    // 才會一起跟著 Sheet 由上到下一致（哪個分類的商品先出現在 Sheet 上面，那個分類就排前面）。
    const { data, error } = await sb
        .from('pos_items')
        .select('*')
        .order('row_index', { ascending: true })
        .order('erp_code', { ascending: true });

    if (error) {
        setStatus('');
        tbody.innerHTML = `<p class="text-center text-red-600 py-6">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    allProducts = data || [];
    setStatus(`共 ${allProducts.length} 筆商品`);
    renderCategoryFilterTiles();
    renderPendingPosFilterBar();
    applyFilters();
}

// 點商品列上「來自 POS 下單，待補齊資料」的標記，篩選成只顯示這些商品；這裡顯示目前還有
// 幾筆待補齊、以及一個清除篩選的按鈕（篩選中的話）。
function renderPendingPosFilterBar() {
    const bar = document.getElementById('pending-pos-filter-bar');
    if (!bar) return;
    const pendingCount = allProducts.filter(p => p.added_from_pos).length;

    if (showOnlyPendingPos) {
        bar.innerHTML = `
            <div class="inline-flex items-center gap-2 text-sm bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                <span class="text-orange-700">只顯示來自 POS 下單、待補齊資料的商品（${pendingCount} 筆）</span>
                <button type="button" id="clear-pending-pos-filter-btn" class="text-blue-600 hover:underline">顯示全部商品</button>
            </div>`;
        document.getElementById('clear-pending-pos-filter-btn').addEventListener('click', () => {
            showOnlyPendingPos = false;
            renderPendingPosFilterBar();
            applyFilters();
        });
    } else if (pendingCount > 0) {
        bar.innerHTML = `<button type="button" id="pending-pos-filter-btn" class="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 hover:bg-orange-100">來自 POS 下單（${pendingCount} 筆待補齊資料）</button>`;
        document.getElementById('pending-pos-filter-btn').addEventListener('click', () => {
            showOnlyPendingPos = true;
            renderPendingPosFilterBar();
            applyFilters();
        });
    } else {
        bar.innerHTML = '';
    }
}

// 桌面版用按鈕，手機版（畫面比較窄，這頁又常常在手機上用）改用下拉選單，
// 不用一次把所有分類的按鈕都塞在畫面上。兩邊共用同一個 selectedCategoryFilter 狀態。
function renderCategoryFilterTiles() {
    const container = document.getElementById('category-filter-tiles');
    const select = document.getElementById('category-filter-select');
    if (!container && !select) return;

    // allProducts 已經照 Google Sheet 的 row_index 排過序了，Set 保留第一次出現的順序，
    // 篩選按鈕的分類順序才會跟下面商品清單的分類順序一致。
    const categories = [...new Set(allProducts.map(p => (p.category_name_zh || '').trim()).filter(Boolean))];

    if (container) {
        const allBtn = `
            <button type="button" class="category-filter-btn${selectedCategoryFilter ? '' : ' active'}" data-cat="">
                全部
            </button>`;
        const catBtns = categories.map(c => `
            <button type="button" class="category-filter-btn${selectedCategoryFilter === c ? ' active' : ''}" data-cat="${escapeHtml(c)}">
                ${escapeHtml(c)}
            </button>`).join('');

        container.innerHTML = allBtn + catBtns;

        container.querySelectorAll('.category-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedCategoryFilter = btn.dataset.cat || null;
                renderCategoryFilterTiles();
                applyFilters();
            });
        });
    }

    if (select) {
        select.innerHTML = '<option value="">全部分類</option>' +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        select.value = selectedCategoryFilter || '';

        select.onchange = () => {
            selectedCategoryFilter = select.value || null;
            renderCategoryFilterTiles();
            applyFilters();
        };
    }
}

function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    let filtered = allProducts;
    if (showOnlyPendingPos) {
        filtered = filtered.filter(p => p.added_from_pos);
    }
    if (selectedCategoryFilter) {
        filtered = filtered.filter(p => (p.category_name_zh || '').trim() === selectedCategoryFilter);
    }
    if (q) {
        filtered = filtered.filter(p => {
            return [p.category_name_zh, p.erp_code, p.catalog_code, p.name_zh, p.name_en]
                .some(v => String(v || '').toLowerCase().includes(q));
        });
    }
    renderTable(filtered);
}

// 分類本身出現的順序，跟著傳進來的 products 陣列裡「第一次遇到這個分類」的順序走
// （products 已經照 Google Sheet 的 row_index 排過序了，所以分類順序也會是 Sheet 由上到下、
// 哪個分類的商品先出現在 Sheet 上面，那個分類就排前面），不再另外照分類名稱字母排序。
function groupByCategory(products) {
    const groups = new Map();
    products.forEach(p => {
        const cat = (p.category_name_zh || '').trim() || '未分類';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(p);
    });
    return [...groups.entries()];
}

function productCardHtml(p) {
    const img = String(p.image_url || '').split(',')[0].trim();
    const thumb = img
        ? `<img src="${escapeHtml(img)}" alt="" class="product-card-thumb">`
        : `<div class="product-card-thumb"></div>`;

    // 有設定下單名稱的話優先顯示下單名稱，原本的商品名稱用括號附註在後面方便對照；沒設定就只顯示商品名稱。
    const orderName = (p.order_display_name || '').trim();
    const nameLine = orderName ? `${orderName}（${p.name_zh || ''}）` : (p.name_zh || '');

    // 從「POS 下單」選購商品那邊當場新增的商品，資料通常還不齊全（可能只有一個暫時
    // 拼湊的 ERP 編號、沒有圖片/價格），標記出來提醒要補齊；補齊後在這裡按儲存就會自動清掉。
    const quickAddBadge = p.added_from_pos
        ? `<button type="button" class="quick-add-badge-btn product-card-pending-strip" title="只顯示這些待補齊的商品">來自 POS 下單，待補齊資料</button>`
        : '';

    return `
        <div class="product-card">
            <div class="product-card-thumb-wrap">
                ${thumb}
                <label class="product-card-status-pill" title="上架/下架">
                    <input type="checkbox" data-id="${p.id}" class="active-toggle" ${p.is_active ? 'checked' : ''}>
                    <span>上架</span>
                </label>
            </div>
            <div class="product-card-info">
                <p class="product-card-erp">${escapeHtml(p.erp_code || '')}</p>
                <p class="product-card-name">${escapeHtml(nameLine)}</p>
                <button data-id="${p.id}" class="edit-btn product-card-edit">編輯</button>
            </div>
            ${quickAddBadge}
        </div>`;
}

// 每個系列（分類）目前的上架狀態：全部上架／全部下架／有上架有下架混著。
// 分類標題列的全選勾用這個決定要顯示打勾、空白、還是半勾（indeterminate）。
function categoryActiveState(items) {
    const activeCount = items.filter(p => p.is_active).length;
    if (activeCount === 0) return 'none';
    if (activeCount === items.length) return 'all';
    return 'some';
}

function renderTable(products) {
    if (!products.length) {
        tbody.innerHTML = `<p class="text-center text-gray-400 py-6">目前沒有商品資料</p>`;
        return;
    }

    const groups = groupByCategory(products);
    tbody.innerHTML = groups.map(([cat, items]) => `
        <div class="category-header rounded-lg px-3 py-2">
            <input type="checkbox" class="category-toggle-all" data-cat="${escapeHtml(cat)}" title="整個系列上架／下架">
            <span class="flex-1">${escapeHtml(cat)}（${items.length}）</span>
            <button type="button" class="category-bulk-unit-btn text-xs text-blue-700 hover:underline whitespace-nowrap" data-cat="${escapeHtml(cat)}">批次設定單位</button>
            <button type="button" class="category-rename-btn text-xs text-blue-700 hover:underline whitespace-nowrap" data-cat="${escapeHtml(cat)}">重新命名系列</button>
        </div>
        <div class="grid-cards mb-4">${items.map(productCardHtml).join('')}</div>
    `).join('');

    tbody.querySelectorAll('.category-toggle-all').forEach(cb => {
        const catName = cb.dataset.cat;
        const [, items] = groups.find(([c]) => c === catName);
        const state = categoryActiveState(items);
        cb.checked = state === 'all';
        cb.indeterminate = state === 'some';
        cb.addEventListener('change', () => toggleCategoryActive(catName, items, cb.checked));
    });

    tbody.querySelectorAll('.category-rename-btn').forEach(btn => {
        const catName = btn.dataset.cat;
        const [, items] = groups.find(([c]) => c === catName);
        btn.addEventListener('click', () => renameCategoryBulk(catName, items));
    });

    tbody.querySelectorAll('.category-bulk-unit-btn').forEach(btn => {
        const catName = btn.dataset.cat;
        const [, items] = groups.find(([c]) => c === catName);
        btn.addEventListener('click', () => bulkApplyUnitsToCategory(catName, items));
    });

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.active-toggle').forEach(cb => {
        cb.addEventListener('change', () => toggleActive(cb.dataset.id, cb.checked));
    });
    tbody.querySelectorAll('.quick-add-badge-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showOnlyPendingPos = true;
            renderPendingPosFilterBar();
            applyFilters();
        });
    });
}

async function toggleActive(id, isActive) {
    const { error } = await sb
        .from('pos_items')
        .update({ is_active: isActive })
        .eq('id', id);
    if (error) {
        alert('更新失敗：' + error.message);
        return;
    }
    const p = allProducts.find(x => String(x.id) === String(id));
    if (p) p.is_active = isActive;
}

// 分類標題列的全選勾：一次把整個系列（目前篩選/搜尋結果裡看得到的這些商品）都改成上架或下架。
async function toggleCategoryActive(cat, items, isActive) {
    if (!confirm(`確定要把「${cat}」整個系列的 ${items.length} 項商品都改成${isActive ? '上架' : '下架'}嗎？`)) {
        applyFilters(); // 取消的話把全選勾重畫回原本的狀態，不要留著使用者剛點但沒生效的勾選外觀
        return;
    }

    const ids = items.map(p => p.id);
    const { error } = await sb.from('pos_items').update({ is_active: isActive }).in('id', ids);
    if (error) {
        alert('更新失敗：' + error.message);
        applyFilters();
        return;
    }
    ids.forEach(id => {
        const p = allProducts.find(x => String(x.id) === String(id));
        if (p) p.is_active = isActive;
    });
    applyFilters(); // 整批改完重新畫一次，每張卡片跟這個全選勾才會一起反映最新狀態
}

// 把整個系列重新命名：底下每一項商品的分類（中文）都改成新名稱。
// 只改分類（中文），分類（英文）不動。
async function renameCategoryBulk(catName, items) {
    const raw = prompt(`把「${catName}」這個系列重新命名成？（底下 ${items.length} 項商品的分類（中文）都會一起改）`, catName);
    if (raw === null) return;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === catName) return;

    if (allProducts.some(p => (p.category_name_zh || '').trim() === trimmed)) {
        if (!confirm(`已經有「${trimmed}」這個系列了，這樣會把兩個系列合併成一個，確定嗎？`)) return;
    }

    const ids = items.map(p => p.id);
    const { error } = await sb.from('pos_items').update({ category_name_zh: trimmed }).in('id', ids);
    if (error) { alert('重新命名失敗：' + error.message); return; }

    ids.forEach(id => {
        const p = allProducts.find(x => String(x.id) === String(id));
        if (p) p.category_name_zh = trimmed;
    });
    if (selectedCategoryFilter === catName) selectedCategoryFilter = trimmed;
    renderCategoryFilterTiles();
    applyFilters();
}

// 把一批單位名稱套用到整個系列的每一項商品身上（新增/更新，不會移除商品原本已有的其他單位）。
async function bulkApplyUnitsToCategory(catName, items) {
    const raw = prompt(`要套用到「${catName}」整個系列（${items.length} 項商品）的單位？（用 / 分隔，可以打多個，例如：只/箱）`);
    if (!raw) return;
    const unitNames = splitBulkValues(raw);
    if (!unitNames.length) return;

    if (!confirm(`確定要把單位（${unitNames.join('、')}）套用到「${catName}」系列的 ${items.length} 項商品嗎？（不會移除商品原本已有的其他單位）`)) return;

    const rows = [];
    items.forEach(p => {
        unitNames.forEach((name, i) => rows.push({ erp_code: p.erp_code, name, sort_order: i }));
    });

    const { error } = await sb.from('pos_item_units').upsert(rows, { onConflict: 'erp_code,name' });
    if (error) { alert('套用失敗：' + error.message); return; }

    const newKnown = unitNames.filter(n => !knownUnits.includes(n));
    if (newKnown.length) {
        const { error: knownErr } = await sb.from('pos_units')
            .upsert(newKnown.map((name, i) => ({ name, sort_order: knownUnits.length + i })), { onConflict: 'name' });
        if (!knownErr) knownUnits.push(...newKnown);
    }

    alert(`已套用到「${catName}」系列的 ${items.length} 項商品。`);
}

searchInput.addEventListener('input', applyFilters);

let descTableStates = {};

function buildFormFields(product) {
    descTableStates = {
        desc_zh: parseFirstTable(product ? (product.desc_zh || '') : ''),
        desc_en: parseFirstTable(product ? (product.desc_en || '') : ''),
    };

    // 分類～名稱→圖片放上半部；中文說明…等其餘欄位放下半部，中間插入 POS 規格／孔徑／顏色選項（靜態 HTML）。
    const splitIndex = PRODUCT_FIELDS.findIndex(f => f.key === 'desc_zh');
    const topFields = PRODUCT_FIELDS.slice(0, splitIndex);
    const bottomFields = PRODUCT_FIELDS.slice(splitIndex);

    const renderField = (f) => {
        const value = product ? (product[f.key] ?? '') : '';
        const escaped = escapeHtml(String(value));
        if (f.textarea) {
            const isTableField = f.key === 'desc_zh' || f.key === 'desc_en';
            return `
                <div class="sm:col-span-2">
                    <div class="flex items-center justify-between mb-1">
                        <label class="field-label !mb-0">${f.label}</label>
                        ${isTableField ? `<button type="button" class="table-tool-toggle text-xs text-blue-600 hover:underline" data-toggle-key="${f.key}">規格表格編輯工具</button>` : ''}
                    </div>
                    ${fieldDisplayHtml(f.key, escaped)}
                    <textarea class="field-input hidden" rows="4" data-key="${f.key}">${escaped}</textarea>
                    ${isTableField ? `<div class="table-tool-panel hidden mt-2 border rounded-lg p-3 bg-gray-50" data-panel-key="${f.key}"></div>` : ''}
                </div>`;
        }
        if (f.key === 'image_url') {
            const previewSrc = String(value).split(',')[0].trim();
            return `
                <div class="sm:col-span-2">
                    <label class="field-label">${f.label}</label>
                    <div class="flex items-start gap-3">
                        <img id="image-preview" src="${escapeHtml(previewSrc)}" alt=""
                             class="product-thumb" style="width:64px;height:64px;flex-shrink:0;">
                        <div class="flex-1 min-w-0 space-y-2">
                            <input type="text" id="image-url-input" class="field-input" data-key="${f.key}" value="${escaped}"
                                   oninput="document.getElementById('image-preview').src = this.value.split(',')[0].trim()">
                            <div class="flex items-center gap-2 flex-wrap">
                                <input type="file" id="image-upload-input" accept="image/*" class="text-xs min-w-0">
                                <span id="image-upload-status" class="text-xs text-gray-400"></span>
                            </div>
                        </div>
                    </div>
                </div>`;
        }
        return `
            <div>
                ${fieldLabelHtml(f)}
                ${fieldDisplayHtml(f.key, escaped)}
                <input type="text" class="field-input hidden" data-key="${f.key}" value="${escaped}">
            </div>`;
    };

    formFieldsTop.innerHTML = topFields.map(renderField).join('');
    formFieldsBottom.innerHTML = bottomFields.map(renderField).join('');

    // 上架開關搬到彈窗標題列（不是動態重畫的欄位區塊），這裡照商品資料把勾選狀態設好。
    document.getElementById('form-is-active').checked = !(product && product.is_active === false);

    wireClickToEditFields();

    formFields.querySelectorAll('.table-tool-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleTableTool(btn.dataset.toggleKey));
    });

    const imageUploadInput = formFields.querySelector('#image-upload-input');
    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', async () => {
            const file = imageUploadInput.files[0];
            if (!file) return;

            const statusEl = document.getElementById('image-upload-status');
            const urlInput = document.getElementById('image-url-input');
            statusEl.textContent = '上傳中…';

            try {
                const url = await uploadImageToCloudinary(file);
                const existing = urlInput.value.trim();
                urlInput.value = existing ? existing + ', ' + url : url;
                document.getElementById('image-preview').src = url;
                statusEl.textContent = '上傳成功';
            } catch (e) {
                statusEl.textContent = '上傳失敗：' + e.message;
            } finally {
                imageUploadInput.value = '';
            }
        });
    }
}

// 除了圖片欄位以外，其他欄位（分類～名稱、規格說明、包裝規格…等）平常只顯示純文字，
// 手機上一堆輸入框疊在一起很雜；點一下文字才變成輸入框可以改，改完點別的地方就變回文字。
const FIELD_EMPTY_PLACEHOLDER = '<span class="text-gray-400">（點一下輸入）</span>';

function fieldDisplayHtml(key, escapedValue) {
    return `<div class="field-display-text" data-display-for="${key}">${escapedValue || FIELD_EMPTY_PLACEHOLDER}</div>`;
}

// 欄位標籤本身；有 hint（比較長的用法補充說明）的話，額外補一個小圓框「!」，
// 滑鼠移過去才彈出來，不要讓每個欄位下面都掛一長串說明文字。
function fieldLabelHtml(f) {
    if (!f.hint) return `<label class="field-label">${f.label}</label>`;
    return `
        <label class="field-label flex items-center gap-1">
            ${f.label}
            <span class="info-tip" tabindex="0">
                <span>!</span>
                <span class="info-tip-text">${f.hint}</span>
            </span>
        </label>`;
}

function wireClickToEditFields() {
    formFields.querySelectorAll('[data-display-for]').forEach(displayEl => {
        const key = displayEl.dataset.displayFor;
        const inputEl = formFields.querySelector(`[data-key="${key}"]`);
        if (!inputEl) return;

        displayEl.addEventListener('click', () => {
            displayEl.classList.add('hidden');
            inputEl.classList.remove('hidden');
            inputEl.focus();
            if (inputEl.tagName === 'INPUT') inputEl.select();
        });

        inputEl.addEventListener('blur', () => {
            inputEl.classList.add('hidden');
            const v = inputEl.value.trim();
            displayEl.innerHTML = v ? escapeHtml(v) : FIELD_EMPTY_PLACEHOLDER;
            displayEl.classList.remove('hidden');
        });

        if (inputEl.tagName === 'INPUT') {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') inputEl.blur();
            });
        }
    });
}

/* --- 規格表格編輯工具：把 desc_zh / desc_en 裡的 markdown 表格轉成可視化表格 --- */
function parseFirstTable(text) {
    const lines = String(text || '').split('\n');
    let start = -1, end = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.includes('|')) {
            if (start === -1) start = i;
            end = i;
        } else if (start !== -1) {
            break;
        }
    }
    if (start === -1) {
        return { headers: ['規格'], rows: [['']], prefix: text || '', suffix: '' };
    }
    const cellsOf = line => line.trim().split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
    const tableLines = lines.slice(start, end + 1);
    const headers = cellsOf(tableLines[0]);
    const dataLines = tableLines.slice(1).filter(l => !/^[|:\s-]+$/.test(l.trim()));
    const rows = dataLines.map(cellsOf).filter(r => r.length);
    return {
        headers: headers.length ? headers : ['規格'],
        rows: rows.length ? rows : [headers.map(() => '')],
        prefix: lines.slice(0, start).join('\n'),
        suffix: lines.slice(end + 1).join('\n'),
    };
}

function buildTableMarkdown(headers, rows) {
    const headerLine = '| ' + headers.map(h => h || '').join(' | ') + ' |';
    const sepLine = '| ' + headers.map(() => ':---').join(' | ') + ' |';
    const rowLines = rows.map(r => '| ' + headers.map((_, i) => (r[i] || '')).join(' | ') + ' |');
    return [headerLine, sepLine, ...rowLines].join('\n');
}

function composeText(state) {
    const table = buildTableMarkdown(state.headers, state.rows);
    return [state.prefix, table, state.suffix].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
}

function swap(arr, i, j) {
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
}

function toggleTableTool(key) {
    const panel = formFields.querySelector(`.table-tool-panel[data-panel-key="${key}"]`);
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    panel.classList.remove('hidden');
    renderTableToolPanel(key);

    // 打開表格工具等於要開始編輯這個欄位，把「純文字顯示」切成輸入框（跟點文字進去編輯是同一個狀態）。
    const displayEl = formFields.querySelector(`[data-display-for="${key}"]`);
    const textarea = formFields.querySelector(`textarea[data-key="${key}"]`);
    if (displayEl && textarea) {
        displayEl.classList.add('hidden');
        textarea.classList.remove('hidden');
    }
}

function syncTextarea(key) {
    const textarea = formFields.querySelector(`textarea[data-key="${key}"]`);
    if (!textarea) return;
    textarea.value = composeText(descTableStates[key]);

    // 表格工具是直接改 textarea.value（不是使用者自己打字觸發 blur），純文字顯示要一併同步，
    // 不然使用者收起輸入框看到的還是表格工具編輯前的舊文字。
    const displayEl = formFields.querySelector(`[data-display-for="${key}"]`);
    if (displayEl) {
        const v = textarea.value.trim();
        displayEl.innerHTML = v ? escapeHtml(v) : FIELD_EMPTY_PLACEHOLDER;
    }
}

// 結構性操作（新增/刪除/移動 列或欄）從中文表格同步到英文表格，
// 讓中英文表格的列數、欄數、順序保持一致；儲存格文字（規格數值通常中英通用）也一併帶過去。
// 英文表格單獨操作則不會回寫中文表格。
function runOp(key, mutateFn) {
    mutateFn(descTableStates[key]);
    syncTextarea(key);
    if (key === 'desc_zh') {
        mutateFn(descTableStates['desc_en']);
        syncTextarea('desc_en');
        const enPanel = formFields.querySelector(`.table-tool-panel[data-panel-key="desc_en"]`);
        if (enPanel && !enPanel.classList.contains('hidden')) renderTableToolPanel('desc_en');
    }
    renderTableToolPanel(key);
}

function updatePreviewBox(key) {
    const panel = formFields.querySelector(`.table-tool-panel[data-panel-key="${key}"]`);
    const box = panel && panel.querySelector('.preview-box');
    if (box) box.innerHTML = renderPreviewTable(descTableStates[key]);
}

// 純粹修改儲存格文字：不重畫整個表格（避免打字打到一半輸入框被重建、游標跟焦點跑掉）。
// 只有列數/欄數變動（新增、刪除、搬移）才需要整個重畫，交給 runOp 處理。
function setCellValue(key, ri, ci, value) {
    const state = descTableStates[key];
    if (state.rows[ri]) state.rows[ri][ci] = value;
    syncTextarea(key);
    updatePreviewBox(key);

    if (key === 'desc_zh') {
        const enState = descTableStates['desc_en'];
        if (enState.rows[ri]) {
            enState.rows[ri][ci] = value;
            syncTextarea('desc_en');
            updatePreviewBox('desc_en');
            const enPanel = formFields.querySelector(`.table-tool-panel[data-panel-key="desc_en"]`);
            if (enPanel && !enPanel.classList.contains('hidden')) {
                const input = enPanel.querySelector(`.cell-input[data-ri="${ri}"][data-ci="${ci}"]`);
                if (input && document.activeElement !== input) input.value = value;
            }
        }
    }
}

function renderPreviewTable(state) {
    const headRow = state.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
    const bodyRows = state.rows.map(row => `
        <tr>${state.headers.map((_, ci) => `<td>${escapeHtml(row[ci] || '')}</td>`).join('')}</tr>`).join('');
    return `<table class="custom-data-table"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function renderTableToolPanel(key) {
    const panel = formFields.querySelector(`.table-tool-panel[data-panel-key="${key}"]`);
    const state = descTableStates[key];

    const headerCells = state.headers.map((h, ci) => `
        <th class="border px-1 py-1 bg-white">
            <div class="flex items-center gap-1">
                <div class="flex flex-col">
                    <button type="button" class="col-left text-gray-400 hover:text-blue-600 text-xs leading-none" data-ci="${ci}" title="左移" ${ci === 0 ? 'disabled' : ''}>◀</button>
                    <button type="button" class="col-right text-gray-400 hover:text-blue-600 text-xs leading-none" data-ci="${ci}" title="右移" ${ci === state.headers.length - 1 ? 'disabled' : ''}>▶</button>
                </div>
                <input type="text" class="field-input text-xs th-input" style="min-width:5rem" data-ci="${ci}" value="${escapeHtml(h)}">
                <button type="button" class="col-del text-red-400 hover:text-red-600 text-xs shrink-0" data-ci="${ci}" title="刪除欄">×</button>
            </div>
        </th>`).join('');

    const bodyRows = state.rows.map((row, ri) => `
        <tr>
            <td class="border px-1 py-1 text-center bg-white">
                <div class="flex flex-col">
                    <button type="button" class="row-up text-gray-400 hover:text-blue-600 text-xs leading-none" data-ri="${ri}" title="上移" ${ri === 0 ? 'disabled' : ''}>▲</button>
                    <button type="button" class="row-down text-gray-400 hover:text-blue-600 text-xs leading-none" data-ri="${ri}" title="下移" ${ri === state.rows.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </td>
            ${state.headers.map((_, ci) => `
                <td class="border px-1 py-1 bg-white">
                    <input type="text" class="field-input text-xs cell-input" style="min-width:5rem" data-ri="${ri}" data-ci="${ci}" value="${escapeHtml(row[ci] || '')}">
                </td>`).join('')}
            <td class="border px-1 py-1 text-center bg-white">
                <button type="button" class="row-del text-red-400 hover:text-red-600 text-xs" data-ri="${ri}" title="刪除列">刪除</button>
            </td>
        </tr>`).join('');

    panel.innerHTML = `
        <div class="overflow-x-auto">
            <table class="text-xs border-collapse">
                <thead><tr><th class="border px-1 py-1 bg-white"></th>${headerCells}<th class="border px-1 py-1 bg-white"></th></tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
        <div class="flex gap-2 mt-2">
            <button type="button" class="add-row px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">+ 新增列</button>
            <button type="button" class="add-col px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">+ 新增欄</button>
        </div>
        <p class="text-xs text-gray-500 font-medium mt-3 mb-1">即時預覽</p>
        <div class="preview-box overflow-x-auto">${renderPreviewTable(state)}</div>
        ${key === 'desc_zh' ? '<p class="text-xs text-gray-400 mt-2">新增／刪除／移動列欄時，英文說明的表格會自動同步結構與內容。</p>' : ''}`;

    panel.querySelectorAll('.th-input').forEach(input => {
        input.addEventListener('input', () => {
            state.headers[Number(input.dataset.ci)] = input.value;
            syncTextarea(key);
            panel.querySelector('.preview-box').innerHTML = renderPreviewTable(state);
        });
    });
    panel.querySelectorAll('.cell-input').forEach(input => {
        input.addEventListener('input', () => {
            setCellValue(key, Number(input.dataset.ri), Number(input.dataset.ci), input.value);
        });
    });
    panel.querySelectorAll('.row-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = Number(btn.dataset.ri);
            runOp(key, s => {
                s.rows.splice(ri, 1);
                if (!s.rows.length) s.rows.push(s.headers.map(() => ''));
            });
        });
    });
    panel.querySelectorAll('.row-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = Number(btn.dataset.ri);
            if (ri === 0) return;
            runOp(key, s => swap(s.rows, ri, ri - 1));
        });
    });
    panel.querySelectorAll('.row-down').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = Number(btn.dataset.ri);
            runOp(key, s => { if (ri < s.rows.length - 1) swap(s.rows, ri, ri + 1); });
        });
    });
    panel.querySelectorAll('.col-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.headers.length <= 1) return;
            const ci = Number(btn.dataset.ci);
            runOp(key, s => {
                if (s.headers.length <= 1) return;
                s.headers.splice(ci, 1);
                s.rows.forEach(r => r.splice(ci, 1));
            });
        });
    });
    panel.querySelectorAll('.col-left').forEach(btn => {
        btn.addEventListener('click', () => {
            const ci = Number(btn.dataset.ci);
            if (ci === 0) return;
            runOp(key, s => {
                swap(s.headers, ci, ci - 1);
                s.rows.forEach(r => swap(r, ci, ci - 1));
            });
        });
    });
    panel.querySelectorAll('.col-right').forEach(btn => {
        btn.addEventListener('click', () => {
            const ci = Number(btn.dataset.ci);
            runOp(key, s => {
                if (ci >= s.headers.length - 1) return;
                swap(s.headers, ci, ci + 1);
                s.rows.forEach(r => swap(r, ci, ci + 1));
            });
        });
    });
    panel.querySelector('.add-row').addEventListener('click', () => {
        runOp(key, s => s.rows.push(s.headers.map(() => '')));
    });
    panel.querySelector('.add-col').addEventListener('click', () => {
        runOp(key, s => {
            s.headers.push('欄位' + (s.headers.length + 1));
            s.rows.forEach(r => r.push(''));
        });
    });

    syncTextarea(key);
}

// 每次打開編輯視窗（不管是編輯既有商品還是新增商品）都從最上面開始顯示，不要保留上一個
// 商品關掉當下捲到的位置——不然編輯完一個商品在很下面的地方按儲存/取消，馬上接著編輯
// 下一個商品時畫面會莫名其妙從中間開始，看不到最上面的分類/名稱欄位。
function resetModalScroll() {
    modal.scrollTop = 0;
    const panel = document.getElementById('edit-modal-panel');
    if (panel) panel.scrollTop = 0;
    switchEditTab('basic'); // 每次開編輯視窗都從「基本資料」分頁開始，不要停在上一個商品關掉時的分頁
}

// 編輯視窗拆成分頁（基本資料／規格選項／訂單單位／商品說明），分頁本身只是切換
// CSS 顯示/隱藏，底下的欄位、規格軸、單位清單一直都在 DOM 裡，切分頁不會清空已經改好的內容。
function switchEditTab(target) {
    document.querySelectorAll('#edit-tabbar .modal-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tabTarget === target);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
    });
}

document.querySelectorAll('#edit-tabbar .modal-tab').forEach(btn => {
    btn.addEventListener('click', () => switchEditTab(btn.dataset.tabTarget));
});

// 上架開關現在是彈窗標題列的固定元素，不在 <form id="product-form"> 裡面，
// 不會被下面 productForm 的 input/change 事件代理抓到，另外接一個監聽器標記未儲存修改。
document.getElementById('form-is-active').addEventListener('change', () => { modalDirty = true; });

function openEditModal(id) {
    const product = allProducts.find(p => String(p.id) === String(id));
    editingId = id;
    const displayName = (product && ((product.order_display_name || '').trim() || product.name_zh)) || '';
    modalTitle.textContent = displayName ? `${displayName} - 編輯商品` : '編輯商品';
    buildFormFields(product);
    loadVariantSection(product);
    loadUnitSection(product);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modalDirty = false;
    resetModalScroll();
}

document.getElementById('new-product-btn').addEventListener('click', () => {
    editingId = null;
    modalTitle.textContent = '新增商品';
    buildFormFields(null);
    loadVariantSection(null);
    loadUnitSection(null);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    resetModalScroll();
    modalDirty = false;
});

function closeModal() {
    if (modalDirty && !confirm('您有尚未儲存的修改，確定要離開嗎？')) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalDirty = false;
}
document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');

    const payload = {};
    formFields.querySelectorAll('[data-key]').forEach(el => {
        payload[el.dataset.key] = el.value.trim();
    });
    payload.is_active = document.getElementById('form-is-active').checked;

    let error;
    if (editingId) {
        // 在這裡按過儲存，代表資料已經確認/補齊過了，不管原本是不是「來自 POS 下單」的
        // 暫時商品，都清掉那個提醒標記，變成正式商品。
        payload.added_from_pos = false;
        ({ error } = await sb.from('pos_items').update(payload).eq('id', editingId));
    } else {
        ({ error } = await sb.from('pos_items').insert(payload));
    }

    if (error) {
        formError.textContent = '儲存失敗：' + error.message;
        formError.classList.remove('hidden');
        return;
    }

    try {
        await saveVariantChanges();
        await saveUnitChanges();
    } catch (variantError) {
        formError.textContent = '規格／單位儲存失敗：' + variantError.message;
        formError.classList.remove('hidden');
        return;
    }

    modalDirty = false;

    // 這個編輯視窗是從 POS 下單那頁的「編輯」連結開過來的話，存檔成功後直接導回去，
    // 不用使用者自己點導覽列切回 POS 下單——回去的時候商品資料本來就會重新讀最新的。
    if (editIdFromUrl && String(editingId) === String(editIdFromUrl)) {
        location.href = '/admin/pos.html';
        return;
    }

    closeModal();
    loadProducts();
});

/* --- POS 選項（pos_item_variants，彈性軸版），在編輯商品時於本地暫存，按主表單「儲存」才寫入 ---
   軸名稱完全自訂（不再限定規格/孔徑/顏色），一列只填一個軸＝定義那個軸的一個可點選項目，
   一列填兩個以上的軸＝一筆「完整組合」（可以只是資訊、也可以帶照片）。
   所有新增/刪除/上傳都只改本地的 localVariantRows，實際寫入 Supabase 由 saveVariantChanges() 負責。 */
let currentVariantErp = null;
let variantTempCounter = 0;
let localVariantRows = [];
let deletedVariantIds = [];
let knownAxisNames = []; // 全部商品出現過的軸名稱，純粹給「新增選項」自動完成用
let lastComboDisableIndex = null; // 上一次點的「停用」勾選框在完整組合列表裡的位置，shift+點用來算範圍
// 完整組合的顯示順序（未停用排最上面）只在「剛從資料庫載入」的當下決定一次，存成快照；
// 編輯過程中不管勾了幾次停用，排列順序都不會變，不然勾一格馬上跳位置，shift range 選取
// 會選到不對的東西。快照只在下一次載入商品（也就是儲存後重新打開）時才會更新。
let comboSortSnapshot = null; // Map: comboKeyOf(axis_values) -> 載入當下的 is_disabled

// 把「整個值」前後包住的括號拿掉（例如貼上「（紅）」想要的其實是「紅」）。
// 只有第一個字跟最後一個字剛好是配對的括號才拆，不然像「1" x 1" (25mm)」
// 這種括號只是值本身內容的一部分，最後的「)」會被誤砍掉。
function stripWrappingBrackets(v) {
    const pairs = { '（': '）', '(': ')', '「': '」', '『': '』' };
    const first = v[0];
    const last = v[v.length - 1];
    if (v.length >= 2 && pairs[first] === last) {
        const inner = v.slice(1, -1);
        const opens = (inner.match(/[（(「『]/g) || []).length;
        const closes = (inner.match(/[）)」』]/g) || []).length;
        if (opens === closes) return inner.trim();
    }
    return v;
}

function splitBulkValues(text) {
    return text.split(/[/、,，]/)
        .map(v => stripWrappingBrackets(v.trim()).trim())
        .filter(Boolean);
}

function rowAxisEntries(row) {
    return Object.entries(row.axis_values || {}).filter(([, v]) => v);
}

// 只填一個軸的列＝定義那個軸的一個選項；填兩個以上的列＝一筆完整組合
function categorizeVariantRows(rows) {
    const axisOptions = {};
    const combos = [];
    rows.forEach(r => {
        const entries = rowAxisEntries(r);
        if (entries.length === 1) {
            const [name] = entries[0];
            if (!axisOptions[name]) axisOptions[name] = [];
            axisOptions[name].push(r);
        } else if (entries.length >= 2) {
            combos.push(r);
        }
    });
    // 每個軸自己的選項照 sort_order 排序，才能正確顯示上/下移動、插入前/後的結果。
    Object.keys(axisOptions).forEach(name => {
        axisOptions[name].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    return { axisOptions, combos };
}

// sort_order 同時用來表示「軸跟軸之間的順序」跟「同一個軸裡選項的順序」：
// 軸序 * AXIS_BAND + 選項序 * 10。軸／選項的順序一有變動，就用這個把全部重新編號成
// 乾淨的值，不用管之前留下的舊資料夠不夠塞、有沒有重複。
const AXIS_BAND = 100000;

function renumberVariantSortOrders(axisNamesInOrder, axisOptionsMap) {
    axisNamesInOrder.forEach((name, axisIdx) => {
        (axisOptionsMap[name] || []).forEach((r, optIdx) => {
            r.sort_order = axisIdx * AXIS_BAND + (optIdx + 1) * 10;
        });
    });
}

// 目前的軸順序：照各軸選項裡最小的 sort_order 排（之前搬移過的話會照那個順序）。
// sort_order 平手的話（例如都還沒被排過序、大家還是預設值 0）不能用軸名稱排序當備援——
// 這樣跟 POS 下單那邊的順序會對不起來。POS 下單是直接照資料庫查詢結果（sort_order 排序、
// id 當第二排序依據）第一次遇到某個軸名稱的順序，所以這裡也改成比對「各軸 sort_order
// 最小的那一列」的 id（axisOptions[name] 已經照 sort_order／id 排過序，[0] 就是那一列），
// 兩邊排序邏輯才會一致。
function currentAxisNamesInOrder(axisOptions) {
    return Object.keys(axisOptions).sort((a, b) => {
        const firstA = axisOptions[a][0];
        const firstB = axisOptions[b][0];
        const orderA = firstA ? (firstA.sort_order || 0) : 0;
        const orderB = firstB ? (firstB.sort_order || 0) : 0;
        if (orderA !== orderB) return orderA - orderB;
        const idA = firstA ? String(firstA.id || '') : '';
        const idB = firstB ? String(firstB.id || '') : '';
        return idA < idB ? -1 : idA > idB ? 1 : 0;
    });
}

// 拖曳整個軸的把手調整順序：newAxisNameOrder 是拖曳後、畫面上由上到下的軸名稱順序。
function reorderAxisGroups(newAxisNameOrder) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const validNames = newAxisNameOrder.filter(n => axisOptions[n]);
    if (validNames.length !== Object.keys(axisOptions).length) return; // 防呆，理論上不會發生

    renumberVariantSortOrders(validNames, axisOptions);
    modalDirty = true;
    renderVariantSection();
}

// 幫整個軸改名：不只是選項本身（1 個 key 的列），連組合（2 個以上 key 的列）裡
// 有用到這個軸名稱當 key 的也要一起改，不然組合會變成指向一個已經不存在的軸。
function renameAxis(oldName) {
    const newName = prompt(`把「${oldName}」改名成？`, oldName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

    const { axisOptions } = categorizeVariantRows(localVariantRows);
    if (axisOptions[trimmed]) {
        alert(`已經有「${trimmed}」這個軸了，換一個名字，或是先刪掉其中一個再改名。`);
        return;
    }

    localVariantRows.forEach(row => {
        if (!(oldName in row.axis_values)) return;
        const value = row.axis_values[oldName];
        const newValues = { ...row.axis_values };
        delete newValues[oldName];
        newValues[trimmed] = value;

        // axis_values 是 upsert 的 onConflict 依據，直接改內容會留下一筆指向舊
        // axis_values 的孤兒列，所以有真的存進資料庫過的列要刪掉舊的、當新的重存。
        if (row.id) deletedVariantIds.push(row.id);
        row.id = null;
        row.axis_values = newValues;
    });

    if (!knownAxisNames.includes(trimmed)) {
        knownAxisNames.push(trimmed);
        knownAxisNames.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        const datalist = document.getElementById('known-axis-names');
        if (datalist) datalist.innerHTML = knownAxisNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }

    modalDirty = true;
    renderVariantSection();
}

// 改一個選項的值：不只是這個選項本身（1 個 key 的列），連組合（2 個以上 key 的列）裡
// 有用到「這個軸＝這個值」的也要一起改，不然組合會變成指向一個已經不存在的值。
function editAxisOptionValue(name, tempId) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const row = rows.find(r => r.tempId === tempId);
    if (!row) return;

    const currentValue = row.axis_values[name];
    const raw = prompt(`把「${currentValue}」改成？`, currentValue);
    if (raw === null) return;
    const trimmed = stripWrappingBrackets(raw.trim()).trim();
    if (!trimmed || trimmed === currentValue) return;

    if (rows.some(r => r.tempId !== tempId && r.axis_values[name] === trimmed)) {
        alert(`「${name}」已經有「${trimmed}」這個選項了，換一個值，或是先刪掉其中一個再改。`);
        return;
    }

    localVariantRows.forEach(r => {
        if (!(name in r.axis_values) || r.axis_values[name] !== currentValue) return;
        const newValues = { ...r.axis_values, [name]: trimmed };

        // axis_values 是 upsert 的 onConflict 依據，直接改內容會留下一筆指向舊
        // axis_values 的孤兒列，所以有真的存進資料庫過的列要刪掉舊的、當新的重存。
        if (r.id) deletedVariantIds.push(r.id);
        r.id = null;
        r.axis_values = newValues;
    });

    modalDirty = true;
    renderVariantSection();
}

// 拖曳同一個軸裡選項的把手調整順序：tempIdOrder 是拖曳後、畫面上由上到下的 tempId 順序
// （字串，因為是直接從 DOM 的 data-temp-id 讀出來的）。
function reorderAxisOption(name, tempIdOrder) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const byTempId = new Map(rows.map(r => [String(r.tempId), r]));
    const newRows = tempIdOrder.map(id => byTempId.get(id)).filter(Boolean);
    if (newRows.length !== rows.length) return; // 防呆，理論上不會發生

    axisOptions[name] = newRows;
    const axisNames = currentAxisNamesInOrder(axisOptions);
    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

// 在某個選項的前面或後面插入新值（可以用 / 、 , ， 一次插入多個）。
function insertAxisOptionAt(name, tempId, position) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const idx = rows.findIndex(r => r.tempId === tempId);
    if (idx === -1) return;

    const raw = prompt(`要在「${rows[idx].axis_values[name]}」${position === 'before' ? '前面' : '後面'}插入什麼值？（可以用 / 、 , ， 一次加多個）`);
    if (!raw) return;
    const values = splitBulkValues(raw);
    if (!values.length) return;

    const existingSet = new Set(rows.map(r => r.axis_values[name]));
    const newValues = values.filter(v => !existingSet.has(v));
    if (!newValues.length) return;

    // 先照插入之前的資料把軸順序記下來，插入新選項只會動到這個軸內部的順序。
    const axisNames = currentAxisNamesInOrder(axisOptions);

    const showInName = rows.every(r => r.show_in_name);
    const newRows = newValues.map(v => ({
        tempId: ++variantTempCounter,
        id: null,
        erp_code: currentVariantErp,
        axis_values: { [name]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
        show_in_name: showInName,
    }));

    const insertAt = position === 'before' ? idx : idx + 1;
    axisOptions[name] = [...rows.slice(0, insertAt), ...newRows, ...rows.slice(insertAt)];
    localVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

async function loadKnownAxisNames() {
    // 這張表資料量大時很容易超過 Supabase 一次查詢 1000 筆的上限，分頁抓齊，
    // 不然「快速加入」自動完成清單會漏掉只出現在後面幾頁的軸名稱。
    // 沒有指定排序的話，資料庫每次查詢回傳的順序不保證一樣，分頁時可能漏掉某幾頁——
    // 加上 id 排序讓順序固定下來。
    const { data, error } = await fetchAllRows(() => sb.from('pos_item_variants').select('axis_values').order('id', { ascending: true }));
    if (error) { console.error(error); return; }
    const names = new Set();
    (data || []).forEach(r => Object.keys(r.axis_values || {}).forEach(n => names.add(n)));
    knownAxisNames = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const datalist = document.getElementById('known-axis-names');
    if (datalist) datalist.innerHTML = knownAxisNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

async function loadVariantSection(product) {
    const section = document.getElementById('variant-section');
    deletedVariantIds = [];
    lastComboDisableIndex = null;

    if (!product || !product.erp_code) {
        currentVariantErp = null;
        localVariantRows = [];
        section.classList.add('opacity-50', 'pointer-events-none');
        document.getElementById('axis-groups').innerHTML = '';
        document.getElementById('variant-combo-list').innerHTML =
            '<p class="text-xs text-gray-400">請先儲存商品，才能新增選項。</p>';
        return;
    }

    currentVariantErp = product.erp_code;
    section.classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('variant-combo-list').innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    // 加上 id 當第二個排序依據：sort_order 平手時（例如都還沒被排序過、預設值都是 0），
    // 沒有這個的話資料庫不保證每次查詢回傳的順序一樣，會跟 POS 下單那邊（有加 id 排序）
    // 顯示的順序對不起來。
    const { data, error } = await sb
        .from('pos_item_variants')
        .select('*')
        .eq('erp_code', product.erp_code)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });

    if (error) {
        document.getElementById('variant-combo-list').innerHTML =
            `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    localVariantRows = (data || []).map(r => ({ ...r, axis_values: r.axis_values || {}, tempId: ++variantTempCounter }));

    comboSortSnapshot = new Map();
    localVariantRows.forEach(r => {
        if (Object.keys(r.axis_values).length >= 2) {
            comboSortSnapshot.set(comboKeyOf(r.axis_values), !!r.is_disabled);
        }
    });

    renderVariantSection();
}

function unitRatioSummary(unitRatios) {
    const entries = Object.entries(unitRatios || {});
    return entries.length ? `比例：${entries.map(([n, v]) => `${n}=${v}`).join('、')}` : '單位比例';
}

function axisChipHtml(r, name) {
    const rawValue = r.axis_values[name];
    const splitCount = splitBulkValues(rawValue).length;
    return `
        <div class="flex items-center gap-2 border rounded-lg p-2" data-temp-id="${r.tempId}" data-axis-name="${escapeHtml(name)}">
            <span class="drag-handle text-lg leading-none px-1" title="按住拖曳排序">⠿</span>
            <img src="${escapeHtml(r.image_url || '')}" alt="" class="product-thumb axis-option-thumb" style="width:32px;height:32px;">
            <button type="button" class="axis-value-edit-btn flex-1 text-sm text-left hover:underline hover:text-blue-600" title="點一下改這個選項的值">${escapeHtml(rawValue)} ✎</button>
            <span class="axis-upload-status text-xs text-gray-400"></span>
            <button type="button" class="axis-insert-before-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="在這個之前插入新選項">＋前</button>
            <button type="button" class="axis-insert-after-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="在這個之後插入新選項">＋後</button>
            <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                上傳圖片
                <input type="file" accept="image/*" class="hidden axis-upload-input">
            </label>
            ${r.image_url ? `<button type="button" class="axis-image-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
            ${splitCount > 1 ? `<button type="button" class="axis-chip-split px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="分割成 ${splitCount} 個選項">⇥ 分割</button>` : ''}
            <button type="button" class="axis-chip-del px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap" title="刪除選項">刪除</button>
        </div>`;
}

// 單位比例表單：每個單位一行，基準單位（比例最小的那個）直接顯示「1個＝1個」不能改，
// 其他單位是一個輸入框，只要打數字——輸入框留空的話輸入框上會用灰字提示商品預設的比例是多少，
// 存的時候也會直接當作「用預設」（不寫進覆蓋）。
function unitRatioFormRowsHtml(currentRatios) {
    const base = unitRatioBase();
    if (!base) return '';
    return localUnitRows.map(u => {
        if (u === base) {
            return `<div class="text-xs text-gray-500 py-1">1${escapeHtml(base.name)}＝1${escapeHtml(base.name)}</div>`;
        }
        const override = currentRatios && currentRatios[u.name];
        const defaultRatio = formatRatioNumber(Number(u.ratio) / Number(base.ratio));
        return `
            <div class="flex items-center gap-1 text-xs py-0.5">
                <span class="whitespace-nowrap">1${escapeHtml(u.name)}＝</span>
                <input type="number" class="combo-ratio-input field-input" style="width:5rem" min="0.0001" step="any"
                    data-unit="${escapeHtml(u.name)}" value="${override != null ? override : ''}" placeholder="${defaultRatio}（預設）">
                <span class="whitespace-nowrap">${escapeHtml(base.name)}</span>
            </div>`;
    }).join('');
}

// 讀出單位比例表單目前填的值：{單位名稱: 數字}，留空的單位不會出現在結果裡（代表用預設）；
// 有填但不是正數的話回傳 null，呼叫端看到 null 就不要繼續套用。
function readUnitRatioForm(panelEl) {
    const parsed = {};
    let ok = true;
    panelEl.querySelectorAll('.combo-ratio-input').forEach(input => {
        input.classList.remove('border-red-400');
        const raw = input.value.trim();
        if (!raw) return;
        const num = Number(raw);
        if (!num || num <= 0) { ok = false; input.classList.add('border-red-400'); return; }
        parsed[input.dataset.unit] = num;
    });
    return ok ? parsed : null;
}

function unitRatioPanelActionsHtml(saveLabel) {
    return `
        <div class="flex gap-2 pt-1">
            <button type="button" class="combo-ratio-save px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">${escapeHtml(saveLabel)}</button>
            <button type="button" class="combo-ratio-cancel px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">取消</button>
        </div>`;
}

// 幫某一筆完整組合（例如 型號：PF-16／規格：½"／長度：50米/丸）打開單位比例表單，
// 覆蓋商品層級的預設值；輸入框留空的話這筆組合就會退回用商品預設的比例。
// 這筆組合原本沒有底層資料列的話（純展示用的格子），存了才會真的新增一筆。
function openComboRatioPanel(cell, rowEl, container) {
    const existingPanel = rowEl.nextElementSibling;
    if (existingPanel && existingPanel.classList.contains('combo-ratio-panel')) {
        existingPanel.remove();
        return;
    }
    container.querySelectorAll('.combo-ratio-panel').forEach(p => p.remove()); // 同時間只開一個

    if (localUnitRows.length < 2) {
        alert('這個商品要有 2 個以上的單位，才需要另外設定比例覆蓋——請先到下面「訂單單位」新增第二個單位。');
        return;
    }

    const currentRatios = (cell.existing && cell.existing.unit_ratios) || {};
    const panel = document.createElement('div');
    panel.className = 'combo-ratio-panel border rounded-lg p-2 mt-1 mb-1 bg-gray-50';
    panel.innerHTML = unitRatioFormRowsHtml(currentRatios) + unitRatioPanelActionsHtml('儲存');
    rowEl.insertAdjacentElement('afterend', panel);

    panel.querySelector('.combo-ratio-cancel').addEventListener('click', () => panel.remove());
    panel.querySelector('.combo-ratio-save').addEventListener('click', () => {
        const parsed = readUnitRatioForm(panel);
        if (parsed === null) return; // 有欄位填了非正數，錯誤提示已經用紅框標出來了
        if (!Object.keys(parsed).length && !cell.existing) { panel.remove(); return; }

        let row = cell.existing;
        if (!row) {
            row = {
                tempId: ++variantTempCounter,
                id: null,
                erp_code: currentVariantErp,
                axis_values: cell.values,
                image_url: null,
                sort_order: 0,
                is_disabled: false,
                unit_ratios: {},
            };
            localVariantRows.push(row);
            cell.existing = row;
        }
        row.unit_ratios = parsed;

        modalDirty = true;
        renderVariantSection();
    });
}

function wireAxisChips(scopeEl) {
    scopeEl.querySelectorAll('.axis-value-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            editAxisOptionValue(rowEl.dataset.axisName, Number(rowEl.dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-chip-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('確定要刪除這個選項嗎？')) return;
            removeVariantRow(Number(btn.closest('[data-temp-id]').dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-chip-split').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            splitVariantRow(rowEl.dataset.axisName, Number(rowEl.dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-insert-before-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            insertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'before');
        });
    });
    scopeEl.querySelectorAll('.axis-insert-after-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            insertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'after');
        });
    });

    scopeEl.querySelectorAll('.axis-image-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tempId = Number(btn.closest('[data-temp-id]').dataset.tempId);
            if (!confirm('確定要移除這個選項的圖片嗎？')) return;
            const row = localVariantRows.find(r => r.tempId === tempId);
            if (!row) return;
            row.image_url = null;
            modalDirty = true;
            renderVariantSection();
        });
    });

    scopeEl.querySelectorAll('.axis-upload-input').forEach(input => {
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;

            const rowEl = input.closest('[data-temp-id]');
            const tempId = Number(rowEl.dataset.tempId);
            const row = localVariantRows.find(r => r.tempId === tempId);
            if (!row) return;

            const thumbImg = rowEl.querySelector('.axis-option-thumb');
            const statusEl = rowEl.querySelector('.axis-upload-status');
            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                row.image_url = url;
                modalDirty = true;
                thumbImg.src = url;
                statusEl.textContent = '';
                renderVariantSection();
            } catch (e) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e.message);
            } finally {
                input.value = '';
            }
        });
    });
}

function renderVariantSection() {
    const { axisOptions, combos } = categorizeVariantRows(localVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);

    const groupsEl = document.getElementById('axis-groups');
    if (!axisNames.length) {
        groupsEl.innerHTML = '<p class="text-xs text-gray-400">這個商品還沒有任何選項，在下面新增第一個軸吧（例如「規格」）。</p>';
    } else {
        groupsEl.innerHTML = axisNames.map((name) => {
            const showInName = axisOptions[name].every(r => r.show_in_name);
            return `
            <div class="axis-group-card" data-axis-name="${escapeHtml(name)}">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1">
                        <span class="drag-handle axis-group-drag-handle text-lg leading-none px-1" title="按住拖曳排序整個軸">⠿</span>
                        <button type="button" class="axis-rename-btn field-label mb-0 hover:underline hover:text-blue-600" data-axis-name="${escapeHtml(name)}" title="點一下改軸名稱">${escapeHtml(name)} ✎</button>
                        <button type="button" class="axis-show-in-name-btn text-xs px-2 py-0.5 rounded-full border ${showInName ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-500'}" data-axis-name="${escapeHtml(name)}" title="開啟後，POS 下單購物車的商品標題會加上這個軸選到的值">${showInName ? '✓ 顯示在下單名稱' : '顯示在下單名稱'}</button>
                    </div>
                    <button type="button" class="axis-delete-all-btn text-xs text-red-600 hover:underline" data-axis-name="${escapeHtml(name)}">刪除整個軸</button>
                </div>
                <div class="space-y-1 axis-chip-list" data-axis-name="${escapeHtml(name)}">${axisOptions[name].map(r => axisChipHtml(r, name)).join('')}</div>
            </div>`;
        }).join('');
    }
    wireAxisChips(groupsEl);

    enableDragReorder(groupsEl, {
        itemSelector: '.axis-group-card',
        handleSelector: '.axis-group-drag-handle',
        dragIdAttr: 'data-axis-name',
        onReorder: (order) => reorderAxisGroups(order),
    });
    groupsEl.querySelectorAll('.axis-chip-list').forEach(listEl => {
        enableDragReorder(listEl, {
            itemSelector: '[data-temp-id]',
            handleSelector: '.drag-handle',
            dragIdAttr: 'data-temp-id',
            onReorder: (order) => reorderAxisOption(listEl.dataset.axisName, order),
        });
    });

    groupsEl.querySelectorAll('.axis-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => renameAxis(btn.dataset.axisName));
    });
    groupsEl.querySelectorAll('.axis-show-in-name-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.axisName;
            const rows = axisOptions[name] || [];
            const turnOn = !rows.every(r => r.show_in_name);
            rows.forEach(r => { r.show_in_name = turnOn; });
            modalDirty = true;
            renderVariantSection();
        });
    });

    groupsEl.querySelectorAll('.axis-delete-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.axisName;
            const rows = (axisOptions[name] || []);
            if (!confirm(`確定要刪除「${name}」這整個軸嗎？底下 ${rows.length} 個選項都會一起刪掉。`)) return;
            rows.forEach(r => {
                if (r.id) deletedVariantIds.push(r.id);
            });
            const tempIds = new Set(rows.map(r => r.tempId));
            localVariantRows = localVariantRows.filter(r => !tempIds.has(r.tempId));
            modalDirty = true;
            renderVariantSection();
        });
    });

    renderComboList(combos, axisOptions, axisNames);
}

function removeVariantRow(tempId) {
    const row = localVariantRows.find(r => r.tempId === tempId);
    if (!row) return;
    if (row.id) deletedVariantIds.push(row.id);
    localVariantRows = localVariantRows.filter(r => r.tempId !== tempId);
    modalDirty = true;
    renderVariantSection();
}

// 把舊資料裡「一個選項其實塞了好幾個值」（例如 4"、5"、6" 存成一筆）拆成好幾個獨立選項。
function splitVariantRow(axisName, tempId) {
    const row = localVariantRows.find(r => r.tempId === tempId);
    if (!row) return;
    const rawValue = row.axis_values[axisName];
    const values = splitBulkValues(rawValue);
    if (values.length < 2) return;
    if (!confirm(`要把「${rawValue}」分割成 ${values.length} 個選項嗎？`)) return;

    if (row.id) deletedVariantIds.push(row.id);
    localVariantRows = localVariantRows.filter(r => r.tempId !== tempId);

    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName); // 分割的是這個軸唯一的一列，分割前一瞬間軸會暫時消失

    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newRows = [];
    values.filter(v => !existing.has(v)).forEach(v => {
        newRows.push({
            tempId: ++variantTempCounter,
            id: null,
            erp_code: currentVariantErp,
            axis_values: { [axisName]: v },
            image_url: null,
            sort_order: 0,
            show_in_name: !!row.show_in_name,
        });
    });
    axisOptions[axisName] = [...existingRows, ...newRows];
    localVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

// 用排序過的「軸名=值」字串當 key，比對兩組軸值是不是完全一樣（跟 jsonb 的結構比對邏輯一致）。
function comboKeyOf(values) {
    return Object.keys(values).sort().map(k => `${k}${values[k]}`).join('');
}

// 軸數不多、選項也不多時（例如規格3種×顏色2種＝6種），自動列出「每個軸都對應到」的所有組合，
// 不用一筆一筆手動建立；軸太多、選項太多時（組合數量爆炸，例如型號/W/H/L/A排水孔位/備註 6 個軸）
// 就不自動列，只顯示已經存的組合，改用下面「手動新增一筆完整組合」的下拉選單自己建立。
// 上限訂在 1000：像 3 個軸、每個軸 8 個選項（512 種）這種常見情況還是要能自動列出來，
// 同時避免軸數/選項數異常多的商品（例如 6 個軸各自 10 幾種）一次跑出破萬筆卡住畫面。
const COMBO_GRID_MAX_AXES = 4;
const COMBO_GRID_MAX_TOTAL = 1000;

function renderComboList(combos, axisOptions, axisNames) {
    const container = document.getElementById('variant-combo-list');

    const comboByKey = {};
    combos.forEach(c => { comboByKey[comboKeyOf(c.axis_values)] = c; });

    const cells = []; // { values, existing: 該組合現有的資料列或 null, label }
    const matchedKeys = new Set();
    let anyDisabledInGrid = false;

    const totalGridCombos = axisNames.length >= 2
        ? axisNames.reduce((acc, name) => acc * axisOptions[name].length, 1)
        : 0;

    if (axisNames.length >= 2 && axisNames.length <= COMBO_GRID_MAX_AXES && totalGridCombos <= COMBO_GRID_MAX_TOTAL) {
        // 照軸的順序排列組合，先排到的軸變動最慢、最後排到的軸變動最快
        // （例如 規格/顏色/尺寸，會是 樓板接頭+桔+1½"、樓板接頭+桔+2"…按這個順序列出）。
        let gridCombos = [{}];
        axisNames.forEach(name => {
            const next = [];
            gridCombos.forEach(c => {
                axisOptions[name].forEach(r => next.push({ ...c, [name]: r.axis_values[name] }));
            });
            gridCombos = next;
        });

        // 只要這個表格裡已經有人勾過至少一格「停用」，就代表這個商品是真的在用「有建立才算存在」
        // 這一套邏輯（不是單純展示用的表格）——這時「可以選」的格子如果一直沒有實際資料列，
        // POS 下單那邊會找不到任何「確定有效」的組合可以參考，導致完全沒有限制效果。
        // 所以只要偵測到已經有停用過的格子，就把其餘還沒有資料的格子也一起補成「可以選」的實際資料列，
        // 不用等使用者一格一格點開才存進去。（完全沒人勾過停用的表格維持原樣，不會平白多出上百筆資料。）
        anyDisabledInGrid = gridCombos.some(values => {
            const c = comboByKey[comboKeyOf(values)];
            return c && c.is_disabled;
        });

        gridCombos.forEach(values => {
            const key = comboKeyOf(values);
            let existing = comboByKey[key] || null;
            if (!existing && anyDisabledInGrid) {
                existing = {
                    tempId: ++variantTempCounter,
                    id: null,
                    erp_code: currentVariantErp,
                    axis_values: values,
                    image_url: null,
                    sort_order: 0,
                    is_disabled: false,
                };
                localVariantRows.push(existing);
                comboByKey[key] = existing;
            }
            if (existing) matchedKeys.add(key);
            cells.push({ values, existing, isGridCell: true, label: axisNames.map(n => values[n]).join('　') });
        });
    }

    // 已存的組合裡，軸的組成跟上面自動列出的表格不完全一樣的（例如只用到部分軸、或軸數太多沒自動列），
    // 另外接在後面，確保不會因為自動列表的規則而讓既有資料憑空消失不見。
    combos.filter(c => !matchedKeys.has(comboKeyOf(c.axis_values))).forEach(r => {
        cells.push({ values: r.axis_values, existing: r, isGridCell: false, label: rowAxisEntries(r).map(([k, v]) => `${k}：${v}`).join('　') });
    });

    // 表格模式下（anyDisabledInGrid），只要格子還在自動列出的組合表格範圍內，
    // 「刪掉」都留不住——下一次畫面重畫，backfill 會把它當成漏掉的可選格子重新補回來。
    // 所以這種情況下「刪除組合」實際上要做的是「標記停用」，才會真的讓這格在 POS 下單變不能選；
    // 表格外的組合（例如軸太多沒自動列出、手動貼上的）不受 backfill 影響，維持原本直接刪除的行為。
    function deleteCell(cell) {
        if (cell.isGridCell && anyDisabledInGrid && cell.existing && !cell.existing.is_disabled) {
            cell.existing.is_disabled = true;
            modalDirty = true;
            renderVariantSection();
            return;
        }
        removeVariantRow(cell.existing.tempId);
    }

    // 一次幫好幾格套用同一個「停用」勾選狀態（shift 範圍選取用）。整批一次處理完才
    // 重畫一次——不然一格一格處理、每格都重畫的話，前面幾格觸發的重畫會用「還沒處理完
    // 的當下狀態」重新跑一次自動補齊，後面幾格拿到的 cells 陣列就跟一開始算好的不一樣了。
    function applyComboDisable(targetCells, checked) {
        const toRemoveIds = [];
        targetCells.forEach(c => {
            if (c.existing) {
                c.existing.is_disabled = checked;
                const hasUnitRatios = Object.keys(c.existing.unit_ratios || {}).length > 0;
                if (!checked && !c.existing.image_url && !hasUnitRatios) {
                    toRemoveIds.push(c.existing.tempId);
                }
            } else if (checked) {
                const row = {
                    tempId: ++variantTempCounter,
                    id: null,
                    erp_code: currentVariantErp,
                    axis_values: c.values,
                    image_url: null,
                    is_disabled: true,
                    sort_order: 0,
                };
                localVariantRows.push(row);
                c.existing = row;
            }
        });
        if (toRemoveIds.length) {
            const idSet = new Set(toRemoveIds);
            localVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) deletedVariantIds.push(r.id); });
            localVariantRows = localVariantRows.filter(r => !idSet.has(r.tempId));
        }
        modalDirty = true;
        renderVariantSection();
    }

    // 未停用（可以選）的排在最上面，停用的沉到下面，方便掃過去看還剩哪些可以選；
    // 用穩定排序，同一組（都可以選或都停用）裡面還是維持原本 axisNames 那個規律的順序。
    // 排序依據是「載入商品當下」的快照，不是即時的勾選狀態——不然邊勾邊跳位置，
    // shift 範圍選取會選到不對的格子。要等儲存後重新打開這個商品，順序才會更新。
    if (comboSortSnapshot) {
        cells.sort((a, b) => {
            const disabledA = a.existing ? comboSortSnapshot.get(comboKeyOf(a.values)) : undefined;
            const disabledB = b.existing ? comboSortSnapshot.get(comboKeyOf(b.values)) : undefined;
            return Number(!!disabledA) - Number(!!disabledB);
        });
    }

    if (!cells.length) {
        // 「至少要兩個軸才會自動列出組合」這個原因已經收進標題旁邊的「!」提示裡，這裡不用重複顯示。
        container.innerHTML = '<p class="text-xs text-gray-400">目前沒有完整組合。</p>';
        return;
    }

    const hasAnyExisting = cells.some(c => c.existing);

    const bulkBarHtml = hasAnyExisting ? `
        <div id="combo-bulk-bar" class="flex items-center gap-2 mb-2 pb-2 border-b">
            <label class="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" id="combo-select-all">
                全選
            </label>
            <button type="button" id="combo-ratio-selected-btn" class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100" disabled>修改已選取的單位比例</button>
            <button type="button" id="combo-delete-selected-btn" class="px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50" disabled>刪除已選取的組合</button>
        </div>` : '';

    container.innerHTML = bulkBarHtml + cells.map((cell, i) => {
        const existing = cell.existing;
        const isDisabled = !!(existing && existing.is_disabled);
        return `
            <div class="flex items-center gap-3 border rounded-lg p-2 ${isDisabled ? 'bg-red-50 border-red-200' : ''}" data-cell-idx="${i}">
                ${existing ? '<input type="checkbox" class="combo-select-checkbox">' : '<span style="width:16px;display:inline-block;"></span>'}
                <img src="${escapeHtml(existing ? existing.image_url || '' : '')}" alt="" class="product-thumb combo-thumb" style="width:40px;height:40px;">
                <div class="flex-1 text-sm ${isDisabled ? 'line-through text-gray-400' : ''}">${escapeHtml(cell.label)}</div>
                <label class="flex items-center gap-1 text-xs text-red-600 whitespace-nowrap">
                    <input type="checkbox" class="combo-disable-checkbox" ${isDisabled ? 'checked' : ''}>
                    停用（不能選）
                </label>
                <span class="combo-upload-status text-xs text-gray-400"></span>
                ${isDisabled ? '' : `
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden combo-upload-input">
                </label>`}
                ${!isDisabled && existing && existing.image_url ? `<button type="button" class="combo-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
                ${isDisabled ? '' : `<button type="button" class="combo-unit-ratio-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="這筆組合專屬的單位比例，留空就用商品預設的比例">${escapeHtml(unitRatioSummary(existing ? existing.unit_ratios : null))}</button>`}
                ${existing ? `<button type="button" class="combo-delete-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">刪除組合</button>` : ''}
            </div>`;
    }).join('');

    if (hasAnyExisting) {
        const selectAllCb = document.getElementById('combo-select-all');
        const deleteSelectedBtn = document.getElementById('combo-delete-selected-btn');
        const ratioSelectedBtn = document.getElementById('combo-ratio-selected-btn');
        const itemCheckboxes = () => Array.from(container.querySelectorAll('.combo-select-checkbox'));

        function refreshBulkButtons() {
            const anyChecked = itemCheckboxes().some(cb => cb.checked);
            deleteSelectedBtn.disabled = !anyChecked;
            ratioSelectedBtn.disabled = !anyChecked;
        }

        function getSelectedCells() {
            const selectedCells = [];
            container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
                const cb = rowEl.querySelector('.combo-select-checkbox');
                if (cb && cb.checked) {
                    const cell = cells[Number(rowEl.dataset.cellIdx)];
                    if (cell.existing) selectedCells.push(cell);
                }
            });
            return selectedCells;
        }

        selectAllCb.addEventListener('change', () => {
            itemCheckboxes().forEach(cb => { cb.checked = selectAllCb.checked; });
            refreshBulkButtons();
        });

        itemCheckboxes().forEach(cb => {
            cb.addEventListener('change', () => {
                if (!cb.checked) selectAllCb.checked = false;
                else if (itemCheckboxes().every(c => c.checked)) selectAllCb.checked = true;
                refreshBulkButtons();
            });
        });

        ratioSelectedBtn.addEventListener('click', () => {
            const selectedCells = getSelectedCells();
            if (!selectedCells.length) return;

            const bulkBar = document.getElementById('combo-bulk-bar');
            const existingPanel = bulkBar.nextElementSibling;
            if (existingPanel && existingPanel.classList.contains('combo-ratio-panel')) {
                existingPanel.remove();
                return;
            }
            container.querySelectorAll('.combo-ratio-panel').forEach(p => p.remove());

            if (localUnitRows.length < 2) {
                alert('這個商品要有 2 個以上的單位，才需要另外設定比例覆蓋——請先到下面「訂單單位」新增第二個單位。');
                return;
            }

            const panel = document.createElement('div');
            panel.className = 'combo-ratio-panel border rounded-lg p-2 mb-2 bg-gray-50';
            panel.innerHTML = `
                <p class="text-xs text-gray-500 mb-1">幫選取的 ${selectedCells.length} 筆組合統一設定：</p>
                ${unitRatioFormRowsHtml({})}
                ${unitRatioPanelActionsHtml('套用到選取的組合')}`;
            bulkBar.insertAdjacentElement('afterend', panel);

            panel.querySelector('.combo-ratio-cancel').addEventListener('click', () => panel.remove());
            panel.querySelector('.combo-ratio-save').addEventListener('click', () => {
                const parsed = readUnitRatioForm(panel);
                if (parsed === null) return;

                selectedCells.forEach(cell => { cell.existing.unit_ratios = parsed; });
                modalDirty = true;
                renderVariantSection();
            });
        });

        deleteSelectedBtn.addEventListener('click', () => {
            const selectedCells = [];
            container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
                const cb = rowEl.querySelector('.combo-select-checkbox');
                if (cb && cb.checked) {
                    const cell = cells[Number(rowEl.dataset.cellIdx)];
                    if (cell.existing) selectedCells.push(cell);
                }
            });
            if (!selectedCells.length) return;

            // 如果選取的範圍已經涵蓋這個表格裡全部已停用的格子，代表整批刪完之後這個表格
            // 就不會再有任何停用標記了——這種情況可以放心整批真的刪掉，不用轉成標記停用
            // （不然像是「全選」整批刪除，會變成把本來停用的格子刪掉之後又被別的格子的
            // 停用標記補成可選，其他格子卻被轉成停用，結果整個表格反過來，不是使用者要的）。
            const selectedTempIdSet = new Set(selectedCells.map(c => c.existing.tempId));
            const survivingDisabledInGrid = cells.some(
                c => c.isGridCell && c.existing && c.existing.is_disabled && !selectedTempIdSet.has(c.existing.tempId)
            );

            const toDisableCount = survivingDisabledInGrid
                ? selectedCells.filter(c => c.isGridCell && anyDisabledInGrid && !c.existing.is_disabled).length
                : 0;
            let msg = `確定要處理選取的 ${selectedCells.length} 筆組合嗎？`;
            if (toDisableCount) {
                msg += `\n其中 ${toDisableCount} 筆是表格自動列出的可選組合，這種格子刪了會被自動補回來，所以會改成標記「停用（不能選）」。`;
            }
            if (!confirm(msg)) return;

            // 整批一次處理完才畫面重畫一次——一筆一筆刪、每筆都重畫的話，前面幾筆
            // 觸發的重畫會用「還沒處理完的當下狀態」重新跑一次自動補齊，結果後面
            // 幾筆的判斷基準就跟一開始算好的不一樣了。
            const removeTempIds = [];
            selectedCells.forEach(cell => {
                if (survivingDisabledInGrid && cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled) {
                    cell.existing.is_disabled = true;
                } else {
                    removeTempIds.push(cell.existing.tempId);
                }
            });
            if (removeTempIds.length) {
                const idSet = new Set(removeTempIds);
                localVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) deletedVariantIds.push(r.id); });
                localVariantRows = localVariantRows.filter(r => !idSet.has(r.tempId));
            }
            modalDirty = true;
            renderVariantSection();
        });
    }

    container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
        const cell = cells[Number(rowEl.dataset.cellIdx)];

        const delBtn = rowEl.querySelector('.combo-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                const willJustDisable = cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled;
                const msg = willJustDisable
                    ? '這筆是表格自動列出的可選組合，刪了會被自動補回來，所以會改成標記「停用（不能選）」，確定嗎？'
                    : '確定要刪除這筆組合嗎？';
                if (!confirm(msg)) return;
                deleteCell(cell);
            });
        }

        const removeBtn = rowEl.querySelector('.combo-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (!confirm('確定要移除這張組合照片嗎？')) return;
                cell.existing.image_url = null;
                modalDirty = true;
                renderVariantSection();
            });
        }

        const unitRatioBtn = rowEl.querySelector('.combo-unit-ratio-btn');
        if (unitRatioBtn) unitRatioBtn.addEventListener('click', () => openComboRatioPanel(cell, rowEl, container));

        // 「停用（不能選）」勾起來＝這個組合在 POS 下單會讓其中一個軸的選項變灰色點不到。
        // 按住 shift 點的話，從上一次點的那一格到這一格之間全部一起套用同一個勾選狀態，
        // 不用一格一格點——用 click（不是 change）才拿得到 shiftKey。
        rowEl.querySelector('.combo-disable-checkbox').addEventListener('click', (e) => {
            const checked = e.target.checked; // 瀏覽器已經先把這一格切好了
            const cellIdx = Number(rowEl.dataset.cellIdx);

            let targets = [cell];
            if (e.shiftKey && lastComboDisableIndex !== null && cells[lastComboDisableIndex]) {
                const [start, end] = [lastComboDisableIndex, cellIdx].sort((a, b) => a - b);
                targets = cells.slice(start, end + 1);
            }
            lastComboDisableIndex = cellIdx;

            applyComboDisable(targets, checked);
        });

        const uploadInput = rowEl.querySelector('.combo-upload-input');
        if (uploadInput) uploadInput.addEventListener('change', async (e) => {
            const input = e.target;
            const file = input.files[0];
            if (!file) return;

            const thumbImg = rowEl.querySelector('.combo-thumb');
            const statusEl = rowEl.querySelector('.combo-upload-status');
            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                if (cell.existing) {
                    cell.existing.image_url = url;
                } else {
                    localVariantRows.push({
                        tempId: ++variantTempCounter,
                        id: null,
                        erp_code: currentVariantErp,
                        axis_values: cell.values,
                        image_url: url,
                        sort_order: 0,
                    });
                }
                modalDirty = true;
                thumbImg.src = url;
                statusEl.textContent = '';
                renderVariantSection();
            } catch (e2) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e2.message);
            } finally {
                input.value = '';
            }
        });
    });
}

document.getElementById('add-axis-value-btn').addEventListener('click', () => {
    if (!currentVariantErp) return;
    const nameInput = document.getElementById('axis-name-input');
    const valueInput = document.getElementById('axis-value-input');
    const axisName = nameInput.value.trim();
    if (!axisName) { nameInput.focus(); return; }
    const values = splitBulkValues(valueInput.value);
    if (!values.length) { valueInput.focus(); return; }

    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newValues = values.filter(v => !existing.has(v));
    if (!newValues.length) { valueInput.value = ''; return; }

    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName); // 全新的軸排在最後面

    // 全新的軸預設「顯示在下單名稱」是開的，使用者自己再把不需要的軸關掉；
    // 如果是加值到「既有的軸」，跟其他新增選項的地方一樣改成跟著這個軸目前的設定走。
    const showInName = existingRows.length ? existingRows.every(r => r.show_in_name) : true;
    const newRows = newValues.map(v => ({
        tempId: ++variantTempCounter,
        id: null,
        erp_code: currentVariantErp,
        axis_values: { [axisName]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
        show_in_name: showInName,
    }));
    axisOptions[axisName] = [...existingRows, ...newRows];
    localVariantRows.push(...newRows);
    renumberVariantSortOrders(axisNames, axisOptions);

    if (!knownAxisNames.includes(axisName)) {
        knownAxisNames.push(axisName);
        knownAxisNames.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        const datalist = document.getElementById('known-axis-names');
        if (datalist) datalist.innerHTML = knownAxisNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }

    modalDirty = true;
    nameInput.value = '';
    valueInput.value = '';
    renderVariantSection();
});

// 主表單按下「儲存」時才真正把本地暫存的選項／組合異動寫回 Supabase。
async function saveVariantChanges() {
    if (deletedVariantIds.length) {
        const { error } = await sb.from('pos_item_variants').delete().in('id', deletedVariantIds);
        if (error) throw error;
        deletedVariantIds = [];
    }

    if (localVariantRows.length) {
        const rows = localVariantRows.map(r => ({
            erp_code: r.erp_code,
            axis_values: r.axis_values || {},
            image_url: r.image_url || null,
            sort_order: r.sort_order || 0,
            is_disabled: !!r.is_disabled,
            unit_ratios: r.unit_ratios || {},
            show_in_name: !!r.show_in_name,
        }));
        const { error } = await sb.from('pos_item_variants').upsert(rows, { onConflict: 'erp_code,axis_values' });
        if (error) throw error;
    }
}

let leavingConfirmed = false; // 點導覽列時已經跳過一次自訂確認了，避免瀏覽器 beforeunload 再跳第二次

document.querySelectorAll('.admin-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        if (modalDirty) {
            if (confirm('您有尚未儲存的修改，確定要離開嗎？')) {
                leavingConfirmed = true;
            } else {
                e.preventDefault();
            }
        }
    });
});
window.addEventListener('beforeunload', (e) => {
    if (modalDirty && !leavingConfirmed) {
        e.preventDefault();
        e.returnValue = '';
    }
});

/* --- 訂單單位（pos_item_units）：每個商品各自記住自己常用的單位，POS 下單只會顯示
   這個商品有設定過的單位。跟規格選項一樣是本地暫存，按主表單「儲存」才真正寫入。
   pos_units 保留當作「所有出現過的單位」的共用參考清單，只用來在這裡快速加入、不用重打字。 --- */
let knownUnits = []; // 全部出現過的單位名稱（來自 pos_units），純粹給「快速加入」用
let currentUnitErp = null;
let unitTempCounter = 0;
let localUnitRows = [];
let deletedUnitIds = [];

async function loadKnownUnits() {
    const { data, error } = await sb.from('pos_units').select('*').order('sort_order', { ascending: true });
    if (error) { console.error('讀取單位參考清單失敗：', error); return; }
    knownUnits = (data || []).map(u => u.name);
}

async function loadUnitSection(product) {
    const section = document.getElementById('unit-section');
    deletedUnitIds = [];

    if (!product || !product.erp_code) {
        currentUnitErp = null;
        localUnitRows = [];
        section.classList.add('opacity-50', 'pointer-events-none');
        document.getElementById('unit-chips').innerHTML = '';
        document.getElementById('unit-quick-add').innerHTML =
            '<p class="text-xs text-gray-400">請先儲存商品，才能設定單位。</p>';
        return;
    }

    currentUnitErp = product.erp_code;
    section.classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('unit-quick-add').innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    const { data, error } = await sb
        .from('pos_item_units')
        .select('*')
        .eq('erp_code', product.erp_code)
        .order('sort_order', { ascending: true });

    if (error) {
        document.getElementById('unit-quick-add').innerHTML =
            `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    localUnitRows = (data || []).map(r => ({ ...r, tempId: ++unitTempCounter }));
    renderUnitSection();
}

function addLocalUnit(name) {
    if (localUnitRows.some(r => r.name === name)) return;
    localUnitRows.push({
        tempId: ++unitTempCounter,
        id: null,
        erp_code: currentUnitErp,
        name,
        sort_order: localUnitRows.length,
        ratio: 1,
    });
    modalDirty = true;
    renderUnitSection();
}

// 有 2 個以上單位時才需要知道換算關係（例如一箱是幾個），只有 1 個單位的話比例沒有意義。
// 比例基準用目前數值最小的那個單位當「1」，其他單位顯示成「這個單位＝多少基準單位」。
function unitRatioBase() {
    if (localUnitRows.length < 2) return null;
    return localUnitRows.reduce((min, r) => (Number(r.ratio) < Number(min.ratio) ? r : min), localUnitRows[0]);
}

function renderUnitSection() {
    const chipsEl = document.getElementById('unit-chips');
    const baseUnit = unitRatioBase();

    chipsEl.innerHTML = localUnitRows.length
        ? localUnitRows.map(r => `
            <span class="unit-chip">
                ${escapeHtml(r.name)}
                ${baseUnit ? `
                    <span>＝</span>
                    <input type="number" class="unit-ratio-input field-input" data-temp-id="${r.tempId}" value="${r.ratio ?? 1}" min="0.0001" step="any" style="width:3.5rem;padding:0 4px;">
                    <span>${escapeHtml(baseUnit.name)}</span>
                ` : ''}
                <button type="button" data-temp-id="${r.tempId}" class="unit-chip-del">×</button>
            </span>`).join('')
        : '<p class="text-xs text-gray-400">這項商品還沒有設定單位。</p>';

    chipsEl.querySelectorAll('.unit-chip-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('確定要刪除這個單位嗎？')) return;
            const tempId = Number(btn.dataset.tempId);
            const row = localUnitRows.find(r => r.tempId === tempId);
            if (!row) return;
            if (row.id) deletedUnitIds.push(row.id);
            localUnitRows = localUnitRows.filter(r => r.tempId !== tempId);
            modalDirty = true;
            renderUnitSection();
        });
    });

    chipsEl.querySelectorAll('.unit-ratio-input').forEach(input => {
        input.addEventListener('change', () => {
            const tempId = Number(input.dataset.tempId);
            const row = localUnitRows.find(r => r.tempId === tempId);
            if (!row) return;
            const val = Number(input.value);
            if (!val || val <= 0) { input.value = row.ratio ?? 1; return; }
            row.ratio = val;
            modalDirty = true;
            renderUnitSection(); // 重畫，讓基準單位跟著換算數字一起更新
        });
    });

    const quickAddEl = document.getElementById('unit-quick-add');
    const usedNames = new Set(localUnitRows.map(r => r.name));
    const suggestions = knownUnits.filter(u => !usedNames.has(u));
    quickAddEl.innerHTML = suggestions.length
        ? suggestions.map(u => `<button type="button" class="category-filter-btn unit-quick-add-btn" data-unit="${escapeHtml(u)}">+ ${escapeHtml(u)}</button>`).join('')
        : '<p class="text-xs text-gray-400">沒有其他已知的單位可以快速加入。</p>';

    quickAddEl.querySelectorAll('.unit-quick-add-btn').forEach(btn => {
        btn.addEventListener('click', () => addLocalUnit(btn.dataset.unit));
    });
}

document.getElementById('unit-add-btn').addEventListener('click', () => {
    const input = document.getElementById('unit-new-input');
    const value = input.value.trim();
    if (!value || !currentUnitErp) return;
    addLocalUnit(value);
    input.value = '';
});

document.getElementById('unit-new-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('unit-add-btn').click(); }
});

// 把目前這項商品的單位設定（不管存過還是還沒按儲存），套用到同分類的其他商品身上，
// 省得同一個分類（例如同一種螺絲）每一項商品都要重新設定一次。這是立即生效的動作，
// 跟主表單的「儲存」無關，套用前會先問一次。
document.getElementById('unit-apply-category-btn').addEventListener('click', async () => {
    if (!currentUnitErp || !localUnitRows.length) { alert('請先幫這項商品加至少一個單位，才能套用到整個分類。'); return; }

    const product = allProducts.find(p => p.erp_code === currentUnitErp);
    const category = product ? (product.category_name_zh || '').trim() : '';
    if (!category) { alert('這項商品沒有分類，無法套用。'); return; }

    const targets = allProducts.filter(p => (p.category_name_zh || '').trim() === category && p.erp_code !== currentUnitErp);
    if (!targets.length) { alert('這個分類裡沒有其他商品。'); return; }

    const unitNames = localUnitRows.map(r => r.name);
    if (!confirm(`確定要把單位（${unitNames.join('、')}）套用到「${category}」分類裡的其他 ${targets.length} 項商品嗎？（不會移除那些商品原本已有的單位）`)) return;

    const rows = [];
    targets.forEach(p => {
        unitNames.forEach((name, i) => rows.push({ erp_code: p.erp_code, name, sort_order: i }));
    });

    const { error } = await sb.from('pos_item_units').upsert(rows, { onConflict: 'erp_code,name' });
    if (error) { alert('套用失敗：' + error.message); return; }
    alert(`已套用到 ${targets.length} 項商品。`);
});

// 主表單儲存時一併呼叫：本地暫存的單位異動寫回 pos_item_units；
// 這次新出現、還不在參考清單（pos_units）裡的單位名稱，也一併補進去，之後才有得快速加入。
async function saveUnitChanges() {
    if (deletedUnitIds.length) {
        const { error } = await sb.from('pos_item_units').delete().in('id', deletedUnitIds);
        if (error) throw error;
        deletedUnitIds = [];
    }

    if (localUnitRows.length) {
        const rows = localUnitRows.map(r => ({ erp_code: r.erp_code, name: r.name, sort_order: r.sort_order || 0, ratio: r.ratio || 1 }));
        const { error } = await sb.from('pos_item_units').upsert(rows, { onConflict: 'erp_code,name' });
        if (error) throw error;

        const newKnown = [...new Set(rows.map(r => r.name))].filter(n => !knownUnits.includes(n));
        if (newKnown.length) {
            const { error: knownErr } = await sb.from('pos_units')
                .upsert(newKnown.map((name, i) => ({ name, sort_order: knownUnits.length + i })), { onConflict: 'name' });
            if (!knownErr) knownUnits.push(...newKnown);
        }
    }
}

async function initProductsPage() {
    await Promise.all([loadProducts(), loadKnownUnits(), loadKnownAxisNames()]);

    // 直接幫忙把那個商品的編輯視窗打開，不用自己在一長串商品清單裡找。
    if (editIdFromUrl && allProducts.some(p => String(p.id) === String(editIdFromUrl))) {
        openEditModal(editIdFromUrl);
    }
}

initScrollRestoration('products');
initAdminAuth('products', initProductsPage);
