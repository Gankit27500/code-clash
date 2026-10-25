const $ = id => document.getElementById(id);
const home = $('home'), game = $('game');
let ws, state = null, myId = null, activeCode = null, offset = 0, toastTimer, pendingAnswer = null;
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => {
    $('home-error').textContent = '';
    const savedCode = sessionStorage.getItem('cc-room');
    const savedName = localStorage.getItem('cc-name');
    const token = localStorage.getItem('cc-reconnect-token');
    if (savedCode && savedName && token) ws.send(JSON.stringify({type:'join', code:savedCode, name:savedName, reconnectToken:token}));
  };
  ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'error') { $('home-error').textContent = msg.message; $('game-error').textContent = msg.message; return; }
    if (msg.type === 'joined') { myId = msg.playerId; localStorage.setItem('cc-reconnect-token', msg.reconnectToken); activeCode = msg.code; pendingAnswer = null; sessionStorage.setItem('cc-room', msg.code); home.classList.add('hidden'); game.classList.remove('hidden'); $('room-label').textContent = msg.code; $('game-error').textContent = ''; }
    if (msg.type === 'state') {
      state = msg.state; offset = state.now - Date.now();
      if (pendingAnswer && (state.questionIndex !== pendingAnswer.questionIndex || state.answers[myId])) pendingAnswer = null;
      render();
    }
  };
  ws.onclose = () => { if (activeCode) setTimeout(connect, 1100); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); return true; } catch {}
  }
  $('home-error').textContent = 'Connecting… try again in a moment.'; connect(); return false;
}
function enter(type) {
  const name = $('name').value.trim(); if (!name) { $('home-error').textContent = 'Add a name to jump in.'; $('name').focus(); return; }
  localStorage.setItem('cc-name', name); $('home-error').textContent = '';
  const code = $('room-code').value.trim().toUpperCase(); if (type === 'join' && code.length !== 6) { $('home-error').textContent = 'Enter the 6-character room code.'; $('room-code').focus(); return; }
  const reconnectToken = type === 'join' && sessionStorage.getItem('cc-room') === code ? localStorage.getItem('cc-reconnect-token') : null;
  const request = {type, name, code, ...(reconnectToken ? {reconnectToken} : {})};
  if (ws?.readyState === WebSocket.OPEN) send(request); else {
    connect(); const wait = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) { clearInterval(wait); send(request); } }, 100);
    setTimeout(() => clearInterval(wait), 5000);
  }
}
function sortedPlayers() { return [...(state?.players || [])].sort((a,b) => b.score-a.score || a.name.localeCompare(b.name)); }
function renderPlayers() {
  const players = sortedPlayers(); $('player-count').textContent = `${players.length} / 8 PLAYERS`;
  $('player-list').innerHTML = players.map(p => `<div class="player-chip"><span class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><span class="player-name">${esc(p.name)} ${p.id===state.hostId?'<span class="host-mark">★ HOST</span>':''}</span></div>`).join('');
  const host = myId === state.hostId, start = $('start'); start.classList.toggle('hidden', !host);
  $('start-note').textContent = host ? (players.length < 2 ? 'You need at least 2 players to begin' : 'Everyone in? Let the clash begin.') : 'Waiting for the host to start…';
  start.disabled = players.length < 2;
}
function scoreBoard() {
  const players = sortedPlayers();
  $('score-list').innerHTML = players.map((p,i) => `<div class="score-row ${p.id===myId?'me':''}"><span class="rank">${String(i+1).padStart(2,'0')}</span><span class="score-avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><span class="score-name">${esc(p.name)}${p.id===myId?'<span class="you-tag">YOU</span>':''}</span><span class="score-points">${p.score}</span></div>`).join('');
}
function renderPlay() {
  const idx = state.questionIndex, q = state.question;
  if (!q) return;
  $('round-label').textContent = `QUESTION ${String(idx+1).padStart(2,'0')} / ${state.totalQuestions}`;
  $('category').textContent = q.category.toUpperCase(); $('question').textContent = q.text;
  const mine = state.answers[myId];
  const pending = pendingAnswer?.questionIndex === idx ? pendingAnswer : null;
  const selectedChoice = mine?.choice ?? pending?.choice;
  const locked = !!mine || !!pending || !!state.reveal;
  const choices = $('choices');
  if (choices.dataset.roundIndex !== String(idx)) {
    choices.dataset.roundIndex = String(idx);
    choices.innerHTML = q.choices.map((c,i) => `<button class="choice" data-choice="${i}"><span class="choice-key">${String.fromCharCode(65+i)}</span><span>${esc(c)}</span></button>`).join('');
  }
  choices.querySelectorAll('[data-choice]').forEach(button => {
    const choice = Number(button.dataset.choice);
    button.disabled = locked;
    button.classList.toggle('selected', selectedChoice === choice);
    button.classList.toggle('correct', !!state.reveal && choice === state.reveal.answer);
    button.classList.toggle('wrong', !!state.reveal && selectedChoice === choice && choice !== state.reveal.answer);
  });
  $('answer-note').classList.toggle('hidden', !!state.reveal);
  if ((mine || pending) && !state.reveal) $('answer-note').textContent = 'Answer locked in — nice and quick. Waiting for the others…';
  else if (!mine && !state.reveal) $('answer-note').textContent = 'Tap an answer to lock it in';
  $('reveal-note').classList.toggle('hidden', !state.reveal);
  if (state.reveal) $('reveal-note').textContent = mine ? (mine.correct ? `Correct! +${mine.points} points ⚡` : 'Not this time — the right answer is highlighted.') : 'Time’s up. The right answer is highlighted.';
  const remain = state.reveal ? 0 : Math.max(0, (state.deadline - (Date.now()+offset))/1000);
  $('timer').textContent = Math.ceil(remain); $('timer-ring').classList.toggle('urgent', remain <= 5);
  $('progress').style.width = `${Math.min(100,((15-remain)/15)*100)}%`;
}
function renderFinished() {
  const players = sortedPlayers(), top = players[0]?.score || 0, winners = players.filter(p => p.score===top);
  $('winner-title').textContent = winners.length===1 ? `${esc(winners[0].name)} WINS!` : 'IT’S A SHARED WIN!';
  $('winner-subtitle').textContent = winners.length===1 ? 'The brainiest buzzer in the room.' : `${winners.map(p=>esc(p.name)).join(' & ')} are tied at the top.`;
  $('final-scores').innerHTML = players.map((p,i)=>`<div class="final-score"><span>${i===0?'✦':String(i+1).padStart(2,'0')}</span><span>${esc(p.name)}${p.id===myId?' <small>(you)</small>':''}</span><b>${p.score}</b></div>`).join('');
}
function render() {
  if (!state) return;
  $('room-label').textContent = state.code; $('big-code').textContent = state.code;
  $('lobby').classList.toggle('hidden', state.status!=='lobby');
  $('play').classList.toggle('hidden', state.status!=='playing');
  $('finished').classList.toggle('hidden', state.status!=='finished');
  if (state.status==='lobby') renderPlayers();
  if (state.status==='playing') { renderPlay(); scoreBoard(); }
  if (state.status==='finished') { scoreBoard(); renderFinished(); }
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(text) { const t=$('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),1600); }
$('create').onclick = () => enter('create'); $('join').onclick = () => enter('join');
$('name').addEventListener('keydown',e=>{if(e.key==='Enter')enter('create')}); $('room-code').addEventListener('input',e=>e.target.value=e.target.value.replace(/[^a-z0-9]/gi,'').toUpperCase());
$('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')enter('join')});
$('choices').addEventListener('click', event => {
  const button = event.target.closest('button[data-choice]');
  if (!button || button.disabled || !state || state.status !== 'playing' || state.reveal || state.answers[myId] || pendingAnswer?.questionIndex === state.questionIndex) return;
  const choice = Number(button.dataset.choice);
  if (send({type:'answer', choice})) {
    pendingAnswer = {questionIndex: state.questionIndex, choice};
    renderPlay();
  }
});
$('start').onclick = () => send({type:'start'}); $('big-code').onclick = $('copy-code').onclick = async () => { try { await navigator.clipboard.writeText(state?.code||''); toast('Room code copied!'); } catch { toast(`Room code: ${state?.code||''}`); } };
$('leave').onclick = () => { if (ws?.readyState===WebSocket.OPEN) send({type:'leave'}); activeCode=null;sessionStorage.removeItem('cc-room');state=null;game.classList.add('hidden');home.classList.remove('hidden');connect(); };
$('play-again').onclick = () => { sessionStorage.removeItem('cc-room'); activeCode=null;state=null;game.classList.add('hidden');home.classList.remove('hidden');$('room-code').value='';connect(); };
setInterval(()=>{ if (state?.status==='playing'&&!state.reveal) { const remain=Math.max(0,(state.deadline-(Date.now()+offset))/1000);$('timer').textContent=Math.ceil(remain);$('timer-ring').classList.toggle('urgent',remain<=5);$('progress').style.width=`${Math.min(100,((15-remain)/15)*100)}%`; } },100);
connect();
