const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
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

function handleRouting() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    if (page && tabs.includes(page)) { currentPage = page; }
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

async function loadPage(pageName, updateUrl = true) {
    currentPage = pageName;
    const app = document.getElementById('app');
    const langIdx = (currentLang === 'zh') ? 1 : 2;

    if (updateUrl) {
        const newUrl = window.location.origin + window.location.pathname + `?page=${encodeURIComponent(pageName)}`;
        window.history.pushState({path: newUrl}, '', newUrl);
    }

    if (!rawDataCache[pageName]) { rawDataCache[pageName] = await fetchSheetData(pageName); }
    const data = rawDataCache[pageName];

    if (pageName === "Content" || pageName === "About Us") {
        let upperImages = '';
        let companyNames = '';
        let introContent = ''; 
        let addressBlock = '';
        let bottomImages = '';

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            if (key.includes('upper image') && row[3]) {
                upperImages += `<img src="${row[3]}" class="home-bottom-image">`;
            }
            if (key.includes('company name')) {
                companyNames += `<div class="mb-6"><h2 class="text-3xl font-black text-gray-900">${row[1]}</h2><h3 class="text-xl font-bold text-gray-400 mt-2">${row[2]}</h3></div>`;
            }
            if (key.includes('introduction title')) {
                introContent += `<h4 class="intro-title">${row[langIdx]}</h4>`;
            }
            if (key.includes('introduction') && !key.includes('title')) {
                // 這裡的 p 標籤會對應 CSS 的 white-space: pre-line
                introContent += `<p class="text-lg leading-loose text-gray-700">${row[langIdx]}</p>`;
            }
            if (key.includes('address')) {
                addressBlock += `<p class="text-lg font-medium text-gray-500">${row[langIdx]}</p>`;
            }
            if (key.includes('bottom image') && row[3]) {
                bottomImages += `<img src="${row[3]}" class="home-bottom-image">`;
            }
        });

        if (pageName === "About Us") {
            app.innerHTML = `
                <div class="w-full flex flex-col items-center py-10">
                    <div class="image-grid-container px-4 mb-16">${upperImages}</div>
                    <div class="about-grid px-4 w-full">
                        <div class="about-company-box">${companyNames}</div>
                        <div class="about-intro-box">${introContent}</div>
                    </div>
                    <div class="text-center py-10 w-full border-t mt-10">${addressBlock}</div>
                    <div class="image-grid-container px-4 mt-10">${bottomImages}</div>
                </div>`;
        } else {
            app.innerHTML = `
                <div class="flex flex-col items-center text-center py-10 w-full">
                    <div class="w-full mb-8">${companyNames}</div>
                    <div class="w-full mb-8 text-gray-500">${addressBlock}</div>
                    <div class="image-grid-container px-4">${bottomImages}</div>
                </div>`;
        }
    } else {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        let html = `<h1 class="text-4xl font-black mb-12 text-center text-gray-800">${displayTitle}</h1><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">`;
        data.forEach((row) => {
            if (row[0] && row[0].toLowerCase().trim() === 'title') return;
            const textContent = row[langIdx];
            const img = row[3]; const link = row[4];
            if (textContent && textContent.trim() !== "") {
                html += `<div class="content-card flex flex-col p-2 bg-white">${img ? `<img src="${img}" class="w-full h-52 object-cover rounded-xl">` : ''}<div class="p-4 flex-grow"><p class="text-gray-700 font-medium whitespace-pre-line">${textContent}</p></div>${link ? `<div class="px-4 pb-4"><a href="${link}" target="_blank" class="block w-full text-center py-2 bg-blue-50 text-blue-600 font-bold rounded-lg hover:bg-blue-100 transition">${currentLang === 'zh' ? '了解更多' : 'Learn More'} →</a></div>` : ''}</div>`;
            }
        });
        app.innerHTML = html + `</div>`;
    }
    
    // 更新 Active 選單狀態
    document.querySelectorAll('.nav-item').forEach(el => {
        const data = rawDataCache[pageName];
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const matchText = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        el.classList.toggle('active', el.innerText === matchText);
    });
    window.scrollTo(0, 0);
}

initWebsite();