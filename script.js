/* --- 全域變數與配置 --- */
const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const tabs = ["Content", "About Us", "Business Scope", "Product Catalog", "Join Us", "Contact Us"];
let currentLang = 'zh';
let currentPage = 'Content';
let rawDataCache = {};
let allProductsCache = null;
let storeLogoMap = {};

/* --- Loader --- */
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
        setTimeout(() => { loader.style.display = 'none'; }, 300);
    }
}

/* --- Supabase 核心請求函數 --- */
async function supabaseFetch(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status} on ${path}`);
    return res.json();
}

/* --- 資料抓取：網站內容（對應原本 fetchSheetData）--- */
// 從 Supabase site_content 表抓資料，轉換成原本 Google Sheet 二維陣列格式
// 格式：[row_key, chinese, english, image, link]
//        row[0]   row[1]   row[2]   row[3] row[4]
async function fetchSheetData(sheetName) {
    try {
        const data = await supabaseFetch(
            `site_content?page=eq.${encodeURIComponent(sheetName)}&order=row_index.asc`
        );
        return data.map(row => [
            row.row_key  || '',
            row.chinese  || '',
            row.english  || '',
            row.image    || '',
            row.link     || ''
        ]);
    } catch (e) {
        console.error(`❌ fetchSheetData(${sheetName}) 失敗:`, e);
        return [];
    }
}

/* --- 資料抓取：產品資料（對應原本 fetchGASProducts）--- */
// 從 Supabase products 表抓資料，轉換成原本 GAS API 的物件格式
// 讓所有現有的渲染函數（renderCategoryList、renderProductDetail 等）不需要改動
async function fetchGASProducts() {
    if (allProductsCache) return allProductsCache;
    try {
        const data = await supabaseFetch(`products?select=*&limit=5`);
        );
        allProductsCache = data.map(p => ({
            "Category":                p.category_name_zh || '',
            "Item code (ERP)":         p.erp_code     || '',
            "Item code (catalog)":     p.catalog_code || '',
            "Chinese product name":    p.name_zh      || '',
            "English product name":    p.name_en      || '',
            "image_url":               p.image_url    || '',
            "desc_zh":                 p.desc_zh      || '',
            "desc_en":                 p.desc_en      || '',
            "Packing規格":             p.pcs_per_pack || '',
            "Unit單位":                p.unit         || '',
            "keywords":                p.keywords     || '',
            "Store 1網址":             p.store1_url   || '',
            "Store 2網址":             p.store2_url   || '',
            "Store 3網址":             p.store3_url   || '',
            "Store 4網址":             p.store4_url   || '',
        }));
        return allProductsCache;
    } catch (e) {
        console.error("❌ fetchGASProducts 失敗:", e);
        throw e;
    }
}

/* --- 主資料載入（對應原本 fetchData）--- */
async function fetchData() {
    try {
        console.log("開始從 Supabase 抓取所有資料...");
        // 同時抓取所有分頁內容 + 產品資料
        const [sheetResults, products] = await Promise.all([
            Promise.all(tabs.map(tab => fetchSheetData(tab))),
            fetchGASProducts()
        ]);
        tabs.forEach((tab, index) => {
            rawDataCache[tab] = sheetResults[index];
        });
        rawDataCache["allProducts"] = products;
        console.log("✅ 資料全部載入完成", rawDataCache);
        return true;
    } catch (e) {
        console.error("❌ fetchData 發生錯誤:", e);
        throw e;
    }
}

/* --- 渲染 Logo 與賣場圖標 --- */
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

/* --- 路由與頁面切換 --- */
function switchPage(page, params = {}) {
    const targetPage = page || 'Content';
    currentPage = targetPage;

    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('page', targetPage);
    u.searchParams.set('lang', currentLang);

    for (const key in params) {
        if (params[key]) u.searchParams.set(key, params[key]);
    }

    window.history.pushState({ page: targetPage, params: params }, '', u.toString());
    updateTabTitle(params.title || targetPage);
    renderNav();
    loadPage(targetPage, false, true);
    window.scrollTo(0, 0);
}

/* --- 渲染各頁面 --- */

function renderBusinessScope(data, langIdx, pageName) {
    const app = document.getElementById('app');
    const titleRow = data.find(r => r[0] && r[0].toLowerCase().trim() === 'title');
    let contentImages = '';

    data.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
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

function renderProductCatalog(data, langIdx) {
    const app = document.getElementById('app');
    let catHtml = '';

    data.forEach(row => {
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
            const itemCode = String(p["Item code (ERP)"] || "").toLowerCase();
            const zhName   = String(p["Chinese product name"] || "").toLowerCase();
            const enName   = String(p["English product name"] || "").toLowerCase();
            const keywords = String(p["keywords"] || "").toLowerCase();
            return itemCode.includes(query) || zhName.includes(query) || enName.includes(query) || keywords.includes(query);
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
        const name = (currentLang === 'zh')
            ? (item["Chinese product name"] || item["Item code (ERP)"])
            : (item["English product name"] || item["Item code (ERP)"]);
        const img  = item["image_url"] ? item["image_url"].split(",")[0].trim() : "";
        const code = item["Item code (ERP)"];

        return `
            <a href="?page=product&id=${code}&lang=${currentLang}" class="category-card group block"
               onclick="event.preventDefault(); switchPage('product', {id: '${code}'})">
                <div class="category-img-container">
                    <img src="${img}" class="hover:scale-110 transition duration-500"
                         onerror="this.src='https://via.placeholder.com/300?text=No+Image'">
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

/* --- 初始化 --- */
async function initWebsite() {
    try {
        const params = new URLSearchParams(window.location.search);
        currentLang = params.get('lang') || 'zh';
        currentPage = params.get('page') || 'Content';

        showLoader();
        await fetchData();
        renderLogoAndStores();
        renderNav();
        updateLangButton();
        updateTabTitle(params.get('title'));
        await loadPage(currentPage, true, false);

        document.addEventListener('click', (e) => {
            const anchor = e.target.closest('a');
            if (anchor && anchor.getAttribute('href')?.startsWith('?page=')) {
                e.preventDefault();
                const urlParams = new URLSearchParams(anchor.getAttribute('href'));
                const page  = urlParams.get('page');
                const id    = urlParams.get('id');
                const cat   = urlParams.get('cat');
                const title = urlParams.get('title');
                switchPage(page, { id, cat, title });
            }
        });

    } catch (e) {
        console.error("初始化失敗:", e);
        document.getElementById('app').innerHTML = `<div class="text-center py-20">載入失敗，請檢查網路連線。</div>`;
    } finally {
        hideLoader();
    }
}

window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page') || 'Content';
    currentLang = params.get('lang') || 'zh';
    loadPage(page, false, false);
});

/* --- 導覽列 --- */
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
                <a href="javascript:void(0)" class="block px-4 py-2" onclick="switchPage('${tab}')">
                    ${displayName}
                </a>
            </li>`;
    }
    nav.innerHTML = navHtml;
}

/* --- 核心頁面載入函式 --- */
async function loadPage(pageName, updateUrl = false, skipLoading = false) {
    const target = pageName || 'Content';
    currentPage = target;

    const app = document.getElementById('app');
    if (!app) return;

    const langIdx = (currentLang === 'zh') ? 1 : 2;
    const isProductRelatedPage = ['Product Catalog', 'category', 'search'].includes(target);

    if (!skipLoading) showLoader();

    try {
        if (target === 'category') {
            await renderCategoryList();
        } else if (target === 'product') {
            await renderProductDetail();
        } else if (target === 'search') {
            const p = new URLSearchParams(window.location.search);
            await executeSearch(p.get('q'));
        } else {
            let data = rawDataCache[target];
            if (!data || data.length === 0) {
                data = await fetchSheetData(target);
                rawDataCache[target] = data;
            }
            if (!data || data.length === 0) throw new Error("無資料內容");

            switch (target) {
                case "Content":         await renderHome(data, langIdx, target); break;
                case "Product Catalog": await renderProductCatalog(data, langIdx); break;
                case "About Us":        await renderAboutOrContent(data, langIdx, target); break;
                case "Business Scope":  await renderBusinessScope(data, langIdx, target); break;
                case "Join Us":         await renderJoinUs(data, langIdx, target); break;
                case "Contact Us":      await renderContactUs(data, langIdx, target); break;
                default:                await renderAboutOrContent(data, langIdx, target); break;
            }
        }

        if (isProductRelatedPage) {
            if (typeof getSearchBoxHtml === 'function') {
                if (!document.getElementById('product-search-input')) {
                    app.insertAdjacentHTML('afterbegin', getSearchBoxHtml());
                }
            }
        }

        if (typeof updateTabTitle === 'function') {
            updateTabTitle();
        }

        if (updateUrl) {
            const targetUrlParams = new URLSearchParams(window.location.search);
            targetUrlParams.set('page', target);
            targetUrlParams.set('lang', currentLang);
            if (target === 'search') {
                const q = targetUrlParams.get('q') || '';
                targetUrlParams.set('q', q);
            }
            const newSearchString = `?${targetUrlParams.toString()}`;
            if (window.location.search !== newSearchString) {
                window.history.pushState({ page: target, lang: currentLang }, '', newSearchString);
            }
        }

    } catch (e) {
        console.error(`${target} 載入失敗:`, e);
        app.innerHTML = `<div class="text-center py-20">載入失敗，請稍後再試。</div>`;
    } finally {
        if (!skipLoading) hideLoader();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/* --- 首頁渲染 --- */
async function renderHome(contentData, langIdx) {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';

    let companyNames = '';
    let introContent = '';
    let youtubeEmbed = '';

    contentData.forEach(row => {
        const key = (row[0] || "").toLowerCase().trim();
        if (key.includes('youtube') && row[4]) {
            youtubeEmbed = `<div class="youtube-container shadow-2xl rounded-2xl overflow-hidden aspect-video">${row[4]}</div>`;
        }
        if (key.includes('company name')) {
            companyNames += `
                <div class="mb-4 flex flex-col items-start">
                    <div class="w-2/3 md:w-full">
                        <h2 class="text-xl md:text-4xl font-black text-gray-900 leading-tight">${row[1]}</h2>
                        <h3 class="text-sm md:text-xl font-bold text-gray-400 mt-0.5 leading-tight">${row[2]}</h3>
                    </div>
                </div>`;
        }
        if (key.includes('introduction title')) {
            introContent += `<h4 class="text-2xl font-bold mb-4 text-gray-800">${row[langIdx]}</h4>`;
        }
        if (key.includes('introduction') && !key.includes('title')) {
            introContent += `<p class="text-lg leading-loose text-gray-700 mb-6" style="white-space: pre-line;">${row[langIdx]}</p>`;
        }
    });

    const catalogData = rawDataCache['Product Catalog'] || [];
    let categoryItems = '';
    catalogData.forEach(row => {
        if (row[0] && row[0].toLowerCase().trim().includes('categories') && row[4]) {
            const catName    = row[4];
            const displayName = row[langIdx] || catName;
            const imgUrl     = row[3];
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

    const titleCat     = currentLang === 'zh' ? '熱門商品分類' : 'Featured Categories';
    const titleGallery = currentLang === 'zh' ? '廠房展示與實績' : 'Factory & Gallery';

    app.innerHTML = `
        <div class="w-full flex flex-col items-center">
            <div class="max-w-7xl w-full px-4 flex flex-col md:flex-row gap-8 items-center text-left py-8 md:py-16">
                <div class="w-full md:w-1/2">${companyNames}</div>
                <div class="w-full md:w-1/2">${youtubeEmbed}</div>
            </div>
            ${introContent.trim() ? `
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

/* --- 輔助函數 --- */
function getLocalizedCategoryName(rawCatName) {
    if (!rawCatName) return "";
    const catalogSheetData = rawDataCache["Product Catalog"] || [];
    const langIdx = (currentLang === 'zh') ? 1 : 2;
    const row = catalogSheetData.find(r =>
        r && r[0] && String(r[0]).trim().toLowerCase() === String(rawCatName).trim().toLowerCase()
    );
    if (row) return (row[langIdx] || row[1] || rawCatName).trim();
    return rawCatName;
}

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
            let cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1);
            tableBuffer.push(cells);
            continue;
        }

        if ((!isTableLine || i === lines.length) && isProcessingTable) {
            if (tableBuffer.length > 0) {
                html += '<div class="overflow-x-auto my-4"><table class="custom-data-table">';
                html += '<thead><tr>';
                tableBuffer[0].forEach(cell => { html += `<th>${processLinks(cell)}</th>`; });
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
                        let rowspan = 1;
                        let colspan = 1;

                        for (let nextC = c + 1; nextC < colCount; nextC++) {
                            if (dataRows[r][nextC] === '>') { colspan++; skipMap[r][nextC] = true; } else break;
                        }
                        if (cellContent !== '^' && cellContent !== '>') {
                            for (let nextR = r + 1; nextR < rowCount; nextR++) {
                                if (dataRows[nextR][c] === '^') {
                                    rowspan++;
                                    skipMap[nextR][c] = true;
                                    for (let spanC = 1; spanC < colspan; spanC++) skipMap[nextR][c + spanC] = true;
                                } else break;
                            }
                        } else continue;

                        let cellClass = "";
                        if (cellContent.startsWith('#')) { cellClass = "no-border-cell"; cellContent = cellContent.substring(1); }

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

/* --- 分類列表頁 --- */
async function renderCategoryList() {
    const params = new URLSearchParams(window.location.search);
    const rawCatName = params.get('cat') || "";
    const app = document.getElementById('app');

    app.innerHTML = `<div class="flex justify-center items-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const filtered = allProducts.filter(p => String(p["Category"] || "").trim() === String(rawCatName).trim());

        if (filtered.length > 0) console.log("Supabase Data Sample:", filtered[0]);

        const localizedCatName = getLocalizedCategoryName(rawCatName);
        const breadcrumbLabel = (currentLang === 'zh') ? '商品目錄' : 'Product Catalog';

        let itemsHtml = filtered.map(item => {
            const name = (currentLang === 'zh')
                ? (item["Chinese product name"] || item["Item code (ERP)"])
                : (item["English product name"] || item["Item code (ERP)"]);
            const code = item["Item code (ERP)"];
            let img = "";
            if (item["image_url"]) {
                img = String(item["image_url"]).trim().split(",")[0].trim();
            }
            if (!img) console.warn(`商品 ${code} 找不到圖片網址`);

            return `
                <a href="?page=product&id=${code}&lang=${currentLang}"
                   class="category-card group block"
                   onclick="event.preventDefault(); event.stopPropagation(); switchPage('product', {id: '${code}'})">
                    <div class="category-img-container">
                        <img src="${img}" alt="${name}"
                             class="hover:scale-110 transition duration-500"
                             style="background-color: #f3f4f6;">
                    </div>
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
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    ${itemsHtml || '<p class="col-span-full text-center py-10">No products found.</p>'}
                </div>
            </div>`;
    } catch (e) {
        console.error("渲染分類清單錯誤:", e);
        app.innerHTML = `<div class="text-center py-20 text-red-500">載入失敗。</div>`;
    }
}

/* --- 產品詳細頁 --- */
async function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const itemCode = params.get('id');
    const app = document.getElementById('app');

    if (!itemCode) {
        app.innerHTML = `<div class="text-center py-20">Missing Product ID.</div>`;
        return;
    }

    app.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>`;

    try {
        const allProducts = await fetchGASProducts();
        const item = allProducts.find(p => String(p["Item code (ERP)"] || "").trim() == String(itemCode).trim());

        if (!item || !item["Item code (ERP)"]) {
            app.innerHTML = `<div class="text-center py-20">${currentLang === 'zh' ? '找不到商品內容。' : 'Product not found.'}</div>`;
            return;
        }

        // 從 Product Catalog 分頁資料抓取賣場 logo
        const catalogSheetData = rawDataCache["Product Catalog"] || [];
        const logoLibrary = {};
        catalogSheetData.forEach(row => {
            const rawName = String(row[0] || "").trim();
            const logoUrl = String(row[3] || "").trim();
            if (rawName.toLowerCase().startsWith("store") && logoUrl) {
                logoLibrary[rawName.toLowerCase().replace(/\s+/g, '')] = logoUrl;
            }
        });

        let storeLinksHtml = '';
        [{ key: "Store 1網址", id: "store1" }, { key: "Store 2網址", id: "store2" }, { key: "Store 3網址", id: "store3" }, { key: "Store 4網址", id: "store4" }].forEach(store => {
            const storeUrl = (item[store.key] || "").trim();
            const logoUrl  = logoLibrary[store.id];
            if (storeUrl && storeUrl !== "#" && logoUrl) {
                storeLinksHtml += `
                    <a href="${storeUrl}" target="_blank" class="hover:scale-110 transition shrink-0 block">
                        <img src="${logoUrl}" class="h-14 w-auto shadow-md rounded-lg border bg-white p-1">
                    </a>`;
            }
        });

        const isZH = (currentLang === 'zh');
        const rawCatName       = (item["Category"] || "").trim();
        const localizedCatName = getLocalizedCategoryName(rawCatName);
        const name             = isZH ? (item["Chinese product name"] || itemCode) : (item["English product name"] || itemCode);

        updateTabTitle(name);

        const labels = {
            catalog:  isZH ? '商品目錄' : 'Product Catalog',
            packing:  isZH ? '包裝規格' : 'Packing',
            category: isZH ? '商品分類' : 'Category',
            specs:    isZH ? '商品描述與規格' : 'Specifications'
        };

        const zhDesc = item["desc_zh"] || "";
        const enDesc = item["desc_en"] || "";
        const images = item["image_url"] ? String(item["image_url"]).split(",").map(s => s.trim()) : [];

        app.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 text-left">
                <nav class="flex text-gray-400 text-sm mb-8 italic">
                    <span class="cursor-pointer hover:text-blue-600" onclick="switchPage('Product Catalog')">${labels.catalog}</span>
                    <span class="mx-2">&gt;</span>
                    <span class="cursor-pointer hover:text-blue-600"
                          onclick="switchPage('category', {cat: '${rawCatName}', title: '${localizedCatName}'})">
                          ${localizedCatName}
                    </span>
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

        setTimeout(() => updateTabTitle(name), 150);

    } catch (e) {
        console.error("renderProductDetail 錯誤:", e);
        app.innerHTML = `<div class="text-center py-20 text-red-500">Error loading product data.</div>`;
    }
}

/* --- 語系切換 --- */
async function toggleLang() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLang = (currentLang === 'zh') ? 'en' : 'zh';
    urlParams.set('lang', currentLang);
    const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.replaceState({ page: currentPage, lang: currentLang }, '', newUrl);
    updateLangButton();
    renderLogoAndStores();
    renderNav();
    updateTabTitle();
    await loadPage(currentPage, false);
}

function updateLangButton() {
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = (currentLang === 'zh') ? 'EN' : '繁中';
}

function updateTabTitle(pageTitle = "") {
    const isEn = (currentLang === 'en');
    const companyName = isEn ? "JIN HUEI PLASTIC" : "錦輝塑膠業有限公司";
    const params = new URLSearchParams(window.location.search);

    let displayTitle = "";
    if (pageTitle && currentPage === 'product') {
        displayTitle = pageTitle;
    } else if (currentPage === 'category') {
        const catId = params.get('cat');
        displayTitle = getLocalizedCategoryName(catId);
    } else {
        displayTitle = params.get('title');
        if (!displayTitle) {
            if (currentPage === 'Content') displayTitle = isEn ? "Home" : "首頁";
            else if (currentPage === 'Product Catalog') displayTitle = isEn ? "Catalog" : "商品目錄";
            else displayTitle = currentPage;
        }
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
    updateTabTitle(params.get('title'));
};

document.addEventListener('DOMContentLoaded', initWebsite);
