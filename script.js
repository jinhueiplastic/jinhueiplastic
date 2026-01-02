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

    // --- 1. Content & About Us ---
    if (pageName === "Content" || pageName === "About Us") {
        let upperImages = ''; 
        let companyNames = ''; 
        let introContent = ''; 
        let addressBlock = ''; 
        let bottomImages = '';

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const text = row[langIdx] || "";
            
            if (key.includes('upper image') && row[3]) upperImages += `<img src="${row[3]}" class="home-bottom-image">`;
            
            // 處理公司名稱 (左側內容)
            if (key.includes('company name')) {
                companyNames += `<div class="mb-6"><h2 class="text-3xl font-black text-gray-900">${row[1]}</h2><h3 class="text-xl font-bold text-gray-400 mt-2">${row[2]}</h3></div>`;
            }
            
            // 處理介紹內容 (右側內容)
            if (key.includes('introduction title') && text) {
                introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${text}</h4>`;
            }
            if (key.includes('introduction') && !key.includes('title') && text) {
                introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${text}</p>`;
            }
            
            if (key.includes('address')) {
                addressBlock += `<p class="text-lg font-medium text-gray-500" style="white-space: pre-line;">${text}</p>`;
            }
            if (key.includes('bottom image') && row[3]) bottomImages += `<img src="${row[3]}" class="home-bottom-image">`;
        });

        if (pageName === "About Us") {
            // About Us 專用：左 1/3 右 2/3 佈局
            app.innerHTML = `
                <div class="w-full flex flex-col items-center py-10">
                    ${upperImages ? `<div class="image-grid-container px-4 mb-16">${upperImages}</div>` : ''}
                    
                    <div class="max-w-6xl w-full px-4 flex flex-col md:flex-row gap-12 items-start">
                        <div class="w-full md:w-1/3 text-left">
                            ${companyNames}
                        </div>
                        
                        <div class="w-full md:w-2/3 text-left">
                            ${introContent}
                        </div>
                    </div>

                    <div class="text-center py-10 w-full border-t mt-16 px-4">${addressBlock}</div>
                    ${bottomImages ? `<div class="image-grid-container px-4 mt-10">${bottomImages}</div>` : ''}
                </div>`;
        } else {
            // Content (首頁) 保持置中佈局
            app.innerHTML = `
                <div class="flex flex-col items-center text-center py-10 w-full px-4">
                    <div class="w-full mb-8">${companyNames}</div>
                    <div class="w-full mb-8 text-gray-500">${addressBlock}</div>
                    <div class="image-grid-container px-4">${bottomImages}</div>
                </div>`;
        }
    }
    // --- 2. Business Scope ---
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
    // --- 3. Product Catalog ---
    else if (pageName === "Product Catalog") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        const targetPdfKey = (currentLang === 'zh') ? 'chinese pdf button' : 'english pdf button';
        let pdfHtml = ''; let catHtml = '';

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const displayText = row[langIdx];
            const imgUrl = (row[3] || "").trim();
            const linkUrl = (row[4] || "").trim();

            if (key.includes(targetPdfKey) && linkUrl) {
                pdfHtml += `<a href="${linkUrl}" target="_blank" class="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition inline-flex items-center gap-2 mb-4"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>${displayText}</a>`;
            }

            if ((key.includes('categories') || key.includes('catagories')) && displayText) {
                catHtml += `
                    <a href="${linkUrl || '#'}" class="category-card group">
                        <div class="category-img-container">
                            ${imgUrl ? `<img src="${imgUrl}" alt="${displayText}">` : `<div class="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">No Image</div>`}
                        </div>
                        <div class="p-5 text-center bg-white border-t border-gray-50">
                            <h4 class="font-bold text-gray-800 text-lg group-hover:text-blue-600 transition">${displayText}</h4>
                        </div>
                    </a>`;
            }
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full"><h1 class="text-4xl font-black mb-6 text-center text-gray-800">${displayTitle}</h1><div class="mb-10 flex flex-wrap justify-center gap-4">${pdfHtml}</div><div class="w-full h-px bg-gray-200 mb-12 max-w-4xl"></div><div class="grid grid-cols-2 md:grid-cols-4 gap-8 w-full max-w-6xl px-4">${catHtml}</div></div>`;
    }
    // --- 4. Join Us ---
    else if (pageName === "Join Us") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        let jobs = {};

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const text = row[langIdx];
            if (!text) return;
            const match = key.match(/\d+/);
            if (match) {
                const id = match[0];
                if (!jobs[id]) jobs[id] = {};
                if (key.includes('position')) jobs[id].title = text;
                if (key.includes('description')) jobs[id].desc = text;
            }
        });

        let jobsHtml = '';
        Object.values(jobs).forEach(job => {
            if (job.title || job.desc) {
                jobsHtml += `
                    <div class="bg-white border border-gray-100 rounded-2xl p-8 shadow-sm hover:shadow-md transition-all text-left">
                        <h3 class="text-2xl font-black text-gray-800 mb-4 border-b pb-4">${job.title || 'Position'}</h3>
                        <p class="text-gray-600 leading-relaxed text-lg" style="white-space: pre-line;">${job.desc || ''}</p>
                    </div>`;
            }
        });
        app.innerHTML = `<div class="flex flex-col items-center py-10 w-full px-4"><h1 class="text-4xl font-black mb-12 text-gray-800">${displayTitle}</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-6xl">${jobsHtml || '<p>No listings...</p>'}</div></div>`;
    }
    // --- 5. Contact Us ---
    else if (pageName === "Contact Us") {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        let subTitle = ''; let infoItemsHtml = ''; let mapUrl = '';

        data.forEach(row => {
            const key = (row[0] || "").toLowerCase().trim();
            const text = row[langIdx];
            const link = (row[4] || "").trim();

            if (key.includes('sub-title')) subTitle = text;
            if (key.includes('info') && text) {
                infoItemsHtml += `<p class="text-xl text-gray-700 mb-4 font-medium" style="white-space: pre-line;">${text}</p>`;
            }
            if (key.includes('map') && link) mapUrl = link;
        });

        app.innerHTML = `
            <div class="flex flex-col items-center py-10 w-full px-4 text-center">
                <div class="mb-12">
                    <h1 class="text-4xl font-black text-gray-800 mb-2">${displayTitle}</h1>
                    ${subTitle ? `<p class="text-xl text-gray-400 font-medium">${subTitle}</p>` : ''}
                </div>
                <div class="w-full max-w-2xl mb-16 border-t border-b border-gray-100 py-8">${infoItemsHtml}</div>
                ${mapUrl ? `<div class="w-full max-w-6xl rounded-2xl overflow-hidden shadow-sm border border-gray-200"><iframe src="${mapUrl}" width="100%" height="500" style="border:0;" allowfullscreen="" loading="lazy"></iframe></div>` : ''}
            </div>`;
    }
    // --- 6. 通用分頁 ---
    else {
        const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
        const displayTitle = (titleRow && titleRow[langIdx]) ? titleRow[langIdx] : pageName;
        let html = `<h1 class="text-4xl font-black mb-12 text-center text-gray-800">${displayTitle}</h1><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">`;
        data.forEach((row) => {
            if (row[0] && row[0].toLowerCase().trim() === 'title') return;
            if (row[langIdx]) {
                html += `<div class="content-card flex flex-col p-2 bg-white">${row[3] ? `<img src="${row[3]}" class="w-full h-52 object-cover rounded-xl">` : ''}<div class="p-4 flex-grow"><p class="text-gray-700 font-medium" style="white-space: pre-line;">${row[langIdx]}</p></div>${row[4] ? `<div class="px-4 pb-4"><a href="${row[4]}" target="_blank" class="block w-full text-center py-2 bg-blue-50 text-blue-600 font-bold rounded-lg hover:bg-blue-100 transition">${currentLang === 'zh' ? '了解更多' : 'Learn More'} →</a></div>` : ''}</div>`;
            }
        });
        app.innerHTML = html + `</div>`;
    }
    
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
