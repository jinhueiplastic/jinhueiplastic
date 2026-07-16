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
        </div>
        <hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 8px;">商品明細</h2>
        <table style="width:100%;border-collapse:collapse;">
            <tbody>${itemsHtml}</tbody>
        </table>
    `;
    return container;
}

async function generateOrderPdf(order, customer, items) {
    const container = buildInvoiceHtml(order, customer, items);
    document.body.appendChild(container);

    try {
        await waitForImages(container);

        const scale = 2;
        const canvas = await html2canvas(container, { scale, useCORS: true, backgroundColor: '#ffffff' });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pdfWidthMm = doc.internal.pageSize.getWidth();
        const pdfHeightMm = doc.internal.pageSize.getHeight();
        const pxPerMm = canvas.width / pdfWidthMm;
        const pageHeightPx = Math.floor(pdfHeightMm * pxPerMm);

        let offsetY = 0;
        let first = true;
        while (offsetY < canvas.height) {
            const sliceHeight = Math.min(pageHeightPx, canvas.height - offsetY);
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sliceHeight;
            pageCanvas.getContext('2d').drawImage(
                canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight
            );

            if (!first) doc.addPage();
            doc.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfWidthMm, sliceHeight / pxPerMm);
            first = false;
            offsetY += sliceHeight;
        }

        doc.save((order.order_no || 'order') + '.pdf');
    } finally {
        document.body.removeChild(container);
    }
}
