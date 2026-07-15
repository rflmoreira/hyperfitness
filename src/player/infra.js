/**
 * HyperFitness Player Infrastructure Module
 *
 * Componentes de produção para resiliência, performance e observabilidade:
 * - PersistentCache: cache IndexedDB com expiração automática
 * - PriorityQueue: fila de tarefas concorrentes com prioridade dinâmica
 * - CircuitBreaker: disjuntor para APIs externas
 * - retryWithBackoff: retry exponencial com jitter
 * - MetricsCollector: métricas em tempo real
 * - TrackLogger: logs agrupados por faixa
 * - levenshteinDistance / jaroWinklerSimilarity: algoritmos de similaridade
 *
 * Exposto em window.HFInfra para uso pelo player.js (script tradicional, sem ES modules).
 */
(function () {
  'use strict';

  if (window.HFInfra) return;

  // ================================================================
  // String similarity algorithms
  // ================================================================

  /**
   * Distância de Levenshtein entre duas strings.
   * Usa programação dinâmica com duas linhas (O(n*m) tempo, O(min(n,m)) espaço).
   */
  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const s = a.length <= b.length ? a : b;
    const l = a.length <= b.length ? b : a;
    let prev = new Array(s.length + 1);
    let curr = new Array(s.length + 1);

    for (let i = 0; i <= s.length; i++) prev[i] = i;

    for (let j = 1; j <= l.length; j++) {
      curr[0] = j;
      for (let i = 1; i <= s.length; i++) {
        const cost = s[i - 1] === l[j - 1] ? 0 : 1;
        curr[i] = Math.min(
          prev[i] + 1,        // deletion
          curr[i - 1] + 1,    // insertion
          prev[i - 1] + cost  // substitution
        );
      }
      [prev, curr] = [curr, prev];
    }
    return prev[s.length];
  }

  /**
   * Similaridade normalizada de Levenshtein (0..1, onde 1 = idêntico).
   */
  function levenshteinSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - (levenshteinDistance(a, b) / maxLen);
  }

  /**
   * Similaridade Jaro-Winkler (0..1).
   * Dá peso extra para prefixos comuns — ideal para títulos de músicas.
   */
  function jaroWinklerSimilarity(s1, s2) {
    if (!s1 && !s2) return 1;
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const jaro = _jaroScore(s1, s2);
    // Winkler prefix bonus: até 4 caracteres comuns no início
    let prefix = 0;
    const maxPrefix = Math.min(4, s1.length, s2.length);
    for (let i = 0; i < maxPrefix && s1[i] === s2[i]; i++) prefix++;

    return jaro + (prefix * 0.1 * (1 - jaro));
  }

  function _jaroScore(s1, s2) {
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    let matches = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDist);
      const end = Math.min(i + matchDist + 1, len2);
      for (let j = start; j < end; j++) {
        if (s2Matches[j]) continue;
        if (s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const m = matches;
    return (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3;
  }

  // ================================================================
  // PersistentCache — IndexedDB com expiração automática
  // ================================================================

  const DB_NAME = 'hyperfitness-player';
  const DB_VERSION = 1;
  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('covers')) {
          db.createObjectStore('covers', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  class PersistentCache {
    constructor(storeName) {
      this.storeName = storeName;
      this._writeQueue = new Map();
      this._writeTimer = null;
      this._flushDelay = 2000;
    }

    async _getStore(mode) {
      const db = await openDB();
      return db.transaction(this.storeName, mode).objectStore(this.storeName);
    }

    async get(key) {
      try {
        const store = await this._getStore('readonly');
        return await new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return null;
      }
    }

    async set(key, value, ttlMs) {
      const entry = {
        key,
        value,
        expiresAt: Date.now() + (ttlMs || 0),
        timestamp: Date.now()
      };
      // Batch writes to avoid overwhelming IndexedDB
      this._writeQueue.set(key, entry);
      this._scheduleFlush();
    }

    _scheduleFlush() {
      if (this._writeTimer) return;
      this._writeTimer = setTimeout(() => this._flush(), this._flushDelay);
    }

    async _flush() {
      this._writeTimer = null;
      const batch = new Map(this._writeQueue);
      this._writeQueue.clear();
      if (!batch.size) return;
      try {
        const db = await openDB();
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        for (const entry of batch.values()) {
          store.put(entry);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        // Silencioso: cache persistente é best-effort
      }
    }

    async delete(key) {
      try {
        const store = await this._getStore('readwrite');
        return await new Promise((resolve, reject) => {
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // Silencioso
      }
    }

    async flush() {
      if (this._writeTimer) {
        clearTimeout(this._writeTimer);
        this._writeTimer = null;
      }
      await this._flush();
    }

    isExpired(entry) {
      if (!entry || !entry.expiresAt) return true;
      return Date.now() > entry.expiresAt;
    }
  }

  // ================================================================
  // PriorityQueue — fila concorrente com prioridade dinâmica
  // ================================================================

  class PriorityQueue {
    /**
     * @param {number} concurrency - máximo de tarefas simultâneas
     */
    constructor(concurrency = 4) {
      this.concurrency = concurrency;
      this._queue = [];
      this._running = 0;
      this._cancelled = new WeakSet();
    }

    /**
     * Adiciona uma tarefa à fila.
     * @param {Function} fn - função async que retorna o resultado
     * @param {number} priority - menor = maior prioridade (default 10)
     * @param {string} id - identificador para cancelamento (opcional)
     * @returns {Promise} - resolve quando a tarefa completa
     */
    add(fn, priority = 10, id = null) {
      return new Promise((resolve, reject) => {
        const task = { fn, priority, id, resolve, reject, seq: this._queue.length };
        this._queue.push(task);
        this._queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
        this._drain();
      });
    }

    /**
     * Cancela todas as tarefas pendentes com o id dado.
     * Tarefas em execução não são interrompidas.
     */
    cancelById(id) {
      if (!id) return;
      const remaining = [];
      for (const task of this._queue) {
        if (task.id === id) {
          task.reject(new Error('cancelled'));
        } else {
          remaining.push(task);
        }
      }
      this._queue = remaining;
    }

    /**
     * Re-prioriza tarefas pendentes: tarefas cujo id está em priorityIds
     * recebem a prioridade especificada.
     * @param {Map<string, number>} priorityMap - id -> nova prioridade
     */
    reprioritize(priorityMap) {
      if (!priorityMap || !priorityMap.size) return;
      let changed = false;
      for (const task of this._queue) {
        if (task.id && priorityMap.has(task.id)) {
          task.priority = priorityMap.get(task.id);
          changed = true;
        }
      }
      if (changed) {
        this._queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      }
    }

    get pending() { return this._queue.length; }
    get running() { return this._running; }

    _drain() {
      while (this._running < this.concurrency && this._queue.length > 0) {
        const task = this._queue.shift();
        this._running++;
        task.fn()
          .then(task.resolve)
          .catch(task.reject)
          .finally(() => {
            this._running--;
            this._drain();
          });
      }
    }
  }

  // ================================================================
  // CircuitBreaker — disjuntor para APIs externas
  // ================================================================

  class CircuitBreaker {
    /**
     * @param {Object} opts
     * @param {number} opts.failureThreshold - falhas para abrir (default 8)
     * @param {number} opts.failureRateThreshold - taxa de falha para abrir (0..1, default 0.5)
     * @param {number} opts.minCalls - mínimo de chamadas antes de avaliar (default 10)
     * @param {number} opts.openDurationMs - tempo aberto antes de half-open (default 30s)
     * @param {number} opts.halfOpenMaxCalls - chamadas de teste em half-open (default 3)
     */
    constructor(opts = {}) {
      this.failureThreshold = opts.failureThreshold || 8;
      this.failureRateThreshold = opts.failureRateThreshold || 0.5;
      this.minCalls = opts.minCalls || 10;
      this.openDurationMs = opts.openDurationMs || 30000;
      this.halfOpenMaxCalls = opts.halfOpenMaxCalls || 3;

      this.state = 'closed'; // closed | open | half-open
      this._failures = 0;
      this._successes = 0;
      this._totalCalls = 0;
      this._openedAt = 0;
      this._halfOpenCalls = 0;
      this._halfOpenSuccesses = 0;
    }

    /**
     * Verifica se pode chamar. Retorna true se o circuito permite.
     * Em half-open, permite chamadas limitadas para teste.
     */
    canCall() {
      if (this.state === 'closed') return true;
      if (this.state === 'open') {
        if (Date.now() - this._openedAt >= this.openDurationMs) {
          this._transition('half-open');
          this._halfOpenCalls = 0;
          this._halfOpenSuccesses = 0;
          return true;
        }
        return false;
      }
      // half-open
      return this._halfOpenCalls < this.halfOpenMaxCalls;
    }

    /**
     * Registra sucesso.
     */
    recordSuccess() {
      this._totalCalls++;
      if (this.state === 'closed') {
        this._successes++;
        this._failures = Math.max(0, this._failures - 1);
      } else if (this.state === 'half-open') {
        this._halfOpenCalls++;
        this._halfOpenSuccesses++;
        if (this._halfOpenSuccesses >= this.halfOpenMaxCalls) {
          this._transition('closed');
          this._reset();
        }
      }
    }

    /**
     * Registra falha.
     */
    recordFailure() {
      this._totalCalls++;
      if (this.state === 'closed') {
        this._failures++;
        if (this._shouldOpen()) {
          this._transition('open');
          this._openedAt = Date.now();
        }
      } else if (this.state === 'half-open') {
        this._halfOpenCalls++;
        this._transition('open');
        this._openedAt = Date.now();
      }
    }

    /**
     * Força reset (manual ou em mudança de playlist).
     */
    reset() {
      this._transition('closed');
      this._reset();
    }

    _shouldOpen() {
      if (this._failures >= this.failureThreshold) return true;
      if (this._totalCalls >= this.minCalls) {
        const rate = this._failures / this._totalCalls;
        return rate >= this.failureRateThreshold;
      }
      return false;
    }

    _reset() {
      this._failures = 0;
      this._successes = 0;
      this._totalCalls = 0;
      this._halfOpenCalls = 0;
      this._halfOpenSuccesses = 0;
    }

    _transition(newState) {
      if (this.state === newState) return;
      const prev = this.state;
      this.state = newState;
      console.warn(`🔌 [CIRCUIT-BREAKER] ${prev} -> ${newState} (failures=${this._failures}, total=${this._totalCalls})`);
    }

    get stats() {
      return {
        state: this.state,
        failures: this._failures,
        successes: this._successes,
        totalCalls: this._totalCalls,
        failureRate: this._totalCalls ? this._failures / this._totalCalls : 0
      };
    }
  }

  // ================================================================
  // retryWithBackoff — retry exponencial com jitter
  // ================================================================

  /**
   * Motivos de erro que NUNCA devem ser re-tentados.
   */
  const PERMANENT_REASONS = new Set([
    'video-not-found',
    'video-private',
    'geo-blocked',
    'video-blocked',
    'video-too-long',
    'extraction-failed',
    'invalid-video-id',
    'not-configured',
    'quota-or-auth'
  ]);

  /**
   * Executa fn com retry exponencial + jitter.
   *
   * @param {Function} fn - função async que retorna { ok, value, reason, retryable, status }
   * @param {Object} opts
   * @param {number} opts.maxRetries - máximo de retries (default 4)
   * @param {number} opts.baseDelayMs - delay base (default 1000)
   * @param {number} opts.maxDelayMs - delay máximo (default 16000)
   * @param {Function} opts.shouldRetry - função(reason) => boolean para decidir retry custom
   * @param {Function} opts.onRetry - callback(attempt, delay, reason) chamado antes de cada retry
   * @returns {Promise<{ok: boolean, value: *, reason: string, attempts: number}>}
   */
  async function retryWithBackoff(fn, opts = {}) {
    const maxRetries = opts.maxRetries ?? 4;
    const baseDelayMs = opts.baseDelayMs ?? 1000;
    const maxDelayMs = opts.maxDelayMs ?? 16000;
    const shouldRetry = opts.shouldRetry || ((reason) => !PERMANENT_REASONS.has(reason));
    const onRetry = opts.onRetry || (() => {});

    let attempt = 0;
    let lastReason = 'unknown';

    while (attempt <= maxRetries) {
      const result = await fn(attempt);
      if (result.ok) {
        return { ok: true, value: result.value, reason: null, attempts: attempt + 1 };
      }

      lastReason = result.reason || 'unknown';

      // Erro permanente: não re-tenta
      if (!shouldRetry(lastReason)) {
        return { ok: false, value: null, reason: lastReason, attempts: attempt + 1 };
      }

      // Última tentativa: não espera
      if (attempt === maxRetries) {
        return { ok: false, value: null, reason: lastReason, attempts: attempt + 1 };
      }

      // Delay exponencial: 1s, 2s, 4s, 8s... + jitter aleatório (0..25%)
      const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = Math.random() * expDelay * 0.25;
      const delay = Math.round(expDelay + jitter);

      onRetry(attempt + 1, delay, lastReason);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }

    return { ok: false, value: null, reason: lastReason, attempts: attempt + 1 };
  }

  // ================================================================
  // MetricsCollector — estatísticas em tempo real
  // ================================================================

  class MetricsCollector {
    constructor() {
      this._resolutions = { api: 0, cache: 0, persistentCache: 0, fallback4shared: 0, failed: 0 };
      this._permanentFailures = 0;
      this._retries = 0;
      this._resolutionTimes = [];
      this._preloadTimes = [];
      this._timeToFirstPlay = null;
      this._firstPlayAt = null;
      this._coverHits = 0;
      this._coverMisses = 0;
      this._foursharedMatches = 0;
      this._foursharedRejects = 0;
      this._circuitBreakerTransitions = 0;
      this._startedAt = Date.now();
    }

    recordResolution(source, durationMs) {
      if (this._resolutions[source] !== undefined) {
        this._resolutions[source]++;
      }
      if (durationMs != null) {
        this._resolutionTimes.push(durationMs);
        if (this._resolutionTimes.length > 200) this._resolutionTimes.shift();
      }
    }

    recordPermanentFailure() { this._permanentFailures++; }
    recordRetry() { this._retries++; }
    recordPreloadTime(ms) {
      this._preloadTimes.push(ms);
      if (this._preloadTimes.length > 50) this._preloadTimes.shift();
    }
    recordFirstPlay(ms) {
      if (this._firstPlayAt === null) {
        this._firstPlayAt = ms;
        this._timeToFirstPlay = ms;
      }
    }
    recordCoverHit() { this._coverHits++; }
    recordCoverMiss() { this._coverMisses++; }
    record4sharedMatch() { this._foursharedMatches++; }
    record4sharedReject() { this._foursharedRejects++; }
    recordCircuitBreakerTransition() { this._circuitBreakerTransitions++; }

    _avg(arr) {
      if (!arr.length) return 0;
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    }

    get summary() {
      const total = Object.values(this._resolutions).reduce((a, b) => a + b, 0);
      const totalCover = this._coverHits + this._coverMisses;
      return {
        uptime: Math.round((Date.now() - this._startedAt) / 1000) + 's',
        resolutions: { ...this._resolutions, total },
        resolutionRate: total ? {
          api: ((this._resolutions.api / total) * 100).toFixed(1) + '%',
          cache: ((this._resolutions.cache / total) * 100).toFixed(0) + '%',
          persistentCache: ((this._resolutions.persistentCache / total) * 100).toFixed(0) + '%',
          fallback4shared: ((this._resolutions.fallback4shared / total) * 100).toFixed(1) + '%',
          failed: ((this._resolutions.failed / total) * 100).toFixed(1) + '%'
        } : {},
        permanentFailures: this._permanentFailures,
        retries: this._retries,
        avgResolutionTime: this._avg(this._resolutionTimes) + 'ms',
        avgPreloadTime: this._avg(this._preloadTimes) + 'ms',
        timeToFirstPlay: this._timeToFirstPlay != null ? this._timeToFirstPlay + 'ms' : 'N/A',
        fourshared: { matches: this._foursharedMatches, rejects: this._foursharedRejects },
        coverCache: {
          hits: this._coverHits,
          misses: this._coverMisses,
          hitRatio: totalCover ? ((this._coverHits / totalCover) * 100).toFixed(1) + '%' : 'N/A'
        },
        circuitBreakerTransitions: this._circuitBreakerTransitions
      };
    }

    log() {
      console.log('📊 [METRICS]', JSON.stringify(this.summary, null, 2));
    }
  }

  // ================================================================
  // TrackLogger — logs agrupados por faixa
  // ================================================================

  class TrackLogger {
    constructor() {
      this._sessions = new Map();
    }

    /**
     * Inicia uma sessão de log para uma faixa.
     * @param {string} trackKey - identificador único da faixa
     * @param {string} trackName - nome para exibição
     * @returns {string} sessionId
     */
    start(trackKey, trackName) {
      const sessionId = `${trackKey}#${Date.now()}`;
      this._sessions.set(sessionId, {
        trackKey,
        trackName: trackName || 'desconhecida',
        events: [],
        startedAt: Date.now()
      });
      return sessionId;
    }

    /**
     * Adiciona um evento à sessão.
     */
    event(sessionId, category, message, data = null) {
      const session = this._sessions.get(sessionId);
      if (!session) return;
      session.events.push({
        category,
        message,
        data,
        elapsed: Date.now() - session.startedAt
      });
    }

    /**
     * Finaliza a sessão e imprime o resumo agrupado no console.
     */
    end(sessionId, result) {
      const session = this._sessions.get(sessionId);
      if (!session) return;

      const totalMs = Date.now() - session.startedAt;
      const lines = [`━━━ [AUDIO] "${session.trackName}" ━━━`];
      lines.push(`  Track: ${session.trackKey}`);

      for (const ev of session.events) {
        const prefix = ev.category.padEnd(10);
        lines.push(`  ${prefix}: ${ev.message}${ev.data ? ` (${JSON.stringify(ev.data)})` : ''}`);
      }

      lines.push(`  Tempo total: ${totalMs}ms`);
      lines.push(`  Resultado: ${result || 'falhou'}`);
      lines.push('━'.repeat(40));

      if (result && result !== 'falhou') {
        console.log(lines.join('\n'));
      } else {
        console.warn(lines.join('\n'));
      }

      this._sessions.delete(sessionId);
    }
  }

  // ================================================================
  // Export
  // ================================================================

  window.HFInfra = {
    // String algorithms
    levenshteinDistance,
    levenshteinSimilarity,
    jaroWinklerSimilarity,
    // Cache
    PersistentCache,
    // Queue
    PriorityQueue,
    // Circuit breaker
    CircuitBreaker,
    // Retry
    retryWithBackoff,
    PERMANENT_REASONS,
    // Metrics
    MetricsCollector,
    // Logger
    TrackLogger
  };
})();
