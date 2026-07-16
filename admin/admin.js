const PRODUCT_FIELDS = [
    { key: 'category_name_zh', label: '分類（中文）' },
    { key: 'category_name_en', label: '分類（英文）' },
    { key: 'erp_code',         label: 'ERP 貨號' },
    { key: 'catalog_code',     label: '型錄貨號' },
    { key: 'name_zh',          label: '中文品名' },
    { key: 'name_en',          label: '英文品名' },
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

const statusMsg   = document.getElementById('status-msg');
const tbody       = document.getElementById('product-tbody');
const searchInput = document.getElementById('search-input');

const modal        = document.getElementById('edit-modal');
const modalTitle    = document.getElementById('modal-title');
const formFields    = document.getElementById('form-fields');
const productForm   = document.getElementById('product-form');
const formError      = document.getElementById('form-error');

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
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-red-600">
            讀取失敗：${escapeHtml(error.message)}
        </td></tr>`;
        return;
    }

    allProducts = data || [];
    setStatus(`共 ${allProducts.length} 筆商品`);
    renderTable(allProducts);
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
        ? `<img src="${img}" alt="" class="product-thumb">`
        : `<div class="product-thumb"></div>`;
    return `
        <tr>
            <td class="px-3 py-2">
                <input type="checkbox" data-id="${p.id}" class="active-toggle" ${p.is_active ? 'checked' : ''}>
            </td>
            <td class="px-3 py-2">${thumb}</td>
            <td class="px-3 py-2">${escapeHtml(p.erp_code || '')}</td>
            <td class="px-3 py-2">${escapeHtml(p.name_zh || '')}</td>
            <td class="px-3 py-2">${escapeHtml(p.name_en || '')}</td>
            <td class="px-3 py-2">
                <button data-id="${p.id}" class="edit-btn text-blue-600 hover:underline text-sm">編輯</button>
            </td>
        </tr>`;
}

function renderTable(products) {
    if (!products.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-400">目前沒有商品資料</td></tr>`;
        return;
    }

    tbody.innerHTML = groupByCategory(products).map(([cat, items]) => `
        <tr class="category-header">
            <td colspan="6" class="px-3 py-2">${escapeHtml(cat)}（${items.length}）</td>
        </tr>
        ${items.map(productRowHtml).join('')}
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

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
        renderTable(allProducts);
        return;
    }
    const filtered = allProducts.filter(p => {
        return [p.category_name_zh, p.erp_code, p.catalog_code, p.name_zh, p.name_en]
            .some(v => String(v || '').toLowerCase().includes(q));
    });
    renderTable(filtered);
});

let descTableStates = {};

function buildFormFields(product) {
    descTableStates = {
        desc_zh: parseFirstTable(product ? (product.desc_zh || '') : ''),
        desc_en: parseFirstTable(product ? (product.desc_en || '') : ''),
    };
    formFields.innerHTML = PRODUCT_FIELDS.map(f => {
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
                    <textarea class="field-input" rows="4" data-key="${f.key}">${escaped}</textarea>
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
                             class="product-thumb" style="width:64px;height:64px;">
                        <div class="flex-1 space-y-2">
                            <input type="text" id="image-url-input" class="field-input" data-key="${f.key}" value="${escaped}"
                                   oninput="document.getElementById('image-preview').src = this.value.split(',')[0].trim()">
                            <div class="flex items-center gap-2">
                                <input type="file" id="image-upload-input" accept="image/*" class="text-xs">
                                <span id="image-upload-status" class="text-xs text-gray-400"></span>
                            </div>
                        </div>
                    </div>
                </div>`;
        }
        return `
            <div>
                <label class="field-label">${f.label}</label>
                <input type="text" class="field-input" data-key="${f.key}" value="${escaped}">
            </div>`;
    }).join('') + `
        <div class="sm:col-span-2 flex items-center gap-2 pt-1">
            <input type="checkbox" id="form-is-active" ${product && product.is_active === false ? '' : 'checked'}>
            <label for="form-is-active" class="text-sm text-gray-600">上架顯示於官網</label>
        </div>`;

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
}

function syncTextarea(key) {
    const textarea = formFields.querySelector(`textarea[data-key="${key}"]`);
    if (textarea) textarea.value = composeText(descTableStates[key]);
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
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

document.getElementById('new-product-btn').addEventListener('click', () => {
    editingId = null;
    modalTitle.textContent = '新增商品';
    buildFormFields(null);
    loadVariantSection(null);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
});

function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
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

    closeModal();
    loadProducts();
});

/* --- POS 規格／孔徑／顏色選項（pos_item_variants），在編輯商品時直接管理 ---
   流程：先分別幫規格/孔徑/顏色各自新增選項（斜線分隔一次加多個），
   下面會自動列出所有組合，每個組合各自有一個「上傳圖片」按鈕。 */
let currentVariantErp = null;
let currentAxisOptions = { spec: [], bore: [], color: [] };

function splitBulkValues(text) {
    return text.split('/').map(v => v.trim()).filter(Boolean);
}

// 只填一欄的列＝定義一個軸選項；填兩欄以上的列＝那個確切組合的實際照片
function categorizeVariantRows(rows) {
    const axisOptions = { spec: [], bore: [], color: [] };
    const comboByKey = {};
    rows.forEach(r => {
        const filledCount = [r.spec, r.bore, r.color].filter(Boolean).length;
        if (filledCount === 1) {
            const type = r.spec ? 'spec' : (r.bore ? 'bore' : 'color');
            axisOptions[type].push(r);
        } else if (filledCount >= 2) {
            comboByKey[[r.spec || '', r.bore || '', r.color || ''].join('||')] = r;
        }
    });
    return { axisOptions, comboByKey };
}

async function loadVariantSection(product) {
    const section = document.getElementById('variant-section');

    if (!product || !product.erp_code) {
        currentVariantErp = null;
        section.classList.add('opacity-50', 'pointer-events-none');
        ['spec', 'bore', 'color'].forEach(type => {
            document.getElementById(`axis-${type}-chips`).innerHTML = '';
        });
        document.getElementById('variant-combo-list').innerHTML =
            '<p class="text-xs text-gray-400">請先儲存商品，才能新增規格選項。</p>';
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

    renderVariantSection(data || []);
}

function renderVariantSection(rows) {
    const { axisOptions, comboByKey } = categorizeVariantRows(rows);
    currentAxisOptions = axisOptions;

    ['spec', 'bore', 'color'].forEach(type => {
        const chipsEl = document.getElementById(`axis-${type}-chips`);
        chipsEl.innerHTML = axisOptions[type].map(r => `
            <span class="axis-chip">
                ${escapeHtml(r.spec || r.bore || r.color)}
                <button type="button" data-id="${r.id}" class="axis-chip-del">×</button>
            </span>`).join('');

        chipsEl.querySelectorAll('.axis-chip-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const { error } = await sb.from('pos_item_variants').delete().eq('id', btn.dataset.id);
                if (error) { alert('刪除失敗：' + error.message); return; }
                loadVariantSection({ erp_code: currentVariantErp });
            });
        });
    });

    renderComboList(axisOptions, comboByKey);
}

function renderComboList(axisOptions, comboByKey) {
    const container = document.getElementById('variant-combo-list');
    const activeAxes = ['spec', 'bore', 'color'].filter(type => axisOptions[type].length > 0);

    if (activeAxes.length < 2) {
        container.innerHTML = '<p class="text-xs text-gray-400">至少要有兩種軸（例如規格＋顏色）都新增選項，才會列出組合照片。</p>';
        return;
    }

    const specs  = axisOptions.spec.length  ? axisOptions.spec.map(r => r.spec)   : [''];
    const bores  = axisOptions.bore.length  ? axisOptions.bore.map(r => r.bore)   : [''];
    const colors = axisOptions.color.length ? axisOptions.color.map(r => r.color) : [''];

    const combos = [];
    specs.forEach(spec => bores.forEach(bore => colors.forEach(color => combos.push({ spec, bore, color }))));

    container.innerHTML = combos.map(combo => {
        const key = [combo.spec, combo.bore, combo.color].join('||');
        const existing = comboByKey[key];
        const label = [combo.spec, combo.bore, combo.color].filter(Boolean).join(', ');
        return `
            <div class="flex items-center gap-3 border rounded-lg p-2"
                 data-spec="${escapeHtml(combo.spec)}" data-bore="${escapeHtml(combo.bore)}" data-color="${escapeHtml(combo.color)}">
                <img src="${escapeHtml(existing ? existing.image_url || '' : '')}" alt="" class="product-thumb combo-thumb" style="width:40px;height:40px;">
                <div class="flex-1 text-sm">${escapeHtml(label)}</div>
                <span class="combo-upload-status text-xs text-gray-400"></span>
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden combo-upload-input">
                </label>
            </div>`;
    }).join('');

    container.querySelectorAll('.combo-upload-input').forEach(input => {
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file || !currentVariantErp) return;

            const row = input.closest('[data-spec]');
            const thumbImg = row.querySelector('.combo-thumb');
            const statusEl = row.querySelector('.combo-upload-status');

            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                const { error } = await sb.from('pos_item_variants').upsert({
                    erp_code: currentVariantErp,
                    spec: row.dataset.spec,
                    bore: row.dataset.bore,
                    color: row.dataset.color,
                    image_url: url,
                }, { onConflict: 'erp_code,spec,bore,color' });
                if (error) throw error;
                thumbImg.src = url;
                statusEl.textContent = '';
            } catch (e) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e.message);
            } finally {
                input.value = '';
            }
        });
    });
}

document.querySelectorAll('.add-axis-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!currentVariantErp) return;
        const type = btn.dataset.type;
        const input = document.getElementById(`axis-${type}-input`);
        const values = splitBulkValues(input.value);
        if (!values.length) return;

        const existing = new Set(currentAxisOptions[type].map(r => r.spec || r.bore || r.color));
        const newValues = values.filter(v => !existing.has(v));
        if (!newValues.length) { input.value = ''; return; }

        const rows = newValues.map(v => ({
            erp_code: currentVariantErp,
            spec: type === 'spec' ? v : '',
            bore: type === 'bore' ? v : '',
            color: type === 'color' ? v : '',
        }));

        const { error } = await sb.from('pos_item_variants').insert(rows);
        if (error) { alert('新增失敗：' + error.message); return; }

        input.value = '';
        loadVariantSection({ erp_code: currentVariantErp });
    });
});

initAdminAuth('products', loadProducts);
