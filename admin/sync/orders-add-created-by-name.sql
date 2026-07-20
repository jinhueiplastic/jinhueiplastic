-- 訂單除了記錄建立者的 email，也記錄當時的顯示名稱（帳號自己在後台設定的），
-- 查詢訂單頁優先顯示這個，沒設定過顯示名稱的帳號就還是顯示 email。
alter table orders add column if not exists created_by_name text;
