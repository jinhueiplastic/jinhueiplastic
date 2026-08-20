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
        const variant = formatVariantSummary(item);
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
                    ${item.note ? `<div style="font-size:12px;color:#b45309;margin-top:2px;">備註：${escapeHtml(item.note)}</div>` : ''}
                </td>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;white-space:nowrap;vertical-align:top;">
                    數量：${escapeHtml(String(item.quantity))}${item.unit ? escapeHtml(item.unit) : ''}
                </td>
            </tr>`;
    }).join('');

    const siteLine = customer && customer.site_name
        ? `<div>工地：${escapeHtml(customer.site_name)}</div>` : '';
    const regionLine = customer && customer.region
        ? `<div>區域：${escapeHtml(customer.region)}</div>` : '';
    const contactLine = customer && customer.contact_person
        ? `<div>聯絡人：${escapeHtml(customer.contact_person)}</div>` : '';

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
            ${contactLine}
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

// A4 一頁在這個排版裡的實際可用高度（跟 buildRunSheetHtml 的 794px 容器寬度、28px 內距、
// 標題高度對應），用來當作每一欄真正能裝多少內容的容量，而不是拿總高度硬性除以 3。
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RUN_SHEET_CONTAINER_WIDTH_PX = 794; // 對應 A4_WIDTH_MM
const RUN_SHEET_PADDING_PX = 28; // 上下各一份
const RUN_SHEET_TITLE_HEIGHT_PX = 64;
const RUN_SHEET_COLUMN_GAP_PX = 14;
const RUN_SHEET_COLUMN_COUNT = 3;

function runSheetColumnCapacityPx(hasTitle) {
    const pxPerMm = RUN_SHEET_CONTAINER_WIDTH_PX / A4_WIDTH_MM;
    const pageHeightPx = A4_HEIGHT_MM * pxPerMm;
    return pageHeightPx - RUN_SHEET_PADDING_PX * 2 - (hasTitle ? RUN_SHEET_TITLE_HEIGHT_PX : 0);
}

function runSheetColumnWidthPx(columnCount) {
    const contentWidth = RUN_SHEET_CONTAINER_WIDTH_PX - RUN_SHEET_PADDING_PX * 2;
    return (contentWidth - RUN_SHEET_COLUMN_GAP_PX * (columnCount - 1)) / columnCount;
}

// 每一筆訂單印出來實際佔多高，直接把它畫到跟真正欄位一樣寬的隱藏容器裡量出來，
// 不用去猜字會換幾行——字級、圖片大小以後再調也不用跟著重新估算。
function measureRunSheetEntryHeights(entries, columnCount) {
    const measurer = document.createElement('div');
    measurer.style.cssText = `position:fixed;left:-9999px;top:0;width:${runSheetColumnWidthPx(columnCount)}px;`
        + 'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111;box-sizing:border-box;'
        + 'font-size:17px;font-weight:700;line-height:1.5;';
    document.body.appendChild(measurer);

    const heights = entries.map(entry => {
        measurer.innerHTML = runSheetEntryHtml(entry);
        return measurer.getBoundingClientRect().height;
    });

    document.body.removeChild(measurer);
    return heights;
}

// 由上至下把第一欄「真正填滿」（用一頁實際能放的高度當容量）才換下一欄，不是不管內容多少
// 都硬性分成三等份——訂單筆數少、或者一欄裝得下的話，後面的欄位就會是空的。
// 每一欄（包含最後一欄）都要守容量上限，一頁的三欄都裝滿了還有剩，就换下一頁重新從第一欄開始，
// 不會發生「前兩欄留白、全部塞到最後一欄」讓內容爆版的狀況。
function distributeEntriesIntoPages(entries, heights, columnCount, columnCapacityPx) {
    const pages = [];
    let idx = 0;

    while (idx < entries.length) {
        const page = Array.from({ length: columnCount }, () => []);
        for (let col = 0; col < columnCount && idx < entries.length; col++) {
            let colHeight = 0;
            while (idx < entries.length) {
                const h = heights[idx];
                if (colHeight > 0 && colHeight + h > columnCapacityPx) break;
                page[col].push(entries[idx]);
                colHeight += h;
                idx++;
            }
        }
        pages.push(page);
    }
    return pages;
}

// 商品名稱接數量：數量固定貼右邊，前面的文字正常排、太長會自動換行。名稱本身（product_name_zh）
// 已經含有商品自己設定「顯示在下單名稱」的軸值（例如「4分 CD盒接」），這裡不再另外列出完整規格，
// 不然同一個值會在名稱裡跟規格列表裡各出現一次。
// 關鍵是 float 的 <span> 要放在文字「後面」（不是前面）：CSS float 的規則是浮動元素的
// 頂端不能高於「它前面那些行內內容所在行框的頂端」——文字先照正常寬度排好版（不受 float
// 影響，因為 float 還沒出現），排到第幾行、換到哪裡都跟平常一樣；float 最後才貼到「文字
// 目前排到的那一行」的右邊，那一行剩的空間不夠才會自己換到下一行、一樣靠右對齊。
// 效果：整行塞得下就同一行靠右；文字本身很短不用換行的話，數量就跟在後面同一行；
// 文字本身就需要換到第二行（跟數量無關），數量就接在文字實際排完的最後一行後面，
// 不會為了讓數量擠上去而把商品名稱從中間拆開。
// word-break:keep-all 讓商品名稱本身（含中英文混排，例如「PVC清潔口」）只在字詞之間的空白處
// 換行，不會被硬拆到不自然的地方；display:flow-root 讓這個 div 的高度確實把浮動的數量包住，
// 不然數量比文字還高的話下面會塌陷、蓋到下一筆的分隔線。
function runSheetItemLineHtml(item) {
    const productName = item.product_name_zh || item.product_erp_code || '';
    const qtyText = `--${item.quantity}${item.unit || ''}`;
    return `
        <div style="font-weight:700;font-size:26px;word-break:keep-all;margin-top:10px;display:flow-root;">
            ${escapeHtml(productName)}<span style="float:right;white-space:nowrap;">${escapeHtml(qtyText)}</span>
        </div>
        ${item.note ? `<div style="font-weight:700;font-size:18px;color:#b45309;">${escapeHtml(item.note)}</div>` : ''}`;
}

function runSheetEntryHtml(entry) {
    const c = entry.customer || {};
    const order = entry.order || {};
    const items = entry.items || [];
    const nameLine = [c.name, c.site_name].filter(Boolean).join('-');

    const itemsHtml = items.map(item => runSheetItemLineHtml(item)).join('');

    const phoneLine = `${c.phone || ''}${c.contact_person ? '（' + c.contact_person + '）' : ''}`;

    // 取貨標籤、備註是揀貨/送貨時要注意的事，用同一個顏色跟其他資訊區分開來，讓揀貨的人
    // 一眼就能看到、不會被一長串商品明細洗掉。取貨標籤貼在客戶名稱那行右邊（float 的 <span>
    // 要放在文字後面，理由跟 runSheetItemLineHtml 一樣：讓它貼著名稱目前排到的那一行，
    // 不會把名稱那行的可用寬度縮小）；備註單獨一行，不用再加「備註：」這種標籤文字。
    const pickupTagHtml = order.pickup_tag
        ? `<span style="float:right;white-space:nowrap;color:#b45309;">${escapeHtml(order.pickup_tag)}</span>`
        : '';

    return `
        <div style="margin-bottom:14px;font-weight:700;">
            <div style="display:flow-root;">${escapeHtml(nameLine || '（未知客戶）')}${pickupTagHtml}</div>
            <div>${escapeHtml(phoneLine)}</div>
            ${order.note ? `<div style="color:#b45309;">${escapeHtml(order.note)}</div>` : ''}
            ${itemsHtml}
            <div style="border-top:2px dashed #6b7280;margin-top:10px;"></div>
        </div>`;
}

function buildRunSheetPageHtml(pageColumns, title) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:28px;'
        + 'font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111;box-sizing:border-box;'
        + 'font-size:17px;font-weight:700;line-height:1.5;';

    // 欄與欄之間除了留白，還加一條直線分隔——用第 2、3 欄的左邊框畫線（不是 flex gap），
    // 這樣線會剛好落在留白正中間，也不會影響 runSheetColumnWidthPx() 算出來的欄寬。
    const columnsHtml = pageColumns.map((col, i) => `
        <div style="flex:1;min-width:0;${i > 0 ? `border-left:1px solid #9ca3af;padding-left:${RUN_SHEET_COLUMN_GAP_PX}px;` : ''}">${col.map(runSheetEntryHtml).join('')}</div>
    `).join('');

    container.innerHTML = `
        ${title ? `<h1 style="font-size:30px;font-weight:700;margin:0 0 16px;">${escapeHtml(title)}</h1>` : ''}
        <div style="display:flex;align-items:flex-start;">${columnsHtml}</div>
    `;
    return container;
}

// groups: [{ title, entries }, ...] —— 每組（例如每個區域）各自的標題跟已經排好序的訂單，
// 各自從新的一頁開始排版（不會跟上一組擠在同一頁），組跟組之間合併成同一份 PDF 檔案。
// 沒有訂單的組會自動跳過，不會生出空白頁。
async function generateCombinedOrdersPdfByGroup(groups, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const columnCount = RUN_SHEET_COLUMN_COUNT;

    let isFirstPageOfDoc = true;
    for (const group of groups) {
        if (!group.entries.length) continue;
        const heights = measureRunSheetEntryHeights(group.entries, columnCount);
        const pages = distributeEntriesIntoPages(group.entries, heights, columnCount, runSheetColumnCapacityPx(Boolean(group.title)));
        for (let i = 0; i < pages.length; i++) {
            await renderHtmlPagesInto(doc, buildRunSheetPageHtml(pages[i], group.title), isFirstPageOfDoc);
            isFirstPageOfDoc = false;
        }
    }

    doc.save(filename);
}

// entries: [{ order, customer, items }, ...] —— 全部訂單排成出貨清單，合併成同一份 PDF。
// 一頁的三欄都裝滿的話會自動另開一頁（一樣是三欄），每頁都印標題，不會有某一欄爆版爆到頁面外的狀況。
// 單一區域（不是「全部區域」）的情況用這個，本質上就是只有一組的 generateCombinedOrdersPdfByGroup。
async function generateCombinedOrdersPdf(entries, filename, title) {
    await generateCombinedOrdersPdfByGroup([{ title, entries }], filename);
}
