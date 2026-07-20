# Arquitetura de Produção do Player — Decisões

Evolução do player (`src/player/player.js`) de MVP para nível de produção.
Nenhum comportamento existente foi alterado; tudo abaixo é infraestrutura
adicional de resiliência, performance e observabilidade.

## 1. Preload concorrente com fila de prioridade (`preloadScheduler`)

- **Antes**: resolução sequencial, 1 faixa por vez, 600ms entre requests.
- **Agora**: até `PRELOAD_CONCURRENCY = 3` resoluções simultâneas com stagger
  de `250ms` entre inícios (evita rajadas/429 na API).
- **Prioridades**: P0 = faixa atual · P1 = próximas 3 · P2 = próximas 10 ·
  P3 = restante. Buckets simples (arrays por prioridade), dequeue do menor.
- **Reprioritização dinâmica**: `reprioritizeAround(index)` é chamado em
  `playTrackInternal` — ao pular para qualquer faixa, os jobs pendentes são
  redistribuídos ao redor dela.
- **Cancelamento**: token `generation` incrementado a cada novo lote; jobs
  antigos são descartados ao acordar. Também aborta se `state.currentPlaylist`
  mudou (mesma semântica do código anterior).
- **Compatibilidade**: `preloadTracksInBackground(tracks, playlistId)` mantém
  a mesma assinatura/Promise; os 3 call sites existentes não mudaram.
- A UI já atualiza por faixa (duração/indisponível) via `preloadSingleTrack`,
  que foi mantido intacto.

## 2. Cache persistente em IndexedDB

- **DB**: `hyperfitness-player` v1, stores `audio` e `covers`. Todas as
  operações são fire-and-forget com `try/catch`; sem IndexedDB (ex: Safari
  privado) o player degrada para o comportamento atual sem erros.
- **Store `audio`** (por `trackKey`): `videoId`, `audioUrl`, `source`,
  `lengthSeconds`, `thumbnail`, `foursharedFileId`, `audioExpiresAt` (10min,
  igual ao TTL em memória), `expiresAt` (7 dias) e `savedAt`.
- **TTLs em dois níveis** (decisão central): URLs do googlevideo expiram em
  minutos, mas o **videoId não expira**. Ao reabrir o app:
  - `audioUrl` válida → reprodução imediata sem rede (origem `cache-persistente`);
  - `audioUrl` expirada → o `videoId` persistido é aplicado como preset,
    **pulando a busca no YouTube** (etapa mais cara); só o `/audio` é refeito;
  - fonte 4shared → `foursharedFileId` restaurado, caindo no caminho sticky
    existente (sem rede: a stream URL do proxy é reconstruída localmente).
- **Hidratação**: `hydratePersistentCaches()` no `init`, com teto de 1.5s
  (`Promise.race`) para nunca atrasar a UI; validação de expiração e prune
  continuam em background (máx. 800 resoluções / 1500 capas, LRU por `savedAt`).
- **Hints em `Map` separada** (`persistentResolveHints`), não no `searchCache`:
  sobrevivem ao `searchCache.clear()` executado a cada troca de playlist.
- **Invalidação**: `markTrackUnavailable` remove a entrada (memória + IDB).
- **Store `covers`**: persiste apenas URLs http reais (nunca SVGs de fallback),
  com `deezerId` e `resolution` extraídos da própria URL, TTL de 7 dias.
  Integrado nos wrappers `get/setCoverCache` — zero mudanças em
  `buscarCapaFaixa`/`buscarCapaPlaylist`.

## 3. Retry inteligente (`getAudioUrl`)

- **Backoff exponencial com jitter**: `backoffDelay(attempt)` = 1s→2s→4s→8s
  com jitter de 50–100% (evita retries sincronizados de jobs concorrentes).
- **Erros transitórios** (retry, máx. 4): HTTP 202 (conversão), 429 (rate
  limit), 5xx, `reason` retryable do backend, erros de rede/timeout.
- **Erros permanentes** (NUNCA retry): `video-not-found`, `video-private`,
  `geo-blocked`, `video-blocked`, `extraction-failed`, `video-too-long`.
  Registrados em `permanentAudioFailures` (por `videoId`, escopo de sessão)
  — chamadas subsequentes falham imediatamente sem tocar a rede e o fluxo
  degrada direto para o fallback 4shared.

## 4. Circuit breaker da API `/audio` (`audioCircuit`)

- **Estados**: `closed → open → half-open → closed`, com logs `🔌 [CIRCUIT]`.
- **Abre** após 5 falhas de **infraestrutura** consecutivas (5xx, rede, 429).
  Erros específicos de vídeo (not-found etc.) **não** contam — indicam vídeo
  ruim, não API doente; nesses casos o contador é zerado (API respondeu).
- **Aberto**: `getAudioUrl` falha imediatamente (sem rede) e o
  `resolveTrackAudio` cai no fallback 4shared/cache — degradação graciosa.
- **Half-open**: após 30s permite 1 sonda; sucesso fecha o circuito, falha
  reabre dobrando a espera (até 4min).

## 5. Matching 4shared aprimorado

- **Score combinado** (`textSimilarity`): `max(Dice_tokens, (Levenshtein +
  Jaro-Winkler)/2)`. Dice cobre reordenação de palavras ("Artista Título" vs
  "Título Artista"); o par char-level cobre typos/grafias. `max` porque cada
  família cobre a fraqueza da outra; a média interna exige concordância entre
  os dois algoritmos char-level.
- **Palavras proibidas** (rejeição automática, não mais penalidade): cover,
  karaoke, instrumental, slowed, reverb, nightcore, bass boosted, remix,
  extended, radio edit, live, ao vivo, demo, sped up, 8d, acapella, tribute,
  ringtone, parody. Com word-boundary (sem falsos positivos: "Deliverance"
  não dispara "live"). Exceção: termo presente no próprio título pedido.
- **Gate de artista**: `artistSim < 40%` ⇒ rejeição imediata, mesmo com
  título 100% — jamais tocar a mesma música de outro artista.
- **Duração** (quando disponível): diff ≤5s = 1.0 decaindo até 0 em 60s;
  pesos passam a título 50% / artista 30% / duração 20% (sem duração:
  60/40 como antes). O backend 4shared hoje não retorna duração; o campo
  `file.duration` já é lido para quando existir.
- Thresholds de aceite mantidos: score ≥ 80% e título ≥ 60%.

## 6. Observabilidade

- **Métricas** (`MUSIC_PLAYER.getMetrics()` no console): % resoluções por
  origem (API/cache/fallback), falhas e falhas permanentes, retries, tempo
  médio de resolução, tempo médio por lote de preload, tempo até a primeira
  música da sessão, taxa de aceite do 4shared, hit-ratio dos caches de áudio
  e capas, e transições do circuit breaker.
- **Logs agrupados por faixa**: cada resolução imprime um único
  `console.groupCollapsed` — `🎵 [AUDIO] "nome" · ok · origem=api · 1234ms` —
  contendo track/artista, eventos de YouTube, retries, fallback, cache,
  origem, resultado e tempo total. Eventos de `getAudioUrl` entram no grupo
  via contexto opcional (`ctx.log`), mantendo compatibilidade com outros
  chamadores.

## Testes

- `tests/player-matching.test.mjs` — extrai as funções **reais** do
  `player.js` (matching, similaridades, backoff) e valida 16 casos:
  typos, reordenação, palavras proibidas, word-boundaries, artista
  divergente, duração e limites do jitter.
- Rodar: `node tests/player-matching.test.mjs`
