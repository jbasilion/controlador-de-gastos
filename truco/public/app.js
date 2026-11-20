const CFG = window.TRUCO_CONFIG || {};
const API = CFG.api || `${CFG.supabaseUrl}/functions/v1/truco`;
const $app = document.getElementById('app');
const $toasts = document.getElementById('toasts');

const SUIT = { o: '♦', e: '♠', c: '♥', p: '♣' };
const CALL = { 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' };
const NEXT = { 1: 3, 3: 6, 6: 9, 9: 12 };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

let token = store.get('truco_token');
if (!token) {
  token = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  store.set('truco_token', token);
}
let myName = store.get('truco_name') || '';
let code = (new URLSearchParams(location.search).get('sala') || '').toUpperCase() || null;
let S = null; // estado da sala visto por este jogador
let seenLog = 0;
let seenTrick = 0;
let trickUntil = 0;
let covered = false;
let busy = false;
let realtimeOn = false;
let channel = null;
let pollTimer = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = text;
  $toasts.append(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------- rede

async function api(action, extra = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (CFG.supabaseKey) {
    headers.apikey = CFG.supabaseKey;
    headers.Authorization = `Bearer ${CFG.supabaseKey}`;
  }
  const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ action, token, code, ...extra }) });
  const data = await res.json().catch(() => ({ ok: false, error: 'Erro de conexão' }));
  if (!data.ok) throw new Error(data.error || 'Erro');
  if (data.code) code = data.code;
  if (data.state) setState(data.state);
  return data;
}

async function send(action, extra) {
  if (busy) return;
  busy = true;
  try {
    await api(action, extra);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    busy = false;
  }
}

async function poll() {
  if (!code || document.hidden) return;
  try {
    await api('state', { v: S?.v });
  } catch { /* tenta de novo no próximo ciclo */ }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await poll();
    schedulePoll();
  }, realtimeOn ? 5000 : 1200);
}

async function connectRealtime() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey || channel) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    const client = createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false } });
    channel = client.channel(`truco-${code}`)
      .on('broadcast', { event: 'u' }, () => poll())
      .subscribe((status) => { realtimeOn = status === 'SUBSCRIBED'; });
  } catch { /* sem tempo real: segue no polling */ }
}

function enterRoom() {
  history.replaceState(null, '', `?sala=${code}`);
  connectRealtime();
  schedulePoll();
}

function leaveRoom() {
  clearTimeout(pollTimer);
  channel?.unsubscribe();
  channel = null;
  realtimeOn = false;
  code = null;
  S = null;
  history.replaceState(null, '', location.pathname);
  render();
}

function setState(s) {
  const fresh = !S || S.code !== s.code;
  const logMax = s.log.reduce((m, e) => Math.max(m, e.n), 0);
  if (fresh) {
    seenTrick = s.lastTrick?.n || 0;
  } else {
    if (s.lastTrick && s.lastTrick.n > seenTrick) {
      seenTrick = s.lastTrick.n;
      trickUntil = Date.now() + 1800;
      setTimeout(render, 1850);
    }
    for (const e of s.log) if (e.n > seenLog) announce(s, e);
  }
  seenLog = logMax;
  if (S && s.hand?.n !== S.hand?.n) covered = false;
  S = s;
  render();
}

// ---------------------------------------------------------------- textos

const base = () => (S.me >= 0 ? S.me : 0);
const mine = (team) => team === base() % 2;
const seatName = (seat) => (seat === S.me ? 'Você' : S.seats[seat]?.name ?? '?');
function teamName(team, s = S) {
  if (s.me >= 0 && s.size === 4) return team === s.me % 2 ? 'Nós' : 'Eles';
  if (s.me >= 0 && s.size === 2 && team === s.me % 2) return 'Você';
  return s.seats.filter((_, i) => i % 2 === team).map((p) => p?.name ?? '?').join(' e ');
}

function announce(s, e) {
  const who = e.seat === s.me ? 'Você' : s.seats[e.seat]?.name;
  const plural = e.seat === s.me;
  if (e.t === 'truco') toast(`${who}: ${CALL[e.value].toUpperCase()}!`, 'big');
  else if (e.t === 'accept') toast(`${who} ${plural ? 'aceitou' : 'aceitou'} — vale ${e.value}`);
  else if (e.t === 'run') toast(`${who} correu`);
  else if (e.t === 'mao11') toast(e.goes ? `Mão de onze: ${who} vai jogar (vale 3)` : `Mão de onze: ${who} correu`);
  else if (e.t === 'hand') {
    if (e.team < 0) toast('Mão empatada, ninguém pontua');
    else toast(`${teamName(e.team, s)}: +${e.points} ${e.points === 1 ? 'ponto' : 'pontos'}`);
  }
}

// ---------------------------------------------------------------- telas

function cardHtml(card, cls = '', attrs = '') {
  if (!card) return `<div class="card back ${cls}"></div>`;
  const red = card[1] === 'o' || card[1] === 'c' ? 'red' : '';
  const manilha = S?.hand && card[0] === S.hand.manilha ? 'manilha' : '';
  const tag = attrs ? 'button' : 'div';
  return `<${tag} class="card ${red} ${manilha} ${cls}" ${attrs}><b>${card[0]}</b><i>${SUIT[card[1]]}</i></${tag}>`;
}

function renderHome() {
  $app.innerHTML = `
    <div class="screen">
      <div class="logo"><h1>🃏 Truco</h1><p>Truco paulista online com os amigos</p></div>
      <div class="panel">
        <h2>Seu nome</h2>
        <input class="field" id="name" maxlength="16" placeholder="Como te chamam na mesa?" value="${esc(myName)}" autocomplete="nickname">
      </div>
      ${code ? `
      <div class="panel">
        <h2>Você foi convidado para a sala</h2>
        <div class="room-code">${esc(code)}</div>
        <button class="btn gold block" data-act="join">Entrar na sala</button>
        <button class="btn ghost block" data-act="forget">Criar outra sala</button>
      </div>` : `
      <div class="panel">
        <h2>Criar uma sala</h2>
        <div class="row">
          <button class="btn gold" data-act="create" data-size="4">2 contra 2</button>
          <button class="btn gold" data-act="create" data-size="2">1 contra 1</button>
        </div>
      </div>
      <div class="panel">
        <h2>Entrar com o código</h2>
        <div class="row">
          <input class="field code-input" id="code" maxlength="4" placeholder="ABCD" autocapitalize="characters" autocomplete="off">
          <button class="btn" data-act="join">Entrar</button>
        </div>
      </div>`}
    </div>`;
}

function renderLobby() {
  const link = `${location.origin}${location.pathname}?sala=${S.code}`;
  const seatRow = (i) => {
    const p = S.seats[i];
    if (!p) {
      return `<div class="seat empty"><span class="who">Lugar vago</span>
        ${S.me >= 0 ? `<button class="btn small ghost" data-act="sit" data-seat="${i}">Sentar aqui</button>` : ''}
        ${S.isHost ? `<button class="btn small ghost" data-act="bot" data-seat="${i}">+ Bot</button>` : ''}</div>`;
    }
    return `<div class="seat"><span class="who">${p.bot ? '🤖 ' : ''}${esc(p.name)}</span>
      ${i === S.me ? '<span class="tag">VOCÊ</span>' : ''}
      ${p.bot && S.isHost ? `<button class="btn small ghost" data-act="bot" data-seat="${i}">Tirar</button>` : ''}</div>`;
  };
  const teams = S.size === 4
    ? `<p class="team-title">Dupla 1</p>${seatRow(0)}${seatRow(2)}<p class="team-title">Dupla 2</p>${seatRow(1)}${seatRow(3)}`
    : `${seatRow(0)}${seatRow(1)}`;
  const full = !S.seats.includes(null);
  $app.innerHTML = `
    <div class="screen">
      <div class="panel">
        <h2>Código da sala</h2>
        <div class="room-code">${esc(S.code)}</div>
        <div class="row">
          <button class="btn" data-act="copy" data-link="${esc(link)}">Copiar link</button>
          <a class="btn gold" style="text-align:center;text-decoration:none" target="_blank" rel="noopener"
             href="https://wa.me/?text=${encodeURIComponent(`Bora um truco? Entra aí: ${link}`)}">WhatsApp</a>
        </div>
      </div>
      <div class="panel"><h2>Jogadores</h2>${teams}</div>
      ${S.isHost
        ? `<button class="btn gold block" data-act="start" ${full ? '' : 'disabled'}>${full ? 'Começar o jogo' : 'Aguardando jogadores…'}</button>`
        : `<p class="hint">${S.me >= 0 ? 'Aguardando quem criou a sala começar…' : 'A sala está cheia.'}</p>`}
      <button class="btn ghost block" data-act="leave">Sair da sala</button>
    </div>`;
}

function renderGame() {
  const h = S.hand;
  const b = base();
  const pos = (seat) => (S.size === 2 ? ['bottom', 'top'] : ['bottom', 'right', 'top', 'left'])[(seat - b + S.size) % S.size];
  const showTrick = S.lastTrick && (Date.now() < trickUntil || !h);
  const table = showTrick ? S.lastTrick.cards : h ? h.table : [];
  const myTurn = h && S.me >= 0 && h.turn === S.me && !h.bet && !h.mao11 && !showTrick;

  const others = S.seats.map((p, i) => i).filter((i) => i !== b || S.me < 0).map((i) => {
    if (S.me < 0 && pos(i) === 'bottom') return '';
    const turn = h && h.turn === i && !h.bet && !h.mao11 ? 'turn' : '';
    const partner = S.me >= 0 && S.size === 4 && i % 2 === S.me % 2 ? 'partner' : '';
    const p = S.seats[i];
    return `<div class="player ${pos(i)} ${turn}">
      <div class="name ${partner}" ${S.isHost && !p.bot ? `data-act="botify" data-seat="${i}"` : ''}>${p.bot ? '🤖 ' : ''}${esc(p.name)}</div>
      <div class="backs">${'<i></i>'.repeat(h ? h.counts[i] : 0)}</div>
    </div>`;
  }).join('');

  const slots = table.map((p) => {
    const won = showTrick && S.lastTrick.winnerSeat === p.seat ? 'won' : '';
    return `<div class="slot ${pos(p.seat)}">${cardHtml(p.card, `small ${won}`)}</div>`;
  }).join('');

  const dots = [0, 1, 2].map((i) => {
    const r = h?.rounds[i];
    return `<i class="${r === undefined ? '' : r < 0 ? 'tie' : mine(r) ? 'us' : 'them'}"></i>`;
  }).join('');

  let status = '';
  if (h) {
    if (h.mao11) status = 'Mão de onze';
    else if (h.bet) status = `${seatName(h.bet.seat)} pediu ${CALL[h.bet.value]}…`;
    else if (myTurn) status = covered ? 'Escolha a carta para jogar coberta' : 'Sua vez!';
    else status = `Vez de ${seatName(h.turn)}`;
  }

  const canCall = myTurn && !h.noTruco && h.value < 12 && h.lastRaise !== S.me % 2;
  const t0 = b % 2;
  $app.innerHTML = `
    <div class="bar">
      <div class="score">
        <div class="t us"><small>${esc(teamName(t0))}</small>${S.score[t0]}</div>×
        <div class="t them"><small>${esc(teamName(1 - t0))}</small>${S.score[1 - t0]}</div>
      </div>
      ${h ? `<span class="worth">Vale ${h.value}</span>` : ''}
      <button class="btn small ghost" data-act="exit">Sair</button>
    </div>
    <div class="felt">
      ${others}
      <div class="center">
        ${h ? `<div class="vira">${cardHtml(h.vira, 'small')}vira</div>` : ''}
        ${slots}
        <div class="rounds">${dots}</div>
      </div>
    </div>
    ${S.me >= 0 ? `
    <div class="mine">
      <div class="status">${esc(status)}</div>
      <div class="hand ${myTurn ? 'active' : ''} ${covered && myTurn ? 'covered' : ''}">
        ${(h ? h.mine : []).map((c) => cardHtml(c, '', `data-act="play" data-card="${c}"`)).join('')}
      </div>
      <div class="actions">
        <button class="btn gold" data-act="truco" ${canCall ? '' : 'disabled'}>${h ? (CALL[NEXT[h.value]] || 'Truco') : 'Truco'}!</button>
        <button class="btn ghost" data-act="cover" ${myTurn && h.rounds.length > 0 ? '' : 'disabled'}>${covered ? 'Jogar aberta' : 'Jogar coberta'}</button>
      </div>
    </div>` : `<div class="mine"><div class="status">Você está assistindo · ${esc(status)}</div></div>`}
    ${renderOverlay(showTrick)}`;
}

function renderOverlay(showTrick) {
  const h = S.hand;
  if (S.phase === 'finished' && !(Date.now() < trickUntil)) {
    const won = S.me >= 0 && S.winner === S.me % 2;
    return `<div class="overlay middle"><div class="sheet">
      <h3>${S.me < 0 ? `${esc(teamName(S.winner))} venceu!` : won ? '🏆 Vitória!' : '😵 Derrota'}</h3>
      <p>${S.score[base() % 2]} × ${S.score[1 - (base() % 2)]}</p>
      ${S.isHost ? '<button class="btn gold" data-act="rematch">Jogar de novo</button>' : '<p>Aguardando quem criou a sala…</p>'}
      <button class="btn ghost" data-act="exit">Sair</button>
    </div></div>`;
  }
  if (!h || S.me < 0 || showTrick) return '';
  const myTeam = S.me % 2;
  if (h.mao11 && h.mao11.team === myTeam) {
    return `<div class="overlay"><div class="sheet">
      <h3>Mão de onze</h3>
      <p>Se jogar, a mão vale 3. Se correr, eles ganham 1.</p>
      ${h.partner ? `<p>Cartas do parceiro:</p><div class="cards">${h.partner.map((c) => cardHtml(c, 'small')).join('')}</div>` : ''}
      <p>Suas cartas:</p><div class="cards">${h.mine.map((c) => cardHtml(c, 'small')).join('')}</div>
      <div class="row"><button class="btn red" data-act="mao11" data-goes="">Correr</button>
      <button class="btn gold" data-act="mao11" data-goes="1">Jogar</button></div>
    </div></div>`;
  }
  if (h.bet && h.bet.team !== myTeam) {
    const up = NEXT[h.bet.value];
    return `<div class="overlay"><div class="sheet">
      <h3>${esc(seatName(h.bet.seat))} pediu ${CALL[h.bet.value].toUpperCase()}!</h3>
      <p>Aceitando, a mão vale ${h.bet.value}. Correndo, eles levam ${h.value}.</p>
      <div class="cards">${h.mine.map((c) => cardHtml(c, 'small')).join('')}</div>
      <div class="row"><button class="btn red" data-act="respond" data-answer="run">Correr</button>
      <button class="btn" data-act="respond" data-answer="accept">Aceitar</button></div>
      ${up ? `<button class="btn gold" data-act="respond" data-answer="raise">Pedir ${CALL[up]}!</button>` : ''}
    </div></div>`;
  }
  return '';
}

function render() {
  if (!code || !S) renderHome();
  else if (S.phase === 'lobby') renderLobby();
  else renderGame();
}

// ---------------------------------------------------------------- eventos

function readName() {
  const el = document.getElementById('name');
  if (el) {
    myName = el.value.trim();
    store.set('truco_name', myName);
  }
  if (!myName) {
    toast('Digite seu nome primeiro', 'err');
    el?.focus();
    return false;
  }
  return true;
}

async function joinRoom() {
  try {
    await api('join', { name: myName });
    enterRoom();
  } catch (e) {
    toast(e.message, 'err');
    if (!S) { code = null; history.replaceState(null, '', location.pathname); render(); }
  }
}

$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  switch (d.act) {
    case 'create':
      if (!readName()) return;
      try {
        await api('create', { name: myName, size: Number(d.size) });
        enterRoom();
      } catch (e) { toast(e.message, 'err'); }
      break;
    case 'join': {
      if (!readName()) return;
      const typed = document.getElementById('code');
      if (typed) code = typed.value.trim().toUpperCase();
      if (!code || code.length !== 4) return toast('Digite o código de 4 letras', 'err');
      await joinRoom();
      break;
    }
    case 'forget': code = null; history.replaceState(null, '', location.pathname); render(); break;
    case 'copy':
      try {
        await navigator.clipboard.writeText(d.link);
        toast('Link copiado!');
      } catch { prompt('Copie o link:', d.link); }
      break;
    case 'sit': send('sit', { seat: Number(d.seat) }); break;
    case 'bot': send('bot', { seat: Number(d.seat) }); break;
    case 'botify':
      if (confirm(`Colocar um bot no lugar de ${S.seats[d.seat].name}? (Se a pessoa voltar, ela reassume.)`)) send('bot', { seat: Number(d.seat) });
      break;
    case 'start': send('start'); break;
    case 'rematch': send('rematch'); break;
    case 'leave': await send('leave'); leaveRoom(); break;
    case 'exit': if (S.phase === 'finished' || confirm('Sair da mesa? Você pode voltar pelo mesmo link.')) leaveRoom(); break;
    case 'play': {
      const h = S.hand;
      if (!h || h.turn !== S.me || h.bet || h.mao11 || Date.now() < trickUntil) return;
      const hidden = covered;
      covered = false;
      send('play', { card: d.card, hidden });
      break;
    }
    case 'cover': covered = !covered; render(); break;
    case 'truco': send('truco'); break;
    case 'respond': send('respond', { answer: d.answer }); break;
    case 'mao11': send('mao11', { goes: !!d.goes }); break;
  }
});

$app.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('#name, #code')) $app.querySelector('[data-act="join"], [data-act="create"]')?.click();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

render();
if (code && myName) joinRoom();
