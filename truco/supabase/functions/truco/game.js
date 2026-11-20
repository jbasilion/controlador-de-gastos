// Truco paulista — regras e estado da sala. Módulo puro (sem I/O), usado pela
// Edge Function do Supabase e pelo servidor local de desenvolvimento.

export const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
export const SUITS = ['o', 'e', 'c', 'p']; // ouros < espadas < copas < paus
const NEXT_VALUE = { 1: 3, 3: 6, 6: 9, 9: 12 };
const TARGET = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

function randInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export function randomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

export function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function strength(card, manilha) {
  if (!card) return -1;
  if (card[0] === manilha) return 10 + SUITS.indexOf(card[1]);
  return RANKS.indexOf(card[0]);
}

const teamOf = (seat) => seat % 2;

// Recebe o resultado de cada rodada (time vencedor ou -1 para empate) e devolve
// o time que ganhou a mão, -1 se ninguém pontua, ou undefined se a mão continua.
export function handWinner(rounds) {
  const [a, b, c] = rounds;
  if (rounds.length < 2) return undefined;
  if (rounds.length === 2) {
    if (a === -1 && b === -1) return undefined;
    if (a === -1) return b;
    if (b === -1) return a;
    return a === b ? a : undefined;
  }
  return c !== -1 ? c : a;
}

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Jogador';
}

function say(room, entry) {
  room.seq++;
  room.log.push({ n: room.seq, ...entry });
  if (room.log.length > 12) room.log.shift();
}

export function createRoom(code, name, token, size) {
  if (size !== 2 && size !== 4) fail('Número de jogadores inválido');
  const seats = Array(size).fill(null);
  seats[0] = { name: cleanName(name), token, bot: false };
  return {
    code,
    v: 1,
    phase: 'lobby',
    size,
    seats,
    host: token,
    score: [0, 0],
    winner: null,
    dealer: 0,
    hand: null,
    handN: 0,
    lastTrick: null,
    log: [],
    seq: 0,
  };
}

function startMatch(room) {
  room.score = [0, 0];
  room.winner = null;
  room.phase = 'playing';
  room.lastTrick = null;
  room.dealer = randInt(room.size);
  startHand(room);
}

export function startHand(room, deck = shuffle(newDeck())) {
  room.dealer = (room.dealer + 1) % room.size;
  const hands = room.seats.map(() => deck.splice(0, 3));
  const vira = deck.shift();
  const first = (room.dealer + 1) % room.size;
  const [a, b] = room.score;
  const h = {
    n: ++room.handN,
    vira,
    manilha: RANKS[(RANKS.indexOf(vira[0]) + 1) % RANKS.length],
    hands,
    value: 1,
    bet: null,
    lastRaise: null,
    rounds: [],
    table: [],
    leader: first,
    turn: first,
    mao11: null,
    noTruco: false,
  };
  if (a === TARGET - 1 || b === TARGET - 1) {
    h.noTruco = true;
    if (a !== b) h.mao11 = { team: a === TARGET - 1 ? 0 : 1 };
  }
  room.hand = h;
}

function endHand(room, team, points, reason) {
  if (team >= 0) room.score[team] = Math.min(TARGET, room.score[team] + points);
  say(room, { t: 'hand', team, points: team >= 0 ? points : 0, reason });
  if (team >= 0 && room.score[team] >= TARGET) {
    room.phase = 'finished';
    room.winner = team;
    room.hand = null;
  } else {
    startHand(room);
  }
}

function playing(room) {
  if (room.phase !== 'playing' || !room.hand) fail('A partida não está em andamento');
  return room.hand;
}

function play(room, seat, card, hidden) {
  const h = playing(room);
  if (h.mao11) fail('Aguardando decisão da mão de onze');
  if (h.bet) fail('Responda ao pedido primeiro');
  if (h.turn !== seat) fail('Não é a sua vez');
  const idx = h.hands[seat].indexOf(card);
  if (idx < 0) fail('Você não tem essa carta');
  hidden = !!hidden;
  if (hidden && h.rounds.length === 0) fail('Não pode jogar coberta na primeira rodada');
  h.hands[seat].splice(idx, 1);
  h.table.push({ seat, card, hidden });
  if (h.table.length < room.size) {
    h.turn = (seat + 1) % room.size;
    return;
  }

  let best = -2;
  let bestSeats = [];
  for (const p of h.table) {
    const s = p.hidden ? -1 : strength(p.card, h.manilha);
    if (s > best) {
      best = s;
      bestSeats = [p.seat];
    } else if (s === best) bestSeats.push(p.seat);
  }
  const tie = new Set(bestSeats.map(teamOf)).size > 1;
  const winnerSeat = tie ? null : bestSeats[0];
  const winnerTeam = tie ? -1 : teamOf(winnerSeat);
  h.rounds.push(winnerTeam);
  room.lastTrick = { n: ++room.seq, cards: h.table, winnerSeat, winnerTeam };
  h.table = [];
  // Empatou: quem abriu a rodada abre de novo.
  h.leader = h.turn = winnerSeat ?? h.leader;
  const w = handWinner(h.rounds);
  if (w !== undefined) endHand(room, w, h.value, 'cards');
}

function canTruco(room, seat) {
  const h = room.hand;
  return (
    room.phase === 'playing' && h && !h.mao11 && !h.bet && h.turn === seat &&
    !h.noTruco && h.value < TARGET && h.lastRaise !== teamOf(seat)
  );
}

function truco(room, seat) {
  const h = playing(room);
  if (h.noTruco) fail('Não vale truco nesta mão');
  if (h.turn !== seat) fail('Só pode pedir na sua vez');
  if (!canTruco(room, seat)) fail('Você não pode pedir agora');
  h.bet = { seat, team: teamOf(seat), value: NEXT_VALUE[h.value] };
  say(room, { t: 'truco', seat, value: h.bet.value });
}

function respond(room, seat, answer) {
  const h = playing(room);
  const bet = h.bet;
  if (!bet) fail('Não há pedido para responder');
  if (teamOf(seat) === bet.team) fail('Quem responde é o adversário');
  if (answer === 'accept') {
    h.value = bet.value;
    h.lastRaise = bet.team;
    h.bet = null;
    say(room, { t: 'accept', seat, value: h.value });
  } else if (answer === 'run') {
    say(room, { t: 'run', seat });
    endHand(room, bet.team, h.value, 'run');
  } else if (answer === 'raise') {
    if (bet.value >= TARGET) fail('Não dá para aumentar mais');
    h.value = bet.value;
    h.bet = { seat, team: teamOf(seat), value: NEXT_VALUE[bet.value] };
    say(room, { t: 'truco', seat, value: h.bet.value });
  } else fail('Resposta inválida');
}

function decideMao11(room, seat, goes) {
  const h = playing(room);
  if (!h.mao11) fail('Não é mão de onze');
  if (teamOf(seat) !== h.mao11.team) fail('Quem decide é a dupla com 11');
  const team = h.mao11.team;
  if (goes) {
    h.mao11 = null;
    h.value = 3;
    say(room, { t: 'mao11', seat, goes: true });
  } else {
    say(room, { t: 'mao11', seat, goes: false });
    endHand(room, 1 - team, 1, 'mao11');
  }
}

// ---------------------------------------------------------------- bots

function power(h, seat) {
  let p = 0;
  for (const c of h.hands[seat]) {
    const s = strength(c, h.manilha);
    if (s >= 10) p += 3 + (s - 10) * 0.25;
    else if (s === 9) p += 2;
    else if (s === 8) p += 1.5;
    else if (s === 7) p += 1;
    else if (s === 6) p += 0.5;
  }
  return p + 2 * h.rounds.filter((r) => r === teamOf(seat)).length;
}

function botPlay(room, seat) {
  const h = room.hand;
  if (canTruco(room, seat)) {
    const p = power(h, seat);
    if ((p >= 4.5 && Math.random() < 0.5) || Math.random() < 0.05) return truco(room, seat);
  }
  const cards = [...h.hands[seat]].sort((x, y) => strength(x, h.manilha) - strength(y, h.manilha));
  let choice = cards[0];
  if (h.table.length === 0) {
    choice = cards[cards.length - 1];
  } else {
    let best = -2;
    let bestSeat = -1;
    for (const p of h.table) {
      const s = p.hidden ? -1 : strength(p.card, h.manilha);
      if (s > best) {
        best = s;
        bestSeat = p.seat;
      }
    }
    if (teamOf(bestSeat) !== teamOf(seat)) {
      choice = cards.find((c) => strength(c, h.manilha) > best) ?? cards[0];
    }
  }
  play(room, seat, choice, false);
}

function botAnswer(room, seat) {
  const h = room.hand;
  const p = power(h, seat);
  const need = { 3: 3, 6: 4.5, 9: 5.5, 12: 6.5 }[h.bet.value];
  if (p >= need + 2.5 && h.bet.value < TARGET) return respond(room, seat, 'raise');
  if (p >= need || Math.random() < 0.15) return respond(room, seat, 'accept');
  respond(room, seat, 'run');
}

function botStep(room) {
  if (room.phase !== 'playing') return false;
  const h = room.hand;
  const isBot = (s) => room.seats[s].bot;
  const teamSeats = (team) => room.seats.map((_, i) => i).filter((i) => teamOf(i) === team);
  if (h.mao11 || h.bet) {
    // Decisão de dupla: se houver humano na dupla, ele decide.
    const seats = teamSeats(h.mao11 ? h.mao11.team : 1 - h.bet.team);
    if (!seats.every(isBot)) return false;
    if (h.mao11) decideMao11(room, seats[0], Math.max(...seats.map((s) => power(h, s))) >= 3);
    else botAnswer(room, seats[0]);
    return true;
  }
  if (!isBot(h.turn)) return false;
  botPlay(room, h.turn);
  return true;
}

export function runBots(room) {
  for (let i = 0; i < 500 && botStep(room); i++);
}

// ---------------------------------------------------------------- ações

export function applyAction(room, body) {
  const token = body.token;
  const seat = room.seats.findIndex((s) => s && s.token === token);
  const isHost = room.host === token;
  const needSeat = () => (seat < 0 ? fail('Você não está nesta sala') : seat);
  const needHost = () => isHost || fail('Só quem criou a sala pode fazer isso');
  const lobby = () => room.phase === 'lobby' || fail('A partida já começou');
  const target = () => {
    const s = Number(body.seat);
    if (!Number.isInteger(s) || s < 0 || s >= room.size) fail('Lugar inválido');
    return s;
  };

  switch (body.action) {
    case 'join': {
      if (seat >= 0) {
        room.seats[seat].bot = false; // voltou depois de ser substituído por bot
        if (body.name) room.seats[seat].name = cleanName(body.name);
        break;
      }
      if (room.phase !== 'lobby') break; // entra como espectador
      const free = room.seats.indexOf(null);
      if (free < 0) fail('A sala está cheia');
      room.seats[free] = { name: cleanName(body.name), token, bot: false };
      break;
    }
    case 'sit': {
      lobby();
      const s = target();
      if (room.seats[s]) fail('Lugar ocupado');
      room.seats[s] = room.seats[needSeat()];
      room.seats[seat] = null;
      break;
    }
    case 'bot': {
      needHost();
      const s = target();
      if (room.phase === 'lobby') {
        if (!room.seats[s]) room.seats[s] = { name: `Bot ${s + 1}`, token: null, bot: true };
        else if (room.seats[s].bot) room.seats[s] = null;
        else fail('Lugar ocupado');
      } else {
        // No meio do jogo: um bot assume o lugar de quem saiu (a pessoa pode voltar).
        if (!room.seats[s] || room.seats[s].token === token) fail('Lugar inválido');
        room.seats[s].bot = true;
      }
      break;
    }
    case 'leave': {
      lobby();
      room.seats[needSeat()] = null;
      if (isHost) {
        const next = room.seats.find((s) => s && !s.bot);
        if (next) room.host = next.token;
      }
      break;
    }
    case 'start':
      needHost();
      lobby();
      if (room.seats.includes(null)) fail('Faltam jogadores');
      if (!room.seats.some((s) => !s.bot)) fail('Precisa de pelo menos uma pessoa na mesa');
      startMatch(room);
      break;
    case 'rematch':
      needHost();
      if (room.phase !== 'finished') fail('A partida ainda não acabou');
      startMatch(room);
      break;
    case 'play':
      play(room, needSeat(), String(body.card), body.hidden);
      break;
    case 'truco':
      truco(room, needSeat());
      break;
    case 'respond':
      respond(room, needSeat(), body.answer);
      break;
    case 'mao11':
      decideMao11(room, needSeat(), !!body.goes);
      break;
    default:
      fail('Ação desconhecida');
  }
}

// O que cada jogador pode ver: nunca as cartas dos outros nem os tokens.
export function viewFor(room, token) {
  const me = room.seats.findIndex((s) => s && s.token === token);
  const h = room.hand;
  const mask = (p) => ({ seat: p.seat, hidden: p.hidden, card: p.hidden ? null : p.card });
  const seesPartner = h && h.mao11 && me >= 0 && room.size === 4 && teamOf(me) === h.mao11.team;
  return {
    code: room.code,
    v: room.v,
    phase: room.phase,
    size: room.size,
    me,
    isHost: room.host === token,
    seats: room.seats.map((s) => s && { name: s.name, bot: s.bot }),
    score: room.score,
    winner: room.winner,
    dealer: room.dealer,
    hand: h && {
      n: h.n,
      vira: h.vira,
      manilha: h.manilha,
      value: h.value,
      bet: h.bet,
      lastRaise: h.lastRaise,
      rounds: h.rounds,
      table: h.table.map(mask),
      turn: h.turn,
      noTruco: h.noTruco,
      mao11: h.mao11,
      counts: h.hands.map((c) => c.length),
      mine: me >= 0 ? h.hands[me] : [],
      partner: seesPartner ? h.hands[(me + 2) % 4] : null,
    },
    lastTrick: room.lastTrick && { ...room.lastTrick, cards: room.lastTrick.cards.map(mask) },
    log: room.log,
  };
}

// store: { get(code) -> {state, version} | null, insert(code, state) -> bool,
//          update(code, state, expectedVersion) -> bool }
export async function handleRequest(body, store) {
  try {
    if (!body || typeof body !== 'object') fail('Requisição inválida');
    const token = body.token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 64) fail('Token inválido');

    if (body.action === 'create') {
      for (let i = 0; i < 6; i++) {
        const room = createRoom(randomCode(), body.name, token, Number(body.size));
        if (await store.insert(room.code, room)) {
          return { ok: true, code: room.code, state: viewFor(room, token) };
        }
      }
      fail('Não foi possível criar a sala, tente de novo');
    }

    const code = String(body.code ?? '').toUpperCase().trim();
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await store.get(code);
      if (!rec) fail('Sala não encontrada');
      const room = rec.state;
      if (body.action === 'state') {
        if (body.v === room.v) return { ok: true, same: true };
        return { ok: true, state: viewFor(room, token) };
      }
      applyAction(room, body);
      runBots(room);
      room.v++;
      if (await store.update(code, room, rec.version)) {
        return { ok: true, changed: true, code, state: viewFor(room, token) };
      }
    }
    fail('Muita gente jogando ao mesmo tempo, tente de novo');
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}
