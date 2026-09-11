import * as Astronomy from 'astronomy-engine';
import { localBirthTimeToUtc, resolveBirthLocation } from './birthLocation.js';

export type GeneratedPlanet = {
  name: string;
  sign: string;
  house: number;
  degree: string;
  strength: string;
  longitude: number;
  tropicalLongitude: number;
  retrograde: boolean;
};

export type GeneratedChart = {
  lagna: string;
  moonSign: string;
  nakshatra: string;
  dasha: string;
  planets: GeneratedPlanet[];
  calculation?: {
    mode: 'astronomical-phase-1';
    engine: string;
    ayanamsha: string;
    ayanamshaDegrees: number;
    utc: string;
    latitude: number;
    longitude: number;
    timezone: string;
    resolvedPlace: string;
    note: string;
  };
};

const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'] as const;
const NAKSHATRAS = [
  'Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu','Pushya','Ashlesha',
  'Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha',
  'Mula','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishta','Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'
] as const;
const NAK_LORDS = ['Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury'] as const;
const DASHA_YEARS: Record<string, number> = { Ketu:7, Venus:20, Sun:6, Moon:10, Mars:7, Rahu:18, Jupiter:16, Saturn:19, Mercury:17 };
const EXALTED: Record<string,string> = { Sun:'Aries', Moon:'Taurus', Mars:'Capricorn', Mercury:'Virgo', Jupiter:'Cancer', Venus:'Pisces', Saturn:'Libra' };
const DEBILITATED: Record<string,string> = { Sun:'Libra', Moon:'Scorpio', Mars:'Cancer', Mercury:'Pisces', Jupiter:'Capricorn', Venus:'Virgo', Saturn:'Aries' };
const OWN: Record<string,string[]> = { Sun:['Leo'],Moon:['Cancer'],Mars:['Aries','Scorpio'],Mercury:['Gemini','Virgo'],Jupiter:['Sagittarius','Pisces'],Venus:['Taurus','Libra'],Saturn:['Capricorn','Aquarius'] };
const norm = (n:number) => ((n % 360) + 360) % 360;
const rad = (d:number) => d * Math.PI / 180;
const deg = (r:number) => r * 180 / Math.PI;

/** Lahiri/Chitrapaksha approximation anchored near J2000. Kept explicit so it can be replaced by a certified convention later. */
function lahiriAyanamsha(date: Date) {
  const years = (date.getTime() - Date.UTC(2000,0,1,12)) / (365.2425 * 86400000);
  return 23.85675 + (50.290966 / 3600) * years + (0.0000222 / 3600) * years * years;
}

function eclipticLongitude(body: Astronomy.Body, date: Date) {
  if (body === Astronomy.Body.Sun) return norm(Astronomy.SunPosition(date).elon);
  if (body === Astronomy.Body.Moon) return norm(Astronomy.EclipticGeoMoon(date).lon);
  const vector = Astronomy.GeoVector(body, date, true);
  return norm(Astronomy.Ecliptic(vector).elon);
}

function isRetrograde(body: Astronomy.Body, date: Date) {
  if (body === Astronomy.Body.Sun || body === Astronomy.Body.Moon) return false;
  const before = eclipticLongitude(body, new Date(date.getTime() - 12*3600000));
  const after = eclipticLongitude(body, new Date(date.getTime() + 12*3600000));
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta < 0;
}

/** Mean ascending lunar node, Meeus-style polynomial; Ketu is exactly opposite. */
function meanRahuLongitude(date: Date) {
  const jd = date.getTime()/86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  return norm(125.04455501 - 1934.1361849*T + 0.0020762*T*T + T*T*T/467410 - T*T*T*T/60616000);
}

/** Tropical ascendant from local apparent sidereal angle and mean obliquity. */
function tropicalAscendant(date: Date, latitude: number, longitude: number) {
  const theta = rad(norm(Astronomy.SiderealTime(date) * 15 + longitude));
  const jd = date.getTime()/86400000 + 2440587.5;
  const T = (jd - 2451545.0)/36525;
  const eps = rad(23.43929111 - 0.013004167*T - 0.000000164*T*T + 0.000000504*T*T*T);
  const phi = rad(latitude);
  return norm(deg(Math.atan2(-Math.cos(theta), Math.sin(theta)*Math.cos(eps) + Math.tan(phi)*Math.sin(eps))) + 180);
}

function signOf(lon:number) { return SIGNS[Math.floor(norm(lon)/30)]; }
function degreeText(lon:number) {
  const d = norm(lon) % 30;
  const whole = Math.floor(d); const minutes = Math.floor((d-whole)*60);
  return `${whole}°${String(minutes).padStart(2,'0')}′`;
}
function strength(name:string, sign:string, retrograde:boolean) {
  if (name === 'Rahu' || name === 'Ketu') return 'Node';
  if (EXALTED[name] === sign) return 'Exalted';
  if (DEBILITATED[name] === sign) return 'Debilitated';
  if (OWN[name]?.includes(sign)) return 'Own sign';
  return retrograde ? 'Retrograde' : 'Neutral';
}

function currentDasha(moonLon:number, birthUtc:Date) {
  const span = 360/27;
  const nakIndex = Math.floor(norm(moonLon)/span);
  const birthLordIndex = nakIndex % 9;
  const fractionUsed = (norm(moonLon) % span) / span;
  const birthLord = NAK_LORDS[birthLordIndex];
  const balanceAtBirth = DASHA_YEARS[birthLord] * (1-fractionUsed);
  let ageYears = Math.max(0, (Date.now()-birthUtc.getTime())/(365.2425*86400000));
  let mahaIndex = birthLordIndex;
  let elapsedInMaha: number;
  if (ageYears < balanceAtBirth) {
    // The birth Mahadasha began before birth; account for the already elapsed fraction.
    elapsedInMaha = DASHA_YEARS[birthLord] - balanceAtBirth + ageYears;
  } else {
    ageYears -= balanceAtBirth;
    mahaIndex = (mahaIndex + 1) % 9;
    while (ageYears >= DASHA_YEARS[NAK_LORDS[mahaIndex]]) {
      ageYears -= DASHA_YEARS[NAK_LORDS[mahaIndex]];
      mahaIndex = (mahaIndex + 1) % 9;
    }
    elapsedInMaha = ageYears;
  }
  const maha = NAK_LORDS[mahaIndex];
  const mahaYears = DASHA_YEARS[maha];
  let antarIndex = mahaIndex;
  let cursor = 0;
  for (let i=0; i<9; i++) {
    const candidate = NAK_LORDS[antarIndex];
    const duration = mahaYears * DASHA_YEARS[candidate] / 120;
    if (elapsedInMaha < cursor + duration) return `${maha} / ${candidate}`;
    cursor += duration;
    antarIndex = (antarIndex + 1) % 9;
  }
  return `${maha} / ${maha}`;
}

export async function generateChart(profile: { name?:string; date?:string; time?:string; place?:string }): Promise<GeneratedChart> {
  if (!profile.date || !profile.time || !profile.place) throw new Error('Date, exact birth time, and birth place are required for the real chart.');
  const location = await resolveBirthLocation(profile.place);
  const utc = localBirthTimeToUtc(profile.date, profile.time, location.timezone);
  const ayanamsha = lahiriAyanamsha(utc);
  const lagnaLon = norm(tropicalAscendant(utc, location.latitude, location.longitude) - ayanamsha);
  const lagnaIndex = Math.floor(lagnaLon/30);
  const houseOf = (lon:number) => ((Math.floor(norm(lon)/30)-lagnaIndex+12)%12)+1; // whole-sign houses

  const bodies: Array<[string,Astronomy.Body]> = [
    ['Sun',Astronomy.Body.Sun],['Moon',Astronomy.Body.Moon],['Mars',Astronomy.Body.Mars],['Mercury',Astronomy.Body.Mercury],
    ['Jupiter',Astronomy.Body.Jupiter],['Venus',Astronomy.Body.Venus],['Saturn',Astronomy.Body.Saturn]
  ];
  const planets: GeneratedPlanet[] = bodies.map(([name,body]) => {
    const tropicalLongitude = eclipticLongitude(body, utc);
    const longitude = norm(tropicalLongitude - ayanamsha);
    const retrograde = isRetrograde(body, utc);
    const sign = signOf(longitude);
    return { name, sign, house:houseOf(longitude), degree:degreeText(longitude), strength:strength(name,sign,retrograde), longitude:+longitude.toFixed(6), tropicalLongitude:+tropicalLongitude.toFixed(6), retrograde };
  });
  const rahuTropical = meanRahuLongitude(utc);
  for (const [name,tropicalLongitude] of [['Rahu',rahuTropical],['Ketu',norm(rahuTropical+180)]] as Array<[string,number]>) {
    const longitude=norm(tropicalLongitude-ayanamsha); const sign=signOf(longitude);
    planets.push({ name, sign, house:houseOf(longitude), degree:degreeText(longitude), strength:'Node', longitude:+longitude.toFixed(6), tropicalLongitude:+tropicalLongitude.toFixed(6), retrograde:true });
  }
  const moon = planets.find(p=>p.name==='Moon')!;
  const nakSpan=360/27; const nakIndex=Math.floor(moon.longitude/nakSpan); const pada=Math.floor((moon.longitude%nakSpan)/(nakSpan/4))+1;
  return {
    lagna: signOf(lagnaLon), moonSign: moon.sign, nakshatra:`${NAKSHATRAS[nakIndex]} · Pada ${pada}`, dasha:currentDasha(moon.longitude,utc), planets,
    calculation:{ mode:'astronomical-phase-1', engine:'Astronomy Engine (VSOP87/NOVAS-derived models)', ayanamsha:'Lahiri/Chitrapaksha approximation', ayanamshaDegrees:+ayanamsha.toFixed(6), utc:utc.toISOString(), latitude:location.latitude, longitude:location.longitude, timezone:location.timezone, resolvedPlace:location.displayName, note:'Real astronomical positions. Whole-sign houses. Mean lunar node. Lahiri ayanamsha is an explicit approximation and should be validated against reference Vedic charts before remedy commerce.' }
  };
}

export function describeChartForPrompt(chart: GeneratedChart) {
  const placements=chart.planets.map(p=>`${p.name} ${p.sign} House ${p.house} at ${p.degree}${p.retrograde?' retrograde':''}`).join('; ');
  return `${chart.lagna} Lagna; ${chart.moonSign} Moon; ${chart.nakshatra}; ${chart.dasha}; ${placements}.`;
}
