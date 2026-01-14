const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};
let allProductsCache = null;

// --- 修正後的跳轉函式：確保中文參數不報錯 ---
function switchPage(page, params = {}) {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', page);
    for (const key in params) {
        // 使用 encodeURIComponent 確保中文分類不失效
        u.searchParams.set(key, params[key]);
    }
    window.history.pushState({}, '', u);
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
        allProductsCache = await response.json();
        return allProductsCache;
    } catch (e) { throw e; }
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
    renderNav(); // 立即刷新導覽列文字
    loadPage(currentPage, false); // 立即刷新頁面內容
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
        if ((currentPage === 'product' || currentPage === 'category') && tab === 'Product Catalog') isActive = 'active';
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
        // 增加 trim() 避免空格導致的比對失敗
        const filtered = allProducts.filter(p => String(p["Category"]).trim() === String(catName).trim());
        
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
        app.innerHTML = `<div class="max-w-6xl mx-auto px-4"><nav class="flex text-gray-500 text-sm mb-8 italic"><a href="javascript:void(0)" onclick="switchPage('Product Catalog')" class="hover:text-blue-600">${breadcrumbLabel}</a><span class="mx-2">&gt;</span><span class="text-gray-900 font-bold">${catName}</span></nav><div class="grid grid-cols-2 md:grid-cols-4 gap-6">${itemsHtml || `<p class="col-span-full text-center py-10 text-gray-400">No products found in category: ${catName}</p>`}</div></div>`;
    } catch (e) { app.innerHTML = `<div class="text-center py-20 text-red-500">Failed to load category. Check internet or GAS URL.</div>`; }
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
    // 強制根據當前語系設定正確的 langIdx
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    if (updateUrl) switchPage(pageName);

    if (pageName === 'category') { renderCategoryList(); return; }
    if (pageName === 'product') { renderProductDetail(); return; }

    if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
    const data = rawDataCache[pageName];

    // --- 根據 pageName 渲染內容 ---
    if (pageName === "Product Catalog") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        // 修正：PDF 按鈕根據當前語言選擇關鍵字
        const pdfKey = (currentLang === 'zh') ? 'chinese pdf button' : 'english pdf button';
        const catKey = 'categories';

        let pdfHtml = ''; let catHtml = '';
        data.forEach(row => {
            const rowKey = (row[0] || "").toLowerCase().trim();
            const displayText = row[langIdx];
            const imgUrl = (row[3] || "").trim();
            const valE = (row[4] || "").trim();

            if (rowKey.includes(pdfKey) && valE) {
                pdfHtml += `<a href="${valE}" target="_blank" class="bg-red-600 text-white font-bold py-3 px-8 rounded-full mb-4 inline-block">${displayText}</a>`;
            }
            if (rowKey.includes(catKey) && displayText) {
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
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-12">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full px-4">${contentImages}</div></div>`;
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
        app.innerHTML = `<div class="flex flex-col items-center py-10 px-4"><h1 class="text-4xl font-black mb-12">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="grid md:grid-cols-2 gap-8 w-full max-w-6xl">${jobsHtml}</div></div>`;
    }
    else if (pageName === "Contact Us") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        let info = ''; let map = '';
        data.forEach(row => {
            if (row[0].toLowerCase().includes('info') && row[langIdx]) info += `<p class="text-xl text-gray-700 mb-4 font-medium">${row[langIdx]}</p>`;
            if (row[0].toLowerCase().includes('map') && row[4]) map = row[4];
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 px-4 text-center"><h1 class="text-4xl font-black mb-12">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="w-full max-w-2xl border-y py-8 mb-16">${info}</div><iframe src="${map}" width="100%" height="500" class="max-w-6xl rounded-2xl shadow-sm border" loading="lazy"></iframe></div>`;
    }
    window.scrollTo(0, 0);
}

initWebsite();
