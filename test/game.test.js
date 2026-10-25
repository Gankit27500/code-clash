const test = require('node:test');
const assert = require('node:assert/strict');
const { handle, rooms, reveal, nextQuestion, questions } = require('../server');

class Peer {
  readyState = 1;
  player = null;
  roomCode = null;
  messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  latest(type) { return this.messages.filter(m => m.type === type).at(-1); }
  request(message) { handle(this, JSON.stringify(message)); return this.latest('joined'); }
}

function roomCode(peer) { return peer.latest('joined').code; }
function state(peer) { return peer.latest('state').state; }
function makeRoom(count = 2) {
  const peers = [];
  const host = new Peer(); peers.push(host); host.request({ type: 'create', name: 'Host' });
  const code = roomCode(host);
  for (let i = 1; i < count; i++) { const p = new Peer(); peers.push(p); p.request({ type: 'join', name: `Player ${i}`, code }); }
  return { code, peers, room: rooms.get(code) };
}
function stopRoomTimers() {
  for (const room of rooms.values()) if (room.timer) clearTimeout(room.timer);
  rooms.clear();
}
test.afterEach(stopRoomTimers);

test('room admits 2 through 8 players and rejects a ninth', () => {
  const { peers, code } = makeRoom(8);
  assert.equal(state(peers[0]).players.length, 8);
  const ninth = new Peer(); ninth.request({ type: 'join', name: 'Ninth', code });
  assert.match(ninth.latest('error').message, /full/);
  assert.equal(state(peers[0]).players.length, 8);
  peers[0].request({ type: 'start' });
  assert.equal(state(peers[0]).status, 'playing');
});

test('public player ID cannot authorize reconnect; valid secret preserves player and rejects old socket replacement', () => {
  const { peers, room, code } = makeRoom(2);
  const victim = peers[1], playerId = victim.latest('joined').playerId;
  const token = victim.latest('joined').reconnectToken;
  assert.equal(token.length >= 40, true);
  assert.equal(JSON.stringify(state(peers[0])).includes(token), false);
  const attacker = new Peer(); attacker.request({ type: 'join', name: 'Impostor', code, playerId });
  assert.match(attacker.latest('error').message, /authorization/);
  assert.equal(room.players.get(playerId).ws, victim);
  const reconnect = new Peer(); reconnect.request({ type: 'join', name: 'Player 1', code, reconnectToken: token });
  assert.equal(reconnect.latest('joined').playerId, playerId);
  assert.notEqual(reconnect.latest('joined').reconnectToken, token);
  assert.equal(room.players.get(playerId).ws, reconnect);
  const replay = new Peer(); replay.request({ type: 'join', name: 'Replay', code, reconnectToken: token });
  assert.match(replay.latest('error').message, /authorization/);
  assert.equal(room.players.get(playerId).ws, reconnect);
});

test('duplicate answers score once and speed bonus never exceeds 100', () => {
  const { peers, room } = makeRoom(2);
  const realNow = Date.now; let now = 1_000_000; Date.now = () => now;
  try {
    peers[0].request({ type: 'start' });
    const answer = questions[0].answer;
    peers[0].request({ type: 'answer', choice: answer });
    const firstPoints = room.players.get(peers[0].latest('joined').playerId).lastPoints;
    peers[0].request({ type: 'answer', choice: answer });
    assert.equal(room.players.get(peers[0].latest('joined').playerId).lastPoints, firstPoints);
    peers[1].request({ type: 'answer', choice: (answer + 1) % 4 });
    assert.equal(room.players.get(peers[0].latest('joined').playerId).score, 200);
    assert.equal(room.players.get(peers[1].latest('joined').playerId).score, 0);
    assert.equal(state(peers[0]).reveal.correctCount, 1);
    nextQuestion(room, 0);
    assert.equal(room.index, 1);
  } finally { Date.now = realNow; }
});

test('scheduled timeout awards zero for missed answer and advances one question exactly once', () => {
  const { peers, room } = makeRoom(2);
  const realNow = Date.now; let now = 2_000_000; Date.now = () => now;
  const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
  let deadlineTask;
  global.setTimeout = (callback, delay) => { deadlineTask = { callback, delay }; return 4242; };
  global.clearTimeout = () => {};
  try {
    peers[0].request({ type: 'start' });
    assert.equal(deadlineTask.delay, 15000);
    now = room.deadline;
    deadlineTask.callback();
    assert.equal(state(peers[0]).reveal.timedOut, true);
    assert.equal(room.players.get(peers[0].latest('joined').playerId).score, 0);
    nextQuestion(room, 0);
    nextQuestion(room, 0);
    assert.equal(room.index, 1);
    assert.equal(state(peers[0]).questionIndex, 1);
  } finally { Date.now = realNow; global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout; }
});

test('game exposes final results only after question ten', () => {
  const { peers, room } = makeRoom(2);
  const realNow = Date.now; let now = 3_000_000; Date.now = () => now;
  try {
    peers[0].request({ type: 'start' });
    for (let round = 0; round < 10; round++) {
      assert.equal(room.index, round);
      assert.equal(state(peers[0]).status, 'playing');
      now = room.deadline;
      reveal(room, true);
      nextQuestion(room, round);
    }
    assert.equal(room.index, 10);
    assert.equal(state(peers[0]).status, 'finished');
    assert.equal(state(peers[0]).question, null);
    assert.equal(state(peers[0]).totalQuestions, 10);
  } finally { Date.now = realNow; }
});
