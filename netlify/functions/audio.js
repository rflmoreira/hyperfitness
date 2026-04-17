// Netlify Function - Extrai áudio do YouTube via youtube-mp36

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

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

async function getAudio(videoId) {
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
      duration: data.duration || 0
    };
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

  if (!RAPIDAPI_KEY) {
    console.error('[AUDIO] RAPIDAPI_KEY not configured');
    return makeResponse(503, { error: 'Audio service not configured. Set RAPIDAPI_KEY environment variable.' });
  }

  console.log(`[AUDIO] Fetching audio for: ${videoId}`);

  try {
    const result = await getAudio(videoId);
    if (result) {
      console.log(`[AUDIO] Success for ${videoId}`);
      return makeResponse(200, { videoId, ...result });
    }
  } catch (error) {
    console.error(`[AUDIO] Error: ${error.message}`);
  }

  return makeResponse(404, { error: 'Could not extract audio' });
};
