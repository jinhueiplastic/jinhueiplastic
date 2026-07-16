let products = [];
let customers = [];
let cart = [];
let cartCounter = 0;

// 瀏覽狀態：categories（分類卡片）→ products（該分類/搜尋結果的商品卡片）→ variant（選規格數量）
let browseMode = 'categories';
let browseCategory = null; // 目前瀏覽的分類名稱；搜尋結果時為 null
let browseItems = [];      // products 模式下要顯示的商品清單
let browseProduct = null;  // variant 模式下選中的商品

const customerSelect     = document.getElementById('customer-select');
const newCustomerToggle  = document.getElementById('new-customer-toggle');
const newCustomerPanel   = document.getElementById('new-customer-panel');
const customerInfo       = document.getElementById('customer-info');
const searchInput        = document.getElementById('product-search-input');
const backBtn            = document.getElementById('browse-back-btn');
const breadcrumb         = document.getElementById('browse-breadcrumb');
const browseArea         = document.getElementById('browse-area');
const cartContainer      = document.getElementById('cart-container');
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

    cart = [];
    browseMode = 'categories';
    browseCategory = null;
    renderBrowseArea();
    renderCart();
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

// ===== 商品瀏覽：目錄 → 商品圖片 → 規格 =====

function thumbOf(p) {
    return String((p && p.image_url) || '').split(',')[0].trim();
}

function groupProductsByCategory() {
    const groups = new Map();
    products.forEach(p => {
        const cat = (p.category_name_zh || '').trim() || '未分類';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(p);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
}

function productMatches(p, q) {
    const query = q.toLowerCase();
    return String(p.erp_code || '').toLowerCase().includes(query)
        || String(p.name_zh || '').toLowerCase().includes(query)
        || String(p.name_en || '').toLowerCase().includes(query);
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) {
        browseMode = 'categories';
        renderBrowseArea();
        return;
    }
    browseMode = 'products';
    browseCategory = null;
    browseItems = products.filter(p => productMatches(p, q));
    renderBrowseArea();
});

backBtn.addEventListener('click', () => {
    if (browseMode === 'variant') {
        browseMode = 'products';
    } else {
        browseMode = 'categories';
        searchInput.value = '';
    }
    renderBrowseArea();
});

function renderCategoryGridHtml() {
    const groups = groupProductsByCategory();
    if (!groups.length) return `<p class="text-gray-400 text-center py-10">目前沒有商品資料</p>`;
    return `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">` +
        groups.map(([cat, items]) => `
            <div class="category-card cursor-pointer" data-cat="${escapeHtml(cat)}">
                <div class="category-img-container">
                    <img src="${escapeHtml(thumbOf(items[0]))}" alt="${escapeHtml(cat)}" style="background:#f3f4f6;">
                </div>
                <div class="p-3 text-center bg-white border-t">
                    <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(cat)}</h4>
                    <p class="text-xs text-gray-400">${items.length} 項</p>
                </div>
            </div>`).join('') +
        `</div>`;
}

function renderProductGridHtml(items) {
    if (!items.length) return `<p class="text-gray-400 text-center py-10">沒有符合的商品</p>`;
    return `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">` +
        items.map(p => `
            <div class="category-card cursor-pointer" data-erp="${escapeHtml(p.erp_code)}">
                <div class="category-img-container">
                    <img src="${escapeHtml(thumbOf(p))}" alt="${escapeHtml(p.name_zh || '')}" style="background:#f3f4f6;">
                </div>
                <div class="p-3 text-center bg-white border-t">
                    <p class="text-xs text-blue-600 font-bold mb-0.5">${escapeHtml(p.erp_code || '')}</p>
                    <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(p.name_zh || '')}</h4>
                </div>
            </div>`).join('') +
        `</div>`;
}

function renderVariantPickerHtml(p) {
    return `
        <div class="flex gap-4 flex-col sm:flex-row">
            <img src="${escapeHtml(thumbOf(p))}" alt=""
                 style="width:140px;height:140px;object-fit:cover;flex-shrink:0;background:#f3f4f6;"
                 class="rounded-lg border">
            <div class="flex-1">
                <p class="text-xs text-blue-600 font-bold">${escapeHtml(p.erp_code || '')}</p>
                <h4 class="font-bold text-lg text-gray-800 mb-3">${escapeHtml(p.name_zh || '')}</h4>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                        <label class="field-label">規格</label>
                        <input type="text" id="variant-spec" class="field-input" list="variant-spec-list" placeholder="如有可選，或自行輸入">
                        <datalist id="variant-spec-list"></datalist>
                    </div>
                    <div>
                        <label class="field-label">孔徑</label>
                        <input type="text" id="variant-bore" class="field-input" list="variant-bore-list" placeholder="如有可選，或自行輸入">
                        <datalist id="variant-bore-list"></datalist>
                    </div>
                    <div>
                        <label class="field-label">顏色</label>
                        <input type="text" id="variant-color" class="field-input" list="variant-color-list" placeholder="如有可選，或自行輸入">
                        <datalist id="variant-color-list"></datalist>
                    </div>
                    <div>
                        <label class="field-label">數量</label>
                        <input type="number" id="variant-qty" class="field-input" min="1" value="1">
                    </div>
                </div>
                <button type="button" id="add-to-cart-btn" class="mt-4 px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
                    加入已選購商品
                </button>
            </div>
        </div>`;
}

function renderBrowseArea() {
    if (browseMode === 'categories') {
        backBtn.classList.add('hidden');
        breadcrumb.classList.add('hidden');
        browseArea.innerHTML = renderCategoryGridHtml();
        browseArea.querySelectorAll('[data-cat]').forEach(el => {
            el.addEventListener('click', () => {
                browseCategory = el.dataset.cat;
                browseItems = products.filter(p => (p.category_name_zh || '').trim() === browseCategory);
                browseMode = 'products';
                renderBrowseArea();
            });
        });
        return;
    }

    if (browseMode === 'products') {
        backBtn.classList.remove('hidden');
        breadcrumb.classList.remove('hidden');
        breadcrumb.textContent = browseCategory ? `分類：${browseCategory}` : `搜尋結果（${browseItems.length}）`;
        browseArea.innerHTML = renderProductGridHtml(browseItems);
        browseArea.querySelectorAll('[data-erp]').forEach(el => {
            el.addEventListener('click', () => {
                browseProduct = products.find(p => p.erp_code === el.dataset.erp);
                browseMode = 'variant';
                renderBrowseArea();
            });
        });
        return;
    }

    if (browseMode === 'variant' && browseProduct) {
        backBtn.classList.remove('hidden');
        breadcrumb.classList.remove('hidden');
        breadcrumb.textContent = (browseCategory ? `分類：${browseCategory}　` : '') + `商品：${browseProduct.name_zh || browseProduct.erp_code}`;
        browseArea.innerHTML = renderVariantPickerHtml(browseProduct);
        wireVariantPicker(browseProduct);
    }
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

function wireVariantPicker(p) {
    const opts = classifyOptions(p.desc_zh);
    document.getElementById('variant-spec-list').innerHTML  = opts.spec.map(v => `<option value="${escapeHtml(v)}">`).join('');
    document.getElementById('variant-bore-list').innerHTML  = opts.bore.map(v => `<option value="${escapeHtml(v)}">`).join('');
    document.getElementById('variant-color-list').innerHTML = opts.color.map(v => `<option value="${escapeHtml(v)}">`).join('');

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        const qty = Number(document.getElementById('variant-qty').value) || 1;
        cart.push({
            rowId: ++cartCounter,
            erp: p.erp_code,
            name_zh: p.name_zh,
            image_url: thumbOf(p),
            spec: document.getElementById('variant-spec').value.trim(),
            bore: document.getElementById('variant-bore').value.trim(),
            color: document.getElementById('variant-color').value.trim(),
            qty,
        });
        renderCart();

        // 加入後留在同一個商品的規格畫面，方便同一項商品連續加不同規格；
        // 要換商品的話可以按上面的「← 返回」。
        document.getElementById('variant-qty').value = 1;
        document.getElementById('variant-spec').value = '';
        document.getElementById('variant-bore').value = '';
        document.getElementById('variant-color').value = '';
    });
}

// ===== 已選購商品（購物車） =====

function renderCart() {
    if (!cart.length) {
        cartContainer.innerHTML = `<p class="text-gray-400 text-sm">尚未加入商品</p>`;
        return;
    }
    cartContainer.innerHTML = cart.map(item => {
        const variant = [item.spec, item.bore, item.color].filter(Boolean).join(' / ');
        return `
            <div class="flex items-center gap-3 bg-white border rounded-lg p-3 mb-2">
                <img src="${escapeHtml(item.image_url)}" alt="" class="product-thumb" style="width:48px;height:48px;">
                <div class="flex-1">
                    <p class="font-bold text-sm">${escapeHtml(item.name_zh || item.erp || '')}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(item.erp || '')}${variant ? '　' + escapeHtml(variant) : ''}　數量：${item.qty}</p>
                </div>
                <button type="button" data-row-id="${item.rowId}" class="cart-del-btn text-red-400 hover:text-red-600 text-sm">刪除</button>
            </div>`;
    }).join('');

    cartContainer.querySelectorAll('.cart-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            cart = cart.filter(item => item.rowId !== Number(btn.dataset.rowId));
            renderCart();
        });
    });
}

// ===== 儲存訂單 =====

saveOrderBtn.addEventListener('click', async () => {
    resultBanner.classList.add('hidden');

    const customerId = customerSelect.value;
    if (!customerId) { alert('請先選擇客戶'); return; }
    if (!cart.length) { alert('請至少加入一項商品'); return; }

    saveOrderBtn.disabled = true;
    saveOrderBtn.textContent = '儲存中…';

    try {
        const { data: order, error: orderErr } = await sb
            .from('orders')
            .insert({ customer_id: customerId })
            .select()
            .single();
        if (orderErr) throw orderErr;

        const itemsPayload = cart.map(item => ({
            order_id: order.id,
            product_erp_code: item.erp,
            product_name_zh: item.name_zh,
            product_image_url: item.image_url,
            spec: item.spec,
            bore: item.bore,
            color: item.color,
            quantity: item.qty,
        }));
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
            cart = [];
            renderCart();
            browseMode = 'categories';
            searchInput.value = '';
            renderBrowseArea();
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
