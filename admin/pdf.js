// jsPDF 的內建字型不含中文字，直接用 doc.text() 印中文會變亂碼。
// 改成先把訂購單排成一般 HTML（瀏覽器本身的字型就能正常顯示中文），
// 用 html2canvas 把它畫成圖片，再把圖片切成一頁一頁塞進 PDF。

function waitForImages(container) {
    const imgs = [...container.querySelectorAll('img')];
    return Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));
}

function buildInvoiceHtml(order, customer, items) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;'
        + 'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111;box-sizing:border-box;';

    const dateStr = order.created_at
        ? new Date(order.created_at).toLocaleDateString('zh-TW')
        : new Date().toLocaleDateString('zh-TW');

    const itemsHtml = items.map(item => {
        const variant = [
            item.spec  ? '規格：' + item.spec  : '',
            item.bore  ? '孔徑：' + item.bore  : '',
            item.color ? '顏色：' + item.color : '',
        ].filter(Boolean).join('　');
        const imgSrc = item.product_image_url
            ? ('/api/image-proxy?url=' + encodeURIComponent(item.product_image_url))
            : '';

        return `
            <tr>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;width:70px;">
                    ${imgSrc
                        ? `<img src="${imgSrc}" crossorigin="anonymous" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #e5e7eb;">`
                        : `<div style="width:60px;height:60px;background:#f3f4f6;border-radius:4px;"></div>`}
                </td>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
                    <div style="font-weight:700;font-size:14px;">${escapeHtml(item.product_name_zh || item.product_erp_code || '')}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(item.product_erp_code || '')}</div>
                    ${variant ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(variant)}</div>` : ''}
                </td>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;white-space:nowrap;vertical-align:top;">
                    數量：${escapeHtml(String(item.quantity))}
                </td>
            </tr>`;
    }).join('');

    const siteLine = customer && customer.site_name
        ? `<div>工地：${escapeHtml(customer.site_name)}</div>` : '';
    const regionLine = customer && customer.region
        ? `<div>區域：${escapeHtml(customer.region)}</div>` : '';

    container.innerHTML = `
        <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;">錦輝塑膠業有限公司 訂購單</h1>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#374151;margin-bottom:16px;">
            <span>訂單編號：${escapeHtml(order.order_no || '')}</span>
            <span>日期：${dateStr}</span>
        </div>
        <hr style="border:none;border-top:1px solid #d1d5db;margin:12px 0;">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 8px;">客戶資訊</h2>
        <div style="font-size:13px;line-height:1.8;color:#374151;">
            <div>名稱：${escapeHtml(customer && customer.name || '')}</div>
            <div>電話：${escapeHtml(customer && customer.phone || '')}</div>
            <div>地址：${escapeHtml(customer && customer.address || '')}</div>
            ${siteLine}
            ${regionLine}
        </div>
        <hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 8px;">商品明細</h2>
        <table style="width:100%;border-collapse:collapse;">
            <tbody>${itemsHtml}</tbody>
        </table>
    `;
    return container;
}

// 把一個畫好的 HTML 容器（container 本身要先 append 到 document.body 以外）畫成圖片、
// 切頁後畫進傳入的 jsPDF doc。isFirstPage：一份新建的 jsPDF 文件本身就自帶一張空白頁，
// 只有整份 PDF 的第一個內容區塊的第一頁要沿用它，其餘都要先 addPage()。
async function renderHtmlPagesInto(doc, container, isFirstPage) {
    document.body.appendChild(container);

    try {
        await waitForImages(container);

        const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });

        const pdfWidthMm = doc.internal.pageSize.getWidth();
        const pdfHeightMm = doc.internal.pageSize.getHeight();
        const pxPerMm = canvas.width / pdfWidthMm;
        const pageHeightPx = Math.floor(pdfHeightMm * pxPerMm);

        let offsetY = 0;
        let isFirstSlice = true;
        while (offsetY < canvas.height) {
            const sliceHeight = Math.min(pageHeightPx, canvas.height - offsetY);
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sliceHeight;
            pageCanvas.getContext('2d').drawImage(
                canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight
            );

            if (!(isFirstPage && isFirstSlice)) doc.addPage();
            doc.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfWidthMm, sliceHeight / pxPerMm);
            isFirstSlice = false;
            offsetY += sliceHeight;
        }
    } finally {
        document.body.removeChild(container);
    }
}

async function renderOrderPagesInto(doc, order, customer, items, isFirstOrderPage) {
    await renderHtmlPagesInto(doc, buildInvoiceHtml(order, customer, items), isFirstOrderPage);
}

async function generateOrderPdf(order, customer, items) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await renderOrderPagesInto(doc, order, customer, items, true);
    doc.save((order.order_no || 'order') + '.pdf');
}

/* --- 區域表單「產生合併 PDF」：出貨清單格式，直式 A4 分 3 欄，欄與欄之間不用對齊，
   每筆訂單（客戶＋工地／電話／商品圖片＋名稱＋規格／數量）印完才分隔線換下一筆。
   用「目前欄的高度是否已經到平均值」來決定何時換下一欄，讓 3 欄高度大致平均，
   而不是照筆數硬性平分（一筆商品越多，佔的高度自然越多）。 --- */

// 粗略估計一筆訂單印出來大概要佔多少高度（單位跟 CSS px 差不多，只用來比較欄與欄之間的相對高度，不用很精準）。
function estimateRunSheetEntryHeight(entry) {
    const items = entry.items || [];
    const itemCount = Math.max(items.length, 1);
    return 50 /* 客戶/工地 + 電話 兩行 */ + itemCount * 44 /* 每個品項：圖片+名稱+規格 一行、數量一行 */ + 16 /* 分隔線 */;
}

// 每一欄用「剩下的訂單／剩下的欄數」動態算目標高度（不是一開始就把總高度硬性除以 3），
// 這樣不管訂單筆數多少、每筆大小差多少，前面的欄位分配比較不會被單一筆特別大的訂單打亂，
// 後面幾欄還是能拿到接近平均的份量。每一欄至少會有一筆，不會有欄位是空的（除非訂單總數比欄數少）。
function distributeEntriesIntoColumns(entries, columnCount) {
    const heights = entries.map(estimateRunSheetEntryHeight);
    const columns = Array.from({ length: columnCount }, () => []);

    let idx = 0;
    for (let col = 0; col < columnCount && idx < entries.length; col++) {
        const remainingCols = columnCount - col;
        const remainingHeight = heights.slice(idx).reduce((a, b) => a + b, 0);
        const target = remainingHeight / remainingCols;

        let colHeight = 0;
        while (idx < entries.length) {
            if (col < columnCount - 1 && colHeight > 0 && colHeight >= target) break;
            columns[col].push(entries[idx]);
            colHeight += heights[idx];
            idx++;
        }
    }
    return columns;
}

function runSheetEntryHtml(entry) {
    const c = entry.customer || {};
    const items = entry.items || [];
    const nameLine = [c.name, c.site_name].filter(Boolean).join('-');

    const itemsHtml = items.map(item => {
        const variant = [item.spec, item.bore, item.color].filter(Boolean).join('/');
        const imgSrc = item.product_image_url
            ? ('/api/image-proxy?url=' + encodeURIComponent(item.product_image_url))
            : '';
        return `
            <div style="display:flex;align-items:center;gap:5px;margin-top:4px;font-weight:700;">
                ${imgSrc
                    ? `<img src="${imgSrc}" crossorigin="anonymous" style="width:24px;height:24px;object-fit:cover;border-radius:3px;flex-shrink:0;">`
                    : `<div style="width:24px;height:24px;background:#f3f4f6;border-radius:3px;flex-shrink:0;"></div>`}
                <div style="flex:1;min-width:0;overflow-wrap:break-word;">${escapeHtml(item.product_name_zh || item.product_erp_code || '')}${variant ? '　' + escapeHtml(variant) : ''}</div>
            </div>
            <div style="padding-left:29px;font-weight:700;">數量：${escapeHtml(String(item.quantity))}</div>`;
    }).join('');

    return `
        <div style="margin-bottom:10px;font-weight:700;">
            <div>${escapeHtml(nameLine || '（未知客戶）')}</div>
            <div>${escapeHtml(c.phone || '')}</div>
            ${itemsHtml}
            <div style="border-top:2px dashed #6b7280;margin-top:7px;"></div>
        </div>`;
}

function buildRunSheetHtml(entries, title) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:28px;'
        + 'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111;box-sizing:border-box;'
        + 'font-size:14px;font-weight:700;line-height:1.5;';

    const columns = distributeEntriesIntoColumns(entries, 3);
    const columnsHtml = columns.map(col => `
        <div style="flex:1;min-width:0;">${col.map(runSheetEntryHtml).join('')}</div>
    `).join('');

    container.innerHTML = `
        ${title ? `<h1 style="font-size:22px;font-weight:700;margin:0 0 12px;">${escapeHtml(title)}</h1>` : ''}
        <div style="display:flex;gap:14px;align-items:flex-start;">${columnsHtml}</div>
    `;
    return container;
}

// entries: [{ order, customer, items }, ...] —— 全部訂單排成一份出貨清單，合併成同一份 PDF。
async function generateCombinedOrdersPdf(entries, filename, title) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await renderHtmlPagesInto(doc, buildRunSheetHtml(entries, title), true);
    doc.save(filename);
}
