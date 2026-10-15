// Food Finder Vercel API: single-origin restaurant search with bounded upstream attempts.
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];
const RADIUS_MILES = 20;
const DEG_LAT_PER_MILE = 1 / 69.0;
const MAX_RESULTS = 8500;

function reply(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200
    ? 'public, s-maxage=300, stale-while-revalidate=600'
    : 'no-store');
  return res.status(status).json(data);
}

function validCoordinate(value, lower, upper) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= lower && num <= upper ? num : null;
}

function boundingBox(lat, lon) {
  const latDelta = RADIUS_MILES * DEG_LAT_PER_MILE;
  const lonDelta = Math.min(180, latDelta / Math.max(0.01, Math.abs(Math.cos(lat * Math.PI / 180))));
  return [Math.max(-90, lat - latDelta), Math.max(-180, lon - lonDelta),
    Math.min(90, lat + latDelta), Math.min(180, lon + lonDelta)]
    .map(n => n.toFixed(5)).join(',');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  const lat = validCoordinate(req.query.lat, -90, 90);
  const lon = validCoordinate(req.query.lon, -180, 180);
  if (lat === null || lon === null) {
    return reply(res, 400, { error: 'A valid location is required.' });
  }

  // Bounding-box lookup is typically cheaper than multiple 32-km around searches.
  // The browser enforces the original exact 20-mile circular radius afterward.
  const bbox = boundingBox(lat, lon);
  const query = `[out:json][timeout:19];(` +
    `nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream)$"]["name"](${bbox});` +
    `nwr["shop"~"^(bakery|confectionery)$"]["name"](${bbox});` +
    `);out center;`;
  const attempts = [];

  for (const endpoint of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9500);
    const server = new URL(endpoint).hostname;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json',
          'User-Agent': 'FoodFinder/1.1 (+https://github.com/prestons-code/Food-Finder-app)'
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: ctrl.signal
      });
      if (!response.ok) {
        attempts.push({ server, status: response.status });
        continue;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.elements)) {
        attempts.push({ server, error: 'Invalid JSON structure' });
        continue;
      }
      if (data.elements.length > MAX_RESULTS) {
        attempts.push({ server, error: 'Too many results' });
        continue;
      }
      return reply(res, 200, { elements: data.elements });
    } catch (error) {
      attempts.push({ server, error: error.name === 'AbortError' ? 'Timeout' : 'Network or response error' });
    } finally {
      clearTimeout(timer);
    }
  }

  console.error('Food Finder upstream Overpass failures', JSON.stringify(attempts));
  return reply(res, 503, {
    error: 'Restaurant data providers are unavailable right now. Please try again later.',
    attempts
  });
};
