const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};

const getSheetUrl = (sheetName) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

async function fetchSheetData(sheetName) {
    const response = await fetch(getSheetUrl(sheetName));
    const text = await response.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));
    return json.table.rows.map(row => 
        row.c.map(cell => (cell ? (cell.v || "").toString() : ""))
    );
}

// 處理產品詳細頁跳轉與 URL 更新
function goToProduct(itemCode) {
    const u = new URL(window.location);
    u.searchParams.set('page', 'product');
    u.searchParams.set('id', itemCode);
    window.history.pushState({}, '', u);
    loadPage('product', false); // false 代表不需再次 pushState
}

function handleRouting() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    if (page) {
        if (tabs.includes(page) || page === 'product') {
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

// --- 渲染產品詳細頁面 ---
async function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const itemCode = params.get('id');
    const app = document.getElementById('app');
    
    app.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const response = await fetch(GAS_PRODUCT_URL);
        const allProducts = await response.json();
        const item = allProducts.find(p => p["Item code (ERP)"] == itemCode);

        if (!item) {
            app.innerHTML = `<div class="text-center py-20 text-gray-500">Product Not Found.</div>`;
            return;
        }

        const category = item["Category"];
        const name = (currentLang === 'zh') ? item["Chinese product name"] : item["English product name"];
        const packing = `${item["Pcs / Packing"]} ${item["計量單位"]}`;
        const description = (currentLang === 'zh') ? item["中文描述"] : item["英文描述"];
        const images = item["圖片"] ? item["圖片"].split(",").map(s => s.trim()) : [];
        const breadcrumbLabel = (currentLang === 'zh') ? '商品目錄' : 'Product Catalog';
        
        app.innerHTML = `
            <div class="max-w-6xl mx-auto px-4">
                <nav class="flex text-gray-500 text-sm mb-8 italic">
                    <a href="?page=Product Catalog" class="hover:text-blue-600" onclick="event.preventDefault(); loadPage('Product Catalog', true);">${breadcrumbLabel}</a>
                    <span class="mx-2">&gt;</span>
                    <span class="text-gray-900 font-bold">${category}</span>
                </nav>

                <div class="flex flex-col md:flex-row gap-12">
                    <div class="w-full md:w-1/2">
                        <img id="main-prod-img" src="${images[0]}" class="w-full aspect-square object-cover rounded-2xl shadow-md border">
                        <div class="flex gap-3 mt-4 overflow-x-auto pb-2">
                            ${images.map(img => `<img src="${img}" onclick="document.getElementById('main-prod-img').src='${img}'" class="w-20 h-20 object-cover rounded-lg cursor-pointer border-2 border-transparent hover:border-blue-500 shadow-sm transition">`).join('')}
                        </div>
                    </div>
                    <div class="w-full md:w-1/2 text-left">
                        <h1 class="text-3xl font-black text-gray-900 mb-2">${name}</h1>
                        <p class="text-xl text-blue-600 font-bold mb-6">${item["Item code (ERP)"]}</p>
                        <div class="border-y border-gray-100 py-6 mb-6">
                            <div class="grid grid-cols-3 gap-4">
                                <span class="text-gray-400 font-medium">${currentLang === 'zh' ? '包裝規格' : 'Packing'}</span>
                                <span class="col-span-2 text-gray-700 font-bold">${packing}</span>
                            </div>
                        </div>
                        <h4 class="text-lg font-bold text-gray-900 mb-3">${currentLang === 'zh' ? '商品描述' : 'Description'}</h4>
                        <p class="text-gray-600 leading-loose" style="white-space: pre-line;">${description}</p>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        app.innerHTML = `<div class="text-center py-20 text-red-500">Failed to load product data.</div>`;
    }
}

async function loadPage(pageName, updateUrl = true) {
    currentPage = pageName;
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    if (updateUrl) {
        const params = new URLSearchParams(window.location.search);
        params.set('page', pageName);
        if (pageName !== 'product') params.delete('id'); 
        const newUrl = window.location.origin + window.location.pathname + '?' + params.toString();
        window.history.pushState({path: newUrl}, '', newUrl);
    }

    if (pageName === 'product') {
        renderProductDetail();
        return;
    }

    if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
    const data = rawDataCache[pageName];

    // --- Content & About Us ---
    if (pageName === "Content" || pageName === "About Us") {
        let upperImages = ''; let companyNames = ''; let introContent = ''; let addressBlock = ''; let bottomImages = '';
        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const text = row[langIdx] || "";
            if (key.includes('upper image') && row[3]) upperImages += `<img src="${row[3]}" class="home-bottom-image">`;
            if (key.includes('company name')) {
                companyNames += `<div class="mb-6"><h2 class="text-3xl font-black text-gray-900">${row[1]}</h2><h3 class="text-xl font-bold text-gray-400 mt-2">${row[2]}</h3></div>`;
            }
            if (key.includes('introduction title') && text) introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${text}</h4>`;
            if (key.includes('introduction') && !key.includes('title') && text) introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${text}</p>`;
            if (key.includes('address')) addressBlock += `<p class="text-lg font-medium text-gray-500" style="white-space: pre-line;">${text}</p>`;
            if (key.includes('bottom image') && row[3]) bottomImages += `<img src="${row[3]}" class="home-bottom-image">`;
        });

        if (pageName === "About Us") {
            app.innerHTML = `<div class="w-full flex flex-col items-center py-10">${upperImages ? `<div class="image-grid-container px-4 mb-16">${upperImages}</div>` : ''}<div class="max-w-6xl w-full px-4 flex flex-col md:flex-row gap-12 items-start"><div class="w-full md:w-1/3 text-left">${companyNames}</div><div class="w-full md:w-2/3 text-left">${introContent}</div></div><div class="text-center py-10 w-full border-t mt-16 px-4">${addressBlock}</div>${bottomImages ? `<div class="image-grid-container px-4 mt-10">${bottomImages}</div>` : ''}</div>`;
        } else {
            app.innerHTML = `<div class="flex flex-col items-center text-center py-10 w-full px-4"><div class="w-full mb-8">${companyNames}</div><div class="w-full mb-8 text-gray-500">${addressBlock}</div><div class="image-grid-container px-4">${bottomImages}</div></div>`;
        }
    }
    // --- Business Scope ---
    else if (pageName === "Business Scope") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        const targetKey = (currentLang === 'zh') ? 'chinese content' : 'english content';
        let contentImages = '';
        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            if (key.includes(targetKey) && row[3]) contentImages += `<img src="${row[3]}" class="home-bottom-image mb-8 max-w-2xl mx-auto block">`;
        });
        app.innerHTML = `<div class="flex flex-col items-center text-center py-10 w-full"><h1 class="text-4xl font-black mb-12 text-center text-gray-800">${displayTitle}</h1><div class="w-full px-4">${contentImages || `<p class="text-gray-400">No images available.</p>`}</div></div>`;
    }
    // --- Product Catalog ---
    else if (pageName === "Product Catalog") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        const targetPdfKey = (currentLang === 'zh') ? 'chinese pdf button' : 'english pdf button';
        let pdfHtml = ''; let catHtml = '';

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const displayText = row[langIdx];
            const imgUrl = (row[3] || "").trim();
            const itemCode = (row[4] || "").trim(); // 此處直接取用 ERP Item Code

            if (key.includes(targetPdfKey) && itemCode) {
                pdfHtml += `<a href="${itemCode}" target="_blank" class="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition inline-flex items-center gap-2 mb-4"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>${displayText}</a>`;
            }

            if ((key.includes('categories') || key.includes('catagories')) && displayText) {
                catHtml += `
                    <div class="category-card group cursor-pointer" onclick="goToProduct('${itemCode}')">
                        <div class="category-img-container">
                            ${imgUrl ? `<img src="${imgUrl}" alt="${displayText}">` : `<div class="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">No Image</div>`}
                        </div>
                        <div class="p-5 text-center bg-white border-t border-gray-50">
                            <h4 class="font-bold text-gray-800 text-lg group-hover:text-blue-600 transition">${displayText}</h4>
                        </div>
                    </div>`;
            }
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-6 text-center text-gray-800">${displayTitle}</h1><div class="mb-10 flex flex-wrap justify-center gap-4">${pdfHtml}</div><div class="w-full h-px bg-gray-200 mb-12 max-w-4xl"></div><div class="grid grid-cols-2 md:grid-cols-4 gap-8 w-full max-w-6xl px-4">${catHtml}</div></div>`;
    }
    // --- Join Us & Contact Us & 通用 (略，維持原邏輯) ---
    else if (pageName === "Join Us") { /* ... 原 Join Us 代碼 ... */ }
    else if (pageName === "Contact Us") { /* ... 原 Contact Us 代碼 ... */ }
    else { /* ... 原通用代碼 ... */ }
    
    // 更新導覽列啟動狀態
    document.querySelectorAll('.nav-item').forEach(el => {
        const itemData = rawDataCache[pageName];
        if (itemData) {
            const titleRow = itemData.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
            const matchText = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
            el.classList.toggle('active', el.innerText === matchText);
        }
    });
    window.scrollTo(0, 0);
}

initWebsite();
