const PRODUCT_FIELDS = [
    { key: 'category_name_zh', label: '分類（中文）' },
    { key: 'category_name_en', label: '分類（英文）' },
    { key: 'erp_code',         label: 'ERP 貨號' },
    { key: 'catalog_code',     label: '型錄貨號' },
    { key: 'name_zh',          label: '中文品名' },
    { key: 'name_en',          label: '英文品名' },
    { key: 'order_display_name', label: '下單名稱（不填的話 POS 下單／查詢訂單／區域表單顯示中文品名）' },
    { key: 'image_url',        label: '圖片網址' },
    { key: 'desc_zh',          label: '中文說明', textarea: true },
    { key: 'desc_en',          label: '英文說明', textarea: true },
    { key: 'pcs_per_pack',     label: '包裝規格' },
    { key: 'unit',             label: '單位' },
    { key: 'keywords',         label: '關鍵字' },
    { key: 'store1_url',       label: '賣場網址 1' },
    { key: 'store2_url',       label: '賣場網址 2' },
    { key: 'store3_url',       label: '賣場網址 3' },
    { key: 'store4_url',       label: '賣場網址 4' },
];

let allProducts = [];
let editingId = null;
let modalDirty = false; // 表單或規格選項有沒有還沒儲存的修改
let selectedCategoryFilter = null; // null = 全部

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
    const { data, error } = await sb
        .from('pos_items')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        setStatus('');
        tbody.innerHTML = `<p class="text-center text-red-600 py-6">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    allProducts = data || [];
    setStatus(`共 ${allProducts.length} 筆商品`);
    renderCategoryFilterTiles();
    applyFilters();
}

// 桌面版用按鈕，手機版（畫面比較窄，這頁又常常在手機上用）改用下拉選單，
// 不用一次把所有分類的按鈕都塞在畫面上。兩邊共用同一個 selectedCategoryFilter 狀態。
function renderCategoryFilterTiles() {
    const container = document.getElementById('category-filter-tiles');
    const select = document.getElementById('category-filter-select');
    if (!container && !select) return;

    const categories = [...new Set(allProducts.map(p => (p.category_name_zh || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));

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

function groupByCategory(products) {
    const groups = new Map();
    products.forEach(p => {
        const cat = (p.category_name_zh || '').trim() || '未分類';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(p);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
}

function productRowHtml(p) {
    const img = String(p.image_url || '').split(',')[0].trim();
    const thumb = img
        ? `<img src="${img}" alt="" class="product-thumb" style="width:72px;height:72px;">`
        : `<div class="product-thumb" style="width:72px;height:72px;"></div>`;

    // 有設定下單名稱的話優先顯示下單名稱，原本的商品名稱用括號附註在後面方便對照；沒設定就只顯示商品名稱。
    const orderName = (p.order_display_name || '').trim();
    const nameLine = orderName ? `${orderName}（${p.name_zh || ''}）` : (p.name_zh || '');

    return `
        <div class="flex gap-4 border rounded-lg p-3 bg-white">
            <div class="flex flex-col items-center gap-2 shrink-0">
                ${thumb}
                <button data-id="${p.id}" class="edit-btn text-blue-600 hover:underline text-sm">編輯</button>
            </div>
            <div class="flex-1 min-w-0 flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="font-bold text-gray-900 truncate">${escapeHtml(p.erp_code || '')}</p>
                    <p class="text-gray-700 truncate">${escapeHtml(nameLine)}</p>
                </div>
                <label class="flex items-center gap-1 text-xs text-gray-500 shrink-0 whitespace-nowrap">
                    <input type="checkbox" data-id="${p.id}" class="active-toggle" ${p.is_active ? 'checked' : ''}>
                    上架
                </label>
            </div>
        </div>`;
}

function renderTable(products) {
    if (!products.length) {
        tbody.innerHTML = `<p class="text-center text-gray-400 py-6">目前沒有商品資料</p>`;
        return;
    }

    tbody.innerHTML = groupByCategory(products).map(([cat, items]) => `
        <div class="category-header rounded-lg px-3 py-2">${escapeHtml(cat)}（${items.length}）</div>
        <div class="space-y-2 mb-4">${items.map(productRowHtml).join('')}</div>
    `).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.active-toggle').forEach(cb => {
        cb.addEventListener('change', () => toggleActive(cb.dataset.id, cb.checked));
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
                <label class="field-label">${f.label}</label>
                ${fieldDisplayHtml(f.key, escaped)}
                <input type="text" class="field-input hidden" data-key="${f.key}" value="${escaped}">
            </div>`;
    };

    formFieldsTop.innerHTML = topFields.map(renderField).join('');
    formFieldsBottom.innerHTML = bottomFields.map(renderField).join('') + `
        <div class="sm:col-span-2 flex items-center gap-2 pt-1">
            <input type="checkbox" id="form-is-active" ${product && product.is_active === false ? '' : 'checked'}>
            <label for="form-is-active" class="text-sm text-gray-600">上架顯示於官網</label>
        </div>`;

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

function openEditModal(id) {
    const product = allProducts.find(p => String(p.id) === String(id));
    editingId = id;
    modalTitle.textContent = '編輯商品';
    buildFormFields(product);
    loadVariantSection(product);
    loadUnitSection(product);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modalDirty = false;
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
let comboBuilderPairs = [{ name: '', value: '' }, { name: '', value: '' }];

function splitBulkValues(text) {
    return text.split(/[/、,，]/)
        .map(v => v.trim().replace(/^[「『（(]+|[」』）)]+$/g, '').trim())
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
    return { axisOptions, combos };
}

async function loadKnownAxisNames() {
    const { data, error } = await sb.from('pos_item_variants').select('axis_values');
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

    if (!product || !product.erp_code) {
        currentVariantErp = null;
        localVariantRows = [];
        section.classList.add('opacity-50', 'pointer-events-none');
        document.getElementById('axis-groups').innerHTML = '';
        document.getElementById('variant-combo-list').innerHTML =
            '<p class="text-xs text-gray-400">請先儲存商品，才能新增選項。</p>';
        document.getElementById('combo-builder').innerHTML = '';
        return;
    }

    currentVariantErp = product.erp_code;
    section.classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('variant-combo-list').innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    const { data, error } = await sb
        .from('pos_item_variants')
        .select('*')
        .eq('erp_code', product.erp_code)
        .order('sort_order', { ascending: true });

    if (error) {
        document.getElementById('variant-combo-list').innerHTML =
            `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    localVariantRows = (data || []).map(r => ({ ...r, axis_values: r.axis_values || {}, tempId: ++variantTempCounter }));
    renderVariantSection();
}

function axisChipHtml(r, name) {
    const rawValue = r.axis_values[name];
    const splitCount = splitBulkValues(rawValue).length;
    return `
        <div class="flex items-center gap-3 border rounded-lg p-2" data-temp-id="${r.tempId}" data-axis-name="${escapeHtml(name)}">
            <img src="${escapeHtml(r.image_url || '')}" alt="" class="product-thumb axis-option-thumb" style="width:32px;height:32px;">
            <div class="flex-1 text-sm">${escapeHtml(rawValue)}</div>
            <span class="axis-upload-status text-xs text-gray-400"></span>
            <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                上傳圖片
                <input type="file" accept="image/*" class="hidden axis-upload-input">
            </label>
            ${r.image_url ? `<button type="button" class="axis-image-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
            ${splitCount > 1 ? `<button type="button" class="axis-chip-split px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="分割成 ${splitCount} 個選項">⇥ 分割</button>` : ''}
            <button type="button" class="axis-chip-del px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap" title="刪除選項">刪除</button>
        </div>`;
}

function wireAxisChips(scopeEl) {
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
    const axisNames = Object.keys(axisOptions).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    const groupsEl = document.getElementById('axis-groups');
    if (!axisNames.length) {
        groupsEl.innerHTML = '<p class="text-xs text-gray-400">這個商品還沒有任何選項，在下面新增第一個軸吧（例如「規格」）。</p>';
    } else {
        groupsEl.innerHTML = axisNames.map(name => `
            <div>
                <label class="field-label">${escapeHtml(name)}</label>
                <div class="space-y-1">${axisOptions[name].map(r => axisChipHtml(r, name)).join('')}</div>
            </div>`).join('');
    }
    wireAxisChips(groupsEl);

    renderComboList(combos);
    renderComboBuilder();
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
    const existing = new Set((axisOptions[axisName] || []).map(r => r.axis_values[axisName]));
    values.filter(v => !existing.has(v)).forEach(v => {
        localVariantRows.push({
            tempId: ++variantTempCounter,
            id: null,
            erp_code: currentVariantErp,
            axis_values: { [axisName]: v },
            image_url: null,
            sort_order: 0,
        });
    });

    modalDirty = true;
    renderVariantSection();
}

function renderComboList(combos) {
    const container = document.getElementById('variant-combo-list');
    if (!combos.length) {
        container.innerHTML = '<p class="text-xs text-gray-400">目前沒有完整組合。</p>';
        return;
    }

    container.innerHTML = combos.map(r => {
        const label = rowAxisEntries(r).map(([k, v]) => `${k}：${v}`).join('　');
        return `
            <div class="flex items-center gap-3 border rounded-lg p-2" data-temp-id="${r.tempId}">
                <img src="${escapeHtml(r.image_url || '')}" alt="" class="product-thumb combo-thumb" style="width:40px;height:40px;">
                <div class="flex-1 text-sm">${escapeHtml(label)}</div>
                <span class="combo-upload-status text-xs text-gray-400"></span>
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden combo-upload-input">
                </label>
                ${r.image_url ? `<button type="button" class="combo-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
                <button type="button" class="combo-delete-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">刪除組合</button>
            </div>`;
    }).join('');

    container.querySelectorAll('.combo-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('確定要刪除這筆組合嗎？')) return;
            removeVariantRow(Number(btn.closest('[data-temp-id]').dataset.tempId));
        });
    });

    container.querySelectorAll('.combo-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tempId = Number(btn.closest('[data-temp-id]').dataset.tempId);
            if (!confirm('確定要移除這張組合照片嗎？')) return;
            const row = localVariantRows.find(r => r.tempId === tempId);
            if (!row) return;
            row.image_url = null;
            modalDirty = true;
            renderVariantSection();
        });
    });

    container.querySelectorAll('.combo-upload-input').forEach(input => {
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;

            const rowEl = input.closest('[data-temp-id]');
            const tempId = Number(rowEl.dataset.tempId);
            const row = localVariantRows.find(r => r.tempId === tempId);
            if (!row) return;

            const thumbImg = rowEl.querySelector('.combo-thumb');
            const statusEl = rowEl.querySelector('.combo-upload-status');
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

// 手動新增一筆完整組合：自己填軸名稱＋值（至少兩軸），不受限於已經有選項按鈕的軸，
// 這樣像 W／H／L 這種只出現在組合裡、平常不需要單獨當按鈕選的軸也能填。
function renderComboBuilder() {
    const el = document.getElementById('combo-builder');
    if (!currentVariantErp) { el.innerHTML = ''; return; }

    el.innerHTML = `
        <div class="border rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">手動新增一筆完整組合：</p>
            <div id="combo-builder-rows" class="space-y-1"></div>
            <div class="flex gap-2 mt-2">
                <button type="button" id="combo-builder-add-row" class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">+ 再加一軸</button>
                <button type="button" id="combo-builder-submit" class="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">新增這筆組合</button>
            </div>
        </div>`;

    const rowsEl = document.getElementById('combo-builder-rows');
    const renderRows = () => {
        rowsEl.innerHTML = comboBuilderPairs.map((pair, i) => `
            <div class="flex gap-2">
                <input type="text" class="field-input combo-builder-name" style="width:9rem" list="known-axis-names" placeholder="軸名稱" value="${escapeHtml(pair.name)}" data-idx="${i}">
                <input type="text" class="field-input combo-builder-value" placeholder="值" value="${escapeHtml(pair.value)}" data-idx="${i}">
            </div>`).join('');
        rowsEl.querySelectorAll('.combo-builder-name').forEach(inp => {
            inp.addEventListener('input', () => { comboBuilderPairs[Number(inp.dataset.idx)].name = inp.value; });
        });
        rowsEl.querySelectorAll('.combo-builder-value').forEach(inp => {
            inp.addEventListener('input', () => { comboBuilderPairs[Number(inp.dataset.idx)].value = inp.value; });
        });
    };
    renderRows();

    document.getElementById('combo-builder-add-row').addEventListener('click', () => {
        comboBuilderPairs.push({ name: '', value: '' });
        renderRows();
    });

    document.getElementById('combo-builder-submit').addEventListener('click', () => {
        const values = {};
        comboBuilderPairs.forEach(p => {
            const n = p.name.trim();
            const v = p.value.trim();
            if (n && v) values[n] = v;
        });
        if (Object.keys(values).length < 2) { alert('至少要填兩個軸才算一筆組合'); return; }

        localVariantRows.push({
            tempId: ++variantTempCounter,
            id: null,
            erp_code: currentVariantErp,
            axis_values: values,
            image_url: null,
            sort_order: 0,
        });
        comboBuilderPairs = [{ name: '', value: '' }, { name: '', value: '' }];
        modalDirty = true;
        renderVariantSection();
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
    const existing = new Set((axisOptions[axisName] || []).map(r => r.axis_values[axisName]));
    const newValues = values.filter(v => !existing.has(v));
    if (!newValues.length) { valueInput.value = ''; return; }

    newValues.forEach(v => {
        localVariantRows.push({
            tempId: ++variantTempCounter,
            id: null,
            erp_code: currentVariantErp,
            axis_values: { [axisName]: v },
            image_url: null,
            sort_order: 0,
        });
    });

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

// 從商品說明表格一樣格式的 markdown 表格貼上，一次匯入多筆完整組合：
// 第一列（表頭）當軸名稱，之後每一列是一筆組合，跟中文說明欄位常用的表格格式相同。
document.getElementById('combo-table-import-btn').addEventListener('click', () => {
    if (!currentVariantErp) return;
    const statusEl = document.getElementById('combo-table-import-status');
    const textarea = document.getElementById('combo-table-paste');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 2) { statusEl.textContent = '至少要有標題列＋一列資料，而且每列要用 | 分隔。'; return; }

    const parseRow = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(lines[0]);
    if (headers.filter(Boolean).length < 2) { statusEl.textContent = '標題列至少要有兩欄（兩個軸）。'; return; }

    let added = 0, skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        if (/^[|:\s-]+$/.test(lines[i])) continue; // markdown 分隔列（---）
        const cells = parseRow(lines[i]);
        const values = {};
        headers.forEach((h, idx) => {
            const v = (cells[idx] || '').trim();
            if (h && v) values[h] = v;
        });
        if (Object.keys(values).length < 2) { skipped++; continue; }
        localVariantRows.push({
            tempId: ++variantTempCounter,
            id: null,
            erp_code: currentVariantErp,
            axis_values: values,
            image_url: null,
            sort_order: 0,
        });
        added++;
    }

    if (added) modalDirty = true;
    statusEl.textContent = `已新增 ${added} 筆組合${skipped ? `，略過 ${skipped} 筆（欄位不足兩個）` : ''}。記得最下面按「儲存」才會真正生效。`;
    textarea.value = '';
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
    });
    modalDirty = true;
    renderUnitSection();
}

function renderUnitSection() {
    const chipsEl = document.getElementById('unit-chips');
    chipsEl.innerHTML = localUnitRows.length
        ? localUnitRows.map(r => `
            <span class="unit-chip">
                ${escapeHtml(r.name)}
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
        const rows = localUnitRows.map(r => ({ erp_code: r.erp_code, name: r.name, sort_order: r.sort_order || 0 }));
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
}

initAdminAuth('products', initProductsPage);
