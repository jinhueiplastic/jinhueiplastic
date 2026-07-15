const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    const { data } = await supabase.auth.getSession();
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        showLoginError('登入失敗：' + error.message);
        return;
    }
    onLoggedIn(data.session);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
});

async function loadProducts() {
    setStatus('載入商品資料中…');
    const { data, error } = await supabase
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

function renderTable(products) {
    if (!products.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-400">目前沒有商品資料</td></tr>`;
        return;
    }
    tbody.innerHTML = products.map(p => `
        <tr>
            <td class="px-3 py-2">
                <input type="checkbox" data-id="${p.id}" class="active-toggle" ${p.is_active ? 'checked' : ''}>
            </td>
            <td class="px-3 py-2">${escapeHtml(p.category_name_zh || '')}</td>
            <td class="px-3 py-2">${escapeHtml(p.erp_code || '')}</td>
            <td class="px-3 py-2">${escapeHtml(p.name_zh || '')}</td>
            <td class="px-3 py-2">${escapeHtml(p.name_en || '')}</td>
            <td class="px-3 py-2">
                <button data-id="${p.id}" class="edit-btn text-blue-600 hover:underline text-sm">編輯</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.active-toggle').forEach(cb => {
        cb.addEventListener('change', () => toggleActive(cb.dataset.id, cb.checked));
    });
}

async function toggleActive(id, isActive) {
    const { error } = await supabase
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
            return `
                <div class="sm:col-span-2">
                    <label class="field-label">${f.label}</label>
                    <textarea class="field-input" rows="3" data-key="${f.key}">${escaped}</textarea>
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
        ({ error } = await supabase.from('products').update(payload).eq('id', editingId));
    } else {
        ({ error } = await supabase.from('products').insert(payload));
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
