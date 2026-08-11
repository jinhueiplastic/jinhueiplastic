let allCustomers = [];
let editingId = null;

const statusMsg   = document.getElementById('status-msg');
const tbody       = document.getElementById('customer-tbody');
const searchInput = document.getElementById('search-input');

const modal        = document.getElementById('edit-modal');
const modalTitle   = document.getElementById('modal-title');
const customerForm = document.getElementById('customer-form');
const formError    = document.getElementById('form-error');

function setStatus(msg) {
    statusMsg.textContent = msg;
}

async function loadCustomers() {
    setStatus('載入客戶資料中…');
    const { data, error } = await sb
        .from('customers')
        .select('*')
        .order('name', { ascending: true });

    if (error) {
        setStatus('');
        tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-6 text-center text-red-600">讀取失敗：${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    allCustomers = data || [];
    setStatus(`共 ${allCustomers.length} 位客戶`);
    renderTable(allCustomers);
    renderRegionDatalist();
}

function renderRegionDatalist() {
    const dl = document.getElementById('region-datalist');
    if (!dl) return;
    const regions = [...new Set(allCustomers.map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    dl.innerHTML = regions.map(r => `<option value="${escapeHtml(r)}">`).join('');
}

function renderTable(customers) {
    if (!customers.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-6 text-center text-gray-400">目前沒有客戶資料</td></tr>`;
        return;
    }
    tbody.innerHTML = customers.map(c => `
        <tr>
            <td class="px-3 py-2">${escapeHtml(c.name || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.site_name || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.region || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.address || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.contact_person || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.phone || '')}</td>
            <td class="px-3 py-2">
                <button data-id="${c.id}" class="edit-btn text-blue-600 hover:underline text-sm">編輯</button>
                <button data-id="${c.id}" class="delete-btn text-red-600 hover:underline text-sm ml-2">刪除</button>
            </td>
        </tr>`).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCustomer(btn.dataset.id));
    });
}

// 客戶如果已經有訂單（orders.customer_id 參照這筆客戶），資料庫的外鍵限制會擋下刪除、
// 回傳 23503 錯誤——這是刻意保留的保護，不能刪掉還有訂單記錄的客戶，這裡把原始錯誤代碼
// 轉成看得懂的提示，不要讓使用者看到一串 SQL 錯誤訊息。
async function deleteCustomer(id) {
    const customer = allCustomers.find(c => String(c.id) === String(id));
    if (!confirm(`確定要刪除客戶「${customer ? customer.name : ''}」嗎？`)) return;

    const { error } = await sb.from('customers').delete().eq('id', id);
    if (error) {
        if (error.code === '23503') {
            alert('無法刪除：這位客戶已經有訂單紀錄，要保留訂單資料就不能刪除客戶。');
        } else {
            alert('刪除失敗：' + error.message);
        }
        return;
    }
    loadCustomers();
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
        renderTable(allCustomers);
        return;
    }
    renderTable(allCustomers.filter(c =>
        [c.name, c.phone, c.site_name, c.region, c.contact_person].some(v => String(v || '').toLowerCase().includes(q))
    ));
});

function fillForm(customer) {
    customerForm.querySelectorAll('[data-key]').forEach(el => {
        el.value = customer ? (customer[el.dataset.key] || '') : '';
    });
}

function openEditModal(id) {
    const customer = allCustomers.find(c => String(c.id) === String(id));
    editingId = id;
    modalTitle.textContent = '編輯客戶';
    fillForm(customer);
    formError.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

document.getElementById('new-customer-btn').addEventListener('click', () => {
    editingId = null;
    modalTitle.textContent = '新增客戶';
    fillForm(null);
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

customerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');

    const payload = {};
    customerForm.querySelectorAll('[data-key]').forEach(el => {
        payload[el.dataset.key] = el.value.trim();
    });

    let error;
    if (editingId) {
        ({ error } = await sb.from('customers').update(payload).eq('id', editingId));
    } else {
        ({ error } = await sb.from('customers').insert(payload));
    }

    if (error) {
        formError.textContent = '儲存失敗：' + error.message;
        formError.classList.remove('hidden');
        return;
    }

    closeModal();
    loadCustomers();
});

initScrollRestoration('customers');
initAdminAuth('customers', loadCustomers);
