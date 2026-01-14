const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};
let allProductsCache = null;

// --- 修正後的跳轉函式：確保導覽列同步更新 ---
function switchPage(page, params = {}) {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', page);
    for (const key in params) {
        u.searchParams.set(key, params[key]);
    }
    window.history.pushState({}, '', u);
    
    // 關鍵：更新當前頁面標記並重新渲染導覽列
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

// --- 強化後的 GAS 抓取：增加錯誤提示 ---
async function fetchGASProducts() {
    if (allProductsCache) return allProductsCache;
    try {
        const response = await fetch(GAS_PRODUCT_URL);
        if (!response.ok) throw new Error("GAS Network Error");
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Data format error");
        allProductsCache = data;
        return allProductsCache;
    } catch (e) {
        console.error("GAS Fetch Failed:", e);
        throw e;
    }
}

function handleRouting() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    if (page) {
        if (tabs.includes(page) || page === 'category' || page === 'product') {
            currentPage = page;
        }
    }
}

async function initWebsite() {
    try {
        handleRouting();
        rawDataCache['Content'] = await fetchSheetData('Content');
        renderLogoAndStores();
        updateLangButton();
        await renderNav();
        loadPage(currentPage, false);
    } catch (e) { console.error(e); }
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

function renderLogoAndStores() {
    const logoContainer = document.getElementById('logo-container');
    const storeContainer = document.getElementById('store-container');
    const data = rawDataCache['Content'] || [];
    logoContainer.innerHTML = ''; storeContainer.innerHTML = '';
    data.forEach(row => {
        const aCol = (row[0] || "").toLowerCase().trim();
        const imgUrl = (row[3] || "").trim();
        const linkUrl = (row[4] || "").trim() || "#";
        if (aCol === 'logo' && imgUrl) {
            logoContainer.innerHTML = `<a href="javascript:void(0)" onclick="switchPage('Content')"><img src="${imgUrl}" class="logo-img" alt="Logo"></a>`;
        }
        if (aCol.includes('store') && imgUrl) {
            const a = document.createElement('a');
            a.href = linkUrl; a.target = "_blank";
            a.innerHTML = `<img src="${imgUrl}" class="store-img hover:opacity-75 transition">`;
            storeContainer.appendChild(a);
        }
    });
}

// --- 修正：確保 active 狀態根據 currentPage 正確切換 ---
async function renderNav() {
    const nav = document.getElementById('main-nav');
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    let navHtml = '';
    for (const tab of tabs) {
        if (!rawDataCache[tab]) { rawDataCache[tab] = await fetchSheetData(tab); }
        const data = rawDataCache[tab];
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayName = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : tab;
        
        // 判斷邏輯：如果是分類頁或產品頁，則讓 "Product Catalog" 保持底線
        let isActive = (currentPage === tab) ? 'active' : '';
        if ((currentPage === 'product' || currentPage === 'category') && tab === 'Product Catalog') {
            isActive = 'active';
        }
        
        navHtml += `<li class="nav-item ${isActive} px-6 py-3 cursor-pointer" onclick="switchPage('${tab}')">${displayName}</li>`;
    }
    nav.innerHTML = navHtml;
}

// --- 渲染分類清單 ---
async function renderCategoryList() {
    const params = new URLSearchParams(window.location.search);
    const catName = params.get('cat');
    const app = document.getElementById('app');
    app.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;
    
    try {
        const allProducts = await fetchGASProducts();
        
        // 除錯檢查：如果抓回來的資料不是陣列
        if (!Array.isArray(allProducts)) {
            throw new Error("GAS returned invalid data format");
        }

        const filtered = allProducts.filter(p => {
            // 強制轉型為字串並去除空格後比對
            const pCat = p["Category"] ? String(p["Category"]).trim() : "";
            const targetCat = catName ? String(catName).trim() : "";
            return pCat === targetCat;
        });
        
        if (filtered.length === 0) {
            app.innerHTML = `
                <div class="text-center py-20">
                    <p class="text-gray-500 mb-4">分類「${catName}」中沒有找到任何產品。</p>
                    <button onclick="switchPage('Product Catalog')" class="text-blue-600 underline">返回目錄</button>
                    <div class="mt-4 p-4 bg-gray-100 text-xs text-left inline-block">
                        除錯資訊：GAS 總共抓到 ${allProducts.length} 筆資料
                    </div>
                </div>`;
            return;
        }

        let itemsHtml = filtered.map(item => {
            const name = (currentLang === 'zh') ? item["Chinese product name"] : item["English product name"];
            const img = item["圖片"] ? item["圖片"].split(",")[0].trim() : "";
            const code = item["Item code (ERP)"];
            return `
                <div class="category-card group cursor-pointer" onclick="switchPage('product', {id: '${code}'})">
                    <div class="category-img-container"><img src="${img}" class="w-full h-full object-cover group-hover:scale-110 transition"></div>
                    <div class="p-4 text-center"><p class="text-xs text-blue-600 font-bold mb-1">${code}</p><h4 class="font-bold text-gray-800 line-clamp-2">${name}</h4></div>
                </div>`;
        }).join('');

        const breadcrumbLabel = (currentLang === 'zh') ? '商品目錄' : 'Product Catalog';
        app.innerHTML = `<div class="max-w-6xl mx-auto px-4 text-left"><nav class="flex text-gray-500 text-sm mb-8 italic"><a href="javascript:void(0)" onclick="switchPage('Product Catalog')" class="hover:text-blue-600">${breadcrumbLabel}</a><span class="mx-2">&gt;</span><span class="text-gray-900 font-bold">${catName}</span></nav><div class="grid grid-cols-2 md:grid-cols-4 gap-6">${itemsHtml}</div></div>`;
    } catch (e) { 
        console.error("Detailed Error:", e);
        app.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">無法載入產品資料。<br><span class="text-sm font-normal text-gray-400">請確認 GAS 部署是否設為「所有人」以及網址是否正確。</span></div>`; 
    }
}

// --- 渲染產品詳情 ---
async function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const itemCode = params.get('id');
    const app = document.getElementById('app');
    try {
        const allProducts = await fetchGASProducts();
        const item = allProducts.find(p => String(p["Item code (ERP)"]).trim() == String(itemCode).trim());
        if (!item) { app.innerHTML = `<div class="text-center py-20">Product not found.</div>`; return; }
        const images = item["圖片"] ? item["圖片"].split(",").map(s => s.trim()) : [];
        const name = (currentLang === 'zh') ? item["Chinese product name"] : item["English product name"];
        const desc = (currentLang === 'zh') ? item["中文描述"] : item["英文描述"];
        const breadcrumbLabel = (currentLang === 'zh') ? '商品目錄' : 'Product Catalog';
        app.innerHTML = `
            <div class="max-w-6xl mx-auto px-4 text-left">
                <nav class="flex text-gray-500 text-sm mb-8 italic"><a href="javascript:void(0)" onclick="switchPage('Product Catalog')" class="hover:text-blue-600">${breadcrumbLabel}</a><span class="mx-2">&gt;</span><a href="javascript:void(0)" onclick="switchPage('category', {cat: '${item["Category"]}'})" class="hover:text-blue-600">${item["Category"]}</a><span class="mx-2">&gt;</span><span class="text-gray-900 font-bold">${itemCode}</span></nav>
                <div class="flex flex-col md:flex-row gap-12">
                    <div class="w-full md:w-1/2"><img id="main-prod-img" src="${images[0]}" class="w-full aspect-square object-cover rounded-2xl border shadow-sm"><div class="flex gap-3 mt-4 overflow-x-auto pb-2">${images.map(img => `<img src="${img}" onclick="document.getElementById('main-prod-img').src='${img}'" class="w-20 h-20 object-cover rounded-lg cursor-pointer border-2 border-transparent hover:border-blue-500 transition">`).join('')}</div></div>
                    <div class="w-full md:w-1/2"><h1 class="text-3xl font-black mb-2 text-gray-900">${name}</h1><p class="text-xl text-blue-600 font-bold mb-6">${itemCode}</p><div class="border-y py-6 mb-6"><p><span class="text-gray-400 mr-4">${currentLang === 'zh' ? '包裝規格' : 'Packing'}</span> <b>${item["Pcs / Packing"]} ${item["計量單位"]}</b></p></div><h4 class="font-bold text-gray-900 mb-3">${currentLang === 'zh' ? '商品描述' : 'Description'}</h4><p class="text-gray-600 leading-loose" style="white-space: pre-line;">${desc}</p></div>
                </div>
            </div>`;
    } catch (e) { app.innerHTML = `Error loading product.`; }
}

async function loadPage(pageName, updateUrl = true) {
    currentPage = pageName;
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    if (updateUrl) switchPage(pageName);

    if (pageName === 'category') { renderCategoryList(); return; }
    if (pageName === 'product') { renderProductDetail(); return; }

    if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
    const data = rawDataCache[pageName];

    // --- 分頁內容渲染邏輯 ---
    if (pageName === "Product Catalog") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const pdfKey = (currentLang === 'zh') ? 'chinese pdf button' : 'english pdf button';
        let pdfHtml = ''; let catHtml = '';
        data.forEach(row => {
            const rowKey = (row[0] || "").toLowerCase().trim();
            const displayText = row[langIdx];
            const imgUrl = (row[3] || "").trim();
            const valE = (row[4] || "").trim();
            if (rowKey.includes(pdfKey) && valE) pdfHtml += `<a href="${valE}" target="_blank" class="bg-red-600 text-white font-bold py-3 px-8 rounded-full mb-4 inline-block">${displayText}</a>`;
            if (rowKey.includes('categories') && displayText) {
                catHtml += `<div class="category-card group cursor-pointer" onclick="switchPage('category', {cat: '${valE}'})"><div class="category-img-container"><img src="${imgUrl}" class="w-full h-full object-cover"></div><div class="p-5 text-center bg-white border-t"><h4 class="font-bold text-gray-800 text-lg group-hover:text-blue-600 transition">${displayText}</h4></div></div>`;
            }
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-6 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="mb-10">${pdfHtml}</div><div class="grid grid-cols-2 md:grid-cols-4 gap-8 w-full max-w-6xl px-4">${catHtml}</div></div>`;
    } 
    else if (pageName === "Content" || pageName === "About Us") {
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
    else if (pageName === "Business Scope") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        let contentImages = '';
        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const target = (currentLang === 'zh') ? 'chinese content' : 'english content';
            if (key.includes(target) && row[3]) contentImages += `<img src="${row[3]}" class="home-bottom-image mb-8 max-w-2xl mx-auto block">`;
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full px-4">${contentImages}</div></div>`;
    }
    else if (pageName === "Join Us") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        let jobs = {};
        data.forEach(row => {
            const match = (row[0] || "").match(/\d+/);
            if (match) {
                const id = match[0];
                if (!jobs[id]) jobs[id] = {};
                if (row[0].toLowerCase().includes('position')) jobs[id].title = row[langIdx];
                if (row[0].toLowerCase().includes('description')) jobs[id].desc = row[langIdx];
            }
        });
        let jobsHtml = Object.values(jobs).map(job => `<div class="bg-white border rounded-2xl p-8 text-left shadow-sm"><h3 class="text-2xl font-black mb-4 border-b pb-4 text-gray-800">${job.title}</h3><p class="text-gray-600 leading-relaxed" style="white-space: pre-line;">${job.desc}</p></div>`).join('');
        app.innerHTML = `<div class="flex flex-col items-center py-10 px-4"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="grid md:grid-cols-2 gap-8 w-full max-w-6xl">${jobsHtml}</div></div>`;
    }
    else if (pageName === "Contact Us") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        let info = ''; let map = '';
        data.forEach(row => {
            if (row[0].toLowerCase().includes('info') && row[langIdx]) info += `<p class="text-xl text-gray-700 mb-4 font-medium">${row[langIdx]}</p>`;
            if (row[0].toLowerCase().includes('map') && row[4]) map = row[4];
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 px-4 text-center"><h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full max-w-2xl border-y py-8 mb-16">${info}</div><iframe src="${map}" width="100%" height="500" class="max-w-6xl rounded-2xl shadow-sm border" loading="lazy"></iframe></div>`;
    }
    window.scrollTo(0, 0);
}

initWebsite();

