let allCustomers = [];
let editingId = null;
let selectedCustomerIds = new Set();

const statusMsg    = document.getElementById('status-msg');
const tbody        = document.getElementById('customer-tbody');
const searchInput  = document.getElementById('search-input');
const regionFilter = document.getElementById('region-filter');
const selectAllCheckbox      = document.getElementById('select-all-checkbox');
const batchSelectedCountEl   = document.getElementById('batch-selected-count');
const batchRegionInput       = document.getElementById('batch-region-input');
const batchRegionApplyBtn    = document.getElementById('batch-region-apply-btn');
const batchRegionStatusEl    = document.getElementById('batch-region-status');

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
        tbody.innerHTML = `<tr><td colspan="8" class="px-3 py-6 text-center text-red-600">讀取失敗：${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    allCustomers = data || [];
    selectedCustomerIds = new Set();
    setStatus(`共 ${allCustomers.length} 位客戶`);
    renderRegionDatalist();
    renderRegionFilterOptions();
    applyFilters();
}

function distinctRegions() {
    return [...new Set(allCustomers.map(c => (c.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function renderRegionDatalist() {
    const dl = document.getElementById('region-datalist');
    if (!dl) return;
    dl.innerHTML = distinctRegions().map(r => `<option value="${escapeHtml(r)}">`).join('');
}

// 區域篩選下拉選單：重新載入資料時（例如批次改完區域名稱之後）要重新整理選項清單，
// 但盡量保留使用者原本篩選的值（如果那個區域改名之後還存在的話）。
function renderRegionFilterOptions() {
    const current = regionFilter.value;
    const regions = distinctRegions();
    regionFilter.innerHTML = '<option value="">全部區域</option>'
        + regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    if (regions.includes(current)) regionFilter.value = current;
}

function filteredCustomers() {
    const q = searchInput.value.trim().toLowerCase();
    const region = regionFilter.value;
    return allCustomers.filter(c => {
        if (region && (c.region || '') !== region) return false;
        if (!q) return true;
        return [c.name, c.phone, c.site_name, c.region, c.contact_person].some(v => String(v || '').toLowerCase().includes(q));
    });
}

function applyFilters() {
    renderTable(filteredCustomers());
}

function renderTable(customers) {
    if (!customers.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-3 py-6 text-center text-gray-400">目前沒有客戶資料</td></tr>`;
        updateBatchBar();
        return;
    }
    tbody.innerHTML = customers.map(c => `
        <tr>
            <td class="px-3 py-2"><input type="checkbox" class="row-checkbox" data-id="${c.id}" ${selectedCustomerIds.has(String(c.id)) ? 'checked' : ''}></td>
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
    tbody.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedCustomerIds.add(cb.dataset.id);
            else selectedCustomerIds.delete(cb.dataset.id);
            updateBatchBar();
        });
    });
    updateBatchBar();
}

// 批次修改區域列那排 UI 狀態：顯示目前選了幾筆、套用按鈕能不能按、表頭「全選」是不是要打勾
// （只算目前篩選出來、畫面上看得到的這些列，不是全部客戶）。
function updateBatchBar() {
    batchSelectedCountEl.textContent = String(selectedCustomerIds.size);
    batchRegionApplyBtn.disabled = selectedCustomerIds.size === 0;

    const visibleCheckboxes = Array.from(tbody.querySelectorAll('.row-checkbox'));
    selectAllCheckbox.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every(cb => cb.checked);
    selectAllCheckbox.indeterminate = visibleCheckboxes.some(cb => cb.checked) && !selectAllCheckbox.checked;
}

selectAllCheckbox.addEventListener('change', () => {
    tbody.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        if (cb.checked) selectedCustomerIds.add(cb.dataset.id);
        else selectedCustomerIds.delete(cb.dataset.id);
    });
    updateBatchBar();
});

batchRegionApplyBtn.addEventListener('click', async () => {
    const newRegion = batchRegionInput.value.trim();
    if (!newRegion) { batchRegionInput.focus(); return; }
    const ids = Array.from(selectedCustomerIds);
    if (!ids.length) return;
    if (!confirm(`確定要把選取的 ${ids.length} 位客戶的區域都改成「${newRegion}」嗎？`)) return;

    batchRegionStatusEl.textContent = '更新中…';
    const { error } = await sb.from('customers').update({ region: newRegion }).in('id', ids);
    if (error) {
        batchRegionStatusEl.textContent = '';
        alert('批次修改失敗：' + error.message);
        return;
    }
    batchRegionStatusEl.textContent = `已把 ${ids.length} 位客戶的區域改成「${newRegion}」。`;
    batchRegionInput.value = '';
    await loadCustomers();
});

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

searchInput.addEventListener('input', applyFilters);
regionFilter.addEventListener('change', applyFilters);

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
    // 如果目前有用區域篩選，新增客戶就順便幫忙把「區域」填好，不用自己再打一次。
    if (regionFilter.value) {
        const regionField = customerForm.querySelector('[data-key="region"]');
        if (regionField) regionField.value = regionFilter.value;
    }
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
