// Bridge TikTok versi online: dijalankan di layanan hosting Node.js, bukan di komputer warnet.
// Overlay tersambung lewat: tt=wss://ALAMAT-SERVERMU&tu=@usernamekamu
// Opsional: set variabel ALLOWED=@idkreiz supaya hanya akun itu yang boleh dipakai.
const http = require('http');
const lib = require('tiktok-live-connector');
const { WebSocketServer } = require('ws');
const Conn = lib.TikTokLiveConnection || lib.WebcastPushConnection;
const EV = lib.WebcastEvent || {};

const ALLOWED = (process.env.ALLOWED || '').split(',').map(s => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
const server = http.createServer((req, res) => { res.writeHead(200); res.end('bridge aktif'); });
const wss = new WebSocketServer({ server });
const rooms = new Map();
const nick = d => d.nickname || d.user?.nickname || d.user?.uniqueId || d.uniqueId || 'penonton';

function room(user) {
  if (rooms.has(user)) return rooms.get(user);
  const r = { clients: new Set(), conn: new Conn(user, {}), retry: null, idle: null };
  const send = obj => { const m = JSON.stringify(obj); r.clients.forEach(c => c.readyState === 1 && c.send(m)); };
  const connect = () => r.conn.connect()
    .then(() => console.log('terhubung:', user))
    .catch(e => { console.error(user, e.message); r.retry = setTimeout(connect, 15000); });
  r.conn.on(EV.CHAT ?? 'chat', d => send({ type: 'chat', user: nick(d), text: d.comment }));
  r.conn.on(EV.FOLLOW ?? 'follow', d => send({ type: 'follow', user: nick(d) }));
  r.conn.on(EV.GIFT ?? 'gift', d => {
    const gt = d.giftType ?? d.giftDetails?.giftType;
    if (gt === 1 && !d.repeatEnd) return;
    send({ type: 'gift', user: nick(d), giftName: d.giftName || d.giftDetails?.giftName || 'hadiah', count: d.repeatCount || 1 });
  });
  r.conn.on(EV.DISCONNECTED ?? 'disconnected', () => { r.retry = setTimeout(connect, 15000); });
  connect();
  rooms.set(user, r);
  return r;
}

wss.on('connection', (ws, req) => {
  const u = (new URL(req.url, 'http://x').searchParams.get('u') || '').replace(/^@/, '');
  if (!u || (ALLOWED.length && !ALLOWED.includes(u.toLowerCase()))) { ws.close(1008, 'tidak diizinkan'); return; }
  let r;
  try { r = room(u); } catch (e) { console.error('gagal membuat koneksi:', e.message); ws.close(1011, 'bridge error'); return; }
  clearTimeout(r.idle);
  r.clients.add(ws);
  ws.on('close', () => {
    r.clients.delete(ws);
    if (!r.clients.size) r.idle = setTimeout(() => {
      if (!r.clients.size) { clearTimeout(r.retry); try { r.conn.disconnect(); } catch (e) {} rooms.delete(u); }
    }, 60000);
  });
});

process.on('uncaughtException', e => console.error('error tak tertangani:', e.message));
process.on('unhandledRejection', e => console.error('janji ditolak:', e && e.message));
setInterval(() => wss.clients.forEach(c => c.ping()), 30000);
server.listen(process.env.PORT || 8081, () => console.log('bridge online jalan'));
