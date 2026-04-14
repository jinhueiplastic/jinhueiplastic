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
            const keys = Object.keys(p);
            const itemCode = String(p[keys[1]] || "").toLowerCase();
            const chineseName = String(p[keys[3]] || "").toLowerCase();
            const englishName = String(p[keys[6]] || "").toLowerCase();
            return itemCode.includes(query) || chineseName.includes(query) || englishName.includes(query);
        });
        renderSearchResults(filtered, query);
    } catch (e) {
        app.innerHTML = `<div class="text-center py-20 text-red-500">搜尋出錯。</div>`;
    }
}

function renderSearchResults(products, query) {
    const app = document.getElementById('app');
    const title = currentLang === 'zh' ? `搜尋結果: ${query}` : `Search Results: ${query}`;
    
    let itemsHtml = products.map(item => {
        const name = (currentLang === 'zh') ? (item["Chinese product name"] || item["Item code (ERP)"]) : (item["English product name"] || item["Item code (ERP)"]);
        const img = item["圖片"] ? item["圖片"].split(",")[0].trim() : "";
        const code = item["Item code (ERP)"];
        return `
            <a href="?page=product&id=${code}&lang=${currentLang}" class="category-card group block" onclick="event.preventDefault(); switchPage('product', {id: '${code}'})">
                <div class="category-img-container"><img src="${img}" class="hover:scale-110 transition duration-500"></div>
                <div class="p-4 text-center">
                    <p class="text-xs text-blue-600 font-bold mb-1">${code}</p>
                    <h4 class="font-bold text-gray-800">${name}</h4>
                </div>
            </a>`;
    }).join('');

    app.innerHTML = `
        <div class="max-w-7xl mx-auto px-4">
            <h2 class="text-2xl font-bold mb-8 pb-2 border-b">${title}</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">${itemsHtml || '<p class="col-span-full text-center">No results.</p>'}</div>
        </div>`;
}

/* --- 初始化與導覽 --- */
async function initWebsite() {
    try {
        const params = new URLSearchParams(window.location.search);
        currentLang = params.get('lang') || 'zh';
        currentPage = params.get('page') || 'Content'; 

        await fetchData(); 
        renderLogoAndStores();
        renderNav();
        loadPage(currentPage, false, true);

        // 新增：監聽點擊攔截，確保動態生成的 A 標籤正常運作
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
        document.getElementById('app').innerHTML = `<div class="text-center py-20">載入失敗。</div>`;
    }
}

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

async function loadPage(pageName, updateUrl = true, skipLoading = false) {
    // 1. 參數初始化與防呆
    const target = pageName || 'Content';
    console.log(`執行 loadPage: ${target}`);
    
    const app = document.getElementById('app');
    if (!app) return;

    const langIdx = (currentLang === 'zh') ? 1 : 2;
    // 定義哪些頁面屬於產品相關（需顯示搜尋框）
    const isProductRelatedPage = ['Product Catalog', 'category', 'search'].includes(target);

    // 2. 顯示 Loading 狀態
    let data = rawDataCache[target];
    const hasData = data && data.length > 0;
    
    if (!skipLoading && !hasData) {
        app.innerHTML = `
            <div id="loading-spinner" class="flex justify-center py-20">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>`;
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
            // 一般分頁資料抓取（若無快取）
            if (!hasData) {
                data = await fetchSheetData(target);
                rawDataCache[target] = data;
            }
            
            if (!data || data.length === 0) throw new Error("無資料內容");

            // 根據頁面名稱調用對應的渲染函式
            switch (target) {
                case "Content":
                    await renderHome(data, langIdx);
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

        // 4. 移除 Loading 轉圈圈
        const spinner = document.getElementById('loading-spinner');
        if (spinner) spinner.remove();

        // 5. 插入搜尋框（僅限產品相關目錄頁，且不在商品詳情頁顯示）
        if (isProductRelatedPage) {
            if (typeof getSearchBoxHtml === 'function') {
                // 檢查是否已經存在搜尋框，避免重複插入
                if (!document.getElementById('product-search-input')) {
                    app.insertAdjacentHTML('afterbegin', getSearchBoxHtml());
                }
            }
        }

    } catch (e) {
        console.error(`${target} 載入失敗:`, e);
        app.innerHTML = `
            <div class="text-center py-20">
                <p class="text-gray-400 mb-4">${currentLang === 'zh' ? '載入失敗，請確認網路連線。' : 'Load failed, please check your connection.'}</p>
                <button onclick="location.reload()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    ${currentLang === 'zh' ? '重新整理' : 'Reload'}
                </button>
            </div>`;
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
            const img = item["圖片"] ? item["圖片"].split(",")[0].trim() : "";
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

        const zhDesc = item["Description中文描述"] || "";
        const enDesc = item["English description英文描述"] || "";
        const images = item["圖片"] ? String(item["圖片"]).split(",").map(s => s.trim()) : [];

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
