/* --- 全域變數與配置 --- */
const SPREADSHEET_ID = '1Z3xaacD4N1Piagjg7mWAH2bzGadCUX8zS24RbInF4QM';
const GAS_PRODUCT_URL = 'https://script.google.com/macros/s/AKfycby0WRTp_F33uuVYp1tq8wAYWIw80XM3v3vdPErq8joVZoZu5DpLW_qNtVruHJ5o1AFw/exec';
const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];

let currentLang = 'zh';
let currentPage = 'Content'; 
let rawDataCache = {};
let allProductsCache = null;
let storeLogoMap = {}; 

/* --- 核心資料抓取邏輯 --- */
const getSheetUrl = (sheetName) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

function showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.style.display = 'flex';
        loader.style.opacity = '1';
    }
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.style.transition = 'opacity 0.3s ease';
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 300);
    }
}

async function fetchSheetData(sheetName) {
    try {
        const url = getSheetUrl(sheetName);
        const response = await fetch(url);
        if (!response.ok) throw new Error("網路請求沒回應");
        const text = await response.text();
        const json = JSON.parse(text.substring(47).slice(0, -2));
        if (json.table && json.table.rows) {
            return json.table.rows.map(row => 
                row.c.map(cell => (cell ? (cell.v || "").toString() : ""))
            );
        }
        return [];
    } catch (e) {
        console.error(`❌ ${sheetName} 請求出錯:`, e);
        return [];
    }
}

async function fetchGASProducts() {
    if (allProductsCache) return allProductsCache;
    try {
        const response = await fetch(GAS_PRODUCT_URL);
        const data = await response.json();
        allProductsCache = data; 
        return data;
    } catch (e) {
        console.error("產品 JSON 抓取失敗:", e);
        throw e;
    }
}

async function fetchData() {
    try {
        console.log("開始同步抓取所有資料...");
        const [sheetResults, gasData] = await Promise.all([
            Promise.all(tabs.map(tab => fetchSheetData(tab))),
            fetch(GAS_PRODUCT_URL).then(res => res.json())
        ]);
        tabs.forEach((tab, index) => {
            rawDataCache[tab] = sheetResults[index];
        });
        rawDataCache["allProducts"] = gasData;
        allProductsCache = gasData; 
        console.log("資料全部載入完成", rawDataCache);
        return true;
    } catch (e) {
        console.error("fetchData 發生錯誤:", e);
        throw e;
    }
}

/* --- 渲染 Logo 與 賣場圖標 --- */
function renderLogoAndStores() {
    const logoContainer = document.getElementById('logo-container');
    const storeContainer = document.getElementById('store-container');
    if (!logoContainer || !storeContainer) return;

    const data = rawDataCache['Content'] || [];
    if (data.length === 0) {
        logoContainer.innerHTML = `<h1 class="text-xl font-bold text-blue-900 cursor-pointer"><a href="?page=Content" onclick="event.preventDefault(); switchPage('Content')">錦輝塑膠</a></h1>`;
        return;
    }

    logoContainer.innerHTML = ''; 
    storeContainer.innerHTML = '';
    data.forEach(row => {
        const aColRaw = (row[0] || "").trim();
        const aColLower = aColRaw.toLowerCase();
        const imgUrl = (row[3] || "").trim();
        const linkUrl = (row[4] || "").trim() || "#";
        
        if (aColLower === 'logo' && imgUrl) {
            logoContainer.innerHTML = `
                <a href="?page=Content" onclick="event.preventDefault(); switchPage('Content')">
                    <img src="${imgUrl}" class="logo-img" alt="Logo" style="height: 40px; width: auto;">
                </a>`;
        }
        if (aColLower.startsWith('store') && imgUrl) {
            const a = document.createElement('a');
            a.href = linkUrl; 
            a.target = "_blank";
            a.innerHTML = `<img src="${imgUrl}" class="store-img hover:opacity-75 transition" style="height: 30px; width: auto;">`;
            storeContainer.appendChild(a);
        }
    });
}

/* --- 路由與頁面切換邏輯 --- */
function switchPage(page, params = {}) {
    const targetPage = page || 'Content';
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', targetPage);
    u.searchParams.set('lang', currentLang); 
    
    for (const key in params) { 
        if (params[key]) u.searchParams.set(key, params[key]); 
    }
    window.history.pushState({}, '', u);
    currentPage = targetPage;

    updateTabTitle(params.title || targetPage);
    renderNav();
    loadPage(targetPage, false, true);
    window.scrollTo(0, 0);
}

/**
 * 渲染業務範圍 (Business Scope)
 * 從試算表抓取對應語系的圖片進行長條狀排列
 */
function renderBusinessScope(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let contentImages = '';

    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        // 根據目前語系決定要抓取的關鍵字
        const target = (currentLang === 'zh') ? 'chinese content' : 'english content';

        if (key.includes(target) && row[3]) {
            contentImages += `<img src="${row[3]}" class="home-bottom-image mb-8 max-w-4xl mx-auto block" alt="Business Scope">`;
        }
    });

    app.innerHTML = `
        <div class="flex flex-col items-center py-10 w-full">
            <h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1>
            <div class="w-full px-4">${contentImages}</div>
        </div>`;
}

/**
 * 渲染產品目錄主頁 (Product Catalog)
 * 顯示分類卡片，點擊後透過 switchPage 跳轉至特定分類
 */
function renderProductCatalog(data, langIdx) {
    const app = document.getElementById('app');
    let catHtml = '';

    data.forEach(row => {
        // row[0] 包含 categories, row[langIdx] 為分類名稱, row[4] 為分類 ID, row[3] 為圖片
        if (row[0] && row[0].toLowerCase().trim().includes('categories') && row[langIdx]) {
            const displayName = row[langIdx];
            const catId = row[4];
            const imgUrl = row[3] || 'https://via.placeholder.com/300';

            catHtml += `
                <div class="category-card group cursor-pointer" 
                     onclick="switchPage('category', {cat: '${catId}', title: '${displayName}'})">
                    <div class="category-img-container">
                        <img src="${imgUrl}" class="group-hover:scale-110 transition duration-500" alt="${displayName}">
                    </div>
                    <div class="p-5 text-center bg-white border-t">
                        <h4 class="font-bold text-gray-800">${displayName}</h4>
                    </div>
                </div>`;
        }
    });

    app.innerHTML = `
        <div class="flex flex-col items-center py-6 w-full">
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 w-full max-w-7xl px-4">
                ${catHtml}
            </div>
        </div>`;
}

/**
 * 渲染關於我們 (About Us) 或 通用頁面
 * 包含：頂部圖片網格、公司名稱、介紹內容、地址區塊、底部圖片
 */
function renderAboutOrContent(data, langIdx, pageName) {
    const app = document.getElementById('app');
    let upperImages = ''; 
    let companyNames = '';
    let introContent = '';
    let addressBlock = '';
    let bottomImages = '';

    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();

        if (key.includes('upper image') && row[3]) {
            upperImages += `<img src="${row[3]}" class="home-bottom-image" alt="Gallery">`;
        }
        if (key.includes('company name')) {
            companyNames += `
                <div class="mb-2 flex flex-col items-start"> 
                    <div class="w-3/4 md:w-full text-left"> 
                        <h2 class="text-lg md:text-3xl font-black text-gray-900 leading-tight">${row[1]}</h2>
                        <h3 class="text-xs md:text-xl font-bold text-gray-400 mt-0 leading-tight">${row[2]}</h3>
                    </div>
                </div>`;
        }
        if (key.includes('introduction title')) {
            introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${row[langIdx]}</h4>`;
        }
        if (key.includes('introduction') && !key.includes('title')) {
            introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${row[langIdx]}</p>`;
        }
        if (key.includes('address')) {
            addressBlock += `<p class="text-lg font-medium text-gray-500">${row[langIdx]}</p>`;
        }
        if (key.includes('bottom image') && row[3]) {
            bottomImages += `<img src="${row[3]}" class="home-bottom-image" alt="Gallery">`;
        }
    });

    if (pageName === "About Us") {
        app.innerHTML = `
            <div class="w-full flex flex-col items-center py-10">
                ${upperImages ? `
                    <div class="w-full bg-gray-50 py-12 mb-16">
                        <div class="max-w-7xl mx-auto px-4">
                            <div class="image-grid-container justify-center">${upperImages}</div>
                        </div>
                    </div>` : ''}
                <div class="max-w-6xl w-full px-4 flex flex-col md:flex-row gap-12 items-start mb-16">
                    <div class="w-full md:w-1/3">${companyNames}</div>
                    <div class="w-full md:w-2/3 text-left">${introContent}</div>
                </div>
                <div class="text-center py-10 w-full border-t px-4">${addressBlock}</div>
                ${bottomImages ? `<div class="image-grid-container px-4 mt-10 justify-center">${bottomImages}</div>` : ''}
            </div>`;
    } else {
        app.innerHTML = `
            <div class="flex flex-col items-center text-center py-10 w-full px-4">
                <div class="w-full mb-8">${companyNames}</div>
                <div class="w-full mb-8 text-gray-500">${addressBlock}</div>
                <div class="image-grid-container px-4 justify-center">${bottomImages}</div>
            </div>`;
    }
}

/**
 * 渲染加入我們 (Join Us)
 * 自動解析 Position 與 Description 的配對關係
 */
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
        <div class="bg-white border rounded-2xl p-8 text-left shadow-sm hover:shadow-md transition">
            <h3 class="text-2xl font-black mb-4 border-b pb-4 text-blue-700">${j.title}</h3>
            <p class="text-gray-600 leading-relaxed" style="white-space: pre-line;">${j.desc}</p>
        </div>`).join('');

    app.innerHTML = `
        <div class="flex flex-col items-center py-10 px-4">
            <h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1>
            <div class="grid md:grid-cols-2 gap-8 w-full max-w-6xl">
                ${jobsHtml || `<p class="text-gray-400">${currentLang === 'zh' ? '目前暫無職缺。' : 'No positions available.'}</p>`}
            </div>
        </div>`;
}

/**
 * 渲染聯繫我們 (Contact Us)
 * 包含文字資訊與內嵌 Google Maps
 */
function renderContactUs(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let info = ''; 
    let mapUrl = '';

    data.forEach(row => {
        if (row[0] && row[0].toLowerCase().includes('info') && row[langIdx]) {
            info += `<p class="text-xl text-gray-700 mb-4 font-medium">${row[langIdx]}</p>`;
        }
        if (row[0] && row[0].toLowerCase().includes('map') && row[4]) {
            mapUrl = row[4];
        }
    });

    app.innerHTML = `
        <div class="flex flex-col items-center py-10 px-4 text-center">
            <h1 class="text-4xl font-black mb-12 text-gray-800">${(titleRow && titleRow[langIdx]) || pageName}</h1>
            <div class="w-full max-w-2xl border-y py-8 mb-16">${info}</div>
            <iframe src="${mapUrl}" width="100%" height="500" class="max-w-6xl rounded-2xl shadow-sm border" loading="lazy"></iframe>
        </div>`;
}

/**
 * 產生搜尋欄的 HTML
 * 用於 Product Catalog 頁面頂部
 */
function getSearchBoxHtml() {
    const placeholder = currentLang === 'zh' ? '搜尋產品編號或名稱...' : 'Search item code or name...';
    const params = new URLSearchParams(window.location.search);
    const currentQuery = params.get('q') || '';

    return `
        <div class="flex justify-end mb-8">
            <div class="relative w-full max-w-sm flex gap-2">
                <input type="text" id="product-search-input" 
                       class="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition-all" 
                       placeholder="${placeholder}" value="${currentQuery}"
                       onkeypress="if(event.key === 'Enter') handleSearch()">
                <button onclick="handleSearch()" 
                        class="bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors shadow-md flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </div>
        </div>`;
}

function updateTabTitle(customTitle) {
    const baseTitle = "錦輝塑膠業有限公司 JIN HUEI PLASTIC";
    document.title = customTitle ? `${customTitle} | ${baseTitle}` : baseTitle;
}

/* --- 搜尋功能 --- */
async function handleSearch() {
    const inputEl = document.getElementById('product-search-input');
    if (!inputEl) return;
    const query = inputEl.value.toLowerCase().trim();
    if (!query) return;
    switchPage('search', { q: query });
}

async function executeSearch(query) {
    if (!query) return;
    const app = document.getElementById('app');
    app.innerHTML = `<div class="flex justify-center items-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const filtered = allProducts.filter(p => {
            // 自動尋找包含這些關鍵字的欄位名稱
            const rowData = JSON.stringify(p).toLowerCase(); 
            
            // 檢查該產品物件中是否包含搜尋字
            // 或者更精確地針對特定欄位：
            const itemCode = String(p["Item code (ERP)"] || "").toLowerCase();
            const zhName = String(p["Chinese product name"] || "").toLowerCase();
            const enName = String(p["English product name"] || "").toLowerCase();
            
            // 如果你在試算表新增了 keywords 欄位，也要加進來：
            const keywords = String(p["keywords"] || "").toLowerCase();

            return itemCode.includes(query) || 
                   zhName.includes(query) || 
                   enName.includes(query) || 
                   keywords.includes(query);
        });
        renderSearchResults(filtered, query);
    } catch (e) {
        console.error("搜尋執行錯誤:", e);
        app.innerHTML = `<div class="text-center py-20 text-red-500">搜尋出錯。</div>`;
    }
}

function renderSearchResults(products, query) {
    const app = document.getElementById('app');
    const title = currentLang === 'zh' ? `搜尋結果: ${query}` : `Search Results: ${query}`;
    
    let itemsHtml = products.map(item => {
        // 語系名稱判定
        const name = (currentLang === 'zh') 
            ? (item["Chinese product name"] || item["Item code (ERP)"]) 
            : (item["English product name"] || item["Item code (ERP)"]);
        
        // 圖片判定：現在你已經改成了英文標題 image_url
        const img = item["image_url"] ? item["image_url"].split(",")[0].trim() : "";
        const code = item["Item code (ERP)"];

        return `
            <a href="?page=product&id=${code}&lang=${currentLang}" class="category-card group block" onclick="event.preventDefault(); switchPage('product', {id: '${code}'})">
                <div class="category-img-container">
                    <img src="${img}" class="hover:scale-110 transition duration-500" onerror="this.src='https://via.placeholder.com/300?text=No+Image'">
                </div>
                <div class="p-4 text-center">
                    <p class="text-xs text-blue-600 font-bold mb-1">${code}</p>
                    <h4 class="font-bold text-gray-800">${name}</h4>
                </div>
            </a>`;
    }).join('');

    app.innerHTML = `
        <div class="max-w-7xl mx-auto px-4">
            <h2 class="text-2xl font-bold mb-8 pb-2 border-b">${title}</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                ${itemsHtml || '<p class="col-span-full text-center py-10 text-gray-400">沒有找到符合的產品。</p>'}
            </div>
        </div>`;
}

/* --- 初始化與導覽 --- */
async function initWebsite() {
    try {
        const params = new URLSearchParams(window.location.search);
        currentLang = params.get('lang') || 'zh';
        currentPage = params.get('page') || 'Content'; 

        // 1. 顯示 Loading
        showLoader(); 

        // 2. 抓取初始資料 (Logo, 導覽列等)
        await fetchData(); 
        renderLogoAndStores();
        renderNav();
        updateLangButton(); // 建議同步更新語系按鈕文字

        await loadPage(currentPage, true, false);

        // 4. 點擊攔截監聽
        document.addEventListener('click', (e) => {
            const anchor = e.target.closest('a');
            if (anchor && anchor.getAttribute('href')?.startsWith('?page=')) {
                e.preventDefault();
                const urlParams = new URLSearchParams(anchor.getAttribute('href'));
                const page = urlParams.get('page');
                const id = urlParams.get('id');
                const cat = urlParams.get('cat');
                switchPage(page, { id, cat });
            }
        });

    } catch (e) {
        console.error("初始化失敗:", e);
        document.getElementById('app').innerHTML = `<div class="text-center py-20">載入失敗，請檢查網路連線。</div>`;
    } finally {
        // 5. 確保最後關閉 Loading
        hideLoader();
    }
}

// 當使用者按瀏覽器回退/前進鍵時，重新渲染畫面
window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page') || 'Content';
    currentLang = params.get('lang') || 'zh';
    loadPage(page, false, false); // 這裡絕對不能再 pushState，否則會陷入死循環
});

function renderNav() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    const langIdx = (currentLang === 'zh') ? 1 : 2; 
    let navHtml = '';

    for (const tab of tabs) {
        const data = rawDataCache[tab];
        let displayName = tab;
        if (data) {
            const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
            if (titleRow) displayName = titleRow[langIdx] || tab;
        }
        const isActive = (currentPage === tab);
        navHtml += `
            <li class="nav-item ${isActive ? 'active' : ''}">
                <a href="?page=${tab}&lang=${currentLang}" class="block px-4 py-2" onclick="event.preventDefault(); switchPage('${tab}')">
                    ${displayName}
                </a>
            </li>`;
    }
    nav.innerHTML = navHtml;
}

/**
 * 核心分頁加載函式
 * @param {string} pageName - 分頁名稱
 * @param {boolean} updateUrl - 是否更新瀏覽器 URL 歷史
 * @param {boolean} skipLoading - 是否跳過顯示全螢幕 Loading (例如在背景更新時使用)
 */
async function loadPage(pageName, updateUrl = true, skipLoading = false) {
    // 1. 參數初始化
    const target = pageName || 'Content';
    currentPage = target; // 更新全域變數
    console.log(`執行 loadPage: ${target}`);
    
    const app = document.getElementById('app');
    if (!app) return;

    const langIdx = (currentLang === 'zh') ? 1 : 2;
    // 定義哪些頁面屬於產品相關（需顯示搜尋框）
    const isProductRelatedPage = ['Product Catalog', 'category', 'search'].includes(target);

    // 2. 顯示全螢幕 Loading 狀態
    if (!skipLoading) {
        showLoader(); 
    }

    try {
        // 3. 分流渲染邏輯
        if (target === 'category') {
            await renderCategoryList(); 
        } 
        else if (target === 'product') {
            await renderProductDetail(); 
        } 
        else if (target === 'search') {
            const p = new URLSearchParams(window.location.search);
            await executeSearch(p.get('q')); 
        } 
        else {
            // 一般分頁資料抓取（若無快取則發起請求）
            let data = rawDataCache[target];
            if (!data || data.length === 0) {
                data = await fetchSheetData(target);
                rawDataCache[target] = data;
            }
            
            if (!data || data.length === 0) throw new Error("無資料內容");

            // 根據頁面名稱調用對應的渲染函式
            switch (target) {
                case "Content":
                    await renderHome(data, langIdx, target);
                    break;
                case "Product Catalog":
                    await renderProductCatalog(data, langIdx);
                    break;
                case "About Us":
                    await renderAboutOrContent(data, langIdx, target);
                    break;
                case "Business Scope":
                    await renderBusinessScope(data, langIdx, target);
                    break;
                case "Join Us":
                    await renderJoinUs(data, langIdx, target);
                    break;
                case "Contact Us":
                    await renderContactUs(data, langIdx, target);
                    break;
                default:
                    await renderAboutOrContent(data, langIdx, target);
                    break;
            }
        }

        // 4. 插入搜尋框（僅限產品相關目錄頁）
        if (isProductRelatedPage) {
            if (typeof getSearchBoxHtml === 'function') {
                if (!document.getElementById('product-search-input')) {
                    app.insertAdjacentHTML('afterbegin', getSearchBoxHtml());
                }
            }
        }

        // 5. 更新分頁標題 (Browser Tab Title)
        if (typeof updateTabTitle === 'function') {
            updateTabTitle();
        }

        // 6. 更新網址 URL (如果不跳過 pushState)
        if (updateUrl) {
        const newUrl = `?page=${encodeURIComponent(target)}&lang=${currentLang}${target === 'search' ? '&q=' + (new URLSearchParams(window.location.search).get('q') || '') : ''}`;
        window.history.pushState({ page: target, lang: currentLang }, '', newUrl);
    }

    } catch (e) {
        console.error(`${target} 載入失敗:`, e);
        app.innerHTML = `
            <div class="text-center py-20">
                <p class="text-gray-400 mb-4">${currentLang === 'zh' ? '載入失敗，請確認網路連線。' : 'Load failed, please check your connection.'}</p>
                <button onclick="location.reload()" class="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg transition">
                    ${currentLang === 'zh' ? '重新整理' : 'Reload'}
                </button>
            </div>`;
    } finally {
        // 7. 關閉全螢幕 Loading
        if (!skipLoading) {
            hideLoader();
        }
        // 捲動回頂部
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function renderHome(contentData, langIdx) {
    const app = document.getElementById('app');
    if (!app) return;

    // --- 關鍵修正：徹底清空 app 容器，確保 loadPage 產生的轉圈圈完全消失 ---
    app.innerHTML = ''; 

    let companyNames = ''; 
    let introContent = ''; 
    let youtubeEmbed = '';

    // A. 處理首頁主體 (YouTube + 公司名 + 簡介)
    contentData.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        // 抓取 YouTube 嵌入碼
        if (key.includes('youtube') && row[4]) {
            youtubeEmbed = `<div class="youtube-container shadow-2xl rounded-2xl overflow-hidden aspect-video">${row[4]}</div>`;
        }
        // 抓取公司中英文名稱
        if (key.includes('company name')) {
            companyNames += `
                <div class="mb-4 flex flex-col items-start">
                    <div class="w-2/3 md:w-full">
                        <h2 class="text-xl md:text-4xl font-black text-gray-900 leading-tight">${row[1]}</h2>
                        <h3 class="text-sm md:text-xl font-bold text-gray-400 mt-0.5 leading-tight">${row[2]}</h3>
                    </div>
                </div>`;
        }
        // 抓取簡介標題與內文
        if (key.includes('introduction title')) {
            introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${row[langIdx]}</h4>`;
        }
        if (key.includes('introduction') && !key.includes('title')) {
            introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${row[langIdx]}</p>`;
        }
    });

    // B. 準備向左走馬燈 (產品分類) - 修正為 <a> 標籤
    const catalogData = rawDataCache['Product Catalog'] || [];
    let categoryItems = '';
    catalogData.forEach(row => {
        if (row[0] && row[0].toLowerCase().trim().includes('categories') && row[4]) {
            const catName = row[4]; // 這是分類的 Key (ID)
            const displayName = row[langIdx] || catName;
            const imgUrl = row[3];
            
            // 使用 <a> 標籤並配合 onclick 切換頁面
            categoryItems += `
                <a href="?page=category&cat=${catName}&lang=${currentLang}" 
                   class="flex flex-col items-center gap-2 shrink-0 w-64 group cursor-pointer" 
                   onclick="event.preventDefault(); switchPage('category', {cat: '${catName}', title: '${displayName}'})">
                    <div class="w-full aspect-square overflow-hidden rounded-2xl shadow-md border group-hover:border-blue-500 group-hover:shadow-xl transition-all duration-300 bg-white">
                        <img src="${imgUrl}" class="w-full h-full object-contain p-2 group-hover:scale-110 transition-transform duration-500" alt="${displayName}">
                    </div>
                    <span class="font-bold text-gray-700 mt-2 group-hover:text-blue-600 transition-colors">${displayName}</span>
                </a>`;
        }
    });

    // C. 準備向右走馬燈 (廠房展示)
    const aboutData = rawDataCache['About Us'] || [];
    let aboutImages = '';
    aboutData.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        if (key.includes('upper image') && row[3]) {
            aboutImages += `
                <div class="shrink-0 w-80 h-52 overflow-hidden rounded-xl shadow-lg border bg-white">
                    <img src="${row[3]}" class="w-full h-full object-cover" alt="Factory Gallery">
                </div>`;
        }
    });

    // D. 語系標題判斷
    const titleCat = currentLang === 'zh' ? '熱門商品分類' : 'Featured Categories';
    const titleGallery = currentLang === 'zh' ? '廠房展示與實績' : 'Factory & Gallery';

    // E. 渲染完整 HTML
    app.innerHTML = `
        <div class="w-full flex flex-col items-center">
            <div class="max-w-7xl w-full px-4 flex flex-col md:flex-row gap-8 items-center text-left py-8 md:py-16">
                <div class="w-full md:w-1/2">${companyNames}</div>
                <div class="w-full md:w-1/2">${youtubeEmbed}</div>
            </div>

            ${(introContent.trim()) ? `
            <div class="w-full bg-white mb-16">
                <div class="max-w-4xl mx-auto px-4 text-center">
                    <div class="prose prose-lg max-w-none text-gray-600">${introContent}</div>
                </div>
            </div>` : ''}

            <div class="w-full mb-16">
                <div class="max-w-7xl mx-auto px-4">
                    <h2 class="text-2xl font-black mb-8 text-left border-l-4 border-blue-600 pl-4">${titleCat}</h2>
                </div>
                <div class="marquee-container">
                    <div class="marquee-content animate-scroll-left">
                        ${categoryItems}${categoryItems}
                    </div>
                </div>
            </div>

            <div class="w-full bg-gray-50 py-16">
                <div class="max-w-7xl mx-auto px-4">
                    <h2 class="text-2xl font-black mb-8 text-left border-l-4 border-gray-400 pl-4">${titleGallery}</h2>
                </div>
                <div class="marquee-container no-pause">
                    <div class="marquee-content animate-scroll-right">
                        ${aboutImages}${aboutImages}
                    </div>
                </div>
            </div>
        </div>`;
}

/* --- 輔助與工具函數 --- */

function getLocalizedCategoryName(rawCatName) {
    const data = rawDataCache["Product Catalog"];
    if (!data) return rawCatName;
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    const row = data.find(r => r[4] && r[4].trim() === rawCatName.trim());
    return (row && row[langIdx]) ? row[langIdx] : rawCatName;
}

/**
 * 修正後的 Markdown 解析函數
 * 支援 Rowspan (^) 與 Colspan (>) 合併單元格
 */
function parseMarkdownTable(zhText, enText) {
    let text = (currentLang === 'zh') ? (zhText || "") : (enText || zhText || "");
    if (!text) return "";
    
    const lines = text.split('\n');
    let html = '';
    let tableBuffer = [];
    let isProcessingTable = false;
    
    for (let i = 0; i <= lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine !== undefined ? rawLine.trim() : null;
        
        const isTableLine = line && line.startsWith('|') && line.includes('|');
        const isSeparator = line && line.match(/^[|:\s-]+$/);
        
        if (isTableLine && !isSeparator) {
            isProcessingTable = true;
            // 過濾掉頭尾的空元素
            let cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
            tableBuffer.push(cells);
            continue;
        }
        
        if ((!isTableLine || i === lines.length) && isProcessingTable) {
            if (tableBuffer.length > 0) {
                html += '<div class="overflow-x-auto my-4"><table class="custom-data-table">';
                
                // 表頭渲染
                html += '<thead><tr>';
                tableBuffer[0].forEach(cell => {
                    html += `<th>${processLinks(cell)}</th>`;
                });
                html += '</tr></thead><tbody>';

                const dataRows = tableBuffer.slice(1);
                const rowCount = dataRows.length;
                const colCount = tableBuffer[0].length;
                let skipMap = Array.from({ length: rowCount }, () => Array(colCount).fill(false));

                // 表身合併邏輯
                for (let r = 0; r < rowCount; r++) {
                    html += '<tr>';
                    for (let c = 0; c < colCount; c++) {
                        if (skipMap[r][c]) continue;

                        let cellContent = dataRows[r][c];
                        let rowspan = 1;
                        let colspan = 1;

                        // 1. 計算 Colspan (>)
                        for (let nextC = c + 1; nextC < colCount; nextC++) {
                            if (dataRows[r][nextC] === '>') {
                                colspan++;
                                skipMap[r][nextC] = true;
                            } else break;
                        }

                        // 2. 計算 Rowspan (^)
                        if (cellContent !== '^' && cellContent !== '>') {
                            for (let nextR = r + 1; nextR < rowCount; nextR++) {
                                if (dataRows[nextR][c] === '^') {
                                    rowspan++;
                                    skipMap[nextR][c] = true;
                                    for (let spanC = 1; spanC < colspan; spanC++) {
                                        skipMap[nextR][c + spanC] = true;
                                    }
                                } else break;
                            }
                        } else continue;

                        let cellClass = "";
                        if (cellContent.startsWith('#')) {
                            cellClass = "no-border-cell"; 
                            cellContent = cellContent.substring(1);
                        }

                        const processedContent = processLinks(cellContent);
                        const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
                        const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
                        
                        html += `<td${rowspanAttr}${colspanAttr} class="${cellClass}">${processedContent}</td>`;
                    }
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
            }
            tableBuffer = []; 
            isProcessingTable = false;
        }

        // 處理非表格內容
        if (line !== null && !isTableLine && !isSeparator) {
            const isImageUrl = line.match(/^https?:\/\/.*\.(jpg|jpeg|png|webp|gif|svg)$/i);
            if (isImageUrl) {
                html += `<div class="content-image-wrapper my-6"><img src="${line}" class="max-w-full h-auto rounded-lg shadow-md mx-auto"></div>`;
            } else if (line === "" && i < lines.length) {
                html += `<br>`;
            } else if (line !== "") {
                html += `<p class="mb-2 text-gray-700 leading-relaxed">${processLinks(line)}</p>`;
            }
        }
    }
    return html;
}

function processLinks(text) {
    if (!text) return "";
    return text.replace(/([^<]+)<(https?:\/\/[^>]+)>/g, function(match, label, url) {
        return `<a href="${url}" target="_blank" class="inline-flex items-center text-blue-600 hover:text-blue-800 underline font-bold decoration-2 underline-offset-4 mx-1">
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            ${label.trim()}
        </a>`;
    });
}

/* --- 頁面渲染邏輯 --- */

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
            const img = item["image_url"] ? item["image_url"].split(",")[0].trim() : "";
            const code = item["Item code (ERP)"];
            return `
                <a href="?page=product&id=${code}&lang=${currentLang}" class="category-card group block" onclick="event.preventDefault(); switchPage('product', {id: '${code}'})">
                    <div class="category-img-container"><img src="${img}" class="hover:scale-110 transition duration-500" alt="${name}"></div>
                    <div class="p-4 text-center">
                        <p class="text-xs text-blue-600 font-bold mb-1">${code}</p>
                        <h4 class="font-bold text-gray-800">${name}</h4>
                    </div>
                </a>`;
        }).join('');

        app.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 text-left">
                <nav class="text-gray-500 text-sm mb-8 italic">
                    <a href="?page=Product Catalog&lang=${currentLang}" onclick="event.preventDefault(); switchPage('Product Catalog')" class="hover:text-blue-600">${breadcrumbLabel}</a> 
                    <span class="mx-2">&gt;</span> 
                    <span class="text-gray-900 font-bold">${localizedCatName}</span>
                </nav>
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">${itemsHtml || '<p>No products found.</p>'}</div>
            </div>`;
    } catch (e) {
        app.innerHTML = `<div class="text-center py-20 text-red-500">載入失敗。</div>`;
    }
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

        // 1. 建立 Logo 圖庫
        const catalogSheetData = rawDataCache["Product Catalog"] || [];
        const logoLibrary = {};
        catalogSheetData.forEach(row => {
            const rawName = String(row[0] || "").trim();
            const logoUrl = String(row[3] || "").trim();
            if (rawName.toLowerCase().startsWith("store") && logoUrl) {
                logoLibrary[rawName.toLowerCase().replace(/\s+/g, '')] = logoUrl;
            }
        });

        // 2. 處理賣場連結
        let storeLinksHtml = '';
        [{ key: "Store 1網址", id: "store1" }, { key: "Store 2網址", id: "store2" }, { key: "Store 3網址", id: "store3" }, { key: "Store 4網址", id: "store4" }].forEach(store => {
            const storeUrl = (item[store.key] || "").trim();
            const logoUrl = logoLibrary[store.id];
            if (storeUrl && storeUrl !== "#" && logoUrl) {
                storeLinksHtml += `
                    <a href="${storeUrl}" target="_blank" class="hover:scale-110 transition shrink-0 block">
                        <img src="${logoUrl}" class="h-14 w-auto shadow-md rounded-lg border bg-white p-1">
                    </a>`;
            }
        });

        // 3. 語言與標籤
        const isZH = (currentLang === 'zh');
        const rawCatName = (item["Category"] || "").trim();
        const localizedCatName = getLocalizedCategoryName(rawCatName);
        const labels = {
            catalog: isZH ? '商品目錄' : 'Product Catalog',
            packing: isZH ? '包裝規格' : 'Packing',
            category: isZH ? '商品分類' : 'Category',
            specs: isZH ? '商品描述與規格' : 'Specifications'
        };
        
        const name = isZH ? (item["Chinese product name"] || itemCode) : (item["English product name"] || itemCode);
        updateTabTitle(name);

        const zhDesc = item["desc_zh"] || "";
        const enDesc = item["desc_en"] || "";
        const images = item["image_url"] ? String(item["image_url"]).split(",").map(s => s.trim()) : [];

        // 4. 渲染
        app.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 text-left">
                <nav class="flex text-gray-400 text-sm mb-8 italic">
                    <span class="cursor-pointer hover:text-blue-600" onclick="switchPage('Product Catalog')">${labels.catalog}</span>
                    <span class="mx-2">&gt;</span>
                    <span class="cursor-pointer hover:text-blue-600" onclick="switchPage('category', {cat: '${rawCatName}'})">${localizedCatName}</span>
                </nav>

                <div class="flex flex-col md:flex-row gap-12">
                    <div class="w-full md:w-1/2">
                        <img id="main-prod-img" src="${images[0] || ''}" class="w-full rounded-2xl shadow-xl border bg-white aspect-square object-contain">
                        <div class="flex gap-3 mt-6 overflow-x-auto pb-2">
                            ${images.map(img => `<img src="${img}" onclick="document.getElementById('main-prod-img').src='${img}'" class="w-20 h-20 object-cover rounded-lg cursor-pointer border-2 hover:border-blue-500 bg-white transition shadow-sm">`).join('')}
                        </div>
                    </div>

                    <div class="w-full md:w-1/2">
                        <div class="flex items-start justify-between gap-4 mb-2">
                            <h1 class="text-4xl font-black text-gray-900 leading-tight flex-1">${name}</h1>
                            <div class="flex gap-4 pt-1">${storeLinksHtml}</div>
                        </div>
                        <p class="text-2xl text-blue-600 font-bold mb-8">${itemCode}</p>
                        
                        <div class="bg-gray-50 rounded-2xl p-8 mb-8 border border-gray-100 shadow-sm">
                            <div class="grid grid-cols-2 gap-8">
                                <div>
                                    <span class="text-gray-400 block text-xs uppercase tracking-wider mb-1">${labels.packing}</span>
                                    <b class="text-xl text-gray-800">${item["Packing規格"] || "--"} ${item["Unit單位"] || ""}</b>
                                </div>
                                <div>
                                    <span class="text-gray-400 block text-xs uppercase tracking-wider mb-1">${labels.category}</span>
                                    <b class="text-xl text-gray-800">${localizedCatName}</b>
                                </div>
                            </div>
                        </div>

                        <div class="prose prose-slate max-w-none">
                            <h4 class="text-lg font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-500 inline-block">${labels.specs}</h4>
                            <div class="text-gray-600 leading-relaxed mt-2">
                                ${parseMarkdownTable(zhDesc, enDesc)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

    } catch (e) { 
        app.innerHTML = `<div class="text-center py-20 text-red-500">Error loading product.</div>`; 
    }
}

// 確保這個函式是在最外層，不要包在 initWebsite 裡面
async function toggleLang() {
    // 1. 取得目前的網址參數
    const urlParams = new URLSearchParams(window.location.search);
    
    // 2. 切換語系變數
    currentLang = (currentLang === 'zh') ? 'en' : 'zh';
    
    // 3. 同步更新 URL 中的 lang 參數，其餘 (page, cat, id) 會被保留
    urlParams.set('lang', currentLang);
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    // 4. 更新介面 UI
    updateLangButton();
    renderLogoAndStores();
    renderNav();

    // 5. 重新載入當前頁面
    // 注意：這裡傳入 false 是為了避免 loadPage 再次 pushState 導致網址亂掉
    await loadPage(currentPage, false);
}

/* --- 系統 UI 同步 --- */

function updateLangButton() {
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = (currentLang === 'zh') ? 'EN' : '繁中';
}

function updateTabTitle(pageTitle = "") {
    const isEn = (currentLang === 'en');
    const companyName = isEn ? "JIN HUEI PLASTIC" : "錦輝塑膠業有限公司";
    let displayTitle = pageTitle;
    
    if (!displayTitle) {
        if (currentPage === 'Content') displayTitle = isEn ? "Home" : "首頁";
        else if (currentPage === 'Product Catalog') displayTitle = isEn ? "Catalog" : "商品目錄";
        else displayTitle = currentPage;
    }
    document.title = `${displayTitle} | ${companyName}`;
}

window.onpopstate = function(event) {
    const params = new URLSearchParams(window.location.search);
    currentLang = params.get('lang') || 'zh'; 
    currentPage = params.get('page') || 'Content';
    
    loadPage(currentPage, false, true);
    renderNav();
    updateLangButton();
    updateTabTitle();
};

document.addEventListener('DOMContentLoaded', initWebsite);
