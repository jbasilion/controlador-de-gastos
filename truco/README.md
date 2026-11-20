# Truco Online

Truco paulista (baralho de 40 cartas, vira e manilhas) para jogar com os amigos
pelo navegador: 1 contra 1 ou em duplas, com bots para completar a mesa.

- `public/` — site estático (publicado na Vercel).
- `supabase/functions/truco/` — Edge Function do Supabase com todas as regras.
  O servidor é quem embaralha e guarda as cartas; cada jogador só recebe a
  própria mão. As salas ficam na tabela `truco_rooms` (sem acesso público).
- `public/config.js` — URL e chave pública do projeto Supabase.

## Rodando local

    npm run dev    # http://localhost:3000, salas em memória
    npm test

## Regras implementadas

Melhor de três rodadas; empate na primeira dá a mão a quem ganhar a segunda,
empate depois dá a mão a quem ganhou a primeira. Truco → seis → nove → doze,
pedido só na sua vez e nunca duas vezes seguidas pela mesma dupla. Carta
coberta a partir da segunda rodada. Mão de onze (a dupla vê as cartas e decide
se joga valendo 3) e mão de ferro (11 a 11, sem truco). Partida até 12 pontos.
