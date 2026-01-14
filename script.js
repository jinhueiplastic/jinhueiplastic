const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};
let allProductsCache = null; // 快取 GAS 資料

const getSheetUrl = (sheetName) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

async function fetchSheetData(sheetName) {
    const response = await fetch(getSheetUrl(sheetName));
    const text = await response.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));
    return json.table.rows.map(row => 
        row.c.map(cell => (cell ? (cell.v || "").toString() : ""))
    );
}

async function fetchGASProducts() {
    if (allProductsCache) return allProductsCache;
    const response = await fetch(GAS_PRODUCT_URL);
    allProductsCache = await response.json();
    return allProductsCache;
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
            logoContainer.innerHTML = `<a href="index.html?page=Content"><img src="${imgUrl}" class="logo-img" alt="Logo"></a>`;
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
        const isActive = (currentPage === tab) ? 'active' : '';
        navHtml += `<li class="nav-item ${isActive} px-6 py-3 cursor-pointer" onclick="loadPage('${tab}', true)">${displayName}</li>`;
    }
    nav.innerHTML = navHtml;
}

// --- 渲染分類下的產品列表 (4個一行) ---
async function renderCategoryList() {
    const params = new URLSearchParams(window.location.search);
    const catName = params.get('cat');
    const app = document.getElementById('app');
    app.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const filtered = allProducts.filter(p => p["Category"] === catName);

        let itemsHtml = filtered.map(item => {
            const name = (currentLang === 'zh') ? item["Chinese product name"] : item["English product name"];
            const img = item["圖片"] ? item["圖片"].split(",")[0] : "";
            const code = item["Item code (ERP)"];
            return `
                <div class="category-card group cursor-pointer" onclick="loadPage('product', true); const u=new URL(window.location); u.searchParams.set('id','${code}'); window.history.pushState({},'',u); renderProductDetail();">
                    <div class="category-img-container">
                        <img src="${img}" class="w-full h-full object-cover group-hover:scale-110 transition duration-500">
                    </div>
                    <div class="p-4 text-center">
                        <p class="text-xs text-blue-600 font-bold mb-1">${code}</p>
                        <h4 class="font-bold text-gray-800 line-clamp-2">${name}</h4>
                    </div>
                </div>`;
        }).join('');

        app.innerHTML = `
            <div class="max-w-6xl mx-auto px-4">
                <nav class="flex text-gray-500 text-sm mb-8 italic">
                    <a href="#" onclick="loadPage('Product Catalog', true)" class="hover:text-blue-600">${currentLang === 'zh' ? '商品目錄' : 'Product Catalog'}</a>
                    <span class="mx-2">&gt;</span>
                    <span class="text-gray-900 font-bold">${catName}</span>
                </nav>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                    ${itemsHtml || `<p class="col-span-full text-center py-10 text-gray-400">No products found in this category.</p>`}
                </div>
            </div>`;
    } catch (e) { app.innerHTML = `<p class="text-center text-red-500">Error loading category.</p>`; }
}

// --- 渲染產品詳細頁面 ---
async function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const itemCode = params.get('id');
    const app = document.getElementById('app');
    
    try {
        const allProducts = await fetchGASProducts();
        const item = allProducts.find(p => p["Item code (ERP)"] == itemCode);
        if (!item) return;

        const images = item["圖片"] ? item["圖片"].split(",").map(s => s.trim()) : [];
        const name = (currentLang === 'zh') ? item["Chinese product name"] : item["English product name"];
        const packing = `${item["Pcs / Packing"]} ${item["計量單位"]}`;
        const description = (currentLang === 'zh') ? item["中文描述"] : item["英文描述"];

        app.innerHTML = `
            <div class="max-w-6xl mx-auto px-4">
                <nav class="flex text-gray-500 text-sm mb-8 italic">
                    <a href="#" onclick="loadPage('Product Catalog', true)" class="hover:text-blue-600">${currentLang === 'zh' ? '商品目錄' : 'Product Catalog'}</a>
                    <span class="mx-2">&gt;</span>
                    <a href="#" onclick="const u=new URL(window.location); u.searchParams.set('page','category'); u.searchParams.set('cat','${item["Category"]}'); window.history.pushState({},'',u); renderCategoryList();" class="hover:text-blue-600">${item["Category"]}</a>
                    <span class="mx-2">&gt;</span>
                    <span class="text-gray-900 font-bold">${itemCode}</span>
                </nav>
                <div class="flex flex-col md:flex-row gap-12">
                    <div class="w-full md:w-1/2">
                        <img id="main-prod-img" src="${images[0]}" class="w-full aspect-square object-cover rounded-2xl shadow-md border">
                        <div class="flex gap-3 mt-4 overflow-x-auto pb-2">
                            ${images.map(img => `<img src="${img}" onclick="document.getElementById('main-prod-img').src='${img}'" class="w-20 h-20 object-cover rounded-lg cursor-pointer border-2 border-transparent hover:border-blue-500 shadow-sm transition">`).join('')}
                        </div>
                    </div>
                    <div class="w-full md:w-1/2 text-left text-gray-900">
                        <h1 class="text-3xl font-black mb-2">${name}</h1>
                        <p class="text-xl text-blue-600 font-bold mb-6">${itemCode}</p>
                        <div class="border-y py-6 mb-6">
                            <p class="mb-2"><span class="text-gray-400 mr-4">${currentLang === 'zh' ? '包裝規格' : 'Packing'}</span> <b>${packing}</b></p>
                        </div>
                        <h4 class="font-bold mb-3">${currentLang === 'zh' ? '商品描述' : 'Description'}</h4>
                        <p class="text-gray-600 leading-loose" style="white-space: pre-line;">${description}</p>
                    </div>
                </div>
            </div>`;
    } catch (e) { app.innerHTML = `<p class="text-center text-red-500">Error loading product details.</p>`; }
}

async function loadPage(pageName, updateUrl = true) {
    currentPage = pageName;
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    if (updateUrl) {
        const u = new URL(window.location.origin + window.location.pathname);
        u.searchParams.set('page', pageName);
        window.history.pushState({}, '', u);
    }

    if (pageName === 'category') { renderCategoryList(); return; }
    if (pageName === 'product') { renderProductDetail(); return; }

    if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
    const data = rawDataCache[pageName];

    if (pageName === "Product Catalog") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        let pdfHtml = ''; let catHtml = '';
        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const displayText = row[langIdx];
            const imgUrl = (row[3] || "").trim();
            const categoryVal = (row[4] || "").trim(); // E 欄填入 Category 名稱

            if (key.includes('pdf') && categoryVal) {
                pdfHtml += `<a href="${categoryVal}" target="_blank" class="bg-red-600 text-white font-bold py-3 px-8 rounded-full mb-4 inline-block">${displayText}</a>`;
            }
            if ((key.includes('categories') || key.includes('catagories')) && displayText) {
                catHtml += `
                    <div class="category-card group cursor-pointer" onclick="const u=new URL(window.location); u.searchParams.set('page','category'); u.searchParams.set('cat','${categoryVal}'); window.history.pushState({},'',u); renderCategoryList();">
                        <div class="category-img-container"><img src="${imgUrl}"></div>
                        <div class="p-5 text-center bg-white"><h4 class="font-bold text-gray-800">${displayText}</h4></div>
                    </div>`;
            }
        });
        app.innerHTML = `<div class="py-10 text-center"><h1 class="text-4xl font-black mb-6">${(titleRow && titleRow[langIdx]) || pageName}</h1><div class="mb-10">${pdfHtml}</div><div class="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-6xl mx-auto px-4">${catHtml}</div></div>`;
    } 
    else if (pageName === "Content" || pageName === "About Us") {
        // ... (保持原有的 Content/About Us 代碼) ...
        let companyNames = ''; let addressBlock = ''; let bottomImages = ''; let introContent = '';
        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            if (key.includes('company name')) companyNames += `<div class="mb-6"><h2 class="text-3xl font-black">${row[1]}</h2><h3 class="text-xl font-bold text-gray-400">${row[2]}</h3></div>`;
            if (key.includes('introduction title')) introContent += `<h4 class="text-2xl font-bold mb-4">${row[langIdx]}</h4>`;
            if (key.includes('introduction') && !key.includes('title')) introContent += `<p class="text-lg leading-loose mb-6" style="white-space: pre-line;">${row[langIdx]}</p>`;
            if (key.includes('address')) addressBlock += `<p class="text-lg text-gray-500">${row[langIdx]}</p>`;
            if (key.includes('bottom image') && row[3]) bottomImages += `<img src="${row[3]}" class="home-bottom-image">`;
        });
        if (pageName === "About Us") {
            app.innerHTML = `<div class="py-10 px-4 max-w-6xl mx-auto flex flex-col md:flex-row gap-12 text-left"><div class="md:w-1/3">${companyNames}</div><div class="md:w-2/3">${introContent}</div></div><div class="border-t py-10 text-center">${addressBlock}</div><div class="image-grid-container px-4">${bottomImages}</div>`;
        } else {
            app.innerHTML = `<div class="py-10 text-center px-4"><div class="mb-8">${companyNames}</div><div class="mb-8">${addressBlock}</div><div class="image-grid-container">${bottomImages}</div></div>`;
        }
    }
    // ... 其餘分頁 (Business Scope, Join Us, Contact Us) 略，建議保留您原本的功能代碼 ...
    
    window.scrollTo(0, 0);
}

initWebsite();
