const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const loginView   = document.getElementById('login-view');
const appView     = document.getElementById('app-view');
const loginForm   = document.getElementById('login-form');
const loginError  = document.getElementById('login-error');
const userEmailEl = document.getElementById('user-email');
const statusMsg   = document.getElementById('status-msg');
const tbody       = document.getElementById('product-tbody');
const searchInput = document.getElementById('search-input');

const modal        = document.getElementById('edit-modal');
const modalTitle    = document.getElementById('modal-title');
const formFields    = document.getElementById('form-fields');
const productForm   = document.getElementById('product-form');
const formError      = document.getElementById('form-error');

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
}

function setStatus(msg) {
    statusMsg.textContent = msg;
}

async function checkSession() {
    const { data } = await sb.auth.getSession();
    if (data.session) {
        onLoggedIn(data.session);
    } else {
        loginView.classList.remove('hidden');
        appView.classList.add('hidden');
    }
}

function onLoggedIn(session) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    userEmailEl.textContent = session.user.email || '';
    loadProducts();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        showLoginError('登入失敗：' + error.message);
        return;
    }
    onLoggedIn(data.session);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
});

async function loadProducts() {
    setStatus('載入商品資料中…');
    const { data, error } = await sb
        .from('products')
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
        .from('products')
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

function buildFormFields(product) {
    formFields.innerHTML = PRODUCT_FIELDS.map(f => {
        const value = product ? (product[f.key] ?? '') : '';
        const escaped = escapeHtml(String(value));
        if (f.textarea) {
            const isTableField = f.key === 'desc_zh' || f.key === 'desc_en';
            return `
                <div class="sm:col-span-2">
                    <div class="flex items-center justify-between mb-1">
                        <label class="field-label !mb-0">${f.label}</label>
                        ${isTableField ? `<button type="button" class="table-tool-toggle text-xs text-blue-600 hover:underline" data-key="${f.key}">規格表格編輯工具</button>` : ''}
                    </div>
                    <textarea class="field-input" rows="4" data-key="${f.key}">${escaped}</textarea>
                    ${isTableField ? `<div class="table-tool-panel hidden mt-2 border rounded-lg p-3 bg-gray-50" data-key="${f.key}"></div>` : ''}
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
                        <input type="text" class="field-input" data-key="${f.key}" value="${escaped}"
                               oninput="document.getElementById('image-preview').src = this.value.split(',')[0].trim()">
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
        btn.addEventListener('click', () => toggleTableTool(btn.dataset.key));
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

function toggleTableTool(key) {
    const panel = formFields.querySelector(`.table-tool-panel[data-key="${key}"]`);
    const textarea = formFields.querySelector(`textarea[data-key="${key}"]`);
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    panel.classList.remove('hidden');
    renderTableToolPanel(panel, textarea, parseFirstTable(textarea.value));
}

function renderTableToolPanel(panel, textarea, state) {
    const headerCells = state.headers.map((h, ci) => `
        <th class="border px-1 py-1 bg-white">
            <div class="flex items-center gap-1">
                <input type="text" class="field-input text-xs th-input" style="min-width:5rem" data-ci="${ci}" value="${escapeHtml(h)}">
                <button type="button" class="col-del text-red-400 hover:text-red-600 text-xs shrink-0" data-ci="${ci}" title="刪除欄">×</button>
            </div>
        </th>`).join('');

    const bodyRows = state.rows.map((row, ri) => `
        <tr>
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
                <thead><tr>${headerCells}<th class="border px-1 py-1 bg-white"></th></tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
        <div class="flex gap-2 mt-2">
            <button type="button" class="add-row px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">+ 新增列</button>
            <button type="button" class="add-col px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">+ 新增欄</button>
        </div>
        <p class="text-xs text-gray-400 mt-2">上面的表格會自動同步到上方的說明欄位，儲存時會一併存入。</p>`;

    const sync = () => { textarea.value = composeText(state); };

    panel.querySelectorAll('.th-input').forEach(input => {
        input.addEventListener('input', () => {
            state.headers[Number(input.dataset.ci)] = input.value;
            sync();
        });
    });
    panel.querySelectorAll('.cell-input').forEach(input => {
        input.addEventListener('input', () => {
            state.rows[Number(input.dataset.ri)][Number(input.dataset.ci)] = input.value;
            sync();
        });
    });
    panel.querySelectorAll('.row-del').forEach(btn => {
        btn.addEventListener('click', () => {
            state.rows.splice(Number(btn.dataset.ri), 1);
            if (!state.rows.length) state.rows.push(state.headers.map(() => ''));
            sync();
            renderTableToolPanel(panel, textarea, state);
        });
    });
    panel.querySelectorAll('.col-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.headers.length <= 1) return;
            const ci = Number(btn.dataset.ci);
            state.headers.splice(ci, 1);
            state.rows.forEach(r => r.splice(ci, 1));
            sync();
            renderTableToolPanel(panel, textarea, state);
        });
    });
    panel.querySelector('.add-row').addEventListener('click', () => {
        state.rows.push(state.headers.map(() => ''));
        sync();
        renderTableToolPanel(panel, textarea, state);
    });
    panel.querySelector('.add-col').addEventListener('click', () => {
        state.headers.push('欄位' + (state.headers.length + 1));
        state.rows.forEach(r => r.push(''));
        sync();
        renderTableToolPanel(panel, textarea, state);
    });

    sync();
}

function openEditModal(id) {
    const product = allProducts.find(p => String(p.id) === String(id));
    editingId = id;
    modalTitle.textContent = '編輯商品';
    buildFormFields(product);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

document.getElementById('new-product-btn').addEventListener('click', () => {
    editingId = null;
    modalTitle.textContent = '新增商品';
    buildFormFields(null);
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
        ({ error } = await sb.from('products').update(payload).eq('id', editingId));
    } else {
        ({ error } = await sb.from('products').insert(payload));
    }

    if (error) {
        formError.textContent = '儲存失敗：' + error.message;
        formError.classList.remove('hidden');
        return;
    }

    closeModal();
    loadProducts();
});

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

checkSession();
