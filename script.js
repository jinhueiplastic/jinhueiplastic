const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};
let allProductsCache = null;
// 在 script.js 頂部新增一個全域變數
let storeLogoMap = {}; 

function renderLogoAndStores() {
    const logoContainer = document.getElementById('logo-container');
    const storeContainer = document.getElementById('store-container');
    const data = rawDataCache['Content'] || [];
    logoContainer.innerHTML = ''; storeContainer.innerHTML = '';
    
    // 清空舊的 Map 重新填充
    storeLogoMap = {}; 

    data.forEach(row => {
        const aColRaw = (row[0] || "").trim(); // 原始字串如 "Store 1"
        const aColLower = aColRaw.toLowerCase();
        const imgUrl = (row[3] || "").trim();
        const linkUrl = (row[4] || "").trim() || "#";
        
        if (aColLower === 'logo' && imgUrl) {
            logoContainer.innerHTML = `<a href="javascript:void(0)" onclick="switchPage('Content')"><img src="${imgUrl}" class="logo-img" alt="Logo"></a>`;
        }
        
        // 關鍵：將 key 統一轉小寫存入 Map，避免比對出錯
        if (aColLower.startsWith('store') && imgUrl) {
            storeLogoMap[aColRaw] = imgUrl; // 這裡存 "Store 1"
            
            const a = document.createElement('a');
            a.href = linkUrl; a.target = "_blank";
            a.innerHTML = `<img src="${imgUrl}" class="store-img hover:opacity-75 transition">`;
            storeContainer.appendChild(a);
        }
    });
}

// --- 路由與導覽邏輯 ---
function switchPage(page, params = {}) {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', page);
    for (const key in params) { u.searchParams.set(key, params[key]); }
    window.history.pushState({}, '', u);
    
    currentPage = page;
    renderNav();
    loadPage(page, false); 
}

const getSheetUrl = (sheetName) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

async function fetchSheetData(sheetName) {
    try {
        const response = await fetch(getSheetUrl(sheetName));
        const text = await response.text();
        const json = JSON.parse(text.substring(47).slice(0, -2));
        return json.table.rows.map(row => 
            row.c.map(cell => (cell ? (cell.v || "").toString() : ""))
        );
    } catch (e) { return []; }
}

async function fetchGASProducts() {
    if (allProductsCache) return allProductsCache;
    try {
        const response = await fetch(GAS_PRODUCT_URL);
        const data = await response.json();
        allProductsCache = data;
        return allProductsCache;
    } catch (e) { console.error("GAS Error:", e); throw e; }
}

function handleRouting() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    const query = params.get('q'); // 取得搜尋字串

    if (page === 'search' && query) {
        currentPage = 'search';
        executeSearch(query);
    } else if (page && (tabs.includes(page) || page === 'category' || page === 'product')) {
        currentPage = page;
    }
}

// --- 搜尋功能邏輯 ---
async function handleSearch() {
    const query = document.getElementById('product-search-input').value.toLowerCase().trim();
    if (!query) return;

    // --- 新增：更新網址列，但不觸發頁面刷新 ---
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', 'search');
    u.searchParams.set('q', query);
    window.history.pushState({ type: 'search', query: query }, '', u);
    // ---------------------------------------

    executeSearch(query); // 將搜尋邏輯拆分出來
}

// 抽離出來的搜尋執行邏輯
async function executeSearch(query) {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="flex justify-center items-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const filtered = allProducts.filter(p => {
            const keys = Object.keys(p);
            const colA = String(p[keys[0]] || "").trim();
            if (!colA) return false; 

            const itemCode = String(p[keys[1]] || "").toLowerCase();
            const chineseName = String(p[keys[3]] || "").toLowerCase();
            const englishName = String(p[keys[6]] || "").toLowerCase();
            const searchKeywords = String(p["搜尋關鍵字"] || p[keys[33]] || "").toLowerCase();
            
            return itemCode.includes(query) || chineseName.includes(query) || 
                   englishName.includes(query) || searchKeywords.includes(query);
        });

        renderSearchResults(filtered, query);
        
        // 搜尋完畢後，確保搜尋框出現在頂部
        if (!document.getElementById('product-search-input')) {
            app.insertAdjacentHTML('afterbegin', `<div class="max-w-7xl mx-auto px-4">${getSearchBoxHtml()}</div>`);
        }
    } catch (e) {
        app.innerHTML = `<div class="text-center py-20 text-red-500">搜尋出錯。</div>`;
    }
}

function renderSearchResults(products, query) {
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    const title = currentLang === 'zh' ? `搜尋結果: ${query}` : `Search Results: ${query}`;
    
    let itemsHtml = products.map(item => {
        const name = (currentLang === 'zh') ? (item["Chinese product name"] || item["Item code (ERP)"]) : (item["English product name"] || item["Item code (ERP)"]);
        const img = item["圖片"] ? item["圖片"].split(",")[0].trim() : "";
        const code = item["Item code (ERP)"];
        return `
            <div class="category-card group cursor-pointer" onclick="switchPage('product', {id: '${code}'})">
                <div class="category-img-container"><img src="${img}" class="hover:scale-110 transition duration-500"></div>
                <div class="p-4 text-center">
                    <p class="text-xs text-blue-600 font-bold mb-1">${code}</p>
                    <h4 class="font-bold text-gray-800">${name}</h4>
                </div>
            </div>`;
    }).join('');

    app.innerHTML = `
        <div class="max-w-7xl mx-auto px-4">
            <h2 class="text-2xl font-bold mb-8 pb-2 border-b">${title}</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                ${itemsHtml || `<p class="col-span-full text-center py-10 text-gray-400">${currentLang === 'zh' ? '找不到相關商品' : 'No products found'}</p>`}
            </div>
        </div>`;
}

// 產生搜尋欄的 HTML 結構
function getSearchBoxHtml() {
    const placeholder = currentLang === 'zh' ? '搜尋產品編號或名稱...' : 'Search item code or name...';
    return `
        <div class="flex justify-end mb-6">
            <div class="relative w-full max-w-xs flex gap-2">
                <input type="text" id="product-search-input" 
                    class="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" 
                    placeholder="${placeholder}"
                    onkeypress="if(event.key === 'Enter') handleSearch()">
                <button onclick="handleSearch()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </div>
        </div>`;
}

async function initWebsite() {
    handleRouting();
    
    // 1. 先抓取 Content 並建立 Logo Map
    rawDataCache['Content'] = await fetchSheetData('Content');
    renderLogoAndStores(); // 執行這行後 storeLogoMap 才會被填入
    
    // 2. 預先抓取 Product Catalog 連結資料
    rawDataCache['Product Catalog'] = await fetchSheetData('Product Catalog');
    
    updateLangButton();
    await renderNav();
    
    // 3. 最後才載入頁面，此時資料都已經在快取裡了
    loadPage(currentPage, false);
}

function updateLangButton() {
    const btn = document.getElementById('lang-toggle-btn');
    btn.innerText = (currentLang === 'zh') ? 'EN' : '中';
}

function toggleLang() {
    currentLang = (currentLang === 'zh') ? 'en' : 'zh';
    updateLangButton();
    renderNav();
    loadPage(currentPage, false);
}

async function renderNav() {
    const nav = document.getElementById('main-nav');
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    let navHtml = '';
    for (const tab of tabs) {
        if (!rawDataCache[tab]) { rawDataCache[tab] = await fetchSheetData(tab); }
        const data = rawDataCache[tab];
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayName = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : tab;
        
        let isActive = (currentPage === tab) ? 'active' : '';
        if ((currentPage === 'product' || currentPage === 'category') && tab === 'Product Catalog') {
            isActive = 'active';
        }
        navHtml += `<li class="nav-item ${isActive} px-6 py-3 cursor-pointer" onclick="switchPage('${tab}')">${displayName}</li>`;
    }
    nav.innerHTML = navHtml;
}

async function loadPage(pageName, updateUrl = true) {
    if (updateUrl) switchPage(pageName);
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    // 先判斷是否為商品相關頁面，若是則先插入搜尋欄框架
    const isProductPage = ['Product Catalog', 'category', 'product', 'search'].includes(pageName);

    if (pageName === 'category') { await renderCategoryList(); }
    else if (pageName === 'product') { await renderProductDetail(); }
    else {
        if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
        const data = rawDataCache[pageName];

        if (pageName === "Product Catalog") {
            renderProductCatalog(data, langIdx);
        } else if (pageName === "Content" || pageName === "About Us") {
            renderAboutOrContent(data, langIdx, pageName);
        } else if (pageName === "Business Scope") {
            renderBusinessScope(data, langIdx, pageName);
        } else if (pageName === "Join Us") {
            renderJoinUs(data, langIdx, pageName);
        } else if (pageName === "Contact Us") {
            renderContactUs(data, langIdx, pageName);
        }
    }

    // 如果是商品相關頁面，在最前面加上搜尋框
    if (isProductPage) {
        app.insertAdjacentHTML('afterbegin', getSearchBoxHtml());
    }

    window.scrollTo(0, 0);
}

function getLocalizedCategoryName(rawCatName) {
    const data = rawDataCache["Product Catalog"];
    if (!data) return rawCatName;
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    const row = data.find(r => r[4] && r[4].trim() === rawCatName.trim());
    return (row && row[langIdx]) ? row[langIdx] : rawCatName;
}

function parseMarkdownTable(text) {
    if (!text) return "";
    const lines = text.split('\n');
    let html = '';
    let tableBuffer = [];
    let isProcessingTable = false;
    
    for (let i = 0; i <= lines.length; i++) {
        // 這裡保持原有的 null 判定邏輯，但不要自動 .trim() 掉所有空行
        // 這樣我們才能偵測到 Google Sheet 裡的「隔行」
        const rawLine = lines[i];
        const line = rawLine !== undefined ? rawLine.trim() : null;
        
        const isTableLine = line && line.startsWith('|') && line.includes('|');
        const isSeparator = line && line.match(/^[|:\s-]+$/);
        
        if (isTableLine && !isSeparator) {
            isProcessingTable = true;
            let cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
            tableBuffer.push(cells);
            continue;
        }
        
        if ((!isTableLine || i === lines.length) && isProcessingTable) {
            if (tableBuffer.length > 0) {
                // --- 這裡開始是您原本強大的表格渲染邏輯，完全保留 ---
                html += '<div class="overflow-x-auto my-4"><table class="custom-data-table">';
                html += '<thead><tr>';
                tableBuffer[0].forEach(cell => html += `<th>${cell}</th>`);
                html += '</tr></thead><tbody>';
                const dataRows = tableBuffer.slice(1);
                const rowCount = dataRows.length;
                const colCount = tableBuffer[0].length;
                let skipMap = Array.from({ length: rowCount }, () => Array(colCount).fill(false));
                for (let r = 0; r < rowCount; r++) {
                    html += '<tr>';
                    for (let c = 0; c < colCount; c++) {
                        if (skipMap[r][c]) continue;
                        let cellContent = dataRows[r][c];
                        let rowspan = 1; let colspan = 1;
                        for (let nextC = c + 1; nextC < colCount; nextC++) {
                            if (dataRows[r][nextC] === '>') {
                                colspan++; skipMap[r][nextC] = true;
                            } else break;
                        }
                        if (cellContent !== '^' && cellContent !== '>') {
                            for (let nextR = r + 1; nextR < rowCount; nextR++) {
                                if (dataRows[nextR][c] === '^') {
                                    rowspan++; skipMap[nextR][c] = true;
                                    for(let spanC = 1; spanC < colspan; spanC++) skipMap[nextR][c + spanC] = true;
                                } else break;
                            }
                        } else continue;
                        let cellClass = "";
                        if (cellContent.startsWith('#')) {
                            cellClass = "no-border-cell"; cellContent = cellContent.substring(1);
                        }
                        const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
                        const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
                        html += `<td${rowspanAttr}${colspanAttr} class="${cellClass}">${cellContent}</td>`;
                    }
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
                // --- 表格渲染邏輯結束 ---
            }
            tableBuffer = []; isProcessingTable = false;
        }

        // --- 核心修正：處理圖片與文字段落 ---
        if (line !== null && !isTableLine && !isSeparator) {
            const isImageUrl = line.match(/^https?:\/\/.*\.(jpg|jpeg|png|webp|gif|svg)$/i);
            if (isImageUrl) {
                html += `<div class="content-image-wrapper my-6"><img src="${line}" class="max-w-full h-auto rounded-lg shadow-md mx-auto"></div>`;
            } else if (line === "" && i < lines.length) {
                // 這是重點：如果遇到空行，補一個 <br> 標籤，達成 Google Sheet 中的隔行效果
                html += `<br>`;
            } else if (line !== "") {
                // 您原本的文字包裝
                html += `<p class="mb-2">${line}</p>`;
            }
        }
    }
    return html;
}

async function renderCategoryList() {
    const params = new URLSearchParams(window.location.search);
    const rawCatName = params.get('cat');
    const app = document.getElementById('app');
    app.innerHTML = `<div class="flex justify-center items-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;
    try {
        const allProducts = await fetchGASProducts();
        const filtered = allProducts.filter(p => String(p["Category"] || "").trim() === String(rawCatName).trim());
        const localizedCatName = getLocalizedCategoryName(rawCatName);
        const breadcrumbLabel = (currentLang === 'zh') ? '商品目錄' : 'Product Catalog';
        let itemsHtml = filtered.map(item => {
            const name = (currentLang === 'zh') ? (item["Chinese product name"] || item["Item code (ERP)"]) : (item["English product name"] || item["Item code (ERP)"]);
            const img = item["圖片"] ? item["圖片"].split(",")[0].trim() : "";
            const code = item["Item code (ERP)"];
            return `<div class="category-card group cursor-pointer" onclick="switchPage('product', {id: '${code}'})">
                <div class="category-img-container"><img src="${img}" class="hover:scale-110 transition duration-500"></div>
                <div class="p-4 text-center"><p class="text-xs text-blue-600 font-bold mb-1">${code}</p><h4 class="font-bold text-gray-800">${name}</h4></div>
            </div>`;
        }).join('');
        app.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 text-left">
                <nav class="text-gray-500 text-sm mb-8 italic">
                    <a href="javascript:void(0)" onclick="switchPage('Product Catalog')" class="hover:text-blue-600">${breadcrumbLabel}</a> 
                    <span class="mx-2">&gt;</span> 
                    <span class="text-gray-900 font-bold">${localizedCatName}</span>
                </nav>
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">${itemsHtml || '<p>No products.</p>'}</div>
            </div>`;
    } catch (e) { app.innerHTML = `<div class="text-center py-20 text-red-500">載入失敗。</div>`; }
}

async function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const itemCode = params.get('id');
    const app = document.getElementById('app');
    
    app.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const item = allProducts.find(p => String(p["Item code (ERP)"] || "").trim() == String(itemCode).trim());
        
        if (!item) {
            app.innerHTML = `<div class="text-center py-20">${currentLang === 'zh' ? '找不到商品內容。' : 'Product not found.'}</div>`;
            return;
        }

        // --- 1. 建立 Logo 圖庫 (來源：主試算表 Product Catalog 分頁) ---
        if (!rawDataCache["Product Catalog"]) {
            rawDataCache["Product Catalog"] = await fetchSheetData("Product Catalog");
        }
        
        const logoLibrary = {};
        rawDataCache["Product Catalog"].forEach(row => {
            const rawName = String(row[0] || "").trim(); // A 欄
            const logoUrl = String(row[4] || "").trim(); // E 欄
            if (rawName.toLowerCase().startsWith("store") && logoUrl) {
                const cleanKey = rawName.toLowerCase().replace(/\s+/g, '');
                logoLibrary[cleanKey] = logoUrl;
            }
        });

        // --- 2. 處理該商品的專屬賣場連結 (從 GAS 商品資料抓取) ---
        let storeLinksHtml = '';
        const storeMapping = [
            { key: "Store 1網址", id: "store1" },
            { key: "Store 2網址", id: "store2" },
            { key: "Store 3網址", id: "store3" },
            { key: "Store 4網址", id: "store4" }
        ];

        storeMapping.forEach(store => {
            const storeUrl = (item[store.key] || "").trim();
            const logoUrl = logoLibrary[store.id];
            if (storeUrl && storeUrl !== "#" && logoUrl) {
                storeLinksHtml += `
                    <a href="${storeUrl}" target="_blank" class="hover:scale-110 transition shrink-0 block">
                        <img src="${logoUrl}" alt="${store.id}" class="h-10 w-auto shadow-sm rounded border bg-white p-1">
                    </a>`;
            }
        });

        // --- 3. 語言切換邏輯 ---
        const isZH = (currentLang === 'zh');
        const rawCatName = (item["Category"] || item["分類"] || "").trim();
        const localizedCatName = typeof getLocalizedCategoryName === 'function' ? getLocalizedCategoryName(rawCatName) : rawCatName;
        
        const labelCatalog = isZH ? '商品目錄' : 'Product Catalog';
        const labelPacking = isZH ? '包裝規格' : 'Packing';
        const labelCategory = isZH ? '商品分類' : 'Category';
        const labelSpecs = isZH ? '商品描述與規格' : 'Specifications';
        
        const name = isZH ? (item["Chinese product name"] || item["中文名稱"] || itemCode) : (item["English product name"] || item["英文名稱"] || itemCode);
        const desc = isZH ? (item["Description中文描述"] || item["中文描述"] || "") : (item["English description英文描述"] || item["英文名稱"] || "");
        const packing = item["Packing規格"] || item["Pcs / Packing"] || "--";
        const unit = item["Unit單位"] || item["計量單位"] || "";
        const images = item["圖片"] ? String(item["圖片"]).split(",").map(s => s.trim()) : [];

        // --- 4. 渲染 HTML ---
        app.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 text-left">
                <nav class="flex text-gray-400 text-sm mb-8 italic">
                    <span class="cursor-pointer hover:text-blue-600" onclick="switchPage('Product Catalog')">${labelCatalog}</span>
                    <span class="mx-2">&gt;</span>
                    <span class="cursor-pointer hover:text-blue-600" onclick="switchPage('category', {cat: '${rawCatName}'})">${localizedCatName}</span>
                </nav>

                <div class="flex flex-col md:flex-row gap-12">
                    <div class="w-full md:w-1/2">
                        <img id="main-prod-img" src="${images[0] || ''}" class="w-full rounded-2xl shadow-xl border bg-white aspect-square object-contain" onerror="this.src='https://via.placeholder.com/600x600?text=No+Image'">
                        <div class="flex gap-3 mt-6 overflow-x-auto pb-2">
                            ${images.map(img => `<img src="${img}" onclick="document.getElementById('main-prod-img').src='${img}'" class="w-20 h-20 object-cover rounded-lg cursor-pointer border-2 hover:border-blue-500 bg-white transition shadow-sm">`).join('')}
                        </div>
                    </div>

                    <div class="w-full md:w-1/2 flex flex-col">
                        <div class="flex items-start justify-between gap-4 mb-2">
                            <h1 class="text-4xl font-black text-gray-900 leading-tight flex-1">${name}</h1>
                            <div class="flex items-center gap-3 pt-1 justify-end">
                                ${storeLinksHtml}
                            </div>
                        </div>
                        
                        <p class="text-2xl text-blue-600 font-bold mb-8">${itemCode}</p>
                        
                        <div class="bg-gray-50 rounded-2xl p-8 mb-8 border border-gray-100 shadow-sm">
                            <div class="grid grid-cols-2 gap-8">
                                <div>
                                    <span class="text-gray-400 block text-xs uppercase tracking-wider mb-1">${labelPacking}</span>
                                    <b class="text-xl text-gray-800">${packing} ${unit}</b>
                                </div>
                                <div>
                                    <span class="text-gray-400 block text-xs uppercase tracking-wider mb-1">${labelCategory}</span>
                                    <b class="text-xl text-gray-800">${localizedCatName}</b>
                                </div>
                            </div>
                        </div>

                        <div class="prose prose-slate max-w-none">
                            <h4 class="text-lg font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-500 inline-block">${labelSpecs}</h4>
                            <div class="text-gray-600 leading-relaxed mt-2">
                                ${typeof parseMarkdownTable === 'function' ? parseMarkdownTable(desc) : desc}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

    } catch (e) { 
        console.error("渲染出錯:", e); 
        app.innerHTML = `<div class="text-center py-20 text-red-500">${currentLang === 'zh' ? '載入失敗。' : 'Loading failed.'}</div>`; 
    }
}

function renderJoinUs(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let jobs = {};
    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        const match = key.match(/\d+/);
        if (match) {
            const id = match[0];
            if (!jobs[id]) jobs[id] = { title: "", desc: "" };
            if (key.includes('position')) jobs[id].title = row[langIdx] || "";
            if (key.includes('description')) jobs[id].desc = row[langIdx] || "";
        }
    });
    let jobsHtml = Object.values(jobs).filter(j => j.title.trim() !== "").map(j => `
        <div class="bg-white border rounded-2xl p-8 text-left shadow-sm">
            <h3 class="text-2xl font-black mb-4 border-b pb-4 text-blue-700">${j.title}</h3>
            <p class="text-gray-600 leading-relaxed" style="white-space: pre-line;">${j.desc}</p>
        </div>`).join('');
    app.innerHTML = `<div class="flex flex-col items-center py-10 px-4"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="grid md:grid-cols-2 gap-8 w-full max-w-6xl">${jobsHtml || '<p class="text-gray-400">目前暫無職缺。</p>'}</div></div>`;
}

function renderProductCatalog(data, langIdx) {
    const app = document.getElementById('app');
    let catHtml = '';
    data.forEach(row => {
        if (row[0].toLowerCase().trim().includes('categories') && row[langIdx]) {
            catHtml += `<div class="category-card group cursor-pointer" onclick="switchPage('category', {cat: '${row[4]}'})"><div class="category-img-container"><img src="${row[3]}"></div><div class="p-5 text-center bg-white border-t"><h4 class="font-bold text-gray-800">${row[langIdx]}</h4></div></div>`;
        }
    });
    app.innerHTML = `<div class="flex flex-col items-center py-6 w-full"><div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 w-full max-w-7xl px-4">${catHtml}</div></div>`;
}

function renderAboutOrContent(data, langIdx, pageName) {
    const app = document.getElementById('app');
    let upperImages = ''; let companyNames = ''; let introContent = ''; let addressBlock = ''; let bottomImages = '';
    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        if (key.includes('upper image') && row[3]) upperImages += `<img src="${row[3]}" class="home-bottom-image">`;
        if (key.includes('company name')) companyNames += `<div class="mb-6"><h2 class="text-3xl font-black text-gray-900">${row[1]}</h2><h3 class="text-xl font-bold text-gray-400 mt-2">${row[2]}</h3></div>`;
        if (key.includes('introduction title')) introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${row[langIdx]}</h4>`;
        if (key.includes('introduction') && !key.includes('title')) introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${row[langIdx]}</p>`;
        if (key.includes('address')) addressBlock += `<p class="text-lg font-medium text-gray-500">${row[langIdx]}</p>`;
        if (key.includes('bottom image') && row[3]) bottomImages += `<img src="${row[3]}" class="home-bottom-image">`;
    });
    if (pageName === "About Us") {
        app.innerHTML = `<div class="w-full flex flex-col items-center py-10">${upperImages ? `<div class="image-grid-container px-4 mb-16">${upperImages}</div>` : ''}<div class="max-w-6xl w-full px-4 flex flex-col md:flex-row gap-12 items-start text-left"><div class="w-full md:w-1/3">${companyNames}</div><div class="w-full md:w-2/3">${introContent}</div></div><div class="text-center py-10 w-full border-t mt-16 px-4">${addressBlock}</div>${bottomImages ? `<div class="image-grid-container px-4 mt-10">${bottomImages}</div>` : ''}</div>`;
    } else {
        app.innerHTML = `<div class="flex flex-col items-center text-center py-10 w-full px-4"><div class="w-full mb-8">${companyNames}</div><div class="w-full mb-8 text-gray-500">${addressBlock}</div><div class="image-grid-container px-4">${bottomImages}</div></div>`;
    }
}

function renderBusinessScope(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let contentImages = '';
    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        const target = (currentLang === 'zh') ? 'chinese content' : 'english content';
        if (key.includes(target) && row[3]) contentImages += `<img src="${row[3]}" class="home-bottom-image mb-8 max-w-4xl mx-auto block">`;
    });
    app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full px-4">${contentImages}</div></div>`;
}

function renderContactUs(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let info = ''; let map = '';
    data.forEach(row => {
        if (row[0].toLowerCase().includes('info') && row[langIdx]) info += `<p class="text-xl text-gray-700 mb-4 font-medium">${row[langIdx]}</p>`;
        if (row[0].toLowerCase().includes('map') && row[4]) map = row[4];
    });
    app.innerHTML = `<div class="flex flex-col items-center py-10 px-4 text-center"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full max-w-2xl border-y py-8 mb-16">${info}</div><iframe src="${map}" width="100%" height="500" class="max-w-6xl rounded-2xl shadow-sm border" loading="lazy"></iframe></div>`;
}

window.onpopstate = function(event) {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page') || 'Content';
    const query = params.get('q');

    if (page === 'search' && query) {
        executeSearch(query);
    } else {
        currentPage = page;
        loadPage(page, false);
    }
    renderNav();
};

initWebsite();



















