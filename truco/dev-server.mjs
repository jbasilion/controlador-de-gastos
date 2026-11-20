// Servidor local para desenvolvimento: serve public/ e a mesma lógica da Edge
// Function em /api, guardando as salas em memória.  Uso: npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './supabase/functions/truco/game.js';

const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const rooms = new Map();
const store = {
  get: async (code) => (rooms.has(code) ? { state: structuredClone(rooms.get(code)), version: rooms.get(code).v } : null),
  insert: async (code, state) => !rooms.has(code) && !!rooms.set(code, structuredClone(state)),
  update: async (code, state, expected) => rooms.get(code).v === expected && !!rooms.set(code, structuredClone(state)),
};

http.createServer(async (req, res) => {
  const send = (status, type, body) => res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      return send(200, 'application/json', JSON.stringify(await handleRequest(JSON.parse(raw), store)));
    }
    if (path === '/config.js') return send(200, 'text/javascript', "window.TRUCO_CONFIG = { api: '/api' };");
    const file = normalize(join(PUBLIC, path === '/' ? 'index.html' : path));
    if (!file.startsWith(PUBLIC)) return send(403, 'text/plain', 'forbidden');
    send(200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch (e) {
    send(e.code === 'ENOENT' ? 404 : 500, 'text/plain', String(e.message));
  }
}).listen(process.env.PORT || 3000, () => console.log(`Truco em http://localhost:${process.env.PORT || 3000}`));
