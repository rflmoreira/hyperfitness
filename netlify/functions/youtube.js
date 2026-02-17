// Netlify Function - YouTube video search via scraping

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json'
};

function makeResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

async function fetchYouTubeHTML(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`YouTube fetch failed: ${response.status}`);
  }

  return response.text();
}

function parseYouTubeInitialData(html) {
  let jsonData = null;
  
  const pattern1 = /var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s;
  let match = html.match(pattern1);
  if (match) {
    try { jsonData = JSON.parse(match[1]); } catch (e) {}
  }
  
  if (!jsonData) {
    const pattern2 = /ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s;
    match = html.match(pattern2);
    if (match) {
      try { jsonData = JSON.parse(match[1]); } catch (e) {}
    }
  }
  
  if (!jsonData) {
    const startMarker = 'var ytInitialData = ';
    const startIdx = html.indexOf(startMarker);
    if (startIdx !== -1) {
      const jsonStart = startIdx + startMarker.length;
      let depth = 0, jsonEnd = jsonStart, inString = false, escapeNext = false;
      
      for (let i = jsonStart; i < html.length && i < jsonStart + 500000; i++) {
        const char = html[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (char === '\\' && inString) { escapeNext = true; continue; }
        if (char === '"' && !escapeNext) { inString = !inString; continue; }
        if (!inString) {
          if (char === '{') depth++;
          else if (char === '}') {
            depth--;
            if (depth === 0) { jsonEnd = i + 1; break; }
          }
        }
      }
      
      if (jsonEnd > jsonStart) {
        try { jsonData = JSON.parse(html.slice(jsonStart, jsonEnd)); } catch (e) {}
      }
    }
  }
  
  return jsonData;
}

async function searchYouTubePlaylists(query, limit = 10) {
  // Busca com "playlist" na query para melhorar resultados
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' playlist')}`;
  
  console.log(`[PLAYLIST SEARCH] URL: ${searchUrl}`);
  
  const html = await fetchYouTubeHTML(searchUrl);
  const jsonData = parseYouTubeInitialData(html);
  
  if (!jsonData) {
    console.error('[PLAYLIST SEARCH] Could not parse ytInitialData');
    return [];
  }

  const playlists = [];
  const seenIds = new Set();
  
  // Função recursiva para encontrar playlists em qualquer formato
  function findPlaylists(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 25 || playlists.length >= limit) return;
    
    // Formato antigo: playlistRenderer
    if (obj.playlistRenderer?.playlistId) {
      const playlist = obj.playlistRenderer;
      if (!seenIds.has(playlist.playlistId)) {
        seenIds.add(playlist.playlistId);
        
        // Tenta extrair videoCount de múltiplas fontes
        let videoCount = 0;
        
        // Fonte 1: videoCount direto
        if (playlist.videoCount) {
          videoCount = parseInt(String(playlist.videoCount).replace(/\D/g, ''), 10) || 0;
        }
        
        // Fonte 2: videoCountText
        if (!videoCount && playlist.videoCountText?.simpleText) {
          videoCount = parseInt(String(playlist.videoCountText.simpleText).replace(/\D/g, ''), 10) || 0;
        }
        
        // Fonte 3: videoCountShortText
        if (!videoCount && playlist.videoCountShortText?.simpleText) {
          videoCount = parseInt(String(playlist.videoCountShortText.simpleText).replace(/\D/g, ''), 10) || 0;
        }
        
        // Fonte 4: thumbnailText (overlay no thumbnail que mostra "100 videos")
        if (!videoCount && playlist.thumbnailText?.runs) {
          for (const run of playlist.thumbnailText.runs) {
            const match = (run.text || '').match(/(\d+)/);
            if (match) {
              videoCount = parseInt(match[1], 10);
              break;
            }
          }
        }
        
        // Fonte 5: sidebarThumbnails length ou videoCountText em runs
        if (!videoCount && playlist.videoCountText?.runs) {
          for (const run of playlist.videoCountText.runs) {
            const match = (run.text || '').match(/(\d+)/);
            if (match) {
              videoCount = parseInt(match[1], 10);
              break;
            }
          }
        }
        
        let thumbnail = '';
        if (playlist.thumbnails?.[0]?.thumbnails) {
          thumbnail = playlist.thumbnails[0].thumbnails.slice(-1)[0]?.url || '';
        } else if (playlist.thumbnail?.thumbnails) {
          thumbnail = playlist.thumbnail.thumbnails.slice(-1)[0]?.url || '';
        }
        
        let author = playlist.ownerText?.runs?.[0]?.text || playlist.shortBylineText?.runs?.[0]?.text || '';
        // Remove padrões como "X vídeos", "X videos" do author
        author = author.replace(/\d+\s*(vídeos?|videos?|músicas?|musicas?|songs?)/gi, '').trim();
        
        playlists.push({
          type: 'playlist',
          playlistId: playlist.playlistId,
          title: playlist.title?.simpleText || playlist.title?.runs?.[0]?.text || '',
          author: author,
          videoCount: videoCount,
          thumbnail: thumbnail
        });
      }
      return;
    }
    
    // Formato novo: lockupViewModel com playlistId
    if (obj.lockupViewModel) {
      const lockup = obj.lockupViewModel;
      const contentId = lockup.contentId;
      
      // Verifica se é uma playlist (começa com PL, OL, ou RD)
      if (contentId && (contentId.startsWith('PL') || contentId.startsWith('OL'))) {
        if (!seenIds.has(contentId)) {
          seenIds.add(contentId);
          
          const metadata = lockup.metadata?.lockupMetadataViewModel;
          const title = metadata?.title?.content || '';
          
          // Tenta extrair informações de várias fontes possíveis
          let subtitle = '';
          let videoCount = 0;
          
          // Tenta pegar do metadataRows
          const metadataRows = metadata?.metadata?.contentMetadataViewModel?.metadataRows || [];
          for (const row of metadataRows) {
            const parts = row.metadataParts || [];
            for (const part of parts) {
              const text = part.text?.content || '';
              if (text) {
                subtitle += (subtitle ? ' • ' : '') + text;
                // Tenta extrair número de vídeos
                const countMatch = text.match(/(\d+)/);
                if (countMatch && !videoCount) {
                  videoCount = parseInt(countMatch[1], 10);
                }
              }
            }
          }
          
          // Tenta pegar videoCount de outras fontes
          if (!videoCount && lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays) {
            const overlays = lockup.contentImage.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel.overlays;
            for (const overlay of overlays) {
              const text = overlay.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text || '';
              const match = text.match(/(\d+)/);
              if (match) {
                videoCount = parseInt(match[1], 10);
                break;
              }
            }
          }
          
          let thumbnail = '';
          const thumbUrl = lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url;
          if (thumbUrl) thumbnail = thumbUrl;
          
          // Extrai autor do subtitle - remove a parte de contagem de vídeos
          let author = subtitle.split('•')[0]?.trim() || '';
          // Remove padrões como "X vídeos", "X videos", "X músicas" do author
          author = author.replace(/\d+\s*(vídeos?|videos?|músicas?|musicas?|songs?)/gi, '').trim();
          
          playlists.push({
            type: 'playlist',
            playlistId: contentId,
            title: title,
            author: author,
            videoCount: videoCount,
            thumbnail: thumbnail
          });
        }
      }
      return;
    }
    
    // Procura por playlistId em qualquer lugar e tenta extrair info
    if (obj.playlistId && typeof obj.playlistId === 'string') {
      const pid = obj.playlistId;
      if ((pid.startsWith('PL') || pid.startsWith('OL')) && !seenIds.has(pid)) {
        seenIds.add(pid);
        
        // Tenta encontrar título e thumbnail no mesmo objeto ou pai
        let title = obj.title?.simpleText || obj.title?.runs?.[0]?.text || 
                    obj.headline?.simpleText || obj.headline?.runs?.[0]?.text || '';
        let thumbnail = '';
        if (obj.thumbnail?.thumbnails) {
          thumbnail = obj.thumbnail.thumbnails.slice(-1)[0]?.url || '';
        } else if (obj.thumbnails?.[0]?.thumbnails) {
          thumbnail = obj.thumbnails[0].thumbnails.slice(-1)[0]?.url || '';
        }
        
        if (title) {
          let author = obj.shortBylineText?.runs?.[0]?.text || obj.ownerText?.runs?.[0]?.text || '';
          // Remove padrões como "X vídeos", "X videos" do author
          author = author.replace(/\d+\s*(vídeos?|videos?|músicas?|musicas?|songs?)/gi, '').trim();
          
          playlists.push({
            type: 'playlist',
            playlistId: pid,
            title: title,
            author: author,
            videoCount: parseInt(String(obj.videoCount || '0').replace(/\D/g, ''), 10) || 0,
            thumbnail: thumbnail
          });
        }
      }
    }
    
    // Continua buscando recursivamente
    if (Array.isArray(obj)) {
      for (const item of obj) {
        findPlaylists(item, depth + 1);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key !== 'responseContext' && key !== 'trackingParams') {
          findPlaylists(obj[key], depth + 1);
        }
      }
    }
  }
  
  findPlaylists(jsonData);
  
  console.log(`[PLAYLIST SEARCH] Found ${playlists.length} playlists for "${query}"`);
  return playlists;
}

async function searchYouTube(query, limit = 50) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  
  const html = await fetchYouTubeHTML(searchUrl);
  const jsonData = parseYouTubeInitialData(html);
  
  if (!jsonData) {
    throw new Error('Could not parse YouTube response');
  }

  const contents = jsonData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const videos = [];
  
  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    
    for (const item of items) {
      const video = item.videoRenderer;
      if (video?.videoId) {
        const durationText = video.lengthText?.simpleText || '0:00';
        let durationSeconds = 0;
        const timeParts = durationText.match(/(\d+):(\d+)(?::(\d+))?/);
        if (timeParts) {
          durationSeconds = timeParts[3]
            ? parseInt(timeParts[1]) * 3600 + parseInt(timeParts[2]) * 60 + parseInt(timeParts[3])
            : parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
        }

        videos.push({
          type: 'video',
          videoId: video.videoId,
          title: video.title?.runs?.[0]?.text || '',
          author: video.ownerText?.runs?.[0]?.text || '',
          lengthSeconds: durationSeconds,
          thumbnail: video.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
        });

        if (videos.length >= limit) break;
      }
    }
    if (videos.length >= limit) break;
  }

  return videos;
}

async function getPlaylistVideos(playlistId, limit = 100) {
  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
  
  const html = await fetchYouTubeHTML(playlistUrl);
  const jsonData = parseYouTubeInitialData(html);
  
  if (!jsonData) {
    throw new Error('Could not parse YouTube playlist response');
  }

  const playlistHeader = jsonData?.header?.playlistHeaderRenderer || {};
  const playlistInfo = {
    title: playlistHeader.title?.simpleText || '',
    author: playlistHeader.ownerText?.runs?.[0]?.text || '',
    videoCount: parseInt(playlistHeader.numVideosText?.runs?.[0]?.text?.replace(/\D/g, ''), 10) || 0,
    thumbnail: playlistHeader.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
  };

  const contents = jsonData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];
  
  const videos = [];
  let continuationToken = null;
  
  // Processa os vídeos da primeira página
  for (const item of contents) {
    if (item.playlistVideoRenderer) {
      const video = item.playlistVideoRenderer;
      if (!video?.videoId) continue;
      
      const durationText = video.lengthText?.simpleText || '0:00';
      let durationSeconds = 0;
      const timeParts = durationText.match(/(\d+):(\d+)(?::(\d+))?/);
      if (timeParts) {
        durationSeconds = timeParts[3]
          ? parseInt(timeParts[1]) * 3600 + parseInt(timeParts[2]) * 60 + parseInt(timeParts[3])
          : parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
      }

      videos.push({
        videoId: video.videoId,
        title: video.title?.runs?.[0]?.text || '',
        author: video.shortBylineText?.runs?.[0]?.text || '',
        lengthSeconds: durationSeconds,
        thumbnail: video.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
      });
    } else if (item.continuationItemRenderer) {
      // Guarda o token de continuação para buscar mais vídeos
      continuationToken = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    }

    if (videos.length >= limit) break;
  }

  // Se ainda não atingiu o limite e tem continuation token, busca mais páginas
  while (videos.length < limit && continuationToken) {
    try {
      const continuationData = await fetchPlaylistContinuation(continuationToken);
      if (!continuationData) break;
      
      const continuationItems = continuationData?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
      continuationToken = null; // Reset para próxima iteração
      
      for (const item of continuationItems) {
        if (item.playlistVideoRenderer) {
          const video = item.playlistVideoRenderer;
          if (!video?.videoId) continue;
          
          const durationText = video.lengthText?.simpleText || '0:00';
          let durationSeconds = 0;
          const timeParts = durationText.match(/(\d+):(\d+)(?::(\d+))?/);
          if (timeParts) {
            durationSeconds = timeParts[3]
              ? parseInt(timeParts[1]) * 3600 + parseInt(timeParts[2]) * 60 + parseInt(timeParts[3])
              : parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
          }

          videos.push({
            videoId: video.videoId,
            title: video.title?.runs?.[0]?.text || '',
            author: video.shortBylineText?.runs?.[0]?.text || '',
            lengthSeconds: durationSeconds,
            thumbnail: video.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
          });
        } else if (item.continuationItemRenderer) {
          continuationToken = item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }

        if (videos.length >= limit) break;
      }
    } catch (e) {
      console.error('[PLAYLIST] Continuation fetch error:', e.message);
      break;
    }
  }

  return { playlistInfo, videos };
}

async function fetchPlaylistContinuation(continuationToken) {
  const apiUrl = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20241126.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      continuation: continuationToken
    })
  });

  if (!response.ok) {
    throw new Error(`Continuation fetch failed: ${response.status}`);
  }

  return response.json();
}

async function getVideoInfo(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  const html = await fetchYouTubeHTML(videoUrl);
  
  // Tenta extrair ytInitialPlayerResponse
  let playerData = null;
  const playerPattern = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s;
  let match = html.match(playerPattern);
  if (match) {
    try { playerData = JSON.parse(match[1]); } catch (e) {}
  }
  
  if (!playerData) {
    const pattern2 = /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s;
    match = html.match(pattern2);
    if (match) {
      try { playerData = JSON.parse(match[1]); } catch (e) {}
    }
  }
  
  if (!playerData) {
    throw new Error('Could not parse video info');
  }
  
  const videoDetails = playerData?.videoDetails || {};
  const lengthSeconds = parseInt(videoDetails.lengthSeconds, 10) || 0;
  
  return {
    videoId: videoId,
    title: videoDetails.title || '',
    author: videoDetails.author || '',
    lengthSeconds: lengthSeconds,
    thumbnail: videoDetails.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return makeResponse(405, { error: 'Method not allowed' });
  }

  const { action, q, limit, offset, playlistId, type, videoId } = event.queryStringParameters || {};

  try {
    if (action === 'video' && videoId) {
      const info = await getVideoInfo(videoId);
      return makeResponse(200, info);
    }
    
    if (action === 'search' && q) {
      const maxResults = Math.min(parseInt(limit, 10) || 10, 50);
      const skipResults = parseInt(offset, 10) || 0;
      const totalNeeded = skipResults + maxResults + 1;
      
      // Se type=playlists, busca apenas playlists
      if (type === 'playlists') {
        const playlists = await searchYouTubePlaylists(q, maxResults);
        return makeResponse(200, {
          videos: [],
          playlists: playlists,
          hasMore: false,
          total: playlists.length
        });
      }
      
      // Busca apenas videos (comportamento padrão)
      const videos = await searchYouTube(q, totalNeeded);
      const paginatedVideos = videos.slice(skipResults, skipResults + maxResults);
      const hasMore = videos.length > skipResults + maxResults;
      
      return makeResponse(200, {
        videos: paginatedVideos,
        playlists: [],
        hasMore: hasMore,
        total: videos.length
      });
    }
    
    if (action === 'playlist' && playlistId) {
      const maxResults = Math.min(parseInt(limit, 10) || 100, 200);
      const result = await getPlaylistVideos(playlistId, maxResults);
      return makeResponse(200, result);
    }
    
    return makeResponse(400, { error: 'Use action=search&q=query or action=playlist&playlistId=ID' });
  } catch (error) {
    console.error('YouTube error:', error);
    return makeResponse(500, { error: error.message || 'Internal error' });
  }
};
