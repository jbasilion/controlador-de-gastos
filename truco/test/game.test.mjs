import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handWinner, strength, handleRequest, createRoom, startHand, applyAction, viewFor, newDeck,
} from '../supabase/functions/truco/game.js';

const tok = (i) => `token-jogador-000${i}`;

function memStore() {
  const rooms = new Map();
  return {
    rooms,
    async get(code) {
      const r = rooms.get(code);
      return r ? { state: structuredClone(r), version: r.v } : null;
    },
    async insert(code, state) {
      if (rooms.has(code)) return false;
      rooms.set(code, structuredClone(state));
      return true;
    },
    async update(code, state, expected) {
      if (rooms.get(code).v !== expected) return false;
      rooms.set(code, structuredClone(state));
      return true;
    },
  };
}

test('força das cartas e manilhas', () => {
  assert.ok(strength('3o', '5') > strength('2p', '5'));
  assert.ok(strength('4o', '5') < strength('7p', '5'));
  assert.ok(strength('5o', '5') > strength('3p', '5'));
  assert.ok(strength('5p', '5') > strength('5c', '5'));
  assert.ok(strength('5c', '5') > strength('5e', '5'));
  assert.ok(strength('5e', '5') > strength('5o', '5'));
});

test('vencedor da mão', () => {
  assert.equal(handWinner([0]), undefined);
  assert.equal(handWinner([0, 0]), 0);
  assert.equal(handWinner([0, 1]), undefined);
  assert.equal(handWinner([0, 1, 1]), 1);
  assert.equal(handWinner([-1, 1]), 1);
  assert.equal(handWinner([0, -1]), 0);
  assert.equal(handWinner([-1, -1]), undefined);
  assert.equal(handWinner([-1, -1, 1]), 1);
  assert.equal(handWinner([-1, -1, -1]), -1);
  assert.equal(handWinner([1, 0, -1]), 1);
});

function fixedRoom(size, cards, vira) {
  const room = createRoom('TEST', 'A', tok(0), size);
  for (let i = 1; i < size; i++) room.seats[i] = { name: `P${i}`, token: tok(i), bot: false };
  room.phase = 'playing';
  room.dealer = size - 1; // startHand avança: dealer 0, quem abre é o lugar 1
  const rest = newDeck().filter((c) => !cards.flat().includes(c) && c !== vira);
  startHand(room, [...cards.flat(), vira, ...rest]);
  return room;
}
const act = (room, seat, action, extra = {}) => applyAction(room, { action, token: tok(seat), ...extra });

test('truco aceito, mão vale 3 e quem corre perde o valor atual', () => {
  const room = fixedRoom(2, [['3o', '2o', '4p'], ['Ao', 'Ko', '4e']], '7c');
  assert.equal(room.hand.turn, 1);
  assert.throws(() => act(room, 0, 'truco'), /sua vez/);
  act(room, 1, 'truco');
  assert.throws(() => act(room, 1, 'play', { card: 'Ao' }), /Responda/);
  act(room, 0, 'respond', { answer: 'raise' }); // seis
  assert.equal(room.hand.value, 3);
  act(room, 1, 'respond', { answer: 'run' });
  assert.deepEqual(room.score, [3, 0]);
  assert.equal(room.hand.n, 2);
});

test('rodadas, carta coberta e visão sem cartas alheias', () => {
  const room = fixedRoom(2, [['3o', '2o', '4p'], ['Ao', 'Ko', '4e']], '7c');
  assert.throws(() => act(room, 1, 'play', { card: 'Ao', hidden: true }), /coberta/);
  act(room, 1, 'play', { card: 'Ao' });
  const v = viewFor(room, tok(0));
  assert.deepEqual(v.hand.mine, ['3o', '2o', '4p']);
  assert.deepEqual(v.hand.counts, [3, 2]);
  assert.ok(!JSON.stringify(v).includes('Ko') && !JSON.stringify(v).includes('token'));
  act(room, 0, 'play', { card: '3o' });
  assert.deepEqual(room.hand.rounds, [0]);
  assert.equal(room.hand.turn, 0);
  act(room, 0, 'play', { card: '4p', hidden: true });
  assert.equal(viewFor(room, tok(1)).hand.table[0].card, null);
  act(room, 1, 'play', { card: '4e' });
  assert.deepEqual(room.hand.rounds, [0, 1]);
  act(room, 1, 'play', { card: 'Ko' });
  act(room, 0, 'play', { card: '2o' });
  assert.deepEqual(room.score, [1, 0]);
});

test('mão de onze', () => {
  const room = fixedRoom(4, [['3o', '2o', '4p'], ['Ao', 'Ko', '4e'], ['3p', '2p', '4c'], ['Ac', 'Kc', '5e']], '7c');
  room.score = [11, 5];
  room.dealer = 3;
  startHand(room);
  assert.deepEqual(room.hand.mao11, { team: 0 });
  assert.ok(viewFor(room, tok(0)).hand.partner);
  assert.equal(viewFor(room, tok(1)).hand.partner, null);
  assert.throws(() => act(room, 1, 'mao11', { goes: true }), /dupla/);
  act(room, 2, 'mao11', { goes: false });
  assert.deepEqual(room.score, [11, 6]);
});

test('partidas inteiras com bots e jogadas aleatórias terminam em 12', async () => {
  for (let g = 0; g < 150; g++) {
    const store = memStore();
    const size = g % 2 ? 4 : 2;
    const { code } = await handleRequest({ action: 'create', token: tok(0), name: 'Zé', size }, store);
    const call = (i, action, extra) => handleRequest({ action, code, token: tok(i), ...extra }, store);
    if (size === 4) {
      assert.ok((await call(1, 'join', { name: 'Ana' })).ok);
      assert.ok((await call(0, 'bot', { seat: 2 })).ok);
      assert.ok((await call(0, 'bot', { seat: 3 })).ok);
    } else {
      assert.ok((await call(0, 'bot', { seat: 1 })).ok);
    }
    assert.ok((await call(0, 'start')).ok);
    const humans = size === 4 ? [0, 1] : [0];
    let steps = 0;
    for (;;) {
      assert.ok(++steps < 3000, 'partida não termina');
      const room = store.rooms.get(code);
      if (room.phase === 'finished') break;
      const h = room.hand;
      assert.equal(new Set([...h.hands.flat(), ...h.table.map((p) => p.card), h.vira]).size,
        h.hands.flat().length + h.table.length + 1);
      let moved = false;
      for (const i of humans) {
        let r;
        if (h.mao11) r = await call(i, 'mao11', { goes: Math.random() < 0.7 });
        else if (h.bet) r = await call(i, 'respond', { answer: ['accept', 'run', 'raise'][Math.floor(Math.random() * 3)] });
        else if (h.turn === i) {
          r = Math.random() < 0.2
            ? await call(i, 'truco')
            : await call(i, 'play', { card: h.hands[i][0], hidden: h.rounds.length > 0 && Math.random() < 0.1 });
        }
        if (r?.ok) { moved = true; break; }
      }
      if (!moved && !humans.includes(h.turn) && !h.bet && !h.mao11) assert.fail('bot travou');
    }
    const room = store.rooms.get(code);
    assert.equal(Math.max(...room.score), 12);
    assert.equal(room.score[room.winner], 12);
  }
});
