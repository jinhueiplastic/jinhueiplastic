const SUPABASE_URL = 'https://nfpfguorxfhwhkylacoe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcGZndW9yeGZod2hreWxhY29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTE5OTcsImV4cCI6MjA5NjcyNzk5N30.YMrxU9VZoh4ieO9Lqd2qPiXMA4FFPCg1zUa7gG80QDw';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// 每個後台頁面共用：處理登入表單、登出、以及登入成功後導頁面自己的初始化函式（onReady）。
function initAdminAuth(pageKey, onReady) {
    const loginView   = document.getElementById('login-view');
    const appView     = document.getElementById('app-view');
    const loginForm   = document.getElementById('login-form');
    const loginError  = document.getElementById('login-error');
    const userEmailEl = document.getElementById('user-email');
    const logoutBtn   = document.getElementById('logout-btn');

    renderAdminNav(pageKey);

    function onLoggedIn(session) {
        loginView.classList.add('hidden');
        appView.classList.remove('hidden');
        if (userEmailEl) userEmailEl.textContent = session.user.email || '';
        onReady();
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
