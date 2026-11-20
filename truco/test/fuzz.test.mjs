// Fuzzing: jogadores (e um intruso) mandando ações aleatórias, válidas ou não.
// O servidor nunca pode quebrar, vazar cartas ou sair de um estado coerente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, newDeck, strength } from '../supabase/functions/truco/game.js';

const tok = (i) => `token-fuzz-jogador-${i}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const DECK = newDeck();
const JUNK = [undefined, null, '', 'xx', '4o', 'ZZ', -1, 0, 1, 2, 3, 99, 1.5, NaN, {}, [], true, '__proto__', 'constructor'];

function memStore() {
  const rooms = new Map();
  return {
    rooms,
    get: async (c) => (rooms.has(c) ? { state: structuredClone(rooms.get(c)), version: rooms.get(c).v } : null),
    insert: async (c, s) => !rooms.has(c) && !!rooms.set(c, structuredClone(s)),
    update: async (c, s, e) => rooms.get(c).v === e && !!rooms.set(c, structuredClone(s)),
  };
}

function check(room, views) {
  assert.ok(room.score.every((s) => Number.isInteger(s) && s >= 0 && s <= 12), 'placar fora da faixa');
  assert.ok(['lobby', 'playing', 'finished'].includes(room.phase));
  if (room.phase === 'finished') {
    assert.equal(room.score[room.winner], 12);
    assert.equal(room.hand, null);
  }
  if (room.phase !== 'lobby') assert.ok(!room.seats.includes(null), 'lugar vago no meio do jogo');
  const h = room.hand;
  if (room.phase === 'playing') {
    assert.ok(h, 'jogando sem mão');
    assert.ok(Math.max(...room.score) < 12);
    const played = h.rounds.length;
    assert.ok(played <= 2, 'mão devia ter acabado');
    const all = [...h.hands.flat(), ...h.table.map((p) => p.card), h.vira];
    assert.equal(new Set(all).size, all.length, 'carta duplicada');
    assert.ok(all.every((c) => DECK.includes(c)), 'carta inexistente');
    assert.ok([1, 3, 6, 9, 12].includes(h.value));
    assert.ok(h.turn >= 0 && h.turn < room.size);
    assert.ok(h.table.length < room.size);
    // cada um jogou `played` cartas, mais uma se já jogou nesta rodada
    room.seats.forEach((_, i) => {
      const inTable = h.table.some((p) => p.seat === i) ? 1 : 0;
      assert.equal(h.hands[i].length, 3 - played - inTable, 'número de cartas na mão');
    });
    assert.ok(h.hands[h.turn].length > 0, 'vez de quem não tem carta');
    assert.ok(!h.table.some((p) => p.seat === h.turn), 'vez de quem já jogou');
    if (h.bet) {
      assert.ok(h.bet.value > h.value && h.bet.value <= 12);
      assert.ok(!h.noTruco && !h.mao11);
    }
    if (h.noTruco) assert.ok(room.score.includes(11));
    if (h.mao11) assert.equal(room.score[h.mao11.team], 11);
    // ninguém fica travado: sempre há um humano de quem se espera uma ação
    const waiting = h.mao11 ? room.seats.filter((_, i) => i % 2 === h.mao11.team)
      : h.bet ? room.seats.filter((_, i) => i % 2 !== h.bet.team) : [room.seats[h.turn]];
    assert.ok(waiting.some((s) => !s.bot), 'jogo esperando por um bot');
  }
  // visões: sem tokens, sem cartas dos outros
  for (const [i, v] of views.entries()) {
    const txt = JSON.stringify(v);
    assert.ok(!txt.includes('token-fuzz'), 'token vazou');
    if (!h || !v.hand) continue;
    const allowed = new Set([h.vira, ...h.table.filter((p) => !p.hidden).map((p) => p.card),
      ...(room.lastTrick?.cards ?? []).filter((p) => !p.hidden).map((p) => p.card),
      ...(v.me >= 0 ? h.hands[v.me] : []), ...(v.hand.partner ?? [])]);
    if (v.hand.partner) assert.ok(h.mao11 && v.me % 2 === h.mao11.team && room.size === 4);
    const cardsTxt = JSON.stringify({ ...v, seats: null }); // nomes podem parecer cartas
    for (const c of DECK) if (!allowed.has(c)) assert.ok(!cardsTxt.includes(`"${c}"`), `jogador ${i} viu ${c}`);
  }
}

test('fuzz: ações aleatórias e inválidas mantêm o jogo coerente', async () => {
  let finished = 0, accepted = 0, rejected = 0;
  for (let g = 0; g < 400; g++) {
    const store = memStore();
    const size = pick([2, 4]);
    const created = await handleRequest({ action: 'create', token: tok(0), name: pick(['Zé', '', '<img onerror=x>', 'a'.repeat(99), 7]), size }, store);
    assert.ok(created.ok);
    const code = created.code;
    const players = size + 1; // o último é um intruso/espectador
    const smart = Math.random() < 0.7; // parte das partidas joga "direito" para chegar ao fim
    for (let step = 0; step < 1500; step++) {
      const room = store.rooms.get(code);
      const h = room.hand;
      const i = Math.floor(Math.random() * players);
      const seat = room.seats.findIndex((s) => s && s.token === tok(i));
      let body;
      if (room.phase === 'lobby') {
        body = pick([
          { action: 'join', name: `P${i}` }, { action: 'join', name: `P${i}` }, { action: 'sit', seat: pick(JUNK) },
          { action: 'bot', seat: pick([0, 1, 2, 3, pick(JUNK)]) }, { action: 'leave' }, { action: 'start' }, { action: 'start' },
          { action: 'play', card: '4o' }, { action: 'rematch' },
        ]);
      } else if (smart && h && Math.random() < 0.85) {
        if (h.mao11) body = { action: 'mao11', goes: Math.random() < 0.6 };
        else if (h.bet) body = { action: 'respond', answer: pick(['accept', 'accept', 'run', 'raise']) };
        else if (Math.random() < 0.15) body = { action: 'truco' };
        else body = { action: 'play', card: pick(seat >= 0 && h.hands[seat].length ? h.hands[seat] : DECK), hidden: Math.random() < 0.15 };
      } else {
        body = pick([
          { action: 'play', card: pick([...DECK, ...JUNK]), hidden: pick(JUNK) }, { action: 'truco' },
          { action: 'respond', answer: pick(['accept', 'run', 'raise', ...JUNK]) }, { action: 'mao11', goes: pick(JUNK) },
          { action: 'bot', seat: pick([0, 1, 2, 3, ...JUNK]) }, { action: 'join', name: pick(JUNK) }, { action: 'sit', seat: 1 },
          { action: 'leave' }, { action: 'start' }, { action: 'rematch' }, { action: pick(JUNK) }, { action: 'state', v: pick(JUNK) },
        ]);
      }
      const before = JSON.stringify(room);
      const res = await handleRequest({ ...body, code: pick([code, code, code, code.toLowerCase()]), token: tok(i) }, store);
      const after = store.rooms.get(code);
      if (res.ok) accepted++;
      else {
        rejected++;
        assert.equal(typeof res.error, 'string');
        assert.equal(JSON.stringify(after), before, `ação recusada alterou a sala: ${JSON.stringify(body)}`);
      }
      const views = [];
      for (let p = 0; p < players; p++) views.push((await handleRequest({ action: 'state', code, token: tok(p) }, store)).state);
      try {
        check(after, views);
      } catch (e) {
        e.message += `\napós ${JSON.stringify(body)} do jogador ${i}\nsala: ${JSON.stringify(after)}`;
        throw e;
      }
      if (after.phase === 'finished') {
        finished++;
        if (Math.random() < 0.5) break;
      }
    }
  }
  console.log({ finished, accepted, rejected });
  assert.ok(finished > 50, 'poucas partidas chegaram ao fim');
});

test('requisições malformadas são recusadas sem quebrar', async () => {
  const store = memStore();
  for (const body of [null, undefined, 1, 'x', [], {}, { token: 1 }, { token: 'curto' }, { token: 'x'.repeat(200), action: 'create' },
    { token: tok(1), action: 'create', size: 3 }, { token: tok(1), action: 'create', size: '4x' }, { token: tok(1), action: 'state' },
    { token: tok(1), action: 'join', code: {} }, { token: tok(1), action: 'join', code: 'NADA' }, { token: tok(1) }]) {
    const res = await handleRequest(body, store);
    assert.equal(res.ok, false, JSON.stringify(body));
  }
  assert.equal(store.rooms.size, 0);
});

test('a carta mais forte sempre leva a rodada', () => {
  for (const m of ['4', '7', 'Q', '3']) {
    const sorted = [...DECK].sort((a, b) => strength(a, m) - strength(b, m));
    assert.deepEqual(sorted.slice(-4).map((c) => c), [m + 'o', m + 'e', m + 'c', m + 'p']);
  }
});
