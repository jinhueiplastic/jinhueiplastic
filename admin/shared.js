const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 目前登入的後台帳號 email／顯示名稱，登入後由 initAdminAuth 填入；
// 給需要記錄「誰建立的」的地方用（例如訂單）。顯示名稱存在 Supabase Auth 的
// user_metadata 裡（每個帳號自己設定），沒設定過的話就先用 email 頂著。
let currentUserEmail = '';
let currentUserDisplayName = '';

const ADMIN_PAGES = [
    { key: 'pos',       href: '/admin/pos.html',         label: 'POS 下單' },
    { key: 'orders',    href: '/admin/orders.html',      label: '查詢訂單' },
    { key: 'region',    href: '/admin/region-form.html', label: '合併區域表單' },
    { key: 'stats',     href: '/admin/stats.html',       label: '統計' },
    { key: 'customers', href: '/admin/customers.html',   label: '客戶資訊' },
    { key: 'products',  href: '/admin/',                 label: '修改 POS 商品' },
    { key: 'houjiao',   href: '/admin/metalstud.html',   label: '打腳通知' },
];

function renderAdminNav(activeKey) {
    const nav = document.getElementById('admin-nav');
    if (!nav) return;
    nav.innerHTML = ADMIN_PAGES.map(p => `
        <a href="${p.href}" class="admin-nav-link${p.key === activeKey ? ' active' : ''}">${p.label}</a>
    `).join('');
}

// 每天晚上 11:59（換日前一分鐘）強制全部帳號登出一次。純前端做法：把「登入的邏輯日」存在
// localStorage，每次開頁面、以及開著頁面時每分鐘檢查一次，發現跟現在的邏輯日不一樣就登出。
// 缺點：不是精確到 23:59:00 那一刻踢人，是「下次有動作（開頁面/每分鐘檢查）」時才生效——
// 例如電腦整晚沒開著頁面，隔天早上打開才會觸發；沒有後端可以無論如何都準時踢人。
const ADMIN_LOGICAL_DAY_KEY = 'adminLogicalDay';
const ADMIN_DAILY_LOGOUT_CUTOFF_MINUTES = 23 * 60 + 59; // 晚上 11:59

function currentLogicalDayKey() {
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const d = new Date(now);
    if (minutesNow >= ADMIN_DAILY_LOGOUT_CUTOFF_MINUTES) d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-CA'); // YYYY-MM-DD，用瀏覽器當地時區
}

// 換日了的話登出並重新整理回登入畫面；回傳是否觸發了登出（呼叫端可以藉此中斷後續流程）。
async function enforceDailyLogout() {
    const stored = localStorage.getItem(ADMIN_LOGICAL_DAY_KEY);
    const current = currentLogicalDayKey();
    if (stored && stored !== current) {
        localStorage.removeItem(ADMIN_LOGICAL_DAY_KEY);
        await sb.auth.signOut();
        location.reload();
        return true;
    }
    localStorage.setItem(ADMIN_LOGICAL_DAY_KEY, current);
    return false;
}

// 每個後台頁面共用：處理登入表單、登出、以及登入成功後導頁面自己的初始化函式（onReady）。
function initAdminAuth(pageKey, onReady) {
    const loginView   = document.getElementById('login-view');
    const appView     = document.getElementById('app-view');
    const loginForm   = document.getElementById('login-form');
    const loginError  = document.getElementById('login-error');
    const userEmailEl = document.getElementById('user-email');
    const logoutBtn   = document.getElementById('logout-btn');
    const editNameBtn = document.getElementById('edit-display-name-btn');

    renderAdminNav(pageKey);

    async function onLoggedIn(session) {
        if (await enforceDailyLogout()) return; // 已經換日，登出流程已經在跑，這裡不用再往下做

        loginView.classList.add('hidden');
        appView.classList.remove('hidden');
        currentUserEmail = session.user.email || '';
        currentUserDisplayName = (session.user.user_metadata && session.user.user_metadata.display_name) || currentUserEmail;
        if (userEmailEl) userEmailEl.textContent = currentUserDisplayName;

        // 「設定顯示名稱」只給 admin 帳號看得到——role 存在 app_metadata（跟 auth.jwt() 一樣，
        // 只有後台/SQL Editor 改得動，使用者自己登入後沒辦法透過畫面把自己升成 admin）。
        const isAdmin = !!(session.user.app_metadata && session.user.app_metadata.role === 'admin');
        if (editNameBtn) editNameBtn.classList.toggle('hidden', !isAdmin);

        onReady();

        // 頁面開著跨過 23:59 的話，不用等使用者重新整理，每分鐘檢查一次就會自動登出。
        setInterval(enforceDailyLogout, 60 * 1000);
    }

    if (editNameBtn) {
        editNameBtn.addEventListener('click', async () => {
            const newName = prompt('設定你的顯示名稱（會取代訂單記錄、頁面右上角顯示的 email）：', currentUserDisplayName);
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) return;

            const { error } = await sb.auth.updateUser({ data: { display_name: trimmed } });
            if (error) {
                alert('設定失敗：' + error.message);
                return;
            }
            currentUserDisplayName = trimmed;
            if (userEmailEl) userEmailEl.textContent = currentUserDisplayName;
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            loginError.classList.add('hidden');
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            const { data, error } = await sb.auth.signInWithPassword({ email, password });
            if (error) {
                loginError.textContent = '登入失敗：' + error.message;
                loginError.classList.remove('hidden');
                return;
            }
            onLoggedIn(data.session);
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            localStorage.removeItem(ADMIN_LOGICAL_DAY_KEY);
            await sb.auth.signOut();
            location.reload();
        });
    }

    sb.auth.getSession().then(({ data }) => {
        if (data.session) {
            onLoggedIn(data.session);
        } else {
            loginView.classList.remove('hidden');
            appView.classList.add('hidden');
        }
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// order_items 的規格資料有兩種來源：新訂單存的是彈性軸 variant_values（JSON，軸名稱不限），
// 舊訂單只有規格/孔徑/顏色 3 個固定欄位。兩種統一整理成 [[軸名, 值], ...]，畫面顯示都共用這個。
function itemVariantEntries(item) {
    const values = item && item.variant_values;
    if (values && typeof values === 'object' && Object.keys(values).length) {
        return Object.entries(values).filter(([, v]) => v);
    }
    return [
        ['規格', item && item.spec],
        ['孔徑', item && item.bore],
        ['顏色', item && item.color],
    ].filter(([, v]) => v);
}

function formatVariantSummary(item) {
    return itemVariantEntries(item).map(([k, v]) => `${k}：${v}`).join('、');
}

// 通用的「按住拖曳排序」輔助函式：用 Pointer Events（不是 HTML5 的 drag-and-drop），
// 滑鼠、觸控都能用。container 底下每個可拖曳項目要有 itemSelector 找得到、dragIdAttr
// 屬性帶識別碼；handleSelector 是拖曳把手（按住那裡才會開始拖，不會跟點擊/打字誤觸）。
// 拖曳中直接把 DOM 節點搬到指標所在的位置（用 elementFromPoint 找目前指標下方是哪個項目，
// 用它的中線判斷要插在前面還是後面），底層資料陣列不會馬上變，放開滑鼠/手指時才呼叫
// onReorder(newOrderOfDragIds) 一次性同步，呼叫方自己去重新排底層陣列。
// 只在 container 綁一次事件（事件代理），renderXxx() 重畫子節點內容不用重新呼叫這個函式。
function enableDragReorder(container, { itemSelector, handleSelector, dragIdAttr = 'data-drag-id', onReorder }) {
    container.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest(handleSelector);
        if (!handle || !container.contains(handle)) return;
        const item = handle.closest(itemSelector);
        if (!item || !container.contains(item)) return;

        e.preventDefault();
        const pointerId = e.pointerId;
        item.setPointerCapture(pointerId);
        item.classList.add('drag-item-active');

        const onMove = (ev) => {
            // 不用 document.elementFromPoint 找指標下方是哪個項目：卡片內容常常有圖片、按鈕等
            // 子元素，命中測試到的可能是某個子元素而不是整張卡片，還要另外處理。直接比對
            // container 底下每個「其他項目」目前的版面位置（getBoundingClientRect）跟指標 Y
            // 座標，看指標落在哪個項目的範圍內，判斷比較直接可靠。
            const others = [...container.querySelectorAll(itemSelector)].filter(el => el !== item);
            const overItem = others.find(el => {
                const rect = el.getBoundingClientRect();
                return ev.clientY >= rect.top && ev.clientY <= rect.bottom;
            });
            if (!overItem) return;
            const rect = overItem.getBoundingClientRect();
            const before = ev.clientY < rect.top + rect.height / 2;
            container.insertBefore(item, before ? overItem : overItem.nextSibling);
        };

        const onUp = () => {
            item.releasePointerCapture(pointerId);
            item.classList.remove('drag-item-active');
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointercancel', onUp);
            const order = [...container.querySelectorAll(itemSelector)].map(el => el.getAttribute(dragIdAttr));
            onReorder(order);
        };

        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointercancel', onUp);
    });
}

// 一項商品一行：小圖（可以點開看大圖，要搭配 openImageZoom 一起用）＋ 商品名稱（含規格）
// ---數量，跟合併 PDF 出貨清單同一套排版邏輯（pdf.js 的 runSheetItemLineHtml）；有備註的話
// 另外提醒色顯示一行。查詢訂單、區域表單的訂單卡片共用。
function orderItemLineHtml(item) {
    const variant = formatVariantSummary(item);
    const name = item.product_name_zh || item.product_erp_code || '';
    const qtyText = `--${item.quantity}${item.unit || ''}`;
    const thumbUrl = item.product_image_url || '';
    const thumbHtml = thumbUrl
        ? `<button type="button" class="order-item-thumb-btn shrink-0" data-url="${escapeHtml(thumbUrl)}" title="點一下看大圖">
               <img src="${escapeHtml(thumbUrl)}" alt="" class="product-thumb" style="width:40px;height:40px;">
           </button>`
        : `<div class="product-thumb shrink-0" style="width:40px;height:40px;"></div>`;
    return `
        <div class="flex items-center gap-2 py-1">
            ${thumbHtml}
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-gray-800" style="display:flow-root;">
                    ${escapeHtml(name)}<span class="font-normal text-gray-700" style="float:right;white-space:nowrap;">${escapeHtml(qtyText)}</span>
                </p>
                ${variant ? `<p class="text-xs text-gray-500">（${escapeHtml(variant)}）</p>` : ''}
                ${item.note ? `<p class="text-xs text-amber-700">備註：${escapeHtml(item.note)}</p>` : ''}
            </div>
        </div>`;
}

// 訂單卡片點圖片放大都是同一個 class，統一在這裡綁一次事件代理，查詢訂單、區域表單
// 重畫卡片清單之後都呼叫這個，不用各自重複寫同樣的 querySelectorAll+addEventListener。
function wireOrderItemThumbZoom(scopeEl) {
    scopeEl.querySelectorAll('.order-item-thumb-btn').forEach(btn => {
        btn.addEventListener('click', () => openImageZoom(btn.dataset.url));
    });
}

// 通用的「點小圖看大圖」燈箱：背景全螢幕半透明黑，中間放大圖，點背景或按右上角的關閉鈕
// 都能收掉。沒有網址（商品沒有圖片）就不用開。
function openImageZoom(url) {
    if (!url) return;
    const overlay = document.createElement('div');
    overlay.className = 'image-zoom-overlay';
    overlay.innerHTML = `
        <img src="${escapeHtml(url)}" alt="">
        <button type="button" class="image-zoom-close-btn" title="關閉" aria-label="關閉">✕</button>`;
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.image-zoom-close-btn').addEventListener('click', close);
}

// Supabase/PostgREST 一次查詢預設最多只會回傳 1000 筆，資料量大的表格（例如累積很多商品規格的
// pos_item_variants）只查一次可能會漏掉後面的資料，新增的東西剛好排在後面就會「看起來沒存到」。
// buildQuery 是一個回傳全新查詢的函式（例如 () => sb.from('x').select('*').order(...)），
// 用 .range() 一頁一頁抓，直到抓不滿一整頁為止，確保整張表都抓齊。
async function fetchAllRows(buildQuery) {
    const pageSize = 1000;
    let allRows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
        if (error) return { data: allRows, error };
        allRows = allRows.concat(data || []);
        if (!data || data.length < pageSize) break;
        offset += pageSize;
    }
    return { data: allRows, error: null };
}

// 民國年/月/日轉西元 'YYYY-MM-DD'，任一欄空白或不是數字就回傳 null。
function minguoFieldsToIsoDate(yyyId, mmId, ddId) {
    const yyy = Number(document.getElementById(yyyId).value);
    const mm  = Number(document.getElementById(mmId).value);
    const dd  = Number(document.getElementById(ddId).value);
    if (!yyy || !mm || !dd) return null;
    const gregorianYear = yyy + 1911;
    return `${gregorianYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function fillTodayAsMinguo(yyyId, mmId, ddId) {
    const today = new Date();
    document.getElementById(yyyId).value = today.getFullYear() - 1911;
    document.getElementById(mmId).value = today.getMonth() + 1;
    document.getElementById(ddId).value = today.getDate();
}

// 通用的民國年月曆選擇器：按鈕一按跳出月曆（月份切換＋回到今天，allowClear 的話還多一個
// 「清除」），選到的日期存進西元 'YYYY-MM-DD' 格式的隱藏欄位，按鈕本身顯示民國年格式
// （YYY/MM/DD）。POS 下單的訂單日期、合併區域表單／統計查詢區間的起訖日期都是用這個。
// 需要有三個對應的 DOM 元素：#{idPrefix}-display-btn（按鈕）、#{idPrefix}-calendar
// （月曆彈出框，預設 class="hidden"）、#{idPrefix}-input（type="hidden"）。
function initRocDatePicker(idPrefix, { initialIso = null, allowClear = false, placeholder = '尚未選擇', onChange } = {}) {
    const displayBtn = document.getElementById(`${idPrefix}-display-btn`);
    const calendar = document.getElementById(`${idPrefix}-calendar`);
    const inputEl = document.getElementById(`${idPrefix}-input`);
    let viewDate = new Date();

    function isoOf(y, m, d) {
        return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    function setDate(isoDate, { silent } = {}) {
        inputEl.value = isoDate || '';
        displayBtn.textContent = isoDate ? isoDateToRocLabel(isoDate) : placeholder;
        if (!silent && onChange) onChange(isoDate);
    }

    function render() {
        const viewYear = viewDate.getFullYear();
        const viewMonth = viewDate.getMonth();
        const selectedIso = inputEl.value;

        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

        let cellsHtml = '';
        for (let i = 0; i < firstWeekday; i++) cellsHtml += '<div></div>';
        for (let day = 1; day <= daysInMonth; day++) {
            const iso = isoOf(viewYear, viewMonth, day);
            const isSelected = iso === selectedIso;
            cellsHtml += `<button type="button" class="roc-date-day-btn text-center text-sm py-1 rounded ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}" data-iso="${iso}">${day}</button>`;
        }

        calendar.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <button type="button" class="roc-date-prev-month px-2 py-1 text-sm rounded hover:bg-gray-100">‹</button>
                <span class="text-sm font-bold">民國${viewYear - 1911}年${String(viewMonth + 1).padStart(2, '0')}月</span>
                <button type="button" class="roc-date-next-month px-2 py-1 text-sm rounded hover:bg-gray-100">›</button>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
                ${weekdayLabels.map(w => `<div>${w}</div>`).join('')}
            </div>
            <div class="grid grid-cols-7 gap-1">${cellsHtml}</div>
            <div class="flex items-center justify-between mt-2">
                ${allowClear ? '<button type="button" class="roc-date-clear-btn text-xs text-gray-500 hover:underline">清除</button>' : '<span></span>'}
                <button type="button" class="roc-date-today-btn text-xs text-blue-600 hover:underline">回到今天</button>
            </div>`;

        calendar.querySelector('.roc-date-prev-month').addEventListener('click', () => {
            viewDate = new Date(viewYear, viewMonth - 1, 1);
            render();
        });
        calendar.querySelector('.roc-date-next-month').addEventListener('click', () => {
            viewDate = new Date(viewYear, viewMonth + 1, 1);
            render();
        });
        calendar.querySelector('.roc-date-today-btn').addEventListener('click', () => {
            const today = new Date();
            viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
            setDate(isoOf(today.getFullYear(), today.getMonth(), today.getDate()));
            render();
        });
        const clearBtn = calendar.querySelector('.roc-date-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                setDate(null);
                calendar.classList.add('hidden');
            });
        }
        calendar.querySelectorAll('.roc-date-day-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setDate(btn.dataset.iso);
                calendar.classList.add('hidden');
            });
        });
    }

    displayBtn.addEventListener('click', () => {
        if (calendar.classList.contains('hidden')) {
            // 每次打開都跳回目前選到的日期所在月份，比較直覺；還沒選日期就跳回今天所在月份。
            const iso = inputEl.value;
            if (iso) {
                const [y, m] = iso.split('-').map(Number);
                viewDate = new Date(y, m - 1, 1);
            } else {
                viewDate = new Date();
            }
            render();
            calendar.classList.remove('hidden');
        } else {
            calendar.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!calendar.contains(e.target) && e.target !== displayBtn) {
            calendar.classList.add('hidden');
        }
    });

    if (initialIso) {
        const [y, m] = initialIso.split('-').map(Number);
        viewDate = new Date(y, m - 1, 1);
    }
    setDate(initialIso, { silent: true });

    return {
        setDate: (iso) => setDate(iso, { silent: true }),
        getIso: () => inputEl.value || null,
    };
}

// 讓「重新整理」之後，網頁捲動位置盡量停在原本的地方。瀏覽器內建的捲動還原
// 常常來不及等非同步資料（商品、訂單…）載入完、畫面還很短的時候就先還原了，
// 等資料進來、頁面變高之後，位置就對不上了。改用 sessionStorage 自己記住捲動
// 位置，資料真正渲染完之後再手動捲過去；每個頁面用自己的 pageKey 分開記錄。
function initScrollRestoration(pageKey) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const storageKey = 'scrollPos:' + pageKey;

    const saved = Number(sessionStorage.getItem(storageKey) || 0);
    if (saved) {
        setTimeout(() => window.scrollTo(0, saved), 400);
    }

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            sessionStorage.setItem(storageKey, String(window.scrollY));
            ticking = false;
        });
    });
}

// 比例數字盡量顯示乾淨：整數就不要小數點，小數最多留 4 位、去掉多餘的尾端 0。
function formatRatioNumber(n) {
    if (!Number.isFinite(n)) return '';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 10000) / 10000);
}

// 西元 'YYYY-MM-DD' 轉成「YYY/MM/DD」（民國年）顯示用文字。
function isoDateToRocLabel(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return '';
    return `${y - 1911}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

// timestamptz（例如 orders.created_at）轉成「YYY/MM/DD HH:MM」（民國年＋時分），
// 用來顯示「建立日期」這種需要看得出確切存檔時間、不只是日期的欄位。
// includeSeconds 給修改紀錄這種需要精確到秒的地方用（同一分鐘內改好幾次要分得出先後）。
function isoDateTimeToRocLabel(isoDateTime, includeSeconds) {
    if (!isoDateTime) return '';
    const d = new Date(isoDateTime);
    if (Number.isNaN(d.getTime())) return '';
    const dateLabel = isoDateToRocLabel(d.toLocaleDateString('en-CA'));
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (!includeSeconds) return `${dateLabel} ${hh}:${mm}`;
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dateLabel} ${hh}:${mm}:${ss}`;
}

// Cloud name 和 unsigned upload preset 都不是密鑰，可以放在前端程式碼裡；
// 真正的 API Secret 絕對不能出現在這裡（那個要保密，用在伺服器端）。
const CLOUDINARY_CLOUD_NAME = 'dhnctvjs8';
const CLOUDINARY_UPLOAD_PRESET = 'POS items';

async function uploadImageToCloudinary(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error('Cloudinary 上傳失敗：' + errText);
    }
    const data = await res.json();
    return data.secure_url;
}

/* ===== 修改紀錄／一鍵還原 =====
   訂單（查詢訂單／合併區域表單）、客戶（客戶資訊）、商品（修改 POS 商品）共用同一套
   「修改紀錄」小視窗跟還原邏輯，資料來源是 record_history 這張表（資料庫層級的觸發器
   自動記錄，不管從哪個頁面改的都不會漏）。每個頁面只要呼叫 openHistoryModal(table,
   recordId, label, onRestored) 就好；視窗本身第一次用到才動態建立、插進
   document.body，不用每個頁面各自準備一份 HTML。 */

function ensureHistoryModal() {
    if (document.getElementById('history-modal')) return;
    const div = document.createElement('div');
    div.id = 'history-modal';
    div.className = 'fixed inset-0 bg-black/40 hidden items-start justify-center z-50 p-4 overflow-y-auto';
    div.innerHTML = `
        <div class="bg-white rounded-lg shadow-lg w-full max-w-lg my-8">
            <div class="px-6 py-4 border-b flex justify-between items-center gap-3">
                <h2 id="history-modal-title" class="font-bold text-lg truncate">修改紀錄</h2>
                <button type="button" id="history-modal-close-btn" class="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>
            <div id="history-modal-body" class="px-6 py-4 max-h-[60vh] overflow-y-auto"></div>
        </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', (e) => { if (e.target === div) closeHistoryModal(); });
    div.querySelector('#history-modal-close-btn').addEventListener('click', closeHistoryModal);
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

// 修改紀錄／已刪除項目共用：把某個欄位名稱換成看得懂的中文標籤，沒對應到的就直接顯示
// 原本的欄位名稱（例如之後表格加了新欄位，這裡不用跟著改也看得懂大概是什麼）。
const HISTORY_FIELD_LABELS = {
    name: '名稱', site_name: '工地', region: '區域', address: '地址', contact_person: '聯絡人', phone: '電話',
    category_name_zh: '分類（中文）', category_name_en: '分類（英文）', erp_code: 'ERP 貨號', catalog_code: '型錄貨號',
    name_zh: '中文品名', name_en: '英文品名', order_display_name: '下單名稱', keywords: '關鍵字', image_url: '圖片網址',
    desc_zh: '中文說明', desc_en: '英文說明', is_active: '上架狀態', added_from_pos: '來自 POS 下單待補齊',
    order_date: '訂單日期', order_no: '訂單編號', pickup_tag: '取貨標籤', note: '備註', customer_id: '客戶',
};

// 把一份快照整理成看得懂的欄位清單（不含 id/created_at 這種內部欄位、也不顯示空值），
// orders 快照多帶的 __order_items 另外整理成商品明細列表。用來讓使用者在按「還原」之前，
// 先看得到那一版實際的內容長怎樣，不用盲目還原。
// resolvers：{ 欄位名: async (值) => 顯示文字 }，給 customer_id 這種存 uuid、單看數字看不懂
// 是誰的欄位用，呼叫端（各頁面自己知道要怎麼查）決定要不要提供、怎麼查。
async function historySnapshotDetailHtml(snapshot, resolvers) {
    const RESERVED = new Set(['id', 'created_at', '__order_items']);
    const entries = Object.entries(snapshot).filter(([k, v]) => {
        if (RESERVED.has(k)) return false;
        if (v === null || v === undefined || v === '') return false;
        if (Array.isArray(v) && !v.length) return false;
        if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return false;
        return true;
    });

    const fieldsHtmlParts = await Promise.all(entries.map(async ([k, v]) => {
        const label = HISTORY_FIELD_LABELS[k] || k;
        let display;
        if (resolvers && resolvers[k]) {
            display = await resolvers[k](v);
        } else if (typeof v === 'boolean') {
            display = v ? '是' : '否';
        } else if (typeof v === 'object') {
            display = JSON.stringify(v);
        } else {
            display = String(v);
        }
        return `<p class="text-xs text-gray-600"><span class="text-gray-400">${escapeHtml(label)}：</span>${escapeHtml(display)}</p>`;
    }));
    const fieldsHtml = fieldsHtmlParts.length ? fieldsHtmlParts.join('') : '<p class="text-xs text-gray-400">（沒有其他欄位）</p>';

    const itemsHtml = (snapshot.__order_items && snapshot.__order_items.length)
        ? `<div class="mt-2 pt-2 border-t border-gray-200">
            <p class="text-xs text-gray-400 mb-1">商品明細：</p>
            ${snapshot.__order_items.map(it => `<p class="text-xs text-gray-600">${escapeHtml(it.product_name_zh || it.product_erp_code || '')}　${escapeHtml(String(it.quantity ?? ''))}${escapeHtml(it.unit || '')}</p>`).join('')}
        </div>`
        : '';

    return `<div class="bg-gray-50 rounded p-2 mt-2">${fieldsHtml}${itemsHtml}</div>`;
}

// table：record_history.table_name（'orders'／'customers'／'pos_items'）；
// recordId：那一列的 id；label：視窗標題後面附註的識別文字（例如訂單編號、客戶名稱）；
// onRestored：還原成功後要呼叫的回呼（通常是重新整理畫面上的資料）；
// resolvers：見 historySnapshotDetailHtml 的說明。
async function openHistoryModal(table, recordId, label, onRestored, resolvers) {
    ensureHistoryModal();
    const modal = document.getElementById('history-modal');
    document.getElementById('history-modal-title').textContent = `修改紀錄${label ? '－' + label : ''}`;
    const body = document.getElementById('history-modal-body');
    body.innerHTML = '<p class="text-sm text-gray-400">載入中…</p>';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const { data, error } = await sb.from('record_history')
        .select('*')
        .eq('table_name', table)
        .eq('record_id', String(recordId))
        .order('changed_at', { ascending: false });

    if (error) {
        body.innerHTML = `<p class="text-sm text-red-600">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }
    if (!data || !data.length) {
        body.innerHTML = '<p class="text-sm text-gray-400">目前沒有修改紀錄。</p>';
        return;
    }

    body.innerHTML = data.map((h, i) => `
        <div class="py-3${i > 0 ? ' border-t' : ''}">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <p class="text-sm font-medium">${escapeHtml(isoDateTimeToRocLabel(h.changed_at, true))}</p>
                    <button type="button" class="history-view-btn text-xs text-blue-600 hover:underline" data-idx="${i}">
                        ${h.changed_by ? escapeHtml(h.changed_by) + '　' : ''}${h.operation === 'delete' ? '刪除前的內容' : '修改前的內容'}（點看內容）
                    </button>
                </div>
                <button type="button" class="history-restore-btn px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100" data-idx="${i}">還原到這一版</button>
            </div>
            <div class="history-detail hidden" data-idx="${i}"></div>
        </div>`).join('');

    body.querySelectorAll('.history-view-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = btn.dataset.idx;
            const detail = body.querySelector(`.history-detail[data-idx="${idx}"]`);
            if (detail.classList.contains('hidden')) {
                detail.classList.remove('hidden');
                detail.innerHTML = '<p class="text-xs text-gray-400 mt-2">載入中…</p>';
                detail.innerHTML = await historySnapshotDetailHtml(data[Number(idx)].snapshot, resolvers);
            } else {
                detail.classList.add('hidden');
            }
        });
    });

    body.querySelectorAll('.history-restore-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const entry = data[Number(btn.dataset.idx)];
            if (!confirm('確定要還原到這一版嗎？目前的內容會被覆蓋（覆蓋前的內容一樣會被記錄下來，還原後如果後悔還是可以再還原回來）。')) return;
            btn.disabled = true;
            btn.textContent = '還原中…';
            try {
                await restoreHistorySnapshot(table, recordId, entry.snapshot, entry.operation);
                closeHistoryModal();
                if (onRestored) await onRestored();
                alert('已還原。');
            } catch (e) {
                alert('還原失敗：' + e.message);
                btn.disabled = false;
                btn.textContent = '還原到這一版';
            }
        });
    });
}

// orders 的快照多包了一份 __order_items 子陣列（見 record-history-migration.sql 的
// record_orders_history()），還原時要把訂單欄位跟商品明細分開處理；customers／pos_items
// 單純把快照裡的欄位（扣掉 id/created_at 這種不該覆蓋回去的欄位）整包還原回去，不用特地
// 列出欄位清單，之後這些表加新欄位也不用回來改這裡。
// operation 是那筆歷史紀錄本身的操作類型：'delete' 代表那時候整筆被刪掉了，現在資料庫裡
// 已經沒有這筆資料，還原要用 insert（連 id 一起放回去，維持原本的識別碼）；'update' 代表
// 資料還在，只是欄位被改過，還原用 update 蓋回去就好。
async function restoreHistorySnapshot(table, recordId, snapshot, operation) {
    const isRecreate = operation === 'delete';

    if (table === 'orders') {
        const { __order_items, created_at, ...fields } = snapshot;
        const { error } = isRecreate
            ? await sb.from('orders').insert({ ...fields, id: recordId })
            : await sb.from('orders').update(fields).eq('id', recordId);
        if (error) throw error;

        const { error: delErr } = await sb.from('order_items').delete().eq('order_id', recordId);
        if (delErr) throw delErr;

        if (__order_items && __order_items.length) {
            const itemsPayload = __order_items.map(({ id: _id, order_id: _orderId, ...itemFields }) => ({
                ...itemFields,
                order_id: recordId,
            }));
            const { error: insErr } = await sb.from('order_items').insert(itemsPayload);
            if (insErr) throw insErr;
        }
    } else {
        const { created_at, ...fields } = snapshot;
        const { error } = isRecreate
            ? await sb.from(table).insert({ ...fields, id: recordId })
            : await sb.from(table).update(fields).eq('id', recordId);
        if (error) throw error;
    }
}

// 「已刪除的項目」瀏覽／還原：已刪除的資料在畫面上本來就看不到（不像修改，還在原本的
// 列表裡可以點「修改紀錄」），所以要另外從 record_history 反查——找出「最後一次操作是
// delete」的那些 record_id，再排除掉「後來又被還原/重建過，現在活著」的，剩下的才是
// 真的已刪除、可以還原的項目。
// labelFn(snapshot)：每個項目要顯示的識別文字，各表想顯示的欄位不一樣，由呼叫端決定；
// resolvers：見 historySnapshotDetailHtml 的說明。
async function openDeletedItemsModal(table, labelFn, onRestored, resolvers) {
    ensureHistoryModal();
    const modal = document.getElementById('history-modal');
    document.getElementById('history-modal-title').textContent = '已刪除的項目';
    const body = document.getElementById('history-modal-body');
    body.innerHTML = '<p class="text-sm text-gray-400">載入中…</p>';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const { data: historyRows, error } = await sb.from('record_history')
        .select('*')
        .eq('table_name', table)
        .eq('operation', 'delete')
        .order('changed_at', { ascending: false });
    if (error) {
        body.innerHTML = `<p class="text-sm text-red-600">讀取失敗：${escapeHtml(error.message)}</p>`;
        return;
    }

    // record_history 是照時間新到舊排的，同一個 record_id 第一次遇到就是最新一次刪除紀錄。
    const latestByRecord = new Map();
    (historyRows || []).forEach(h => { if (!latestByRecord.has(h.record_id)) latestByRecord.set(h.record_id, h); });
    const candidates = [...latestByRecord.values()];
    if (!candidates.length) {
        body.innerHTML = '<p class="text-sm text-gray-400">目前沒有已刪除的項目。</p>';
        return;
    }

    const ids = candidates.map(c => c.record_id);
    const { data: liveRows, error: liveErr } = await sb.from(table).select('id').in('id', ids);
    if (liveErr) {
        body.innerHTML = `<p class="text-sm text-red-600">讀取失敗：${escapeHtml(liveErr.message)}</p>`;
        return;
    }
    const liveIds = new Set((liveRows || []).map(r => String(r.id)));
    const deleted = candidates.filter(c => !liveIds.has(String(c.record_id)));

    if (!deleted.length) {
        body.innerHTML = '<p class="text-sm text-gray-400">目前沒有已刪除的項目。</p>';
        return;
    }

    body.innerHTML = deleted.map((h, i) => `
        <div class="py-3${i > 0 ? ' border-t' : ''}">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <p class="text-sm font-medium">${escapeHtml(labelFn(h.snapshot))}</p>
                    <button type="button" class="history-view-btn text-xs text-blue-600 hover:underline" data-idx="${i}">
                        ${escapeHtml(isoDateTimeToRocLabel(h.changed_at, true))}${h.changed_by ? '　' + escapeHtml(h.changed_by) : ''} 刪除（點看內容）
                    </button>
                </div>
                <button type="button" class="deleted-restore-btn px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-100" data-idx="${i}">還原</button>
            </div>
            <div class="history-detail hidden" data-idx="${i}"></div>
        </div>`).join('');

    body.querySelectorAll('.history-view-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = btn.dataset.idx;
            const detail = body.querySelector(`.history-detail[data-idx="${idx}"]`);
            if (detail.classList.contains('hidden')) {
                detail.classList.remove('hidden');
                detail.innerHTML = '<p class="text-xs text-gray-400 mt-2">載入中…</p>';
                detail.innerHTML = await historySnapshotDetailHtml(deleted[Number(idx)].snapshot, resolvers);
            } else {
                detail.classList.add('hidden');
            }
        });
    });

    body.querySelectorAll('.deleted-restore-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const entry = deleted[Number(btn.dataset.idx)];
            if (!confirm('確定要還原這筆資料嗎？')) return;
            btn.disabled = true;
            btn.textContent = '還原中…';
            try {
                await restoreHistorySnapshot(table, entry.record_id, entry.snapshot, 'delete');
                closeHistoryModal();
                if (onRestored) await onRestored();
                alert('已還原。');
            } catch (e) {
                alert('還原失敗：' + e.message);
                btn.disabled = false;
                btn.textContent = '還原';
            }
        });
    });
}
