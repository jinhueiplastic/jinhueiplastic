let products = [];
let customers = [];
let rowCounter = 0;

const customerSelect     = document.getElementById('customer-select');
const newCustomerToggle  = document.getElementById('new-customer-toggle');
const newCustomerPanel   = document.getElementById('new-customer-panel');
const customerInfo       = document.getElementById('customer-info');
const rowsContainer      = document.getElementById('rows-container');
const resultBanner       = document.getElementById('result-banner');
const saveOrderBtn       = document.getElementById('save-order-btn');

async function initPos() {
    const [{ data: productData, error: pErr }, { data: customerData, error: cErr }] = await Promise.all([
        sb.from('products').select('*').order('category_name_zh', { ascending: true }),
        sb.from('customers').select('*').order('name', { ascending: true }),
    ]);
    if (pErr) console.error(pErr);
    if (cErr) console.error(cErr);
    products = productData || [];
    customers = customerData || [];
    renderCustomerOptions();
    rowsContainer.innerHTML = '';
    addRow();
}

function renderCustomerOptions() {
    customerSelect.innerHTML = '<option value="">請選擇客戶…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

customerSelect.addEventListener('change', () => {
    const c = customers.find(x => String(x.id) === customerSelect.value);
    customerInfo.textContent = c ? `地址：${c.address || '（無）'}　電話：${c.phone || '（無）'}` : '';
});

newCustomerToggle.addEventListener('click', () => {
    newCustomerPanel.classList.toggle('hidden');
});

document.getElementById('nc-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('nc-name').value.trim();
    if (!name) { alert('請輸入客戶名稱'); return; }
    const payload = {
        name,
        address: document.getElementById('nc-address').value.trim(),
        phone: document.getElementById('nc-phone').value.trim(),
    };
    const { data, error } = await sb.from('customers').insert(payload).select().single();
    if (error) { alert('新增客戶失敗：' + error.message); return; }

    customers.push(data);
    customers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    renderCustomerOptions();
    customerSelect.value = data.id;
    customerSelect.dispatchEvent(new Event('change'));
    newCustomerPanel.classList.add('hidden');
    ['nc-name', 'nc-address', 'nc-phone'].forEach(id => { document.getElementById(id).value = ''; });
});

function productOptionsHtml() {
    const groups = new Map();
    products.forEach(p => {
        const cat = p.category_name_zh || '未分類';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(p);
    });
    return [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))
        .map(([cat, items]) => `
            <optgroup label="${escapeHtml(cat)}">
                ${items.map(p => `<option value="${escapeHtml(p.erp_code)}">${escapeHtml(p.erp_code)} - ${escapeHtml(p.name_zh || '')}</option>`).join('')}
            </optgroup>`).join('');
}

// 解析商品說明欄位裡「所有」的 markdown 表格（不只第一個），
// 依表格標題關鍵字分類成規格/孔徑/顏色的建議選項。
function parseAllTables(text) {
    const lines = String(text || '').split('\n');
    const tables = [];
    const cellsOf = line => line.trim().split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.includes('|')) {
            const start = i;
            let end = i;
            while (end + 1 < lines.length && lines[end + 1].trim().startsWith('|')) end++;
            const blockLines = lines.slice(start, end + 1);
            const headers = cellsOf(blockLines[0]);
            const dataLines = blockLines.slice(1).filter(l => !/^[|:\s-]+$/.test(l.trim()));
            tables.push({ headers, rows: dataLines.map(cellsOf) });
            i = end + 1;
        } else {
            i++;
        }
    }
    return tables;
}

function classifyOptions(text) {
    const result = { spec: [], bore: [], color: [] };
    parseAllTables(text).forEach(t => {
        const headerText = t.headers.join('');
        const values = [...new Set(t.rows.map(r => r[0]).filter(Boolean))];
        if (!values.length) return;
        if (/孔|徑/.test(headerText)) result.bore.push(...values);
        else if (/色/.test(headerText)) result.color.push(...values);
        else result.spec.push(...values);
    });
    return result;
}

function addRow() {
    const rowId = ++rowCounter;
    const div = document.createElement('div');
    div.className = 'pos-row border rounded-lg p-3 mb-3 bg-white flex gap-3 items-start';
    div.dataset.rowId = rowId;
    div.innerHTML = `
        <img class="product-thumb row-thumb" style="width:56px;height:56px;flex-shrink:0;" src="" alt="">
        <div class="flex-1 grid grid-cols-2 md:grid-cols-6 gap-2">
            <div class="col-span-2 md:col-span-2">
                <label class="field-label">商品</label>
                <select class="field-input product-select">
                    <option value="">請選擇商品…</option>
                    ${productOptionsHtml()}
                </select>
            </div>
            <div>
                <label class="field-label">規格</label>
                <input type="text" class="field-input spec-input" list="spec-list-${rowId}" placeholder="如有可選，或自行輸入">
                <datalist id="spec-list-${rowId}"></datalist>
            </div>
            <div>
                <label class="field-label">孔徑</label>
                <input type="text" class="field-input bore-input" list="bore-list-${rowId}" placeholder="如有可選，或自行輸入">
                <datalist id="bore-list-${rowId}"></datalist>
            </div>
            <div>
                <label class="field-label">顏色</label>
                <input type="text" class="field-input color-input" list="color-list-${rowId}" placeholder="如有可選，或自行輸入">
                <datalist id="color-list-${rowId}"></datalist>
            </div>
            <div>
                <label class="field-label">數量</label>
                <input type="number" class="field-input qty-input" min="1" value="1">
            </div>
        </div>
        <button type="button" class="row-del-btn text-red-400 hover:text-red-600 text-sm mt-5">刪除</button>
    `;
    rowsContainer.appendChild(div);

    const select    = div.querySelector('.product-select');
    const thumb     = div.querySelector('.row-thumb');
    const specList  = div.querySelector(`#spec-list-${rowId}`);
    const boreList  = div.querySelector(`#bore-list-${rowId}`);
    const colorList = div.querySelector(`#color-list-${rowId}`);

    select.addEventListener('change', () => {
        const p = products.find(x => x.erp_code === select.value);
        thumb.src = p ? String(p.image_url || '').split(',')[0].trim() : '';
        const opts = p ? classifyOptions(p.desc_zh) : { spec: [], bore: [], color: [] };
        specList.innerHTML  = opts.spec.map(v => `<option value="${escapeHtml(v)}">`).join('');
        boreList.innerHTML  = opts.bore.map(v => `<option value="${escapeHtml(v)}">`).join('');
        colorList.innerHTML = opts.color.map(v => `<option value="${escapeHtml(v)}">`).join('');
    });

    div.querySelector('.row-del-btn').addEventListener('click', () => {
        div.remove();
    });
}

document.getElementById('add-row-btn').addEventListener('click', addRow);

saveOrderBtn.addEventListener('click', async () => {
    resultBanner.classList.add('hidden');

    const customerId = customerSelect.value;
    if (!customerId) { alert('請先選擇客戶'); return; }

    const rowEls = [...rowsContainer.querySelectorAll('.pos-row')];
    const items = rowEls.map(div => {
        const erp = div.querySelector('.product-select').value;
        if (!erp) return null;
        const p = products.find(x => x.erp_code === erp);
        return {
            product_erp_code: erp,
            product_name_zh: p ? p.name_zh : erp,
            product_image_url: p ? String(p.image_url || '').split(',')[0].trim() : '',
            spec: div.querySelector('.spec-input').value.trim(),
            bore: div.querySelector('.bore-input').value.trim(),
            color: div.querySelector('.color-input').value.trim(),
            quantity: Number(div.querySelector('.qty-input').value) || 1,
        };
    }).filter(Boolean);

    if (!items.length) { alert('請至少新增一項商品'); return; }

    saveOrderBtn.disabled = true;
    saveOrderBtn.textContent = '儲存中…';

    try {
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .insert({ customer_id: customerId })
            .select()
            .single();
        if (orderErr) throw orderErr;

        const itemsPayload = items.map(it => ({ ...it, order_id: order.id }));
        const { error: itemsErr } = await sb.from('order_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        const customer = customers.find(c => String(c.id) === String(customerId));
        resultBanner.classList.remove('hidden');
        resultBanner.innerHTML = `
            ✅ 訂單已儲存，訂單編號：<strong>${escapeHtml(order.order_no)}</strong>
            <button id="download-pdf-btn" class="ml-3 px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700">下載出貨單 PDF</button>
            <button id="new-order-btn" class="ml-2 px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100">建立下一張訂單</button>
        `;
        document.getElementById('download-pdf-btn').addEventListener('click', () => {
            generateOrderPdf(order, customer, itemsPayload);
        });
        document.getElementById('new-order-btn').addEventListener('click', () => {
            resultBanner.classList.add('hidden');
            rowsContainer.innerHTML = '';
            addRow();
            customerSelect.value = '';
            customerInfo.textContent = '';
        });
    } catch (e) {
        alert('儲存失敗：' + e.message);
    } finally {
        saveOrderBtn.disabled = false;
        saveOrderBtn.textContent = '儲存訂單並出單';
    }
});

initAdminAuth('pos', initPos);
