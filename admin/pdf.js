// 把商品圖片透過 /api/image-proxy 抓回來（繞開 CORS），再用 canvas 轉成 PNG data URL 給 jsPDF 用。
async function fetchImageAsPngDataUrl(url) {
    if (!url) return null;
    try {
        const proxied = '/api/image-proxy?url=' + encodeURIComponent(url);
        const res = await fetch(proxied);
        if (!res.ok) return null;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const dataUrl = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);
        return dataUrl;
    } catch (e) {
        console.error('圖片轉換失敗', url, e);
        return null;
    }
}

async function generateOrderPdf(order, customer, items) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 15;
    let y = 18;

    doc.setFontSize(16);
    doc.text('錦輝塑膠業有限公司 訂購單', marginX, y);
    y += 8;
    doc.setFontSize(10);
    doc.text('訂單編號：' + (order.order_no || ''), marginX, y);
    doc.text('日期：' + new Date(order.created_at).toLocaleDateString('zh-TW'), pageWidth - marginX - 45, y);
    y += 7;

    doc.setDrawColor(200);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;

    doc.setFontSize(11);
    doc.text('客戶資訊', marginX, y);
    y += 6;
    doc.setFontSize(10);
    doc.text('名稱：' + (customer && customer.name || ''), marginX, y);
    y += 5;
    doc.text('電話：' + (customer && customer.phone || ''), marginX, y);
    y += 5;
    doc.text('地址：' + (customer && customer.address || ''), marginX, y);
    y += 8;

    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;
    doc.setFontSize(11);
    doc.text('商品明細', marginX, y);
    y += 4;

    const imgSize = 20;
    const rowHeight = imgSize + 6;

    for (const item of items) {
        if (y + rowHeight > pageHeight - 15) {
            doc.addPage();
            y = 18;
        }

        const dataUrl = await fetchImageAsPngDataUrl(item.product_image_url);
        if (dataUrl) {
            try { doc.addImage(dataUrl, 'PNG', marginX, y, imgSize, imgSize); } catch (e) { console.error(e); }
        } else {
            doc.setDrawColor(220);
            doc.rect(marginX, y, imgSize, imgSize);
        }

        const textX = marginX + imgSize + 5;
        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.text(String(item.product_name_zh || item.product_erp_code || ''), textX, y + 5);

        const specParts = [];
        if (item.spec) specParts.push('規格：' + item.spec);
        if (item.bore) specParts.push('孔徑：' + item.bore);
        if (item.color) specParts.push('顏色：' + item.color);

        doc.setFontSize(9);
        doc.setTextColor(90);
        if (specParts.length) doc.text(specParts.join('　'), textX, y + 10);
        doc.text('數量：' + item.quantity, textX, y + 15);
        doc.setTextColor(0);

        y += rowHeight;
        doc.setDrawColor(230);
        doc.line(marginX, y - 2, pageWidth - marginX, y - 2);
    }

    doc.save((order.order_no || 'order') + '.pdf');
}
