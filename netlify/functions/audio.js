// Netlify Function - Extrai áudio do YouTube via múltiplas APIs

const RAPIDAPI_KEY = '2dc3f9865cmshd5ff3be5f0c40d7p13483fjsn6612a71d97f0';

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

// API 1: youtube-mp36
async function tryYoutubeMp36(videoId) {
  const response = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'youtube-mp36.p.rapidapi.com'
    }
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.status === 'ok' && data.link) {
    return {
      audioUrl: data.link,
      title: data.title || '',
      duration: data.duration || 0,
      source: 'youtube-mp36'
    };
  }
  return null;
}

// API 2: youtube-mp3-downloader2
async function tryYoutubeMp3Downloader2(videoId) {
  const response = await fetch(`https://youtube-mp3-downloader2.p.rapidapi.com/ytmp3/ytmp3/?url=https://www.youtube.com/watch?v=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'youtube-mp3-downloader2.p.rapidapi.com'
    }
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.status === 'finished' && data.dlink) {
    return {
      audioUrl: data.dlink,
      title: data.title || '',
      duration: 0,
      source: 'youtube-mp3-downloader2'
    };
  }
  return null;
}

// API 3: ytstream-download-youtube-videos
async function tryYtstream(videoId) {
  const response = await fetch(`https://ytstream-download-youtube-videos.p.rapidapi.com/dl?id=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'ytstream-download-youtube-videos.p.rapidapi.com'
    }
  });

  if (!response.ok) return null;

  const data = await response.json();
  
  // Procura por formato de áudio
  if (data.status === 'OK' && data.adaptiveFormats) {
    const audioFormat = data.adaptiveFormats.find(f => 
      f.mimeType && f.mimeType.includes('audio') && f.url
    );
    if (audioFormat) {
      return {
        audioUrl: audioFormat.url,
        title: data.title || '',
        duration: data.lengthSeconds || 0,
        source: 'ytstream'
      };
    }
  }
  
  // Fallback para formats
  if (data.formats) {
    const format = data.formats.find(f => f.url);
    if (format) {
      return {
        audioUrl: format.url,
        title: data.title || '',
        duration: data.lengthSeconds || 0,
        source: 'ytstream-video'
      };
    }
  }
  
  return null;
}

// API 4: youtube-media-downloader
async function tryYoutubeMediaDownloader(videoId) {
  const response = await fetch(`https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com'
    }
  });

  if (!response.ok) return null;

  const data = await response.json();
  
  if (data.audios && data.audios.items && data.audios.items.length > 0) {
    const audio = data.audios.items[0];
    if (audio.url) {
      return {
        audioUrl: audio.url,
        title: data.title || '',
        duration: data.lengthSeconds || 0,
        source: 'youtube-media-downloader'
      };
    }
  }
  
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return makeResponse(405, { error: 'Method not allowed' });
  }

  const { v: videoId } = event.queryStringParameters || {};

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return makeResponse(400, { error: 'Invalid or missing video ID' });
  }

  console.log(`[AUDIO] Fetching audio for: ${videoId}`);

  // Tenta cada API em sequência
  const apis = [
    { name: 'youtube-mp36', fn: tryYoutubeMp36 },
    { name: 'ytstream', fn: tryYtstream },
    { name: 'youtube-mp3-downloader2', fn: tryYoutubeMp3Downloader2 },
    { name: 'youtube-media-downloader', fn: tryYoutubeMediaDownloader }
  ];

  for (const api of apis) {
    try {
      console.log(`[AUDIO] Trying ${api.name}...`);
      const result = await api.fn(videoId);
      if (result) {
        console.log(`[AUDIO] Success with ${api.name}`);
        return makeResponse(200, {
          videoId,
          ...result
        });
      }
    } catch (error) {
      console.log(`[AUDIO] ${api.name} failed:`, error.message);
    }
  }

  console.error(`[AUDIO] All APIs failed for ${videoId}`);
  return makeResponse(404, { error: 'Could not extract audio from any source' });
};
