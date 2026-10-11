const express = require('express');
const multer = require('multer');
const path = require('path');

const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = 'main', ACCESS_CODE = '', PARTY_NAME = 'Recuerdos de la fiesta',
  RETOS: RETOS_ENV = '', GITHUB_API_URL = 'https://api.github.com', PORT = 3000 } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPO) { console.error('Faltan las variables GITHUB_TOKEN y GITHUB_REPO'); process.exit(1); }

const RETOS = (RETOS_ENV ? RETOS_ENV.split('|') : [
  '🎂 Selfie con el festejado', '🥂 Foto del brindis', '💃 Todos bailando', '📸 La mejor pose del grupo',
  '😂 Algo que te haga reír', '🍰 El mejor plato o postre', '🤝 Foto con alguien que acabas de conocer', '🌟 La foto más divertida de la noche'
]).map(s => s.trim()).filter(Boolean).slice(0, 20);

const BASE = `${GITHUB_API_URL}/repos/${GITHUB_REPO}/contents`;
const API = `${BASE}/fotos`;
const H = { Authorization: `Bearer ${GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fiesta-fotos' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const NAME_RE = /^\d+_[a-z0-9]+_[A-Za-z0-9-]+(_r\d+)?\.(jpg|png|webp|gif|mp4|mov|webm)$/;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.static(path.join(__dirname, 'public')));

const needCode = (req, res, next) => ACCESS_CODE && req.get('x-code') !== ACCESS_CODE ? res.status(401).json({ error: 'codigo' }) : next();

// GitHub no admite varias escrituras a la vez en la misma rama: las ponemos en fila.
let chain = Promise.resolve();
const enqueue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

async function putFile(name, buf, tries = 2) {
  const r = await fetch(`${API}/${name}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `foto ${name}`, content: buf.toString('base64'), branch: GITHUB_BRANCH })
  });
  if (r.ok) return;
  if (r.status === 409 && tries > 1) return putFile(name, buf, tries - 1);
  throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---- Datos pequeños (me gusta y mensajes) guardados como JSON en la carpeta data/ del repositorio
const stores = { likes: { file: 'likes.json', def: {} }, msgs: { file: 'mensajes.json', def: [] } };
Object.values(stores).forEach(s => { s.data = null; s.sha = null; s.timer = null; });

async function ensure(s) {
  if (s.data !== null) return;
  const r = await fetch(`${BASE}/data/${s.file}?ref=${GITHUB_BRANCH}`, { headers: H });
  if (r.status === 404) { s.data = JSON.parse(JSON.stringify(s.def)); return; }
  if (!r.ok) throw new Error('GitHub ' + r.status); // no sobrescribimos datos si no pudimos leerlos
  const j = await r.json();
  s.sha = j.sha; s.data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  if (s === stores.likes) for (const n of Object.keys(s.data)) if (Array.isArray(s.data[n])) s.data[n] = { heart: s.data[n] }; // formato anterior: solo me gusta
}
async function saveNow(s, tries = 2) {
  const body = { message: `datos ${s.file}`, content: Buffer.from(JSON.stringify(s.data)).toString('base64'), branch: GITHUB_BRANCH };
  if (s.sha) body.sha = s.sha;
  const r = await fetch(`${BASE}/data/${s.file}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) { s.sha = (await r.json()).content.sha; return; }
  if ((r.status === 409 || r.status === 422) && tries > 1) {
    const g = await fetch(`${BASE}/data/${s.file}?ref=${GITHUB_BRANCH}`, { headers: H });
    if (g.ok) s.sha = (await g.json()).sha;
    return saveNow(s, tries - 1);
  }
  throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
const touch = s => { if (s.timer) return; s.timer = setTimeout(() => { s.timer = null; enqueue(() => saveNow(s)).catch(e => console.error(e.message)); }, 3000); };
process.on('SIGTERM', async () => { // al reiniciar, guardamos lo pendiente
  for (const s of Object.values(stores)) if (s.timer) { clearTimeout(s.timer); s.timer = null; try { await saveNow(s); } catch (e) { console.error(e.message); } }
  process.exit(0);
});

let listCache = null;
async function getNames() {
  if (!listCache || Date.now() - listCache.at > 8000) {
    const r = await fetch(`${API}?ref=${GITHUB_BRANCH}`, { headers: H });
    const items = r.status === 404 ? [] : r.ok ? await r.json() : null;
    if (!items) throw new Error('GitHub ' + r.status);
    listCache = { at: Date.now(), names: items.map(i => i.name).filter(n => NAME_RE.test(n)).sort().reverse() };
  }
  return listCache.names;
}

app.get('/api/config', (req, res) => res.json({ name: PARTY_NAME, needsCode: !!ACCESS_CODE, retos: RETOS }));

app.post('/api/upload', needCode, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code || 'error' });
    const f = req.file, ext = f && EXT[f.mimetype];
    if (!ext) return res.status(415).json({ error: 'tipo' });
    const by = String(req.body.by || 'Invitado').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'Invitado';
    const rt = /^\d{1,2}$/.test(req.body.reto || '') ? +req.body.reto : -1;
    const tag = rt >= 0 && rt < RETOS.length ? `_r${rt}` : '';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${by}${tag}.${ext}`;
    try { await enqueue(() => putFile(name, f.buffer)); listCache = null; res.json({ ok: true, name }); }
    catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
  });
});

app.get('/api/list', async (req, res) => {
  try { res.json(await getNames()); } catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});

// ---- Reacciones (❤️ 😂 🔥 👏)
const REACTS = ['heart', 'laugh', 'fire', 'clap'];
app.get('/api/reactions', async (req, res) => {
  try {
    await ensure(stores.likes);
    const v = String(req.query.v || ''), counts = {}, mine = {};
    for (const [n, o] of Object.entries(stores.likes.data)) {
      counts[n] = {};
      for (const k of REACTS) { const a = o[k] || []; if (a.length) counts[n][k] = a.length; if (a.includes(v)) (mine[n] || (mine[n] = [])).push(k); }
    }
    res.json({ counts, mine });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});
app.post('/api/react', needCode, express.json({ limit: '2kb' }), async (req, res) => {
  const { name, voter, kind } = req.body || {};
  if (!NAME_RE.test(name) || !REACTS.includes(kind) || !/^[A-Za-z0-9-]{8,40}$/.test(voter || '')) return res.sendStatus(400);
  try {
    const s = stores.likes; await ensure(s);
    if (!(await getNames()).includes(name)) return res.sendStatus(404);
    const o = s.data[name] || (s.data[name] = {}), arr = o[kind] || (o[kind] = []), i = arr.indexOf(voter);
    if (i >= 0) arr.splice(i, 1); else arr.push(voter);
    const count = arr.length;
    if (!count) delete o[kind];
    if (!Object.keys(o).length) delete s.data[name];
    touch(s); res.json({ on: i < 0, count });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});

// ---- Libro de visitas
app.get('/api/guestbook', async (req, res) => {
  try { await ensure(stores.msgs); res.json(stores.msgs.data.slice().reverse()); }
  catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});
app.post('/api/guestbook', needCode, express.json({ limit: '4kb' }), async (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, 300);
  const by = String((req.body || {}).by || 'Invitado').trim().slice(0, 30) || 'Invitado';
  if (!text) return res.sendStatus(400);
  try {
    const s = stores.msgs; await ensure(s);
    if (s.data.length >= 500) return res.status(429).json({ error: 'lleno' });
    s.data.push({ by, text, at: Date.now() }); touch(s); res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'github' }); }
});

// ---- Archivos (con caché en memoria para no gastar el límite de la API)
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
    if (req.query.dl) { res.set('Content-Disposition', `attachment; filename="${name}"`); res.set('Content-Length', buf.length); return res.end(buf); }
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
