/**
 * HyperMusic Player - Player de música do HyperFitness
 * 
 * Dependências:
 * - src/player/playlists.js (dados das playlists)
 * - src/player/player.css (estilos do player)
 * - src/player/player.html (estrutura HTML do player)
 */

// Flag para controlar se o HTML já foi injetado
let playerHtmlInjected = false;

// Função para injetar o HTML do player
async function injectPlayerHtml() {
  if (playerHtmlInjected) return true;
  
  try {
    const response = await fetch('src/player/player.html');
    if (!response.ok) throw new Error('Falha ao carregar player.html');
    
    const html = await response.text();
    
    // Criar container para o player
    const playerContainer = document.createElement('div');
    playerContainer.id = 'player-container';
    playerContainer.innerHTML = html;
    
    // Inserir antes do primeiro script ou no final do body
    document.body.appendChild(playerContainer);
    
    playerHtmlInjected = true;
    console.log('🎵 [PLAYER] HTML injetado com sucesso');
    return true;
  } catch (error) {
    console.error('❌ [PLAYER] Erro ao injetar HTML:', error);
    return false;
  }
}

const MUSIC_PLAYER = (() => {
  const CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 horas
  const COVER_CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 horas para capas
  const COVER_PROXY_BLOCK_MS = 45 * 1000; // cooldown curto por proxy
  const COVER_SUSPEND_MS = 5 * 60 * 1000; // suspender tentativas após muitos erros
  const COVER_FAILURE_THRESHOLD = 5;
  const AUDIO_RESET_DELAY_MS = 100; // delay após reset do áudio
  
  const localDevFlag = (() => {
    if (typeof window === 'undefined') return false;
    if (typeof isLocalDev !== 'undefined') return isLocalDev;
    const hostname = window.location.hostname;
    const port = window.location.port;
    const protocol = window.location.protocol;
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) ||
      port === '5500' ||
      protocol === 'file:';
  })();

  let initPromise = null;
  let initCompleted = false;

  // Helper para delay
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // === Funções Helper Locais (independentes do index.html) ===
  
  // Formatação de tempo (ms para mm:ss ou hh:mm:ss)
  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  // Escape HTML para prevenir XSS
  function escapeHTML(value) {
    if (!value && value !== 0) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (c) => map[c]);
  }

  // Lock/unlock body scroll para modais (usa funções globais se disponíveis)
  function lockBodyScroll() {
    // Usa a função global do index.html se disponível para evitar conflitos
    if (typeof window._lockBodyScroll === 'function') {
      window._lockBodyScroll();
      return;
    }
    // Fallback local
    if (document.body.classList.contains('modal-open')) return;
    const scrollY = window.scrollY;
    document.body.style.top = `-${scrollY}px`;
    document.body.classList.add('modal-open');
  }

  function unlockBodyScroll() {
    // Usa a função global do index.html se disponível para evitar conflitos
    if (typeof window._unlockBodyScroll === 'function') {
      window._unlockBodyScroll();
      return;
    }
    // Fallback local
    if (!document.body.classList.contains('modal-open')) return;
    const scrollY = document.body.style.top;
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, parseInt(scrollY || '0') * -1);
  }

  // Helper para parar propagação de evento
  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // Scroll horizontal via wheel
  function enableHorizontalWheelScroll(element, options = {}) {
    if (!element) return;
    const { capture = false, parentElement = null } = options;

    const applyDelta = (delta, deltaMode = 0) => {
      if (!delta) return;
      if (element.scrollWidth <= element.clientWidth) return;
      const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? element.clientWidth : 1;
      element.scrollLeft += delta * multiplier;
    };

    const handler = (e) => {
      if (parentElement) {
        const rect = element.getBoundingClientRect();
        const isOver = e.clientX >= rect.left && e.clientX <= rect.right && 
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!isOver) return;
        if (element.style.pointerEvents === 'none') return;
      }
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      if (capture) e.stopPropagation();
      applyDelta(delta, e.deltaMode);
    };
    
    const target = parentElement || element;
    target.addEventListener('wheel', handler, { passive: false, capture });
    target.addEventListener('mousewheel', (e) => {
      if (parentElement) {
        const rect = element.getBoundingClientRect();
        const isOver = e.clientX >= rect.left && e.clientX <= rect.right && 
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!isOver) return;
        if (element.style.pointerEvents === 'none') return;
      }
      const delta = e.wheelDelta ? -e.wheelDelta / 120 : e.detail || 0;
      if (!delta) return;
      e.preventDefault();
      if (capture) e.stopPropagation();
      applyDelta(delta, 1);
    }, { passive: false, capture });
  }
  
  // Múltiplos proxies para Deezer API com fallback
  const DEEZER_PROXIES = localDevFlag
    ? [
      (base) => ({ id: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(base)}` }),
      (base) => ({ id: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}` }),
      (base) => ({ id: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(base)}` })
    ]
    : [
      (base) => ({ id: 'netlify-proxy', url: `/proxy?url=${encodeURIComponent(base)}` }),
      (base) => ({ id: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(base)}` }),
      (base) => ({ id: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}` }),
      (base) => ({ id: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(base)}` })
    ];

  const state = {
    playlists: [],
    tracks: [],
    currentPlaylist: null,
    currentTrackIndex: -1,
    // Estado de reprodução (separado da visualização)
    playingPlaylistId: null,
    playingTrackIndex: -1,
    playingTracks: [],
    playlistsLoaded: false,
    isLoadingTrack: false,
    isPlaying: false,
    audioRecoveryInProgress: false,
    importInProgress: false,
    currentAttemptUrl: '', // URL sendo tentada atualmente (para marcar falhas corretamente)
    searchCache: new Map(),
    searchPromises: new Map(),
    audioCache: new Map(),
    audioErrorCounts: new Map(),
    coverCache: new Map(),
    coverProxyBlock: new Map(),
    coverProxyCooldown: new Map(),
    coverProxyFailCount: new Map(),
    coverFailureStreak: 0,
    coverSuspendedUntil: 0,
    coverLastSuccessProxy: null,
    playlistCoverPromise: null,
    playlistUiAppliedPromise: null,
    playlistCoversReady: false,
    playlistUiApplied: false,
    currentImportSessionId: 0,
    playRequestId: 0,
    preloadedPlaylists: new Set() // Playlists que já tiveram preload executado
  };

  // Expor state globalmente para debug
  window.appState = state;

  // Estado de paginação do YouTube (infinite scroll)
  const youtubeSearchState = {
    query: '',
    offset: 0,
    hasMore: false,
    isLoading: false,
    results: [],
    searchType: 'tracks' // 'tracks' ou 'playlists'
  };

  // Função para alternar tipo de busca
  function setSearchType(type) {
    youtubeSearchState.searchType = type;
    
    if (type === 'tracks') {
      if (ui.searchTypeTracks) {
        ui.searchTypeTracks.style.background = 'rgba(255,122,31,0.8)';
        ui.searchTypeTracks.style.color = 'white';
      }
      if (ui.searchTypePlaylists) {
        ui.searchTypePlaylists.style.background = 'transparent';
        ui.searchTypePlaylists.style.color = 'rgba(255,255,255,0.5)';
      }
      if (ui.manualSearchInput) ui.manualSearchInput.placeholder = 'O que quer ouvir?';
    } else {
      if (ui.searchTypePlaylists) {
        ui.searchTypePlaylists.style.background = 'rgba(147,51,234,0.8)';
        ui.searchTypePlaylists.style.color = 'white';
      }
      if (ui.searchTypeTracks) {
        ui.searchTypeTracks.style.background = 'transparent';
        ui.searchTypeTracks.style.color = 'rgba(255,255,255,0.5)';
      }
      if (ui.manualSearchInput) ui.manualSearchInput.placeholder = 'Buscar playlists...';
    }
  }

  // Playlist fixa "Músicas Favoritas"
  const WATCH_LATER_PLAYLIST_ID = 'watch-later-fixed';
  const WATCH_LATER_STORAGE_KEY = 'hyperfitness-watch-later';

  function createWatchLaterPlaylist() {
    return {
      id: WATCH_LATER_PLAYLIST_ID,
      name: 'Músicas Favoritas',
      images: [],
      tracks: [],
      coverSources: [],
      playlistCover: null,
      isFixed: true
    };
  }

  function loadWatchLaterPlaylist() {
    try {
      const stored = localStorage.getItem(WATCH_LATER_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        return {
          ...createWatchLaterPlaylist(),
          tracks: data.tracks || []
        };
      }
    } catch (e) {
      console.warn('Erro ao carregar playlist "Músicas Favoritas":', e);
    }
    return createWatchLaterPlaylist();
  }

  // Helper para obter a playlist de favoritos
  function getWatchLaterPlaylist() {
    return state.playlists.find(p => p.id === WATCH_LATER_PLAYLIST_ID);
  }

  function saveWatchLaterPlaylist() {
    try {
      const watchLater = getWatchLaterPlaylist();
      if (watchLater) {
        localStorage.setItem(WATCH_LATER_STORAGE_KEY, JSON.stringify({
          tracks: watchLater.tracks
        }));
      }
    } catch (e) {
      console.warn('Erro ao salvar playlist "Músicas Favoritas":', e);
    }
  }

  function addToWatchLater(track) {
    const watchLater = getWatchLaterPlaylist();
    if (!watchLater) return false;

    // Verifica se a track já existe (por nome e artista)
    const exists = watchLater.tracks.some(t => isSameTrack(t, track));

    if (exists) {
      setFeedback('Já está nos favoritos', 'info', getTrackFeedbackInfo(track));
      return false;
    }

    watchLater.tracks.push({ ...track, addedAt: Date.now() });
    saveWatchLaterPlaylist();
    renderPlaylists();
    
    // Atualiza o ícone do botão para preenchido
    const trackIndex = state.tracks.findIndex(t => isSameTrack(t, track));
    if (trackIndex !== -1) {
      const button = ui.tracksContainer?.querySelector(`[data-add-index="${trackIndex}"]`);
      updateFavoriteButtonState(button, true);
    }
    
    // Mostra feedback com capa e nome da música
    setFeedback('Adicionado aos favoritos', 'success', getTrackFeedbackInfo(track));
    return true;
  }

  function removeFromWatchLater(trackIndex) {
    const watchLater = getWatchLaterPlaylist();
    if (!watchLater || trackIndex < 0 || trackIndex >= watchLater.tracks.length) return false;

    // Guarda informações da track antes de remover para o feedback
    const removedTrack = watchLater.tracks[trackIndex];
    const feedbackInfo = getTrackFeedbackInfo(removedTrack);

    // Verifica se a faixa sendo removida é a que está tocando
    const isPlayingThisPlaylist = state.playingPlaylistId === WATCH_LATER_PLAYLIST_ID;
    const isPlayingThisTrack = isPlayingThisPlaylist && state.playingTrackIndex === trackIndex;
    const isPlayingAfterThis = isPlayingThisPlaylist && state.playingTrackIndex > trackIndex;

    watchLater.tracks.splice(trackIndex, 1);
    saveWatchLaterPlaylist();

    // Função auxiliar para mostrar feedback
    const showRemovedFeedback = () => {
      setFeedback('Removido dos favoritos', 'success', feedbackInfo);
    };

    // Se estamos visualizando a playlist "Músicas Favoritas", atualiza a view
    if (state.currentPlaylist?.id === WATCH_LATER_PLAYLIST_ID) {
      state.tracks = [...watchLater.tracks];

      // Ajusta o índice atual se necessário
      if (state.currentTrackIndex === trackIndex) {
        state.currentTrackIndex = -1;
      } else if (state.currentTrackIndex > trackIndex) {
        state.currentTrackIndex--;
      }

      renderTracks(state.tracks);
    }

    // Se a faixa removida estava tocando, para a reprodução
    if (isPlayingThisTrack) {
      // Para o áudio imediatamente
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) { }

      safeResetAudio();
      stopPlaying();

      // Se a playlist ficou vazia, limpa completamente o estado de reprodução
      if (watchLater.tracks.length === 0) {
        state.playingTrackIndex = -1;
        state.playingPlaylistId = null;
        state.playingTracks = [];
        state.currentTrackIndex = -1;
        stopPlaybackCountdown({ resetLabel: true });
        updateUiState();
        renderPlaylists();
        showRemovedFeedback();
        return true;
      } else {
        // Toca a próxima faixa
        state.playingTracks = [...watchLater.tracks];
        const nextIndex = Math.min(trackIndex, watchLater.tracks.length - 1);
        state.playingTrackIndex = nextIndex;
        state.currentTrackIndex = nextIndex;
        updateUiState();
        playTrack(nextIndex);
        renderPlaylists();
        showRemovedFeedback();
        return true;
      }
    } else if (isPlayingAfterThis) {
      // Ajusta o índice de reprodução se a faixa removida estava antes
      state.playingTrackIndex--;
      state.playingTracks = [...watchLater.tracks];
      updateUiState();
    }

    renderPlaylists();
    showRemovedFeedback();
    return true;
  }

  function removeFromWatchLaterByTrack(track) {
    const watchLater = getWatchLaterPlaylist();
    if (!watchLater || !track) return false;

    // Encontra o índice da track nos favoritos
    const trackIndex = watchLater.tracks.findIndex(t => isSameTrack(t, track));

    if (trackIndex === -1) return false;

    // Guarda informações da track para o feedback
    const removedTrack = watchLater.tracks[trackIndex];

    // Remove a track
    watchLater.tracks.splice(trackIndex, 1);
    saveWatchLaterPlaylist();
    renderPlaylists();

    // Feedback
    setFeedback('Removido dos favoritos', 'success', getTrackFeedbackInfo(removedTrack));

    return true;
  }

  function ensureWatchLaterPlaylist() {
    const exists = state.playlists.some(p => p.id === WATCH_LATER_PLAYLIST_ID);
    if (!exists) {
      const watchLater = loadWatchLaterPlaylist();
      state.playlists.unshift(watchLater);
    }
  }

  // Persistência geral de playlists
  const PLAYLISTS_STORAGE_KEY = 'hyperfitness-playlists';
  const AUDIO_CACHE_STORAGE_KEY = 'hyperfitness-audio-cache';
  const CURRENT_STATE_STORAGE_KEY = 'hyperfitness-current-state';

  // Flag para impedir salvamento após limpeza manual
  let preventSaveOnUnload = false;

  // Função para limpar todos os dados do player (exposta globalmente para debug)
  window.clearAllPlayerData = function () {
    try {
      // Impede que o beforeunload salve os dados de volta
      preventSaveOnUnload = true;

      localStorage.removeItem(PLAYLISTS_STORAGE_KEY);
      localStorage.removeItem(AUDIO_CACHE_STORAGE_KEY);
      localStorage.removeItem(CURRENT_STATE_STORAGE_KEY);
      localStorage.removeItem(WATCH_LATER_STORAGE_KEY);
      state.playlists = [];
      state.tracks = [];
      state.currentPlaylist = null;
      state.currentTrackIndex = -1;
      resetPlaybackState();
      state.audioCache.clear();
      state.playlistsLoaded = false;
      console.log('🧹 [CLEAR] Todos os dados do player foram limpos!');
      return true;
    } catch (e) {
      console.error('Erro ao limpar dados:', e);
      return false;
    }
  };

  function savePlaylistsToStorage() {
    try {
      // Filtra a playlist "Músicas Favoritas" (já tem seu próprio storage)
      const playlistsToSave = state.playlists
        .filter(p => p.id !== WATCH_LATER_PLAYLIST_ID)
        .map(p => ({
          id: p.id,
          name: p.name,
          images: p.images,
          cover: p.cover,
          playlistCover: p.playlistCover,
          tracks: p.tracks.map(t => ({
            name: t.name,
            artists: t.artists,
            album: t.album,
            duration_ms: t.duration_ms,
            durationMs: t.durationMs,
            thumbnail: t.thumbnail,
            playlistName: t.playlistName,
            videoId: t.videoId,
            audioUrl: t.audioUrl
          }))
        }));

      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlistsToSave));
      console.log(`💾 [STORAGE] Salvas ${playlistsToSave.length} playlists`);
    } catch (e) {
      console.warn('Erro ao salvar playlists:', e);
    }
  }

  function deletePlaylist(playlistId) {
    if (!playlistId) return;
    
    const playlistIndex = state.playlists.findIndex(p => p.id === playlistId);
    if (playlistIndex === -1) return;
    
    const playlist = state.playlists[playlistIndex];
    
    // Tratamento especial para "Músicas Favoritas" - limpa as faixas ao invés de remover
    if (playlistId === WATCH_LATER_PLAYLIST_ID) {
      // Para a reprodução se estiver tocando
      if (state.currentPlaylist && state.currentPlaylist.id === playlistId) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (_) {}
        state.isPlaying = false;
        state.currentPlaylist = null;
        state.tracks = [];
        state.currentTrackIndex = -1;
        updateUiState();
        renderTracks([]);
      }
      
      // Limpa as faixas da playlist
      playlist.tracks = [];
      saveWatchLaterPlaylist();
      renderPlaylists();
      setFeedback('Playlist limpa', 'success', {
        name: 'Músicas Favoritas',
        cover: 'src/imagens/favoriteSongs.png'
      });
      return;
    }
    
    // Se a playlist sendo deletada é a atual, para a reprodução e limpa as faixas
    if (state.currentPlaylist && state.currentPlaylist.id === playlistId) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
      state.isPlaying = false;
      state.currentPlaylist = null;
      state.tracks = [];
      state.currentTrackIndex = -1;
      updateUiState();
      renderTracks([]);
    }
    
    // Remove a playlist
    state.playlists.splice(playlistIndex, 1);
    
    // Salva e atualiza a UI
    savePlaylistsToStorage();
    renderPlaylists();
    
    const playlistCover = getPlaylistCover(playlist);
    setFeedback('Playlist removida', 'success', {
      name: playlist.name,
      cover: playlistCover,
      subtitle: `${playlist.tracks?.length || 0} faixas`
    });
  }

  function loadPlaylistsFromStorage() {
    try {
      const stored = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
      if (stored) {
        const playlists = JSON.parse(stored);
        console.log(`📂 [STORAGE] Carregadas ${playlists.length} playlists`);
        return playlists;
      }
    } catch (e) {
      console.warn('Erro ao carregar playlists:', e);
    }
    return [];
  }

  function saveCurrentStateToStorage() {
    try {
      const currentState = {
        currentPlaylistId: state.currentPlaylist?.id || null,
        currentTrackIndex: state.currentTrackIndex
      };
      localStorage.setItem(CURRENT_STATE_STORAGE_KEY, JSON.stringify(currentState));
    } catch (e) {
      console.warn('Erro ao salvar estado atual:', e);
    }
  }

  function loadCurrentStateFromStorage() {
    try {
      const stored = localStorage.getItem(CURRENT_STATE_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Erro ao carregar estado atual:', e);
    }
    return null;
  }

  // Cache de áudio reproduzido (videoId -> audioUrl)
  function saveAudioCacheToStorage() {
    try {
      const cacheToSave = {};
      state.audioCache.forEach((entry, key) => {
        if (entry.value && entry.timestamp) {
          cacheToSave[key] = {
            value: entry.value,
            timestamp: entry.timestamp
          };
        }
      });
      localStorage.setItem(AUDIO_CACHE_STORAGE_KEY, JSON.stringify(cacheToSave));
    } catch (e) {
      console.warn('Erro ao salvar cache de áudio:', e);
    }
  }

  function loadAudioCacheFromStorage() {
    try {
      const stored = localStorage.getItem(AUDIO_CACHE_STORAGE_KEY);
      if (stored) {
        const cache = JSON.parse(stored);
        Object.entries(cache).forEach(([key, entry]) => {
          // Só carrega se ainda estiver válido (dentro do TTL)
          if (isCacheValid(entry.timestamp)) {
            state.audioCache.set(key, entry);
          }
        });
        console.log(`🔊 [STORAGE] Carregadas ${state.audioCache.size} entradas de cache de áudio`);
      }
    } catch (e) {
      console.warn('Erro ao carregar cache de áudio:', e);
    }
  }

  // Salva automaticamente ao modificar playlists
  function saveAllData() {
    // Não salva se a flag de limpeza estiver ativa
    if (preventSaveOnUnload) return;

    savePlaylistsToStorage();
    saveWatchLaterPlaylist();
    saveCurrentStateToStorage();
    saveAudioCacheToStorage();
  }

  // Debounce para não salvar muito frequentemente
  let saveDebounceTimer = null;
  function debouncedSave() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(saveAllData, 1000);
  }

  // Funções auxiliares de cache com TTL
  function isCacheValid(timestamp, ttl = CACHE_TTL_MS) {
    return timestamp && (Date.now() - timestamp) < ttl;
  }

  function getCacheEntry(cache, key, ttl = CACHE_TTL_MS) {
    if (!cache.has(key)) return null;
    const entry = cache.get(key);
    if (!isCacheValid(entry.timestamp, ttl)) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  function setCacheEntry(cache, key, value) {
    cache.set(key, { value, timestamp: Date.now() });
  }

  // Wrappers para cover cache com TTL específico
  const getCoverCache = (key) => getCacheEntry(state.coverCache, key, COVER_CACHE_TTL_MS);
  const setCoverCache = (key, value) => setCacheEntry(state.coverCache, key, value);

  // Funções de controle de proxy
  function isProxyExpired(cache, proxyId) {
    const expires = cache.get(proxyId);
    if (!expires) return true;
    if (Date.now() > expires) {
      cache.delete(proxyId);
      return true;
    }
    return false;
  }

  const isCoverProxyBlocked = (proxyId) => !isProxyExpired(state.coverProxyBlock, proxyId);
  const isCoverProxyCooling = (proxyId) => !isProxyExpired(state.coverProxyCooldown, proxyId);

  function setCoverProxyCooldown(proxyId, duration = 2000) {
    if (proxyId) state.coverProxyCooldown.set(proxyId, Date.now() + duration);
  }

  function resetCoverProxyFail(proxyId) {
    if (proxyId) state.coverProxyFailCount.delete(proxyId);
  }

  function blockCoverProxy(proxyId, reason = 'unknown', duration = COVER_PROXY_BLOCK_MS) {
    if (!proxyId) return;
    const reasonText = String(reason).toLowerCase();
    // Isomorphic 403/failed fetch são comuns; evita bloquear
    if (proxyId === 'isomorphic' && (reasonText.includes('403') || reasonText.includes('failed'))) return;
    // Allorigins aborta com frequência; não bloquear por abort
    if (proxyId === 'allorigins' && reasonText.includes('abort')) return;
    // Jina só bloqueia em 429 explícito
    if (proxyId === 'jina' && !reasonText.includes('429')) return;
    state.coverProxyBlock.set(proxyId, Date.now() + duration);
    console.warn(`⏳ [COVER] Proxy bloqueado (${proxyId}) por ${Math.round(duration / 1000)}s (${reason})`);
  }

  function resetCoverProxies(reason = 'manual-reset') {
    state.coverProxyBlock.clear();
    state.coverProxyFailCount.clear();
    state.coverSuspendedUntil = 0;
    console.warn(`♻️ [COVER] Reset proxies (${reason})`);
  }

  const AUDIO_ERROR_RESET_MS = 15000;
  const MEDIA_ERROR_ABORTED_CODE = (typeof MediaError !== 'undefined' && MediaError.MEDIA_ERR_ABORTED) ? MediaError.MEDIA_ERR_ABORTED : 1;

  // Limpa caches associados a uma faixa específica (resultado de busca e áudio)
  function clearTrackCaches(trackKey, cachedResult = null, { preserveFailures = false } = {}) {
    if (!trackKey) return;

    const result = cachedResult || getCacheEntry(state.searchCache, trackKey);
    if (result?.videoId) {
      state.audioCache.delete(result.videoId);
    }

    state.searchCache.delete(trackKey);
    state.searchPromises.delete(trackKey);
  }

  // Helper para limpar videoId de uma track e retornar o original
  function clearTrackVideoId(track) {
    const originalVideoId = track._videoId || track.videoId;
    delete track._videoId;
    delete track.videoId;
    return originalVideoId;
  }

  // Helper para obter o videoId de uma track
  function getTrackVideoId(track) {
    return track?._videoId || track?.videoId || null;
  }

  function trackAudioError(index) {
    if (!Number.isInteger(index)) return 1;
    const now = Date.now();
    const entry = state.audioErrorCounts.get(index) || { count: 0, ts: 0 };
    const withinWindow = now - entry.ts < AUDIO_ERROR_RESET_MS;
    const count = withinWindow ? entry.count + 1 : 1;
    state.audioErrorCounts.set(index, { count, ts: now });
    return count;
  }

  function resetAudioError(index) {
    if (!Number.isInteger(index)) return;
    state.audioErrorCounts.delete(index);
  }

  // Helper para marcar reprodução bem-sucedida
  function markPlaybackSuccess(index) {
    state.isPlaying = true;
    resetAudioError(index);
    updateUiState();
    advanceScheduled = false;
  }

  // Helper para parar a reprodução
  function stopPlaying() {
    state.isPlaying = false;
    state.isLoadingTrack = false;
    resetTrackEndFallback();
  }

  // Helper para iniciar reprodução do áudio
  function startPlaying() {
    audio.play();
    state.isPlaying = true;
  }

  // Helper para pausar reprodução do áudio
  function pausePlaying() {
    audio.pause();
    state.isPlaying = false;
  }

  // Helper para atualizar o estado visual do botão de favorito
  function updateFavoriteButtonState(button, isFavorite) {
    const icon = button?.querySelector('i');
    if (!icon) return;
    
    icon.className = isFavorite ? 'ph-fill ph-heart text-base' : 'ph-bold ph-heart text-base';
    button.classList.toggle('text-orange-400', isFavorite);
    button.classList.toggle('text-white/50', !isFavorite);
    button.setAttribute('aria-label', isFavorite ? 'Já nos favoritos' : 'Adicionar aos favoritos');
    button.setAttribute('title', isFavorite ? 'Já nos favoritos' : 'Adicionar aos favoritos');
  }

  // Helper para criar objeto de feedback de track
  function getTrackFeedbackInfo(track) {
    return {
      name: track.name,
      cover: getTrackImage(track),
      subtitle: getTrackArtists(track)
    };
  }

  // Helper para criar objeto de feedback de playlist
  function getPlaylistFeedbackInfo(playlist) {
    return {
      name: playlist.name,
      cover: getPlaylistCover(playlist)
    };
  }

  // Helper para obter contagem de tracks de uma playlist
  function getPlaylistTrackCount(playlist) {
    return playlist?.tracks?.length || 0;
  }

  // Helper para falha de reprodução e pular para próxima
  function handlePlaybackFailure(index) {
    stopPlaying();
    stopPlaybackCountdown({ resetLabel: true, index });
    safeResetAudio();
    updateUiState();
    playNextFrom(index + 1);
  }

  // Helper para marcar track como indisponível e tratar falha de reprodução
  function handleUnavailableTrack(index) {
    markTrackUnavailable(index);
    handlePlaybackFailure(index);
  }

  // Orquestra a resolução de uma faixa, compartilhando promessas em andamento
  async function resolveTrackWithCache(track, index, { forceRefresh = false, preserveFailures = false } = {}) {
    if (!track) return null;

    const key = getTrackKey(track);
    if (!key) return null;

    if (forceRefresh) {
      clearTrackCaches(key, null, { preserveFailures });
    } else {
      const cached = getCacheEntry(state.searchCache, key);
      if (cached !== null) {
        updateTrackDurationFromResult(track, index, cached);
        return cached;
      }

      const pending = state.searchPromises.get(key);
      if (pending) {
        try {
          return await pending;
        } catch {
          // Se a promessa falhar, continua para uma nova tentativa
        }
      }
    }

    const task = (async () => {
      const result = await resolveTrackAudio(track, index, forceRefresh);
      updateTrackDurationFromResult(track, index, result);
      return result;
    })();

    state.searchPromises.set(key, task);

    try {
      const result = await task;
      updateTrackDurationFromResult(track, index, result);
      return result;
    } finally {
      if (state.searchPromises.get(key) === task) {
        state.searchPromises.delete(key);
      }
    }
  }

  const ui = {
    playerModal: null,
    playlistsContainer: null,
    tracksContainer: null,
    playlistEmptyState: null,
    emptyStateImportBtn: null,
    reimportBtn: null,
    fileInput: null,
    feedback: null,
    feedbackText: null,
    feedbackTitle: null,
    feedbackCover: null,
    feedbackIcon: null,
    feedbackClose: null,
    closePlayerBtn: null,
    tabDiscover: null,
    tabPlaylist: null,
    tabYoutube: null,
    screenDiscover: null,
    screenPlaylist: null,
    screenYoutube: null,
    youtubeEmptyState: null,
    youtubeSearchContent: null,
    featuredPlaylistsGrid: null,
    specialPlaylistsGrid: null,
    manualSearchInput: null,
    manualSearchBtn: null,
    manualSearchResults: null,
    playlistPickerModal: null,
    playlistPickerCard: null,
    playlistPickerTrack: null,
    playlistPickerList: null,
    closePlaylistPickerBtn: null,
    showNewPlaylistBtn: null,
    newPlaylistForm: null,
    newPlaylistName: null,
    confirmNewPlaylistBtn: null,
    cancelNewPlaylistBtn: null,
    youtubeSearchBarWrapper: null,
    youtubeSearchBtnContainer: null,
    youtubeSearchOverlay: null,
    youtubeSearchTrigger: null,
    youtubeSearchCancel: null,
    searchTypeTracks: null,
    searchTypePlaylists: null,
    importInfoModal: null,
    importInfoBtn: null,
    closeImportInfoBtn: null,
    ctrlPlay: null,
    ctrlPrev: null,
    ctrlNext: null,
    ctrlShuffle: null,
    ctrlRepeat: null,
    ctrlVolumeBtn: null,
    ctrlVolume: null,
    ctrlTitle: null,
    ctrlArtist: null,
    ctrlCover: null,
    volumeContainer: null,
    miniPlay: null,
    miniPrev: null,
    miniNext: null,
    miniShuffle: null,
    miniRepeat: null,
    miniVolumeBtn: null,
    miniVolume: null,
    miniVolumeContainer: null,
    miniPlayerBar: null,
    miniTitle: null,
    miniArtist: null,
    miniCover: null
  };

  // Função para popular o objeto ui após o HTML ser injetado
  function populateUiElements() {
    ui.playerModal = document.getElementById('player-modal');
    ui.playlistsContainer = document.getElementById('playlists-container');
    ui.tracksContainer = document.getElementById('tracks-container');
    ui.playlistEmptyState = document.getElementById('playlist-empty-state');
    ui.emptyStateImportBtn = document.getElementById('empty-state-import-btn');
    ui.reimportBtn = document.getElementById('reimport-btn');
    ui.fileInput = document.getElementById('csv-file-input');
    ui.feedback = document.getElementById('player-feedback');
    ui.feedbackText = document.getElementById('player-feedback-text');
    ui.feedbackTitle = document.getElementById('player-feedback-title');
    ui.feedbackCover = document.getElementById('player-feedback-cover');
    ui.feedbackIcon = document.getElementById('player-feedback-icon');
    ui.feedbackClose = document.getElementById('player-feedback-close');
    ui.closePlayerBtn = document.getElementById('close-player-btn');
    ui.tabDiscover = document.getElementById('tab-discover');
    ui.tabPlaylist = document.getElementById('tab-playlist');
    ui.tabYoutube = document.getElementById('tab-youtube');
    ui.screenDiscover = document.getElementById('player-screen-discover');
    ui.screenPlaylist = document.getElementById('player-screen-playlist');
    ui.screenYoutube = document.getElementById('player-screen-youtube');
    ui.youtubeEmptyState = document.getElementById('youtube-empty-state');
    ui.youtubeSearchContent = document.getElementById('youtube-search-content');
    ui.featuredPlaylistsGrid = document.getElementById('featured-playlists-grid');
    ui.specialPlaylistsGrid = document.getElementById('special-playlists-grid');
    ui.manualSearchInput = document.getElementById('manual-search-input');
    ui.manualSearchBtn = document.getElementById('manual-search-btn');
    ui.manualSearchResults = document.getElementById('manual-search-results');
    ui.playlistPickerModal = document.getElementById('playlist-picker-modal');
    ui.playlistPickerCard = document.getElementById('playlist-picker-card');
    ui.playlistPickerTrack = document.getElementById('playlist-picker-track');
    ui.playlistPickerList = document.getElementById('playlist-picker-list');
    ui.closePlaylistPickerBtn = document.getElementById('close-playlist-picker-btn');
    ui.showNewPlaylistBtn = document.getElementById('show-new-playlist-btn');
    ui.newPlaylistForm = document.getElementById('new-playlist-form');
    ui.newPlaylistName = document.getElementById('new-playlist-name');
    ui.confirmNewPlaylistBtn = document.getElementById('confirm-new-playlist-btn');
    ui.cancelNewPlaylistBtn = document.getElementById('cancel-new-playlist-btn');
    ui.youtubeSearchBarWrapper = document.getElementById('youtube-search-bar-wrapper');
    ui.youtubeSearchBtnContainer = document.getElementById('youtube-search-btn-container');
    ui.youtubeSearchOverlay = document.getElementById('youtube-search-overlay');
    ui.youtubeSearchTrigger = document.getElementById('youtube-search-trigger');
    ui.youtubeSearchCancel = document.getElementById('youtube-search-cancel');
    ui.searchTypeTracks = document.getElementById('search-type-tracks');
    ui.searchTypePlaylists = document.getElementById('search-type-playlists');
    ui.importInfoModal = document.getElementById('import-info-modal');
    ui.importInfoBtn = document.getElementById('import-info-btn');
    ui.closeImportInfoBtn = document.getElementById('close-import-info-modal');
    ui.ctrlPlay = document.getElementById('ctrl-play');
    ui.ctrlPrev = document.getElementById('ctrl-prev');
    ui.ctrlNext = document.getElementById('ctrl-next');
    ui.ctrlShuffle = document.getElementById('ctrl-shuffle');
    ui.ctrlRepeat = document.getElementById('ctrl-repeat');
    ui.ctrlVolumeBtn = document.getElementById('ctrl-volume-btn');
    ui.ctrlVolume = document.getElementById('ctrl-volume');
    ui.ctrlTitle = document.getElementById('ctrl-title');
    ui.ctrlArtist = document.getElementById('ctrl-artist');
    ui.ctrlCover = document.getElementById('ctrl-cover');
    ui.volumeContainer = document.getElementById('volume-slider-container');
    ui.miniPlay = document.getElementById('mini-play');
    ui.miniPrev = document.getElementById('mini-prev');
    ui.miniNext = document.getElementById('mini-next');
    ui.miniShuffle = document.getElementById('mini-shuffle');
    ui.miniRepeat = document.getElementById('mini-repeat');
    ui.miniVolumeBtn = document.getElementById('mini-volume-btn');
    ui.miniVolume = document.getElementById('mini-volume');
    ui.miniVolumeContainer = document.getElementById('mini-volume-slider-container');
    ui.miniPlayerBar = document.getElementById('mini-player-bar');
    ui.miniTitle = document.getElementById('mini-title');
    ui.miniArtist = document.getElementById('mini-artist');
    ui.miniCover = document.getElementById('mini-cover');
  }

  const createAudioElement = (existing = null) => {
    const el = existing || new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.playsInline = true;
    return el;
  };

  let audio = createAudioElement(document.getElementById('audio-player'));
  let secondaryAudio = createAudioElement();
  let fadingOutAudio = null;

  const CROSSFADE_DURATION_MS = 10000;
  const MIN_CROSSFADE_TRACK_MS = 12000;

  let crossfadeInProgress = false;
  let crossfadeTimer = null;
  let autoCrossfadeTriggeredKey = null;
  let crossfadePending = false;
  let fadeInLevel = 1;
  let fadeOutLevel = 0;
  let userVolume = 1;
  let handlingEnded = false;
  let advancingToNext = false;
  let advanceScheduled = false;
  let trackEndFallbackKey = null;
  let trackEndWatchdogTimer = null;

  // Conjunto de elementos cujos erros devem ser ignorados durante reset
  const ignoringErrorsSet = new WeakSet();

  // Helper para verificar se o áudio está realmente tocando
  function isAudioPlaying() {
    return state.isPlaying && !audio.paused && !audio.ended;
  }

  // Helper para verificar se há uma track válida selecionada
  function hasValidTrack() {
    if (state.playingPlaylistId === 'youtube-search' || isPlayingFromYouTube()) return false;
    return state.tracks.length > 0 && state.currentTrackIndex >= 0;
  }

  // Helper para verificar se a playlist em visualização é a mesma em reprodução
  function isViewingPlayingPlaylist() {
    return state.playingPlaylistId === state.currentPlaylist?.id;
  }

  const clampVolume = (value) => Math.max(0, Math.min(1, value));

  function applyVolumeLevels(includeFading = true) {
    const activeVolume = clampVolume(userVolume * (crossfadeInProgress ? fadeInLevel : 1));
    if (audio) audio.volume = activeVolume;
    if (secondaryAudio && secondaryAudio !== audio && !crossfadeInProgress) {
      secondaryAudio.volume = clampVolume(userVolume);
    }
    if (includeFading && fadingOutAudio) {
      fadingOutAudio.volume = clampVolume(userVolume * (crossfadeInProgress ? fadeOutLevel : 0));
    }
  }

  function setUserVolume(value) {
    userVolume = clampVolume(value);
    applyVolumeLevels(true);
  }

  function resetAutoCrossfadeState() {
    autoCrossfadeTriggeredKey = null;
  }

  function resetTrackEndFallback() {
    trackEndFallbackKey = null;
    if (trackEndWatchdogTimer) {
      clearTimeout(trackEndWatchdogTimer);
      trackEndWatchdogTimer = null;
    }
  }

  // Agenda um timer de segurança que verifica se a faixa deveria ter terminado.
  // Cobre o caso em que nem 'ended' nem 'timeupdate' disparam (ex.: áudio fora do DOM + Media Session).
  function scheduleTrackEndWatchdog() {
    if (trackEndWatchdogTimer) {
      clearTimeout(trackEndWatchdogTimer);
      trackEndWatchdogTimer = null;
    }
    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const remaining = dur - audio.currentTime;
    if (remaining <= 0) return;
    // Dispara 1.5s após o término esperado como margem de segurança
    trackEndWatchdogTimer = setTimeout(() => {
      trackEndWatchdogTimer = null;
      maybeForceTrackEnd();
    }, (remaining + 1.5) * 1000);
  }

  // Fallback: detecta fim da faixa via currentTime quando 'ended' não dispara.
  // Chamado por timeupdate e pelo watchdog timer.
  function maybeForceTrackEnd() {
    if (crossfadeInProgress || crossfadePending) return;
    if (state.isLoadingTrack || advancingToNext || advanceScheduled) return;
    if (handlingEnded) return;
    // Se o usuário pausou explicitamente, não tratar como fim da faixa
    if (!state.isPlaying) return;
    if (!hasValidTrack()) return;
    if (isPlayingFromYouTube()) return;

    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;

    const remaining = dur - audio.currentTime;
    // Só dispara se muito próximo do final (< 300ms) ou se o áudio já terminou (ended)
    if (remaining > 0.3 && !audio.ended) return;

    const { index } = getCurrentPlayingTrack();
    const key = `end-${state.playingPlaylistId || 'library'}-${index}`;
    if (trackEndFallbackKey === key) return;
    trackEndFallbackKey = key;

    console.log(`🔄 [AUDIO] Fim da faixa detectado via fallback (remaining: ${remaining.toFixed(3)}s, ended: ${audio.ended}, paused: ${audio.paused})`);
    audioHandlers.ended();
  }

  function handlePlaybackStarted() {
    state.isPlaying = true;
    state.isLoadingTrack = false;
    if (!isPlayingFromYouTube() && isLibraryPlaybackVisible()) {
      const activeIndex = getActiveLibraryIndex();
      if (activeIndex >= 0) {
        setTrackLoading(activeIndex, false); // Esconde spinner
      }
    }
    applyVolumeLevels(true);
    updateUiState();
    if (!isPlayingFromYouTube()) {
      startPlaybackCountdown();
    } else {
      stopPlaybackCountdown({ resetLabel: false });
    }
    // Força remoção dos handlers de seek ao iniciar reprodução
    forceRemoveSeekHandlers();
    // Atualiza visual do YouTube se estiver tocando de lá
    if (isPlayingFromYouTube()) {
      updateYouTubeSearchHighlight();
      startYouTubeSearchCountdown();
    } else {
      stopYouTubeSearchCountdown();
    }
    // Só reseta estado do auto-crossfade se NÃO houver crossfade em andamento/pendente
    if (!crossfadeInProgress && !crossfadePending) {
      resetAutoCrossfadeState();
    }
    // Reseta fallback de fim de faixa e agenda watchdog para a nova faixa
    resetTrackEndFallback();
    scheduleTrackEndWatchdog();
  }

  function cancelCrossfade() {
    if (crossfadeTimer) {
      clearTimeout(crossfadeTimer);
      crossfadeTimer = null;
    }
    crossfadeInProgress = false;
    crossfadePending = false;
    resetTrackEndFallback();
    fadeInLevel = 1;
    fadeOutLevel = 0;
    if (secondaryAudio && secondaryAudio !== audio) {
      safeResetAudio(secondaryAudio);
    }
    if (fadingOutAudio) {
      try { fadingOutAudio.volume = userVolume; } catch (_) { }
      detachCoreAudioListeners(fadingOutAudio);
      resetAudioElement(fadingOutAudio);
      // Recicla o elemento fading out como secondaryAudio em vez de descartá-lo
      if (!secondaryAudio || secondaryAudio === audio) {
        secondaryAudio = fadingOutAudio;
      }
      fadingOutAudio = null;
    }
    applyVolumeLevels(false);
  }

  async function tryPlayElement(target) {
    const retryDelays = [0, 25, 25];
    for (const waitMs of retryDelays) {
      if (waitMs > 0) await delay(waitMs);
      try {
        await target.play();
        return true;
      } catch (_) {
        continue;
      }
    }
    return false;
  }

  async function playWithCrossfade(audioUrl, { isStale } = {}) {
    // Nota: cancelCrossfade() já foi chamada por playTrackInternal antes desta função

    // Se não estiver tocando nada, volta para reprodução normal
    if (!isAudioPlaying() || audio.paused || audio.ended || isPlayingFromYouTube()) {
      await resetAudioWithDelay(audio);
      loadAudioSource(audioUrl, audio);
      state.currentAttemptUrl = audioUrl;
      return tryPlayElement(audio);
    }

    // Garante que temos um secondaryAudio válido (pode ser null se foi reciclado)
    if (!secondaryAudio || secondaryAudio === audio) {
      secondaryAudio = createAudioElement();
    }

    // Prepara áudio secundário
    await resetAudioWithDelay(secondaryAudio);
    state.currentAttemptUrl = audioUrl;
    loadAudioSource(audioUrl, secondaryAudio);
    secondaryAudio.volume = 0;

    const started = await tryPlayElement(secondaryAudio);
    if (!started) {
      // Fallback: reprodução normal
      await resetAudioWithDelay(audio);
      loadAudioSource(audioUrl, audio);
      return tryPlayElement(audio);
    }

    // Troca o elemento principal para o novo áudio e mantém o antigo para fade-out
    const outgoing = audio;
    detachCoreAudioListeners(outgoing);
    fadingOutAudio = outgoing;

    audio = secondaryAudio;
    attachCoreAudioListeners(audio);
    // Não cria novo elemento; secondaryAudio será reciclado de fadingOutAudio ao fim do crossfade
    secondaryAudio = null;

    // Define estado do crossfade ANTES de handlePlaybackStarted para evitar
    // glitch de volume (applyVolumeLevels precisa saber que crossfade está ativo)
    crossfadeInProgress = true;
    crossfadePending = false;
    fadeInLevel = 0;
    fadeOutLevel = 1;
    applyVolumeLevels(true);

    handlePlaybackStarted();

    const startTs = performance.now();
    const duration = CROSSFADE_DURATION_MS;
    // Usa setTimeout em vez de requestAnimationFrame para que o crossfade
    // continue em background (tela bloqueada / Media Session API).
    // RAF para completamente em background; setTimeout continua (~1s de intervalo).
    const CROSSFADE_STEP_MS = 50;

    return await new Promise((resolve) => {
      const step = () => {
        if (isStale?.()) {
          cancelCrossfade();
          resolve(false);
          return;
        }
        const now = performance.now();
        const progress = Math.min(1, (now - startTs) / duration);
        fadeInLevel = progress;
        fadeOutLevel = 1 - progress;
        applyVolumeLevels(true);

        if (progress < 1) {
          crossfadeTimer = setTimeout(step, CROSSFADE_STEP_MS);
          return;
        }

        // Finaliza crossfade
        crossfadeTimer = null;
        crossfadeInProgress = false;
        fadeInLevel = 1;
        fadeOutLevel = 0;

        if (fadingOutAudio) {
          detachCoreAudioListeners(fadingOutAudio);
          resetAudioElement(fadingOutAudio);
          // Recicla o elemento antigo como secondaryAudio para o próximo crossfade
          secondaryAudio = fadingOutAudio;
          fadingOutAudio = null;
        }

        // Garante que temos um secondaryAudio pronto
        if (!secondaryAudio || secondaryAudio === audio) {
          secondaryAudio = createAudioElement();
        }

        applyVolumeLevels(false);
        resetAutoCrossfadeState();
        startPlaybackCountdown();
        // Atualiza Media Session para sincronizar com o novo elemento de áudio
        updateMediaSession();
        // Agenda watchdog para a nova faixa após crossfade
        resetTrackEndFallback();
        scheduleTrackEndWatchdog();
        resolve(true);
      };

      crossfadeTimer = setTimeout(step, CROSSFADE_STEP_MS);
    });
  }

  function findNextPlayableForCrossfade() {
    const tracks = hasLibraryPlaybackQueue() ? state.playingTracks : state.tracks;
    const currentIndex = hasLibraryPlaybackQueue() ? state.playingTrackIndex : state.currentTrackIndex;
    for (let i = currentIndex + 1; i < tracks.length; i++) {
      if (!tracks[i].unavailable) return i;
    }
    if (repeatEnabled && tracks.length > 0) return 0;
    return -1;
  }

  function maybeTriggerAutoCrossfade() {
    if (crossfadeInProgress || crossfadePending) return;
    if (state.isLoadingTrack) return;
    if (advancingToNext || advanceScheduled) return;
    if (!state.isPlaying || audio.paused || audio.ended) return;
    if (!hasValidTrack()) return;

    const { track, index } = getCurrentPlayingTrack();
    const trackDurationMs = getTrackDurationMs(track);
    const audioDurationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : null;

    // Preferir duração real do áudio se disponível e mais confiável
    const durationMs = Number.isFinite(audioDurationMs) ? audioDurationMs : trackDurationMs;
    if (!Number.isFinite(durationMs) || durationMs < MIN_CROSSFADE_TRACK_MS) return;

    const remainingMs = (durationMs - (audio.currentTime * 1000));
    const thresholdMs = Math.max(1500, CROSSFADE_DURATION_MS - 400);

    const key = `${state.playingPlaylistId || 'library'}-${index}-${durationMs}`;
    if (autoCrossfadeTriggeredKey === key) return;

    if (remainingMs <= thresholdMs) {
      const nextIndex = findNextPlayableForCrossfade();
      if (nextIndex !== -1) {
        autoCrossfadeTriggeredKey = key;
        const fromPlaying = hasLibraryPlaybackQueue();
        playTrackInternal(nextIndex, { fromPlayingTracks: fromPlaying, useCrossfade: true });
      }
    }
  }

  function resetAudioElement(element) {
    if (!element) return;
    try { element.pause(); } catch (_) { }
    try { element.removeAttribute('src'); } catch (_) { }
    try { element.load(); } catch (_) { }
  }

  // Função para resetar o elemento audio de forma segura
  function safeResetAudio(target = audio) {
    if (!target) return;
    ignoringErrorsSet.add(target);
    if (target === audio) {
      state.currentAttemptUrl = '';
    }
    try {
      target.pause();
      target.removeAttribute('src');
      target.load();
    } catch (_) { }
    // Restaura após um pequeno delay (captura ref para WeakSet)
    const ref = target;
    setTimeout(() => { ignoringErrorsSet.delete(ref); }, 100);
  }

  // Helper para resetar áudio e aguardar delay
  async function resetAudioWithDelay(target = audio) {
    safeResetAudio(target);
    await delay(AUDIO_RESET_DELAY_MS);
  }

  // Função para definir a URL do áudio e rastrear para marcação de falhas
  function setAudioSource(url, target = audio) {
    if (target === audio) {
      state.currentAttemptUrl = url || '';
    }
    target.src = url;
  }

  // Helper para definir URL e carregar áudio
  function loadAudioSource(url, target = audio) {
    setAudioSource(url, target);
    target.load();
  }

  // Event listeners para garantir reprodução estável
  const audioHandlers = {
    ended: () => {
      if (crossfadeInProgress || state.isLoadingTrack || advancingToNext || advanceScheduled) {
        // Já avançamos via crossfade; não dispare novo avanço
        return;
      }
      // Se a faixa terminou com pending stale, limpa e segue com avanço normal
      if (crossfadePending) {
        crossfadePending = false;
      }
      if (handlingEnded) return;
      handlingEnded = true;

      console.log(`🏁 [AUDIO] Track ended, playing next`);
      resetTrackEndFallback();
      stopPlaying();

      // Limpa timers de stalled/buffering para evitar reconexão desnecessária
      clearBufferingTimer();
      if (state.stalledTimer) {
        clearTimeout(state.stalledTimer);
        state.stalledTimer = null;
      }

      // Se estava tocando do YouTube, toca a próxima da busca
      if (isPlayingFromYouTube()) {
        stopYouTubeSearchCountdown();
        playNextYouTubeSearchResult();
        return;
      }

      const { track, index } = getCurrentPlayingTrack();
      const hasTrack = !!track && index >= 0;

      if (isLibraryPlaybackVisible() && hasTrack) {
        setTrackLoading(index, false); // Esconde spinner quando termina
        stopPlaybackCountdown({ resetLabel: true, index });
      } else {
        stopPlaybackCountdown({ resetLabel: false });
      }

      if (hasTrack) {
        const fromPlaying = hasLibraryPlaybackQueue();
        if (fromPlaying) {
          playNextFromPlaying(index + 1);
        } else {
          playNextFrom(index + 1);
        }
      }

      // Libera flag após fila atual
      queueMicrotask(() => { handlingEnded = false; });
    },
    error: (e) => {
      // Ignora erros durante reset do elemento
      if (ignoringErrorsSet.has(audio)) {
        console.log(`🔇 [AUDIO] Ignoring error during reset`);
        return;
      }
      if (isPlayingFromYouTube()) {
        console.warn(`⚠️ [AUDIO] Error during YouTube playback, skipping to next result`);
        stopYouTubeSearchCountdown();
        playNextYouTubeSearchResult();
        return;
      }
      if (!hasValidTrack()) {
        // Ignora erros causados por limpar o src antes de importar faixas
        return;
      }
      const errorCode = audio.error?.code;
      const label = errorCode ? ` (code ${errorCode})` : '';
      console.error(`❌ [AUDIO] Error event${label}:`, e);
      // Passa a URL atual que falhou
      const failedUrl = state.currentAttemptUrl || audio.currentSrc || audio.src || '';
      handleAudioError(e, failedUrl);
    },
    loadstart: () => {
      if (!hasValidTrack()) return;
      console.log(`📥 [AUDIO] Loading started`);
    },
    canplay: () => {
      console.log(`✅ [AUDIO] Can play`);
    },
    play: () => {
      handlePlaybackStarted();
    },
    pause: () => {
      state.isPlaying = false;
      updateUiState();
      stopPlaybackCountdown({ resetLabel: false });
      // Atualiza visual do YouTube
      if (isPlayingFromYouTube()) {
        updateYouTubeSearchHighlight();
        stopYouTubeSearchCountdown();
      }
    },
    stalled: () => {
      if (!hasValidTrack()) return;
      if (state.connectionLost || state.reconnectAttempts > 0) return;
      if (state.stalledTimer) return; // Já tem um timer pendente
      if (state.isLoadingTrack) return; // Ainda está carregando, não interferir
      // Só considera stalled se já estava tocando (currentTime > 0)
      // Durante carregamento inicial, stalled é normal e não deve disparar reconexão
      if (audio.currentTime === 0) return;

      // Aguarda antes de considerar como problema real
      state.stalledTimer = setTimeout(() => {
        state.stalledTimer = null;
        // Verifica se ainda está travado (não recebeu dados) E não está pausado pelo usuário
        // readyState < 3 = HAVE_FUTURE_DATA, significa que não tem dados suficientes
        // Também verifica se já estava tocando (currentTime > 0) para evitar falsos positivos
        if (audio.readyState < 3 && !audio.paused && !audio.ended && hasValidTrack() && !state.isLoadingTrack && audio.currentTime > 0) {
          console.warn(`⏸️ [AUDIO] Stalled persistente - conexão fraca detectada`);
          setTrackLoading(state.currentTrackIndex, true);
          handleSlowConnection();
        }
      }, STALLED_DELAY_MS);
    },
    waiting: () => {
      if (!hasValidTrack()) return;
      if (state.connectionLost || state.reconnectAttempts > 0) return;
      if (state.isBuffering) return; // Já está tratando
      if (state.isLoadingTrack) return; // Ainda está carregando, não interferir

      // Só loga se já estava tocando (buffering real, não carregamento inicial)
      if (audio.currentTime > 0) {
        console.warn(`⏳ [AUDIO] Buffering...`);
      }
      state.isBuffering = true;
      state.bufferingStartTime = Date.now();

      // Só mostra spinner se já estava tocando (não durante carregamento inicial)
      if (audio.currentTime > 0) {
        setTrackLoading(state.currentTrackIndex, true);
      }

      // Timer para detectar buffering muito longo (conexão fraca)
      state.bufferingTimer = setTimeout(() => {
        if (state.isBuffering && state.currentTrackIndex >= 0 && !state.isLoadingTrack) {
          console.warn(`🐢 [AUDIO] Buffering demorado (>${BUFFERING_TIMEOUT_MS}ms) - tentando reconectar`);
          handleSlowConnection();
        }
      }, BUFFERING_TIMEOUT_MS);
    },
    playing: () => {
      if (state.isBuffering) {
        const bufferingDuration = Date.now() - state.bufferingStartTime;
        if (bufferingDuration > SLOW_CONNECTION_THRESHOLD_MS) {
          console.warn(`🐢 [AUDIO] Conexão lenta - buffering levou ${(bufferingDuration / 1000).toFixed(1)}s`);
        }
        clearBufferingTimer();
        setTrackLoading(state.currentTrackIndex, false); // Esconde spinner após buffering
      }
      // Limpa estado de reconexão se estava tentando
      if (state.reconnectAttempts > 0) {
        console.log(`✅ [RECONNECT] Reprodução retomada com sucesso`);
        resetReconnectState();
      }
    },
    canplaythrough: () => {
      clearBufferingTimer();
    },
    durationchange: () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const track = state.tracks[state.currentTrackIndex];
      if (!track) return;
      
      const durationMs = Math.floor(audio.duration * 1000);
      if (!track.duration_ms || Math.abs(track.duration_ms - durationMs) > 1000) {
        track.duration_ms = durationMs;
        track.durationMs = durationMs;
        setTrackDurationLabel(state.currentTrackIndex, durationMs);
        // Força remoção dos handlers de seek quando a duração muda
        forceRemoveSeekHandlers();
      }
      // Re-agenda watchdog com a duração real agora disponível
      if (state.isPlaying && !audio.paused && !crossfadeInProgress) {
        scheduleTrackEndWatchdog();
      }
    },
    timeupdate: () => {
      maybeTriggerAutoCrossfade();
      maybeForceTrackEnd();
    }
  };

  function attachCoreAudioListeners(target) {
    if (!target) return;
    target.addEventListener('ended', audioHandlers.ended);
    target.addEventListener('error', audioHandlers.error);
    target.addEventListener('loadstart', audioHandlers.loadstart);
    target.addEventListener('canplay', audioHandlers.canplay);
    target.addEventListener('play', audioHandlers.play);
    target.addEventListener('pause', audioHandlers.pause);
    target.addEventListener('stalled', audioHandlers.stalled);
    target.addEventListener('waiting', audioHandlers.waiting);
    target.addEventListener('playing', audioHandlers.playing);
    target.addEventListener('canplaythrough', audioHandlers.canplaythrough);
    target.addEventListener('durationchange', audioHandlers.durationchange);
    target.addEventListener('timeupdate', audioHandlers.timeupdate);
  }

  function detachCoreAudioListeners(target) {
    if (!target) return;
    target.removeEventListener('ended', audioHandlers.ended);
    target.removeEventListener('error', audioHandlers.error);
    target.removeEventListener('loadstart', audioHandlers.loadstart);
    target.removeEventListener('canplay', audioHandlers.canplay);
    target.removeEventListener('play', audioHandlers.play);
    target.removeEventListener('pause', audioHandlers.pause);
    target.removeEventListener('stalled', audioHandlers.stalled);
    target.removeEventListener('waiting', audioHandlers.waiting);
    target.removeEventListener('playing', audioHandlers.playing);
    target.removeEventListener('canplaythrough', audioHandlers.canplaythrough);
    target.removeEventListener('durationchange', audioHandlers.durationchange);
    target.removeEventListener('timeupdate', audioHandlers.timeupdate);
  }

  attachCoreAudioListeners(audio);

  // Estado para controle de reconexão e buffering
  state.connectionLost = false;
  state.savedPlaybackTime = 0;
  state.reconnectAttempts = 0;
  state.reconnectTimer = null;
  state.bufferingTimer = null;
  state.isBuffering = false;
  state.bufferingStartTime = 0;
  state.stalledTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_INTERVAL_MS = 1500; // Reduzido de 3000ms para tentativas mais rápidas
  const BUFFERING_TIMEOUT_MS = 15000; // Reduzido de 30000ms
  const SLOW_CONNECTION_THRESHOLD_MS = 10000; // Aumentado para 10s - evita avisos frequentes
  const STALLED_DELAY_MS = 12000; // Aumentado para 12s - evita falsos positivos durante carregamento inicial

  // Limpa timers de buffering e stalled
  function clearBufferingTimer() {
    if (state.bufferingTimer) {
      clearTimeout(state.bufferingTimer);
      state.bufferingTimer = null;
    }
    if (state.stalledTimer) {
      clearTimeout(state.stalledTimer);
      state.stalledTimer = null;
    }
    state.isBuffering = false;
  }

  // Helper para resetar estado de reconexão
  function resetReconnectState() {
    state.reconnectAttempts = 0;
    state.savedPlaybackTime = 0;
  }

  // Trata conexão fraca - salva posição e tenta reconectar
  function handleSlowConnection() {
    if (state.reconnectAttempts > 0) return; // Já está tentando
    if (state.audioRecoveryInProgress) return; // Não interfere com recovery em andamento

    state.savedPlaybackTime = audio.currentTime || 0;
    clearBufferingTimer();

    // Tenta recarregar o áudio na mesma posição
    attemptReconnect();
  }

  // Detecta perda total de conexão do navegador
  window.addEventListener('offline', () => {
    if (!hasValidTrack()) return;
    console.warn(`📡 [NETWORK] Conexão perdida`);
    state.connectionLost = true;
    state.savedPlaybackTime = audio.currentTime || 0;
    clearBufferingTimer();
    setTrackLoading(state.currentTrackIndex, true); // Mostra spinner quando offline
    try {
      audio.pause();
    } catch (_) { }
    updateUiState();
  });

  // Detecta quando a conexão volta
  window.addEventListener('online', () => {
    console.log(`📡 [NETWORK] Conexão restaurada`);
    if (state.connectionLost && state.currentTrackIndex >= 0) {
      state.connectionLost = false;
      attemptReconnect();
    }
  });

  // Função para tentar reconectar e retomar reprodução
  async function attemptReconnect() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    const trackIndex = state.currentTrackIndex;
    if (trackIndex < 0 || !state.tracks[trackIndex]) return;

    const track = state.tracks[trackIndex];

    // Se offline, aguarda conexão voltar
    if (!navigator.onLine) {
      console.warn(`📡 [RECONNECT] Aguardando conexão...`);
      state.connectionLost = true;
      return;
    }

    // Se já está tocando normalmente, não precisa reconectar
    if (!audio.paused && audio.readyState >= 3) {
      console.log(`✅ [RECONNECT] Áudio já está tocando, cancelando reconexão`);
      resetReconnectState();
      clearBufferingTimer();
      return;
    }

    // Se a track terminou, não tenta reconectar - vai para próxima
    if (audio.ended) {
      console.log(`🏁 [RECONNECT] Track já terminou, pulando para próxima`);
      resetReconnectState();
      clearBufferingTimer();
      playNextFrom(trackIndex + 1);
      return;
    }

    state.reconnectAttempts++;
    setTrackLoading(trackIndex, true);
    console.log(`🔄 [RECONNECT] Tentativa ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} para faixa ${trackIndex}`);

    let attemptedUrl = '';
    try {
      // Pausa antes de tentar nova URL
      try { audio.pause(); } catch (_) { }
      await delay(AUDIO_RESET_DELAY_MS);

      // Busca uma nova URL (preserva falhas para continuar rotação)
      const forceRefresh = state.reconnectAttempts > 1;
      const resolved = await resolveTrackWithCache(track, trackIndex, { forceRefresh, preserveFailures: true });

      if (!resolved?.audioUrl) {
        throw new Error('Não foi possível obter URL de áudio');
      }

      attemptedUrl = resolved.audioUrl;
      console.log(`🔗 [RECONNECT] Nova URL obtida, tentando reproduzir...`);
      setAudioSource(resolved.audioUrl);

      // Aguarda o áudio estar pronto antes de tentar tocar (reduzido para 8s)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout aguardando canplay')), 8000);
        const onCanPlay = () => {
          clearTimeout(timeout);
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('canplaythrough', onCanPlayThrough);
          audio.removeEventListener('error', onError);
          resolve();
        };
        const onCanPlayThrough = onCanPlay;
        const onError = () => {
          clearTimeout(timeout);
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('canplaythrough', onCanPlayThrough);
          audio.removeEventListener('error', onError);
          reject(new Error('Erro ao carregar áudio'));
        };
        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
        audio.addEventListener('error', onError, { once: true });

        // Inicia o carregamento
        audio.load();
      });

      // Restaura posição de reprodução se possível
      if (state.savedPlaybackTime > 0 && isFinite(state.savedPlaybackTime)) {
        try {
          audio.currentTime = Math.max(0, state.savedPlaybackTime - 1); // Volta 1s para garantir
        } catch (_) { }
      }

      await audio.play();
      console.log(`✅ [RECONNECT] Reprodução retomada com sucesso`);
      resetReconnectState();
      clearBufferingTimer();
      updateUiState();
      return;
    } catch (error) {
      console.warn(`⚠️ [RECONNECT] Falha na tentativa ${state.reconnectAttempts}: ${error.message}`);
    }

    // Se ainda não atingiu o máximo de tentativas, agenda próxima
    if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const reconnectDelay = RECONNECT_INTERVAL_MS * Math.min(state.reconnectAttempts, 3); // Backoff progressivo
      console.log(`⏰ [RECONNECT] Próxima tentativa em ${reconnectDelay / 1000}s`);
      state.reconnectTimer = setTimeout(attemptReconnect, reconnectDelay);
    } else {
      console.warn(`❌ [RECONNECT] Máximo de tentativas atingido, pulando para próxima faixa`);
      resetReconnectState();
      clearBufferingTimer();
      setTrackLoading(trackIndex, false);
      // Pula para próxima faixa em vez de ficar parado
      skipUnavailableTrack(trackIndex);
    }
  }

  function updateUiState() {
    updateTrackHighlight();
    updateControlsBar();
    updateMediaSession();
  }

  // Media Session API - controles do sistema e informações da mídia
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    
    const { track, index } = getCurrentPlayingTrack();
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    
    const title = getTrackTitle(track) || 'Faixa desconhecida';
    const artist = getTrackArtists(track) || track.author || 'Artista desconhecido';
    const album = track.album?.name || state.currentPlaylist?.name || '';
    
    // Obtém a capa da faixa ou da playlist
    const artwork = [];
    const coverUrl = track.thumbnail || 
                    track.album?.images?.[0]?.url || 
                    state.currentPlaylist?.cover || 
                    state.currentPlaylist?.images?.[0]?.url;
    
    if (coverUrl) {
      artwork.push({ src: coverUrl, sizes: '512x512', type: 'image/jpeg' });
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork
    });
    
    // Atualiza o estado de reprodução
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    
    // Força remoção dos handlers de seek após atualizar metadata
    // Alguns navegadores podem resetar os handlers ao mudar metadata
    forceRemoveSeekHandlers();
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.setActionHandler('play', () => {
      if (audio.paused) {
        startPlaying();
        updateUiState();
        startPlaybackCountdown();
      }
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
      if (!audio.paused) {
        pausePlaying();
        updateUiState();
        stopPlaybackCountdown({ resetLabel: false });
      }
    });
    
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPreviousTrack();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNextTrack();
    });
    
    // Remove handlers de seek para garantir que apenas prev/next apareçam
    forceRemoveSeekHandlers();
  }

  // Força a remoção dos handlers de seek
  function forceRemoveSeekHandlers() {
    if (!('mediaSession' in navigator)) return;
    
    try {
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('seekto', null);
    } catch (e) {
      // Ignora erros se o navegador não suportar
    }
  }

  function resetPlaybackState(options = {}) {
    const {
      resetTrackIndex = true,
      clearTracks = false,
      clearCaches = false
    } = options;

    safeResetAudio();
    stopPlaying();
    state.audioRecoveryInProgress = false;
    
    // Reseta estado de reprodução
    state.playingPlaylistId = null;
    state.playingTrackIndex = -1;
    state.playingTracks = [];
    
    if (resetTrackIndex) {
      state.currentTrackIndex = -1;
    }
    if (clearTracks) {
      state.tracks = [];
    }
    if (clearCaches) {
      state.searchCache.clear();
      state.searchPromises.clear();
      state.audioCache.clear();
      state.audioErrorCounts.clear();
    }
    updateUiState();
  }

  function getTrackKey(track) {
    if (!track) return '';
    const baseName = getTrackTitle(track);
    const artistNames = getTrackArtists(track).replace(/, /g, ',');
    return track.id || track.isrc || `${baseName}-${artistNames}`;
  }

  let feedbackTimeout = null;

  function setFeedback(message, variant = 'info', playlistInfo = null) {
    if (!ui.feedback) return;
    
    // Limpa timeout anterior se existir
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
      feedbackTimeout = null;
    }
    
    // Ícones por variante
    const variantIcons = {
      success: 'ph-check-circle',
      error: 'ph-x-circle',
      info: 'ph-info',
      warning: 'ph-warning'
    };
    
    // Mostra informações se fornecidas (playlist ou track)
    if (playlistInfo && playlistInfo.name) {
      if (ui.feedbackTitle) {
        ui.feedbackTitle.textContent = playlistInfo.name;
        ui.feedbackTitle.classList.remove('hidden');
      }
      if (ui.feedbackCover && playlistInfo.cover) {
        ui.feedbackCover.src = playlistInfo.cover;
        ui.feedbackCover.alt = playlistInfo.name;
        ui.feedbackCover.classList.remove('hidden');
      } else if (ui.feedbackCover) {
        ui.feedbackCover.classList.add('hidden');
      }
      if (ui.feedbackIcon) ui.feedbackIcon.classList.add('hidden');
      
      // Texto: mensagem principal + subtitle/trackCount
      if (ui.feedbackText) {
        let text = message || '';
        if (playlistInfo.subtitle) {
          text = text ? `${text} • ${playlistInfo.subtitle}` : playlistInfo.subtitle;
        } else if (playlistInfo.trackCount !== undefined) {
          const trackText = `${playlistInfo.trackCount} ${playlistInfo.trackCount === 1 ? 'faixa' : 'faixas'}`;
          text = text ? `${text} • ${trackText}` : trackText;
        }
        ui.feedbackText.textContent = text;
      }
    } else {
      // Mostra ícone ao invés da capa
      if (ui.feedbackCover) ui.feedbackCover.classList.add('hidden');
      if (ui.feedbackTitle) ui.feedbackTitle.classList.add('hidden');
      if (ui.feedbackText) ui.feedbackText.textContent = message || '';
      if (ui.feedbackIcon && message) {
        const iconClass = variantIcons[variant] || variantIcons.info;
        ui.feedbackIcon.innerHTML = `<i class="ph-bold ${iconClass} text-xl"></i>`;
        ui.feedbackIcon.className = 'w-11 h-11 rounded-xl flex items-center justify-center';
        ui.feedbackIcon.classList.add(variant);
        ui.feedbackIcon.classList.remove('hidden');
      } else if (ui.feedbackIcon) {
        ui.feedbackIcon.classList.add('hidden');
      }
    }
    
    if (message || playlistInfo) {
      ui.feedback.classList.add('visible');
      ui.feedback.classList.remove('opacity-0', 'invisible');
      
      // Auto-fecha após 4 segundos
      feedbackTimeout = setTimeout(() => {
        closeFeedback();
      }, 4000);
    } else {
      hideVisibleElement(ui.feedback);
    }
  }

  function closeFeedback() {
    if (!ui.feedback) return;
    
    // Limpa o timeout se existir
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
      feedbackTimeout = null;
    }
    
    hideVisibleElement(ui.feedback);
  }

  function openImportInfoModal() {
    if (!ui.importInfoModal) return;
    
    ui.importInfoModal.classList.remove('opacity-0', 'invisible');
    ui.importInfoModal.classList.add('opacity-100', 'visible');
    ui.importInfoModal.style.pointerEvents = 'auto';
    
    const card = ui.importInfoModal.querySelector('div[class*="scale-95"]');
    if (card) {
      setTimeout(() => {
        card.style.transform = 'scale(1)';
      }, 10);
    }
  }

  function closeImportInfoModal() {
    if (!ui.importInfoModal) return;
    
    const card = ui.importInfoModal.querySelector('div[class*="scale-95"]');
    if (card) {
      card.style.transform = 'scale(0.95)';
    }
    
    setTimeout(() => {
      ui.importInfoModal.classList.add('opacity-0', 'invisible');
      ui.importInfoModal.classList.remove('opacity-100', 'visible');
      ui.importInfoModal.style.pointerEvents = 'none';
    }, 150);
  }

  function waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // Helper para aguardar um frame (layout)
  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function bindUi() {
    ui.emptyStateImportBtn?.addEventListener('click', openFilePicker);
    ui.reimportBtn?.addEventListener('click', openFilePicker);
    ui.fileInput?.addEventListener('change', handleFileSelection);
    ui.closePlayerBtn?.addEventListener('click', closePlayerModal);
    ui.feedbackClose?.addEventListener('click', closeFeedback);
    
    // Modal de informações sobre importação
    ui.importInfoBtn?.addEventListener('click', openImportInfoModal);
    ui.closeImportInfoBtn?.addEventListener('click', closeImportInfoModal);
    ui.importInfoModal?.addEventListener('click', (e) => {
      if (e.target === ui.importInfoModal) closeImportInfoModal();
    });
    
    ui.playerModal?.addEventListener('click', (event) => {
      if (event.target === ui.playerModal) closePlayerModal();
    });
    // Captura eventos wheel na fase de captura para redirecionar ao playlists-container
    setupPlaylistsWheelCapture();
    enableDragScroll(ui.playlistsContainer);

    // Tabs do player
    ui.tabDiscover?.addEventListener('click', () => switchPlayerTab('discover'));
    ui.tabPlaylist?.addEventListener('click', () => switchPlayerTab('playlist'));
    ui.tabYoutube?.addEventListener('click', () => switchPlayerTab('youtube'));

    // Botão de busca do YouTube (abre a barra de busca)
    ui.youtubeSearchTrigger?.addEventListener('click', openYoutubeSearchBar);
    ui.youtubeSearchCancel?.addEventListener('click', closeYoutubeSearchBar);
    ui.youtubeSearchOverlay?.addEventListener('click', closeYoutubeSearchBar);

    // Toggle de tipo de busca (faixas/playlists)
    ui.searchTypeTracks?.addEventListener('click', () => setSearchType('tracks'));
    ui.searchTypePlaylists?.addEventListener('click', () => setSearchType('playlists'));

    // Scroll do YouTube com efeito progressivo no header + infinite scroll
    ui.youtubeSearchContent?.addEventListener('scroll', handleYoutubeScroll, { passive: true });

    // Busca manual
    ui.manualSearchInput?.addEventListener('input', (e) => {
      const hasText = e.target.value.trim().length > 0;
      if (ui.manualSearchBtn) ui.manualSearchBtn.disabled = !hasText;
    });
    ui.manualSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !ui.manualSearchBtn?.disabled) {
        performManualSearch();
      }
      if (e.key === 'Escape') {
        closeYoutubeSearchBar();
      }
    });
    ui.manualSearchBtn?.addEventListener('click', performManualSearch);

    // Playlist picker modal
    ui.closePlaylistPickerBtn?.addEventListener('click', closePlaylistPicker);
    ui.playlistPickerModal?.addEventListener('click', (e) => {
      if (e.target === ui.playlistPickerModal) closePlaylistPicker();
    });
    ui.showNewPlaylistBtn?.addEventListener('click', showNewPlaylistForm);
    ui.cancelNewPlaylistBtn?.addEventListener('click', hideNewPlaylistForm);
    ui.confirmNewPlaylistBtn?.addEventListener('click', createNewPlaylistAndAdd);
    ui.newPlaylistName?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createNewPlaylistAndAdd();
      if (e.key === 'Escape') hideNewPlaylistForm();
    });

    // Player Controls Bar
    bindPlayerControlsBar();
  }

  // === Player Controls Bar ===
  function bindPlayerControlsBar() {
    ui.ctrlPlay?.addEventListener('click', togglePlayback);
    ui.ctrlPrev?.addEventListener('click', playPreviousTrack);
    ui.ctrlNext?.addEventListener('click', playNextTrack);
    ui.ctrlShuffle?.addEventListener('click', toggleShuffle);
    ui.ctrlRepeat?.addEventListener('click', toggleRepeat);
    ui.ctrlVolumeBtn?.addEventListener('click', () => toggleVolumeSlider('volume-slider-container'));
    ui.ctrlVolume?.addEventListener('input', handleVolumeChange);
    ui.ctrlVolume?.addEventListener('change', handleVolumeChange);
    
    // Touch support para volume slider
    if (ui.ctrlVolume) {
      setupVolumeTouchEvents(ui.ctrlVolume);
    }

    const volumeContainer = ui.volumeContainer;
    const miniVolumeContainer = ui.miniVolumeContainer;

    const restoreControlsCenter = (selector) => {
      const controlsCenter = document.querySelector(selector);
      if (!controlsCenter) return;
      controlsCenter.style.opacity = '';
      controlsCenter.style.width = '';
      controlsCenter.style.overflow = '';
      controlsCenter.style.margin = '';
      controlsCenter.style.padding = '';
    };

    const closeVolumeContainer = (container, selector) => {
      if (!container?.classList.contains('visible')) return;
      container.classList.remove('visible');
      restoreControlsCenter(selector);
    };

    // === Mini Player Bar ===
    ui.miniPlay?.addEventListener('click', togglePlayback);
    ui.miniPrev?.addEventListener('click', playPreviousTrack);
    ui.miniNext?.addEventListener('click', playNextTrack);
    ui.miniShuffle?.addEventListener('click', toggleShuffle);
    ui.miniRepeat?.addEventListener('click', toggleRepeat);
    ui.miniVolumeBtn?.addEventListener('click', () => toggleVolumeSlider('mini-volume-slider-container'));
    ui.miniVolume?.addEventListener('input', handleVolumeChange);
    ui.miniVolume?.addEventListener('change', handleVolumeChange);
    
    // Touch support para mini volume slider
    if (ui.miniVolume) {
      setupVolumeTouchEvents(ui.miniVolume);
    }

    // Fecha sliders ao clicar fora
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.volume-control')) {
        closeVolumeContainer(volumeContainer, '#player-controls-bar .controls-center');
      }
      if (!e.target.closest('#mini-player-bar .volume-control')) {
        closeVolumeContainer(miniVolumeContainer, '#mini-player-bar .controls-center');
      }
    });

    // Clique no mini-player abre o modal do player
    ui.miniPlayerBar?.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('.volume-slider-container')) {
        openPlayerModal();
      }
    });

    // Inicializa o visual dos sliders
    updateAllVolumeSliders(100);
  }

  // Estado de shuffle e repeat
  let shuffleEnabled = false;
  let repeatEnabled = false;

  // Funções para controle da barra de busca do YouTube
  function openYoutubeSearchBar() {
    if (ui.youtubeSearchOverlay) {
      ui.youtubeSearchOverlay.style.backdropFilter = 'blur(8px)';
      ui.youtubeSearchOverlay.style.webkitBackdropFilter = 'blur(8px)';
      showElementWithFade(ui.youtubeSearchOverlay);
      ui.youtubeSearchOverlay.classList.add('visible');
    }
    
    showElementWithFade(ui.youtubeSearchBarWrapper);
    ui.youtubeSearchBtnContainer?.classList.add('hidden-for-search');
    
    // Foca no input e abre o teclado
    setTimeout(() => {
      ui.manualSearchInput?.focus();
    }, 100);
  }
  
  function closeYoutubeSearchBar(clearInput = true) {
    if (ui.youtubeSearchOverlay) {
      ui.youtubeSearchOverlay.classList.remove('visible');
      hideElementWithFade(ui.youtubeSearchOverlay);
      ui.youtubeSearchOverlay.style.backdropFilter = 'none';
      ui.youtubeSearchOverlay.style.webkitBackdropFilter = 'none';
    }
    
    hideElementWithFade(ui.youtubeSearchBarWrapper);
    ui.youtubeSearchBtnContainer?.classList.remove('hidden-for-search');
    
    // Limpa o input e remove foco apenas se solicitado
    if (clearInput) {
      if (ui.manualSearchInput) {
        ui.manualSearchInput.value = '';
      }
      if (ui.manualSearchBtn) {
        ui.manualSearchBtn.disabled = true;
      }
    }
    
    ui.manualSearchInput?.blur();
  }

  // Função unificada para toggle de volume slider
  function toggleVolumeSlider(containerId = 'volume-slider-container') {
    const container = document.getElementById(containerId);
    container?.classList.toggle('visible');
    
    // Determina qual controls-center ocultar baseado no container
    const isMini = containerId === 'mini-volume-slider-container';
    const controlsCenter = isMini 
      ? document.querySelector('#mini-player-bar .controls-center')
      : document.querySelector('#player-controls-bar .controls-center');
    
    if (controlsCenter) {
      if (container?.classList.contains('visible')) {
        controlsCenter.style.opacity = '0';
        controlsCenter.style.width = '0';
        controlsCenter.style.overflow = 'hidden';
        controlsCenter.style.margin = '0';
        controlsCenter.style.padding = '0';
      } else {
        controlsCenter.style.opacity = '';
        controlsCenter.style.width = '';
        controlsCenter.style.overflow = '';
        controlsCenter.style.margin = '';
        controlsCenter.style.padding = '';
      }
    }
  }

  // Setup touch events para volume sliders (mobile)
  function setupVolumeTouchEvents(slider) {
    let isDragging = false;
    
    const updateVolumeFromTouch = (e) => {
      const touch = e.touches[0] || e.changedTouches[0];
      const rect = slider.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      slider.value = Math.round(percentage);
      setUserVolume(percentage / 100);
      updateAllVolumeSliders(Math.round(percentage));
    };
    
    slider.addEventListener('touchstart', (e) => {
      isDragging = true;
      e.stopPropagation();
      updateVolumeFromTouch(e);
    }, { passive: true });
    
    slider.addEventListener('touchmove', (e) => {
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
        updateVolumeFromTouch(e);
      }
    }, { passive: false });
    
    slider.addEventListener('touchend', (e) => {
      if (isDragging) {
        isDragging = false;
        e.stopPropagation();
      }
    }, { passive: true });
    
    // Previne que o container feche ao interagir com o slider
    slider.parentElement?.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });
    
    slider.parentElement?.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  // Função unificada para atualizar volume
  function handleVolumeChange(e) {
    const value = parseInt(e.target.value);
    setUserVolume(value / 100);
    updateAllVolumeSliders(value);
  }

  // Atualiza todos os sliders e ícones de volume
  function updateAllVolumeSliders(value) {
    const sliders = [ui.ctrlVolume, ui.miniVolume];
    const buttons = [ui.ctrlVolumeBtn, ui.miniVolumeBtn];

    sliders.forEach(slider => {
      if (slider) {
        slider.value = value;
        slider.style.background = `linear-gradient(to right, rgba(255,255,255,0.95) ${value}%, rgba(255,255,255,0.25) ${value}%)`;
      }
    });

    buttons.forEach(btn => {
      const icon = btn?.querySelector('i');
      if (icon) {
        if (value === 0) {
          icon.className = 'ph-bold ph-speaker-x';
        } else if (value < 50) {
          icon.className = 'ph-bold ph-speaker-low';
        } else {
          icon.className = 'ph-bold ph-speaker-high';
        }
      }
    });
  }

  // Obtém a track atual de reprodução
  function getCurrentPlayingTrack() {
    if (isPlayingFromYouTube()) {
      const tracks = state.playingTracks;
      const currentIndex = state.playingTrackIndex;
      return { track: tracks[currentIndex] || null, index: currentIndex, tracks };
    }

    const tracks = hasLibraryPlaybackQueue() ? state.playingTracks : state.tracks;
    const currentIndex = hasLibraryPlaybackQueue() ? state.playingTrackIndex : state.currentTrackIndex;
    return { track: tracks[currentIndex] || null, index: currentIndex, tracks };
  }

  function playPreviousTrack(options) {
    const useCrossfade = options?.useCrossfade === true;

    // Se estiver reproduzindo no YouTube, usa a função específica
    if (isPlayingFromYouTube()) {
      playPreviousYouTubeSearchResult();
      return;
    }

    const { tracks, index } = getCurrentPlayingTrack();
    if (!tracks.length) return;
    let prevIndex = index - 1;
    if (prevIndex < 0) prevIndex = repeatEnabled ? tracks.length - 1 : 0;
    const shouldCrossfade = useCrossfade && prevIndex !== index;
    playTrackInternal(prevIndex, {
      fromPlayingTracks: hasLibraryPlaybackQueue(),
      useCrossfade: shouldCrossfade ? true : null
    });
  }

  function playNextTrack(options) {
    const useCrossfade = options?.useCrossfade === true;

    // Se estiver reproduzindo no YouTube, usa a função específica
    if (isPlayingFromYouTube()) {
      playNextYouTubeSearchResult();
      return;
    }

    const { tracks, index } = getCurrentPlayingTrack();
    if (!tracks.length) return;
    let nextIndex = index + 1;
    if (nextIndex >= tracks.length) nextIndex = repeatEnabled ? 0 : -1;
    if (nextIndex === -1) return;
    const shouldCrossfade = useCrossfade && nextIndex !== index;
    playTrackInternal(nextIndex, {
      fromPlayingTracks: hasLibraryPlaybackQueue(),
      useCrossfade: shouldCrossfade ? true : null
    });
  }

  // Helper para atualizar cor de botão de controle (ativo/inativo)
  function setControlButtonColor(ctrlId, miniId, isActive) {
    const color = isActive ? '#ff7a1f' : 'rgba(255,255,255,0.4)';
    document.getElementById(ctrlId)?.style.setProperty('color', color);
    document.getElementById(miniId)?.style.setProperty('color', color);
  }

  // Helper para toggle de visibilidade de tela
  function toggleScreen(screen, isVisible) {
    if (!screen) return;
    screen.classList.toggle('hidden', !isVisible);
    screen.style.display = isVisible ? 'flex' : 'none';
  }

  // Helper para toggle de visibilidade (invisible + opacity-0)
  // Nota: NÃO gerencia pointer-events aqui; overlay containers usam CSS
  function toggleElementVisibility(el, show) {
    if (!el) return;
    el.classList.toggle('invisible', !show);
    el.classList.toggle('opacity-0', !show);
  }

  // Helper para mostrar elemento com fade
  function showElementWithFade(el) {
    if (!el) return;
    el.style.opacity = '1';
    el.style.visibility = 'visible';
    el.style.pointerEvents = 'auto';
  }

  // Helper para esconder elemento com fade
  function hideElementWithFade(el) {
    if (!el) return;
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
  }

  // Helper para esconder elemento com classe visible
  function hideVisibleElement(el) {
    if (!el) return;
    el.classList.remove('visible');
    el.classList.add('opacity-0', 'invisible');
    el.style.pointerEvents = 'none';
  }

  function openScaledModal(modal, card) {
    if (!modal || !card) return;

    modal.classList.remove('opacity-0', 'invisible');
    modal.classList.add('opacity-100');
    modal.style.pointerEvents = 'auto';

    card.classList.remove('scale-95');
    card.classList.add('scale-100');

    requestAnimationFrame(() => {
      card.style.transform = 'scale(1)';
    });
  }

  function toggleShuffle() {
    shuffleEnabled = !shuffleEnabled;
    updateShuffleRepeatButtons();
  }

  function toggleRepeat() {
    repeatEnabled = !repeatEnabled;
    updateShuffleRepeatButtons();
  }

  function updateShuffleRepeatButtons() {
    setControlButtonColor('ctrl-shuffle', 'mini-shuffle', shuffleEnabled);
    setControlButtonColor('ctrl-repeat', 'mini-repeat', repeatEnabled);
  }

  // Função auxiliar para atualizar informações de uma player bar
  function updatePlayerBarInfo(elements, track) {
    const { playBtn, titleEl, artistEl, coverEl } = elements;

    const playIcon = playBtn?.querySelector('i');
    if (playIcon) {
      playIcon.className = state.isPlaying ? 'ph-bold ph-pause' : 'ph-bold ph-play';
    }

    coverEl?.classList.toggle('playing', state.isPlaying);

    if (track) {
      if (titleEl) titleEl.textContent = getTrackTitle(track) || 'Sem título';
      if (artistEl) {
        const artists = getTrackArtists(track);
        artistEl.textContent = artists || '—';
      }
      const coverImg = coverEl?.querySelector('img');
      if (coverImg) {
        const coverUrl = getTrackImage(track);
        if (coverUrl && coverUrl !== coverImg.src) coverImg.src = coverUrl;
      }
    } else {
      if (titleEl) titleEl.textContent = 'Nenhuma música';
      if (artistEl) artistEl.textContent = '—';
      const coverImg = coverEl?.querySelector('img');
      if (coverImg) coverImg.src = getFallbackCover();
    }
  }

  function updateControlsBar() {
    const { track } = getCurrentPlayingTrack();
    updatePlayerBarInfo({
      playBtn: ui.ctrlPlay,
      titleEl: ui.ctrlTitle,
      artistEl: ui.ctrlArtist,
      coverEl: ui.ctrlCover
    }, track);
    updateMiniPlayerBar();
  }

  function updateMiniPlayerBar() {
    const isModalOpen = ui.playerModal && !ui.playerModal.classList.contains('invisible');
    const { track, index } = getCurrentPlayingTrack();
    const shouldShow = index >= 0 && track && !isModalOpen;

    ui.miniPlayerBar?.classList.toggle('visible', shouldShow);

    // Sincroniza estado de shuffle e repeat
    updateShuffleRepeatButtons();

    updatePlayerBarInfo({
      playBtn: ui.miniPlay,
      titleEl: ui.miniTitle,
      artistEl: ui.miniArtist,
      coverEl: ui.miniCover
    }, track);
  }

  function switchPlayerTab(tab) {
    const isDiscover = tab === 'discover';
    const isPlaylist = tab === 'playlist';
    const isYoutube = tab === 'youtube';

    // Atualiza tabs - apenas toggle da classe active
    ui.tabDiscover?.classList.toggle('active', isDiscover);
    ui.tabPlaylist?.classList.toggle('active', isPlaylist);
    ui.tabYoutube?.classList.toggle('active', isYoutube);

    // Atualiza telas
    toggleScreen(ui.screenDiscover, isDiscover);
    toggleScreen(ui.screenPlaylist, isPlaylist);
    toggleScreen(ui.screenYoutube, isYoutube);
    
    // Sempre esconde a barra de busca ao trocar de aba
    hideElementWithFade(ui.youtubeSearchBarWrapper);
    
    if (ui.youtubeSearchBtnContainer) {
      ui.youtubeSearchBtnContainer.classList.remove('hidden-for-search');
      if (isYoutube) {
        ui.youtubeSearchBtnContainer.classList.add('visible');
        showElementWithFade(ui.youtubeSearchBtnContainer);
      } else {
        ui.youtubeSearchBtnContainer.classList.remove('visible');
        hideElementWithFade(ui.youtubeSearchBtnContainer);
      }
    }
    
    // Não foca automaticamente no input ao trocar para YouTube
    // O foco acontece ao clicar no botão de busca

    // Recalcula posições do carrossel 3D ao mostrar a aba Biblioteca
    if (isPlaylist) {
      requestAnimationFrame(() => {
        updateCarouselPositions();
        setupTracksScrollEffect();
        setTimeout(updateCarouselPositions, 100);
      });
    }
  }

  // Renderiza as playlists especiais na tela Descobrir
  function renderSpecialPlaylists() {
    if (!ui.specialPlaylistsGrid || typeof SPECIAL_PLAYLISTS === 'undefined') return;

    ui.specialPlaylistsGrid.innerHTML = SPECIAL_PLAYLISTS.map(playlist => {
      const trackCount = getPlaylistTrackCount(playlist);
      return `
        <div class="special-playlist-card group cursor-pointer rounded-xl overflow-hidden bg-yellow-500/10 hover:bg-yellow-500/20 transition-all duration-300 hover:scale-[1.02] ring-1 ring-yellow-500/20" 
             data-special-id="${playlist.id}">
          <div class="relative aspect-square">
            <img src="${playlist.cover}" 
                 alt="${playlist.name}" 
                 class="w-full h-full object-cover"
                 onerror="this.src='src/imagens/genericCover.png'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <div class="absolute top-2 right-2">
              <i class="ph-fill ph-lightning text-orange-500 text-lg drop-shadow-lg"></i>
            </div>
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="special-play-btn w-14 h-14 rounded-full bg-yellow-500 hover:bg-yellow-600 flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                <i class="ph-fill ph-play text-2xl text-black ml-1"></i>
              </button>
            </div>
            <div class="absolute bottom-0 left-0 right-0 p-3">
              <p class="text-white font-semibold text-sm truncate">${playlist.name}</p>
              <p class="text-yellow-500/80 text-xs">${trackCount} músicas</p>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners para as playlists especiais
    ui.specialPlaylistsGrid.querySelectorAll('.special-playlist-card').forEach(card => {
      const specialId = card.dataset.specialId;
      const specialPlaylist = SPECIAL_PLAYLISTS.find(p => p.id === specialId);

      if (!specialPlaylist) return;

      // Clique no card - seleciona a playlist
      card.addEventListener('click', (e) => {
        if (e.target.closest('.special-play-btn')) return;
        selectFeaturedPlaylist(specialPlaylist, false);
      });

      // Clique no botão play - toca imediatamente
      card.querySelector('.special-play-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFeaturedPlaylist(specialPlaylist, true);
      });
    });
  }

  // Renderiza as playlists em destaque na tela Descobrir
  function renderFeaturedPlaylists() {
    if (!ui.featuredPlaylistsGrid) return;

    ui.featuredPlaylistsGrid.innerHTML = FEATURED_PLAYLISTS.map(playlist => {
      const trackCount = getPlaylistTrackCount(playlist);
      return `
        <div class="featured-playlist-card group cursor-pointer rounded-xl overflow-hidden bg-white/5 hover:bg-white/10 transition-all duration-300 hover:scale-[1.02]" 
             data-featured-id="${playlist.id}">
          <div class="relative aspect-square">
            <img src="${playlist.cover}" 
                 alt="${playlist.name}" 
                 class="w-full h-full object-cover"
                 onerror="this.src='src/imagens/genericCover.png'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="featured-play-btn w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                <i class="ph-fill ph-play text-2xl text-white ml-1"></i>
              </button>
            </div>
            <div class="absolute bottom-0 left-0 right-0 p-3">
              <p class="text-white font-semibold text-sm truncate">${playlist.name}</p>
              <p class="text-white/60 text-xs">${trackCount} músicas</p>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners para as playlists em destaque
    ui.featuredPlaylistsGrid.querySelectorAll('.featured-playlist-card').forEach(card => {
      const featuredId = card.dataset.featuredId;
      const featuredPlaylist = FEATURED_PLAYLISTS.find(p => p.id === featuredId);

      if (!featuredPlaylist) return;

      // Clique no card - seleciona a playlist
      card.addEventListener('click', (e) => {
        if (e.target.closest('.featured-play-btn')) return;
        selectFeaturedPlaylist(featuredPlaylist, false);
      });

      // Clique no botão play - toca imediatamente
      card.querySelector('.featured-play-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFeaturedPlaylist(featuredPlaylist, true);
      });
    });
  }

  // Seleciona uma playlist em destaque e carrega suas músicas
  async function selectFeaturedPlaylist(featuredPlaylist, autoPlay = false) {
    if (!featuredPlaylist) return;

    setFeedback('Carregando...', 'info', {
      name: featuredPlaylist.name,
      cover: featuredPlaylist.cover,
      trackCount: featuredPlaylist.tracks.length
    });

    // Cria uma cópia da playlist para não modificar a original
    const playlist = {
      id: featuredPlaylist.id,
      name: featuredPlaylist.name,
      cover: featuredPlaylist.cover,
      images: [{ url: featuredPlaylist.cover }],
      tracks: featuredPlaylist.tracks.map(t => ({
        ...t,
        videoId: t.videoId, // Preserva videoId explicitamente
        duration_ms: t.duration_ms || 0,
        album: { name: 'Featured', images: [{ url: featuredPlaylist.cover }] }
      })),
      isFeatured: true
    };

    // Verifica se já existe nas playlists do usuário
    const existingIndex = state.playlists.findIndex(p => p.id === playlist.id);
    if (existingIndex === -1) {
      // Adiciona às playlists do usuário
      state.playlists.push(playlist);
      savePlaylistsToStorage();
      renderPlaylists();
    }

    // Seleciona a playlist
    state.currentPlaylist = playlist;
    state.tracks = [...playlist.tracks];
    state.currentTrackIndex = -1;

    // Muda para a aba Biblioteca
    switchPlayerTab('playlist');

    // Renderiza as faixas
    renderTracks(state.tracks);

    setFeedback('Carregada com sucesso!', 'success', {
      name: playlist.name,
      cover: playlist.cover,
      trackCount: playlist.tracks.length
    });

    // Pré-carrega as faixas em background
    preloadTracksInBackground(state.tracks);

    // Enriquece com capas
    enrichTracksWithCovers(state.tracks);

    // Auto-play se solicitado
    if (autoPlay && state.tracks.length > 0) {
      setTimeout(() => playTrack(0), 300);
    }
  }

  function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // Injeta o HTML do player antes de inicializar
        const htmlInjected = await injectPlayerHtml();
        if (!htmlInjected) {
          console.error('❌ [PLAYER] Não foi possível inicializar - HTML não carregado');
          initPromise = null;
          return;
        }

        // Popula os elementos do UI após o HTML ser injetado
        populateUiElements();

        resetPlaybackState({ resetTrackIndex: true, clearTracks: true, clearCaches: false });

        // Carrega cache de áudio do storage
        loadAudioCacheFromStorage();

        // Carrega playlists salvas
        const savedPlaylists = loadPlaylistsFromStorage();
        if (savedPlaylists.length > 0) {
          state.playlists = savedPlaylists;
          state.playlistsLoaded = true;
        }

        // Carrega a playlist fixa "Músicas Favoritas"
        ensureWatchLaterPlaylist();
        renderPlaylists();

        // Renderiza playlists especiais e em destaque
        renderSpecialPlaylists();
        renderFeaturedPlaylists();

        // Restaura estado anterior (playlist e track selecionados)
        const savedState = loadCurrentStateFromStorage();
        if (savedState?.currentPlaylistId && state.playlists.length > 0) {
          const playlist = state.playlists.find(p => p.id === savedState.currentPlaylistId);
          if (playlist && playlist.tracks?.length > 0) {
            state.currentPlaylist = playlist;
            state.tracks = playlist.tracks || [];
            state.currentTrackIndex = savedState.currentTrackIndex ?? -1;

            // Renderiza as faixas da playlist restaurada
            refreshTracksView();
          }
        }

        bindUi();
        
        // Configura Media Session API para controles do sistema
        setupMediaSessionHandlers();
        
        // Reforça periodicamente a remoção dos handlers de seek
        // Alguns navegadores podem tentar reativá-los automaticamente
        setInterval(() => {
          if (state.isPlaying) {
            forceRemoveSeekHandlers();
          }
        }, 5000); // A cada 5 segundos

        // Salva ao fechar/recarregar a página
        window.addEventListener('beforeunload', saveAllData);

        initCompleted = true;
      } catch (error) {
        initPromise = null;
        console.error('❌ [PLAYER] Erro ao inicializar:', error);
      }
    })();

    return initPromise;
  }

  function openModal() {
    if (!initCompleted) {
      init().then(() => {
        if (initCompleted) {
          openModal();
        }
      });
      return;
    }

    setFeedback('');
    openPlayerModal();
    updatePlaylistEmptyState();
  }

  function openPlayerModal() {
    togglePlayerModal(true);
  }

  function closePlayerModal() {
    setFeedback('');
    togglePlayerModal(false);
  }

  function togglePlayerModal(show) {
    const modal = ui.playerModal;
    const controlsBar = document.getElementById('player-controls-bar');
    const tabsBar = document.getElementById('player-tabs-bar');
    const feedbackBar = document.getElementById('player-feedback');
    const headerButtons = document.getElementById('player-header-buttons');
    if (!modal) return;

    if (show) {
      lockBodyScroll();
      modal.removeAttribute('inert');
      modal.style.pointerEvents = 'auto';
      updatePlaylistEmptyState();
    } else {
      modal.setAttribute('inert', '');
      modal.style.pointerEvents = 'none';
      unlockBodyScroll();
      // Esconde o feedback ao fechar o modal
      hideVisibleElement(feedbackBar);
    }

    toggleElementVisibility(modal, show);
    toggleElementVisibility(controlsBar, show);
    toggleElementVisibility(tabsBar, show);
    toggleElementVisibility(headerButtons, show);

    // Esconder barra de busca do YouTube ao fechar o modal
    // Ou mostrar botão se a aba YouTube estiver ativa ao abrir
    if (ui.youtubeSearchBarWrapper) {
      if (!show) {
        hideElementWithFade(ui.youtubeSearchBarWrapper);
        
        // Esconde também o botão de busca e o overlay
        if (ui.youtubeSearchBtnContainer) {
          ui.youtubeSearchBtnContainer.classList.remove('visible');
          hideElementWithFade(ui.youtubeSearchBtnContainer);
        }
        if (ui.youtubeSearchOverlay) {
          ui.youtubeSearchOverlay.classList.remove('visible');
          hideElementWithFade(ui.youtubeSearchOverlay);
        }
      } else {
        // Verifica se a aba YouTube está ativa
        const isYoutubeActive = ui.tabYoutube?.classList.contains('active');
        if (isYoutubeActive && ui.youtubeSearchBtnContainer) {
          // Mostra o botão de busca, não a barra
          ui.youtubeSearchBtnContainer.classList.add('visible');
          ui.youtubeSearchBtnContainer.classList.remove('hidden-for-search');
          showElementWithFade(ui.youtubeSearchBtnContainer);
        }
      }
    }

    // Atualiza o mini-player (esconde quando modal abre, mostra quando fecha)
    updateMiniPlayerBar();
  }

  function updatePlaylistEmptyState() {
    // Verifica se há playlists visíveis no container
    const hasVisiblePlaylists = ui.playlistsContainer && ui.playlistsContainer.children.length > 0;
    if (ui.playlistEmptyState) {
      ui.playlistEmptyState.classList.toggle('hidden', hasVisiblePlaylists);
    }
  }

  function openFilePicker() {
    if (!ui.fileInput) return;
    ui.fileInput.value = '';
    // Pequeno delay evita bloqueios de focus pelo modal
    setTimeout(() => ui.fileInput?.click(), 60);
  }

  function handleFileSelection(event) {
    const file = event.target?.files?.[0];
    if (!file) {
      return;
    }
    importPlaylistFromCsv(file);
  }

  function getFallbackCover() {
    return 'src/imagens/genericCover.png';
  }

  function getPlaylistNameFromFile(name = '') {
    const cleaned = name.replace(/\.csv$/i, '').trim();
    return cleaned || 'Playlist importada';
  }

  function normalizeHeaderName(header = '') {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function sanitizeImageUrl(url = '') {
    if (!url) return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:image/')) {
      return trimmed;
    }
    if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/') || trimmed.startsWith('src/')) {
      return trimmed;
    }
    return '';
  }

  function normalizeString(str = '') {
    return str
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanTrackTitle(str = '') {
    return normalizeString(str)
      .replace(/\b(remix|version|sped up|slow(ed)?|super slowed|ao vivo|feat|ft)\b.*$/i, '')
      .trim();
  }


  function isFallbackCover(url = '') {
    const trimmed = (url || '').trim();
    return trimmed.endsWith('genericCover.png');
  }

  function isGeneratedCover(url = '') {
    return typeof url === 'string' && url.trim().startsWith('data:image/svg+xml');
  }

  // Helper para verificar se é uma capa real (não fallback nem gerada)
  function isRealCover(url) {
    return Boolean(url) && !isFallbackCover(url) && !isGeneratedCover(url);
  }

  function isPresetPlaylistName(name = '') {
    const normalized = (name || '').trim().toLowerCase();
    return ['favorite songs', 'favorite albums', 'favorite artists'].includes(normalized);
  }
  function isMosaicCover(url = '') {
    return typeof url === 'string' && url.trim().startsWith('data:image/png');
  }

  function getPresetCoverForPlaylist(name = '') {
    const normalized = (name || '').trim().toLowerCase();
    const presets = {
      'favorite songs': 'src/imagens/favoriteSongs.png',
      'favorite albums': 'src/imagens/favoriteAlbums.png',
      'favorite artists': 'src/imagens/favoriteArtists.png'
    };
    return presets[normalized] || '';
  }

  function detectColumns(headers = []) {
    const normalized = headers.map(normalizeHeaderName);
    const findColumn = (aliases) => normalized.findIndex((value) =>
      aliases.some(alias => value === alias || value.includes(alias))
    );

    const imageAliases = [
      'image', 'imagesmall', 'imagemedium', 'imagelarge',
      'cover', 'coverurl', 'coverart', 'albumcover', 'albumimage',
      'thumbnail', 'thumbnailurl', 'thumb', 'artwork', 'artworkurl'
    ];

    const playlistImageAliases = [
      'playlistimage', 'playlistcover', 'coverplaylist', 'playlistthumb',
      'playlistart', 'playlistartwork', 'playlistphoto', 'playlistpicture', 'playlistpic'
    ];

    return {
      title: findColumn(['title', 'track', 'trackname', 'name']),
      artist: findColumn(['artist', 'artists', 'artistname']),
      album: findColumn(['album', 'albumname']),
      image: findColumn(imageAliases),
      isrc: findColumn(['isrc']),
      playlist: findColumn(['playlist', 'playlistname', 'listname']),
      playlistImage: findColumn(playlistImageAliases),
      durationMs: findColumn(['durationms', 'duration_ms', 'lengthms', 'ms']),
      duration: findColumn(['duration', 'length', 'time'])
    };
  }

  function normalizeQuery(text = '') {
    return text.replace(/\s+/g, ' ').trim();
  }

  // Helper para desembrulhar resposta do AllOrigins
  function unwrapAllOriginsResponse(parsed) {
    if (parsed?.contents && typeof parsed.contents === 'string') {
      try {
        return JSON.parse(parsed.contents);
      } catch {
        return parsed;
      }
    }
    return parsed;
  }

  async function fetchWithTimeout(url, timeout = 6000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  }


  // Busca via Netlify Function (scraping direto do YouTube)
  async function searchPlayDl(trackName, artistName, trackDurationMs = null) {
    // Só funciona em produção (Netlify) ou com netlify dev
    if (localDevFlag && !window.location.port.toString().startsWith('888')) {
      return null;
    }

    const query = `${trackName} ${artistName} official audio`.trim();
    if (!query) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`/youtube?action=search&q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[YouTube] HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      
      // Suporta tanto o novo formato (objeto com videos) quanto o antigo (array direto)
      let results;
      if (data && data.videos && Array.isArray(data.videos)) {
        results = data.videos;
      } else if (Array.isArray(data)) {
        results = data;
      } else {
        return null;
      }
      
      if (!results.length) {
        return null;
      }

      const validResults = results.filter(v => {
        const duration = v.lengthSeconds || 0;
        return duration >= 30 && duration <= 900;
      });

      if (!validResults.length) return null;

      const scored = validResults.map(video => ({
        ...video,
        score: calculateTrackScore(video, {
          name: trackName,
          artists: [{ name: artistName }],
          duration_ms: trackDurationMs
        })
      }));

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      if (!best || best.score < 1) return null;

      return {
        videoId: best.videoId,
        instance: 'youtube-search',
        lengthSeconds: best.lengthSeconds
      };

    } catch (error) {
      console.warn(`[YouTube] Error:`, error.message);
      return null;
    }
  }

  // =====================
  // Busca Manual de Faixas
  // =====================

  let manualSearchAbort = null;

  async function performManualSearch() {
    const query = ui.manualSearchInput?.value?.trim();
    if (!query) return;

    const searchType = youtubeSearchState.searchType || 'tracks';

    // Fecha o modal de busca sem limpar o input
    closeYoutubeSearchBar(false);

    // Cancela busca anterior se existir
    if (manualSearchAbort) {
      manualSearchAbort.abort();
    }
    manualSearchAbort = new AbortController();

    // Reset do estado de paginação para nova busca
    youtubeSearchState.query = query;
    youtubeSearchState.offset = 0;
    youtubeSearchState.hasMore = false;
    youtubeSearchState.isLoading = true;
    youtubeSearchState.results = [];

    const resultsContainer = ui.manualSearchResults;
    if (!resultsContainer) return;

    // Esconde empty state e mostra loading
    if (ui.youtubeEmptyState) ui.youtubeEmptyState.classList.add('hidden');
    
    const searchTypeLabel = searchType === 'playlists' ? 'playlists' : 'faixas';
    resultsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-white/60">
        <i class="ph-bold ph-spinner animate-spin text-3xl mb-3"></i>
        <p class="text-sm">Buscando ${searchTypeLabel} "${query}"...</p>
      </div>
    `;
    resultsContainer.classList.remove('hidden');

    if (ui.manualSearchBtn) {
      ui.manualSearchBtn.disabled = true;
    }

    try {
      const response = await searchYouTubeManual(query, 0, manualSearchAbort.signal, searchType);

      if (searchType === 'playlists') {
        // Busca de playlists
        if (!response || !response.playlists || !response.playlists.length) {
          youtubeSearchState.isLoading = false;
          resultsContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-white/50">
              <i class="ph-bold ph-playlist text-4xl mb-3 opacity-50"></i>
              <p class="text-sm">Nenhuma playlist encontrada para "${query}"</p>
              <p class="text-xs mt-1 opacity-70">Tente outros termos de busca</p>
            </div>
          `;
          return;
        }
        
        youtubeSearchState.isLoading = false;
        renderPlaylistSearchResults(response.playlists);
      } else {
        // Busca de faixas
        if (!response || !response.videos || !response.videos.length) {
          youtubeSearchState.isLoading = false;
          resultsContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-white/50">
              <i class="ph-bold ph-magnifying-glass text-4xl mb-3 opacity-50"></i>
              <p class="text-sm">Nenhum resultado para "${query}"</p>
              <p class="text-xs mt-1 opacity-70">Tente outros termos de busca</p>
            </div>
          `;
          return;
        }

        youtubeSearchState.results = response.videos || [];
        youtubeSearchState.hasMore = response.hasMore;
        youtubeSearchState.offset = (response.videos || []).length;
        youtubeSearchState.isLoading = false;

        renderManualSearchResults(response.videos || [], [], false);
      }

    } catch (error) {
      youtubeSearchState.isLoading = false;
      if (error.name === 'AbortError') return;
      console.error('[MANUAL SEARCH] Error:', error);
      resultsContainer.innerHTML = `
        <div class="text-center py-6 text-red-400/80 text-sm">
          Erro na busca: ${error.message}
        </div>
      `;
    } finally {
      if (ui.manualSearchBtn) {
        ui.manualSearchBtn.disabled = !ui.manualSearchInput?.value?.trim();
      }
    }
  }

  // Função auxiliar para limpar o author removendo contagem de vídeos
  function cleanPlaylistAuthor(author) {
    return (author || '').replace(/•?\s*\d+\s*(vídeos?|videos?|músicas?|musicas?|songs?)/gi, '').replace(/\s*•\s*$/, '').trim();
  }

  // Função auxiliar para gerar HTML de youtube-playlist-item
  function renderYoutubePlaylistItemHtml(playlist, extraClass = '') {
    return `
      <div class="youtube-playlist-item flex items-center gap-3 p-3 hover:bg-white/5 cursor-pointer transition-colors rounded-xl ${extraClass}" 
           data-playlist-id="${playlist.playlistId}" 
           data-title="${escapeHTML(playlist.title)}"
           data-author="${escapeHTML(cleanPlaylistAuthor(playlist.author))}"
           data-video-count="${playlist.videoCount}">
        <div class="relative flex-shrink-0">
          <img src="${playlist.thumbnail || 'src/imagens/genericCover.png'}" alt="" class="w-20 h-14 object-cover rounded-lg bg-white/10" onerror="this.src='src/imagens/genericCover.png'"/>
          <div class="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
            <i class="ph-bold ph-playlist text-white text-lg"></i>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white font-medium line-clamp-2">${escapeHTML(playlist.title)}</p>
          <p class="text-xs text-white/50 truncate mt-0.5">${escapeHTML(cleanPlaylistAuthor(playlist.author))}</p>
        </div>
        <button class="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500 hover:bg-purple-600 flex items-center justify-center transition-colors shadow-lg" title="Importar playlist">
          <i class="ph-bold ph-plus text-white"></i>
        </button>
      </div>
    `;
  }

  // Renderiza resultados de busca de playlists
  function renderPlaylistSearchResults(playlists) {
    const container = ui.manualSearchResults;
    if (!container) return;

    if (ui.youtubeEmptyState) ui.youtubeEmptyState.classList.add('hidden');
    container.classList.remove('hidden');

    if (ui.youtubeSearchContent) {
      ui.youtubeSearchContent.scrollTop = 0;
    }

    const html = playlists.map((playlist, idx) => 
      renderYoutubePlaylistItemHtml(playlist, idx > 0 ? 'mt-1' : '')
    ).join('');

    container.innerHTML = html;

    // Adiciona event listeners para playlists
    container.querySelectorAll('.youtube-playlist-item').forEach(item => {
      item.addEventListener('click', () => openYoutubePlaylistImport(item));
    });
  }

  async function loadMoreYouTubeResults() {
    if (youtubeSearchState.isLoading || !youtubeSearchState.hasMore || !youtubeSearchState.query) return;

    youtubeSearchState.isLoading = true;

    // Mostra loading no final da lista
    const resultsContainer = ui.manualSearchResults;
    if (!resultsContainer) return;

    const loadingEl = document.createElement('div');
    loadingEl.id = 'youtube-load-more-spinner';
    loadingEl.className = 'flex items-center justify-center py-6 text-white/50';
    loadingEl.innerHTML = `
      <i class="ph-bold ph-spinner animate-spin text-xl mr-2"></i>
      <span class="text-sm">Carregando mais...</span>
    `;
    resultsContainer.appendChild(loadingEl);

    try {
      const response = await searchYouTubeManual(
        youtubeSearchState.query, 
        youtubeSearchState.offset, 
        manualSearchAbort?.signal
      );

      // Remove loading spinner
      loadingEl.remove();

      if (response && response.videos && response.videos.length) {
        youtubeSearchState.results = [...youtubeSearchState.results, ...response.videos];
        youtubeSearchState.hasMore = response.hasMore;
        youtubeSearchState.offset += response.videos.length;

        renderManualSearchResults(response.videos, [], true);
      } else {
        youtubeSearchState.hasMore = false;
      }
    } catch (error) {
      loadingEl.remove();
      if (error.name !== 'AbortError') {
        console.error('[LOAD MORE] Error:', error);
      }
    } finally {
      youtubeSearchState.isLoading = false;
    }
  }

  async function searchYouTubeManual(query, offset = 0, signal, searchType = 'tracks') {
    // Usa YouTube scraping via Netlify function
    try {
      const typeParam = searchType === 'playlists' ? '&type=playlists' : '';
      const response = await fetch(`/youtube?action=search&q=${encodeURIComponent(query)}&limit=10&offset=${offset}${typeParam}`, { signal });
      if (response.ok) {
        const data = await response.json();
        // Suporta tanto o novo formato (com paginação) quanto o antigo (array direto)
        if (data && (data.videos || data.playlists)) {
          return data;
        }
        // Fallback para formato antigo (array direto)
        if (Array.isArray(data) && data.length) {
          return { videos: data.slice(0, 10), playlists: [], hasMore: false, total: data.length };
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn(`⚠️ [SEARCH] YouTube search failed: ${e.message}`);
    }

    return { videos: [], playlists: [], hasMore: false, total: 0 };
  }

  function renderManualSearchResults(videos, playlists = [], append = false) {
    const container = ui.manualSearchResults;
    if (!container) return;

    // Esconde empty state e mostra resultados
    if (ui.youtubeEmptyState) ui.youtubeEmptyState.classList.add('hidden');
    container.classList.remove('hidden');
    
    // Reseta scroll na primeira renderização
    if (!append && ui.youtubeSearchContent) {
      ui.youtubeSearchContent.scrollTop = 0;
    }

    // Renderiza playlists primeiro (apenas na primeira renderização)
    let playlistsHtml = '';
    if (!append && playlists && playlists.length > 0) {
      playlistsHtml = `
        <div class="mb-4">
          <h3 class="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
            <i class="ph-bold ph-playlist"></i>
            Playlists
          </h3>
          <div class="space-y-2">
            ${playlists.map(playlist => renderYoutubePlaylistItemHtml(playlist)).join('')}
          </div>
        </div>
      `;
    }

    // Renderiza vídeos
    let videosHtml = '';
    if (videos && videos.length > 0) {
      const videosSectionHeader = !append && playlists && playlists.length > 0 ? `
        <h3 class="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
          <i class="ph-bold ph-music-notes"></i>
          Músicas
        </h3>
      ` : '';
      
      videosHtml = videos.map((video, idx) => {
        const duration = formatDuration(video.lengthSeconds * 1000);
        const thumb = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
        const isFirst = !append && idx === 0 && (!playlists || playlists.length === 0);

        return `
          <div class="manual-search-item flex items-center gap-3 p-3 cursor-pointer transition-colors rounded-xl ${!isFirst ? 'mt-1' : ''}" 
               data-video-id="${video.videoId}" 
               data-title="${escapeHTML(video.title)}"
               data-author="${escapeHTML(video.author)}"
               data-duration="${video.lengthSeconds}"
               data-thumb="${thumb}">
            <div class="relative flex-shrink-0 w-20 h-[45px]">
              <img src="${thumb}" alt="" class="w-full h-full object-cover rounded-lg bg-white/10" onerror="this.src='src/imagens/genericCover.png'"/>
              <div class="sound-wave-overlay">
                <div class="sound-wave-bar"></div>
                <div class="sound-wave-bar"></div>
                <div class="sound-wave-bar"></div>
                <div class="sound-wave-bar"></div>
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="search-item-title text-sm text-white font-medium line-clamp-2">${escapeHTML(video.title)}</p>
              <p class="text-xs text-white/50 truncate mt-0.5">${escapeHTML(video.author)}</p>
            </div>
            <span class="search-item-duration text-xs text-white/40 flex-shrink-0">${duration}</span>
            <button class="add-to-playlist-btn flex-shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors" title="Adicionar à playlist">
              <i class="ph-bold ph-plus text-white/70 text-base"></i>
            </button>
          </div>
        `;
      }).join('');
      
      if (!append && playlists && playlists.length > 0) {
        videosHtml = `<div>${videosSectionHeader}${videosHtml}</div>`;
      }
    }

    if (append) {
      // Adiciona novos itens ao final
      container.insertAdjacentHTML('beforeend', videosHtml);
      // Adiciona event listeners apenas aos novos itens
      const allItems = container.querySelectorAll('.manual-search-item');
      const newItems = Array.from(allItems).slice(-videos.length);
      newItems.forEach(item => attachYouTubeSearchItemListeners(item));
    } else {
      // Substitui todo o conteúdo
      container.innerHTML = playlistsHtml + videosHtml;
      // Adiciona event listeners para vídeos
      container.querySelectorAll('.manual-search-item').forEach(item => {
        attachYouTubeSearchItemListeners(item);
      });
      // Adiciona event listeners para playlists
      container.querySelectorAll('.youtube-playlist-item').forEach(item => {
        item.addEventListener('click', () => openYoutubePlaylistImport(item));
      });
    }
  }

  function attachSeekHandlers(element, options = {}) {
    if (!element) return;

    const {
      isSeekable = () => true,
      getDurationMs = () => 0,
      onSeek = null,
      onClick = null,
      shouldIgnoreClick = null
    } = options;

    let isSeeking = false;
    let hasMoved = false;
    let startX = 0;

    const getClientX = (event, isTouch) => (isTouch ? event.touches[0].clientX : event.clientX);

    const handleSeek = (event, isTouch = false) => {
      if (!isSeekable()) return false;
      const durationMs = getDurationMs();
      if (!Number.isFinite(durationMs) || durationMs <= 0) return false;

      const rect = element.getBoundingClientRect();
      if (!rect.width) return false;

      const clientX = getClientX(event, isTouch);
      const clickX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      const seekTime = (percentage * durationMs) / 1000;

      audio.currentTime = seekTime;
      onSeek?.({ percentage, seekTime, durationMs, element });
      return true;
    };

    const startSeek = (event, isTouch = false) => {
      if (!isSeekable()) return;
      isSeeking = true;
      hasMoved = false;
      startX = getClientX(event, isTouch);
      element.classList.add('seeking');
      if (!isTouch) {
        event.preventDefault();
      }
    };

    const moveSeek = (event, isTouch = false) => {
      if (!isSeeking) return;
      const clientX = getClientX(event, isTouch);
      const moveThreshold = 5;
      if (Math.abs(clientX - startX) > moveThreshold) {
        hasMoved = true;
        handleSeek(event, isTouch);
      }
    };

    const endSeek = () => {
      if (!isSeeking) return;
      isSeeking = false;
      element.classList.remove('seeking');
    };

    element.addEventListener('mousedown', (event) => startSeek(event));
    element.addEventListener('mousemove', (event) => moveSeek(event));
    element.addEventListener('mouseup', endSeek);
    element.addEventListener('mouseleave', endSeek);

    element.addEventListener('touchstart', (event) => startSeek(event, true), { passive: true });
    element.addEventListener('touchmove', (event) => moveSeek(event, true), { passive: true });
    element.addEventListener('touchend', endSeek);

    element.addEventListener('click', (event) => {
      if (hasMoved) {
        hasMoved = false;
        return;
      }
      if (shouldIgnoreClick?.(event)) return;
      onClick?.(event);
    });
  }

  // Adiciona event listeners para itens de busca do YouTube (incluindo seek)
  function attachYouTubeSearchItemListeners(item) {
    attachSeekHandlers(item, {
      isSeekable: () => item.dataset.videoId === youtubePlayingVideoId,
      getDurationMs: () => getSearchItemDurationMs(item),
      onSeek: ({ percentage, seekTime, durationMs, element }) => {
        // Atualiza a barra de progresso
        const progress = percentage * 100;
        element.style.setProperty('--progress', `${progress}%`);

        // Atualiza o timer
        const remainingMs = Math.max(0, durationMs - (seekTime * 1000));
        const durationEl = element.querySelector('.search-item-duration');
        if (durationEl) {
          durationEl.textContent = formatDuration(remainingMs);
        }
      },
      shouldIgnoreClick: (event) => !!event.target.closest('.add-to-playlist-btn'),
      onClick: () => playYouTubeSearchResult(item)
    });

    // Clique no botão "+" abre o modal de playlist
    const addBtn = item.querySelector('.add-to-playlist-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAddToPlaylistModal(item);
      });
    }
  }

  // Função para importar playlist do YouTube
  async function openYoutubePlaylistImport(item) {
    const playlistId = item.dataset.playlistId;
    const title = item.dataset.title;
    const author = item.dataset.author;
    
    if (!playlistId) return;

    // Mostra loading no item
    const originalContent = item.innerHTML;
    item.innerHTML = `
      <div class="flex items-center justify-center w-full py-2">
        <i class="ph-bold ph-spinner animate-spin text-xl text-white/60 mr-2"></i>
        <span class="text-sm text-white/60">Carregando playlist...</span>
      </div>
    `;
    item.style.pointerEvents = 'none';

    try {
      const response = await fetch(`/.netlify/functions/youtube?action=playlist&playlistId=${playlistId}`);
      const data = await response.json();

      if (!data.videos || data.videos.length === 0) {
        setFeedback('Playlist vazia', 'error', {
          name: title || 'Playlist',
          cover: `https://i.ytimg.com/vi/${playlistId}/mqdefault.jpg`
        });
        item.innerHTML = originalContent;
        item.style.pointerEvents = '';
        return;
      }

      // Abre modal para confirmar importação
      openYoutubePlaylistConfirmModal(data, title, author, playlistId);
      
      // Restaura o item
      item.innerHTML = originalContent;
      item.style.pointerEvents = '';

    } catch (error) {
      console.error('[PLAYLIST IMPORT] Error:', error);
      setFeedback('Erro ao carregar', 'error', {
        name: title || 'Playlist',
        cover: `https://i.ytimg.com/vi/${playlistId}/mqdefault.jpg`
      });
      item.innerHTML = originalContent;
      item.style.pointerEvents = '';
    }
  }

  // Modal de confirmação de importação de playlist
  function openYoutubePlaylistConfirmModal(data, title, author, playlistId) {
    const videos = data.videos || [];
    const totalDuration = videos.reduce((acc, v) => acc + (v.lengthSeconds || 0), 0);
    const formattedDuration = formatDuration(totalDuration * 1000);

    // Cria modal dinamicamente
    const existingModal = document.getElementById('youtube-playlist-import-modal');
    if (existingModal) existingModal.remove();

    const modalHtml = `
      <div id="youtube-playlist-import-modal" class="fixed inset-0 z-[70] flex items-center justify-center p-4" style="background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);">
        <div class="bg-[#1e1e2e] rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden shadow-2xl border border-white/10">
          <div class="p-5 border-b border-white/10">
            <div class="flex items-start gap-4">
              <div class="w-16 h-16 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <i class="ph-bold ph-playlist text-purple-400 text-2xl"></i>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-bold text-white line-clamp-2">${escapeHTML(title)}</h3>
                <p class="text-sm text-white/50 mt-1">${escapeHTML(author)}</p>
                <p class="text-xs text-white/40 mt-1">${videos.length} músicas • ${formattedDuration}</p>
              </div>
            </div>
          </div>
          
          <div class="p-4 max-h-[300px] overflow-y-auto scrollbar-hide">
            <p class="text-xs text-white/50 mb-3">Prévia das músicas:</p>
            <div class="space-y-2">
              ${videos.slice(0, 10).map((v, i) => `
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-white/30 w-5 text-right">${i + 1}</span>
                  <span class="text-white/80 truncate flex-1">${escapeHTML(v.title)}</span>
                  <span class="text-white/40 text-xs">${formatDuration(v.lengthSeconds * 1000)}</span>
                </div>
              `).join('')}
              ${videos.length > 10 ? `<p class="text-xs text-white/40 text-center mt-2">+ ${videos.length - 10} músicas</p>` : ''}
            </div>
          </div>
          
          <div class="p-4 border-t border-white/10 flex gap-3">
            <button id="cancel-playlist-import" class="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 font-medium transition-colors">
              Cancelar
            </button>
            <button id="confirm-playlist-import" class="flex-1 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold transition-colors flex items-center justify-center gap-2">
              <i class="ph-bold ph-download-simple"></i>
              Importar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('youtube-playlist-import-modal');
    const cancelBtn = document.getElementById('cancel-playlist-import');
    const confirmBtn = document.getElementById('confirm-playlist-import');

    cancelBtn?.addEventListener('click', () => modal.remove());
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    confirmBtn?.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> Importando...';
      
      await importYoutubePlaylistToLibrary(videos, title);
      modal.remove();
    });
  }

  // Importa as músicas da playlist para a biblioteca
  async function importYoutubePlaylistToLibrary(videos, playlistTitle) {
    // Cria uma nova playlist com o nome da playlist do YouTube
    const playlistName = playlistTitle || 'YouTube Playlist';
    
    // Verifica se já existe uma playlist com esse nome
    let targetPlaylist = state.playlists.find(p => p.name === playlistName);
    
    if (!targetPlaylist) {
      // Cria nova playlist
      targetPlaylist = {
        id: `yt-${Date.now()}`,
        name: playlistName,
        cover: 'src/imagens/genericCover.png',
        tracks: []
      };
      state.playlists.push(targetPlaylist);
    }

    // Converte vídeos para formato de track
    const newTracks = videos.map(video => ({
      name: video.title,
      artists: [{ name: video.author }],
      duration_ms: video.lengthSeconds * 1000,
      album: { 
        name: 'YouTube', 
        images: [{ url: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` }] 
      },
      _videoId: video.videoId,
      _fromYoutubePlaylist: true
    }));

    // Adiciona tracks à playlist (evita duplicatas por videoId)
    const existingVideoIds = new Set(targetPlaylist.tracks.filter(t => t._videoId).map(t => t._videoId));
    const tracksToAdd = newTracks.filter(t => !existingVideoIds.has(t._videoId));
    
    targetPlaylist.tracks.push(...tracksToAdd);

    // Atualiza a capa da playlist com a primeira música se não tiver
    if (targetPlaylist.cover === 'src/imagens/genericCover.png' && tracksToAdd.length > 0) {
      const firstTrackCover = tracksToAdd[0].album?.images?.[0]?.url;
      if (firstTrackCover) {
        targetPlaylist.cover = firstTrackCover;
      }
    }

    // Salva no localStorage
    savePlaylistsToStorage();

    // Atualiza a UI
    renderPlaylists();

    // Feedback
    const playlistCover = getPlaylistCover(targetPlaylist);
    setFeedback(`${tracksToAdd.length} músicas importadas`, 'success', {
      name: playlistName,
      cover: playlistCover,
      subtitle: `${targetPlaylist.tracks.length} faixas no total`
    });

    // Muda para a aba de biblioteca
    switchPlayerTab('playlist');
  }

  // Estado temporário para o track sendo adicionado
  let pendingYouTubeTrack = null;

  // Cria um track object a partir de um item de busca
  function createTrackFromSearchItem(item) {
    const videoId = item.dataset.videoId;
    const title = item.dataset.title;
    const author = item.dataset.author;
    const duration = parseInt(item.dataset.duration, 10) || 0;
    const thumb = item.dataset.thumb || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

    return {
      name: title,
      artists: [{ name: author }],
      duration_ms: duration * 1000,
      thumbnail: thumb,
      album: { name: 'YouTube', images: [{ url: thumb }] },
      _manualSearch: true,
      _videoId: videoId
    };
  }

  // Estado da reprodução do YouTube
  let youtubePlayingVideoId = null;
  let youtubeCountdownRaf = null;

  // Helper para obter duração em ms de um elemento de busca
  function getSearchItemDurationMs(item) {
    return parseInt(item?.dataset?.duration, 10) * 1000 || 0;
  }

  // Verifica se está reproduzindo no contexto do YouTube
  function isPlayingFromYouTube() {
    return youtubePlayingVideoId && state.playingPlaylistId === 'youtube-search';
  }

  function isLibraryPlaybackActive() {
    return !!state.playingPlaylistId && state.playingPlaylistId !== 'youtube-search';
  }

  function isLibraryPlaybackVisible() {
    return isLibraryPlaybackActive() && isViewingPlayingPlaylist();
  }

  function getActiveLibraryIndex() {
    if (!isLibraryPlaybackActive()) return -1;
    return state.playingTrackIndex >= 0 ? state.playingTrackIndex : state.currentTrackIndex;
  }

  function hasLibraryPlaybackQueue() {
    return isLibraryPlaybackActive() && state.playingTracks.length > 0;
  }

  // Limpa completamente o estado de reprodução do YouTube
  function clearYouTubePlaybackState(options = {}) {
    const { updateUi = true } = options;
    const isYoutubeQueue = state.playingPlaylistId === 'youtube-search';
    const hadYoutube = !!youtubePlayingVideoId || isYoutubeQueue;

    youtubePlayingVideoId = null;
    stopYouTubeSearchCountdown();
    updateYouTubeSearchHighlight();

    if (isYoutubeQueue) {
      state.playingPlaylistId = null;
      state.playingTrackIndex = -1;
      state.playingTracks = [];
    }

    if (hadYoutube && updateUi) {
      updateUiState();
    }
  }

  // Helper para resetar progresso e duração de um item de busca
  function resetSearchItemProgress(item) {
    if (!item) return;
    item.style.setProperty('--progress', '0%');
    const durationEl = item.querySelector('.search-item-duration');
    if (durationEl) {
      durationEl.textContent = formatDuration(getSearchItemDurationMs(item));
    }
  }

  // Helper para obter todos os itens de busca do YouTube
  function getYouTubeSearchItems() {
    return Array.from(ui.manualSearchResults?.querySelectorAll('.manual-search-item') || []);
  }

  // Helper para encontrar o índice do item de busca atual
  function getCurrentYouTubeSearchIndex(allItems) {
    if (youtubePlayingVideoId) {
      return allItems.findIndex(item => item.dataset.videoId === youtubePlayingVideoId);
    }
    if (state.playingPlaylistId === 'youtube-search' && state.playingTrackIndex >= 0) {
      return state.playingTrackIndex;
    }
    return -1;
  }

  // Atualiza o visual do item de busca ativo
  function updateYouTubeSearchHighlight() {
    const isActuallyPlaying = isAudioPlaying();
    
    document.querySelectorAll('.manual-search-item').forEach(item => {
      const videoId = item.dataset.videoId;
      const isActive = videoId === youtubePlayingVideoId;
      
      item.classList.toggle('active', isActive);
      item.classList.toggle('playing', isActive && isActuallyPlaying);
    });
  }

  // Atualiza o progresso e timer do item de busca
  function updateYouTubeSearchProgress() {
    if (!youtubePlayingVideoId || !state.isPlaying || audio.paused) {
      youtubeCountdownRaf = null;
      return;
    }

    const item = document.querySelector(`.manual-search-item[data-video-id="${youtubePlayingVideoId}"]`);
    if (!item) {
      youtubeCountdownRaf = null;
      return;
    }

    const durationMs = getSearchItemDurationMs(item);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      youtubeCountdownRaf = null;
      return;
    }

    const currentMs = audio.currentTime * 1000;
    const remainingMs = Math.max(0, durationMs - currentMs);
    const progress = Math.min(100, (currentMs / durationMs) * 100);

    // Atualiza a barra de progresso
    item.style.setProperty('--progress', `${progress}%`);

    // Atualiza o timer
    const durationEl = item.querySelector('.search-item-duration');
    if (durationEl) {
      durationEl.textContent = formatDuration(remainingMs);
    }

    youtubeCountdownRaf = requestAnimationFrame(updateYouTubeSearchProgress);
  }

  function startYouTubeSearchCountdown() {
    stopYouTubeSearchCountdown();
    if (!youtubePlayingVideoId || !state.isPlaying) return;
    updateYouTubeSearchProgress();
  }

  function stopYouTubeSearchCountdown() {
    if (youtubeCountdownRaf) {
      cancelAnimationFrame(youtubeCountdownRaf);
      youtubeCountdownRaf = null;
    }
  }

  // Reproduz uma música da busca do YouTube
  async function playYouTubeSearchResult(item, isRetry = false) {
    const videoId = item.dataset.videoId;
    if (!videoId) return;

    // Cria o track a partir do item clicado
    const track = createTrackFromSearchItem(item);

    // Coleta todos os itens de busca
    const allItems = getYouTubeSearchItems();
    const allTracks = allItems.map(createTrackFromSearchItem);
    const clickedIndex = allTracks.findIndex(t => t._videoId === videoId);

    // Atualiza o estado de reprodução do YouTube
    youtubePlayingVideoId = videoId;
    
    // Atualiza APENAS o estado de reprodução (não o estado de visualização)
    state.playingTrackIndex = clickedIndex;
    state.playingTracks = allTracks;
    state.playingPlaylistId = 'youtube-search';
    
    // Não sobrescreve state.tracks, state.currentTrackIndex ou state.currentPlaylist
    // para não afetar a visualização da playlist atual
    stopPlaybackCountdown({ resetLabel: false });

    // Atualiza o visual
    updateYouTubeSearchHighlight();

    // Mostra loading
    item.classList.add('loading');

    try {
      // Limpa cache se for retry
      if (isRetry) {
        state.audioCache.delete(videoId);
        unavailableTracks.delete(videoId);
      }

      // Busca o áudio
      const audioUrl = await getTrackAudioUrl(track, clickedIndex);
      
      if (!audioUrl) {
        item.classList.remove('loading');
        
        // Se não for retry, tenta mais uma vez
        if (!isRetry) {
          console.log('Tentando reproduzir novamente:', track.name);
          return playYouTubeSearchResult(item, true);
        }
        
        // Se já foi retry, avança para próxima
        console.log('Falha após retry, avançando para próxima');
        youtubePlayingVideoId = null;
        updateYouTubeSearchHighlight();
        playNextYouTubeSearchResult();
        return;
      }

      // Reproduz
      setAudioSource(audioUrl);
      await audio.play();
      
      state.isPlaying = true;
      updateUiState();
      startYouTubeSearchCountdown();
      
    } catch (error) {
      console.error('Erro ao reproduzir:', error);
      item.classList.remove('loading');
      
      // Se não for retry, tenta mais uma vez
      if (!isRetry) {
        console.log('Erro, tentando novamente:', track.name);
        return playYouTubeSearchResult(item, true);
      }
      
      // Se já foi retry, avança para próxima
      console.log('Erro após retry, avançando para próxima');
      youtubePlayingVideoId = null;
      updateYouTubeSearchHighlight();
      playNextYouTubeSearchResult();
    } finally {
      item.classList.remove('loading');
    }
  }

  // Toca a música anterior da busca do YouTube
  function playPreviousYouTubeSearchResult() {
    const allItems = getYouTubeSearchItems();
    
    // Encontra o índice atual baseado no estado ou no videoId
    const currentIndex = getCurrentYouTubeSearchIndex(allItems);

    // Reseta o timer do item atual
    const currentItem = allItems[currentIndex];
    resetSearchItemProgress(currentItem);

    // Encontra o item anterior
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      const prevItem = allItems[prevIndex];
      playYouTubeSearchResult(prevItem);
    } else if (repeatEnabled && allItems.length > 0) {
      // Se repeat está ativo, volta para o último
      const lastItem = allItems[allItems.length - 1];
      playYouTubeSearchResult(lastItem);
    }
  }

  // Toca a próxima música da busca do YouTube
  function playNextYouTubeSearchResult() {
    const allItems = getYouTubeSearchItems();
    
    // Encontra o índice atual baseado no estado ou no videoId
    const currentIndex = getCurrentYouTubeSearchIndex(allItems);

    // Reseta o timer do item atual
    const currentItem = allItems[currentIndex];
    resetSearchItemProgress(currentItem);

    // Encontra o próximo item
    const nextIndex = currentIndex + 1;
    if (nextIndex < allItems.length) {
      const nextItem = allItems[nextIndex];
      playYouTubeSearchResult(nextItem);
    } else if (repeatEnabled && allItems.length > 0) {
      // Se repeat está ativo, volta para o primeiro
      const firstItem = allItems[0];
      playYouTubeSearchResult(firstItem);
    } else {
      // Fim da lista
      clearYouTubePlaybackState();
    }
  }

  // Abre o modal para adicionar à playlist
  function openAddToPlaylistModal(item) {
    const videoId = item.dataset.videoId;
    const title = item.dataset.title;

    if (!videoId) return;

    // Guarda o track para adicionar depois
    pendingYouTubeTrack = createTrackFromSearchItem(item);

    // Abre o modal de seleção de playlist
    openPlaylistPicker(title);
  }

  function openPlaylistPicker(trackName) {
    if (!ui.playlistPickerModal || !ui.playlistPickerCard) return;

    // Atualiza o nome da faixa no header
    if (ui.playlistPickerTrack) {
      ui.playlistPickerTrack.textContent = trackName;
    }

    // Renderiza lista de playlists
    renderPlaylistPickerList();

    // Esconde form de nova playlist
    hideNewPlaylistForm();

    // Remove inert e mostra modal
    ui.playlistPickerModal.removeAttribute('inert');
    openScaledModal(ui.playlistPickerModal, ui.playlistPickerCard);
    ui.playlistPickerModal.classList.add('opacity-100');
  }

  function closePlaylistPicker() {
    if (!ui.playlistPickerModal || !ui.playlistPickerCard) return;

    ui.playlistPickerModal.classList.add('opacity-0');
    ui.playlistPickerCard.classList.add('scale-95');
    ui.playlistPickerCard.classList.remove('scale-100');

    setTimeout(() => {
      ui.playlistPickerModal.classList.add('invisible');
      ui.playlistPickerModal.classList.remove('opacity-100');
      ui.playlistPickerModal.setAttribute('inert', '');
    }, 200);

    pendingYouTubeTrack = null;
  }

  function renderPlaylistPickerList() {
    if (!ui.playlistPickerList) return;

    const playlists = state.playlists || [];

    if (!playlists.length) {
      ui.playlistPickerList.innerHTML = `
        <div class="text-center py-6 text-white/40 text-sm">
          <i class="ph-bold ph-playlist text-2xl mb-2 block opacity-50"></i>
          Nenhuma playlist ainda.<br/>Crie uma nova abaixo.
        </div>
      `;
      return;
    }

    ui.playlistPickerList.innerHTML = playlists.map((playlist, idx) => {
      const trackCount = getPlaylistTrackCount(playlist);
      const cover = playlist.cover || getFallbackCover();

      return `
        <div class="playlist-picker-item flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl cursor-pointer transition-colors" data-playlist-index="${idx}">
          <img src="${cover}" alt="" class="w-12 h-12 rounded-lg object-cover bg-white/10" onerror="this.src='${getFallbackCover()}'"/>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-white font-medium truncate">${escapeHTML(playlist.name)}</p>
            <p class="text-xs text-white/40">${trackCount} ${trackCount === 1 ? 'música' : 'músicas'}</p>
          </div>
          <i class="ph-bold ph-plus text-white/30 text-lg"></i>
        </div>
      `;
    }).join('');

    // Event listeners
    ui.playlistPickerList.querySelectorAll('.playlist-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.playlistIndex, 10);
        addTrackToPlaylist(idx);
      });
    });
  }

  async function addTrackToPlaylist(playlistIndex) {
    if (!pendingYouTubeTrack) return;

    const playlist = state.playlists[playlistIndex];
    if (!playlist) return;

    // Inicializa tracks se necessário
    if (!playlist.tracks) playlist.tracks = [];

    // Verifica se já existe uma faixa com o mesmo videoId
    const isDuplicate = playlist.tracks.some(t =>
      t._videoId && t._videoId === pendingYouTubeTrack._videoId
    );

    if (isDuplicate) {
      setFeedback('Já está na playlist', 'warning', {
        ...getTrackFeedbackInfo(pendingYouTubeTrack),
        subtitle: playlist.name
      });
      closePlaylistPicker();
      return;
    }

    // Adiciona a faixa à playlist
    playlist.tracks.unshift(pendingYouTubeTrack);

    // Salva no localStorage
    savePlaylistsToStorage();

    // Feedback
    setFeedback('Adicionada à playlist', 'success', {
      ...getTrackFeedbackInfo(pendingYouTubeTrack),
      subtitle: playlist.name
    });

    // Fecha o modal picker
    closePlaylistPicker();

    // Troca para a aba Playlist
    switchPlayerTab('playlist');

    // Aguarda um frame para garantir que a aba está visível
    await nextFrame();

    // Atualiza o carrossel
    renderPlaylists();

    // Seleciona a playlist (passa o objeto, não o índice) e toca a música
    await selectPlaylist(playlist);
    await playTrack(0);
  }

  function showNewPlaylistForm() {
    if (ui.newPlaylistForm) ui.newPlaylistForm.classList.remove('hidden');
    if (ui.showNewPlaylistBtn) ui.showNewPlaylistBtn.classList.add('hidden');
    if (ui.newPlaylistName) {
      ui.newPlaylistName.value = '';
      setTimeout(() => ui.newPlaylistName.focus(), 100);
    }
  }

  function hideNewPlaylistForm() {
    if (ui.newPlaylistForm) ui.newPlaylistForm.classList.add('hidden');
    if (ui.showNewPlaylistBtn) ui.showNewPlaylistBtn.classList.remove('hidden');
  }

  async function createNewPlaylistAndAdd() {
    const name = ui.newPlaylistName?.value?.trim();
    if (!name || !pendingYouTubeTrack) return;

    // Cria nova playlist com ID único
    const newPlaylist = {
      id: `yt-playlist-${Date.now()}`,
      name: name,
      cover: `https://i.ytimg.com/vi/${pendingYouTubeTrack._videoId}/mqdefault.jpg`,
      images: [{ url: `https://i.ytimg.com/vi/${pendingYouTubeTrack._videoId}/mqdefault.jpg` }],
      tracks: [pendingYouTubeTrack]
    };

    // Adiciona ao início da lista
    state.playlists.unshift(newPlaylist);

    // Fecha modal picker
    closePlaylistPicker();

    // Troca para a aba Playlist (para que o container esteja visível)
    switchPlayerTab('playlist');

    // Atualiza UI das playlists e scrolla para a nova playlist
    // Aguarda um frame para garantir que a aba está visível
    await nextFrame();
    renderPlaylists(state.playlists, true);

    // Seleciona a nova playlist (passa o objeto) e toca
    await selectPlaylist(newPlaylist);
    await playTrack(0);
  }

  async function fetchDeezerSearch(query, allowReset = true) {
    if (state.coverSuspendedUntil && Date.now() < state.coverSuspendedUntil) {
      return null;
    }

    const errors = [];
    const baseUrl = `https://api.deezer.com/search?q=${query}`;
    const orderedProxies = (() => {
      const list = [...DEEZER_PROXIES];
      if (state.coverLastSuccessProxy) {
        const idx = list.findIndex(builder => builder(baseUrl).id === state.coverLastSuccessProxy);
        if (idx > 0) {
          const [p] = list.splice(idx, 1);
          list.unshift(p);
        }
      }
      return list;
    })();

    let tried = 0;
    for (const build of orderedProxies) {
      const { id, url } = build(baseUrl);
      if (isCoverProxyBlocked(id) || isCoverProxyCooling(id)) continue;

      tried += 1;
      try {
        // Timeouts por proxy: netlify-proxy é mais confiável, allorigins é sensível
        const timeout = id === 'netlify-proxy' ? 12000 : id === 'allorigins' ? 6000 : 10000;
        const response = await fetchWithTimeout(url, timeout);
        if (!response.ok) {
          const count = (state.coverProxyFailCount.get(id) || 0) + 1;
          state.coverProxyFailCount.set(id, count);
          const shouldBlock = response.status === 429 || response.status === 408 || (response.status === 403 && count >= 2) || count >= 3;
          if (!((id === 'allorigins') && response.status === 499)) {
            errors.push(`${id}: HTTP ${response.status}`);
          }
          if (response.status === 429) {
            setCoverProxyCooldown(id, 8000);
          }
          if (shouldBlock) {
            blockCoverProxy(id, `HTTP ${response.status}`);
          }
          continue;
        }

        const text = await response.text();
        let parsedData = null;
        let parseOk = false;

        const tryParseJson = (payload) => {
          const candidate = payload?.trim();
          if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) return null;
          const parsed = JSON.parse(candidate);
          return parsed?.contents ? JSON.parse(parsed.contents) : parsed;
        };

        parsedData = tryParseJson(text);

        // Para o proxy jina (retorna markdown/texto), tenta extrair o primeiro bloco JSON
        if (!parsedData && id === 'jina') {
          const first = text.indexOf('{');
          const last = text.lastIndexOf('}');
          if (first !== -1 && last !== -1 && last > first) {
            const snippet = text.slice(first, last + 1);
            parsedData = tryParseJson(snippet);
          }
        }

        if (!parsedData) {
          errors.push(`${id}: non-json response`);
          const count = (state.coverProxyFailCount.get(id) || 0) + 1;
          state.coverProxyFailCount.set(id, count);
          if (count >= 2 && id !== 'jina') {
            blockCoverProxy(id, 'invalid-json', 3 * 60 * 1000);
          }
          continue;
        }

        parseOk = true;
        if (parseOk) {
          state.coverLastSuccessProxy = id;
          resetCoverProxyFail(id);
          return parsedData;
        }
      } catch (error) {
        const msg = (error.message || '').toLowerCase();
        const isAbortNoise = (id === 'allorigins' && msg.includes('abort')) || (id === 'jina' && msg.includes('unexpected token'));
        if (!isAbortNoise) {
          errors.push(`${id}: ${error.message || 'erro desconhecido'}`);
          const count = (state.coverProxyFailCount.get(id) || 0) + 1;
          state.coverProxyFailCount.set(id, count);
          if (msg.includes('failed to fetch') || msg.includes('name_not_resolved') || msg.includes('timeout')) {
            if (count >= 2) blockCoverProxy(id, msg);
          } else if (msg.includes('abort')) {
            if (count >= 3) blockCoverProxy(id, msg);
          } else if (msg.includes('403') && id === 'corsproxy' && count >= 2) {
            blockCoverProxy(id, msg);
          }
        } else {
          errors.push(`${id}: aborted (ignored)`);
        }
        continue;
      }
    }

    if (tried === 0 && state.coverProxyBlock.size && allowReset) {
      resetCoverProxies('no-available-proxy');
      return await fetchDeezerSearch(query, false);
    }
    const allBlocked = orderedProxies.every(build => isCoverProxyBlocked(build(baseUrl).id));
    if (allBlocked && allowReset) {
      resetCoverProxies('all-blocked-retry');
      return await fetchDeezerSearch(query, false);
    }

    if (errors.length) {
      state.coverFailureStreak += 1;
    }
    if (state.coverFailureStreak >= COVER_FAILURE_THRESHOLD) {
      state.coverSuspendedUntil = Date.now() + COVER_SUSPEND_MS;
      console.warn(`⏳ [COVER] Suspenso por ${Math.round(COVER_SUSPEND_MS / 1000)}s após falhas consecutivas`);
    }

    const errorMsg = errors.length ? errors.join(' | ') : 'no proxies available';
    console.warn(`⚠️ [COVER] Deezer search failed after retries: ${errorMsg}`);
    return null;
  }

  async function buscarCapaPlaylist(playlistName) {
    const normalizedName = normalizeQuery(playlistName);
    if (!normalizedName) return null;

    const cacheKey = `playlist:${normalizedName}`.toLowerCase();
    const cached = getCoverCache(cacheKey);
    if (cached) return cached;

    try {
      const baseUrl = `https://api.deezer.com/search/playlist?q=${normalizedName}`;
      const orderedProxies = [...DEEZER_PROXIES];

      for (const build of orderedProxies) {
        const { id, url } = build(baseUrl);
        if (isCoverProxyBlocked(id) || isCoverProxyCooling(id)) continue;

        try {
          // Timeouts por proxy: netlify-proxy é mais confiável
          const timeout = id === 'netlify-proxy' ? 12000 : id === 'allorigins' ? 6000 : 8000;
          const response = await fetchWithTimeout(url, timeout);

          if (!response.ok) {
            const count = (state.coverProxyFailCount.get(id) || 0) + 1;
            state.coverProxyFailCount.set(id, count);
            if (count >= 2) blockCoverProxy(id, `HTTP ${response.status}`);
            continue;
          }

          const raw = await response.text();
          const cleanRaw = raw.trim().replace(/^\)\]\}'/, '').trim();
          let parsed = JSON.parse(cleanRaw);

          // Desembrulha AllOrigins se necessário
          parsed = unwrapAllOriginsResponse(parsed);

          if (parsed?.data?.length) {
            // Busca a playlist com melhor match
            const best = parsed.data
              .map(pl => ({
                cover: pl.picture_xl || pl.picture_big || pl.picture_medium || null,
                score: calculateStringSimilarity(normalizedName, pl.title || ''),
                title: pl.title
              }))
              .filter(entry => entry.cover)
              .sort((a, b) => b.score - a.score)[0];

            if (best?.cover && best.score > 0.6) {
              setCoverCache(cacheKey, best.cover);
              state.coverProxyFailCount.set(id, 0);
              return best.cover;
            }
          }
        } catch (error) {
          const msg = (error?.message || '').toLowerCase();
          const count = (state.coverProxyFailCount.get(id) || 0) + 1;
          state.coverProxyFailCount.set(id, count);
          const isCors = msg.includes('cors') || msg.includes('access-control');
          const isTimeout = msg.includes('timeout') || msg.includes('abort');
          if (!isCors && count >= 2) {
            blockCoverProxy(id, msg || 'playlist-cover-error');
          } else if (isTimeout && count >= 3) {
            blockCoverProxy(id, 'timeout');
          }
        }
      }
    } catch (error) {
      // Silencioso
    }

    return null;
  }

  async function buscarCapaFaixa(nome, artista = '') {
    const trackName = normalizeQuery(nome);
    const artistName = normalizeQuery(artista);
    if (!trackName) return null;

    const cacheKey = `${trackName}|${artistName}`.toLowerCase();
    const cached = getCoverCache(cacheKey);
    if (cached) {
      state.coverFailureStreak = 0;
      return cached;
    }

    const cleanTitle = cleanTrackTitle(trackName);
    const cleanArtist = normalizeString(artistName);

    // Tenta extrair artista e título se o nome contém separadores (comum em faixas do YouTube)
    let extractedPart1 = '';
    let extractedPart2 = '';

    // Padrões: "Parte1 - Parte2", "Parte1 | Parte2", "Parte1 – Parte2"
    const separatorMatch = trackName.match(/^(.+?)\s*[-|–]\s*(.+)$/);
    if (separatorMatch) {
      extractedPart1 = normalizeString(separatorMatch[1].trim());
      extractedPart2 = cleanTrackTitle(separatorMatch[2].trim());
      // Remove parênteses extras
      extractedPart2 = extractedPart2.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    const queries = [
      // Assume "Artista - Música"
      extractedPart1 && extractedPart2
        ? `track:"${extractedPart2}" artist:"${extractedPart1}"`
        : null,
      // Assume "Música - Info" (busca só a primeira parte como título)
      extractedPart1
        ? `track:"${extractedPart1}"`
        : null,
      // Busca só com segunda parte extraída
      extractedPart2 && extractedPart2 !== cleanTitle
        ? `track:"${extractedPart2}"`
        : null,
      // Busca com artista passado (pode ser nome do canal)
      cleanArtist
        ? `track:"${extractedPart2 || extractedPart1 || cleanTitle}" artist:"${cleanArtist}"`
        : null,
      // Busca simples com título limpo
      `track:"${cleanTitle}"`,
      // Busca genérica - primeira parte + segunda parte
      extractedPart1 && extractedPart2
        ? `${extractedPart1} ${extractedPart2}`
        : null,
      // Fallback: busca genérica com título original
      cleanTitle
    ].filter(Boolean);

    // Remove duplicatas
    const uniqueQueries = [...new Set(queries)];

    let deezerData = null;
    for (const q of uniqueQueries) {
      try {
        deezerData = await fetchDeezerSearch(q);
        if (deezerData?.data?.length) break;
      } catch (_) { }
    }

    if (deezerData?.data?.length) {
      // Tenta match com ambas as partes extraídas
      const matchTerms = [extractedPart1, extractedPart2, cleanTitle, cleanArtist].filter(Boolean);

      const best = deezerData.data
        .map(item => {
          const itemTitle = (item.title || item.title_short || '').toLowerCase();
          const itemArtist = (item.artist?.name || '').toLowerCase();

          // Calcula score baseado em quantos termos batem
          let score = 0;
          for (const term of matchTerms) {
            const termLower = term.toLowerCase();
            if (itemTitle.includes(termLower) || termLower.includes(itemTitle)) score += 0.3;
            if (itemArtist.includes(termLower) || termLower.includes(itemArtist)) score += 0.3;
          }

          return {
            cover: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || null,
            score
          };
        })
        .filter(entry => entry.cover && entry.score > 0)
        .sort((a, b) => b.score - a.score)[0];

      if (best?.cover) {
        setCoverCache(cacheKey, best.cover);
        state.coverFailureStreak = 0;
        return best.cover;
      }
    }

    const fallback = getFallbackCover(trackName);
    setCoverCache(cacheKey, fallback);
    state.coverFailureStreak = 0;
    console.warn(`❌ [COVER] Nenhuma capa Deezer para "${trackName}", usando capa padrão`);
    return fallback;
  }

  // Controle de concorrência para geração de mosaicos
  let mosaicGenerationInProgress = 0;
  const MAX_CONCURRENT_MOSAICS = 2;

  async function gerarCapaPlaylist(listaDeCapas = []) {
    const sources = (listaDeCapas || []).map(sanitizeImageUrl).filter(Boolean).slice(0, 4);
    if (!sources.length) return null;

    // Limita concorrência para evitar crash de memória
    if (mosaicGenerationInProgress >= MAX_CONCURRENT_MOSAICS) {
      await delay(500);
      if (mosaicGenerationInProgress >= MAX_CONCURRENT_MOSAICS) {
        return null; // Desiste se ainda estiver ocupado
      }
    }

    mosaicGenerationInProgress++;

    // Tamanho reduzido para economizar memória
    const size = 300;
    const cell = size / 2;
    let canvas = null;
    let ctx = null;

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      const timeout = setTimeout(() => {
        img.src = '';
        reject(new Error('Timeout'));
      }, 5000);
      img.onload = () => { clearTimeout(timeout); resolve(img); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error('Erro ao carregar')); };
      img.src = src;
    });

    try {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      ctx = canvas.getContext('2d');

      const images = [];
      for (const src of sources) {
        try {
          const img = await loadImage(src);
          images.push(img);
        } catch (error) {
          // Ignora imagens que falharam
        }
      }

      if (!images.length) {
        return null;
      }

      images.slice(0, 4).forEach((img, index) => {
        const x = (index % 2) * cell;
        const y = Math.floor(index / 2) * cell;
        ctx.drawImage(img, x, y, cell, cell);
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // JPEG com qualidade 80% é menor
      return dataUrl;
    } catch (error) {
      console.warn(`⚠️ [COVER] Falha ao gerar mosaico: ${error.message}`);
      return null;
    } finally {
      // Limpa recursos
      mosaicGenerationInProgress--;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      ctx = null;
    }
  }

  // Helper para obter elemento de track pelo índice
  function getTrackElement(index) {
    if (!ui.tracksContainer || index < 0) return null;
    return ui.tracksContainer.querySelector(`[data-track-index="${index}"]`);
  }

  function updateTrackCardCover(index, coverUrl) {
    if (!Number.isInteger(index) || index < 0) return;
    const img = getTrackElement(index)?.querySelector('img');
    if (!img) return;

    const currentSrc = img.getAttribute('src');
    if (currentSrc === coverUrl) return;

    img.setAttribute('src', coverUrl);
    img.style.opacity = '0';
    requestAnimationFrame(() => {
      img.style.transition = 'opacity 180ms ease';
      img.style.opacity = '1';
    });
  }

  function updatePlaylistCardCover(playlistId, coverUrl) {
    if (!ui.playlistsContainer || !playlistId) return;
    const img = ui.playlistsContainer.querySelector(`.playlist-item[data-playlist-id="${playlistId}"] img`);
    if (!img) return;

    const currentSrc = img.getAttribute('src');
    if (currentSrc === coverUrl) return;
    img.setAttribute('src', coverUrl);
  }

  // Helper para atualizar capa da playlist no state e na UI
  function setPlaylistCover(playlist, coverUrl) {
    if (!playlist || !coverUrl) return;
    playlist.images = [{ url: coverUrl }];
    updatePlaylistCardCover(playlist.id, coverUrl);
  }

  // Helper para verificar se a sessão de importação ainda é válida
  function isImportSessionStale(importSessionId) {
    return importSessionId && importSessionId !== state.currentImportSessionId;
  }

  function applyCoverToStateAndUi(track, coverUrl, importSessionId = state.currentImportSessionId) {
    if (!track || !coverUrl) return;
    if (isImportSessionStale(importSessionId)) return;

    const playlist = state.playlists.find(p => Array.isArray(p?.tracks) && p.tracks.includes(track));
    const hasValidCover = isRealCover(coverUrl);

    if (playlist) {
      if (!Array.isArray(playlist.coverSources)) playlist.coverSources = [];
      if (hasValidCover && !playlist.coverSources.includes(coverUrl)) {
        playlist.coverSources.unshift(coverUrl);
        playlist.coverSources = playlist.coverSources.slice(0, 4);
      }
    }

    const trackIndex = state.tracks.indexOf(track);
    if (trackIndex >= 0) {
      updateTrackCardCover(trackIndex, coverUrl);
    }
  }

  async function fetchPlaylistCoverFromTracks(playlist, importSessionId = state.currentImportSessionId) {
    if (!playlist || !Array.isArray(playlist.tracks)) return null;
    if (isImportSessionStale(importSessionId)) return null;

    const candidates = playlist.tracks.slice(0, 6);
    for (const track of candidates) {
      if (!track) continue;
      const title = getTrackTitle(track);
      const artistLabel = getTrackArtists(track).replace(/, /g, ' ');
      if (!title) continue;

      try {
        const cover = await buscarCapaFaixa(title, artistLabel);
        const safeCover = sanitizeImageUrl(cover);
        if (isRealCover(safeCover)) {
          return safeCover;
        }
      } catch (error) {
        console.warn(`⚠️ [COVER] Falha ao buscar capa para playlist "${playlist.name}" via faixa "${title}": ${error.message}`);
      }
    }

    return null;
  }

  async function enrichPlaylistsWithCovers(playlists = [], importSessionId = state.currentImportSessionId) {
    if (!Array.isArray(playlists) || !playlists.length) return playlists;

    for (const playlist of playlists) {
      if (!playlist) continue;
      if (isImportSessionStale(importSessionId)) break;

      const isPreset = isPresetPlaylistName(playlist.name);
      const currentCover = playlist.images?.[0]?.url || '';
      const playlistDefinedCover = isRealCover(playlist.cover);
      const hasValidCover = isRealCover(currentCover);

      // Se já tem capa definida na playlist ou capa real, pula
      if (playlistDefinedCover || hasValidCover) continue;

      // Prioridade 1: playlistCover real (capa específica da playlist)
      const playlistCover = sanitizeImageUrl(playlist.playlistCover);
      if (isRealCover(playlistCover)) {
        setPlaylistCover(playlist, playlistCover);
        continue;
      }

      // Prioridade 2: preset cover (apenas se não houver playlistCover)
      const presetCover = sanitizeImageUrl(getPresetCoverForPlaylist(playlist.name));
      if (presetCover) {
        setPlaylistCover(playlist, presetCover);
        continue;
      }

      // Se for preset mas não tem capa preset, usa fallback e não gera mosaico
      if (isPreset) {
        setPlaylistCover(playlist, getFallbackCover(playlist.name));
        continue;
      }

      const coverSources = (playlist.tracks || [])
        .map(track => getTrackCoverUrl(track))
        .filter(isRealCover)
        .slice(0, 4);

      if (!playlist.images?.length && !coverSources.length) {
        const fetchedCover = await fetchPlaylistCoverFromTracks(playlist, importSessionId);
        if (fetchedCover) {
          setPlaylistCover(playlist, fetchedCover);
          if (!playlist.coverSources) playlist.coverSources = [];
          playlist.coverSources.unshift(fetchedCover);
          playlist.coverSources = playlist.coverSources.slice(0, 4);
          continue;
        }
      }

      // Gera mosaico se houver múltiplas capas
      if (coverSources.length > 1) {
        try {
          const mosaic = await gerarCapaPlaylist(coverSources);
          if (mosaic) {
            playlist.coverSources = coverSources;
            setPlaylistCover(playlist, mosaic);
            continue;
          }
        } catch (error) {
          console.warn(`⚠️ [COVER] Falha ao gerar mosaico: ${error.message}`);
        }
      }

      // Usa capa única se houver apenas uma (mesmo que já tenha fallback)
      if (coverSources.length === 1) {
        setPlaylistCover(playlist, coverSources[0]);
        continue;
      }

      setPlaylistCover(playlist, getFallbackCover(playlist.name));
    }

    if (importSessionId === state.currentImportSessionId && state.playlists.length) {
      renderPlaylists();
    }

    return playlists;
  }

  async function enrichTracksWithCovers(tracks = [], importSessionId = state.currentImportSessionId) {
    if (!tracks.length) return tracks;

    if (!state.playlistCoversReady && state.playlistCoverPromise) {
      try {
        await state.playlistCoverPromise;
      } catch (_) { /* ignore */ }
    }

    if (!state.playlistUiApplied && state.playlistUiAppliedPromise) {
      try {
        await state.playlistUiAppliedPromise;
      } catch (_) { /* ignore */ }
    }

    const concurrency = 1;
    let index = 0;

    async function worker() {
      while (index < tracks.length) {
        const currentIndex = index++;
        const track = tracks[currentIndex];
        if (!track) continue;

        const hasRealCover = track.thumbnail
          && !track.generatedCover
          && !isFallbackCover(track.thumbnail)
          && !isGeneratedCover(track.thumbnail);

        if (hasRealCover) continue;

        const artistLabel = getTrackArtists(track).replace(/, /g, ' ');
        try {
          const cover = await buscarCapaFaixa(getTrackTitle(track), artistLabel);
          const safeCover = sanitizeImageUrl(cover);
          if (safeCover) {
            track.thumbnail = safeCover;
            track.album = track.album || {};
            track.album.images = [{ url: safeCover }];
            track.generatedCover = isFallbackCover(safeCover);
            applyCoverToStateAndUi(track, safeCover, importSessionId);
          }
        } catch (error) {
          console.warn(`⚠️ [COVER] Erro ao enriquecer faixa "${track.name}": ${error.message}`);
        }
        const coverDelay = state.coverLastSuccessProxy === 'jina' ? 400 : 250;
        await delay(coverDelay); // evitar saturar proxies
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return tracks;
  }

  async function refreshCoversAfterEnrichment(importSessionId) {
    if (!state.playlistsLoaded || isImportSessionStale(importSessionId)) return;

    let playlistsUpdated = false;

    for (const playlist of state.playlists) {
      if (!playlist?.tracks?.length) continue;

      const isPreset = isPresetPlaylistName(playlist.name);
      
      // Se a playlist já tem uma capa definida (não genérica), pula
      const playlistDefinedCover = isRealCover(playlist.cover) && !playlist.cover.includes('genericCover');
      if (playlistDefinedCover) continue;

      // Tentar buscar capa real da playlist do Deezer se ainda não tiver
      if (!playlist.playlistCover && !isPreset) {
        try {
          const deezerCover = await buscarCapaPlaylist(playlist.name);
          if (isRealCover(deezerCover)) {
            playlist.playlistCover = deezerCover;
          }
        } catch (error) {
          // Silencioso
        }
      }

      const playlistCover = sanitizeImageUrl(playlist.playlistCover);
      const hasPlaylistCover = isRealCover(playlistCover);

      const trackSources = playlist.tracks
        .map(track => getTrackCoverUrl(track))
        .filter(isRealCover)
        .slice(0, 4);

      const realSources = trackSources;
      playlist.coverSources = realSources.length ? realSources : [];

      const currentCover = playlist.images?.[0]?.url || '';
      const hasMosaicCover = currentCover && isMosaicCover(currentCover);
      const hasSavedSources = Array.isArray(playlist.coverSources) && playlist.coverSources.length > 1;
      const hasRealCover = currentCover
        && !isFallbackCover(currentCover)
        && !isGeneratedCover(currentCover)
        && !isMosaicCover(currentCover);

      if (hasPlaylistCover && currentCover !== playlistCover) {
        setPlaylistCover(playlist, playlistCover);
        playlistsUpdated = true;
        continue;
      }

      // Se já tem playlistCover, não precisa gerar mosaico
      if (hasPlaylistCover) continue;

      // Mantém mosaico existente (preservar capa gerada)
      if (hasMosaicCover) {
        // Se não havia coverSources, salve as detectadas agora para futuros refresh
        if (!hasSavedSources && realSources.length > 1) {
          playlist.coverSources = realSources;
        }
        continue;
      }

      if (hasRealCover) continue;

      if (isPreset) {
        const fallbackSrc = getFallbackCover(playlist.name);
        if (!currentCover || isMosaicCover(currentCover)) {
          playlist.images = [{ url: fallbackSrc }];
          playlistsUpdated = true;
        }
        continue;
      }

      // Substitui capa atual se houver múltiplas capas (mesmo que já tenha mosaico/fallback)
      if (realSources.length > 1) {
        const needsUpdate = isFallbackCover(currentCover) || isGeneratedCover(currentCover) || isMosaicCover(currentCover) || !currentCover;
        if (needsUpdate) {
          try {
            const mosaic = await gerarCapaPlaylist(realSources);
            if (mosaic) {
              setPlaylistCover(playlist, mosaic);
              playlistsUpdated = true;
              continue;
            }
          } catch (error) {
            console.warn(`⚠️ [COVER] Falha ao atualizar mosaico: ${error.message}`);
          }
        }
      }

      // Substitui capa atual se houver apenas uma capa (mesmo que já tenha fallback)
      if (realSources.length === 1) {
        const single = realSources[0];
        if (single && (isFallbackCover(currentCover) || isGeneratedCover(currentCover) || !currentCover)) {
          setPlaylistCover(playlist, single);
          playlistsUpdated = true;
          continue;
        }
      }

      if (!hasMosaicCover) { // não sobrescrever mosaico existente mesmo sem fontes novas
        setPlaylistCover(playlist, getFallbackCover(playlist.name));
        playlistsUpdated = true;
      }
    }

    if (isImportSessionStale(importSessionId)) return;

    if (playlistsUpdated) {
      renderPlaylists();
    }

    if (state.currentPlaylist) {
      refreshTracksView();
    }
  }

  function parseDurationToMs(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const text = String(value).trim();
    if (!text) return null;

    // Try integer ms
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      // Heuristic: values larger than 1000 are likely ms, otherwise seconds
      return numeric > 1000 ? numeric : numeric * 1000;
    }

    // Try mm:ss or hh:mm:ss
    const parts = text.split(':').map(Number);
    if (parts.every(p => Number.isFinite(p))) {
      let seconds = 0;
      if (parts.length === 3) {
        const [hh, mm, ss] = parts;
        seconds = (hh * 3600) + (mm * 60) + ss;
      } else if (parts.length === 2) {
        const [mm, ss] = parts;
        seconds = (mm * 60) + ss;
      } else if (parts.length === 1) {
        seconds = parts[0];
      }
      return seconds * 1000;
    }

    return null;
  }

  function parseCsvText(text) {
    const content = (text || '').replace(/^\uFEFF/, '').trim();
    if (!content) return { headers: [], rows: [] };

    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    if (!lines.length) return { headers: [], rows: [] };

    const delimiterGuess = (() => {
      const comma = (lines[0].match(/,/g) || []).length;
      const semicolon = (lines[0].match(/;/g) || []).length;
      return semicolon > comma ? ';' : ',';
    })();

    const parseLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
            continue;
          }
          inQuotes = !inQuotes;
          continue;
        }

        if (char === delimiterGuess && !inQuotes) {
          result.push(current);
          current = '';
          continue;
        }

        current += char;
      }

      result.push(current);
      return result.map(cell => cell.trim());
    };

    const rows = lines.map(parseLine);
    const headers = rows.shift() || [];
    const dataRows = rows.filter(row => row.some(cell => cell && cell.trim() !== ''));
    return { headers, rows: dataRows };
  }

  async function buildPlaylistsFromTracks(tracks = []) {
    const map = new Map();
    tracks.forEach((track) => {
      const playlistName = track.playlistName || 'Playlist importada';
      if (!map.has(playlistName)) {
        map.set(playlistName, {
          id: `csv-${playlistName}-${map.size + 1}-${Date.now()}`,
          name: playlistName,
          images: [],
          tracks: [],
          coverSources: [],
          playlistCover: null
        });
      }
      const playlist = map.get(playlistName);
      playlist.tracks.push(track);

      if (!track.thumbnail) {
        track.thumbnail = getFallbackCover(getTrackTitle(track));
        track.generatedCover = true;
      }

      const playlistImage = sanitizeImageUrl(track.playlistImage);
      if (playlistImage && !playlist.playlistCover && isRealCover(playlistImage)) {
        playlist.playlistCover = playlistImage;
      }

      const cover = getTrackCoverUrl(track);
      if (cover && !track.generatedCover && isRealCover(cover)) {
        playlist.coverSources.push(cover);
      }
    });

    const playlists = Array.from(map.values());

    // Buscar capas de playlist do Deezer para playlists sem preset
    const playlistCoverPromises = playlists
      .filter(pl => !isPresetPlaylistName(pl.name) && !pl.playlistCover)
      .map(async (pl) => {
        try {
          const cover = await buscarCapaPlaylist(pl.name);
          if (isRealCover(cover)) {
            pl.playlistCover = cover;
          }
        } catch (error) {
          // Silencioso
        }
      });

    await Promise.all(playlistCoverPromises);

    // Preload de 4 capas de faixas para playlists sem preset
    const trackCoverPromises = playlists
      .filter(pl => !isPresetPlaylistName(pl.name) && !pl.playlistCover)
      .map(async (pl) => {
        const tracksToPreload = pl.tracks.slice(0, 4);
        const coverPromises = tracksToPreload.map(async (track) => {
          try {
            const artistNames = getTrackArtists(track);
            const cover = await buscarCapaFaixa(getTrackTitle(track), artistNames);
            if (isRealCover(cover)) {
              return cover;
            }
          } catch (error) {
            // Silencioso
          }
          return null;
        });

        const covers = (await Promise.all(coverPromises)).filter(Boolean);
        if (covers.length > 0) {
          pl.coverSources = [...covers, ...pl.coverSources];
        }
      });

    await Promise.all(trackCoverPromises);

    for (const playlist of playlists) {
      const isPreset = isPresetPlaylistName(playlist.name);
      
      // Se a playlist já tem uma capa definida (não genérica), pula
      const playlistDefinedCover = isRealCover(playlist.cover) && !playlist.cover.includes('genericCover');
      if (playlistDefinedCover) {
        playlist.images = [{ url: playlist.cover }];
        continue;
      }

      // Prioridade 1: playlistCover real (capa específica da playlist)
      if (playlist.playlistCover) {
        const cleanCover = sanitizeImageUrl(playlist.playlistCover);
        if (isRealCover(cleanCover)) {
          playlist.images = [{ url: cleanCover }];
          continue;
        }
      }

      // Prioridade 2: preset cover (apenas se não houver playlistCover)
      const presetCover = sanitizeImageUrl(getPresetCoverForPlaylist(playlist.name));
      if (presetCover) {
        playlist.images = [{ url: presetCover }];
        continue;
      }

      // Se for preset mas não tem capa preset, usa fallback e pula geração de mosaico
      if (isPreset) {
        playlist.images = [{ url: getFallbackCover(playlist.name) }];
        continue;
      }

      const coverSources = (playlist.coverSources || [])
        .map(sanitizeImageUrl)
        .filter(isRealCover)
        .slice(0, 4);

      // Gera mosaico se houver múltiplas capas
      if (coverSources.length > 1) {
        try {
          const mosaic = await gerarCapaPlaylist(coverSources);
          if (mosaic) {
            playlist.images = [{ url: mosaic }];
            continue;
          }
        } catch (error) {
          console.warn(`⚠️ [COVER] Falha ao gerar mosaico: ${error.message}`);
        }
      }

      // Usa capa única se houver apenas uma
      if (coverSources.length === 1) {
        playlist.images = [{ url: coverSources[0] }];
        continue;
      }

      if (!playlist.images?.length) {
        const fallbackSrc = getFallbackCover(playlist.name);
        playlist.images = [{ url: fallbackSrc }];
      }
    }

    return playlists;
  }

  function normalizeCsvRows(rows, headers, fallbackPlaylistName) {
    const columns = detectColumns(headers);

    const getCell = (row, index) => {
      if (index === -1 || index === undefined || index === null) return '';
      return (row[index] || '').trim();
    };

    return rows.map((row, index) => {
      const title = getCell(row, columns.title) || getCell(row, 0);
      const artistRaw = getCell(row, columns.artist);
      const album = getCell(row, columns.album);
      const thumbnail = sanitizeImageUrl(getCell(row, columns.image));
      const isrc = getCell(row, columns.isrc);
      const playlistName = getCell(row, columns.playlist) || fallbackPlaylistName || 'Playlist importada';
      const playlistImageRaw = getCell(row, columns.playlistImage);
      const playlistImage = sanitizeImageUrl(playlistImageRaw);
      const durationMs = parseDurationToMs(getCell(row, columns.durationMs) || getCell(row, columns.duration));

      if (!title && !artistRaw) return null;

      const artists = (artistRaw || '').split(/[;,&|]/).map(a => a.trim()).filter(Boolean);

      return {
        id: isrc || `${title || artistRaw || 'track'}-${index}`,
        name: title || artistRaw || 'Faixa sem título',
        title: title || '',
        artists: artists.length ? artists.map(name => ({ name })) : [{ name: artistRaw || '' }].filter(a => a.name),
        album: {
          name: album || '',
          images: thumbnail ? [{ url: thumbnail }] : (playlistImage ? [{ url: playlistImage }] : [])
        },
        thumbnail: thumbnail || playlistImage || '',
        isrc: isrc || '',
        playlistName,
        playlistImage,
        duration_ms: durationMs
      };
    }).filter(Boolean);
  }

  async function importPlaylistFromCsv(file) {
    if (!file) return;

    state.importInProgress = true;
    const importSessionId = Date.now();
    state.currentImportSessionId = importSessionId;
    state.playlistCoverPromise = null;
    state.playlistCoversReady = false;
    state.playlistUiAppliedPromise = null;
    state.playlistUiApplied = false;
    
    const fileName = file.name.replace(/\.csv$/i, '');
    
    setFeedback('Carregando...', 'info', {
      name: fileName,
      cover: getFallbackCover(file.name)
    });

    // Verifica tamanho do arquivo (máximo 50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setFeedback('Arquivo muito grande', 'error', {
        name: fileName,
        subtitle: 'Máximo 50MB'
      });
      console.error(`❌ [IMPORT] Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      state.importInProgress = false;
      return;
    }

    console.log(`🌐 [IMPORT] Iniciando importação do CSV "${file.name}" (${(file.size / 1024).toFixed(1)}KB)`);

    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (e) => {
          const errorMsg = reader.error?.message || 'Erro desconhecido';
          console.error(`❌ [IMPORT] FileReader error:`, reader.error);
          reject(new Error(`Erro ao ler arquivo: ${errorMsg}`));
        };
        reader.onabort = () => reject(new Error('Leitura do arquivo foi cancelada'));
        try {
          reader.readAsText(file, 'UTF-8');
        } catch (readError) {
          reject(new Error(`Erro ao iniciar leitura: ${readError.message}`));
        }
      });

      const { headers, rows } = parseCsvText(text);
      if (!rows.length) {
        setFeedback('Playlist vazia', 'error', {
          name: fileName,
          subtitle: 'Nenhuma faixa encontrada'
        });
        if (state.playlistsLoaded && state.tracks.length) {
          renderTracks(state.tracks);
        }
        console.error(`❌ [IMPORT] CSV inválido: vazio`);
        return;
      }

      const normalizedTracks = normalizeCsvRows(rows, headers, getPlaylistNameFromFile(file.name));

      if (!normalizedTracks.length) {
        setFeedback('Formato inválido', 'error', {
          name: fileName,
          subtitle: 'Verifique o arquivo CSV'
        });
        if (state.playlistsLoaded && state.tracks.length) {
          renderTracks(state.tracks);
        }
        console.error(`❌ [IMPORT] CSV inválido: sem faixas reconhecíveis`);
        return;
      }

      const playlists = await buildPlaylistsFromTracks(normalizedTracks);

      if (!playlists.length) {
        setFeedback('Playlist vazia', 'error', {
          name: fileName,
          subtitle: 'Nenhuma faixa encontrada'
        });
        console.error(`❌ [IMPORT] Nenhuma playlist reconhecida`);
        return;
      }

      // Resetar caches e estado
      resetPlaybackState({ resetTrackIndex: true, clearTracks: false, clearCaches: true });

      // Preserva a playlist "Músicas Favoritas" e adiciona as novas
      const watchLater = loadWatchLaterPlaylist();
      state.playlists = [watchLater, ...playlists];
      state.playlistsLoaded = true;
      state.currentPlaylist = null;
      state.tracks = [];

      state.playlistCoverPromise = enrichPlaylistsWithCovers(state.playlists, importSessionId);
      try {
        await state.playlistCoverPromise;
      } finally {
        state.playlistCoversReady = true;
      }

      renderPlaylists();
      updatePlaylistEmptyState();

      // Salva playlists no storage
      debouncedSave();

      selectPlaylist(state.playlists[0], false, { preloadAudio: false });

      state.playlistUiAppliedPromise = waitForNextFrame().then(() => {
        state.playlistUiApplied = true;
      });
      try {
        await state.playlistUiAppliedPromise;
      } catch (_) { /* ignore */ }

      const coverEnrichmentPromise = enrichTracksWithCovers(state.tracks.length ? state.tracks : normalizedTracks, importSessionId)
        .catch(error => console.warn(`⚠️ [COVER] Enriquecimento parcial falhou: ${error.message}`));
      coverEnrichmentPromise.then(() => {
        refreshCoversAfterEnrichment(importSessionId);
      });

      console.log(`🌐 [IMPORT] Importação concluída com ${normalizedTracks.length} faixas`);

      if (normalizedTracks.length) {
        const tracksToPreload = state.tracks.length ? state.tracks : normalizedTracks;
        preloadTracksInBackground(tracksToPreload).then(() => {
          console.log(`✅ [LOAD] Todas as faixas processadas`);
        });
      }

      const importedPlaylist = state.playlists[1] || state.playlists[0];
      const playlistCover = getPlaylistCover(importedPlaylist);
      setFeedback('Importada com sucesso', 'success', {
        name: importedPlaylist?.name || 'Playlist',
        cover: playlistCover,
        subtitle: `${normalizedTracks.length} faixas`
      });
    } catch (error) {
      console.error(`❌ [IMPORT] CSV inválido: ${error.message}`);
      setFeedback('Erro na importação', 'error', {
        name: fileName,
        subtitle: 'Verifique o arquivo CSV'
      });
      if (state.playlistsLoaded && state.tracks.length) {
        renderTracks(state.tracks);
      }
    } finally {
      state.importInProgress = false;
    }
  }

  function renderPlaylists(playlists = state.playlists, scrollToFirst = false) {
    if (!ui.playlistsContainer) return;

    // Garante que a playlist "Músicas Favoritas" sempre exista
    ensureWatchLaterPlaylist();

    // Filtra playlists: "Músicas Favoritas" só aparece se tiver faixas
    const visiblePlaylists = playlists.filter(p => {
      if (p.id === WATCH_LATER_PLAYLIST_ID) {
        return p.tracks?.length > 0;
      }
      return true;
    });

    if (!visiblePlaylists.length) {
      ui.playlistsContainer.innerHTML = '';
      updatePlaylistEmptyState();
      return;
    }

    // Ordena para garantir que "Músicas Favoritas" fique primeiro
    const sortedPlaylists = [...visiblePlaylists].sort((a, b) => {
      if (a.id === WATCH_LATER_PLAYLIST_ID) return -1;
      if (b.id === WATCH_LATER_PLAYLIST_ID) return 1;
      return 0;
    });

    ui.playlistsContainer.innerHTML = sortedPlaylists.map(playlist => {
      const isWatchLater = playlist.id === WATCH_LATER_PLAYLIST_ID;
      const trackCount = getPlaylistTrackCount(playlist);

      let imageContent;
      if (isWatchLater) {
        // Usa a capa da primeira música
        const firstTrackCover = playlist.tracks[0]?.thumbnail || getFallbackCover(playlist.name);
        imageContent = `
          <img src="${firstTrackCover}" 
            alt="${playlist.name}" 
            class="w-32 h-32 object-cover group-hover:scale-110 transition-transform duration-300">
        `;
      } else {
        const imageUrl = getPlaylistCover(playlist);
        imageContent = `
          <img src="${imageUrl}" 
            alt="${playlist.name}" 
            class="w-32 h-32 object-cover group-hover:scale-110 transition-transform duration-300">
        `;
      }

      return `
      <div class="playlist-item flex-shrink-0 w-32 group cursor-pointer" data-playlist-id="${playlist.id}">
        <div class="relative rounded-md overflow-hidden shadow-lg transition-all duration-300">
          ${imageContent}
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
            <button class="delete-playlist-btn liquid-glass w-10 h-10 rounded-full flex items-center justify-center transform scale-75 group-hover:scale-100 transition-all duration-300 hover:bg-red-500/30">
              <i class="ph-bold ph-trash text-lg text-white"></i>
            </button>
          </div>
        </div>
        <p class="text-white mt-2 text-xs truncate text-center">${playlist.name}</p>
        <p class="text-white/60 text-[11px] text-center">${trackCount} faixa${trackCount === 1 ? '' : 's'}</p>
      </div>
    `;
    }).join('');

    ui.playlistsContainer.querySelectorAll('.playlist-item').forEach(card => {
      const playlist = sortedPlaylists.find(p => p.id === card.dataset.playlistId);

      card.addEventListener('click', () => {
        if (!playlist) return;

        if (state.currentPlaylist && state.currentPlaylist.id === playlist.id) {
          openPlayerModal();
          return;
        }

        selectPlaylist(playlist, false);
      });

      card.querySelector('.delete-playlist-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!playlist) return;
        
        deletePlaylist(playlist.id);
      });
    });

    // Inicializa o carrossel 3D
    initCarousel3D(scrollToFirst);
    
    // Atualiza o empty state
    updatePlaylistEmptyState();
  }

  // Carrossel 3D - atualiza classes baseado na posição do scroll
  let carouselScrollHandler = null;
  let carouselRafId = null;

  function updateCarouselPositions() {
    const container = ui.playlistsContainer;
    if (!container) return;

    const items = container.querySelectorAll('.playlist-item');
    if (!items.length) return;

    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;

    items.forEach(item => {
      const itemRect = item.getBoundingClientRect();
      const itemCenter = itemRect.left + itemRect.width / 2;
      const distance = itemCenter - containerCenter;
      const itemWidth = itemRect.width + 4; // width + gap

      // Remove todas as classes de posição
      item.classList.remove('carousel-center', 'carousel-left-1', 'carousel-right-1', 'carousel-left-2', 'carousel-right-2');

      // Calcula posição relativa
      const position = Math.round(distance / itemWidth);

      if (Math.abs(position) === 0) {
        item.classList.add('carousel-center');
      } else if (position === -1) {
        item.classList.add('carousel-left-1');
      } else if (position === 1) {
        item.classList.add('carousel-right-1');
      } else if (position <= -2) {
        item.classList.add('carousel-left-2');
      } else if (position >= 2) {
        item.classList.add('carousel-right-2');
      }
    });
  }

  function initCarousel3D(scrollToFirst = false) {
    if (!ui.playlistsContainer) return;

    // Remove listener anterior se existir
    if (carouselScrollHandler) {
      ui.playlistsContainer.removeEventListener('scroll', carouselScrollHandler);
    }

    // Cria novo handler com throttle
    carouselScrollHandler = () => {
      if (carouselRafId) return;
      carouselRafId = requestAnimationFrame(() => {
        updateCarouselPositions();
        carouselRafId = null;
      });
    };

    // Atualiza posições no scroll
    ui.playlistsContainer.addEventListener('scroll', carouselScrollHandler, { passive: true });

    // Se deve scrollar para o primeiro item (ex: após adicionar nova playlist)
    if (scrollToFirst) {
      ui.playlistsContainer.scrollLeft = 0;
    }

    // Atualiza posições iniciais
    requestAnimationFrame(updateCarouselPositions);

    // Atualiza também após um pequeno delay (para garantir que o layout está pronto)
    setTimeout(updateCarouselPositions, 50);
    setTimeout(updateCarouselPositions, 150);
    setTimeout(updateCarouselPositions, 300);
  }

  async function selectPlaylist(playlist, autoPlay = false, options = {}) {
    if (!playlist) return;
    const { preloadAudio = true } = options;

    console.log(`🎵 [PLAYLIST] Selecionando playlist: "${playlist.name}"`);

    // Limpa estado de reprodução do YouTube se estiver ativo
    clearYouTubePlaybackState({ updateUi: false });

    // Atualiza a visualização (não afeta a reprodução em andamento)
    state.currentPlaylist = playlist;
    state.tracks = playlist.tracks || [];

    // Se a playlist selecionada é a mesma que está tocando, sincroniza o índice
    if (state.playingPlaylistId === playlist.id) {
      state.currentTrackIndex = state.playingTrackIndex;
    } else {
      state.currentTrackIndex = -1;
    }

    state.audioRecoveryInProgress = false;
    state.searchCache.clear();
    state.searchPromises.clear();
    // Não limpa audioCache para manter músicas em cache
    state.audioErrorCounts.clear();

    // Salva estado atual
    debouncedSave();

    updateUiState();

    if (!ui.tracksContainer) return;

    if (!state.tracks.length) {
      if (playlist.id !== WATCH_LATER_PLAYLIST_ID) {
        setFeedback('Playlist vazia', 'error', getPlaylistFeedbackInfo(playlist));
      }
      return;
    }

    state.tracks = state.tracks.map((track) => {
      if (!track) return track;
      const hasThumb = isRealCover(track.thumbnail);
      if (!hasThumb) {
        track.thumbnail = getFallbackCover(getTrackTitle(track));
        track.generatedCover = true;
      }
      return track;
    });

    renderTracks(state.tracks);

    // Se a playlist selecionada é a mesma que está tocando, reinicia o countdown
    // para atualizar os novos elementos DOM
    if (state.playingPlaylistId === playlist.id && state.isPlaying) {
      startPlaybackCountdown();
    }

    const playlistId = playlist.id;
    const importSessionId = state.currentImportSessionId;
    enrichTracksWithCovers(state.tracks, importSessionId)
      .then(() => {
        if (isImportSessionStale(importSessionId)) return;
        if (!state.currentPlaylist || state.currentPlaylist.id !== playlistId) return;
        refreshTracksView();
        // Reinicia countdown após re-render se a playlist está tocando
        if (state.playingPlaylistId === playlistId && state.isPlaying) {
          startPlaybackCountdown();
        }
        console.log(`🎯 [SELECT] enrichTracksWithCovers concluído, chamando refreshCoversAfterEnrichment...`);
        refreshCoversAfterEnrichment(importSessionId);
      })
      .catch(() => { });

    if (preloadAudio && !state.preloadedPlaylists.has(playlist.id)) {
      console.log(`🔄 [PRELOAD] Iniciando resolução de ${state.tracks.length} faixas`);
      preloadTracksInBackground(state.tracks).then(() => {
        state.preloadedPlaylists.add(playlist.id);
        console.log(`✅ [PRELOAD] Todas as faixas processadas`);
      });
    } else if (state.preloadedPlaylists.has(playlist.id)) {
      console.log(`⏭️ [PRELOAD] Playlist "${playlist.name}" já foi pré-carregada, pulando`);
    }

    if (autoPlay && state.tracks.length > 0) {
      setTimeout(() => playNextFrom(0), 400);
    }
  }

  // Pré-carrega faixas em segundo plano com rate limiting
  async function preloadTracksInBackground(tracks) {
    // Rate limit: 2 requests por segundo para evitar 429
    const delayBetweenRequests = 600;
    const results = [];

    for (let i = 0; i < tracks.length; i++) {
      const result = await preloadSingleTrack(tracks[i], i);
      results.push(result);

      // Delay entre requests para respeitar rate limit da API
      if (i < tracks.length - 1) {
        await delay(delayBetweenRequests);
      }
    }

    return results;
  }

  async function preloadSingleTrack(track, index, retryCount = 0) {
    if (!track || track.unavailable) return null;
    const maxRetries = 1;

    try {
      const result = await resolveTrackWithCache(track, index);

      if (result && result.audioUrl) {
        return result;
      } else {
        if (retryCount < maxRetries) {
          console.log(`🔄 [PRELOAD] Track ${index} not found, retrying with search... (${retryCount + 1}/${maxRetries + 1})`);
          // Limpa o videoId para forçar nova busca
          const originalVideoId = clearTrackVideoId(track);
          // Limpa cache da faixa
          const trackKey = getTrackKey(track);
          if (trackKey) {
            clearTrackCaches(trackKey);
          }
          await delay(800);
          const retryResult = await preloadSingleTrack(track, index, retryCount + 1);
          // Restaura o videoId original se a busca também falhar
          if (!retryResult && originalVideoId) {
            track._videoId = originalVideoId;
          }
          return retryResult;
        }
        console.log(`❌ [PRELOAD] Track ${index} not found after ${maxRetries + 1} attempts`);
        markTrackUnavailable(index);
        return null;
      }
    } catch (error) {
      if (retryCount < maxRetries) {
        console.log(`🔄 [PRELOAD] Track ${index} failed, retrying with search... (${retryCount + 1}/${maxRetries + 1})`);
        // Limpa o videoId para forçar nova busca
        const originalVideoId = clearTrackVideoId(track);
        // Limpa cache da faixa
        const trackKey = getTrackKey(track);
        if (trackKey) {
          clearTrackCaches(trackKey);
        }
        await delay(800);
        const retryResult = await preloadSingleTrack(track, index, retryCount + 1);
        // Restaura o videoId original se a busca também falhar
        if (!retryResult && originalVideoId) {
          track._videoId = originalVideoId;
        }
        return retryResult;
      }
      console.log(`❌ [PRELOAD] Track ${index} failed after ${maxRetries + 1} attempts`);
      markTrackUnavailable(index);
      return null;
    }
  }

  // Helper para obter nome dos artistas de uma track
  function getTrackArtists(track) {
    return (track?.artists || []).map(a => a.name).filter(Boolean).join(', ') || '';
  }

  // Helper para obter título da track
  function getTrackTitle(track) {
    return track?.name || track?.title || '';
  }

  // Helper para comparar se duas tracks são iguais
  function isSameTrack(track1, track2) {
    if (!track1 || !track2) return false;
    return track1.name === track2.name && 
           JSON.stringify(track1.artists) === JSON.stringify(track2.artists);
  }

  // Helper para obter capa sanitizada da track (sem fallback)
  function getTrackCoverUrl(track) {
    return sanitizeImageUrl(track?.thumbnail) || sanitizeImageUrl(track?.album?.images?.[0]?.url) || '';
  }

  function getTrackImage(track) {
    const candidates = [
      track.thumbnail,
      track.album?.images?.[2]?.url,
      track.album?.images?.[0]?.url
    ].map(sanitizeImageUrl).filter(Boolean);

    if (candidates.length) return candidates[0];
    return getFallbackCover(track?.name);
  }

  // Helper para obter capa da playlist
  function getPlaylistCover(playlist) {
    return playlist?.images?.[0]?.url || playlist?.cover || getFallbackCover(playlist?.name);
  }

  function isAudioContentType(contentType = '') {
    const lower = contentType.toLowerCase();
    return /audio|video|octet-stream/.test(lower);
  }

  // Valida URLs que passam pelo proxy (evita cachear HTML/erros como áudio)
  async function isPlayableAudioUrl(url) {
    if (!url) return { playable: false, reason: 'empty' };

    const isProxied = isProxyUrl(url) || url.startsWith('/proxy');

    // URLs sem proxy não conseguem ser validadas por CORS; confiar nelas
    if (!isProxied) return { playable: true, reason: 'non-proxied' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_VALIDATION_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Range: PROXY_RANGE_HEADER }
      });
      clearTimeout(timer);

      const contentType = resp.headers.get('content-type') || '';
      const len = resp.headers.get('content-length');

      if (!(resp.ok || resp.status === 206)) {
        console.warn(`⚠️ [AUDIO] Validação HTTP falhou para ${url} (status ${resp.status})`);
        return { playable: false, status: resp.status, contentType };
      }

      const playable = isAudioContentType(contentType) && (len === null || Number(len) >= 0);
      if (!playable) {
        console.warn(`⚠️ [AUDIO] Validação inválida para ${url} (${resp.status} ${contentType || 'sem content-type'})`);
      }
      return { playable, status: resp.status, contentType };
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error?.name === 'AbortError' || /abort/i.test(error?.message || '');
      console.warn(`⚠️ [AUDIO] Validação falhou para ${url}: ${error.message}`);
      return { playable: false, error: error.message, aborted: isAbort };
    }
  }

  let playbackCountdownRaf = null;

  function extractDurationMs(source) {
    if (!source) return null;

    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const durationMs = toNumber(source.duration_ms) ?? toNumber(source.durationMs);
    if (Number.isFinite(durationMs)) return durationMs;

    const seconds =
      toNumber(source.lengthSeconds) ??
      toNumber(source.length) ??
      toNumber(source.duration);

    if (Number.isFinite(seconds)) return seconds * 1000;
    return null;
  }

  function updateTrackDurationFromResult(track, index, result) {
    const durationMs = extractDurationMs(result);
    if (!track || !Number.isFinite(durationMs)) return;

    const current = extractDurationMs(track);
    const hasCurrent = Number.isFinite(current);
    const shouldUpdate = !hasCurrent || Math.abs(current - durationMs) > 500;
    if (shouldUpdate) {
      track.duration_ms = durationMs;
      track.durationMs = durationMs;
    }

    const targetIndex = Number.isInteger(index) ? index : state.tracks.indexOf(track);
    setTrackDurationLabel(targetIndex, durationMs);
  }

  function getTrackDurationMs(track) {
    return extractDurationMs(track) ?? (Number.isFinite(audio.duration) ? audio.duration * 1000 : null);
  }

  function setTrackDurationLabel(index, ms) {
    const durationEl = getTrackElement(index)?.querySelector('.track-duration');
    if (durationEl) {
      durationEl.textContent = Number.isFinite(ms) ? formatDuration(ms) : '--:--';
    }
  }

  function resetTrackDurationLabel(index, overrideMs = null) {
    if (index < 0 || index >= state.tracks.length) return;
    const track = state.tracks[index];
    const durationMs = Number.isFinite(overrideMs) ? overrideMs : getTrackDurationMs(track);
    setTrackDurationLabel(index, durationMs);
  }

  function stopPlaybackCountdown({ resetLabel = false, finalValueMs = null, index = null } = {}) {
    if (playbackCountdownRaf) {
      cancelAnimationFrame(playbackCountdownRaf);
      playbackCountdownRaf = null;
    }
    if (resetLabel) {
      const targetIndex = Number.isInteger(index) ? index : state.currentTrackIndex;
      if (targetIndex >= 0) {
        resetTrackDurationLabel(targetIndex, finalValueMs);
        resetTrackProgress(targetIndex);
      }
    }
  }

  function updatePlaybackCountdown() {
    if (!state.isPlaying || audio.paused || !isLibraryPlaybackVisible()) {
      playbackCountdownRaf = null;
      return;
    }

    const activeIndex = getActiveLibraryIndex();
    if (activeIndex < 0) {
      playbackCountdownRaf = null;
      return;
    }

    const track = state.tracks[activeIndex];
    const durationMs = getTrackDurationMs(track);
    if (!Number.isFinite(durationMs)) {
      playbackCountdownRaf = null;
      return;
    }

    const currentMs = audio.currentTime * 1000;
    const remainingMs = Math.max(0, durationMs - currentMs);
    setTrackDurationLabel(activeIndex, remainingMs);

    // Atualiza a barra de progresso
    const progress = Math.min(100, (currentMs / durationMs) * 100);
    updateTrackProgress(activeIndex, progress);

    playbackCountdownRaf = requestAnimationFrame(updatePlaybackCountdown);
  }

  function updateTrackProgress(index, progress) {
    const trackEl = getTrackElement(index);
    if (trackEl) {
      trackEl.style.setProperty('--progress', `${progress}%`);
    }
  }

  function resetTrackProgress(index) {
    updateTrackProgress(index, 0);
  }

  function startPlaybackCountdown() {
    stopPlaybackCountdown();
    if (!state.isPlaying || !hasValidTrack()) return;
    if (!isLibraryPlaybackVisible()) return;
    updatePlaybackCountdown();
  }

  function clearTracksContent() {
    if (!ui.tracksContainer) return;
    // Remove tudo exceto o empty state
    Array.from(ui.tracksContainer.children).forEach(child => {
      if (child.id !== 'playlist-empty-state') {
        child.remove();
      }
    });
  }

  // Helper para renderizar tracks e atualizar highlight
  function refreshTracksView() {
    renderTracks(state.tracks);
    updateTrackHighlight();
  }

  function renderTracks(tracks) {
    if (!ui.tracksContainer) return;

    clearTracksContent();

    // Esconde o empty state quando há tracks
    updatePlaylistEmptyState();

    if (!tracks.length) {
      return;
    }

    // Adiciona espaçador no topo para a lista começar abaixo da grid
    // pointer-events: none permite que eventos passem para o playlists-container abaixo
    const spacerHtml = '<div class="tracks-top-spacer" style="height: 230px; flex-shrink: 0; pointer-events: none;"></div>';
    ui.tracksContainer.insertAdjacentHTML('beforeend', spacerHtml);

    const isWatchLaterPlaylist = state.currentPlaylist?.id === WATCH_LATER_PLAYLIST_ID;
    const watchLaterPlaylist = getWatchLaterPlaylist();

    const tracksHtml = tracks.map((track, index) => {
      const artists = getTrackArtists(track);
      const duration = formatDuration(extractDurationMs(track));
      const imageUrl = getTrackImage(track);
      const unavailableClass = track.unavailable ? ' track-unavailable' : '';

      // Verifica se a faixa já está nos favoritos
      const isInFavorites = !isWatchLaterPlaylist && watchLaterPlaylist?.tracks.some(t => isSameTrack(t, track));

      // Botão de ação: remover se estiver nos favoritos, senão adicionar
      const actionButton = isWatchLaterPlaylist
        ? `<button class="track-remove-watch-later-btn w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors" 
            data-remove-index="${index}" 
            aria-label="Remover dos favoritos" 
            title="Remover dos favoritos">
            <i class="ph-bold ph-trash text-base"></i>
          </button>`
        : `<button class="track-add-watch-later-btn w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isInFavorites ? 'text-orange-400' : 'text-white/50'} hover:text-orange-400 hover:bg-orange-500/10 transition-colors" 
            data-add-index="${index}" 
            aria-label="${isInFavorites ? 'Já nos favoritos' : 'Adicionar aos favoritos'}" 
            title="${isInFavorites ? 'Já nos favoritos' : 'Adicionar aos favoritos'}">
            <i class="${isInFavorites ? 'ph-fill' : 'ph-bold'} ph-heart text-base"></i>
          </button>`;

      return `
      <div class="track-item cursor-pointer group${unavailableClass}" 
        data-track-index="${index}">
        <div class="flex-shrink-0 w-12 h-12 relative">
          <img src="${imageUrl}" 
            alt="${track.name}" 
            class="w-full h-full rounded-md object-cover track-cover-img">
          <div class="sound-wave-overlay">
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
          </div>
          <div class="track-loading-overlay hidden">
            <i class="ph ph-spinner spinner-icon text-white"></i>
          </div>
          ${track.unavailable ? `<div class="track-reload-overlay">
            <i class="ph-bold ph-arrow-clockwise text-white text-lg"></i>
          </div>` : ''}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate track-title">${track.name}</p>
          <p class="text-white/70 text-xs truncate">${artists}</p>
        </div>
        ${actionButton}
        <div class="text-white/70 text-sm track-duration whitespace-nowrap">${duration}</div>
      </div>
    `;
    }).join('');

    ui.tracksContainer.insertAdjacentHTML('beforeend', tracksHtml);

    ui.tracksContainer.querySelectorAll('.track-item').forEach(item => {
      const index = Number(item.dataset.trackIndex);

      const getSeekableIndex = () => {
        if (!isLibraryPlaybackActive() || !isViewingPlayingPlaylist()) return -1;
        return getActiveLibraryIndex();
      };

      attachSeekHandlers(item, {
        isSeekable: () => index === getSeekableIndex(),
        getDurationMs: () => getTrackDurationMs(state.tracks[index]),
        onSeek: ({ percentage, seekTime, durationMs }) => {
          updateTrackProgress(index, percentage * 100);
          const remainingMs = Math.max(0, durationMs - (seekTime * 1000));
          setTrackDurationLabel(index, remainingMs);
        },
        onClick: () => {
          const track = state.tracks[index];

          // Se a faixa está indisponível, tenta buscar novamente
          if (track?.unavailable) {
            retryUnavailableTrack(index);
            return;
          }

          // Clique simples - play/pause ou selecionar faixa
          const activeIndex = getSeekableIndex();
          const shouldToggle = !isPlayingFromYouTube() && activeIndex >= 0 && index === activeIndex;
          if (shouldToggle) {
            togglePlayback();
          } else {
            playTrack(index);
          }
        }
      });
    });

    // Botões de adicionar/remover dos favoritos
    ui.tracksContainer.querySelectorAll('.track-add-watch-later-btn').forEach(button => {
      button.addEventListener('click', (event) => {
        stopEvent(event);
        const index = Number(button.dataset.addIndex);
        const track = state.tracks[index];
        if (!track) return;
        
        // Verifica se já está nos favoritos
        const watchLater = getWatchLaterPlaylist();
        const isInFavorites = watchLater?.tracks.some(t => isSameTrack(t, track));
        
        if (isInFavorites) {
          // Remove dos favoritos
          const trackIndexInFavorites = watchLater.tracks.findIndex(t => isSameTrack(t, track));
          if (trackIndexInFavorites !== -1) {
            removeFromWatchLaterByTrack(track);
            // Atualiza o ícone para vazio
            updateFavoriteButtonState(button, false);
          }
        } else {
          // Adiciona aos favoritos
          addToWatchLater(track);
        }
      });
    });

    // Botões de remover dos favoritos
    ui.tracksContainer.querySelectorAll('.track-remove-watch-later-btn').forEach(button => {
      button.addEventListener('click', (event) => {
        stopEvent(event);
        const index = Number(button.dataset.removeIndex);
        removeFromWatchLater(index);
      });
    });

    updateTrackHighlight();
    setupTracksScrollEffect();
  }

  function setupTracksScrollEffect() {
    if (!ui.tracksContainer || !ui.playlistsContainer) return;
    
    // Remove listener anterior se existir
    ui.tracksContainer.removeEventListener('scroll', handleTracksScroll);
    ui.tracksContainer.addEventListener('scroll', handleTracksScroll, { passive: true });
    
    // Configura interação entre grid e tracks
    setupGridTracksInteraction();
    
    // Configura o mask fixo baseado na posição da grid
    requestAnimationFrame(() => {
      setupTracksMask();
    });
    
    // Recalcula mask no resize
    window.removeEventListener('resize', setupTracksMask);
    window.addEventListener('resize', setupTracksMask, { passive: true });
    
    // Reset inicial
    handleTracksScroll();
  }
  
  // Configura a interação entre grid e tracks
  function setupGridTracksInteraction() {
    const playerScreen = document.getElementById('player-screen-playlist');
    if (!playerScreen || !ui.tracksContainer || !ui.playlistsContainer) return;
    
    // Wheel event para scroll vertical
    playerScreen.addEventListener('wheel', function(e) {
      if (e.deltaY !== 0) {
        ui.tracksContainer.scrollTop += e.deltaY;
      }
    }, { passive: true });
    
    // Touch handlers com momentum para scroll suave
    let touchStartY = 0;
    let touchStartScrollTop = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityY = 0;
    let isTracking = false;
    let momentumRAF = null;
    
    playerScreen.addEventListener('touchstart', function(e) {
      if (!e.touches.length) return;
      
      // Para qualquer momentum em andamento
      if (momentumRAF) {
        cancelAnimationFrame(momentumRAF);
        momentumRAF = null;
      }
      
      isTracking = true;
      touchStartY = e.touches[0].clientY;
      lastY = touchStartY;
      touchStartScrollTop = ui.tracksContainer.scrollTop;
      lastTime = performance.now();
      velocityY = 0;
    }, { passive: true });
    
    playerScreen.addEventListener('touchmove', function(e) {
      if (!isTracking || !e.touches.length) return;
      
      const now = performance.now();
      const currentY = e.touches[0].clientY;
      const deltaTime = now - lastTime;
      
      // Calcula velocidade
      if (deltaTime > 0) {
        velocityY = (lastY - currentY) / deltaTime;
      }
      
      // Aplica scroll
      const deltaY = touchStartY - currentY;
      ui.tracksContainer.scrollTop = touchStartScrollTop + deltaY;
      
      lastY = currentY;
      lastTime = now;
    }, { passive: true });
    
    playerScreen.addEventListener('touchend', function() {
      if (!isTracking) return;
      isTracking = false;
      
      // Aplica momentum se tiver velocidade
      if (Math.abs(velocityY) > 0.5) {
        applyMomentum();
      }
    }, { passive: true });
    
    function applyMomentum() {
      const friction = 0.95;
      const minVelocity = 0.01;
      
      function step() {
        velocityY *= friction;
        
        if (Math.abs(velocityY) < minVelocity) {
          momentumRAF = null;
          return;
        }
        
        ui.tracksContainer.scrollTop += velocityY * 16;
        momentumRAF = requestAnimationFrame(step);
      }
      
      momentumRAF = requestAnimationFrame(step);
    }
  }

  function handleTracksScroll() {
    if (!ui.tracksContainer || !ui.playlistsContainer) return;
    
    const scrollTop = ui.tracksContainer.scrollTop;
    const maxScroll = 150;
    const progress = Math.min(scrollTop / maxScroll, 1);
    
    // Efeito progressivo na grid
    const opacity = 0.85 - (progress * 0.75);
    const scale = 1 - (progress * 0.08);
    const blur = progress * 4;
    const translateY = -(progress * 15);
    
    ui.playlistsContainer.style.opacity = Math.max(opacity, 0.1);
    ui.playlistsContainer.style.transform = `scale(${scale}) translateY(${translateY}px)`;
    ui.playlistsContainer.style.filter = `blur(${blur}px)`;
    
    // Controle de interação
    const threshold = 50;

    if (scrollTop < threshold) {
      // No topo - grid interativa (playlists acima para receber cliques)
      ui.playlistsContainer.style.zIndex = '20';
      ui.playlistsContainer.style.pointerEvents = 'auto';
      ui.tracksContainer.style.zIndex = '10';
      ui.tracksContainer.style.pointerEvents = 'none';
    } else {
      // Scrollado - tracks em foco
      ui.tracksContainer.style.zIndex = '20';
      ui.tracksContainer.style.pointerEvents = 'auto';
      ui.playlistsContainer.style.zIndex = '5';
      ui.playlistsContainer.style.pointerEvents = 'none';
    }
  }
  
  // Handler de scroll do YouTube - infinite scroll
  function handleYoutubeScroll() {
    if (!ui.youtubeSearchContent) return;
    
    const scrollTop = ui.youtubeSearchContent.scrollTop;
    const { scrollHeight, clientHeight } = ui.youtubeSearchContent;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Infinite scroll - carrega mais quando estiver a 200px do final
    if (distanceFromBottom <= 200) {
      loadMoreYouTubeResults();
    }
  }
  
  // Configura o mask fixo baseado na posição da grid (chamado uma vez)
  function setupTracksMask() {
    if (!ui.tracksContainer || !ui.playlistsContainer) return;
    
    // Calcula a posição real da grid
    const playlistsRect = ui.playlistsContainer.getBoundingClientRect();
    const tracksRect = ui.tracksContainer.getBoundingClientRect();
    
    // Posição do topo da grid relativa ao viewport do container
    const gridTop = playlistsRect.top - tracksRect.top;
    const gridBottom = gridTop + playlistsRect.height;
    
    // O blur começa onde a grid começa e termina onde a grid termina
    const fadeStart = Math.max(0, gridTop);
    const fadeEnd = gridBottom;
    
    // Mask fixo - não muda com scroll
    const maskImage = `linear-gradient(to bottom, 
      transparent 0px, 
      transparent ${fadeStart}px, 
      rgba(0,0,0,0.15) ${fadeStart + 30}px, 
      rgba(0,0,0,0.5) ${fadeStart + 80}px, 
      rgba(0,0,0,0.85) ${fadeStart + 130}px, 
      black ${fadeEnd}px)`;
    
    ui.tracksContainer.style.maskImage = maskImage;
    ui.tracksContainer.style.webkitMaskImage = maskImage;
  }

  function markTrackUnavailable(index) {
    const track = state.tracks[index];
    if (!track || track.unavailable) return;

    const trackKey = getTrackKey(track);
    const cachedResult = trackKey ? getCacheEntry(state.searchCache, trackKey) : null;
    track.unavailable = true;
    resetAudioError(index);

    // Remove entradas do cache
    clearTrackCaches(trackKey, cachedResult);

    // Atualizar UI
    const element = getTrackElement(index);
    if (element) {
      element.classList.add('track-unavailable');
      element.querySelector('.track-title')?.classList.add('line-through');
      
      // Adiciona overlay de reload se não existir
      const coverContainer = element.querySelector('.flex-shrink-0');
      if (coverContainer && !coverContainer.querySelector('.track-reload-overlay')) {
        const reloadOverlay = document.createElement('div');
        reloadOverlay.className = 'track-reload-overlay';
        reloadOverlay.innerHTML = '<i class="ph-bold ph-arrow-clockwise text-white text-lg"></i>';
        coverContainer.appendChild(reloadOverlay);
      }
    }
  }

  // Helper para marcar track como indisponível e pular para próxima
  function skipUnavailableTrack(index, fromPlayingTracks = false) {
    markTrackUnavailable(index);
    if (fromPlayingTracks) {
      playNextFromPlaying(index + 1);
    } else {
      playNextFrom(index + 1);
    }
  }

  async function retryUnavailableTrack(index) {
    const track = state.tracks[index];
    if (!track) return;

    console.log(`🔄 [RETRY] Tentando buscar novamente: "${track.name}"`);

    // Remove o status de indisponível
    track.unavailable = false;
    
    // Limpa caches relacionados
    const trackKey = getTrackKey(track);
    if (trackKey) {
      clearTrackCaches(trackKey);
      state.audioCache.delete(trackKey);
      state.audioErrorCounts.delete(index);
    }

    // Atualiza UI - remove classe e overlay
    const element = getTrackElement(index);
    if (element) {
      element.classList.remove('track-unavailable');
      element.querySelector('.track-title')?.classList.remove('line-through');
      // Remove o overlay de reload
      element.querySelector('.track-reload-overlay')?.remove();
    }

    // Mostra loading e tenta tocar
    setTrackLoading(index, true);
    
    try {
      await playTrack(index);
    } catch (error) {
      console.error(`❌ [RETRY] Falha ao buscar: "${track.name}"`, error);
      setFeedback('Faixa indisponível', 'error', getTrackFeedbackInfo(track));
      markTrackUnavailable(index);
      // Re-adiciona o overlay de reload
      renderTracks(state.tracks);
    } finally {
      setTrackLoading(index, false);
    }
  }

  async function playTrack(index) {
    return playTrackInternal(index, { fromPlayingTracks: false });
  }

  async function getTrackAudioUrl(track, index) {
    const key = getTrackKey(track);

    const cached = getCacheEntry(state.searchCache, key);
    if (cached?.audioUrl) {
      const validation = await isPlayableAudioUrl(cached.audioUrl);
      if (validation.playable) {
        updateTrackDurationFromResult(track, index, cached);
        return cached.audioUrl;
      }
      // URL em cache não é mais válida, limpa o cache
      clearTrackCaches(key, cached);
    }

    const pending = key ? state.searchPromises.get(key) : null;
    if (pending) {
      const pendingResult = await pending.catch(() => null);
      if (pendingResult?.audioUrl) {
        updateTrackDurationFromResult(track, index, pendingResult);
        return pendingResult.audioUrl;
      }
    }

    const resolved = await resolveTrackWithCache(track, index);
    if (resolved?.audioUrl) {
      updateTrackDurationFromResult(track, index, resolved);
      return resolved.audioUrl;
    }

    return null;
  }

  async function resolveTrackAudio(track, index, forceRefresh = false) {
    const key = getTrackKey(track);

    if (!forceRefresh) {
      const cached = getCacheEntry(state.searchCache, key);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      let video;
      
      // Se a faixa já tem videoId (busca manual ou definido na playlist), usa diretamente
      const existingVideoId = getTrackVideoId(track);
      if (existingVideoId) {
        let lengthSeconds = Math.floor((track.duration_ms || 0) / 1000);
        
        video = {
          videoId: existingVideoId,
          instance: 'preset-video',
          lengthSeconds: lengthSeconds
        };
      } else {
        video = await findVideoForTrack(track);
        if (!video) {
          console.warn(`❌ [AUDIO] Nenhum vídeo encontrado para "${track.name}"`);
          return null;
        }
      }

      updateTrackDurationFromResult(track, index, video);
      if (forceRefresh && video.videoId) {
        state.audioCache.delete(video.videoId);
      }
      const audioUrl = await getAudioUrl(video.videoId);
      if (!audioUrl) {
        console.warn(`❌ [AUDIO] Não foi possível resolver stream para "${track.name}" (${video.videoId})`);
        return null;
      }

      // Se não tem duração (preset videoId), tenta obter do áudio
      if (!video.lengthSeconds) {
        try {
          const duration = await getAudioDuration(audioUrl);
          if (duration > 0) {
            video.lengthSeconds = duration;
            updateTrackDurationFromResult(track, index, video);
            console.log(`⏱️ [AUDIO] Duration from audio: ${duration}s`);
          }
        } catch (e) {
          console.log(`⚠️ [AUDIO] Could not get duration from audio`);
        }
      }

      const result = { ...video, audioUrl };
      setCacheEntry(state.searchCache, key, result);
      return result;
    } catch (error) {
      console.warn(`❌ [AUDIO] Erro ao resolver faixa "${track?.name || 'desconhecida'}": ${error.message}`);
      return null;
    }
  }

  async function handleAudioError(event = null, passedFailedUrl = '') {
    const failingIndex = state.currentTrackIndex;
    if (failingIndex < 0 || state.audioRecoveryInProgress) return;

    const track = state.tracks[failingIndex];
    if (!track) return;

    // Captura o playRequestId atual para detectar se o usuário clicou em outra música
    const currentRequestId = state.playRequestId;
    const isStale = () => currentRequestId !== state.playRequestId || state.currentTrackIndex !== failingIndex;

    const mediaError = audio.error || event?.target?.error || null;
    if (mediaError?.code === MEDIA_ERROR_ABORTED_CODE) {
      console.warn(`⚠️ [AUDIO] Abort error ignored for track ${failingIndex}`);
      resetAudioError(failingIndex);
      return;
    }

    // Se estamos offline ou em processo de reconexão, não pula para próxima faixa
    if (!navigator.onLine || state.connectionLost) {
      console.warn(`📡 [AUDIO] Erro durante perda de conexão, aguardando reconexão...`);
      state.connectionLost = true;
      state.savedPlaybackTime = audio.currentTime || 0;
      // Agenda tentativa de reconexão quando a conexão voltar
      if (!state.reconnectTimer) {
        state.reconnectTimer = setTimeout(() => {
          if (navigator.onLine) {
            attemptReconnect();
          }
        }, RECONNECT_INTERVAL_MS);
      }
      return;
    }

    // Se já estamos tentando reconectar, não processa erro
    if (state.reconnectAttempts > 0) {
      console.warn(`🔄 [AUDIO] Erro durante reconexão, ignorando...`);
      return;
    }

    // Usa a URL passada como parâmetro (capturada no momento do erro) ou fallback
    const failedUrl = passedFailedUrl || state.currentAttemptUrl || audio.currentSrc || audio.src || '';

    // Verifica se o usuário já clicou em outra música
    if (isStale()) {
      console.log(`🔄 [AUDIO] Recovery cancelled - user changed track`);
      return;
    }

    state.audioRecoveryInProgress = true;
    try {
      const attempt = trackAudioError(failingIndex);
      const codeLabel = mediaError?.code ? `, code ${mediaError.code}` : '';
      console.warn(`⚠️ [AUDIO] Attempting recovery for track ${failingIndex} (attempt ${attempt}${codeLabel})`);

      // Máximo de 3 tentativas de recuperação
      const maxAttempts = 3;
      if (attempt > maxAttempts) {
        console.warn(`⏭️ [AUDIO] Skipping track ${failingIndex} after ${attempt - 1} recovery attempts`);
        if (!isStale()) {
          handleUnavailableTrack(failingIndex);
        }
        return;
      }

      // Obtém o videoId do cache
      const trackKey = getTrackKey(track);
      const cachedResult = trackKey ? getCacheEntry(state.searchCache, trackKey) : null;
      const targetVideoId = cachedResult?.videoId || null;

      // Debug: mostra a URL que falhou
      console.log(`🔍 [AUDIO] Failed URL: ${failedUrl.substring(0, 100)}...`);

      // Verifica se o usuário já clicou em outra música
      if (isStale()) {
        console.log(`🔄 [AUDIO] Recovery cancelled - user changed track`);
        return;
      }

      // Limpa cache de áudio para forçar nova busca
      if (targetVideoId) {
        state.audioCache.delete(targetVideoId);
      }

      const refreshed = await resolveTrackWithCache(track, failingIndex, { forceRefresh: true, preserveFailures: true });
      // Verifica novamente após o await
      if (isStale()) {
        console.log(`🔄 [AUDIO] Recovery cancelled after resolve - user changed track`);
        return;
      }

      // Se não conseguiu obter URL (todas as combinações falharam), tenta buscar vídeo alternativo
      if (!refreshed?.audioUrl) {
        console.warn(`⚠️ [AUDIO] No audio URL for track ${failingIndex}, trying alternative video search...`);

        // Tenta buscar um vídeo alternativo (limpa o cache de busca para forçar nova busca)
        const trackKey = getTrackKey(track);
        if (trackKey) {
          state.searchCache.delete(trackKey);
        }

        // Limpa o videoId manual se existir para forçar nova busca
        const originalVideoId = track._videoId;
        delete track._videoId;

        // Tenta resolver novamente com nova busca
        const alternativeResult = await resolveTrackWithCache(track, failingIndex, { forceRefresh: true, preserveFailures: false });

        if (alternativeResult?.audioUrl && alternativeResult.videoId !== originalVideoId) {
          console.log(`🔄 [AUDIO] Found alternative video: ${alternativeResult.videoId}`);

          if (!isStale()) {
            try {
              // Reseta o elemento de áudio antes de tentar nova URL
              await resetAudioWithDelay();

              loadAudioSource(alternativeResult.audioUrl);
              await delay(300);
              await audio.play();
              markPlaybackSuccess(failingIndex);
              console.log(`✅ [AUDIO] Recovery with alternative video succeeded for track ${failingIndex}`);
              return;
            } catch (altError) {
              console.error(`❌ [AUDIO] Alternative video play failed: ${altError.message}`);
            }
          }
        }

        // Se ainda não conseguiu, marca como indisponível
        console.warn(`⏭️ [AUDIO] No audio URL available for track ${failingIndex}, marking as unavailable`);
        if (!isStale()) {
          handleUnavailableTrack(failingIndex);
        }
        return;
      }

      try {
        // Salva a posição atual antes de resetar
        const savedPosition = audio.currentTime > 0 ? audio.currentTime : 0;

        // Reseta o elemento de áudio antes de tentar nova URL
        await resetAudioWithDelay();

        loadAudioSource(refreshed.audioUrl);

        // Aguarda o áudio estar pronto antes de tentar tocar (reduzido para 3s)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve(), 3000);
          const onCanPlay = () => {
            clearTimeout(timeout);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            clearTimeout(timeout);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            reject(new Error('Audio load error'));
          };
          audio.addEventListener('canplay', onCanPlay, { once: true });
          audio.addEventListener('error', onError, { once: true });
        });

        // Verifica mais uma vez antes de tocar
        if (isStale()) {
          console.log(`🔄 [AUDIO] Recovery cancelled before play - user changed track`);
          return;
        }

        // Restaura a posição de reprodução se havia uma
        if (savedPosition > 1) {
          try {
            audio.currentTime = Math.max(0, savedPosition - 0.5); // Volta 0.5s para garantir continuidade
          } catch (_) { }
        }

        await audio.play();
        markPlaybackSuccess(failingIndex);
        console.log(`✅ [AUDIO] Recovery succeeded for track ${failingIndex}`);
        return;
      } catch (retryError) {
        // Se o erro for "interrupted by pause", tenta novamente após um delay
        const isInterruptedError = retryError.message?.includes('interrupted') || retryError.name === 'AbortError';
        if (isInterruptedError && attempt <= 2) {
          console.warn(`⚠️ [AUDIO] Recovery interrupted, retrying in 500ms...`);
          await delay(500);
          try {
            await audio.play();
            markPlaybackSuccess(failingIndex);
            console.log(`✅ [AUDIO] Recovery succeeded on retry for track ${failingIndex}`);
            return;
          } catch (secondError) {
            console.error(`❌ [AUDIO] Recovery play failed after retry: ${secondError.message}`);
          }
        } else {
          console.error(`❌ [AUDIO] Recovery play failed: ${retryError.message}`);
        }
      }

      // Verifica se o usuário mudou de track antes de continuar
      if (isStale()) {
        console.log(`🔄 [AUDIO] Recovery cancelled - user changed track`);
        return;
      }

      // Só marca como indisponível após esgotar todas as combinações
      if (attempt >= maxAttempts) {
        if (!isStale()) {
          handleUnavailableTrack(failingIndex);
        }
      } else {
        // Agenda nova tentativa de recovery - reduzido para 500ms
        // Passa a URL atual que vai falhar para a próxima chamada
        const urlToMark = state.currentAttemptUrl || '';
        console.log(`🔄 [AUDIO] Scheduling retry ${attempt + 1}/${maxAttempts} in 0.5s...`);
        const savedRequestId = currentRequestId;
        setTimeout(() => {
          // Verifica se ainda é a mesma requisição
          if (state.playRequestId === savedRequestId && state.currentTrackIndex === failingIndex && !state.isPlaying) {
            handleAudioError(null, urlToMark);
          }
        }, 500);
      }
    } finally {
      state.audioRecoveryInProgress = false;
    }
  }

  function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Correspondência exata
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    // Normalizar: remover caracteres especiais
    const normalize = (str) => str.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const n1 = normalize(s1);
    const n2 = normalize(s2);

    if (n1 === n2) return 0.9;
    if (n1.includes(n2) || n2.includes(n1)) return 0.7;

    // Similaridade baseada em palavras em comum
    const words1 = n1.split(/\s+/).filter(w => w.length > 2);
    const words2 = n2.split(/\s+/).filter(w => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    const commonWords = words1.filter(w1 =>
      words2.some(w2 => w1.includes(w2) || w2.includes(w1))
    );

    return commonWords.length / Math.max(words1.length, words2.length);
  }

  function calculateTrackScore(candidate, track) {
    if (!candidate || !track) return 0;

    let score = 0;
    const candidateTitle = (candidate.title || '').toLowerCase();
    const trackName = (track.name || '').toLowerCase();
    const trackDurationMs = extractDurationMs(track);

    // Pontuação por título (0-50 pontos)
    const titleSimilarity = calculateStringSimilarity(candidateTitle, trackName);
    score += titleSimilarity * 50;

    // Pontuação por artista (0-30 pontos)
    const artistNames = getTrackArtists(track).replace(/, /g, ' ').toLowerCase();
    if (artistNames) {
      const artistSimilarity = calculateStringSimilarity(candidateTitle, artistNames);
      score += artistSimilarity * 30;
    }

    // Pontuação por duração (0-20 pontos)
    const candidateDuration = candidate.lengthSeconds ?? candidate.duration;
    if (candidateDuration && trackDurationMs) {
      const diff = Math.abs((candidateDuration * 1000) - trackDurationMs);
      const tolerance = Math.max(trackDurationMs * 0.35, 45000);
      const durationMatch = Math.max(0, 1 - (diff / tolerance));
      score += durationMatch * 20;
    }

    // Bonus para correspondências exatas
    if (candidateTitle.includes(trackName) || trackName.includes(candidateTitle)) {
      score += 10;
    }

    // Penalidades
    const negativeTerms = ['cover', 'remix', 'reaction', 'tutorial', 'instrumental', 'karaoke', 'live'];
    if (negativeTerms.some(term => candidateTitle.includes(term) && !trackName.includes(term))) {
      score -= 15;
    }

    return score;
  }

  async function findVideoForTrack(track) {
    const artists = getTrackArtists(track);
    console.log(`🎵 [SEARCH START] Searching for: "${track.name}" by "${artists}"`);

    const durationMs = extractDurationMs(track);

    // Busca via YouTube (scraping)
    const result = await searchPlayDl(track.name, artists, durationMs);

    if (result) {
      console.log(`✅ [SEARCH SUCCESS] Found: ${result.videoId}`);
      return result;
    }

    console.warn(`❌ [SEARCH FAILED] No results found for: "${track.name}"`);
    return null;
  }

  // Obtém duração do áudio a partir da URL (usado para preset videoId)
  async function getAudioDuration(audioUrl, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const tempAudio = new Audio();
      let resolved = false;
      
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        tempAudio.src = '';
        tempAudio.load();
      };
      
      const timeout = setTimeout(() => {
        cleanup();
        resolve(0);
      }, timeoutMs);
      
      tempAudio.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        const duration = Math.floor(tempAudio.duration);
        cleanup();
        resolve(duration > 0 ? duration : 0);
      }, { once: true });
      
      tempAudio.addEventListener('error', () => {
        clearTimeout(timeout);
        cleanup();
        resolve(0);
      }, { once: true });
      
      tempAudio.preload = 'metadata';
      tempAudio.src = audioUrl;
    });
  }

  // Busca URL de áudio via RapidAPI com retry para 429
  async function getAudioUrl(videoId, retryCount = 0) {
    if (!videoId) return null;

    const cached = getCacheEntry(state.audioCache, videoId);
    if (cached !== null) return cached;

    try {
      console.log(`🎵 [AUDIO] Fetching audio for: ${videoId}`);

      const response = await fetch(`/audio?v=${videoId}`);

      // Rate limit - retry com backoff
      if (response.status === 429 && retryCount < 3) {
        const retryDelay = (retryCount + 1) * 2000; // 2s, 4s, 6s
        console.warn(`⏳ [AUDIO] Rate limited, retrying in ${retryDelay / 1000}s...`);
        await delay(retryDelay);
        return getAudioUrl(videoId, retryCount + 1);
      }

      if (!response.ok) {
        console.warn(`⚠️ [AUDIO] API returned ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (!data.audioUrl) {
        console.warn(`⚠️ [AUDIO] No audio URL in response`);
        return null;
      }

      console.log(`✅ [AUDIO] Got audio URL for ${videoId}`);

      // Cache a URL
      setCacheEntry(state.audioCache, videoId, data.audioUrl);
      debouncedSave();

      return data.audioUrl;

    } catch (err) {
      console.error(`❌ [AUDIO] Error fetching audio: ${err.message}`);
      return null;
    }
  }

  function findNextPlayableIndex(startIndex = 0) {
    // Usa as tracks de reprodução apenas para playlists da biblioteca
    const tracksToUse = hasLibraryPlaybackQueue() ? state.playingTracks : state.tracks;
    for (let i = startIndex; i < tracksToUse.length; i++) {
      if (!tracksToUse[i].unavailable) return i;
    }
    return -1;
  }

  async function playNextFrom(startIndex) {
    if (advanceScheduled || advancingToNext) return;
    advanceScheduled = true;
    advancingToNext = true;
    try {
      const nextIndex = findNextPlayableIndex(startIndex);
      if (nextIndex === -1) {
        stopPlaybackCountdown({ resetLabel: true });
        state.isPlaying = false;
        resetPlaybackState();
        state.currentTrackIndex = -1;
        updateUiState();
        return;
      }

      await playTrack(nextIndex);
    } finally {
      advancingToNext = false;
      advanceScheduled = false;
    }
  }

  // Toca a próxima música da playlist em reprodução (não da visualização)
  async function playNextFromPlaying(startIndex) {
    if (advanceScheduled || advancingToNext) return;
    advanceScheduled = true;
    advancingToNext = true;
    try {
      if (!hasLibraryPlaybackQueue()) {
        // Se não há tracks de reprodução da biblioteca, usa as de visualização
        await playNextFrom(startIndex);
        return;
      }

      // Encontra próxima track disponível nas tracks de reprodução
      let nextIndex = -1;
      for (let i = startIndex; i < state.playingTracks.length; i++) {
        if (!state.playingTracks[i].unavailable) {
          nextIndex = i;
          break;
        }
      }

      if (nextIndex === -1) {
        stopPlaybackCountdown({ resetLabel: true });
        state.isPlaying = false;
        resetPlaybackState();
        updateUiState();
        return;
      }

      // Toca a track das tracks de reprodução usando playTrack com flag
      await playTrackInternal(nextIndex, { fromPlayingTracks: true });
    } finally {
      advancingToNext = false;
      advanceScheduled = false;
    }
  }

  // Função interna unificada para reproduzir uma track
  async function playTrackInternal(index, options = {}) {
    const { fromPlayingTracks = false, useCrossfade = null } = options;
    const tracks = fromPlayingTracks ? state.playingTracks : state.tracks;

    if (!tracks.length || index < 0 || index >= tracks.length) {
      crossfadePending = false;
      return;
    }

    // Cancela crossfade em andamento se o usuário trocar manualmente
    cancelCrossfade();

    // Se este é um crossfade automático, re-seta a flag após o cancelCrossfade
    if (useCrossfade) {
      crossfadePending = true;
    }

    // Limpa estado de reprodução do YouTube quando inicia reprodução de playlist normal
    if (!fromPlayingTracks || (youtubePlayingVideoId && state.playingPlaylistId !== 'youtube-search')) {
      clearYouTubePlaybackState({ updateUi: false });
    }

    const requestId = ++state.playRequestId;
    const isStale = () => requestId !== state.playRequestId;

    const track = tracks[index];
    if (track.unavailable) {
      crossfadePending = false;
      if (fromPlayingTracks) {
        playNextFromPlaying(index + 1);
      } else {
        playNextFrom(index + 1);
      }
      return;
    }

    // Reseta o progresso da faixa anterior (apenas se não for das playingTracks)
    if (!fromPlayingTracks && state.currentTrackIndex >= 0 && state.currentTrackIndex !== index) {
      resetTrackProgress(state.currentTrackIndex);
    }

    stopPlaybackCountdown({ resetLabel: true });

    if (fromPlayingTracks) {
      state.playingTrackIndex = index;
      // Se a playlist em reprodução é a mesma da visualização, sincroniza
      if (isViewingPlayingPlaylist()) {
        state.currentTrackIndex = index;
      }
    } else {
      state.currentTrackIndex = index;
      // Salva o estado de reprodução
      state.playingPlaylistId = state.currentPlaylist?.id || null;
      state.playingTrackIndex = index;
      state.playingTracks = [...state.tracks];
    }

    state.isLoadingTrack = true;
    if (!fromPlayingTracks) {
      setTrackLoading(index, true);
    }
    updateUiState();

    debouncedSave();

    try {
      let audioUrl = await getTrackAudioUrl(track, index);

      if (!audioUrl) {
        const refreshed = await resolveTrackWithCache(track, index, { forceRefresh: true });
        audioUrl = refreshed?.audioUrl || null;
      }

      if (isStale()) return;

      if (!audioUrl) {
        if (fromPlayingTracks) {
          track.unavailable = true;
          playNextFromPlaying(index + 1);
        } else {
          skipUnavailableTrack(index);
        }
        return;
      }

      const shouldCrossfade = useCrossfade === true;

      let played = false;
      if (shouldCrossfade) {
        played = await playWithCrossfade(audioUrl, { isStale });
      } else {
        await resetAudioWithDelay(audio);
        loadAudioSource(audioUrl, audio);
        if (isStale()) return;
        played = await tryPlayElement(audio);
      }
      if (isStale()) return;

      if (!played) {
        // Se não conseguiu reproduzir após tentativas, tenta recuperação
        console.warn(`⚠️ [PLAY] Failed to play after attempts, trying recovery...`);
        const refreshed = await resolveTrackWithCache(track, index, { forceRefresh: true });
        if (refreshed?.audioUrl && !isStale()) {
          if (shouldCrossfade) {
            played = await playWithCrossfade(refreshed.audioUrl, { isStale });
          } else {
            await resetAudioWithDelay(audio);
            loadAudioSource(refreshed.audioUrl, audio);
            try {
              await audio.play();
              markPlaybackSuccess(index);
              return;
            } catch (retryErr) {
              console.warn(`⚠️ [PLAY] Recovery also failed: ${retryErr.message}`);
            }
          }
        }
        // Se ainda falhou, marca como indisponível
        if (fromPlayingTracks) {
          track.unavailable = true;
          playNextFromPlaying(index + 1);
        } else {
          skipUnavailableTrack(index);
        }
        return;
      }

      markPlaybackSuccess(index);

    } catch (error) {
      if (error.message?.includes('interrupted') || error.message?.includes('removed')) {
        state.isLoadingTrack = false;
        if (!isStale()) {
          setTimeout(() => playTrackInternal(index, options), 500);
        }
        return;
      }

      const refreshed = await resolveTrackWithCache(track, index, { forceRefresh: true });
      if (refreshed?.audioUrl) {
        try {
          setAudioSource(refreshed.audioUrl);
          await delay(AUDIO_RESET_DELAY_MS);
          if (!isStale()) {
            await audio.play();
            markPlaybackSuccess(index);
            return;
          }
        } catch (retryError) {
          // Ignorar erro de retry
        }
      }

      if (fromPlayingTracks) {
        track.unavailable = true;
        playNextFromPlaying(index + 1);
      } else {
        skipUnavailableTrack(index);
      }
      state.isPlaying = false;
    } finally {
      state.isLoadingTrack = false;
      crossfadePending = false;
      if (!isStale()) {
        updateUiState();
      }
    }
  }

  function togglePlayback() {
    // Se estiver reproduzindo no YouTube, controla o áudio normalmente
    if (isPlayingFromYouTube()) {
      if (audio.paused) {
        startPlaying();
        startYouTubeSearchCountdown();
      } else {
        pausePlaying();
        stopYouTubeSearchCountdown();
      }
      updateUiState();
      updateYouTubeSearchHighlight();
      return;
    }

    // Se o áudio está tocando, sempre permite pausar
    if (!audio.paused) {
      pausePlaying();
      updateUiState();
      stopPlaybackCountdown({ resetLabel: false });
      return;
    }

    // Áudio pausado - verifica se há track para tocar
    if (!hasValidTrack()) {
      // Se tem áudio carregado (pausado de uma reprodução anterior), retoma
      if (audio.src && audio.currentTime > 0) {
        startPlaying();
        updateUiState();
        startPlaybackCountdown();
        return;
      }
      playNextFrom(0);
      return;
    }

    startPlaying();
    updateUiState();
    startPlaybackCountdown();
  }

  function updateTrackHighlight() {
    const isActuallyPlaying = isAudioPlaying();
    // Só destaca se a playlist de visualização é a mesma da reprodução
    const isSamePlaylist = isViewingPlayingPlaylist();
    const activeIndex = isSamePlaylist ? state.playingTrackIndex : -1;

    document.querySelectorAll('.track-item').forEach((item) => {
      const index = Number(item.dataset.trackIndex);
      item.classList.toggle('active', index === activeIndex);
      item.classList.toggle('playing', index === activeIndex && isActuallyPlaying);
    });
  }

  // Mostra/esconde spinner de loading na capa do álbum
  function setTrackLoading(index, isLoading) {
    document.querySelectorAll('.track-item').forEach((item) => {
      const itemIndex = Number(item.dataset.trackIndex);
      item.classList.toggle('loading', itemIndex === index && isLoading);
    });
  }

  // === Funções de Scroll/Drag do Player ===
  
  function setupPlaylistsWheelCapture() {
    const playlistsContainer = document.getElementById('playlists-container');
    const playerModal = document.getElementById('player-modal');
    if (!playlistsContainer || !playerModal) return;
    enableHorizontalWheelScroll(playlistsContainer, { capture: true, parentElement: playerModal });
  }

  function enableDragScroll(element) {
    if (!element) return;
    const playerModal = document.getElementById('player-modal');
    if (!playerModal) return;

    let isDown = false, startX, scrollLeft;
    element.style.cursor = 'grab';

    const isOverElement = (e) => {
      const rect = element.getBoundingClientRect();
      return e.clientX >= rect.left && e.clientX <= rect.right && 
             e.clientY >= rect.top && e.clientY <= rect.bottom;
    };

    playerModal.addEventListener('mousedown', (e) => {
      if (element.style.pointerEvents === 'none') return;
      if (!isOverElement(e)) return;
      if (e.target.closest('button.delete-playlist-btn, .delete-playlist-btn button')) return;
      isDown = true;
      element.style.cursor = 'grabbing';
      startX = e.clientX;
      scrollLeft = element.scrollLeft;
    }, { capture: true });

    const resetDrag = () => { if (isDown) { isDown = false; element.style.cursor = 'grab'; } };
    document.addEventListener('mouseleave', resetDrag);
    document.addEventListener('mouseup', resetDrag);

    document.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const walk = e.clientX - startX;
      if (Math.abs(walk) > 5) {
        e.preventDefault();
        element.scrollLeft = scrollLeft - (walk * 1.5);
      }
    });
  }

  return { init, openModal, importPlaylistFromCsv };
})();

const PLAYER_OPEN_EVENT = 'hyperfitness:open-music-player';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MUSIC_PLAYER.init(), { once: true });
  } else {
    MUSIC_PLAYER.init();
  }

  document.addEventListener(PLAYER_OPEN_EVENT, () => MUSIC_PLAYER.openModal());
}
