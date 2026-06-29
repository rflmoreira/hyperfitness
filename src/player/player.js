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
    return true;
  } catch (error) {
    console.error('❌ [PLAYER] Erro ao injetar HTML:', error);
    return false;
  }
}

const MUSIC_PLAYER = (() => {
  const CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 horas para buscas de vídeo
  const AUDIO_URL_TTL_MS = 10 * 60 * 1000; // 10 minutos para URLs de áudio (expiram rápido)
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
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '--:--';
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
    button.classList.toggle('is-favorite', isFavorite);
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
    myPlaylistsSection: null,
    myPlaylistsGrid: null,
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
    tabRadio: null,
    screenDiscover: null,
    screenPlaylist: null,
    screenYoutube: null,
    screenRadio: null,
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
    ui.myPlaylistsSection = document.getElementById('my-playlists-section');
    ui.myPlaylistsGrid = document.getElementById('my-playlists-grid');
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
    ui.tabRadio = document.getElementById('tab-radio');
    ui.screenDiscover = document.getElementById('player-screen-discover');
    ui.screenPlaylist = document.getElementById('player-screen-playlist');
    ui.screenYoutube = document.getElementById('player-screen-youtube');
    ui.screenRadio = document.getElementById('player-screen-radio');
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
    ui.ctrlExpandedCover = document.getElementById('ctrl-expanded-cover');
    ui.expandedCoverWrapper = document.getElementById('expanded-cover-wrapper');
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
    let el = existing;
    if (!el) {
      el = new Audio();
      el.style.display = 'none';
      if (document.body) {
        document.body.appendChild(el);
      } else {
        window.addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
      }
    }
    el.preload = 'auto';
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
    // Espera o áudio estar pronto antes de tentar reproduzir
    if (target.readyState < 2) {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            target.removeEventListener('canplay', onReady);
            target.removeEventListener('error', onError);
            reject(new Error('canplay timeout'));
          }, 15000);
          const onReady = () => {
            clearTimeout(timeout);
            target.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            clearTimeout(timeout);
            target.removeEventListener('canplay', onReady);
            reject(new Error('audio load error'));
          };
          target.addEventListener('canplay', onReady, { once: true });
          target.addEventListener('error', onError, { once: true });
        });
      } catch (_) {
        return false;
      }
    }
    const retryDelays = [0, 50, 100];
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
      handleAudioError(e);
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
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL_MS = 2000; // 2s base com backoff progressivo
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
      resetReconnectState();
      clearBufferingTimer();
      return;
    }

    // Se a track terminou, não tenta reconectar - vai para próxima
    if (audio.ended) {
      resetReconnectState();
      clearBufferingTimer();
      playNextFrom(trackIndex + 1);
      return;
    }

    state.reconnectAttempts++;
    setTrackLoading(trackIndex, true);
    let attemptedUrl = '';
    try {
      // Pausa antes de tentar nova URL
      try { audio.pause(); } catch (_) { }
      await delay(AUDIO_RESET_DELAY_MS);

      // Busca uma nova URL (sempre força refresh para evitar URLs expiradas)
      const forceRefresh = true;
      const resolved = await resolveTrackWithCache(track, trackIndex, { forceRefresh, preserveFailures: true });

      if (!resolved?.audioUrl) {
        throw new Error('Não foi possível obter URL de áudio');
      }

      attemptedUrl = resolved.audioUrl;
      setAudioSource(resolved.audioUrl);

      // Aguarda o áudio estar pronto antes de tentar tocar (reduzido para 8s)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout aguardando canplay')), 15000);
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
      resetReconnectState();
      clearBufferingTimer();
      updateUiState();
      return;
    } catch (error) {
      console.warn(`⚠️ [RECONNECT] Falha na tentativa ${state.reconnectAttempts}: ${error.message}`);
      // Limpa cache de áudio para forçar nova URL na próxima tentativa
      if (attemptedUrl) {
        const videoId = getTrackVideoId(track);
        if (videoId) state.audioCache.delete(videoId);
      }
    }

    // Se ainda não atingiu o máximo de tentativas, agenda próxima
    if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const reconnectDelay = RECONNECT_INTERVAL_MS * Math.min(state.reconnectAttempts, 3); // Backoff progressivo
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

    // Tabs do player
    ui.tabDiscover?.addEventListener('click', () => switchPlayerTab('discover'));
    ui.tabPlaylist?.addEventListener('click', () => switchPlayerTab('playlist'));
    ui.tabYoutube?.addEventListener('click', () => switchPlayerTab('youtube'));
    ui.tabRadio?.addEventListener('click', () => switchPlayerTab('radio'));

    // Swipe lateral para trocar abas
    setupTabSwipeGesture();

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
    ui.ctrlVolumeBtn?.addEventListener('click', toggleMute);
    // Fallback: listener no container volume-control para mobile
    document.querySelector('#player-controls-bar .volume-control')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute();
    });

    // === Mini Player Bar ===
    ui.miniPlay?.addEventListener('click', togglePlayback);
    ui.miniPrev?.addEventListener('click', playPreviousTrack);
    ui.miniNext?.addEventListener('click', playNextTrack);
    ui.miniShuffle?.addEventListener('click', toggleShuffle);
    ui.miniRepeat?.addEventListener('click', toggleRepeat);
    ui.miniVolumeBtn?.addEventListener('click', toggleMute);
    // Fallback: listener no container volume-control para mobile
    document.querySelector('#mini-player-bar .volume-control')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute();
    });

    // Clique no mini-player abre o modal do player
    ui.miniPlayerBar?.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('.volume-slider-container')) {
        openPlayerModal();
      }
    });

    // Clique no controls-center mostra/esconde a capa flutuante
    const ctrlBar = document.getElementById('player-controls-bar');
    const ctrlCenter = ctrlBar?.querySelector('.controls-center');
    ctrlCenter?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleExpandedCover();
    });

    // Clique na capa expandida fecha
    ui.expandedCoverWrapper?.addEventListener('click', () => {
      toggleExpandedCover(false);
    });

    // Clique no blur de fundo fecha a capa
    document.getElementById('expanded-cover-blur')?.addEventListener('click', () => {
      toggleExpandedCover(false);
    });

    // Botão X fecha a capa
    document.getElementById('expanded-cover-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpandedCover(false);
    });

    // Inicializa ícones de volume
    updateMuteIcons();
  }

  // Toggle da capa flutuante
  function toggleExpandedCover(forceState) {
    if (!ui.expandedCoverWrapper) return;
    const show = forceState !== undefined ? forceState : !ui.expandedCoverWrapper.classList.contains('visible');
    if (show) syncExpandedCover();
    ui.expandedCoverWrapper.classList.toggle('visible', show);
    const coverBlur = document.getElementById('expanded-cover-blur');
    if (coverBlur) {
      coverBlur.classList.toggle('opacity-0', !show);
      coverBlur.classList.toggle('invisible', !show);
      coverBlur.style.pointerEvents = show ? 'auto' : 'none';
    }
  }

  function syncExpandedCover() {
    const coverImg = ui.ctrlCover?.querySelector('img');
    if (coverImg && ui.ctrlExpandedCover) {
      ui.ctrlExpandedCover.src = coverImg.src;
    }
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

  // Mute/Unmute toggle
  let isMuted = false;
  let volumeBeforeMute = 1;
  let muteToggleDebounce = false;

  function toggleMute() {
    if (muteToggleDebounce) return;
    muteToggleDebounce = true;
    setTimeout(() => { muteToggleDebounce = false; }, 200);

    if (isMuted) {
      isMuted = false;
      setUserVolume(volumeBeforeMute);
    } else {
      volumeBeforeMute = userVolume || 1;
      isMuted = true;
      setUserVolume(0);
    }
    updateMuteIcons();
  }

  function updateMuteIcons() {
    const buttons = [ui.ctrlVolumeBtn, ui.miniVolumeBtn];
    buttons.forEach(btn => {
      const icon = btn?.querySelector('i');
      if (icon) {
        icon.className = isMuted ? 'ph-bold ph-speaker-x' : 'ph-bold ph-speaker-high';
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
  const TAB_ORDER = ['discover', 'playlist', 'youtube', 'radio'];
  let currentTabIndex = 0;

  function setupTabSwipeGesture() {
    const modal = ui.playerModal;
    if (!modal) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let directionLocked = false;
    let isHorizontal = false;
    let currentScreen = null;

    const getActiveScreen = () => {
      const screens = [ui.screenDiscover, ui.screenPlaylist, ui.screenYoutube, ui.screenRadio];
      return screens[currentTabIndex];
    };

    // Resistência elástica — quanto mais arrasta, mais resiste
    const elastic = (dx) => {
      const maxDrag = window.innerWidth * 0.6;
      const sign = dx > 0 ? 1 : -1;
      const abs = Math.min(Math.abs(dx), maxDrag);
      return sign * maxDrag * (1 - Math.pow(1 - abs / maxDrag, 2.5));
    };

    modal.addEventListener('touchstart', (e) => {
      if (!e.touches.length) return;
      if (e.target.closest('#playlists-container') || e.target.closest('.track-item') || e.target.closest('.manual-search-item') || e.target.closest('#discover-top-spacer') || e.target.closest('.discover-carousel')) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      directionLocked = false;
      isHorizontal = false;
      currentScreen = getActiveScreen();
      if (currentScreen) {
        currentScreen.style.transition = 'none';
      }
    }, { passive: true });

    modal.addEventListener('touchmove', (e) => {
      if (!tracking || !e.touches.length || !currentScreen) return;

      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!directionLocked) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          directionLocked = true;
          isHorizontal = Math.abs(dx) > Math.abs(dy);
        }
        return;
      }

      if (!isHorizontal) return;

      // Bloqueia se não há aba nessa direção (resistência total nas bordas)
      const atStart = currentTabIndex === 0 && dx > 0;
      const atEnd = currentTabIndex === TAB_ORDER.length - 1 && dx < 0;
      const dampedDx = (atStart || atEnd) ? elastic(dx) * 0.3 : elastic(dx);

      currentScreen.style.transform = `translateX(${dampedDx}px)`;
      currentScreen.style.opacity = 1 - Math.abs(dampedDx) / window.innerWidth * 0.4;
    }, { passive: true });

    modal.addEventListener('touchend', (e) => {
      if (!tracking || !currentScreen) return;
      tracking = false;

      if (!directionLocked || !isHorizontal) {
        if (currentScreen) {
          currentScreen.style.transition = '';
          currentScreen.style.transform = '';
          currentScreen.style.opacity = '';
        }
        return;
      }

      const dx = e.changedTouches[0].clientX - startX;
      const threshold = window.innerWidth * 0.2;
      const atStart = currentTabIndex === 0 && dx > 0;
      const atEnd = currentTabIndex === TAB_ORDER.length - 1 && dx < 0;

      if (Math.abs(dx) > threshold && !atStart && !atEnd) {
        // Completa a transição
        const direction = dx < 0 ? 1 : -1;
        const newIndex = currentTabIndex + direction;
        
        // Anima saída da tela atual
        currentScreen.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.35s ease';
        currentScreen.style.transform = `translateX(${-direction * window.innerWidth * 0.4}px)`;
        currentScreen.style.opacity = '0';

        setTimeout(() => {
          currentScreen.style.transition = '';
          currentScreen.style.transform = '';
          currentScreen.style.opacity = '';
          switchPlayerTab(TAB_ORDER[newIndex]);
        }, 350);
      } else {
        // Volta com bounce elástico
        currentScreen.style.transition = 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease';
        currentScreen.style.transform = 'translateX(0)';
        currentScreen.style.opacity = '1';

        const cleanup = () => {
          currentScreen.style.transition = '';
          currentScreen.style.transform = '';
          currentScreen.style.opacity = '';
          currentScreen.removeEventListener('transitionend', cleanup);
        };
        currentScreen.addEventListener('transitionend', cleanup, { once: true });
        // Fallback cleanup
        setTimeout(cleanup, 500);
      }
    }, { passive: true });
  }

  function toggleScreen(screen, isVisible) {
    if (!screen) return;
    if (isVisible) {
      screen.classList.remove('hidden', 'slide-out-left', 'slide-out-right');
      screen.style.display = 'flex';
    } else {
      screen.classList.add('hidden');
      screen.style.display = 'none';
      screen.classList.remove('slide-in-left', 'slide-in-right', 'slide-out-left', 'slide-out-right');
    }
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
    // Não sobrescreve se a rádio está tocando
    if (radioPlaying && radioCurrentChannel) return;

    const { track } = getCurrentPlayingTrack();
    updatePlayerBarInfo({
      playBtn: ui.ctrlPlay,
      titleEl: ui.ctrlTitle,
      artistEl: ui.ctrlArtist,
      coverEl: ui.ctrlCover
    }, track);

    // Atualiza a capa de fundo da aba Biblioteca (igual à aba Rádio)
    const coverUrl = track ? getTrackImage(track) : getFallbackCover();
    const playlistScreen = document.getElementById('player-screen-playlist');
    if (playlistScreen) {
      playlistScreen.style.setProperty('--playlist-header-bg', `url('${coverUrl}')`);
    }

    syncExpandedCover();
    updateMiniPlayerBar();
  }

  function updateMiniPlayerBar() {
    const isModalOpen = ui.playerModal && !ui.playerModal.classList.contains('invisible');
    const { track, index } = getCurrentPlayingTrack();
    const isRadioActive = radioPlaying && radioCurrentChannel;
    const shouldShow = (isRadioActive || (index >= 0 && track)) && !isModalOpen;

    ui.miniPlayerBar?.classList.toggle('visible', shouldShow);

    // Sincroniza estado de shuffle e repeat
    updateShuffleRepeatButtons();

    // Desativa/ativa botões de transporte no mini-player
    [ui.miniShuffle, ui.miniPrev, ui.miniNext, ui.miniRepeat].forEach(btn => {
      if (!btn) return;
      btn.disabled = isRadioActive;
      btn.classList.toggle('radio-disabled', isRadioActive);
    });

    if (isRadioActive) {
      // Mostra info da rádio
      const playIcon = ui.miniPlay?.querySelector('i');
      if (playIcon) playIcon.className = 'ph-bold ph-stop';

      if (ui.miniTitle) ui.miniTitle.textContent = radioCurrentChannel.name;
      if (ui.miniArtist) ui.miniArtist.textContent = 'SUNSHINE LIVE · Ao Vivo';

      // Mostra capa do canal
      const coverImg = ui.miniCover?.querySelector('img');
      if (coverImg) {
        coverImg.src = radioCurrentChannel.cover;
      }
      ui.miniCover?.classList.add('playing');
    } else {
      updatePlayerBarInfo({
        playBtn: ui.miniPlay,
        titleEl: ui.miniTitle,
        artistEl: ui.miniArtist,
        coverEl: ui.miniCover
      }, track);
    }
  }

  function switchPlayerTab(tab) {
    const isDiscover = tab === 'discover';
    const isPlaylist = tab === 'playlist';
    const isYoutube = tab === 'youtube';
    const isRadio = tab === 'radio';

    const newIndex = TAB_ORDER.indexOf(tab);
    const direction = newIndex > currentTabIndex ? 'right' : 'left';
    const screens = [ui.screenDiscover, ui.screenPlaylist, ui.screenYoutube, ui.screenRadio];
    const targetScreen = screens[newIndex];
    const prevScreen = screens[currentTabIndex];

    // Atualiza tabs
    ui.tabDiscover?.classList.toggle('active', isDiscover);
    ui.tabPlaylist?.classList.toggle('active', isPlaylist);
    ui.tabYoutube?.classList.toggle('active', isYoutube);
    ui.tabRadio?.classList.toggle('active', isRadio);

    // Animação lateral
    if (newIndex !== currentTabIndex && prevScreen && targetScreen) {
      // Esconde todas as outras
      screens.forEach((s, i) => {
        if (i !== currentTabIndex && i !== newIndex) toggleScreen(s, false);
      });

      // Mostra a nova tela com slide
      targetScreen.classList.remove('hidden', 'slide-in-left', 'slide-in-right');
      targetScreen.style.display = 'flex';
      void targetScreen.offsetWidth;
      targetScreen.classList.add(direction === 'right' ? 'slide-in-right' : 'slide-in-left');

      // Esconde a tela anterior
      toggleScreen(prevScreen, false);
    } else {
      screens.forEach((s, i) => toggleScreen(s, i === newIndex));
    }

    currentTabIndex = newIndex;
    
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

    // Inicializa lógica de scroll da aba Biblioteca
    if (isPlaylist) {
      requestAnimationFrame(() => {
        initPlaylistsMarquee();
      });
    } else if (isDiscover) {
      requestAnimationFrame(() => {
        updateDiscoverSpacerLayout?.();
        setTimeout(() => updateDiscoverSpacerLayout?.(), 120);
      });
    }
  }

  let updateDiscoverSpacerLayout = null;

  // ====== Discover Banner Carousel ======
  function renderDiscoverCarousel() {
    const track = document.getElementById('discover-carousel-track');
    const dotsContainer = document.getElementById('discover-carousel-dots');
    if (!track || !dotsContainer || typeof SPECIAL_PLAYLISTS === 'undefined') return;

    const playlists = SPECIAL_PLAYLISTS.slice(0, 8);
    if (!playlists.length) return;

    track.innerHTML = playlists.map((pl, i) => {
      const count = getPlaylistTrackCount(pl);
      return `
        <div class="discover-carousel-slide${i === 0 ? ' active' : ''}" data-carousel-id="${pl.id}" data-index="${i}">
          <img src="${pl.cover}" alt="${pl.name}" onerror="this.src='src/imagens/genericCover.png'" loading="lazy">
          <div class="carousel-slide-overlay"></div>
          <div class="carousel-slide-content">
            <div class="carousel-slide-info">
              <p class="carousel-slide-title">${pl.name}</p>
              <p class="carousel-slide-subtitle">${count} músicas</p>
            </div>
            <button class="carousel-slide-btn" data-play-id="${pl.id}"><i class="ph-fill ph-play" style="font-size:10px; line-height:1;"></i> Ouvir agora</button>
          </div>
        </div>`;
    }).join('');

    dotsContainer.innerHTML = playlists.map((_, i) =>
      `<div class="dot${i === 0 ? ' active' : ''}" data-dot="${i}"></div>`
    ).join('');

    let current = 0;
    const slides = track.querySelectorAll('.discover-carousel-slide');
    const dots = dotsContainer.querySelectorAll('.dot');

    function goTo(index) {
      current = Math.max(0, Math.min(index, slides.length - 1));
      const slide = slides[current];
      const containerWidth = track.parentElement.offsetWidth;
      const slideWidth = slide.offsetWidth;
      const slideLeft = slide.offsetLeft;
      // Centraliza o slide, mas não permite offset negativo (primeiro slide) nem exceder o final
      const maxOffset = track.scrollWidth - containerWidth;
      const idealOffset = slideLeft - (containerWidth - slideWidth) / 2;
      const offset = Math.max(0, Math.min(idealOffset, maxOffset));
      track.style.transform = `translateX(${-offset}px)`;
      slides.forEach((s, i) => s.classList.toggle('active', i === current));
      dots.forEach((d, i) => {
        d.classList.remove('active');
        if (i === current) {
          void d.offsetWidth;
          d.classList.add('active');
        }
      });
    }

    // Dot clicks
    dots.forEach(dot => {
      dot.addEventListener('click', () => goTo(parseInt(dot.dataset.dot)));
    });

    // Slide clicks
    slides.forEach(slide => {
      const idx = parseInt(slide.dataset.index);
      const playBtn = slide.querySelector('.carousel-slide-btn');
      const playlistId = slide.dataset.carouselId;
      const playlist = playlists.find(p => p.id === playlistId);

      slide.addEventListener('click', (e) => {
        if (e.target.closest('.carousel-slide-btn')) return;
        if (idx !== current) { goTo(idx); return; }
        if (playlist) selectFeaturedPlaylist(playlist, false);
      });

      playBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (playlist) selectFeaturedPlaylist(playlist, true);
      });
    });

    // Touch swipe
    let startX = 0, isDragging = false, dragOffset = 0, baseOffset = 0;

    track.addEventListener('touchstart', (e) => {
      if (!e.touches.length) return;
      startX = e.touches[0].clientX;
      isDragging = true;
      track.classList.add('dragging');
      // Lê o offset atual do transform de forma segura
      const style = getComputedStyle(track);
      const matrix = style.transform && style.transform !== 'none' ? new DOMMatrix(style.transform) : { m41: 0 };
      baseOffset = matrix.m41 || 0;
    }, { passive: true });

    track.addEventListener('touchmove', (e) => {
      if (!isDragging || !e.touches.length) return;
      dragOffset = e.touches[0].clientX - startX;
      track.style.transform = `translateX(${baseOffset + dragOffset}px)`;
    }, { passive: true });

    track.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove('dragging');
      if (Math.abs(dragOffset) > 40) {
        goTo(current + (dragOffset < 0 ? 1 : -1));
      } else {
        goTo(current);
      }
      dragOffset = 0;
    }, { passive: true });

    // Auto-play (vai e volta, sem loop abrupto)
    let autoDirection = 1;
    let autoTimer = setInterval(() => {
      if (current >= slides.length - 1) autoDirection = -1;
      if (current <= 0) autoDirection = 1;
      goTo(current + autoDirection);
    }, 5000);
    track.parentElement.addEventListener('touchstart', () => { clearInterval(autoTimer); }, { passive: true });
    track.parentElement.addEventListener('touchend', () => {
      autoTimer = setInterval(() => goTo((current + 1) % slides.length), 5000);
    }, { passive: true });

    // Efeito progressivo ao scrollar (igual ao playlists-container)
    const discoverContainer = document.getElementById('discover-container');
    const carouselWrapper = document.getElementById('discover-carousel-wrapper');
    if (discoverContainer && carouselWrapper) {
      function handleDiscoverScroll() {
        const scrollTop = discoverContainer.scrollTop;
        const maxScroll = 150;
        const progress = Math.min(scrollTop / maxScroll, 1);

        const opacity = 1 - (progress * 0.85);
        const scale = 1 - (progress * 0.08);
        const blur = progress * 4;
        const translateY = -(progress * 15);

        carouselWrapper.style.opacity = Math.max(opacity, 0.1);
        carouselWrapper.style.transform = `scale(${scale}) translateY(${translateY}px)`;
        carouselWrapper.style.filter = `blur(${blur}px)`;
        
        // Carrossel interativo no topo, escondido ao scrollar
        if (scrollTop > 50) {
          carouselWrapper.style.zIndex = '5';
          carouselWrapper.style.pointerEvents = 'none';
        } else {
          carouselWrapper.style.zIndex = '25';
          carouselWrapper.style.pointerEvents = 'auto';
        }
      }

      discoverContainer.addEventListener('scroll', handleDiscoverScroll, { passive: true });
      handleDiscoverScroll();

      // Touch no carrossel: vertical redireciona scroll, horizontal é pro slide
      let dTouchStartY = 0;
      let dTouchStartX = 0;
      let dTouchStartScroll = 0;
      let dDirection = null;

      carouselWrapper.addEventListener('touchstart', function(e) {
        if (!e.touches.length) return;
        dTouchStartY = e.touches[0].clientY;
        dTouchStartX = e.touches[0].clientX;
        dTouchStartScroll = discoverContainer.scrollTop;
        dDirection = null;
      }, { passive: true });

      carouselWrapper.addEventListener('touchmove', function(e) {
        if (!e.touches.length) return;
        const dy = dTouchStartY - e.touches[0].clientY;
        const dx = e.touches[0].clientX - dTouchStartX;

        if (dDirection === null && (Math.abs(dy) > 8 || Math.abs(dx) > 8)) {
          dDirection = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
        }

        if (dDirection === 'vertical') {
          discoverContainer.scrollTop = dTouchStartScroll + dy;
        }
      }, { passive: true });
    }

    goTo(0);

    // Ajusta o spacer ao fundo real do carrossel dentro da área scrollável.
    // Usar apenas offsetHeight quebrava em viewports mobile, porque ignorava o
    // deslocamento vertical criado pelo header/tabs do player.
    function updateDiscoverSpacer() {
      const spacer = document.getElementById('discover-top-spacer');
      if (!spacer || !carouselWrapper || !discoverContainer) return;
      const reserveGap = 30;
      const layoutBottom = carouselWrapper.offsetTop + carouselWrapper.offsetHeight;
      const containerRect = discoverContainer.getBoundingClientRect();
      const wrapperRect = carouselWrapper.getBoundingClientRect();
      const visualBottom = wrapperRect.bottom - containerRect.top;
      const reservedHeight = Math.ceil(Math.max(layoutBottom, visualBottom) + reserveGap);
      spacer.style.height = `${reservedHeight}px`;
    }

    updateDiscoverSpacerLayout = updateDiscoverSpacer;
    updateDiscoverSpacer();
    requestAnimationFrame(updateDiscoverSpacer);
    setTimeout(updateDiscoverSpacer, 120);
    setTimeout(updateDiscoverSpacer, 420);
    track.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', updateDiscoverSpacer, { once: true });
    });
    window.addEventListener('resize', updateDiscoverSpacer, { passive: true });
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
            <div class="discover-play-wrapper">
              <button class="special-play-btn discover-play-circle" style="--btn-color: #eab308;">
                <i class="ph-fill ph-play discover-play-icon"></i>
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
            <div class="discover-play-wrapper">
              <button class="featured-play-btn discover-play-circle" style="--btn-color: #f97316;">
                <i class="ph-fill ph-play discover-play-icon"></i>
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

    // Dispara preload em background com limitador
    preloadTracksInBackground(state.tracks, playlist.id);

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
        renderDiscoverCarousel();
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

        // Inicializa a rádio
        initRadio();

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
    const controlsBlur = document.getElementById('player-controls-blur');
    const tabsBar = document.getElementById('player-tabs-bar');
    const feedbackBar = document.getElementById('player-feedback');
    const headerButtons = document.getElementById('player-header-buttons');
    if (!modal) return;

    if (show) {
      lockBodyScroll();
      modal.removeAttribute('inert');
      modal.style.pointerEvents = 'auto';
      updatePlaylistEmptyState();
      requestAnimationFrame(() => {
        if (TAB_ORDER[currentTabIndex] === 'playlist') {
          initPlaylistsMarquee();
        }
      });
    } else {
      modal.setAttribute('inert', '');
      modal.style.pointerEvents = 'none';
      unlockBodyScroll();
      // Esconde o feedback ao fechar o modal
      hideVisibleElement(feedbackBar);
      // Colapsa a capa expandida
      toggleExpandedCover(false);
    }

    toggleElementVisibility(modal, show);
    toggleElementVisibility(controlsBar, show);
    toggleElementVisibility(controlsBlur, show);
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

    if (show && currentTabIndex === 0) {
      requestAnimationFrame(() => {
        updateDiscoverSpacerLayout?.();
        setTimeout(() => updateDiscoverSpacerLayout?.(), 120);
      });
    }
  }

  function updatePlaylistEmptyState() {
    // Verifica se há playlists visíveis no container
    const hasVisiblePlaylists = ui.myPlaylistsGrid && ui.myPlaylistsGrid.children.length > 0;
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
    return typeof url === 'string' && /^data:image\/(png|jpeg)/.test(url.trim());
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
    resultsContainer.classList.remove('is-empty');
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
          resultsContainer.classList.add('is-empty');
          resultsContainer.innerHTML = `
            <div class="manual-search-empty-state flex flex-col items-center justify-center py-12 text-white/50">
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
          resultsContainer.classList.add('is-empty');
          resultsContainer.innerHTML = `
            <div class="manual-search-empty-state flex flex-col items-center justify-center py-12 text-white/50">
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
      resultsContainer.classList.remove('is-empty');
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
        <button class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-white transition-all duration-300 hover:scale-110 active:scale-95" 
          style="background: rgba(147, 51, 234, 0.45); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), 0 0 2px rgba(255, 255, 255, 0.25) inset; backdrop-filter: blur(15px) saturate(300%) brightness(2.5); -webkit-backdrop-filter: blur(15px) saturate(300%) brightness(2.5); border: 1px solid rgba(168, 85, 247, 0.3);"
          title="Importar playlist">
          <i class="ph-bold ph-plus text-base"></i>
        </button>
      </div>
    `;
  }

  // Renderiza resultados de busca de playlists
  function renderPlaylistSearchResults(playlists) {
    const container = ui.manualSearchResults;
    if (!container) return;

    if (ui.youtubeEmptyState) ui.youtubeEmptyState.classList.add('hidden');
    container.classList.remove('is-empty');
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
    container.classList.remove('is-empty');
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
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <p class="search-item-title text-sm text-white font-medium line-clamp-2 leading-tight m-0 p-0">${escapeHTML(video.title)}</p>
              <p class="text-xs text-white/50 truncate leading-tight m-0 p-0 mt-0.5">${escapeHTML(video.author)}</p>
            </div>
            <span class="search-item-duration text-xs text-white/40 flex-shrink-0">${duration}</span>
            <button class="add-to-playlist-btn flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:text-white transition-all duration-300 hover:scale-110 active:scale-95" 
              style="background: rgba(255, 122, 31, 0.45); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), 0 0 2px rgba(255, 255, 255, 0.25) inset; backdrop-filter: blur(15px) saturate(300%) brightness(2.5); -webkit-backdrop-filter: blur(15px) saturate(300%) brightness(2.5); border: 1px solid rgba(255, 122, 31, 0.3);"
              title="Adicionar à playlist">
              <i class="ph-bold ph-plus text-base"></i>
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
      <div id="youtube-playlist-import-modal" class="fixed inset-0 overlay-blur z-[70] flex items-center justify-center p-4" style="pointer-events: auto;">
        <div class="relative w-full max-w-sm glass-effect rounded-3xl p-5 pt-7 overflow-hidden">
          <button id="cancel-playlist-import" class="absolute top-3 right-3 glass-effect text-white/90 w-9 h-9 rounded-full hover:bg-white/10 hover:text-white flex items-center justify-center z-30 transition-all transform hover:scale-110 hover:rotate-90 shadow-lg" aria-label="Fechar">
            <i class="ph-bold ph-x text-sm"></i>
          </button>

          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <i class="ph-bold ph-playlist text-purple-400 text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-white/90 line-clamp-2">${escapeHTML(title)}</h3>
              <p class="text-xs text-white/50 mt-0.5">${escapeHTML(author)}</p>
              <p class="text-[11px] text-white/40 mt-0.5">${videos.length} músicas • ${formattedDuration}</p>
            </div>
          </div>
          
          <div class="max-h-[240px] overflow-y-auto scrollbar-hide">
            <p class="text-[11px] text-white/40 mb-2 uppercase tracking-wider font-medium">Prévia</p>
            <div class="space-y-1.5">
              ${videos.slice(0, 10).map((v, i) => `
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-white/25 w-4 text-right font-medium">${i + 1}</span>
                  <span class="text-white/70 truncate flex-1">${escapeHTML(v.title)}</span>
                  <span class="text-white/35 text-[11px]">${formatDuration(v.lengthSeconds * 1000)}</span>
                </div>
              `).join('')}
              ${videos.length > 10 ? `<p class="text-[11px] text-white/35 text-center mt-2">+ ${videos.length - 10} músicas</p>` : ''}
            </div>
          </div>
          
          <div class="mt-4 pt-3" style="border-top: 1px dashed rgba(255, 255, 255, 0.1);">
            <button id="confirm-playlist-import" class="w-full py-3 rounded-xl text-white font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2" style="background: rgba(147, 51, 234, 0.6); border: 1px solid rgba(147, 51, 234, 0.4); box-shadow: 0 0 20px rgba(147, 51, 234, 0.3), 0 4px 12px rgba(147, 51, 234, 0.2);">
              <i class="ph-bold ph-download-simple"></i>
              Importar playlist
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

      // Mostra o progresso da busca de capas no Deezer (resolução antes de exibir)
      const onProgress = (done, total) => {
        confirmBtn.innerHTML = `<i class="ph-bold ph-spinner animate-spin"></i> Buscando capas... ${done}/${total}`;
      };

      await importYoutubePlaylistToLibrary(videos, title, onProgress);
      modal.remove();
    });
  }

  // Resolve a capa de uma faixa do YouTube no Deezer ANTES de exibi-la.
  // Nunca mantém a capa do YouTube: usa a capa do Deezer ou a genérica como fallback imediato.
  async function resolveTrackCoverFromDeezer(track) {
    if (!track) return;
    let cover = '';
    try {
      const artistLabel = getTrackArtists(track).replace(/, /g, ' ');
      cover = sanitizeImageUrl(await buscarCapaFaixa(getTrackTitle(track), artistLabel));
    } catch (_) {
      cover = '';
    }
    const finalCover = isRealCover(cover) ? cover : getFallbackCover(getTrackTitle(track));
    track.thumbnail = finalCover;
    track.album = track.album || {};
    track.album.name = track.album.name || 'YouTube';
    track.album.images = [{ url: finalCover }];
    track.generatedCover = !isRealCover(finalCover);
    track._deezerCoverResolved = true;
  }

  // Resolve as capas do Deezer de várias faixas em sequência (respeitando o rate limit dos proxies).
  async function resolveTracksCoversFromDeezer(tracks = [], onProgress = null) {
    let done = 0;
    for (const track of tracks) {
      await resolveTrackCoverFromDeezer(track);
      done++;
      if (typeof onProgress === 'function') onProgress(done, tracks.length);
      if (done < tracks.length) {
        await delay(state.coverLastSuccessProxy === 'jina' ? 400 : 250);
      }
    }
  }

  // Importa as músicas da playlist para a biblioteca
  async function importYoutubePlaylistToLibrary(videos, playlistTitle, onProgress = null) {
    // Cria uma nova playlist com o nome da playlist do YouTube
    const playlistName = playlistTitle || 'YouTube Playlist';
    
    // Verifica se já existe uma playlist com esse nome
    let targetPlaylist = state.playlists.find(p => p.name === playlistName);
    const isNewPlaylist = !targetPlaylist;

    if (!targetPlaylist) {
      // Cria nova playlist (capa genérica até o Deezer resolver)
      targetPlaylist = {
        id: `yt-${Date.now()}`,
        name: playlistName,
        cover: 'src/imagens/genericCover.png',
        images: [],
        tracks: []
      };
    }

    // Converte vídeos para faixas SEM a capa do YouTube (apenas dados para casar com o Deezer).
    // A capa começa genérica e é substituída pela do Deezer assim que a correspondência for resolvida.
    const newTracks = videos.map(video => ({
      name: video.title,
      artists: [{ name: video.author }],
      duration_ms: video.lengthSeconds * 1000,
      album: { name: 'YouTube', images: [] },
      thumbnail: getFallbackCover(video.title),
      generatedCover: true,
      _videoId: video.videoId,
      _fromYoutubePlaylist: true
    }));

    // Filtra duplicatas por videoId
    const existingVideoIds = new Set(targetPlaylist.tracks.filter(t => t._videoId).map(t => t._videoId));
    const tracksToAdd = newTracks.filter(t => !existingVideoIds.has(t._videoId));

    // Resolve as capas no Deezer ANTES de adicionar/renderizar (nunca exibe capa do YouTube)
    await resolveTracksCoversFromDeezer(tracksToAdd, onProgress);

    // Adiciona as faixas já com as capas resolvidas
    targetPlaylist.tracks.push(...tracksToAdd);
    if (isNewPlaylist) {
      state.playlists.push(targetPlaylist);
    }

    // Monta a capa do card como mosaico das artes de álbum do Deezer (genérica se não houver imagens)
    await refreshPlaylistMosaicCover(targetPlaylist);

    // Salva no localStorage
    savePlaylistsToStorage();

    // Feedback
    const playlistCover = getPlaylistCover(targetPlaylist);
    setFeedback(`${tracksToAdd.length} músicas importadas`, 'success', {
      name: playlistName,
      cover: playlistCover,
      subtitle: `${targetPlaylist.tracks.length} faixas no total`
    });

    // Muda para a aba de biblioteca (garante que o container fique visível)
    switchPlayerTab('playlist');

    // Aguarda um frame para garantir que a aba está visível antes de renderizar
    await nextFrame();

    // Atualiza a grade de playlists
    renderPlaylists();

    // Seleciona a playlist recém-importada para exibir apenas as suas faixas
    await selectPlaylist(targetPlaylist);
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
      }

      // Busca o áudio
      const audioUrl = await getTrackAudioUrl(track, clickedIndex);
      
      if (!audioUrl) {
        item.classList.remove('loading');
        
        // Se não for retry, tenta mais uma vez
        if (!isRetry) {
          return playYouTubeSearchResult(item, true);
        }
        
        // Se já foi retry, avança para próxima
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
        return playYouTubeSearchResult(item, true);
      }
      
      // Se já foi retry, avança para próxima
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
          <div class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:text-white transition-all duration-300 hover:scale-110 active:scale-95" style="background: rgba(255, 122, 31, 0.6); box-shadow: 0 4px 12px rgba(255, 122, 31, 0.3), 0 0 2px rgba(255, 255, 255, 0.25) inset; border: 1px solid rgba(255, 122, 31, 0.4);">
            <i class="ph-bold ph-plus text-base"></i>
          </div>
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

    // Resolve a capa no Deezer ANTES de adicionar/exibir (nunca usa a capa do YouTube)
    await resolveTrackCoverFromDeezer(pendingYouTubeTrack);

    // Adiciona a faixa à playlist
    playlist.tracks.unshift(pendingYouTubeTrack);

    // Atualiza a capa do mosaico (artes do Deezer) se for playlist importada do YouTube
    if (isYoutubeImportedPlaylist(playlist)) {
      await refreshPlaylistMosaicCover(playlist);
    }

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

    // Resolve a capa no Deezer ANTES de criar/exibir (nunca usa a capa do YouTube)
    await resolveTrackCoverFromDeezer(pendingYouTubeTrack);

    // Cria nova playlist com ID único
    const newPlaylist = {
      id: `yt-playlist-${Date.now()}`,
      name: name,
      // A capa é resolvida via Deezer no enriquecimento; usa a genérica até lá
      cover: 'src/imagens/genericCover.png',
      images: [],
      tracks: [pendingYouTubeTrack]
    };

    // Adiciona ao início da lista
    state.playlists.unshift(newPlaylist);

    // Monta a capa do mosaico (artes do Deezer); com 1 faixa, usa a capa genérica
    await refreshPlaylistMosaicCover(newPlaylist);

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
    if (!ui.myPlaylistsGrid || !playlistId) return;
    const img = ui.myPlaylistsGrid.querySelector(`.my-playlist-card[data-playlist-id="${playlistId}"] img`);
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

  // Quantidade mínima de capas para compor o mosaico 2x2 completo
  const PLAYLIST_MOSAIC_MIN = 4;

  // Identifica playlists importadas do YouTube (id começa com "yt-")
  function isYoutubeImportedPlaylist(playlist) {
    return typeof playlist?.id === 'string' && playlist.id.startsWith('yt-');
  }

  // (Re)gera a capa de uma playlist como mosaico 2x2 a partir das capas (artes de álbum) das faixas.
  // O mosaico só é gerado quando há 4 ou mais capas reais; caso contrário usa a capa genérica.
  async function refreshPlaylistMosaicCover(playlist) {
    if (!playlist) return;

    const realCovers = (playlist.tracks || [])
      .map(track => getTrackCoverUrl(track))
      .filter(isRealCover);
    const unique = [...new Set(realCovers)];

    // Assinatura das capas relevantes: evita regerar o mosaico sem necessidade
    const signature = `${unique.length}:${unique.slice(0, PLAYLIST_MOSAIC_MIN).join('|')}`;
    if (signature === playlist._coverSignature) return;

    // Menos de 4 capas: usa a capa genérica (evita mosaico incompleto)
    if (unique.length < PLAYLIST_MOSAIC_MIN) {
      playlist._coverSignature = signature;
      playlist.images = [];
      playlist.coverSources = [];
      updatePlaylistCardCover(playlist.id, getFallbackCover(playlist.name));
      return;
    }

    // Mosaico 2x2 com as 4 primeiras capas das faixas
    const mosaicSources = unique.slice(0, 4);
    try {
      const mosaic = await gerarCapaPlaylist(mosaicSources);
      if (mosaic) {
        playlist._coverSignature = signature;
        playlist.coverSources = mosaicSources;
        setPlaylistCover(playlist, mosaic);
        return;
      }
    } catch (error) {
      console.warn(`⚠️ [COVER] Falha ao gerar mosaico da playlist "${playlist.name}": ${error.message}`);
    }

    // Falha ao gerar (transitória): não fixa a assinatura (permite nova tentativa) e
    // preserva um mosaico já existente; só usa a genérica se ainda não houver mosaico.
    if (!isMosaicCover(playlist.images?.[0]?.url)) {
      playlist.images = [];
      playlist.coverSources = [];
      updatePlaylistCardCover(playlist.id, getFallbackCover(playlist.name));
    }
  }

  // Mantém o mural de capas da "Músicas Favoritas" consistente com suas faixas
  async function refreshWatchLaterCover() {
    const watchLater = getWatchLaterPlaylist();
    if (!watchLater) return;
    await refreshPlaylistMosaicCover(watchLater);
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

      // A capa da "Músicas Favoritas" é gerenciada por refreshWatchLaterCover (mural das faixas)
      if (playlist.id === WATCH_LATER_PLAYLIST_ID) continue;

      // Playlists do YouTube: capa sempre montada com as artes de álbum do Deezer (mosaico)
      if (isYoutubeImportedPlaylist(playlist)) {
        await refreshPlaylistMosaicCover(playlist);
        continue;
      }

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

        const youtubeTrack = isYoutubeTrack(track);

        const hasRealCover = track.thumbnail
          && !track.generatedCover
          && !isFallbackCover(track.thumbnail)
          && !isGeneratedCover(track.thumbnail);

        // Faixas do YouTube sempre buscam a capa no Deezer (mesmo com thumbnail do YouTube),
        // exceto quando a correspondência já foi resolvida nesta sessão.
        if (youtubeTrack) {
          if (track._deezerCoverResolved) continue;
        } else if (hasRealCover) {
          continue;
        }

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
          if (youtubeTrack) track._deezerCoverResolved = true;
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

      // "Músicas Favoritas": mural composto exclusivamente pelas capas das faixas da playlist
      // (nunca por busca de nome no Deezer, que traz capas que não correspondem às faixas)
      if (playlist.id === WATCH_LATER_PLAYLIST_ID) {
        await refreshPlaylistMosaicCover(playlist);
        continue;
      }

      // Playlists do YouTube: capa sempre montada com as artes de álbum do Deezer (mosaico)
      if (isYoutubeImportedPlaylist(playlist)) {
        await refreshPlaylistMosaicCover(playlist);
        continue;
      }

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

      if (normalizedTracks.length) {
        const tracksToPreload = state.tracks.length ? state.tracks : normalizedTracks;
        preloadTracksInBackground(tracksToPreload, state.currentPlaylist?.id);
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

  function renderPlaylists() {
    if (!ui.myPlaylistsGrid || !ui.myPlaylistsSection) return;

    if (!state.playlists || state.playlists.length === 0) {
      ui.myPlaylistsSection.style.display = 'none';
      updatePlaylistEmptyState();
      return;
    }

    ui.myPlaylistsSection.style.display = 'block';

    ui.myPlaylistsGrid.innerHTML = state.playlists.map(playlist => {
      const trackCount = getPlaylistTrackCount(playlist);
      const isWatchLater = playlist.id === WATCH_LATER_PLAYLIST_ID;

      // Usa o mural gerado (armazenado em images). Enquanto o mural não estiver pronto,
      // mostra a capa da primeira faixa como placeholder apenas se a playlist tiver 4+ faixas.
      let imageUrl = getPlaylistCover(playlist);
      if (isWatchLater && !playlist.images?.length && trackCount >= 4 && playlist.tracks?.[0]) {
        imageUrl = getTrackCoverUrl(playlist.tracks[0]) || imageUrl;
      }

      return `
        <div class="my-playlist-card special-playlist-card group cursor-pointer rounded-xl overflow-hidden bg-white/5 hover:bg-white/10 transition-all duration-300 hover:scale-[1.02] ring-1 ring-white/10 relative" 
             data-playlist-id="${playlist.id}">
          <div class="relative aspect-square">
            <img src="${imageUrl}" 
                 alt="${playlist.name}" 
                 class="w-full h-full object-cover"
                 onerror="this.src='src/imagens/genericCover.png'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            ${!isWatchLater ? `
            <button class="delete-playlist-btn absolute top-2 right-2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-500/90 shadow-lg" title="Excluir Playlist">
              <i class="ph-bold ph-trash text-white text-[14px]"></i>
            </button>
            ` : `
            <div class="absolute top-2 right-2">
              <i class="ph-fill ph-heart text-red-500 text-lg drop-shadow-lg"></i>
            </div>
            `}
            <div class="discover-play-wrapper">
              <button class="my-playlist-play-btn discover-play-circle" style="--btn-color: #f97316;">
                <i class="ph-fill ph-play discover-play-icon"></i>
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

    // Event listeners para as playlists
    ui.myPlaylistsGrid.querySelectorAll('.my-playlist-card').forEach(card => {
      const playlistId = card.dataset.playlistId;
      const playlist = state.playlists.find(p => p.id === playlistId);

      if (!playlist) return;

      const deleteBtn = card.querySelector('.delete-playlist-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deletePlaylist(playlistId);
        });
      }

      // Clique no card ou no play - seleciona e vai para a tela de biblioteca
      const clickHandler = (e) => {
        e.stopPropagation();
        
        // Se clicou no botão play
        const isPlayBtn = e.target.closest('.my-playlist-play-btn');
        
        // Vai para a aba biblioteca (que mostrará as tracks da playlist selecionada)
        if (ui.tabPlaylist) {
          ui.tabPlaylist.click();
        }
        
        if (isPlayBtn || (!state.currentPlaylist || state.currentPlaylist.id !== playlist.id)) {
          selectPlaylist(playlist, isPlayBtn);
        }
      };

      card.addEventListener('click', clickHandler);
    });

    updatePlaylistEmptyState();

    // Mantém o mural de capas da "Músicas Favoritas" consistente com suas faixas
    refreshWatchLaterCover();
  }

  async function selectPlaylist(playlist, autoPlay = false, options = {}) {
    if (!playlist) return;
    const { preloadAudio = true } = options;

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
        refreshCoversAfterEnrichment(importSessionId);
      })
      .catch(() => { });

    if (preloadAudio && !state.preloadedPlaylists.has(playlist.id)) {
      preloadTracksInBackground(state.tracks, playlist.id).then(() => {
        state.preloadedPlaylists.add(playlist.id);
      });
    }

    if (autoPlay && state.tracks.length > 0) {
      setTimeout(() => playNextFrom(0), 400);
    }
  }

  // Pré-carrega faixas em segundo plano com rate limiting
  async function preloadTracksInBackground(tracks, playlistId) {
    // Rate limit: 2 requests por segundo para evitar 429
    const delayBetweenRequests = 600;
    const results = [];

    for (let i = 0; i < tracks.length; i++) {
      if (state.currentPlaylist?.id !== playlistId) {
        // Se a playlist mudou durante o preload, interrompe para não atualizar a UI errada
        break;
      }
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
        markTrackUnavailable(index);
        return null;
      }
    } catch (error) {
      if (retryCount < maxRetries) {
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

  // Identifica faixas importadas do YouTube (busca manual ou import de playlist)
  function isYoutubeTrack(track) {
    return !!(track && (track._videoId || track._fromYoutubePlaylist || track._manualSearch));
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

    if (url.includes('/fourshared')) {
      return { playable: true, reason: 'fourshared-proxy' };
    }

    const isProxied = url.includes('/audio') || url.startsWith('/proxy');

    // URLs sem proxy não conseguem ser validadas por CORS; confiar nelas
    if (!isProxied) return { playable: true, reason: 'non-proxied' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout
    try {
      const resp = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Range: 'bytes=0-8192' }
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
      return Number.isFinite(num) && num > 0 ? num : null;
    };

    const durationMs = toNumber(source.duration_ms) ?? toNumber(source.durationMs);
    if (durationMs) return durationMs;

    const seconds =
      toNumber(source.lengthSeconds) ??
      toNumber(source.length) ??
      toNumber(source.duration);

    if (seconds) return seconds * 1000;
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
    return extractDurationMs(track) ?? (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : null);
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
    const currentMs = audio.currentTime * 1000;

    if (!Number.isFinite(durationMs)) {
      // Se não temos duração total, exibe o tempo decorrido e zera o progresso visual
      setTrackDurationLabel(activeIndex, currentMs);
      updateTrackProgress(activeIndex, 0);
    } else {
      const remainingMs = Math.max(0, durationMs - currentMs);
      setTrackDurationLabel(activeIndex, remainingMs);
      const progress = Math.min(100, (currentMs / durationMs) * 100);
      updateTrackProgress(activeIndex, progress);
    }

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

    // O espaçamento superior agora é resolvido 100% pelo padding-top do #tracks-container
    // garantindo que as faixas sempre iniciem exatamente abaixo da faixa de playlists.

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
        ? `<button class="track-remove-watch-later-btn" 
            data-remove-index="${index}" 
            aria-label="Remover dos favoritos" 
            title="Remover dos favoritos">
            <i class="ph-bold ph-trash text-base"></i>
          </button>`
        : `<button class="track-add-watch-later-btn ${isInFavorites ? 'is-favorite' : ''}" 
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
        <div class="flex-1 min-w-0 flex flex-col justify-center">
          <p class="text-white font-medium truncate track-title leading-tight m-0 p-0">${track.name}</p>
          <p class="text-white/70 text-xs truncate leading-tight m-0 p-0 mt-0.5">${artists}</p>
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

  // === 4shared Fallback Functions ===

  /**
   * Busca uma faixa no 4shared como fonte alternativa de áudio.
   * Ativado quando YouTube + RapidAPI falham.
   */
  async function search4shared(trackName, artistName, durationMs = null) {
    // Só funciona em produção (Netlify) ou com netlify dev
    if (localDevFlag && !window.location.port.toString().startsWith('888')) {
      return null;
    }

    const query = `${trackName} ${artistName}`.trim();
    if (!query) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`/fourshared?action=search&q=${encodeURIComponent(query)}&limit=10`, {
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[4SHARED] HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const files = data?.files;
      if (!Array.isArray(files) || !files.length) {
        return null;
      }

      // Pontua e seleciona o melhor resultado
      const scored = files.map(file => {
        let score = 0;
        const fileName = (file.name || '').toLowerCase();
        const trackLower = trackName.toLowerCase();
        const artistLower = artistName.toLowerCase();

        // Pontuação por nome da faixa (0-50)
        const titleSim = calculateStringSimilarity(fileName, trackLower);
        score += titleSim * 50;

        // Pontuação por artista (0-30)
        if (artistLower) {
          const artistSim = calculateStringSimilarity(fileName, artistLower);
          score += artistSim * 30;
        }

        // Bonus se contém ambos nome e artista
        if (fileName.includes(trackLower) || trackLower.includes(fileName)) score += 10;
        if (artistLower && fileName.includes(artistLower)) score += 10;

        // Penalidade para covers, remixes etc.
        const negTerms = ['cover', 'remix', 'karaoke', 'instrumental', 'ringtone', '8d audio'];
        if (negTerms.some(t => fileName.includes(t) && !trackLower.includes(t))) {
          score -= 15;
        }

        return { ...file, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      if (!best || best.score < 5) return null;

      console.log(`🔄 [4SHARED] Found fallback: "${best.name}" (score: ${best.score.toFixed(1)})`);
      return {
        fileId: best.id,
        name: best.name,
        source: '4shared'
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('[4SHARED] Search timeout');
      } else {
        console.warn(`[4SHARED] Search error: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Obtém a URL de stream de um arquivo do 4shared.
   * Usa cache com TTL de AUDIO_URL_TTL_MS (10 min).
   */
  async function get4sharedStreamUrl(fileId) {
    if (!fileId) return null;

    // Chave de cache com prefixo para evitar colisão com videoIds do YouTube
    const cacheKey = `4s-${fileId}`;
    const cached = getCacheEntry(state.audioCache, cacheKey, AUDIO_URL_TTL_MS);
    if (cached !== null) return cached;

    // O endpoint /fourshared?action=stream atua como Proxy e usa Range Requests 
    // para fatiar o áudio em pedaços de 2MB, evitando IP Binding do 4shared e o limite de 6MB do Netlify.
    const streamUrl = `/fourshared?action=stream&id=${encodeURIComponent(fileId)}`;
    setCacheEntry(state.audioCache, cacheKey, streamUrl);
    return streamUrl;
  }

  /**
   * Tenta reproduzir via 4shared como fallback.
   * Retorna o resultado com audioUrl se bem-sucedido, ou null.
   */
  async function tryFoursharedFallback(track, index) {
    const trackName = getTrackTitle(track);
    const artists = getTrackArtists(track);
    const durationMs = extractDurationMs(track);

    console.log(`🔄 [4SHARED] Tentando fallback para: "${trackName}" - ${artists}`);

    const searchResult = await search4shared(trackName, artists, durationMs);
    if (!searchResult) {
      console.warn(`❌ [4SHARED] Nenhum resultado encontrado para: "${trackName}"`);
      return null;
    }

    const streamUrl = await get4sharedStreamUrl(searchResult.fileId);
    if (!streamUrl) {
      console.warn(`❌ [4SHARED] Não foi possível obter stream URL para: "${searchResult.name}"`);
      return null;
    }

    console.log(`✅ [4SHARED] Fallback disponível: "${searchResult.name}"`);

    const result = {
      videoId: `4s-${searchResult.fileId}`,
      instance: '4shared-fallback',
      audioUrl: streamUrl,
      lengthSeconds: 0 // Será detectado via getAudioDuration
    };

    // Cache o resultado
    const key = getTrackKey(track);
    if (key) {
      setCacheEntry(state.searchCache, key, result);
    }

    return result;
  }

  // === End 4shared Fallback Functions ===

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
          console.warn(`❌ [AUDIO] Nenhum vídeo encontrado para "${track.name}", tentando 4shared...`);
          // Fallback: tenta 4shared quando YouTube não encontra nada
          const foursharedResult = await tryFoursharedFallback(track, index);
          if (foursharedResult) return foursharedResult;
          return null;
        }
      }

      updateTrackDurationFromResult(track, index, video);
      if (forceRefresh && video.videoId) {
        state.audioCache.delete(video.videoId);
      }
      const audioUrl = await getAudioUrl(video.videoId);
      if (!audioUrl) {
        console.warn(`❌ [AUDIO] Não foi possível resolver stream para "${track.name}" (${video.videoId}), tentando 4shared...`);
        // Fallback: tenta 4shared quando RapidAPI não consegue extrair áudio
        const foursharedResult = await tryFoursharedFallback(track, index);
        if (foursharedResult) return foursharedResult;
        return null;
      }

      // Se não tem duração (preset videoId), tenta obter do áudio
      if (!video.lengthSeconds) {
        try {
          const duration = await getAudioDuration(audioUrl);
          if (duration > 0) {
            video.lengthSeconds = duration;
            updateTrackDurationFromResult(track, index, video);
          }
        } catch (e) { }
      }

      const result = { ...video, audioUrl };
      setCacheEntry(state.searchCache, key, result);
      return result;
    } catch (error) {
      console.warn(`❌ [AUDIO] Erro ao resolver faixa "${track?.name || 'desconhecida'}": ${error.message}`);
      // Fallback: tenta 4shared em caso de erro inesperado
      try {
        const foursharedResult = await tryFoursharedFallback(track, index);
        if (foursharedResult) return foursharedResult;
      } catch (fbError) {
        console.warn(`❌ [4SHARED] Fallback também falhou: ${fbError.message}`);
      }
      return null;
    }
  }

  async function handleAudioError(event = null) {
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

    // Verifica se o usuário já clicou em outra música
    if (isStale()) {
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

      // Verifica se o usuário já clicou em outra música
      if (isStale()) {
        return;
      }

      // Limpa cache de áudio para forçar nova busca
      if (targetVideoId) {
        state.audioCache.delete(targetVideoId);
      }

      const refreshed = await resolveTrackWithCache(track, failingIndex, { forceRefresh: true, preserveFailures: true });
      // Verifica novamente após o await
      if (isStale()) {
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
          if (!isStale()) {
            try {
              // Reseta o elemento de áudio antes de tentar nova URL
              await resetAudioWithDelay();

              loadAudioSource(alternativeResult.audioUrl);
              await delay(300);
              await audio.play();
              markPlaybackSuccess(failingIndex);
              return;
            } catch (altError) {
              console.error(`❌ [AUDIO] Alternative video play failed: ${altError.message}`);
            }
          }
        }

        // Último recurso: tenta 4shared antes de marcar como indisponível
        if (!isStale()) {
          console.log(`🔄 [AUDIO] Tentando fallback 4shared para track ${failingIndex}...`);
          const foursharedResult = await tryFoursharedFallback(track, failingIndex);
          if (foursharedResult?.audioUrl && !isStale()) {
            try {
              await resetAudioWithDelay();
              loadAudioSource(foursharedResult.audioUrl);
              await delay(300);
              await audio.play();
              markPlaybackSuccess(failingIndex);
              console.log(`✅ [4SHARED] Fallback bem-sucedido para track ${failingIndex}`);
              return;
            } catch (fbError) {
              console.error(`❌ [4SHARED] Fallback play failed: ${fbError.message}`);
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
        return;
      }

      // Só marca como indisponível após esgotar todas as combinações
      if (attempt >= maxAttempts) {
        // Último recurso: tenta 4shared antes de desistir
        if (!isStale()) {
          const foursharedLast = await tryFoursharedFallback(track, failingIndex);
          if (foursharedLast?.audioUrl && !isStale()) {
            try {
              await resetAudioWithDelay();
              loadAudioSource(foursharedLast.audioUrl);
              await delay(300);
              await audio.play();
              markPlaybackSuccess(failingIndex);
              console.log(`✅ [4SHARED] Fallback final bem-sucedido para track ${failingIndex}`);
              return;
            } catch (fbLastErr) {
              console.error(`❌ [4SHARED] Fallback final falhou: ${fbLastErr.message}`);
            }
          }
          handleUnavailableTrack(failingIndex);
        }
      } else {
        // Agenda nova tentativa de recovery - reduzido para 500ms
        const savedRequestId = currentRequestId;
        setTimeout(() => {
          // Verifica se ainda é a mesma requisição
          if (state.playRequestId === savedRequestId && state.currentTrackIndex === failingIndex && !state.isPlaying) {
            handleAudioError();
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
    const durationMs = extractDurationMs(track);

    // Busca via YouTube (scraping)
    const result = await searchPlayDl(track.name, artists, durationMs);

    if (result) {
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

    const cached = getCacheEntry(state.audioCache, videoId, AUDIO_URL_TTL_MS);
    if (cached !== null) return cached;

    try {
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

    // Para a rádio se estiver tocando
    if (radioPlaying) stopRadio();

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
    // Se a rádio está tocando, para a rádio
    if (handleCtrlPlayForRadio()) return;

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


  // === RÁDIO SUNSHINE LIVE — Multi-canal ===
  const RADIO_CHANNELS = [
    { id: 'live',      name: 'Sunshine Live',   desc: 'O principal canal eletrônico',         icon: 'ph-radio',           color: '#ff7a1f', cover: 'src/imagens/radio/sunshine-sunshine-logo_bg.webp',       url: 'https://stream.sunshine-live.de/live/mp3-128', featured: true },
    { id: '80er',      name: '80s',             desc: 'Synthpop, New Wave & Italo Disco',     icon: 'ph-cassette-tape',   color: '#e879f9', cover: 'src/imagens/radio/Die80er.webp',        url: 'https://stream.sunshine-live.de/80er/mp3-128' },
    { id: '90er',      name: '90s',             desc: 'Eurodance, Trance & Rave clássico',    icon: 'ph-vinyl-record',    color: '#38bdf8', cover: 'src/imagens/radio/Die90er.webp',        url: 'https://stream.sunshine-live.de/90er/mp3-128' },
    { id: '2000er',    name: '2000s',           desc: 'Electro, Progressive & Minimal',       icon: 'ph-disc',            color: '#4ade80', cover: 'src/imagens/radio/2000er.webp',      url: 'https://stream.sunshine-live.de/2000er/mp3-128' },
    { id: '2010er',    name: '2010s',           desc: 'EDM, Future Bass & Big Room',          icon: 'ph-waveform',        color: '#fb923c', cover: 'src/imagens/radio/2010er.webp',      url: 'https://stream.sunshine-live.de/2010er/mp3-128' },
    { id: 'edm',       name: 'EDM',             desc: 'Electronic Dance Music mainstream',    icon: 'ph-lightning',       color: '#facc15', cover: 'src/imagens/radio/edm_bg.webp',        url: 'https://stream.sunshine-live.de/edm/mp3-128', featured: true },
    { id: 'classics',  name: 'Classics',        desc: 'Os clássicos eternos da eletrônica',   icon: 'ph-star',            color: '#c084fc', cover: 'src/imagens/radio/classics.webp',   url: 'https://stream.sunshine-live.de/classics/mp3-128', featured: true },
    { id: 'dnb',       name: "Drum 'n' Bass",   desc: 'Breakbeats rápidos e graves pesados',  icon: 'ph-speaker-high',    color: '#f87171', cover: 'src/imagens/radio/drumnbass.webp',        url: 'https://stream.sunshine-live.de/dnb/mp3-128' },
    { id: 'hardcore',  name: 'Hardcore',         desc: 'Gabber, Hardcore & Hardstyle',         icon: 'ph-fire',            color: '#ef4444', cover: 'src/imagens/radio/hardcore.webp',   url: 'https://stream.sunshine-live.de/Hardcore/mp3-128' },
    { id: 'hardtechno',name: 'Hardtechno',       desc: 'Techno pesado e industrial',           icon: 'ph-skull',           color: '#a3a3a3', cover: 'src/imagens/radio/hardtechno.webp', url: 'https://stream.sunshine-live.de/Hardtechno/mp3-128' },
    { id: 'melodicb',  name: 'Melodic Beats',   desc: 'Melodic Techno & Progressive',         icon: 'ph-music-notes',     color: '#67e8f9', cover: 'src/imagens/radio/melodic_beats.webp',    url: 'https://stream.sunshine-live.de/MelodicB/mp3-128', featured: true },
    { id: 'blue',      name: 'Blue',            desc: 'Chillout, Lounge & Ambient',           icon: 'ph-cloud',           color: '#60a5fa', cover: 'src/imagens/radio/blue.webp',       url: 'https://stream.sunshine-live.de/Blue/mp3-128' },
    { id: 'calmflow',  name: 'Calm Flow',       desc: 'Lo-fi, Downtempo & relaxamento',       icon: 'ph-leaf',            color: '#34d399', cover: 'src/imagens/radio/calmflow_plain_1.webp',   url: 'https://stream.sunshine-live.de/calmflow/mp3-128', featured: true },
  ];

  const RADIO_DEFAULT_COVER = 'src/imagens/radio/default.svg';

  let radioAudio = null;
  let radioPlaying = false;
  let radioLoading = false;
  let radioCurrentChannel = null;

  function initRadio() {
    radioAudio = document.getElementById('radio-audio-player');
    if (!radioAudio) return;

    const grid = document.getElementById('radio-channels-grid');
    const featuredRow = document.getElementById('radio-featured-row');
    if (grid) renderRadioChannels(grid, RADIO_CHANNELS, 'blue');
    if (featuredRow) renderRadioChannels(featuredRow, RADIO_CHANNELS.filter(ch => ch.featured), 'purple');

    radioAudio.addEventListener('playing', () => {
      radioPlaying = true;
      radioLoading = false;
      updateRadioChannelUI();
      updateRadioControlsBar();
    });

    radioAudio.addEventListener('pause', () => {
      radioPlaying = false;
      radioLoading = false;
      updateRadioChannelUI();
      updateRadioControlsBar();
    });

    radioAudio.addEventListener('error', () => {
      radioPlaying = false;
      radioLoading = false;
      updateRadioChannelUI();
      updateRadioControlsBar();
    });
  }

  function renderRadioChannels(container, channels, btnColor = 'blue') {
    const btnHex = btnColor === 'purple' ? '#8b5cf6' : '#3b82f6';
    container.innerHTML = channels.map(ch => `
      <div class="radio-channel-card group cursor-pointer rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.02]" 
           data-radio-id="${ch.id}" style="--accent: ${ch.color}; --btn-color: ${btnHex};">
        <div class="relative aspect-square">
          <img src="${ch.cover}" 
               alt="${ch.name}" 
               class="w-full h-full object-cover"
               onerror="if(this.src.indexOf('default.svg')===-1){this.src='src/imagens/radio/default.svg'}else{this.src='src/imagens/genericCover.png'}">
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
          ${btnColor === 'purple' ? '<div class="absolute top-2 right-2 z-[2]"><i class="ph-fill ph-lightning text-orange-500 text-lg drop-shadow-lg"></i></div>' : ''}
          <div class="radio-card-darken"></div>
          <div class="radio-play-wrapper">
            <button class="radio-play-circle" type="button">
              <i class="ph-fill ph-play radio-icon-play"></i>
              <i class="ph ph-spinner radio-icon-spinner"></i>
            </button>
          </div>
          <div class="radio-card-text absolute bottom-0 left-0 right-0 p-3">
            <p class="text-white font-semibold text-sm truncate">${ch.name}</p>
            <p class="text-white/50 text-xs truncate">${ch.desc}</p>
          </div>
        </div>
      </div>
    `).join('');

    container.addEventListener('click', (e) => {
      const card = e.target.closest('.radio-channel-card');
      if (!card) return;
      const id = card.dataset.radioId;
      const ch = RADIO_CHANNELS.find(c => c.id === id);
      if (!ch) return;

      if (radioPlaying && radioCurrentChannel?.id === id) {
        stopRadio();
      } else {
        startRadio(ch);
      }
    });
  }

  function startRadio(channel) {
    if (!radioAudio || !channel) return;
    if (state.isPlaying && audio) {
      pausePlaying();
      updateUiState();
    }
    radioCurrentChannel = channel;
    radioLoading = true;
    radioPlaying = false;
    updateRadioChannelUI();
    radioAudio.src = channel.url + '?t=' + Date.now();
    radioAudio.load();
    radioAudio.play().catch(() => {});
  }

  function stopRadio() {
    if (!radioAudio) return;
    radioAudio.pause();
    radioAudio.removeAttribute('src');
    radioAudio.load();
    radioCurrentChannel = null;
    radioPlaying = false;
    radioLoading = false;
    updateRadioChannelUI();
    updateRadioControlsBar();
  }

  function updateRadioChannelUI() {
    document.querySelectorAll('.radio-channel-card').forEach(card => {
      const isTarget = radioCurrentChannel?.id === card.dataset.radioId;
      card.classList.toggle('active', radioPlaying && isTarget);
      card.classList.toggle('loading', radioLoading && isTarget);
    });
  }

  function setRadioTransportDisabled(disabled) {
    [ui.ctrlShuffle, ui.ctrlPrev, ui.ctrlNext, ui.ctrlRepeat].forEach(btn => {
      if (!btn) return;
      btn.disabled = disabled;
      btn.classList.toggle('radio-disabled', disabled);
    });
  }

  function updateRadioControlsBar() {
    if (!radioPlaying || !radioCurrentChannel) {
      // Restaura o estado normal do controls bar
      const controlsBar = document.getElementById('player-controls-bar');
      if (controlsBar) controlsBar.classList.remove('radio-mode');

      // Reativa botões de transporte
      setRadioTransportDisabled(false);

      // Restaura o play button para controle de música
      const playIcon = ui.ctrlPlay?.querySelector('i');
      if (playIcon) playIcon.className = state.isPlaying ? 'ph-bold ph-pause' : 'ph-bold ph-play';

      // Restaura info da música e media session
      updateControlsBar();
      updateMediaSession();
      return;
    }

    const controlsBar = document.getElementById('player-controls-bar');
    if (controlsBar) controlsBar.classList.add('radio-mode');

    // Desativa botões de transporte (visíveis porém inativos)
    setRadioTransportDisabled(true);

    // Play/pause controla a rádio
    const playIcon = ui.ctrlPlay?.querySelector('i');
    if (playIcon) playIcon.className = 'ph-bold ph-stop';

    // Atualiza info com dados da rádio
    if (ui.ctrlTitle) ui.ctrlTitle.textContent = radioCurrentChannel.name;
    if (ui.ctrlArtist) ui.ctrlArtist.textContent = 'SUNSHINE LIVE · Ao Vivo';

    // Atualiza capa com imagem do canal
    const coverImg = ui.ctrlCover?.querySelector('img');
    if (coverImg) {
      coverImg.src = radioCurrentChannel.cover;
    }

    // Ativa animação de wave no cover
    ui.ctrlCover?.classList.add('playing');

    // Atualiza Media Session com dados da rádio
    updateRadioMediaSession();
  }

  function updateRadioMediaSession() {
    if (!('mediaSession' in navigator) || !radioCurrentChannel) return;

    const artwork = [];
    if (radioCurrentChannel.cover) {
      artwork.push({ src: radioCurrentChannel.cover, sizes: '512x512', type: 'image/jpeg' });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: radioCurrentChannel.name,
      artist: 'SUNSHINE LIVE · Ao Vivo',
      album: radioCurrentChannel.desc || '',
      artwork
    });

    navigator.mediaSession.playbackState = radioPlaying ? 'playing' : 'none';

    // Para rádio: pause e stop ambos param a rádio
    navigator.mediaSession.setActionHandler('play', () => {
      if (radioCurrentChannel && !radioPlaying) startRadio(radioCurrentChannel);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (radioPlaying) stopRadio();
    });

    try {
      navigator.mediaSession.setActionHandler('stop', () => {
        if (radioPlaying) stopRadio();
      });
    } catch (e) {}

    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);
    forceRemoveSeekHandlers();
  }

  // Sobrescreve o comportamento do play button quando rádio está ativa
  function handleCtrlPlayForRadio() {
    if (radioPlaying) {
      stopRadio();
      return true;
    }
    return false;
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
