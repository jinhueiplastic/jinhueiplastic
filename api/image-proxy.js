// 給後台的出單 PDF 用：瀏覽器直接抓 Cloudinary 圖片來源做成 PDF 有時會被 CORS 擋掉，
// 這個 function 在伺服器端抓圖片再轉手給前端，繞開瀏覽器的跨來源限制。
// 只允許 Cloudinary 網域，避免被當成任意網址的公開代理。
const ALLOWED_HOSTS = ['res.cloudinary.com'];
const MAX_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
        res.status(400).send('Missing url parameter');
        return;
    }

    let target;
    try {
        target = new URL(url);
    } catch (e) {
        res.status(400).send('Invalid url');
        return;
    }

    if (!ALLOWED_HOSTS.includes(target.hostname)) {
        res.status(403).send('Host not allowed');
        return;
    }

    try {
        const upstream = await fetch(target.toString());
        if (!upstream.ok) {
            res.status(upstream.status).send('Upstream fetch failed');
            return;
        }

        const contentType = upstream.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            res.status(415).send('Not an image');
            return;
        }

        const contentLength = upstream.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_BYTES) {
            res.status(413).send('Image too large');
            return;
        }

        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(buffer);
    } catch (e) {
        res.status(502).send('Fetch error: ' + e.message);
    }
}
