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
    { key: 'region',    href: '/admin/region-form.html', label: '區域表單' },
    { key: 'customers', href: '/admin/customers.html',   label: '客戶資訊' },
    { key: 'products',  href: '/admin/',                 label: '修改 POS 商品' },
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
