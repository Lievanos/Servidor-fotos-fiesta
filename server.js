const express = require('express');
const multer = require('multer');
const path = require('path');

const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = 'main', ACCESS_CODE = '', PARTY_NAME = 'Recuerdos de la fiesta', PORT = 3000 } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPO) { console.error('Faltan las variables GITHUB_TOKEN y GITHUB_REPO'); process.exit(1); }

const API = `https://api.github.com/repos/${GITHUB_REPO}/contents/fotos`;
const H = { Authorization: `Bearer ${GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fiesta-fotos' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const NAME_RE = /^\d+_[a-z0-9]+_[A-Za-z0-9-]+\.(jpg|png|webp|gif|mp4|mov|webm)$/;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.static(path.join(__dirname, 'public')));

// GitHub no admite varias escrituras a la vez en la misma rama: las ponemos en fila.
let chain = Promise.resolve();
const enqueue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

async function putFile(name, buf, tries = 2) {
  const r = await fetch(`${API}/${name}`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `foto ${name}`, content: buf.toString('base64'), branch: GITHUB_BRANCH })
  });
  if (r.ok) return;
  if (r.status === 409 && tries > 1) return putFile(name, buf, tries - 1);
  throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

app.get('/api/config', (req, res) => res.json({ name: PARTY_NAME, needsCode: !!ACCESS_CODE }));

app.post('/api/upload', (req, res) => {
  if (ACCESS_CODE && req.get('x-code') !== ACCESS_CODE) return res.status(401).json({ error: 'codigo' });
  upload.single('file')(req, res, async err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code || 'error' });
    const f = req.file, ext = f && EXT[f.mimetype];
    if (!ext) return res.status(415).json({ error: 'tipo' });
    const by = String(req.body.by || 'Invitado').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'Invitado';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${by}.${ext}`;
    try { await enqueue(() => putFile(name, f.buffer)); listCache = null; res.json({ ok: true, name }); }
    catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
  });
});

let listCache = null;
app.get('/api/list', async (req, res) => {
  try {
    if (!listCache || Date.now() - listCache.at > 8000) {
      const r = await fetch(`${API}?ref=${GITHUB_BRANCH}`, { headers: H });
      const items = r.status === 404 ? [] : r.ok ? await r.json() : null;
      if (!items) throw new Error('GitHub ' + r.status);
      listCache = { at: Date.now(), names: items.map(i => i.name).filter(n => NAME_RE.test(n)).sort().reverse() };
    }
    res.json(listCache.names);
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});

// Descarga desde GitHub con una caché en memoria, para no gastar el límite de la API.
const cache = new Map(); let cacheBytes = 0;
async function getFile(name) {
  if (cache.has(name)) { const v = cache.get(name); cache.delete(name); cache.set(name, v); return v; }
  const r = await fetch(`${API}/${name}?ref=${GITHUB_BRANCH}`, { headers: { ...H, Accept: 'application/vnd.github.raw+json' } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  cache.set(name, buf); cacheBytes += buf.length;
  while (cacheBytes > 120e6) { const k = cache.keys().next().value; cacheBytes -= cache.get(k).length; cache.delete(k); }
  return buf;
}

app.get('/media/:name', async (req, res) => {
  const name = req.params.name;
  if (!NAME_RE.test(name)) return res.sendStatus(400);
  try {
    const buf = await getFile(name);
    if (!buf) return res.sendStatus(404);
    res.set({ 'Content-Type': MIME[name.split('.').pop()], 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' });
    const m = /bytes=(\d*)-(\d*)/.exec(req.get('range') || '');
    if (m) { // los iPhone piden los vídeos por partes
      const start = m[1] ? +m[1] : Math.max(0, buf.length - +m[2]);
      const end = m[1] && m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
      return res.end(buf.subarray(start, end + 1));
    }
    res.set('Content-Length', buf.length); res.end(buf);
  } catch (e) { console.error(e.message); res.sendStatus(502); }
});

app.listen(PORT, () => console.log('Listo en el puerto ' + PORT));
