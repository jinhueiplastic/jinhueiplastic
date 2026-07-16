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
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-red-600">讀取失敗：${escapeHtml(error.message)}</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-gray-400">目前沒有客戶資料</td></tr>`;
        return;
    }
    tbody.innerHTML = customers.map(c => `
        <tr>
            <td class="px-3 py-2">${escapeHtml(c.name || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.site_name || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.region || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.address || '')}</td>
            <td class="px-3 py-2">${escapeHtml(c.phone || '')}</td>
            <td class="px-3 py-2">
                <button data-id="${c.id}" class="edit-btn text-blue-600 hover:underline text-sm">編輯</button>
            </td>
        </tr>`).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
        renderTable(allCustomers);
        return;
    }
    renderTable(allCustomers.filter(c =>
        [c.name, c.phone, c.site_name, c.region].some(v => String(v || '').toLowerCase().includes(q))
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

initAdminAuth('customers', loadCustomers);
