// عرض صور الأسئلة والاختيارات: /api/img?id=...
const { db } = require('./_lib');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
  if (!UUID_RE.test(id)) { res.status(404).end('not found'); return; }
  try {
    const rows = await db('images?id=eq.' + id + '&select=mime,data');
    if (!rows || !rows[0]) { res.status(404).end('not found'); return; }
    const buf = Buffer.from(rows[0].data, 'base64');
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // الصورة مش بتتغير (أي تعديل = صورة جديدة)
    res.status(200).end(buf);
  } catch (e) {
    console.error(e);
    res.status(500).end('error');
  }
};
