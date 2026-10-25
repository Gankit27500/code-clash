const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const questions = [
  { category: 'Science', text: 'Which planet has the most moons currently confirmed?', choices: ['Jupiter', 'Saturn', 'Neptune', 'Uranus'], answer: 1 },
  { category: 'Wordplay', text: 'What is the only English number whose letters are in alphabetical order?', choices: ['Forty', 'Eight', 'One', 'Twelve'], answer: 0 },
  { category: 'Geography', text: 'Which country has the most natural lakes?', choices: ['Russia', 'Canada', 'Finland', 'Brazil'], answer: 1 },
  { category: 'Nature', text: 'What is the fastest land animal over a short distance?', choices: ['Lion', 'Pronghorn', 'Cheetah', 'Ostrich'], answer: 2 },
  { category: 'Movies', text: 'In which film would you hear “Roads? Where we’re going, we don’t need roads.”?', choices: ['Ghostbusters', 'Back to the Future', 'E.T.', 'The Goonies'], answer: 1 },
  { category: 'Food', text: 'Which of these is botanically a berry?', choices: ['Strawberry', 'Raspberry', 'Blackberry', 'Banana'], answer: 3 },
  { category: 'Space', text: 'How long does sunlight take to reach Earth, approximately?', choices: ['8 seconds', '8 minutes', '80 minutes', '8 hours'], answer: 1 },
  { category: 'Sport', text: 'How many players from one team are on the court in a basketball game?', choices: ['4', '5', '6', '7'], answer: 1 },
  { category: 'History', text: 'Which ancient civilization built Machu Picchu?', choices: ['Maya', 'Aztec', 'Inca', 'Olmec'], answer: 2 },
  { category: 'Technology', text: 'What does “HTTP” begin with?', choices: ['HyperText Transfer Protocol', 'High Transfer Text Process', 'Hyperlink Tracking Tool Program', 'Host Text Transmission Path'], answer: 0 },
];

function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function safeName(s) { return String(s || '').trim().slice(0, 18); }
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function publicRoom(r) {
  const now = Date.now();
  return {
    code: r.code, status: r.status, hostId: r.hostId,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: !!p.ws })),
    questionIndex: r.index,
    question: r.status === 'playing' && r.index < questions.length ? { ...questions[r.index], answer: undefined } : null,
    startedAt: r.startedAt, deadline: r.deadline, now,
    reveal: r.reveal ? { answer: r.reveal.answer, correctCount: r.reveal.correctCount, timedOut: r.reveal.timedOut, nextAt: r.reveal.nextAt } : null,
    answers: Object.fromEntries([...r.players.values()].filter(p => p.answer !== null).map(p => [p.id, { choice: p.answer, correct: p.correct, points: p.lastPoints }])),
    totalQuestions: questions.length,
  };
}
function broadcast(r) { const message = JSON.stringify({ type: 'state', state: publicRoom(r) }); for (const p of r.players.values()) if (p.ws) p.ws.send(message); }
function roomFor(ws) { return ws.player ? rooms.get(ws.roomCode) : null; }
function clearRoomTimer(r) {
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  r.timerToken = (r.timerToken || 0) + 1;
}
function scheduleRoomTimer(r, delay, callback) {
  clearRoomTimer(r);
  const token = r.timerToken;
  r.timer = setTimeout(() => {
    if (r.timerToken !== token || rooms.get(r.code) !== r) return;
    r.timer = null;
    callback();
  }, Math.max(0, delay));
}
function cleanRoom(r) { clearRoomTimer(r); rooms.delete(r.code); }
function detach(ws) {
  if (!ws.player) return;
  const old = rooms.get(ws.roomCode), p = ws.player;
  ws.player = null; ws.roomCode = null;
  if (!old || old.players.get(p.id) !== p) return;
  old.players.delete(p.id);
  for (const [token, id] of old.reconnectTokens) if (id === p.id) old.reconnectTokens.delete(token);
  if (old.hostId === p.id) old.hostId = old.players.keys().next().value || null;
  if (!old.players.size) cleanRoom(old); else broadcast(old);
}
function armRoundDeadline(r) {
  const roundIndex = r.index;
  scheduleRoomTimer(r, r.deadline - Date.now(), () => {
    if (r.status === 'playing' && r.index === roundIndex && !r.reveal) reveal(r, true);
  });
}
function nextQuestion(r, expectedIndex) {
  if (r.status !== 'playing' || r.index !== expectedIndex || !r.reveal || r.reveal.roundIndex !== expectedIndex) return;
  clearRoomTimer(r);
  r.reveal = null; r.index++;
  if (r.index >= questions.length) { r.status = 'finished'; r.deadline = null; }
  else {
    for (const p of r.players.values()) { p.answer = null; p.answeredAt = null; p.correct = null; p.lastPoints = 0; }
    r.startedAt = Date.now(); r.deadline = r.startedAt + 15000;
    armRoundDeadline(r);
  }
  broadcast(r);
}
function reveal(r, timedOut = false) {
  if (r.status !== 'playing' || r.reveal || r.index < 0 || r.index >= questions.length) return;
  clearRoomTimer(r);
  const correct = questions[r.index].answer;
  let correctCount = 0;
  for (const p of r.players.values()) {
    if (p.answer === correct) {
      p.correct = true; correctCount++;
      p.lastPoints = 100 + Math.max(0, Math.floor(100 * (r.deadline - p.answeredAt) / 15000));
      p.score += p.lastPoints;
    } else { p.correct = false; p.lastPoints = 0; }
  }
  const roundIndex = r.index;
  r.reveal = { answer: correct, correctCount, timedOut, roundIndex, nextAt: Date.now() + 3500 };
  broadcast(r);
  scheduleRoomTimer(r, 3500, () => nextQuestion(r, roundIndex));
}
function handle(ws, msg) {
  let data; try { data = JSON.parse(msg); } catch { return; }
  if (data.type === 'create' || data.type === 'join') {
    const name = safeName(data.name);
    if (!name) return send(ws, { type: 'error', message: 'Add a name to jump in.' });
    let r;
    if (data.type === 'create') {
      if (ws.player) return send(ws, { type: 'error', message: 'You are already in a room.' });
      if (rooms.size > 200) return send(ws, { type: 'error', message: 'Rooms are busy right now. Try again in a moment.' });
      let c; do { c = code(); } while (rooms.has(c));
      r = { code: c, status: 'lobby', hostId: null, players: new Map(), reconnectTokens: new Map(), index: 0, deadline: null, startedAt: null, reveal: null, timer: null, timerToken: 0 };
      rooms.set(c, r);
      const p = newPlayer(name, ws);
      r.hostId = p.id; r.players.set(p.id, p); ws.player = p; ws.roomCode = r.code;
      return joined(ws, r, p);
    } else {
      r = rooms.get(String(data.code || '').toUpperCase());
      if (!r) return send(ws, { type: 'error', message: 'That room code wasn’t found. Check it and try again.' });
      const token = typeof data.reconnectToken === 'string' ? data.reconnectToken : '';
      const existingId = r.reconnectTokens.get(token);
      if (existingId) {
        const existing = r.players.get(existingId);
        if (!existing) return send(ws, { type: 'error', message: 'Reconnect authorization failed.' });
        if (ws.player) detach(ws);
        if (existing.ws) existing.ws.player = null;
        existing.name = name; existing.ws = ws; ws.player = existing; ws.roomCode = r.code;
        return joined(ws, r, existing, true);
      }
      // A public ID is only a display handle. It is never sufficient to claim a player.
      if (data.playerId || token) return send(ws, { type: 'error', message: 'Reconnect authorization failed.' });
      if (ws.player) return send(ws, { type: 'error', message: 'You are already in a room.' });
      if (r.status !== 'lobby' || r.players.size >= 8) return send(ws, { type: 'error', message: r.status !== 'lobby' ? 'That game has already started.' : 'This room is full (8 players max).' });
      const p = newPlayer(name, ws); r.players.set(p.id, p); ws.player = p; ws.roomCode = r.code;
      return joined(ws, r, p);
    }
  }
  const r = roomFor(ws); const p = ws.player;
  if (!r || !p) return;
  if (data.type === 'start') {
    if (p.id !== r.hostId) return send(ws, { type: 'error', message: 'Only the host can start the game.' });
    if (r.status !== 'lobby' || r.players.size < 2) return send(ws, { type: 'error', message: 'You need at least 2 players to start.' });
    r.status = 'playing'; r.index = 0; r.startedAt = Date.now(); r.deadline = r.startedAt + 15000;
    for (const x of r.players.values()) { x.score = 0; x.answer = null; x.answeredAt = null; x.correct = null; x.lastPoints = 0; }
    armRoundDeadline(r);
    broadcast(r);
  }
  if (data.type === 'answer') {
    if (r.status !== 'playing' || r.reveal || p.answer !== null || Date.now() >= r.deadline) return;
    const choice = Number(data.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
    p.answer = choice; p.answeredAt = Date.now();
    if ([...r.players.values()].every(player => player.answer !== null || !player.ws)) reveal(r);
    else broadcast(r);
  }
  if (data.type === 'leave') { detach(ws); ws.close(); }
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }
  const file = pathname === '/' ? 'index.html' : path.normalize(pathname).replace(/^[/\\]+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(full).pipe(res);
});
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = { socket, readyState: 1, buffer: Buffer.alloc(0), send(value) { const b = Buffer.from(value); let header; if (b.length < 126) header = Buffer.from([0x81, b.length]); else if (b.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(b.length, 2); } else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(b.length), 2); } socket.write(Buffer.concat([header, b])); }, close() { if (this.readyState === 1) { this.readyState = 2; socket.end(Buffer.from([0x88, 0])); } } };
  socket.on('data', chunk => {
    ws.buffer = Buffer.concat([ws.buffer, chunk]);
    while (ws.buffer.length >= 2) {
      const b = ws.buffer; const opcode = b[0] & 15; const masked = !!(b[1] & 128); let len = b[1] & 127; let offset = 2;
      if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); offset = 4; } else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); offset = 10; }
      if (masked) offset += 4; if (b.length < offset + len) break;
      let payload = b.subarray(offset, offset + len); if (masked) { const mask = b.subarray(offset - 4, offset); payload = Buffer.from(payload); for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4]; }
      ws.buffer = b.subarray(offset + len);
      if (opcode === 8) {
        ws.readyState = 2;
        const closeHeader = Buffer.from([0x88, payload.length]);
        socket.end(Buffer.concat([closeHeader, payload]));
        return;
      }
      if (opcode === 9) { socket.write(Buffer.from([0x8a, 0])); continue; }
      if (opcode === 1) handle(ws, payload.toString());
    }
  });
  socket.on('error', () => { ws.readyState = 3; });
  socket.on('close', () => { ws.readyState = 3; if (ws.player) { const r = rooms.get(ws.roomCode); if (r && r.players.get(ws.player.id) === ws.player) { ws.player.ws = null; if (r.status === 'lobby') detach(ws); else { broadcast(r); if (r.status === 'finished' && [...r.players.values()].every(p => !p.ws)) cleanRoom(r); } } } });
});
function newPlayer(name, ws) { return { id: crypto.randomUUID(), name, score: 0, answer: null, ws, answeredAt: null, correct: null, lastPoints: 0 }; }
function joined(ws, r, p, rotate = false) {
  let token = [...r.reconnectTokens].find(([, id]) => id === p.id)?.[0];
  if (rotate || !token) {
    for (const [saved, id] of r.reconnectTokens) if (id === p.id) r.reconnectTokens.delete(saved);
    token = crypto.randomBytes(32).toString('base64url'); r.reconnectTokens.set(token, p.id);
  }
  send(ws, { type: 'joined', playerId: p.id, reconnectToken: token, code: r.code });
  broadcast(r);
}
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Code Clash is ready at http://localhost:${PORT}`));
module.exports = { handle, rooms, questions, publicRoom, reveal, nextQuestion, server };
