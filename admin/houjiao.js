/* 「打腳通知」：一個獨立的虛擬商品（不像 POS 商品有分類、有一堆各自的規格），只有一份
   規格軸／完整組合資料（houjiao_variants），用法完全比照「修改 POS 商品」的軸/組合編輯；
   選規格→送出，存成一筆通知紀錄（houjiao_notifications），類似訂單、但沒有客戶/金額。

   下面故意分成兩份各自獨立的狀態：
   - 編輯區（localVariantRows 等，port 自 admin.js）：只在打開「編輯規格」的彈窗時才從
     Supabase 重新整理一份，彈窗裡的暫存修改在按「儲存」之前完全不會影響下面的選規格畫面。
   - 選規格區（pickerAxisOptions/pickerCombos 等，port 自 pos.js）：頁面一開始、以及每次
     編輯完儲存之後才重新整理，永遠只顯示「已經存檔」的資料。
   這樣兩邊雖然同一頁，行為上還是跟 admin.js／pos.js 分開兩個頁面時一樣，不會互相干擾。 */

let modalDirty = false;
let boxModalDirty = false;
// 「編輯接線盒規格」彈窗裡，目前正在編輯第幾個接線盒的圖片（1 = 預設圖，跟 image_url 一樣；
// 2 以上是額外的 image_urls_by_slot 覆蓋）。只有接線盒規格用得到，架構那邊沒有這個概念。
let currentBoxImageSlot = 1;

// 上傳／選用已上傳／移除圖片，都要看目前是在編輯第幾個接線盒：第 1 個直接讀寫 image_url
// （預設圖），第 2 個以後改讀寫 image_urls_by_slot 底下對應那個位置編號的欄位。
function setBoxRowImageForSlot(row, url) {
    if (currentBoxImageSlot > 1) {
        row.image_urls_by_slot = row.image_urls_by_slot || {};
        row.image_urls_by_slot[String(currentBoxImageSlot)] = url;
    } else {
        row.image_url = url;
    }
}

function clearBoxRowImageForSlot(row) {
    if (currentBoxImageSlot > 1) {
        if (row.image_urls_by_slot) delete row.image_urls_by_slot[String(currentBoxImageSlot)];
    } else {
        row.image_url = null;
    }
}

/* ===================== 編輯區：架構的軸／完整組合（port 自 admin.js） ===================== */

let variantTempCounter = 0;
let localVariantRows = [];
let deletedVariantIds = [];
let lastComboDisableIndex = null;
let comboSortSnapshot = null;

function stripWrappingBrackets(v) {
    const pairs = { '（': '）', '(': ')', '「': '」', '『': '』' };
    const first = v[0];
    const last = v[v.length - 1];
    if (v.length >= 2 && pairs[first] === last) {
        const inner = v.slice(1, -1);
        const opens = (inner.match(/[（(「『]/g) || []).length;
        const closes = (inner.match(/[）)」』]/g) || []).length;
        if (opens === closes) return inner.trim();
    }
    return v;
}

function splitBulkValues(text) {
    return text.split(/[/、,，]/)
        .map(v => stripWrappingBrackets(v.trim()).trim())
        .filter(Boolean);
}

function rowAxisEntries(row) {
    return Object.entries(row.axis_values || {}).filter(([, v]) => v);
}

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
    Object.keys(axisOptions).forEach(name => {
        axisOptions[name].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    return { axisOptions, combos };
}

const AXIS_BAND = 100000;

function renumberVariantSortOrders(axisNamesInOrder, axisOptionsMap) {
    axisNamesInOrder.forEach((name, axisIdx) => {
        (axisOptionsMap[name] || []).forEach((r, optIdx) => {
            r.sort_order = axisIdx * AXIS_BAND + (optIdx + 1) * 10;
        });
    });
}

function currentAxisNamesInOrder(axisOptions) {
    return Object.keys(axisOptions).sort((a, b) => {
        const rowsA = axisOptions[a], rowsB = axisOptions[b];
        const orderA = rowsA.length ? Math.min(...rowsA.map(r => r.sort_order || 0)) : 0;
        const orderB = rowsB.length ? Math.min(...rowsB.map(r => r.sort_order || 0)) : 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b, 'zh-Hant');
    });
}

function moveAxisGroup(name, direction) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);
    const idx = axisNames.indexOf(name);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= axisNames.length) return;

    [axisNames[idx], axisNames[swapIdx]] = [axisNames[swapIdx], axisNames[idx]];
    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

function renameAxis(oldName) {
    const newName = prompt(`把「${oldName}」改名成？`, oldName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

    const { axisOptions } = categorizeVariantRows(localVariantRows);
    if (axisOptions[trimmed]) {
        alert(`已經有「${trimmed}」這個軸了，換一個名字，或是先刪掉其中一個再改名。`);
        return;
    }

    localVariantRows.forEach(row => {
        if (!(oldName in row.axis_values)) return;
        const value = row.axis_values[oldName];
        const newValues = { ...row.axis_values };
        delete newValues[oldName];
        newValues[trimmed] = value;

        if (row.id) deletedVariantIds.push(row.id);
        row.id = null;
        row.axis_values = newValues;
    });

    modalDirty = true;
    renderVariantSection();
}

function editAxisOptionValue(name, tempId) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const row = rows.find(r => r.tempId === tempId);
    if (!row) return;

    const currentValue = row.axis_values[name];
    const raw = prompt(`把「${currentValue}」改成？`, currentValue);
    if (raw === null) return;
    const trimmed = stripWrappingBrackets(raw.trim()).trim();
    if (!trimmed || trimmed === currentValue) return;

    if (rows.some(r => r.tempId !== tempId && r.axis_values[name] === trimmed)) {
        alert(`「${name}」已經有「${trimmed}」這個選項了，換一個值，或是先刪掉其中一個再改。`);
        return;
    }

    localVariantRows.forEach(r => {
        if (!(name in r.axis_values) || r.axis_values[name] !== currentValue) return;
        const newValues = { ...r.axis_values, [name]: trimmed };

        if (r.id) deletedVariantIds.push(r.id);
        r.id = null;
        r.axis_values = newValues;
    });

    modalDirty = true;
    renderVariantSection();
}

function moveAxisOption(name, tempId, direction) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const idx = rows.findIndex(r => r.tempId === tempId);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return;

    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];
    const axisNames = currentAxisNamesInOrder(axisOptions);
    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

function insertAxisOptionAt(name, tempId, position) {
    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const rows = axisOptions[name] || [];
    const idx = rows.findIndex(r => r.tempId === tempId);
    if (idx === -1) return;

    const raw = prompt(`要在「${rows[idx].axis_values[name]}」${position === 'before' ? '前面' : '後面'}插入什麼值？（可以用 / 、 , ， 一次加多個）`);
    if (!raw) return;
    const values = splitBulkValues(raw);
    if (!values.length) return;

    const existingSet = new Set(rows.map(r => r.axis_values[name]));
    const newValues = values.filter(v => !existingSet.has(v));
    if (!newValues.length) return;

    const axisNames = currentAxisNamesInOrder(axisOptions);

    const newRows = newValues.map(v => ({
        tempId: ++variantTempCounter,
        id: null,
        axis_values: { [name]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
    }));

    const insertAt = position === 'before' ? idx : idx + 1;
    axisOptions[name] = [...rows.slice(0, insertAt), ...newRows, ...rows.slice(insertAt)];
    localVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

async function loadEditorSection() {
    deletedVariantIds = [];
    lastComboDisableIndex = null;
    document.getElementById('variant-combo-list').innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    // Supabase/PostgREST 一次查詢預設最多只回傳 1000 筆，6 個軸、每軸 2~9 個選項疊出來的
    // 完整組合數量很容易超過，只查一次會漏掉排在後面的資料——用 fetchAllRows 分頁抓齊。
    // 加上 id 當第二個排序依據：完整組合的 sort_order 全部都是 0，資料庫對「平手」的列
    // 不保證每次查詢順序都一樣，分頁查詢時可能漏掉夾在中間的某幾頁。
    const { data, error } = await fetchAllRows(() => sb.from('houjiao_variants').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }));
    if (error) {
        document.getElementById('variant-combo-list').innerHTML = `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    localVariantRows = (data || []).map(r => ({ ...r, axis_values: r.axis_values || {}, tempId: ++variantTempCounter }));

    comboSortSnapshot = new Map();
    localVariantRows.forEach(r => {
        if (Object.keys(r.axis_values).length >= 2) {
            comboSortSnapshot.set(comboKeyOf(r.axis_values), !!r.is_disabled);
        }
    });

    renderVariantSection();
}

// 「選用已上傳的圖片」：不用每次都重新選檔案上傳，同一個編輯彈窗裡（架構或接線盒規格，
// 各自的軸選項＋完整組合）只要有任何一筆已經有圖，都可以直接挑來重複用在別的選項/組合上。
function distinctImageUrls(rows) {
    const seen = new Set();
    const urls = [];
    const add = (url) => {
        if (url && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
        }
    };
    rows.forEach(r => {
        add(r.image_url);
        // 接線盒規格才會有 image_urls_by_slot／image_urls_by_context（每個接線盒位置、或
        // 「架構＋規格＋位置」各自的圖），架構的軸/組合沒有這些欄位，這裡順便一起列出來，
        // 選圖的時候不用分是不是某個位置專屬的。
        if (r.image_urls_by_slot) {
            Object.values(r.image_urls_by_slot).forEach(add);
        }
        if (r.image_urls_by_context) {
            Object.values(r.image_urls_by_context).forEach(add);
        }
    });
    return urls;
}

// 回傳 Promise<string|null>：選了就 resolve 那張圖的網址，取消就 resolve null。
function promptPickExistingImage(rows) {
    return new Promise(resolve => {
        const urls = distinctImageUrls(rows);
        if (!urls.length) {
            alert('目前這裡還沒有任何已上傳的圖片可以選，請先用「上傳圖片」上傳至少一張。');
            resolve(null);
            return;
        }

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:8px;padding:16px;max-width:32rem;width:100%;max-height:80vh;overflow-y:auto;';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <h3 style="font-weight:700;font-size:14px;">選用已上傳的圖片</h3>
                <button type="button" class="picker-cancel-btn" style="font-size:12px;color:#6b7280;cursor:pointer;">取消</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;">
                ${urls.map(u => `
                <button type="button" class="picker-thumb-btn" data-url="${escapeHtml(u)}"
                        style="border:1px solid #e5e7eb;border-radius:6px;padding:2px;cursor:pointer;background:#fff;">
                    <img src="${escapeHtml(u)}" style="width:100%;aspect-ratio:1;object-fit:contain;display:block;">
                </button>`).join('')}
            </div>`;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        function close(result) {
            document.body.removeChild(overlay);
            resolve(result);
        }
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        panel.querySelector('.picker-cancel-btn').addEventListener('click', () => close(null));
        panel.querySelectorAll('.picker-thumb-btn').forEach(btn => {
            btn.addEventListener('click', () => close(btn.dataset.url));
        });
    });
}

// imageSlot 只有接線盒規格會傳（1、2、3…），架構呼叫這個函式時不會傳，維持原本
// 「只有一張預設圖」的行為。imageSlot 是 1（或沒傳）代表在編輯「預設圖」，直接讀寫
// image_url；imageSlot 大於 1 代表在編輯「這個接線盒位置專屬的圖」（image_urls_by_slot），
// 沒有專屬圖的話 thumb 顯示退回的預設圖、並標示「沿用預設圖」，也不會顯示可移除。
function axisChipHtml(r, name, isFirst, isLast, imageSlot) {
    const rawValue = r.axis_values[name];
    const splitCount = splitBulkValues(rawValue).length;
    const isOverrideSlot = !!imageSlot && imageSlot > 1;
    const hasOwnSlotImage = isOverrideSlot ? !!(r.image_urls_by_slot && r.image_urls_by_slot[String(imageSlot)]) : !!r.image_url;
    const effectiveUrl = isOverrideSlot ? slotAwareImageUrl(r, imageSlot) : (r.image_url || '');
    const showRemove = isOverrideSlot ? hasOwnSlotImage : !!r.image_url;
    return `
        <div class="flex items-center gap-2 border rounded-lg p-2" data-temp-id="${r.tempId}" data-axis-name="${escapeHtml(name)}">
            <div class="flex flex-col gap-0.5">
                <button type="button" class="axis-move-up-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${isFirst ? 'opacity-30 pointer-events-none' : ''}" title="上移">▲</button>
                <button type="button" class="axis-move-down-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${isLast ? 'opacity-30 pointer-events-none' : ''}" title="下移">▼</button>
            </div>
            <img src="${escapeHtml(effectiveUrl)}" alt="" class="product-thumb axis-option-thumb" style="width:32px;height:32px;">
            <button type="button" class="axis-value-edit-btn flex-1 text-sm text-left hover:underline hover:text-blue-600" title="點一下改這個選項的值">${escapeHtml(rawValue)} ✎</button>
            ${isOverrideSlot && !hasOwnSlotImage ? '<span class="text-xs text-gray-400 whitespace-nowrap">（沿用預設圖）</span>' : ''}
            <span class="axis-upload-status text-xs text-gray-400"></span>
            <button type="button" class="axis-insert-before-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="在這個之前插入新選項">＋前</button>
            <button type="button" class="axis-insert-after-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="在這個之後插入新選項">＋後</button>
            <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                上傳圖片
                <input type="file" accept="image/*" class="hidden axis-upload-input">
            </label>
            <button type="button" class="axis-pick-existing-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap">選用已上傳</button>
            ${showRemove ? `<button type="button" class="axis-image-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
            ${splitCount > 1 ? `<button type="button" class="axis-chip-split px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" title="分割成 ${splitCount} 個選項">⇥ 分割</button>` : ''}
            <button type="button" class="axis-chip-del px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap" title="刪除選項">刪除</button>
        </div>`;
}

function wireAxisChips(scopeEl) {
    scopeEl.querySelectorAll('.axis-value-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            editAxisOptionValue(rowEl.dataset.axisName, Number(rowEl.dataset.tempId));
        });
    });

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

    scopeEl.querySelectorAll('.axis-move-up-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            moveAxisOption(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), -1);
        });
    });
    scopeEl.querySelectorAll('.axis-move-down-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            moveAxisOption(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 1);
        });
    });
    scopeEl.querySelectorAll('.axis-insert-before-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            insertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'before');
        });
    });
    scopeEl.querySelectorAll('.axis-insert-after-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            insertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'after');
        });
    });

    scopeEl.querySelectorAll('.axis-pick-existing-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tempId = Number(btn.closest('[data-temp-id]').dataset.tempId);
            const row = localVariantRows.find(r => r.tempId === tempId);
            if (!row) return;
            const url = await promptPickExistingImage(localVariantRows);
            if (!url) return;
            row.image_url = url;
            modalDirty = true;
            renderVariantSection();
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
    const axisNames = currentAxisNamesInOrder(axisOptions);

    const groupsEl = document.getElementById('axis-groups');
    if (!axisNames.length) {
        groupsEl.innerHTML = '<p class="text-xs text-gray-400">還沒有任何規格，在下面新增第一個軸吧（例如「規格」）。</p>';
    } else {
        groupsEl.innerHTML = axisNames.map((name, axisIdx) => `
            <div>
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1">
                        <button type="button" class="axis-group-move-up-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${axisIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" data-axis-name="${escapeHtml(name)}" title="整個軸上移">▲</button>
                        <button type="button" class="axis-group-move-down-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${axisIdx === axisNames.length - 1 ? 'opacity-30 pointer-events-none' : ''}" data-axis-name="${escapeHtml(name)}" title="整個軸下移">▼</button>
                        <button type="button" class="axis-rename-btn field-label mb-0 hover:underline hover:text-blue-600" data-axis-name="${escapeHtml(name)}" title="點一下改軸名稱">${escapeHtml(name)} ✎</button>
                    </div>
                    <button type="button" class="axis-delete-all-btn text-xs text-red-600 hover:underline" data-axis-name="${escapeHtml(name)}">刪除整個軸</button>
                </div>
                <div class="space-y-1">${axisOptions[name].map((r, i) => axisChipHtml(r, name, i === 0, i === axisOptions[name].length - 1)).join('')}</div>
            </div>`).join('');
    }
    wireAxisChips(groupsEl);

    groupsEl.querySelectorAll('.axis-group-move-up-btn').forEach(btn => {
        btn.addEventListener('click', () => moveAxisGroup(btn.dataset.axisName, -1));
    });
    groupsEl.querySelectorAll('.axis-group-move-down-btn').forEach(btn => {
        btn.addEventListener('click', () => moveAxisGroup(btn.dataset.axisName, 1));
    });
    groupsEl.querySelectorAll('.axis-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => renameAxis(btn.dataset.axisName));
    });

    groupsEl.querySelectorAll('.axis-delete-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.axisName;
            const rows = (axisOptions[name] || []);
            if (!confirm(`確定要刪除「${name}」這整個軸嗎？底下 ${rows.length} 個選項都會一起刪掉。`)) return;
            rows.forEach(r => {
                if (r.id) deletedVariantIds.push(r.id);
            });
            const tempIds = new Set(rows.map(r => r.tempId));
            localVariantRows = localVariantRows.filter(r => !tempIds.has(r.tempId));
            modalDirty = true;
            renderVariantSection();
        });
    });

    renderComboList(combos, axisOptions, axisNames);
    renderComboBuilder(axisOptions);
}

function removeVariantRow(tempId) {
    const row = localVariantRows.find(r => r.tempId === tempId);
    if (!row) return;
    if (row.id) deletedVariantIds.push(row.id);
    localVariantRows = localVariantRows.filter(r => r.tempId !== tempId);
    modalDirty = true;
    renderVariantSection();
}

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
    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName);

    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newRows = [];
    values.filter(v => !existing.has(v)).forEach(v => {
        newRows.push({
            tempId: ++variantTempCounter,
            id: null,
            axis_values: { [axisName]: v },
            image_url: null,
            sort_order: 0,
        });
    });
    axisOptions[axisName] = [...existingRows, ...newRows];
    localVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    renderVariantSection();
}

function comboKeyOf(values) {
    return Object.keys(values).sort().map(k => `${k}${values[k]}`).join('');
}

const COMBO_GRID_MAX_AXES = 4;
const COMBO_GRID_MAX_TOTAL = 1000;

function renderComboList(combos, axisOptions, axisNames) {
    const container = document.getElementById('variant-combo-list');

    const comboByKey = {};
    combos.forEach(c => { comboByKey[comboKeyOf(c.axis_values)] = c; });

    const cells = [];
    const matchedKeys = new Set();
    let anyDisabledInGrid = false;

    const totalGridCombos = axisNames.length >= 2
        ? axisNames.reduce((acc, name) => acc * axisOptions[name].length, 1)
        : 0;

    if (axisNames.length >= 2 && axisNames.length <= COMBO_GRID_MAX_AXES && totalGridCombos <= COMBO_GRID_MAX_TOTAL) {
        let gridCombos = [{}];
        axisNames.forEach(name => {
            const next = [];
            gridCombos.forEach(c => {
                axisOptions[name].forEach(r => next.push({ ...c, [name]: r.axis_values[name] }));
            });
            gridCombos = next;
        });

        anyDisabledInGrid = gridCombos.some(values => {
            const c = comboByKey[comboKeyOf(values)];
            return c && c.is_disabled;
        });

        gridCombos.forEach(values => {
            const key = comboKeyOf(values);
            let existing = comboByKey[key] || null;
            if (!existing && anyDisabledInGrid) {
                existing = {
                    tempId: ++variantTempCounter,
                    id: null,
                    axis_values: values,
                    image_url: null,
                    sort_order: 0,
                    is_disabled: false,
                };
                localVariantRows.push(existing);
                comboByKey[key] = existing;
            }
            if (existing) matchedKeys.add(key);
            cells.push({ values, existing, isGridCell: true, label: axisNames.map(n => values[n]).join('　') });
        });
    }

    combos.filter(c => !matchedKeys.has(comboKeyOf(c.axis_values))).forEach(r => {
        cells.push({ values: r.axis_values, existing: r, isGridCell: false, label: rowAxisEntries(r).map(([k, v]) => `${k}：${v}`).join('　') });
    });

    function deleteCell(cell) {
        if (cell.isGridCell && anyDisabledInGrid && cell.existing && !cell.existing.is_disabled) {
            cell.existing.is_disabled = true;
            modalDirty = true;
            renderVariantSection();
            return;
        }
        removeVariantRow(cell.existing.tempId);
    }

    function applyComboDisable(targetCells, checked) {
        const toRemoveIds = [];
        targetCells.forEach(c => {
            if (c.existing) {
                c.existing.is_disabled = checked;
                if (!checked && !c.existing.image_url) {
                    toRemoveIds.push(c.existing.tempId);
                }
            } else if (checked) {
                const row = {
                    tempId: ++variantTempCounter,
                    id: null,
                    axis_values: c.values,
                    image_url: null,
                    is_disabled: true,
                    sort_order: 0,
                };
                localVariantRows.push(row);
                c.existing = row;
            }
        });
        if (toRemoveIds.length) {
            const idSet = new Set(toRemoveIds);
            localVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) deletedVariantIds.push(r.id); });
            localVariantRows = localVariantRows.filter(r => !idSet.has(r.tempId));
        }
        modalDirty = true;
        renderVariantSection();
    }

    if (comboSortSnapshot) {
        cells.sort((a, b) => {
            const disabledA = a.existing ? comboSortSnapshot.get(comboKeyOf(a.values)) : undefined;
            const disabledB = b.existing ? comboSortSnapshot.get(comboKeyOf(b.values)) : undefined;
            return Number(!!disabledA) - Number(!!disabledB);
        });
    }

    if (!cells.length) {
        container.innerHTML = axisNames.length < 2
            ? '<p class="text-xs text-gray-400">至少要有兩個軸都新增過選項，才會自動列出組合；也可以用下面「手動新增一筆完整組合」直接建立。</p>'
            : '<p class="text-xs text-gray-400">目前沒有完整組合。</p>';
        return;
    }

    const hasAnyExisting = cells.some(c => c.existing);

    const bulkBarHtml = hasAnyExisting ? `
        <div id="combo-bulk-bar" class="flex items-center gap-2 mb-2 pb-2 border-b">
            <label class="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" id="combo-select-all">
                全選
            </label>
            <button type="button" id="combo-delete-selected-btn" class="px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50" disabled>刪除已選取的組合</button>
        </div>` : '';

    container.innerHTML = bulkBarHtml + cells.map((cell, i) => {
        const existing = cell.existing;
        const isDisabled = !!(existing && existing.is_disabled);
        return `
            <div class="flex items-center gap-3 border rounded-lg p-2 ${isDisabled ? 'bg-red-50 border-red-200' : ''}" data-cell-idx="${i}">
                <input type="checkbox" class="combo-select-checkbox" ${existing ? '' : 'disabled title="這筆組合還沒有建立資料，不需要選取/刪除"'}>
                <img src="${escapeHtml(existing ? existing.image_url || '' : '')}" alt="" class="product-thumb combo-thumb" style="width:40px;height:40px;">
                <div class="flex-1 text-sm ${isDisabled ? 'line-through text-gray-400' : ''}">${escapeHtml(cell.label)}</div>
                <label class="flex items-center gap-1 text-xs text-red-600 whitespace-nowrap">
                    <input type="checkbox" class="combo-disable-checkbox" ${isDisabled ? 'checked' : ''}>
                    停用（不能選）
                </label>
                <span class="combo-upload-status text-xs text-gray-400"></span>
                ${isDisabled ? '' : `
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden combo-upload-input">
                </label>
                <button type="button" class="combo-pick-existing-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap">選用已上傳</button>`}
                ${!isDisabled && existing && existing.image_url ? `<button type="button" class="combo-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
                ${existing ? `<button type="button" class="combo-delete-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">刪除組合</button>` : ''}
            </div>`;
    }).join('');

    if (hasAnyExisting) {
        const selectAllCb = document.getElementById('combo-select-all');
        const deleteSelectedBtn = document.getElementById('combo-delete-selected-btn');
        const itemCheckboxes = () => Array.from(container.querySelectorAll('.combo-select-checkbox'));

        function refreshBulkButtons() {
            const anyChecked = itemCheckboxes().some(cb => cb.checked);
            deleteSelectedBtn.disabled = !anyChecked;
        }

        selectAllCb.addEventListener('change', () => {
            itemCheckboxes().forEach(cb => { cb.checked = selectAllCb.checked; });
            refreshBulkButtons();
        });

        itemCheckboxes().forEach(cb => {
            cb.addEventListener('change', () => {
                if (!cb.checked) selectAllCb.checked = false;
                else if (itemCheckboxes().every(c => c.checked)) selectAllCb.checked = true;
                refreshBulkButtons();
            });
        });

        deleteSelectedBtn.addEventListener('click', () => {
            const selectedCells = [];
            container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
                const cb = rowEl.querySelector('.combo-select-checkbox');
                if (cb && cb.checked) {
                    const cell = cells[Number(rowEl.dataset.cellIdx)];
                    if (cell.existing) selectedCells.push(cell);
                }
            });
            if (!selectedCells.length) return;

            const selectedTempIdSet = new Set(selectedCells.map(c => c.existing.tempId));
            const survivingDisabledInGrid = cells.some(
                c => c.isGridCell && c.existing && c.existing.is_disabled && !selectedTempIdSet.has(c.existing.tempId)
            );

            const toDisableCount = survivingDisabledInGrid
                ? selectedCells.filter(c => c.isGridCell && anyDisabledInGrid && !c.existing.is_disabled).length
                : 0;
            let msg = `確定要處理選取的 ${selectedCells.length} 筆組合嗎？`;
            if (toDisableCount) {
                msg += `\n其中 ${toDisableCount} 筆是表格自動列出的可選組合，這種格子刪了會被自動補回來，所以會改成標記「停用（不能選）」。`;
            }
            if (!confirm(msg)) return;

            const removeTempIds = [];
            selectedCells.forEach(cell => {
                if (survivingDisabledInGrid && cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled) {
                    cell.existing.is_disabled = true;
                } else {
                    removeTempIds.push(cell.existing.tempId);
                }
            });
            if (removeTempIds.length) {
                const idSet = new Set(removeTempIds);
                localVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) deletedVariantIds.push(r.id); });
                localVariantRows = localVariantRows.filter(r => !idSet.has(r.tempId));
            }
            modalDirty = true;
            renderVariantSection();
        });
    }

    container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
        const cell = cells[Number(rowEl.dataset.cellIdx)];

        const delBtn = rowEl.querySelector('.combo-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                const willJustDisable = cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled;
                const msg = willJustDisable
                    ? '這筆是表格自動列出的可選組合，刪了會被自動補回來，所以會改成標記「停用（不能選）」，確定嗎？'
                    : '確定要刪除這筆組合嗎？';
                if (!confirm(msg)) return;
                deleteCell(cell);
            });
        }

        const removeBtn = rowEl.querySelector('.combo-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (!confirm('確定要移除這張組合照片嗎？')) return;
                cell.existing.image_url = null;
                modalDirty = true;
                renderVariantSection();
            });
        }

        rowEl.querySelector('.combo-disable-checkbox').addEventListener('click', (e) => {
            const checked = e.target.checked;
            const cellIdx = Number(rowEl.dataset.cellIdx);

            let targets = [cell];
            if (e.shiftKey && lastComboDisableIndex !== null && cells[lastComboDisableIndex]) {
                const [start, end] = [lastComboDisableIndex, cellIdx].sort((a, b) => a - b);
                targets = cells.slice(start, end + 1);
            }
            lastComboDisableIndex = cellIdx;

            applyComboDisable(targets, checked);
        });

        const uploadInput = rowEl.querySelector('.combo-upload-input');
        if (uploadInput) uploadInput.addEventListener('change', async (e) => {
            const input = e.target;
            const file = input.files[0];
            if (!file) return;

            const thumbImg = rowEl.querySelector('.combo-thumb');
            const statusEl = rowEl.querySelector('.combo-upload-status');
            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                if (cell.existing) {
                    cell.existing.image_url = url;
                } else {
                    localVariantRows.push({
                        tempId: ++variantTempCounter,
                        id: null,
                        axis_values: cell.values,
                        image_url: url,
                        sort_order: 0,
                    });
                }
                modalDirty = true;
                thumbImg.src = url;
                statusEl.textContent = '';
                renderVariantSection();
            } catch (e2) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e2.message);
            } finally {
                input.value = '';
            }
        });

        const pickExistingBtn = rowEl.querySelector('.combo-pick-existing-btn');
        if (pickExistingBtn) pickExistingBtn.addEventListener('click', async () => {
            const url = await promptPickExistingImage(localVariantRows);
            if (!url) return;
            if (cell.existing) {
                cell.existing.image_url = url;
            } else {
                localVariantRows.push({
                    tempId: ++variantTempCounter,
                    id: null,
                    axis_values: cell.values,
                    image_url: url,
                    sort_order: 0,
                });
            }
            modalDirty = true;
            renderVariantSection();
        });
    });
}

function renderComboBuilder(axisOptions) {
    const el = document.getElementById('combo-builder');
    const axisNames = Object.keys(axisOptions).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    if (axisNames.length < 2) {
        el.innerHTML = '<p class="text-xs text-gray-400">至少要有兩個軸都新增過選項，才能在這裡手動組合。</p>';
        return;
    }

    el.innerHTML = `
        <div class="border rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">
                手動新增一筆完整組合（至少選兩個軸；沒選的軸留「不指定」代表那個軸選什麼值都適用）：
            </p>
            <div class="flex flex-wrap gap-2 mb-2">
                ${axisNames.map(name => `
                    <div>
                        <label class="field-label">${escapeHtml(name)}</label>
                        <select class="field-input combo-builder-select" data-axis="${escapeHtml(name)}" style="width:auto">
                            <option value="">（不指定）</option>
                            ${axisOptions[name].map(r => {
                                const v = r.axis_values[name];
                                return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
                            }).join('')}
                        </select>
                    </div>`).join('')}
            </div>
            <div class="flex gap-2">
                <button type="button" id="combo-builder-submit" class="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">新增這筆組合</button>
                <button type="button" id="combo-builder-submit-disabled" class="px-3 py-1.5 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50">新增並停用（不能選）</button>
            </div>
        </div>`;

    function createComboFromBuilder(isDisabled) {
        const values = {};
        el.querySelectorAll('.combo-builder-select').forEach(sel => {
            if (sel.value) values[sel.dataset.axis] = sel.value;
        });
        if (Object.keys(values).length < 2) { alert('至少要選兩個軸才算一筆組合'); return; }

        localVariantRows.push({
            tempId: ++variantTempCounter,
            id: null,
            axis_values: values,
            image_url: null,
            sort_order: 0,
            is_disabled: isDisabled,
        });
        modalDirty = true;
        renderVariantSection();
    }

    document.getElementById('combo-builder-submit').addEventListener('click', () => createComboFromBuilder(false));
    document.getElementById('combo-builder-submit-disabled').addEventListener('click', () => createComboFromBuilder(true));
}

document.getElementById('add-axis-value-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('axis-name-input');
    const valueInput = document.getElementById('axis-value-input');
    const axisName = nameInput.value.trim();
    if (!axisName) { nameInput.focus(); return; }
    const values = splitBulkValues(valueInput.value);
    if (!values.length) { valueInput.focus(); return; }

    const { axisOptions } = categorizeVariantRows(localVariantRows);
    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newValues = values.filter(v => !existing.has(v));
    if (!newValues.length) { valueInput.value = ''; return; }

    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName);

    const newRows = newValues.map(v => ({
        tempId: ++variantTempCounter,
        id: null,
        axis_values: { [axisName]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
    }));
    axisOptions[axisName] = [...existingRows, ...newRows];
    localVariantRows.push(...newRows);
    renumberVariantSortOrders(axisNames, axisOptions);

    modalDirty = true;
    nameInput.value = '';
    valueInput.value = '';
    renderVariantSection();
});

document.getElementById('combo-table-import-btn').addEventListener('click', () => {
    const statusEl = document.getElementById('combo-table-import-status');
    const textarea = document.getElementById('combo-table-paste');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 2) { statusEl.textContent = '至少要有標題列＋一列資料，而且每列要用 | 分隔。'; return; }

    const parseRow = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(lines[0]);
    if (headers.filter(Boolean).length < 2) { statusEl.textContent = '標題列至少要有兩欄（兩個軸）。'; return; }

    let added = 0, skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        if (/^[|:\s-]+$/.test(lines[i])) continue;
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

async function saveVariantChanges() {
    if (deletedVariantIds.length) {
        const { error } = await sb.from('houjiao_variants').delete().in('id', deletedVariantIds);
        if (error) throw error;
        deletedVariantIds = [];
    }

    if (localVariantRows.length) {
        const rows = localVariantRows.map(r => ({
            axis_values: r.axis_values || {},
            image_url: r.image_url || null,
            sort_order: r.sort_order || 0,
            is_disabled: !!r.is_disabled,
        }));
        const { error } = await sb.from('houjiao_variants').upsert(rows, { onConflict: 'axis_values' });
        if (error) throw error;
    }
}

/* ===================== 編輯區：接線盒規格的軸／完整組合 =====================
   跟上面架構的編輯區是同一套邏輯（軸/選項/完整組合、shift 範圍停用、貼表格匯入），
   只是存到另一張表（houjiao_box_variants），而且完整組合不需要自己的照片——
   選好之後的示意圖是把每個軸選到的那個選項的小圖疊在一起「合成」出來的（見下面選規格區），
   所以這裡的完整組合列表沒有上傳/移除圖片的按鈕，其餘（stripWrappingBrackets、
   splitBulkValues、categorizeVariantRows、axisChipHtml…等純函式）直接沿用上面架構那份。 */

let boxVariantTempCounter = 0;
let boxLocalVariantRows = [];
let boxDeletedVariantIds = [];
let boxLastComboDisableIndex = null;
let boxComboSortSnapshot = null;
// 「完整組合」列表要不要照某個軸的值排序（方便把同一個軸值的組合排在一起，勾選起來批次
// 套用圖片）；空字串＝維持原本的排序方式。
let boxComboSortAxis = '';
// 「完整組合」列表只顯示符合這些軸值的組合（例如只顯示「產品＝一連型內外耳」＋「顏色＝原色」
// 的組合，不管厚度／管孔選什麼）——{ 軸名: 值 }，某個軸沒設定就是不篩選那個軸。
let boxComboFilters = {};

function boxMoveAxisGroup(name, direction) {
    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);
    const idx = axisNames.indexOf(name);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= axisNames.length) return;

    [axisNames[idx], axisNames[swapIdx]] = [axisNames[swapIdx], axisNames[idx]];
    renumberVariantSortOrders(axisNames, axisOptions);

    boxModalDirty = true;
    renderBoxVariantSection();
}

function boxRenameAxis(oldName) {
    const newName = prompt(`把「${oldName}」改名成？`, oldName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;

    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    if (axisOptions[trimmed]) {
        alert(`已經有「${trimmed}」這個軸了，換一個名字，或是先刪掉其中一個再改名。`);
        return;
    }

    boxLocalVariantRows.forEach(row => {
        if (!(oldName in row.axis_values)) return;
        const value = row.axis_values[oldName];
        const newValues = { ...row.axis_values };
        delete newValues[oldName];
        newValues[trimmed] = value;

        if (row.id) boxDeletedVariantIds.push(row.id);
        row.id = null;
        row.axis_values = newValues;
    });

    boxModalDirty = true;
    renderBoxVariantSection();
}

function boxEditAxisOptionValue(name, tempId) {
    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const rows = axisOptions[name] || [];
    const row = rows.find(r => r.tempId === tempId);
    if (!row) return;

    const currentValue = row.axis_values[name];
    const raw = prompt(`把「${currentValue}」改成？`, currentValue);
    if (raw === null) return;
    const trimmed = stripWrappingBrackets(raw.trim()).trim();
    if (!trimmed || trimmed === currentValue) return;

    if (rows.some(r => r.tempId !== tempId && r.axis_values[name] === trimmed)) {
        alert(`「${name}」已經有「${trimmed}」這個選項了，換一個值，或是先刪掉其中一個再改。`);
        return;
    }

    boxLocalVariantRows.forEach(r => {
        if (!(name in r.axis_values) || r.axis_values[name] !== currentValue) return;
        const newValues = { ...r.axis_values, [name]: trimmed };

        if (r.id) boxDeletedVariantIds.push(r.id);
        r.id = null;
        r.axis_values = newValues;
    });

    boxModalDirty = true;
    renderBoxVariantSection();
}

function boxMoveAxisOption(name, tempId, direction) {
    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const rows = axisOptions[name] || [];
    const idx = rows.findIndex(r => r.tempId === tempId);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return;

    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];
    const axisNames = currentAxisNamesInOrder(axisOptions);
    renumberVariantSortOrders(axisNames, axisOptions);

    boxModalDirty = true;
    renderBoxVariantSection();
}

function boxInsertAxisOptionAt(name, tempId, position) {
    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const rows = axisOptions[name] || [];
    const idx = rows.findIndex(r => r.tempId === tempId);
    if (idx === -1) return;

    const raw = prompt(`要在「${rows[idx].axis_values[name]}」${position === 'before' ? '前面' : '後面'}插入什麼值？（可以用 / 、 , ， 一次加多個）`);
    if (!raw) return;
    const values = splitBulkValues(raw);
    if (!values.length) return;

    const existingSet = new Set(rows.map(r => r.axis_values[name]));
    const newValues = values.filter(v => !existingSet.has(v));
    if (!newValues.length) return;

    const axisNames = currentAxisNamesInOrder(axisOptions);

    const newRows = newValues.map(v => ({
        tempId: ++boxVariantTempCounter,
        id: null,
        axis_values: { [name]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
    }));

    const insertAt = position === 'before' ? idx : idx + 1;
    axisOptions[name] = [...rows.slice(0, insertAt), ...newRows, ...rows.slice(insertAt)];
    boxLocalVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    boxModalDirty = true;
    renderBoxVariantSection();
}

async function loadBoxEditorSection() {
    boxDeletedVariantIds = [];
    boxLastComboDisableIndex = null;
    document.getElementById('box-variant-combo-list').innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    const { data, error } = await fetchAllRows(() => sb.from('houjiao_box_variants').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }));
    if (error) {
        document.getElementById('box-variant-combo-list').innerHTML = `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    boxLocalVariantRows = (data || []).map(r => ({ ...r, axis_values: r.axis_values || {}, tempId: ++boxVariantTempCounter }));

    boxComboSortSnapshot = new Map();
    boxLocalVariantRows.forEach(r => {
        if (Object.keys(r.axis_values).length >= 2) {
            boxComboSortSnapshot.set(comboKeyOf(r.axis_values), !!r.is_disabled);
        }
    });

    renderBoxVariantSection();
}

function wireBoxAxisChips(scopeEl) {
    scopeEl.querySelectorAll('.axis-value-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxEditAxisOptionValue(rowEl.dataset.axisName, Number(rowEl.dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-chip-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('確定要刪除這個選項嗎？')) return;
            boxRemoveVariantRow(Number(btn.closest('[data-temp-id]').dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-chip-split').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxSplitVariantRow(rowEl.dataset.axisName, Number(rowEl.dataset.tempId));
        });
    });

    scopeEl.querySelectorAll('.axis-move-up-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxMoveAxisOption(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), -1);
        });
    });
    scopeEl.querySelectorAll('.axis-move-down-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxMoveAxisOption(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 1);
        });
    });
    scopeEl.querySelectorAll('.axis-insert-before-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxInsertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'before');
        });
    });
    scopeEl.querySelectorAll('.axis-insert-after-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rowEl = btn.closest('[data-temp-id]');
            boxInsertAxisOptionAt(rowEl.dataset.axisName, Number(rowEl.dataset.tempId), 'after');
        });
    });

    scopeEl.querySelectorAll('.axis-pick-existing-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tempId = Number(btn.closest('[data-temp-id]').dataset.tempId);
            const row = boxLocalVariantRows.find(r => r.tempId === tempId);
            if (!row) return;
            const url = await promptPickExistingImage(boxLocalVariantRows);
            if (!url) return;
            setBoxRowImageForSlot(row, url);
            boxModalDirty = true;
            renderBoxVariantSection();
        });
    });

    scopeEl.querySelectorAll('.axis-image-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tempId = Number(btn.closest('[data-temp-id]').dataset.tempId);
            if (!confirm('確定要移除這個選項的圖片嗎？')) return;
            const row = boxLocalVariantRows.find(r => r.tempId === tempId);
            if (!row) return;
            clearBoxRowImageForSlot(row);
            boxModalDirty = true;
            renderBoxVariantSection();
        });
    });

    scopeEl.querySelectorAll('.axis-upload-input').forEach(input => {
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;

            const rowEl = input.closest('[data-temp-id]');
            const tempId = Number(rowEl.dataset.tempId);
            const row = boxLocalVariantRows.find(r => r.tempId === tempId);
            if (!row) return;

            const statusEl = rowEl.querySelector('.axis-upload-status');
            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                setBoxRowImageForSlot(row, url);
                boxModalDirty = true;
                statusEl.textContent = '';
                renderBoxVariantSection();
            } catch (e) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e.message);
            } finally {
                input.value = '';
            }
        });
    });
}

function renderBoxVariantSection() {
    const { axisOptions, combos } = categorizeVariantRows(boxLocalVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);

    const groupsEl = document.getElementById('box-axis-groups');
    if (!axisNames.length) {
        groupsEl.innerHTML = '<p class="text-xs text-gray-400">還沒有任何軸，在下面新增第一個軸吧（例如「規格」）。</p>';
    } else {
        groupsEl.innerHTML = axisNames.map((name, axisIdx) => `
            <div>
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1">
                        <button type="button" class="axis-group-move-up-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${axisIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" data-axis-name="${escapeHtml(name)}" title="整個軸上移（也決定合成圖層的順序，越上面越底層）">▲</button>
                        <button type="button" class="axis-group-move-down-btn px-1 text-xs rounded border bg-white hover:bg-gray-100 ${axisIdx === axisNames.length - 1 ? 'opacity-30 pointer-events-none' : ''}" data-axis-name="${escapeHtml(name)}" title="整個軸下移（也決定合成圖層的順序，越下面越上層）">▼</button>
                        <button type="button" class="axis-rename-btn field-label mb-0 hover:underline hover:text-blue-600" data-axis-name="${escapeHtml(name)}" title="點一下改軸名稱">${escapeHtml(name)} ✎</button>
                    </div>
                    <button type="button" class="axis-delete-all-btn text-xs text-red-600 hover:underline" data-axis-name="${escapeHtml(name)}">刪除整個軸</button>
                </div>
                <div class="space-y-1">${axisOptions[name].map((r, i) => axisChipHtml(r, name, i === 0, i === axisOptions[name].length - 1, currentBoxImageSlot)).join('')}</div>
            </div>`).join('');
    }
    wireBoxAxisChips(groupsEl);

    groupsEl.querySelectorAll('.axis-group-move-up-btn').forEach(btn => {
        btn.addEventListener('click', () => boxMoveAxisGroup(btn.dataset.axisName, -1));
    });
    groupsEl.querySelectorAll('.axis-group-move-down-btn').forEach(btn => {
        btn.addEventListener('click', () => boxMoveAxisGroup(btn.dataset.axisName, 1));
    });
    groupsEl.querySelectorAll('.axis-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => boxRenameAxis(btn.dataset.axisName));
    });

    groupsEl.querySelectorAll('.axis-delete-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.axisName;
            const rows = (axisOptions[name] || []);
            if (!confirm(`確定要刪除「${name}」這整個軸嗎？底下 ${rows.length} 個選項都會一起刪掉。`)) return;
            rows.forEach(r => {
                if (r.id) boxDeletedVariantIds.push(r.id);
            });
            const tempIds = new Set(rows.map(r => r.tempId));
            boxLocalVariantRows = boxLocalVariantRows.filter(r => !tempIds.has(r.tempId));
            boxModalDirty = true;
            renderBoxVariantSection();
        });
    });

    renderBoxComboList(combos, axisOptions, axisNames);
    renderBoxComboBuilder(axisOptions);
}

function boxRemoveVariantRow(tempId) {
    const row = boxLocalVariantRows.find(r => r.tempId === tempId);
    if (!row) return;
    if (row.id) boxDeletedVariantIds.push(row.id);
    boxLocalVariantRows = boxLocalVariantRows.filter(r => r.tempId !== tempId);
    boxModalDirty = true;
    renderBoxVariantSection();
}

function boxSplitVariantRow(axisName, tempId) {
    const row = boxLocalVariantRows.find(r => r.tempId === tempId);
    if (!row) return;
    const rawValue = row.axis_values[axisName];
    const values = splitBulkValues(rawValue);
    if (values.length < 2) return;
    if (!confirm(`要把「${rawValue}」分割成 ${values.length} 個選項嗎？`)) return;

    if (row.id) boxDeletedVariantIds.push(row.id);
    boxLocalVariantRows = boxLocalVariantRows.filter(r => r.tempId !== tempId);

    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName);

    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newRows = [];
    values.filter(v => !existing.has(v)).forEach(v => {
        newRows.push({
            tempId: ++boxVariantTempCounter,
            id: null,
            axis_values: { [axisName]: v },
            image_url: null,
            sort_order: 0,
        });
    });
    axisOptions[axisName] = [...existingRows, ...newRows];
    boxLocalVariantRows.push(...newRows);

    renumberVariantSortOrders(axisNames, axisOptions);

    boxModalDirty = true;
    renderBoxVariantSection();
}

// 篩選／排序下拉選單的變動事件，兩種畫面（篩到剩 0 筆時的空狀態、跟正常列表）都要接上，
// 抽成共用函式避免兩處各寫一次容易漏改。
function wireBoxComboFilterAndSortControls(axisNames) {
    document.querySelectorAll('.box-combo-filter-select').forEach(sel => {
        sel.addEventListener('change', () => {
            boxComboFilters[sel.dataset.axis] = sel.value;
            renderBoxVariantSection();
        });
    });

    const clearBtn = document.getElementById('box-combo-filter-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            boxComboFilters = {};
            renderBoxVariantSection();
        });
    }

    const sortSelectEl = document.getElementById('box-combo-sort-select');
    if (sortSelectEl) {
        sortSelectEl.addEventListener('change', () => {
            boxComboSortAxis = sortSelectEl.value;
            renderBoxVariantSection();
        });
    }
}

// 接線盒規格的完整組合預設是靠疊圖合成示意圖，但也可以像架構那樣幫某一筆完整組合另外
// 上傳一張專屬照片——選規格時如果剛好對到這筆組合，就會優先直接用這張圖，不去疊每個軸
// 自己的小圖（跟架構完整組合的上傳/優先順序是同一套規則）。
function renderBoxComboList(combos, axisOptions, axisNames) {
    const container = document.getElementById('box-variant-combo-list');

    const comboByKey = {};
    combos.forEach(c => { comboByKey[comboKeyOf(c.axis_values)] = c; });

    let cells = [];
    const matchedKeys = new Set();
    let anyDisabledInGrid = false;

    const totalGridCombos = axisNames.length >= 2
        ? axisNames.reduce((acc, name) => acc * axisOptions[name].length, 1)
        : 0;

    if (axisNames.length >= 2 && axisNames.length <= COMBO_GRID_MAX_AXES && totalGridCombos <= COMBO_GRID_MAX_TOTAL) {
        let gridCombos = [{}];
        axisNames.forEach(name => {
            const next = [];
            gridCombos.forEach(c => {
                axisOptions[name].forEach(r => next.push({ ...c, [name]: r.axis_values[name] }));
            });
            gridCombos = next;
        });

        anyDisabledInGrid = gridCombos.some(values => {
            const c = comboByKey[comboKeyOf(values)];
            return c && c.is_disabled;
        });

        gridCombos.forEach(values => {
            const key = comboKeyOf(values);
            let existing = comboByKey[key] || null;
            if (!existing && anyDisabledInGrid) {
                existing = {
                    tempId: ++boxVariantTempCounter,
                    id: null,
                    axis_values: values,
                    image_url: null,
                    sort_order: 0,
                    is_disabled: false,
                };
                boxLocalVariantRows.push(existing);
                comboByKey[key] = existing;
            }
            if (existing) matchedKeys.add(key);
            cells.push({ values, existing, isGridCell: true, label: axisNames.map(n => values[n]).join('　') });
        });
    }

    combos.filter(c => !matchedKeys.has(comboKeyOf(c.axis_values))).forEach(r => {
        cells.push({ values: r.axis_values, existing: r, isGridCell: false, label: rowAxisEntries(r).map(([k, v]) => `${k}：${v}`).join('　') });
    });

    function deleteCell(cell) {
        if (cell.isGridCell && anyDisabledInGrid && cell.existing && !cell.existing.is_disabled) {
            cell.existing.is_disabled = true;
            boxModalDirty = true;
            renderBoxVariantSection();
            return;
        }
        boxRemoveVariantRow(cell.existing.tempId);
    }

    function applyComboDisable(targetCells, checked) {
        const toRemoveIds = [];
        targetCells.forEach(c => {
            if (c.existing) {
                c.existing.is_disabled = checked;
                if (!checked && !c.existing.image_url) {
                    toRemoveIds.push(c.existing.tempId);
                }
            } else if (checked) {
                const row = {
                    tempId: ++boxVariantTempCounter,
                    id: null,
                    axis_values: c.values,
                    image_url: null,
                    is_disabled: true,
                    sort_order: 0,
                };
                boxLocalVariantRows.push(row);
                c.existing = row;
            }
        });
        if (toRemoveIds.length) {
            const idSet = new Set(toRemoveIds);
            boxLocalVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) boxDeletedVariantIds.push(r.id); });
            boxLocalVariantRows = boxLocalVariantRows.filter(r => !idSet.has(r.tempId));
        }
        boxModalDirty = true;
        renderBoxVariantSection();
    }

    const totalCellCount = cells.length;

    // 只顯示符合篩選條件的組合——例如篩「產品＝一連型內外耳」＋「顏色＝原色」，厚度／管孔
    // 不篩就是全部都顯示，這樣不管厚度／管孔怎麼排列組合都會被篩出來，全選/批次套用圖片
    // 就只會套用到這些篩出來的組合，不會誤選到別的規格。
    const activeFilterEntries = Object.entries(boxComboFilters).filter(([name, value]) => value && axisNames.includes(name));
    if (activeFilterEntries.length) {
        cells = cells.filter(cell => activeFilterEntries.every(([axis, value]) => cell.values[axis] === value));
    }

    if (boxComboSortAxis && axisOptions[boxComboSortAxis]) {
        // 依照選定的軸排序，把同一個軸值的組合排在一起，方便勾選一整批來批次套用圖片；
        // 排序用該軸選項自己的順序（跟軸編輯畫面上下移動排出來的順序一樣），不是字母排序。
        const orderMap = new Map(axisOptions[boxComboSortAxis].map((o, idx) => [o.axis_values[boxComboSortAxis], idx]));
        cells.sort((a, b) => (orderMap.get(a.values[boxComboSortAxis]) ?? 999) - (orderMap.get(b.values[boxComboSortAxis]) ?? 999));
    } else if (boxComboSortSnapshot) {
        cells.sort((a, b) => {
            const disabledA = a.existing ? boxComboSortSnapshot.get(comboKeyOf(a.values)) : undefined;
            const disabledB = b.existing ? boxComboSortSnapshot.get(comboKeyOf(b.values)) : undefined;
            return Number(!!disabledA) - Number(!!disabledB);
        });
    }

    const hasActiveFilter = activeFilterEntries.length > 0;
    const filterBarHtml = `
        <div class="flex items-center gap-2 mb-2 text-xs flex-wrap">
            <label class="text-gray-500 whitespace-nowrap">只顯示：</label>
            ${axisNames.map(name => `
                <select class="box-combo-filter-select field-input" data-axis="${escapeHtml(name)}" style="width:auto">
                    <option value="">${escapeHtml(name)}：不限</option>
                    ${(axisOptions[name] || []).map(o => o.axis_values[name]).map(value => `<option value="${escapeHtml(value)}" ${boxComboFilters[name] === value ? 'selected' : ''}>${escapeHtml(name)}：${escapeHtml(value)}</option>`).join('')}
                </select>`).join('')}
            ${hasActiveFilter ? `<button type="button" id="box-combo-filter-clear-btn" class="text-blue-600 hover:underline whitespace-nowrap">清除篩選（目前顯示 ${totalCellCount} 筆中的 ${cells.length} 筆）</button>` : ''}
        </div>
        <div class="flex items-center gap-2 mb-2 text-xs">
            <label class="text-gray-500 whitespace-nowrap">排序依據：</label>
            <select id="box-combo-sort-select" class="field-input" style="width:auto">
                <option value="">預設順序</option>
                ${axisNames.map(name => `<option value="${escapeHtml(name)}" ${boxComboSortAxis === name ? 'selected' : ''}>依「${escapeHtml(name)}」排序</option>`).join('')}
            </select>
            <span class="text-gray-400">排序方便把同一個軸值的組合排在一起，整批勾選後批次套用圖片。</span>
        </div>`;

    if (!totalCellCount) {
        container.innerHTML = axisNames.length < 2
            ? '<p class="text-xs text-gray-400">至少要有兩個軸都新增過選項，才會自動列出組合；也可以用下面「手動新增一筆完整組合」直接建立。</p>'
            : '<p class="text-xs text-gray-400">目前沒有完整組合。</p>';
        return;
    }

    if (!cells.length) {
        container.innerHTML = filterBarHtml + '<p class="text-xs text-gray-400">篩選條件下沒有符合的組合。</p>';
        wireBoxComboFilterAndSortControls(axisNames);
        return;
    }

    const bulkBarHtml = `
        <div id="box-combo-bulk-bar" class="flex items-center gap-2 mb-2 pb-2 border-b flex-wrap">
            <label class="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" id="box-combo-select-all">
                全選
            </label>
            <button type="button" id="box-combo-delete-selected-btn" class="px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50" disabled>刪除已選取的組合</button>
            <span class="text-gray-300">｜</span>
            <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap" id="box-combo-batch-upload-label">
                批次上傳圖片給已選取
                <input type="file" accept="image/*" class="hidden" id="box-combo-batch-upload-input" disabled>
            </label>
            <button type="button" id="box-combo-batch-pick-btn" class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap" disabled>批次選用已上傳給已選取</button>
            <span id="box-combo-batch-status" class="text-xs text-gray-400"></span>
        </div>`;

    const isOverrideSlot = currentBoxImageSlot > 1;

    container.innerHTML = filterBarHtml + bulkBarHtml + cells.map((cell, i) => {
        const existing = cell.existing;
        const isDisabled = !!(existing && existing.is_disabled);
        const hasOwnSlotImage = existing
            ? (isOverrideSlot ? !!(existing.image_urls_by_slot && existing.image_urls_by_slot[String(currentBoxImageSlot)]) : !!existing.image_url)
            : false;
        const effectiveUrl = existing ? (isOverrideSlot ? slotAwareImageUrl(existing, currentBoxImageSlot) : (existing.image_url || '')) : '';
        return `
            <div class="flex items-center gap-3 border rounded-lg p-2 ${isDisabled ? 'bg-red-50 border-red-200' : ''}" data-cell-idx="${i}">
                <input type="checkbox" class="combo-select-checkbox" title="${existing ? '' : '這筆組合還沒有建立資料，勾選後批次套用圖片會自動建立'}">
                <img src="${escapeHtml(effectiveUrl)}" alt="" class="product-thumb combo-thumb" style="width:40px;height:40px;">
                <div class="flex-1 text-sm ${isDisabled ? 'line-through text-gray-400' : ''}">${escapeHtml(cell.label)}</div>
                ${isOverrideSlot && existing && !hasOwnSlotImage ? '<span class="text-xs text-gray-400 whitespace-nowrap">（沿用預設圖）</span>' : ''}
                <label class="flex items-center gap-1 text-xs text-red-600 whitespace-nowrap">
                    <input type="checkbox" class="combo-disable-checkbox" ${isDisabled ? 'checked' : ''}>
                    停用（不能選）
                </label>
                <span class="combo-upload-status text-xs text-gray-400"></span>
                ${isDisabled ? '' : `
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden combo-upload-input">
                </label>
                <button type="button" class="combo-pick-existing-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap">選用已上傳</button>`}
                ${!isDisabled && existing && hasOwnSlotImage ? `<button type="button" class="combo-remove-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>` : ''}
                ${existing ? `<button type="button" class="combo-delete-btn px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">刪除組合</button>` : ''}
            </div>`;
    }).join('');

    {
        const selectAllCb = document.getElementById('box-combo-select-all');
        const deleteSelectedBtn = document.getElementById('box-combo-delete-selected-btn');
        const batchUploadLabel = document.getElementById('box-combo-batch-upload-label');
        const batchUploadInput = document.getElementById('box-combo-batch-upload-input');
        const batchPickBtn = document.getElementById('box-combo-batch-pick-btn');
        const batchStatusEl = document.getElementById('box-combo-batch-status');
        const itemCheckboxes = () => Array.from(container.querySelectorAll('.combo-select-checkbox'));
        const checkedCells = () => itemCheckboxes()
            .filter(cb => cb.checked)
            .map(cb => cells[Number(cb.closest('[data-cell-idx]').dataset.cellIdx)]);

        function refreshBulkButtons() {
            const checkedExisting = checkedCells().some(c => c.existing);
            const anyChecked = checkedCells().length > 0;
            deleteSelectedBtn.disabled = !checkedExisting;
            batchUploadInput.disabled = !anyChecked;
            batchUploadLabel.classList.toggle('opacity-40', !anyChecked);
            batchUploadLabel.classList.toggle('pointer-events-none', !anyChecked);
            batchPickBtn.disabled = !anyChecked;
        }

        selectAllCb.addEventListener('change', () => {
            itemCheckboxes().forEach(cb => { cb.checked = selectAllCb.checked; });
            refreshBulkButtons();
        });

        itemCheckboxes().forEach(cb => {
            cb.addEventListener('change', () => {
                if (!cb.checked) selectAllCb.checked = false;
                else if (itemCheckboxes().every(c => c.checked)) selectAllCb.checked = true;
                refreshBulkButtons();
            });
        });

        // 批次套用圖片給已選取的組合：套用的是「目前正在編輯第幾個接線盒的圖片」那個位置
        // （跟每一列自己的上傳按鈕是同一套規則），沒有資料的格子會自動先建立起來。
        function applyImageToCheckedCells(url) {
            const targets = checkedCells();
            if (!targets.length) return;
            targets.forEach(cell => {
                if (!cell.existing) {
                    cell.existing = { tempId: ++boxVariantTempCounter, id: null, axis_values: cell.values, image_url: null, sort_order: 0 };
                    boxLocalVariantRows.push(cell.existing);
                }
                setBoxRowImageForSlot(cell.existing, url);
            });
            boxModalDirty = true;
            renderBoxVariantSection();
        }

        batchUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const count = checkedCells().length;
            batchStatusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                applyImageToCheckedCells(url);
                batchStatusEl.textContent = `已套用到 ${count} 筆組合，記得最下面按「儲存」。`;
            } catch (err) {
                batchStatusEl.textContent = '';
                alert('上傳失敗：' + err.message);
            } finally {
                e.target.value = '';
            }
        });

        batchPickBtn.addEventListener('click', async () => {
            const count = checkedCells().length;
            const url = await promptPickExistingImage(boxLocalVariantRows);
            if (!url) return;
            applyImageToCheckedCells(url);
            batchStatusEl.textContent = `已套用到 ${count} 筆組合，記得最下面按「儲存」。`;
        });

        deleteSelectedBtn.addEventListener('click', () => {
            const selectedCells = checkedCells().filter(c => c.existing);
            if (!selectedCells.length) return;

            const selectedTempIdSet = new Set(selectedCells.map(c => c.existing.tempId));
            const survivingDisabledInGrid = cells.some(
                c => c.isGridCell && c.existing && c.existing.is_disabled && !selectedTempIdSet.has(c.existing.tempId)
            );

            const toDisableCount = survivingDisabledInGrid
                ? selectedCells.filter(c => c.isGridCell && anyDisabledInGrid && !c.existing.is_disabled).length
                : 0;
            let msg = `確定要處理選取的 ${selectedCells.length} 筆組合嗎？`;
            if (toDisableCount) {
                msg += `\n其中 ${toDisableCount} 筆是表格自動列出的可選組合，這種格子刪了會被自動補回來，所以會改成標記「停用（不能選）」。`;
            }
            if (!confirm(msg)) return;

            const removeTempIds = [];
            selectedCells.forEach(cell => {
                if (survivingDisabledInGrid && cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled) {
                    cell.existing.is_disabled = true;
                } else {
                    removeTempIds.push(cell.existing.tempId);
                }
            });
            if (removeTempIds.length) {
                const idSet = new Set(removeTempIds);
                boxLocalVariantRows.forEach(r => { if (idSet.has(r.tempId) && r.id) boxDeletedVariantIds.push(r.id); });
                boxLocalVariantRows = boxLocalVariantRows.filter(r => !idSet.has(r.tempId));
            }
            boxModalDirty = true;
            renderBoxVariantSection();
        });

        refreshBulkButtons();
    }

    wireBoxComboFilterAndSortControls(axisNames);

    container.querySelectorAll('[data-cell-idx]').forEach(rowEl => {
        const cell = cells[Number(rowEl.dataset.cellIdx)];

        const delBtn = rowEl.querySelector('.combo-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                const willJustDisable = cell.isGridCell && anyDisabledInGrid && !cell.existing.is_disabled;
                const msg = willJustDisable
                    ? '這筆是表格自動列出的可選組合，刪了會被自動補回來，所以會改成標記「停用（不能選）」，確定嗎？'
                    : '確定要刪除這筆組合嗎？';
                if (!confirm(msg)) return;
                deleteCell(cell);
            });
        }

        const removeBtn = rowEl.querySelector('.combo-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (!confirm('確定要移除這張組合照片嗎？')) return;
                clearBoxRowImageForSlot(cell.existing);
                boxModalDirty = true;
                renderBoxVariantSection();
            });
        }

        rowEl.querySelector('.combo-disable-checkbox').addEventListener('click', (e) => {
            const checked = e.target.checked;
            const cellIdx = Number(rowEl.dataset.cellIdx);

            let targets = [cell];
            if (e.shiftKey && boxLastComboDisableIndex !== null && cells[boxLastComboDisableIndex]) {
                const [start, end] = [boxLastComboDisableIndex, cellIdx].sort((a, b) => a - b);
                targets = cells.slice(start, end + 1);
            }
            boxLastComboDisableIndex = cellIdx;

            applyComboDisable(targets, checked);
        });

        const uploadInput = rowEl.querySelector('.combo-upload-input');
        if (uploadInput) uploadInput.addEventListener('change', async (e) => {
            const input = e.target;
            const file = input.files[0];
            if (!file) return;

            const statusEl = rowEl.querySelector('.combo-upload-status');
            statusEl.textContent = '上傳中…';
            try {
                const url = await uploadImageToCloudinary(file);
                if (!cell.existing) {
                    cell.existing = { tempId: ++boxVariantTempCounter, id: null, axis_values: cell.values, image_url: null, sort_order: 0 };
                    boxLocalVariantRows.push(cell.existing);
                }
                setBoxRowImageForSlot(cell.existing, url);
                boxModalDirty = true;
                statusEl.textContent = '';
                renderBoxVariantSection();
            } catch (e2) {
                statusEl.textContent = '';
                alert('上傳失敗：' + e2.message);
            } finally {
                input.value = '';
            }
        });

        const pickExistingBtn = rowEl.querySelector('.combo-pick-existing-btn');
        if (pickExistingBtn) pickExistingBtn.addEventListener('click', async () => {
            const url = await promptPickExistingImage(boxLocalVariantRows);
            if (!url) return;
            if (!cell.existing) {
                cell.existing = { tempId: ++boxVariantTempCounter, id: null, axis_values: cell.values, image_url: null, sort_order: 0 };
                boxLocalVariantRows.push(cell.existing);
            }
            setBoxRowImageForSlot(cell.existing, url);
            boxModalDirty = true;
            renderBoxVariantSection();
        });
    });
}

function renderBoxComboBuilder(axisOptions) {
    const el = document.getElementById('box-combo-builder');
    const axisNames = Object.keys(axisOptions).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    if (axisNames.length < 2) {
        el.innerHTML = '<p class="text-xs text-gray-400">至少要有兩個軸都新增過選項，才能在這裡手動組合。</p>';
        return;
    }

    el.innerHTML = `
        <div class="border rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">
                手動新增一筆完整組合（至少選兩個軸；沒選的軸留「不指定」代表那個軸選什麼值都適用）：
            </p>
            <div class="flex flex-wrap gap-2 mb-2">
                ${axisNames.map(name => `
                    <div>
                        <label class="field-label">${escapeHtml(name)}</label>
                        <select class="field-input combo-builder-select" data-axis="${escapeHtml(name)}" style="width:auto">
                            <option value="">（不指定）</option>
                            ${axisOptions[name].map(r => {
                                const v = r.axis_values[name];
                                return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
                            }).join('')}
                        </select>
                    </div>`).join('')}
            </div>
            <div class="flex gap-2">
                <button type="button" id="box-combo-builder-submit" class="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">新增這筆組合</button>
                <button type="button" id="box-combo-builder-submit-disabled" class="px-3 py-1.5 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50">新增並停用（不能選）</button>
            </div>
        </div>`;

    function createComboFromBuilder(isDisabled) {
        const values = {};
        el.querySelectorAll('.combo-builder-select').forEach(sel => {
            if (sel.value) values[sel.dataset.axis] = sel.value;
        });
        if (Object.keys(values).length < 2) { alert('至少要選兩個軸才算一筆組合'); return; }

        boxLocalVariantRows.push({
            tempId: ++boxVariantTempCounter,
            id: null,
            axis_values: values,
            image_url: null,
            sort_order: 0,
            is_disabled: isDisabled,
        });
        boxModalDirty = true;
        renderBoxVariantSection();
    }

    document.getElementById('box-combo-builder-submit').addEventListener('click', () => createComboFromBuilder(false));
    document.getElementById('box-combo-builder-submit-disabled').addEventListener('click', () => createComboFromBuilder(true));
}

document.getElementById('box-add-axis-value-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('box-axis-name-input');
    const valueInput = document.getElementById('box-axis-value-input');
    const axisName = nameInput.value.trim();
    if (!axisName) { nameInput.focus(); return; }
    const values = splitBulkValues(valueInput.value);
    if (!values.length) { valueInput.focus(); return; }

    const { axisOptions } = categorizeVariantRows(boxLocalVariantRows);
    const existingRows = axisOptions[axisName] || [];
    const existing = new Set(existingRows.map(r => r.axis_values[axisName]));
    const newValues = values.filter(v => !existing.has(v));
    if (!newValues.length) { valueInput.value = ''; return; }

    const axisNames = currentAxisNamesInOrder(axisOptions);
    if (!axisNames.includes(axisName)) axisNames.push(axisName);

    const newRows = newValues.map(v => ({
        tempId: ++boxVariantTempCounter,
        id: null,
        axis_values: { [axisName]: v },
        image_url: null,
        sort_order: 0,
        is_disabled: false,
    }));
    axisOptions[axisName] = [...existingRows, ...newRows];
    boxLocalVariantRows.push(...newRows);
    renumberVariantSortOrders(axisNames, axisOptions);

    boxModalDirty = true;
    nameInput.value = '';
    valueInput.value = '';
    renderBoxVariantSection();
});

document.getElementById('box-combo-table-import-btn').addEventListener('click', () => {
    const statusEl = document.getElementById('box-combo-table-import-status');
    const textarea = document.getElementById('box-combo-table-paste');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 2) { statusEl.textContent = '至少要有標題列＋一列資料，而且每列要用 | 分隔。'; return; }

    const parseRow = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(lines[0]);
    if (headers.filter(Boolean).length < 2) { statusEl.textContent = '標題列至少要有兩欄（兩個軸）。'; return; }

    let added = 0, skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        if (/^[|:\s-]+$/.test(lines[i])) continue;
        const cells = parseRow(lines[i]);
        const values = {};
        headers.forEach((h, idx) => {
            const v = (cells[idx] || '').trim();
            if (h && v) values[h] = v;
        });
        if (Object.keys(values).length < 2) { skipped++; continue; }
        boxLocalVariantRows.push({
            tempId: ++boxVariantTempCounter,
            id: null,
            axis_values: values,
            image_url: null,
            sort_order: 0,
        });
        added++;
    }

    if (added) boxModalDirty = true;
    statusEl.textContent = `已新增 ${added} 筆組合${skipped ? `，略過 ${skipped} 筆（欄位不足兩個）` : ''}。記得最下面按「儲存」才會真正生效。`;
    textarea.value = '';
    renderBoxVariantSection();
});

async function saveBoxVariantChanges() {
    if (boxDeletedVariantIds.length) {
        const { error } = await sb.from('houjiao_box_variants').delete().in('id', boxDeletedVariantIds);
        if (error) throw error;
        boxDeletedVariantIds = [];
    }

    if (boxLocalVariantRows.length) {
        const rows = boxLocalVariantRows.map(r => ({
            axis_values: r.axis_values || {},
            image_url: r.image_url || null,
            image_urls_by_slot: r.image_urls_by_slot && Object.keys(r.image_urls_by_slot).length ? r.image_urls_by_slot : null,
            sort_order: r.sort_order || 0,
            is_disabled: !!r.is_disabled,
        }));
        const { error } = await sb.from('houjiao_box_variants').upsert(rows, { onConflict: 'axis_values' });
        if (error) throw error;
    }
}

const editBoxModal = document.getElementById('edit-box-modal');

function openEditBoxModal() {
    editBoxModal.classList.remove('hidden');
    editBoxModal.classList.add('flex');
    document.getElementById('box-form-error').classList.add('hidden');
    boxModalDirty = false;
    currentBoxImageSlot = 1;
    boxComboSortAxis = '';
    boxComboFilters = {};
    document.getElementById('box-image-slot-select').value = '1';
    loadBoxEditorSection();
}

document.getElementById('box-image-slot-select').addEventListener('change', (e) => {
    currentBoxImageSlot = Number(e.target.value) || 1;
    renderBoxVariantSection();
});

function closeEditBoxModal() {
    if (boxModalDirty && !confirm('您有尚未儲存的修改，確定要離開嗎？')) return;
    editBoxModal.classList.add('hidden');
    editBoxModal.classList.remove('flex');
    boxModalDirty = false;
}

document.getElementById('edit-box-axes-btn').addEventListener('click', openEditBoxModal);
document.getElementById('box-modal-close-btn').addEventListener('click', closeEditBoxModal);
document.getElementById('box-modal-cancel-btn').addEventListener('click', closeEditBoxModal);

document.getElementById('box-modal-save-btn').addEventListener('click', async () => {
    const formError = document.getElementById('box-form-error');
    formError.classList.add('hidden');
    try {
        await saveBoxVariantChanges();
    } catch (e) {
        formError.textContent = '儲存失敗：' + e.message;
        formError.classList.remove('hidden');
        return;
    }
    boxModalDirty = false;
    editBoxModal.classList.add('hidden');
    editBoxModal.classList.remove('flex');
    await loadBoxVariants(); // 重新整理下面每個接線盒的選擇區
    ensureBoxPickerCountForce();
});

const editModal = document.getElementById('edit-modal');

function openEditModal() {
    editModal.classList.remove('hidden');
    editModal.classList.add('flex');
    document.getElementById('form-error').classList.add('hidden');
    modalDirty = false;
    loadEditorSection();
}

function closeEditModal() {
    if (modalDirty && !confirm('您有尚未儲存的修改，確定要離開嗎？')) return;
    editModal.classList.add('hidden');
    editModal.classList.remove('flex');
    modalDirty = false;
}

document.getElementById('edit-axes-btn').addEventListener('click', openEditModal);
document.getElementById('modal-close-btn').addEventListener('click', closeEditModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeEditModal);

document.getElementById('modal-save-btn').addEventListener('click', async () => {
    const formError = document.getElementById('form-error');
    formError.classList.add('hidden');
    try {
        await saveVariantChanges();
    } catch (e) {
        formError.textContent = '儲存失敗：' + e.message;
        formError.classList.remove('hidden');
        return;
    }
    modalDirty = false;
    editModal.classList.add('hidden');
    editModal.classList.remove('flex');
    await loadHoujiaoVariants(); // 重新整理下面的選規格畫面
});

let leavingConfirmed = false;

document.querySelectorAll('.admin-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        if (modalDirty || boxModalDirty) {
            if (confirm('您有尚未儲存的修改，確定要離開嗎？')) {
                leavingConfirmed = true;
            } else {
                e.preventDefault();
            }
        }
    });
});
window.addEventListener('beforeunload', (e) => {
    if ((modalDirty || boxModalDirty) && !leavingConfirmed) {
        e.preventDefault();
        e.returnValue = '';
    }
});

/* ===================== 選規格區（port 自 pos.js） ===================== */

let pickerAxisOptions = {}; // 軸名稱 -> [{value, image_url}]
let pickerCombos = [];      // [{ values:{軸名:值,...}, image_url, is_disabled }]
let selectedVariant = {};
let autoSelectedAxes = new Set();

function buildPickerData(rows) {
    const axisOptions = {};
    const combos = [];
    rows.forEach(r => {
        const entries = Object.entries(r.axis_values || {}).filter(([, v]) => v);
        if (entries.length === 1) {
            const [name, value] = entries[0];
            if (!axisOptions[name]) axisOptions[name] = [];
            axisOptions[name].push({ value, image_url: r.image_url || '', sort_order: r.sort_order || 0, image_urls_by_slot: r.image_urls_by_slot || null, image_urls_by_context: r.image_urls_by_context || null });
        } else if (entries.length >= 2) {
            combos.push({ values: r.axis_values, image_url: r.image_url || '', is_disabled: !!r.is_disabled, image_urls_by_slot: r.image_urls_by_slot || null, image_urls_by_context: r.image_urls_by_context || null });
        }
    });
    Object.keys(axisOptions).forEach(name => {
        axisOptions[name].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    return { axisOptions, combos };
}

// 選規格區用的軸資料（pickerAxisOptions / boxAxisOptions）每個選項都記著自己的 sort_order，
// 用這個明確排出軸的順序（軸序＝該軸選項裡最小的 sort_order），不要依賴 JS 物件 key
// 的插入順序這種隱含行為——接線盒規格那邊還要拿這個順序當作疊圖合成時的圖層順序，
// 排序邏輯一定要是明確、看得到規則的。
function sortedAxisNames(axisOptions) {
    return Object.keys(axisOptions).sort((a, b) => {
        const orderA = axisOptions[a].length ? Math.min(...axisOptions[a].map(o => o.sort_order || 0)) : 0;
        const orderB = axisOptions[b].length ? Math.min(...axisOptions[b].map(o => o.sort_order || 0)) : 0;
        return orderA - orderB;
    });
}

function pickerAxisNames() {
    return sortedAxisNames(pickerAxisOptions);
}

function variantFieldHtml(axisName) {
    const options = pickerAxisOptions[axisName] || [];

    const tilesHtml = options.map(o => `
        <button type="button" class="variant-tile" data-axis="${escapeHtml(axisName)}" data-value="${escapeHtml(o.value)}">
            ${o.image_url ? `<img src="${escapeHtml(o.image_url)}" alt="${escapeHtml(o.value)}">` : ''}
            <span>${escapeHtml(o.value)}</span>
        </button>`).join('');

    return `
        <div>
            <label class="field-label">${escapeHtml(axisName)}</label>
            <div class="flex flex-wrap items-center gap-2 mb-2">
                ${tilesHtml}
                <input type="text" class="variant-text-input-inline variant-text-input" data-axis="${escapeHtml(axisName)}" placeholder="${options.length ? '或直接輸入其他值' : '尚無選項，可直接輸入'}">
            </div>
        </div>`;
}

function renderMainPicker() {
    const fieldsEl = document.getElementById('variant-fields');
    const names = pickerAxisNames();
    fieldsEl.innerHTML = names.length
        ? names.map(name => variantFieldHtml(name)).join('')
        : '<p class="text-xs text-gray-400">還沒有設定規格，請按右上角「編輯規格」新增。</p>';
    wireVariantPicker();
}

function currentVariantValues() {
    const values = {};
    Object.keys(selectedVariant).forEach(axis => {
        if (selectedVariant[axis]) values[axis] = selectedVariant[axis];
    });
    document.querySelectorAll('.variant-text-input').forEach(inp => {
        const axis = inp.dataset.axis;
        if (!values[axis] && inp.value.trim()) values[axis] = inp.value.trim();
    });
    return values;
}

function manualVariantValues() {
    const values = currentVariantValues();
    autoSelectedAxes.forEach(axis => { delete values[axis]; });
    return values;
}

function clearAutoSelectedAxes() {
    autoSelectedAxes.forEach(axis => { selectedVariant[axis] = ''; });
    autoSelectedAxes.clear();
}

function findBestCombo(selectedValues) {
    const selectedEntries = Object.entries(selectedValues);
    if (!selectedEntries.length) return null;

    let best = null;
    let bestScore = 0;
    pickerCombos.forEach(combo => {
        const matches = selectedEntries.every(([k, v]) => combo.values[k] === v);
        if (!matches) return;
        const score = Object.keys(combo.values).length;
        if (score > bestScore) { best = combo; bestScore = score; }
    });
    return best;
}

function fullyTrackedAxisSet(axis) {
    let best = null;
    pickerCombos.forEach(c => {
        const keys = Object.keys(c.values);
        if (!keys.includes(axis)) return;
        if (!best || keys.length > best.length) best = keys;
    });
    return best;
}

function isValueDisabled(axis, value, otherSelectedValues) {
    const explicitlyDisabled = pickerCombos.some(combo => {
        if (!combo.is_disabled) return false;
        if (combo.values[axis] !== value) return false;
        return Object.entries(combo.values).every(([k, v]) => k === axis || otherSelectedValues[k] === v);
    });
    if (explicitlyDisabled) return true;

    const trackedAxes = fullyTrackedAxisSet(axis);
    if (!trackedAxes) return false;

    const sameShapeCombos = pickerCombos.filter(c => {
        const keys = Object.keys(c.values);
        return keys.length === trackedAxes.length && trackedAxes.every(a => keys.includes(a));
    });
    const enabledSameShapeCombos = sameShapeCombos.filter(c => !c.is_disabled);
    if (!enabledSameShapeCombos.length) return false;

    const pinned = { ...otherSelectedValues, [axis]: value };
    const pinnedKeys = trackedAxes.filter(a => a in pinned);
    const anyMatch = enabledSameShapeCombos.some(c => pinnedKeys.every(a => c.values[a] === pinned[a]));
    return !anyMatch;
}

function updateDisabledTiles() {
    const axisNames = pickerAxisNames();
    let changed = true;
    while (changed) {
        changed = false;
        const manual = manualVariantValues();

        Object.keys(selectedVariant).forEach(axis => {
            const value = selectedVariant[axis];
            if (!value) return;
            const others = { ...manual };
            delete others[axis];
            if (isValueDisabled(axis, value, others)) {
                selectedVariant[axis] = '';
                autoSelectedAxes.delete(axis);
                changed = true;
            }
        });

        const manualAfterClear = manualVariantValues();
        axisNames.forEach(axis => {
            if (selectedVariant[axis]) return;
            const options = pickerAxisOptions[axis] || [];
            // 只有 1 個選項的軸本來就不是「被其他選擇窄化到剩 1 個」，是原本就只有這一個值可選
            // ——這種軸交給 applyDefaultVariantSelections() 在一開始選好就好，這裡不用再自動選，
            // 不然使用者手動點掉之後，下一輪又會被這裡重新選回去，等於永遠取消不掉。
            if (options.length <= 1) return;
            const others = { ...manualAfterClear };
            const enabledValues = options.filter(o => !isValueDisabled(axis, o.value, others));
            if (enabledValues.length === 1) {
                selectedVariant[axis] = enabledValues[0].value;
                autoSelectedAxes.add(axis);
                changed = true;
            }
        });
    }

    document.querySelectorAll('.variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === selectedVariant[b.dataset.axis]);
    });

    const manual = manualVariantValues();
    document.querySelectorAll('.variant-tile').forEach(btn => {
        const axis = btn.dataset.axis;
        const value = btn.dataset.value;
        const others = { ...manual };
        delete others[axis];
        btn.disabled = isValueDisabled(axis, value, others);
    });
}

function updateVariantPreviewImage() {
    updateDisabledTiles();
    ensureBoxPickerCount(); // 架構的「接線盒數量」選了幾個，下面就要對應出現幾組接線盒規格選擇區
    updateCombinedLivePreview(); // 架構圖＋接線盒合成圖是同一張，架構這邊的選擇一變也要重畫
}

function applyDefaultVariantSelections() {
    pickerAxisNames().forEach(axis => {
        const options = pickerAxisOptions[axis] || [];
        if (options.length === 1) selectedVariant[axis] = options[0].value;
    });
    document.querySelectorAll('.variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === selectedVariant[b.dataset.axis]);
    });
}

function resetVariantPicker() {
    selectedVariant = {};
    autoSelectedAxes = new Set();
    document.querySelectorAll('.variant-tile.selected').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.variant-text-input').forEach(t => { t.value = ''; });
    applyDefaultVariantSelections();
    const qtyEl = document.getElementById('notif-qty');
    if (qtyEl) qtyEl.value = 1;
    const noteEl = document.getElementById('notif-note');
    if (noteEl) noteEl.value = '';
    updateVariantPreviewImage();
}

function wireVariantPicker() {
    selectedVariant = {};
    autoSelectedAxes = new Set();
    applyDefaultVariantSelections();

    document.querySelectorAll('.variant-text-input').forEach(textEl => {
        const axis = textEl.dataset.axis;
        textEl.addEventListener('input', () => {
            autoSelectedAxes.delete(axis);
            clearAutoSelectedAxes();
            if (textEl.value.trim() && selectedVariant[axis]) {
                selectedVariant[axis] = '';
                document.querySelectorAll('.variant-tile').forEach(b => {
                    if (b.dataset.axis === axis) b.classList.remove('selected');
                });
            }
            updateVariantPreviewImage();
        });
    });

    document.querySelectorAll('.variant-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            const axis = btn.dataset.axis;
            const value = btn.dataset.value;
            selectedVariant[axis] = (selectedVariant[axis] === value) ? '' : value;
            autoSelectedAxes.delete(axis);
            clearAutoSelectedAxes();
            document.querySelectorAll('.variant-tile').forEach(b => {
                if (b.dataset.axis === axis) b.classList.toggle('selected', b.dataset.value === selectedVariant[axis]);
            });
            document.querySelectorAll('.variant-text-input').forEach(t => {
                if (t.dataset.axis === axis) t.value = '';
            });
            updateVariantPreviewImage();
        });
    });

    updateVariantPreviewImage();
}

async function loadHoujiaoVariants() {
    const { data, error } = await fetchAllRows(() => sb.from('houjiao_variants').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }));
    if (error) {
        document.getElementById('variant-fields').innerHTML = `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    const built = buildPickerData(data || []);
    pickerAxisOptions = built.axisOptions;
    pickerCombos = built.combos;
    renderMainPicker();
}

/* ===================== 選規格區：接線盒規格（每個接線盒各自獨立選一組） =====================
   架構選到的「接線盒數量」（例如「2個」）決定下面出現幾組接線盒規格選擇區，每組的軸/選項/
   完整組合都是同一份資料（boxAxisOptions/boxCombos），但各自有自己的選取狀態
   （boxPickerStates[i]），彼此互相獨立、不共用選擇——除非勾了「與接線盒 1 一樣」。
   選好之後不是用一張事先準備好的照片，是把每個軸選到的那個選項自己的小圖，
   照軸的順序（跟編輯畫面「整個軸上移/下移」是同一個順序）疊在畫布上合成一張示意圖。 */

let boxAxisOptions = {};
let boxCombos = [];
let boxPickerStates = []; // [{ selectedVariant, autoSelectedAxes, linkedToFirst }, ...]，索引 0 永遠不會是 linkedToFirst

async function loadBoxVariants() {
    const { data, error } = await fetchAllRows(() => sb.from('houjiao_box_variants').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }));
    if (error) {
        console.error('讀取接線盒規格失敗：', error);
        return;
    }
    const built = buildPickerData(data || []);
    boxAxisOptions = built.axisOptions;
    boxCombos = built.combos;
}

// 架構那個軸「接線盒數量」的選項值是「1個」「2個」…這種文字，取開頭的數字當作要出現幾組。
function boxCountFromStructureSelection() {
    const values = currentVariantValues();
    const raw = values['接線盒數量'];
    if (!raw) return 0;
    const m = String(raw).match(/\d+/);
    return m ? Math.max(0, parseInt(m[0], 10)) : 0;
}

function boxPickerBlockHtml(i, state) {
    return `
        <div class="border rounded-lg p-3" data-box-index="${i}">
            <div class="flex items-center justify-between mb-2">
                <h4 class="font-bold text-sm">接線盒 ${i + 1}</h4>
                ${i > 0 ? `<label class="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" class="box-link-first-checkbox" ${state.linkedToFirst ? 'checked' : ''}>
                    與接線盒 1 一樣
                </label>` : ''}
            </div>
            <div class="box-variant-fields space-y-2 ${state.linkedToFirst ? 'hidden' : ''}"></div>
            <div class="flex items-center gap-2 mt-2 pt-2 border-t flex-wrap">
                <span class="text-xs text-gray-400 whitespace-nowrap">這個架構＋這個規格＋這個位置專屬的圖：</span>
                <img class="context-thumb hidden rounded border" alt="" style="width:32px;height:32px;">
                <span class="context-upload-status text-xs text-gray-400"></span>
                <label class="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                    上傳圖片
                    <input type="file" accept="image/*" class="hidden context-upload-input">
                </label>
                <button type="button" class="context-pick-existing-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap">選用已上傳</button>
                <button type="button" class="context-remove-btn hidden px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap">移除圖片</button>
            </div>
        </div>`;
}

function renderBoxPickersDom() {
    const container = document.getElementById('box-picker-container');
    if (!boxPickerStates.length) { container.innerHTML = ''; return; }
    container.innerHTML = boxPickerStates.map((state, i) => boxPickerBlockHtml(i, state)).join('');
    boxPickerStates.forEach((state, i) => wireBoxPicker(i));
}

// 「接線盒數量」實際有變的時候才重新整個畫過（畫過會照目前的選擇重新排版），
// 數量沒變的話什麼都不做，保留使用者已經選好的東西——不然架構隨便點別的軸
// （例如顏色），下面每個接線盒已經選好的規格都會被清空重來，體驗會很差。
function ensureBoxPickerCount() {
    const count = boxCountFromStructureSelection();
    if (count === boxPickerStates.length) return;
    while (boxPickerStates.length < count) boxPickerStates.push({ selectedVariant: {}, autoSelectedAxes: new Set(), linkedToFirst: false });
    boxPickerStates.length = count;
    renderBoxPickersDom();
}

// 跟 ensureBoxPickerCount 不同：不管數量有沒有變都強制重新整個畫過，用在「接線盒規格」
// 剛儲存完、或頁面剛載入完成的時候——這兩種情況畫面需要的是最新的軸/選項資料，
// 不能因為數量剛好沒變就跳過重畫。
function ensureBoxPickerCountForce() {
    const count = boxCountFromStructureSelection();
    while (boxPickerStates.length < count) boxPickerStates.push({ selectedVariant: {}, autoSelectedAxes: new Set(), linkedToFirst: false });
    boxPickerStates.length = count;
    renderBoxPickersDom();
}

function boxFieldHtml(axisName) {
    const options = boxAxisOptions[axisName] || [];
    const tilesHtml = options.map(o => `
        <button type="button" class="variant-tile box-variant-tile" data-axis="${escapeHtml(axisName)}" data-value="${escapeHtml(o.value)}">
            ${o.image_url ? `<img src="${escapeHtml(o.image_url)}" alt="${escapeHtml(o.value)}">` : ''}
            <span>${escapeHtml(o.value)}</span>
        </button>`).join('');
    return `
        <div>
            <label class="field-label">${escapeHtml(axisName)}</label>
            <div class="flex flex-wrap items-center gap-2 mb-2">
                ${tilesHtml}
                <input type="text" class="variant-text-input-inline box-variant-text-input" data-axis="${escapeHtml(axisName)}" placeholder="${options.length ? '或直接輸入其他值' : '尚無選項，可直接輸入'}">
            </div>
        </div>`;
}

function currentBoxVariantValues(i) {
    const state = boxPickerStates[i];
    if (!state) return {};
    const values = {};
    Object.keys(state.selectedVariant).forEach(axis => {
        if (state.selectedVariant[axis]) values[axis] = state.selectedVariant[axis];
    });
    const scopeEl = document.querySelector(`[data-box-index="${i}"]`);
    if (scopeEl) {
        scopeEl.querySelectorAll('.box-variant-text-input').forEach(inp => {
            const axis = inp.dataset.axis;
            if (!values[axis] && inp.value.trim()) values[axis] = inp.value.trim();
        });
    }
    return values;
}

function manualBoxVariantValues(i) {
    const values = currentBoxVariantValues(i);
    boxPickerStates[i].autoSelectedAxes.forEach(axis => { delete values[axis]; });
    return values;
}

function clearAutoSelectedBoxAxes(i) {
    const state = boxPickerStates[i];
    state.autoSelectedAxes.forEach(axis => { state.selectedVariant[axis] = ''; });
    state.autoSelectedAxes.clear();
}

function findBestBoxCombo(selectedValues) {
    const selectedEntries = Object.entries(selectedValues);
    if (!selectedEntries.length) return null;
    let best = null, bestScore = 0;
    boxCombos.forEach(combo => {
        const matches = selectedEntries.every(([k, v]) => combo.values[k] === v);
        if (!matches) return;
        const score = Object.keys(combo.values).length;
        if (score > bestScore) { best = combo; bestScore = score; }
    });
    return best;
}

function fullyTrackedBoxAxisSet(axis) {
    let best = null;
    boxCombos.forEach(c => {
        const keys = Object.keys(c.values);
        if (!keys.includes(axis)) return;
        if (!best || keys.length > best.length) best = keys;
    });
    return best;
}

function isBoxValueDisabled(axis, value, otherSelectedValues) {
    const explicitlyDisabled = boxCombos.some(combo => {
        if (!combo.is_disabled) return false;
        if (combo.values[axis] !== value) return false;
        return Object.entries(combo.values).every(([k, v]) => k === axis || otherSelectedValues[k] === v);
    });
    if (explicitlyDisabled) return true;

    const trackedAxes = fullyTrackedBoxAxisSet(axis);
    if (!trackedAxes) return false;

    const sameShapeCombos = boxCombos.filter(c => {
        const keys = Object.keys(c.values);
        return keys.length === trackedAxes.length && trackedAxes.every(a => keys.includes(a));
    });
    const enabledSameShapeCombos = sameShapeCombos.filter(c => !c.is_disabled);
    if (!enabledSameShapeCombos.length) return false;

    const pinned = { ...otherSelectedValues, [axis]: value };
    const pinnedKeys = trackedAxes.filter(a => a in pinned);
    const anyMatch = enabledSameShapeCombos.some(c => pinnedKeys.every(a => c.values[a] === pinned[a]));
    return !anyMatch;
}

function updateBoxDisabledTiles(i) {
    const state = boxPickerStates[i];
    const scopeEl = document.querySelector(`[data-box-index="${i}"]`);
    if (!state || !scopeEl) return;
    const axisNames = sortedAxisNames(boxAxisOptions);

    let changed = true;
    while (changed) {
        changed = false;
        const manual = manualBoxVariantValues(i);

        Object.keys(state.selectedVariant).forEach(axis => {
            const value = state.selectedVariant[axis];
            if (!value) return;
            const others = { ...manual };
            delete others[axis];
            if (isBoxValueDisabled(axis, value, others)) {
                state.selectedVariant[axis] = '';
                state.autoSelectedAxes.delete(axis);
                changed = true;
            }
        });

        const manualAfterClear = manualBoxVariantValues(i);
        axisNames.forEach(axis => {
            if (state.selectedVariant[axis]) return;
            const options = boxAxisOptions[axis] || [];
            // 理由同架構那邊：只有 1 個選項的軸不用「窄化」邏輯再自動選一次，不然手動點掉之後
            // 馬上又被選回去，永遠取消不掉。
            if (options.length <= 1) return;
            const others = { ...manualAfterClear };
            const enabledValues = options.filter(o => !isBoxValueDisabled(axis, o.value, others));
            if (enabledValues.length === 1) {
                state.selectedVariant[axis] = enabledValues[0].value;
                state.autoSelectedAxes.add(axis);
                changed = true;
            }
        });
    }

    scopeEl.querySelectorAll('.box-variant-tile').forEach(b => {
        b.classList.toggle('selected', b.dataset.value === state.selectedVariant[b.dataset.axis]);
    });

    const manual = manualBoxVariantValues(i);
    scopeEl.querySelectorAll('.box-variant-tile').forEach(btn => {
        const axis = btn.dataset.axis;
        const value = btn.dataset.value;
        const others = { ...manual };
        delete others[axis];
        btn.disabled = isBoxValueDisabled(axis, value, others);
    });
}

// 疊圖合成：把「架構」圖當底層，「接線盒規格」的合成圖疊在上面，畫成同一張圖——
// 只選了 1 個接線盒的話整張蓋滿疊上去；選了不只 1 個接線盒的話，每個接線盒的合成圖縮小、
// 並排畫在畫面下方那一條帶狀區域，彼此不重疊。每個接線盒自己的合成圖，則是照軸的順序
// 把目前選到的那個選項自己的小圖依序疊上去（先疊的在底層，後疊的蓋在上面）。
// 用一個遞增的 token 擋住「圖片還在下載時使用者又改了選擇」這種情況下畫面被舊結果蓋掉。
let combinedPreviewRenderToken = 0;

function loadImageEl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function drawImageContainInRect(ctx, img, x, y, w, h) {
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawImageContain(ctx, img, canvasW, canvasH) {
    drawImageContainInRect(ctx, img, 0, 0, canvasW, canvasH);
}

// 有選值但那個選項本身還沒設定圖片的軸，就借用「排序後第一個有圖的軸」的照片頂著疊上去
// （寧可同一張圖被畫好幾層看起來怪，也不要那一層整個開天窗）。真的完全没有任何軸有圖的話，
// 就沒有東西可以借，回傳空陣列（跟原本「完全沒圖就不合成」的行為一樣）。
// 架構的軸、接線盒的軸都是同一套規則，共用這個函式。slotIndex 是接線盒的位置編號
// （1、2、3…，架構不用位置編號的話傳 null），每個軸選項/完整組合都可以針對不同位置
// 各自上傳不同的照片（image_urls_by_slot），沒有針對那個位置特別設定的話就退回預設圖
// （image_url）。
function slotAwareImageUrl(row, slotIndex) {
    if (slotIndex && row.image_urls_by_slot && row.image_urls_by_slot[String(slotIndex)]) {
        return row.image_urls_by_slot[String(slotIndex)];
    }
    return row.image_url || '';
}

// 跟 slotAwareImageUrl 一樣，但多疊一層「這個架構＋這個位置」專屬圖（contextKey，
// 已經是算好的 comboKeyOf(架構)::位置編號 字串），比單純的位置圖更精確、優先權更高。
// 接線盒的軸選項（不是完整組合，例如只選了「產品」這一個軸）也可能設定過專屬圖，
// 所以疊圖合成（跟編輯彈窗的「單純只分位置」不一樣）要用這個。
function contextAwareImageUrl(row, slotIndex, contextKey) {
    if (contextKey && row.image_urls_by_context && row.image_urls_by_context[contextKey]) {
        return row.image_urls_by_context[contextKey];
    }
    return slotAwareImageUrl(row, slotIndex);
}

function resolveAxisLayerUrls(axisNames, axisOptions, selectedValues, slotIndex, contextKey) {
    const ownImageByAxis = {};
    axisNames.forEach(name => {
        const value = selectedValues[name];
        if (!value) return;
        const opt = (axisOptions[name] || []).find(o => o.value === value);
        if (opt) {
            const url = contextAwareImageUrl(opt, slotIndex, contextKey);
            if (url) ownImageByAxis[name] = url;
        }
    });
    const fallbackUrl = axisNames.map(name => ownImageByAxis[name]).find(Boolean) || null;

    return axisNames
        .filter(name => selectedValues[name])
        .map(name => ownImageByAxis[name] || fallbackUrl)
        .filter(Boolean);
}

// 畫出「架構＋所有接線盒」合成後的圖：先整張蓋滿畫 archLayers（架構的圖層），再依序整張
// 蓋滿疊上 boxLayerGroups 裡每個接線盒各自的圖層（順序對應接線盒 1、2、3…）——每張來源圖
// 都已經是同樣的 2000x1500，疊起來的相對位置由圖片本身的內容決定（例如接線盒 1 用畫在左邊
// 的版本、接線盒 2 用畫在右邊的版本），這裡不額外縮放/搬移。回傳一個畫好的離線 canvas，
// 不直接畫到畫面上，交給呼叫的人決定要顯示出來、還是轉成 dataURL 塞進 PDF／通知紀錄清單
// 的縮圖。
async function renderCombinedComposite(archLayers, boxLayerGroups, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    for (const url of archLayers) {
        const img = await loadImageEl(url);
        drawImageContainInRect(ctx, img, 0, 0, width, height);
    }

    for (const layerUrls of boxLayerGroups) {
        if (!layerUrls.length) continue;
        const imgs = await Promise.all(layerUrls.map(loadImageEl));
        imgs.forEach(img => drawImageContainInRect(ctx, img, 0, 0, width, height));
    }

    return canvas;
}

async function renderCombinedCompositeToDataUrl(archLayers, boxLayerGroups, width, height) {
    const canvas = await renderCombinedComposite(archLayers, boxLayerGroups, width, height);
    return canvas.toDataURL('image/png');
}

// 架構這邊「完整組合」本身也可以上傳一張圖（在「編輯架構」彈窗裡）——如果目前選到的架構軸
// 剛好對到一筆有上傳圖片的完整組合，就直接用那張（代表已經手動排好版的圖），不用再疊每個軸
// 自己的小圖；沒有對到才退回疊圖（含借圖規則）。架構不分接線盒位置，只有一份圖。
function resolveArchitectureLayerUrls(values) {
    const combo = findBestCombo(values);
    if (combo && combo.image_url) return [combo.image_url];
    const axisNames = sortedAxisNames(pickerAxisOptions);
    return resolveAxisLayerUrls(axisNames, pickerAxisOptions, values, null);
}

// 「architectureValues + slotIndex」換成 image_urls_by_context 用的 key——連架構都要對得上，
// 比 image_urls_by_slot 再多分一層。
function contextKeyFor(architectureValues, slotIndex) {
    return `${comboKeyOf(architectureValues || {})}::${slotIndex}`;
}

// 跟 findBestCombo／findBestBoxCombo 的「找最接近的」不一樣，這裡要精準對到完全一樣的軸組合
// 才算數，存專屬圖片用的（不然可能存錯到別的比較寬鬆但比對得上的組合去）。
function exactComboMatch(combos, values) {
    const key = comboKeyOf(values);
    return combos.find(c => comboKeyOf(c.values) === key) || null;
}

// 接線盒規格這邊「完整組合」可以上傳圖，而且分三層、由精確到概略依序退回：
// 1. 「這個架構＋這個接線盒規格＋這個位置」專屬圖（image_urls_by_context，在表單上針對當下
//    選到的組合直接上傳）
// 2. 「這個接線盒規格＋這個位置」的圖（image_urls_by_slot，不分架構，在「編輯接線盒規格」設定）
// 3. 這個接線盒規格的預設圖（image_url）
// 都沒有的話才退回疊每個軸自己的小圖（含借圖規則）。同一個規格（例如都選「一連型」），
// 接線盒 1 跟接線盒 2 可以疊出不一樣的畫面，不會完全疊在同一個位置。
function resolveBoxLayerUrls(selected, slotIndex, architectureValues) {
    const contextKey = architectureValues ? contextKeyFor(architectureValues, slotIndex) : null;

    const combo = findBestBoxCombo(selected);
    if (combo) {
        const url = contextAwareImageUrl(combo, slotIndex, contextKey);
        if (url) return [url];
    }
    const finalValues = combo ? { ...selected, ...combo.values } : selected;
    const axisNames = sortedAxisNames(boxAxisOptions);
    // 就算沒有對到完整組合（例如只選了單一軸），那個軸選項本身也可能設定過「這個架構＋
    // 這個位置」的專屬圖，所以退回疊軸圖時一樣要帶著 contextKey 去查，不能整個略過。
    return resolveAxisLayerUrls(axisNames, boxAxisOptions, finalValues, slotIndex, contextKey);
}

// 目前畫面上「架構＋所有接線盒」實際要疊的東西：架構圖層、每個接線盒各自的圖層清單
// （順序照 boxPickerStates，每個接線盒各自帶著自己的位置編號 i+1、以及目前的架構選擇，
// 去找專屬圖）。
function currentCombinedLayerUrls() {
    const architectureValues = currentVariantValues();
    const archLayers = resolveArchitectureLayerUrls(architectureValues);

    const boxLayerGroups = boxPickerStates.map((state, i) => {
        const selected = state.linkedToFirst ? currentBoxVariantValues(0) : currentBoxVariantValues(i);
        return resolveBoxLayerUrls(selected, i + 1, architectureValues);
    });

    return { archLayers, boxLayerGroups };
}

// 表單上方那張「架構＋接線盒」合成預覽圖，架構軸或任何一個接線盒的選擇一變就重畫一次。
function updateCombinedLivePreview() {
    const canvasEl = document.getElementById('variant-preview-canvas');
    if (!canvasEl) return;

    const { archLayers, boxLayerGroups } = currentCombinedLayerUrls();
    const hasContent = archLayers.length || boxLayerGroups.some(g => g.length);

    const myToken = ++combinedPreviewRenderToken;
    if (!hasContent) {
        canvasEl.classList.add('hidden');
    } else {
        renderCombinedComposite(archLayers, boxLayerGroups, canvasEl.width, canvasEl.height)
            .then(resultCanvas => {
                if (combinedPreviewRenderToken !== myToken) return; // 選擇又變了，這次結果過期了，不要蓋上去
                const ctx = canvasEl.getContext('2d');
                ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
                ctx.drawImage(resultCanvas, 0, 0);
                canvasEl.classList.remove('hidden');
            })
            .catch(err => {
                if (combinedPreviewRenderToken !== myToken) return;
                console.error('[打腳通知] 架構＋接線盒合成圖疊圖失敗：', err, archLayers, boxLayerGroups);
                canvasEl.classList.add('hidden');
            });
    }

    updateBoxContextIndicators();
}

// 每個接線盒規格區塊下面那排「這個架構＋這個規格＋這個位置專屬的圖」縮圖/移除按鈕，
// 跟著目前的架構、每個接線盒各自的選擇重新整理一次要不要顯示。
// 接線盒的選擇如果剛好對到一筆完整組合（2 個以上的軸），專屬圖存在那筆組合上；如果只選了
// 單一軸，那筆資料其實是被歸類成「軸選項」，不是「完整組合」（跟 categorizeVariantRows／
// buildPickerData 的分類規則一樣），要找/存的地方是 boxAxisOptions，不是 boxCombos——不然
// 只選一個軸的情況，資料存得到但讀不到（或存的時候找錯地方，把這個軸選項本來就有的預設圖
// 洗掉）。
function findExistingBoxRow(selected) {
    const entries = Object.entries(selected).filter(([, v]) => v);
    if (entries.length === 1) {
        const [axis, value] = entries[0];
        return (boxAxisOptions[axis] || []).find(o => o.value === value) || null;
    }
    if (entries.length >= 2) {
        return exactComboMatch(boxCombos, selected);
    }
    return null;
}

// 決定接線盒 i 目前該顯示的「專屬圖」縮圖網址：先看選到的規格有沒有剛好對到一筆完整組合、
// 這筆組合有沒有這個架構＋位置的專屬圖；沒有的話，再看目前選到的每個軸，有沒有哪個軸選項
// 自己就設定過這個架構＋位置的專屬圖（疊圖合成退回疊軸圖時，就是用軸選項各自的專屬圖）。
function resolveBoxContextThumbUrl(selected, architectureValues, slotIndex) {
    const key = contextKeyFor(architectureValues, slotIndex);
    const row = findExistingBoxRow(selected);
    return row && row.image_urls_by_context ? (row.image_urls_by_context[key] || null) : null;
}

function updateBoxContextIndicators() {
    const architectureValues = currentVariantValues();
    boxPickerStates.forEach((state, i) => {
        const scopeEl = document.querySelector(`[data-box-index="${i}"]`);
        if (!scopeEl) return;
        const thumbImg = scopeEl.querySelector('.context-thumb');
        const removeBtn = scopeEl.querySelector('.context-remove-btn');
        if (!thumbImg || !removeBtn) return;

        const selected = state.linkedToFirst ? currentBoxVariantValues(0) : currentBoxVariantValues(i);
        const url = resolveBoxContextThumbUrl(selected, architectureValues, i + 1);

        if (url) {
            thumbImg.src = url;
            thumbImg.classList.remove('hidden');
            removeBtn.classList.remove('hidden');
        } else {
            thumbImg.src = '';
            thumbImg.classList.add('hidden');
            removeBtn.classList.add('hidden');
        }
    });
}

// 表單上直接針對「目前選到的架構＋接線盒 i 目前選到的規格＋位置 i+1」這個精確組合存/移除
// 一張專屬圖片；用的是接線盒 i 實際選到的值當 axis_values（不是最佳比對展開後的），
// 跟其他「上傳圖片就順便建立這筆組合」的地方是同一套慣例。
async function saveBoxContextImage(i, url) {
    const architectureValues = currentVariantValues();
    const state = boxPickerStates[i];
    const selected = state.linkedToFirst ? currentBoxVariantValues(0) : currentBoxVariantValues(i);
    const key = contextKeyFor(architectureValues, i + 1);

    const existing = findExistingBoxRow(selected);
    const payload = {
        axis_values: selected,
        image_url: existing ? existing.image_url || null : null,
        image_urls_by_slot: existing ? existing.image_urls_by_slot || null : null,
        is_disabled: existing ? !!existing.is_disabled : false,
        sort_order: 0,
        image_urls_by_context: { ...(existing ? existing.image_urls_by_context || {} : {}), [key]: url },
    };
    const { error } = await sb.from('houjiao_box_variants').upsert(payload, { onConflict: 'axis_values' });
    if (error) throw error;
}

async function removeBoxContextImage(i) {
    const architectureValues = currentVariantValues();
    const state = boxPickerStates[i];
    const selected = state.linkedToFirst ? currentBoxVariantValues(0) : currentBoxVariantValues(i);
    const key = contextKeyFor(architectureValues, i + 1);

    const existing = findExistingBoxRow(selected);
    if (!existing || !existing.image_urls_by_context || !existing.image_urls_by_context[key]) return;

    const updatedContext = { ...existing.image_urls_by_context };
    delete updatedContext[key];
    const payload = {
        axis_values: selected,
        image_url: existing.image_url || null,
        image_urls_by_slot: existing.image_urls_by_slot || null,
        is_disabled: !!existing.is_disabled,
        sort_order: 0,
        image_urls_by_context: Object.keys(updatedContext).length ? updatedContext : null,
    };
    const { error } = await sb.from('houjiao_box_variants').upsert(payload, { onConflict: 'axis_values' });
    if (error) throw error;
}

// 表單上「選用已上傳」要選的清單，把目前已知的所有接線盒圖片（每個軸選項＋每筆完整組合，
// 含它們各自的預設圖/位置圖/架構專屬圖）攤平成一份給 promptPickExistingImage 用。
function allKnownBoxImageRows() {
    const rows = [];
    Object.values(boxAxisOptions).forEach(opts => rows.push(...opts));
    rows.push(...boxCombos);
    return rows;
}

function updateBoxPreview(i) {
    if (!boxPickerStates[i].linkedToFirst) updateBoxDisabledTiles(i);
    updateCombinedLivePreview();
}

function applyDefaultBoxSelections(i) {
    const state = boxPickerStates[i];
    sortedAxisNames(boxAxisOptions).forEach(axis => {
        const options = boxAxisOptions[axis] || [];
        if (options.length === 1) state.selectedVariant[axis] = options[0].value;
    });
}

function wireBoxPicker(i) {
    const scopeEl = document.querySelector(`[data-box-index="${i}"]`);
    if (!scopeEl) return;
    const state = boxPickerStates[i];

    const linkCb = scopeEl.querySelector('.box-link-first-checkbox');
    if (linkCb) {
        linkCb.addEventListener('change', () => {
            state.linkedToFirst = linkCb.checked;
            renderBoxPickersDom(); // 顯示/隱藏這個盒子自己的選擇區，整組重畫一次
        });
    }

    if (!state.linkedToFirst) {
        const fieldsEl = scopeEl.querySelector('.box-variant-fields');
        const names = sortedAxisNames(boxAxisOptions);
        fieldsEl.innerHTML = names.length
            ? names.map(name => boxFieldHtml(name)).join('')
            : '<p class="text-xs text-gray-400">還沒有設定接線盒規格，請按上面「編輯接線盒規格」新增。</p>';

        applyDefaultBoxSelections(i);

        scopeEl.querySelectorAll('.box-variant-text-input').forEach(textEl => {
            const axis = textEl.dataset.axis;
            textEl.addEventListener('input', () => {
                state.autoSelectedAxes.delete(axis);
                clearAutoSelectedBoxAxes(i);
                if (textEl.value.trim() && state.selectedVariant[axis]) {
                    state.selectedVariant[axis] = '';
                    scopeEl.querySelectorAll('.box-variant-tile').forEach(b => {
                        if (b.dataset.axis === axis) b.classList.remove('selected');
                    });
                }
                updateBoxPreview(i);
            });
        });

        scopeEl.querySelectorAll('.box-variant-tile').forEach(btn => {
            btn.addEventListener('click', () => {
                const axis = btn.dataset.axis;
                const value = btn.dataset.value;
                state.selectedVariant[axis] = (state.selectedVariant[axis] === value) ? '' : value;
                state.autoSelectedAxes.delete(axis);
                clearAutoSelectedBoxAxes(i);
                scopeEl.querySelectorAll('.box-variant-tile').forEach(b => {
                    if (b.dataset.axis === axis) b.classList.toggle('selected', b.dataset.value === state.selectedVariant[axis]);
                });
                scopeEl.querySelectorAll('.box-variant-text-input').forEach(t => {
                    if (t.dataset.axis === axis) t.value = '';
                });
                updateBoxPreview(i);
            });
        });
    }

    scopeEl.querySelector('.context-upload-input').addEventListener('change', async (e) => {
        const input = e.target;
        const file = input.files[0];
        if (!file) return;
        const statusEl = scopeEl.querySelector('.context-upload-status');
        statusEl.textContent = '上傳中…';
        try {
            const url = await uploadImageToCloudinary(file);
            await saveBoxContextImage(i, url);
            await loadBoxVariants(); // 重新整理 boxAxisOptions/boxCombos，讓剛存好的專屬圖立刻反映在合成預覽上
            statusEl.textContent = '';
            updateCombinedLivePreview();
        } catch (err) {
            statusEl.textContent = '';
            alert('上傳失敗：' + err.message);
        } finally {
            input.value = '';
        }
    });

    scopeEl.querySelector('.context-pick-existing-btn').addEventListener('click', async () => {
        const url = await promptPickExistingImage(allKnownBoxImageRows());
        if (!url) return;
        try {
            await saveBoxContextImage(i, url);
            await loadBoxVariants();
            updateCombinedLivePreview();
        } catch (err) {
            alert('儲存失敗：' + err.message);
        }
    });

    scopeEl.querySelector('.context-remove-btn').addEventListener('click', async () => {
        if (!confirm('確定要移除這張專屬圖片嗎？')) return;
        try {
            await removeBoxContextImage(i);
            await loadBoxVariants();
            updateCombinedLivePreview();
        } catch (err) {
            alert('移除失敗：' + err.message);
        }
    });

    updateBoxPreview(i);
}

document.getElementById('notif-submit-btn').addEventListener('click', async () => {
    const selected = currentVariantValues();
    if (!Object.keys(selected).length) { alert('請先選擇架構'); return; }

    const combo = findBestCombo(selected);
    const variantValues = combo ? { ...selected, ...combo.values } : selected;

    if (boxPickerStates.length) {
        const emptyBoxIdx = boxPickerStates.findIndex((state, i) => !Object.keys(currentBoxVariantValues(i)).length);
        if (emptyBoxIdx !== -1) { alert(`接線盒 ${emptyBoxIdx + 1} 還沒有選規格`); return; }
    }
    const boxValues = boxPickerStates.map((state, i) => {
        const boxSelected = currentBoxVariantValues(i);
        const boxCombo = findBestBoxCombo(boxSelected);
        return boxCombo ? { ...boxSelected, ...boxCombo.values } : boxSelected;
    });

    const qty = Number(document.getElementById('notif-qty').value) || 1;
    const note = document.getElementById('notif-note').value.trim();

    const { error } = await sb.from('houjiao_notifications').insert({
        variant_values: variantValues,
        box_values: boxValues,
        qty,
        note: note || null,
        created_by: currentUserDisplayName || currentUserEmail,
    });
    if (error) { alert('送出失敗：' + error.message); return; }

    resetVariantPicker();
    await loadNotifList(currentNotifDate || todayIso());
});

/* ===================== 通知紀錄清單 ===================== */

let currentNotifDate = '';

function todayIso() {
    return new Date().toLocaleDateString('en-CA');
}

// 把「本地時區的某一天」轉成正確的 UTC 邊界，query houjiao_notifications.created_at
// （timestamptz）用；不能直接拿 'YYYY-MM-DD' 當字串比對，不然遇到本地時區跟 UTC
// 不同天的時候（例如晚上），查詢範圍會偏掉一天。
function localDayRangeUtc(dateStr) {
    const start = new Date(dateStr + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { gte: start.toISOString(), lt: end.toISOString() };
}

// 一筆已經存好的通知紀錄，「架構＋所有接線盒」目前該疊的東西——跟畫面上即時預覽用的
// currentCombinedLayerUrls() 是同一套規則，只是這裡讀的是存好的資料
// （record.variant_values／record.box_values），不是使用者正在選的狀態。
function combinedLayerUrlsForRecord(record) {
    const architectureValues = record.variant_values || {};
    const archLayers = resolveArchitectureLayerUrls(architectureValues);
    const boxLayerGroups = (record.box_values || []).map((bv, i) => resolveBoxLayerUrls(bv, i + 1, architectureValues));
    return { archLayers, boxLayerGroups };
}

// PDF 版面／分頁的機制（waitForImages、renderHtmlPagesInto）沿用 pdf.js 共用的部分，
// 這裡只負責排出「打腳通知」這張單子本身的 HTML 內容。
async function buildHoujiaoNotificationHtml(record) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;'
        + 'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111;box-sizing:border-box;';

    const dateStr = record.created_at ? new Date(record.created_at).toLocaleString('zh-TW') : '';
    const boxValuesArr = record.box_values || [];

    const { archLayers, boxLayerGroups } = combinedLayerUrlsForRecord(record);
    const combinedImg = (archLayers.length || boxLayerGroups.some(g => g.length))
        ? await renderCombinedCompositeToDataUrl(archLayers, boxLayerGroups, 2000, 1500)
        : null;

    const boxLinesHtml = boxValuesArr.map((bv, i) =>
        `<div>接線盒 ${i + 1}：${escapeHtml(formatVariantSummary({ variant_values: bv }))}</div>`
    ).join('');

    container.innerHTML = `
        <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;">錦輝塑膠業有限公司 打腳通知</h1>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#374151;margin-bottom:16px;">
            <span>建立人：${escapeHtml(record.created_by || '')}</span>
            <span>時間：${escapeHtml(dateStr)}</span>
        </div>
        <hr style="border:none;border-top:1px solid #d1d5db;margin:12px 0;">
        ${combinedImg ? `<img src="${combinedImg}" style="display:block;max-width:100%;max-height:320px;object-fit:contain;margin:0 auto 16px;">` : ''}
        <div style="font-size:14px;color:#374151;line-height:1.8;">
            <div>架構：${escapeHtml(formatVariantSummary(record))}</div>
            <div>數量：${escapeHtml(String(record.qty))}</div>
            ${record.note ? `<div>備註：${escapeHtml(record.note)}</div>` : ''}
        </div>
        ${boxLinesHtml ? `
        <hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 8px;">接線盒明細</h2>
        <div style="font-size:14px;color:#374151;line-height:1.8;">${boxLinesHtml}</div>` : ''}
    `;
    return container;
}

async function generateHoujiaoNotificationPdf(record) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const container = await buildHoujiaoNotificationHtml(record);
    await renderHtmlPagesInto(doc, container, true);
    const dateForFile = record.created_at ? record.created_at.slice(0, 10) : todayIso();
    doc.save(`打腳通知_${dateForFile}_${record.id}.pdf`);
}

async function loadNotifList(dateStr) {
    currentNotifDate = dateStr;
    const listEl = document.getElementById('notif-list');
    listEl.innerHTML = '<p class="text-xs text-gray-400">載入中…</p>';

    const { gte, lt } = localDayRangeUtc(dateStr);
    const { data, error } = await sb.from('houjiao_notifications')
        .select('*')
        .gte('created_at', gte)
        .lt('created_at', lt)
        .order('created_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<p class="text-xs text-red-500">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    renderNotifList(data || []);
}

const TRASH_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
    </svg>`;

function renderNotifList(records) {
    const listEl = document.getElementById('notif-list');
    if (!records.length) {
        listEl.innerHTML = '<p class="text-xs text-gray-400">這天沒有通知紀錄。</p>';
        return;
    }
    listEl.innerHTML = records.map(r => {
        const boxLines = (r.box_values || []).map((bv, i) =>
            `<div>接線盒 ${i + 1}：${escapeHtml(formatVariantSummary({ variant_values: bv }))}</div>`
        ).join('');
        return `
        <div class="border rounded-lg p-3 mb-2" data-notif-id="${r.id}">
            <div class="flex justify-between items-start gap-2">
                <div class="flex gap-2 items-start min-w-0">
                    <img class="notif-thumb hidden w-16 h-12 object-contain rounded border bg-gray-50 flex-shrink-0" alt="">
                    <div class="text-sm">${escapeHtml(formatVariantSummary(r))}　<span class="font-bold">x${escapeHtml(String(r.qty))}</span></div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="text-xs text-gray-400 whitespace-nowrap">${escapeHtml(new Date(r.created_at).toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit' }))}</span>
                    <button type="button" class="notif-pdf-btn px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100 whitespace-nowrap">下載 PDF</button>
                    <button type="button" class="notif-delete-btn p-1 rounded border border-red-200 text-red-600 bg-white hover:bg-red-50" title="刪除這筆通知">${TRASH_ICON_SVG}</button>
                </div>
            </div>
            ${boxLines ? `<div class="text-xs text-gray-600 mt-1 space-y-0.5">${boxLines}</div>` : ''}
            ${r.note ? `<div class="text-xs text-gray-500 mt-1">備註：${escapeHtml(r.note)}</div>` : ''}
            <div class="text-xs text-gray-400 mt-1">建立人：${escapeHtml(r.created_by || '')}</div>
        </div>`;
    }).join('');

    // 縮圖是非同步疊圖出來的，不擋清單本身的顯示——每筆各自疊完再各自補上去，
    // 疊不出來（例如完全沒有圖）就維持原本的 hidden，不留空白破圖示。
    records.forEach(r => {
        const { archLayers, boxLayerGroups } = combinedLayerUrlsForRecord(r);
        if (!archLayers.length && !boxLayerGroups.some(g => g.length)) return;
        renderCombinedCompositeToDataUrl(archLayers, boxLayerGroups, 200, 150)
            .then(dataUrl => {
                const thumbEl = listEl.querySelector(`[data-notif-id="${r.id}"] .notif-thumb`);
                if (!thumbEl) return;
                thumbEl.src = dataUrl;
                thumbEl.classList.remove('hidden');
            })
            .catch(err => console.error('[打腳通知] 通知紀錄縮圖疊圖失敗：', err));
    });

    listEl.querySelectorAll('.notif-pdf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.closest('[data-notif-id]').dataset.notifId);
            const record = records.find(r => r.id === id);
            if (record) generateHoujiaoNotificationPdf(record);
        });
    });

    listEl.querySelectorAll('.notif-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.closest('[data-notif-id]').dataset.notifId);
            if (!confirm('確定要刪除這筆通知紀錄嗎？此動作無法復原。')) return;
            const { error } = await sb.from('houjiao_notifications').delete().eq('id', id);
            if (error) { alert('刪除失敗：' + error.message); return; }
            await loadNotifList(currentNotifDate || todayIso());
        });
    });
}

document.getElementById('notif-date-filter').addEventListener('change', (e) => {
    if (e.target.value) loadNotifList(e.target.value);
});
document.getElementById('notif-date-today-btn').addEventListener('click', () => {
    const t = todayIso();
    document.getElementById('notif-date-filter').value = t;
    loadNotifList(t);
});

async function initHoujiao() {
    await Promise.all([loadHoujiaoVariants(), loadBoxVariants()]);
    ensureBoxPickerCountForce(); // 架構跟接線盒規格都載入完了，確保接線盒選擇區數量/內容是最新的
    const t = todayIso();
    document.getElementById('notif-date-filter').value = t;
    await loadNotifList(t);
}

initScrollRestoration('houjiao');
initAdminAuth('houjiao', initHoujiao);
