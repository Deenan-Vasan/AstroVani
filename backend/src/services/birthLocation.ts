import tzLookup from 'tz-lookup';

export type BirthLocation = {
  query: string;
  displayName: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

const cache = new Map<string, BirthLocation>();

export async function resolveBirthLocation(place: string): Promise<BirthLocation> {
  const query = place.trim();
  if (!query) throw new Error('Birth place is required for a real birth-chart calculation.');
  const key = query.toLowerCase().replace(/\s+/g, ' ');
  const cached = cache.get(key);
  if (cached) return cached;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AstroVani/0.1 (birth-place geocoding)',
      'Accept-Language': 'en'
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Unable to geocode birth place (${response.status}).`);
  const rows = await response.json() as Array<{ lat: string; lon: string; display_name?: string }>;
  if (!rows.length) throw new Error(`Birth place could not be resolved: ${query}`);

  const latitude = Number(rows[0].lat);
  const longitude = Number(rows[0].lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Geocoder returned invalid coordinates.');

  const location: BirthLocation = {
    query,
    displayName: rows[0].display_name || query,
    latitude,
    longitude,
    timezone: tzLookup(latitude, longitude)
  };
  cache.set(key, location);
  return location;
}

/** Convert a local wall-clock birth time in an IANA timezone to a UTC Date without paid APIs. */
export function localBirthTimeToUtc(date: string, time: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match || !tm) throw new Error('Birth date/time must use YYYY-MM-DD and HH:mm (24-hour) format.');
  const target = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(tm[1]), minute: Number(tm[2]), second: Number(tm[3] || 0)
  };
  let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    const wanted = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
    const delta = wanted - rendered;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }
  return new Date(guess);
}
