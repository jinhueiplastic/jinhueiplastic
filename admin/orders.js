let allOrders = [];

const statusMsg         = document.getElementById('status-msg');
const resultsContainer  = document.getElementById('results-container');

function renderCustomerDatalist(customers) {
    const dl = document.getElementById('customer-datalist');
    if (!dl) return;
    const byName  = customers.map(c => `<option value="${escapeHtml(c.name)}">`).join('');
    const byPhone = customers.filter(c => c.phone)
        .map(c => `<option value="${escapeHtml(c.phone)}">${escapeHtml(c.name)}</option>`).join('');
    dl.innerHTML = byName + byPhone;
}

async function loadOrders() {
    statusMsg.textContent = '載入訂單中…';

    const [{ data, error }, { data: customerData, error: customerError }] = await Promise.all([
        sb.from('orders')
            .select('*, customers(name,phone,address), order_items(*)')
            .order('created_at', { ascending: false })
            .limit(500),
        sb.from('customers').select('name,phone').order('name', { ascending: true }),
    ]);

    if (error) {
        statusMsg.textContent = '';
        resultsContainer.innerHTML = `<p class="text-red-600">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    if (customerError) console.error(customerError);

    renderCustomerDatalist(customerData || []);

    allOrders = data || [];
    statusMsg.textContent = `共 ${allOrders.length} 筆訂單（最多顯示近 500 筆）`;
    renderResults(allOrders);
}

function renderResults(orders) {
    if (!orders.length) {
        resultsContainer.innerHTML = `<p class="text-gray-400 text-center py-10">沒有符合的訂單</p>`;
        return;
    }

    resultsContainer.innerHTML = orders.map(o => {
        const items = o.order_items || [];
        const itemsSummary = items.map(it => {
            const variant = [it.spec, it.bore, it.color].filter(Boolean).join('/');
            const name = it.product_name_zh || it.product_erp_code || '';
            return `${escapeHtml(name)}${variant ? '（' + escapeHtml(variant) + '）' : ''} x${it.quantity}`;
        }).join('、');

        return `
        <div class="bg-white border rounded-lg p-4 mb-3">
            <div class="flex justify-between items-start flex-wrap gap-2">
                <div>
                    <p class="font-bold text-blue-700">${escapeHtml(o.order_no || '')}</p>
                    <p class="text-sm text-gray-500">${new Date(o.created_at).toLocaleString('zh-TW')}</p>
                    <p class="text-sm text-gray-700 mt-1">
                        客戶：${escapeHtml(o.customers && o.customers.name || '（未知）')}
                        ${o.customers && o.customers.phone ? '　' + escapeHtml(o.customers.phone) : ''}
                    </p>
                </div>
                <button data-id="${o.id}" class="pdf-btn px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100">下載 PDF</button>
            </div>
            <p class="text-sm text-gray-600 mt-2">${itemsSummary || '（無商品明細）'}</p>
        </div>`;
    }).join('');

    resultsContainer.querySelectorAll('.pdf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = allOrders.find(o => String(o.id) === btn.dataset.id);
            generateOrderPdf(order, order.customers, order.order_items || []);
        });
    });
}

document.getElementById('search-btn').addEventListener('click', () => {
    const orderNo   = document.getElementById('q-order-no').value.trim().toLowerCase();
    const customerQ = document.getElementById('q-customer').value.trim().toLowerCase();
    const productQ  = document.getElementById('q-product').value.trim().toLowerCase();
    const dateFrom  = document.getElementById('q-date-from').value;
    const dateTo    = document.getElementById('q-date-to').value;

    const filtered = allOrders.filter(o => {
        if (orderNo && !String(o.order_no || '').toLowerCase().includes(orderNo)) return false;

        if (customerQ) {
            const name = String(o.customers && o.customers.name || '').toLowerCase();
            const phone = String(o.customers && o.customers.phone || '').toLowerCase();
            if (!name.includes(customerQ) && !phone.includes(customerQ)) return false;
        }

        if (productQ) {
            const items = o.order_items || [];
            const hit = items.some(it =>
                String(it.product_erp_code || '').toLowerCase().includes(productQ) ||
                String(it.product_name_zh || '').toLowerCase().includes(productQ)
            );
            if (!hit) return false;
        }

        const orderDate = o.created_at ? o.created_at.slice(0, 10) : '';
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo && orderDate > dateTo) return false;

        return true;
    });

    renderResults(filtered);
});

document.getElementById('reset-btn').addEventListener('click', () => {
    ['q-order-no', 'q-customer', 'q-product', 'q-date-from', 'q-date-to'].forEach(id => {
        document.getElementById(id).value = '';
    });
    renderResults(allOrders);
});

initAdminAuth('orders', loadOrders);
