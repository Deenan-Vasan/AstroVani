// Verifies the deterministic chart generator: same input -> same chart, different inputs
// -> different charts, and every chart internally consistent.
// Mirrors backend/src/services/chartGenerator.ts.

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) { failures++; console.log(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name} ${detail}`);
};

const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const NAKSHATRAS = [
  ['Ashwini','Ketu'],['Bharani','Venus'],['Krittika','Sun'],['Rohini','Moon'],['Mrigashira','Mars'],['Ardra','Rahu'],
  ['Punarvasu','Jupiter'],['Pushya','Saturn'],['Ashlesha','Mercury'],['Magha','Ketu'],['Purva Phalguni','Venus'],
  ['Uttara Phalguni','Sun'],['Hasta','Moon'],['Chitra','Mars'],['Swati','Rahu'],['Vishakha','Jupiter'],['Anuradha','Saturn'],
  ['Jyeshtha','Mercury'],['Mula','Ketu'],['Purva Ashadha','Venus'],['Uttara Ashadha','Sun'],['Shravana','Moon'],
  ['Dhanishta','Mars'],['Shatabhisha','Rahu'],['Purva Bhadrapada','Jupiter'],['Uttara Bhadrapada','Saturn'],['Revati','Mercury']
];
const VIMSHOTTARI_ORDER = ['Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury'];
const EXALTED = { Sun:'Aries', Moon:'Taurus', Mars:'Capricorn', Mercury:'Virgo', Jupiter:'Cancer', Venus:'Pisces', Saturn:'Libra' };
const DEBILITATED = { Sun:'Libra', Moon:'Scorpio', Mars:'Cancer', Mercury:'Pisces', Jupiter:'Capricorn', Venus:'Virgo', Saturn:'Aries' };
const OWN_SIGNS = { Sun:['Leo'], Moon:['Cancer'], Mars:['Aries','Scorpio'], Mercury:['Gemini','Virgo'], Jupiter:['Sagittarius','Pisces'], Venus:['Taurus','Libra'], Saturn:['Capricorn','Aquarius'] };

function hashSeed(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mod12 = n => ((n % 12) + 12) % 12;
function formatDegree(random) {
  return `${Math.floor(random() * 30)}°${String(Math.floor(random() * 60)).padStart(2, '0')}′`;
}
function strengthFor(planet, sign, random) {
  if (planet === 'Rahu' || planet === 'Ketu') return 'Node';
  if (EXALTED[planet] === sign) return 'Exalted';
  if (DEBILITATED[planet] === sign) return 'Debilitated';
  if (OWN_SIGNS[planet]?.includes(sign)) return 'Own sign';
  if (['Jupiter','Saturn','Mercury','Venus','Mars'].includes(planet) && random() < 0.22) return 'Retrograde';
  return random() < 0.45 ? 'Strong' : 'Neutral';
}
function buildChartSeed(profile) {
  return [profile.name, profile.date, profile.time, profile.place]
    .map(p => (p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
}
function generateChart(profile) {
  const random = makeRandom(hashSeed(buildChartSeed(profile) || 'astrovani-default'));
  const lagnaIndex = Math.floor(random() * 12);
  const houseOf = i => mod12(i - lagnaIndex) + 1;
  const nakshatraIndex = Math.floor(random() * NAKSHATRAS.length);
  const [nakshatraName, nakshatraLord] = NAKSHATRAS[nakshatraIndex];
  const pada = 1 + Math.floor(random() * 4);
  const moonIndex = Math.floor((nakshatraIndex * 800 + (pada - 1) * 200) / 1800) % 12;
  const sunIndex = Math.floor(random() * 12);
  const mercuryIndex = mod12(sunIndex + (Math.floor(random() * 3) - 1));
  const venusIndex = mod12(sunIndex + (Math.floor(random() * 5) - 2));
  const marsIndex = Math.floor(random() * 12);
  const jupiterIndex = Math.floor(random() * 12);
  const saturnIndex = Math.floor(random() * 12);
  const rahuIndex = Math.floor(random() * 12);
  const ketuIndex = mod12(rahuIndex + 6);
  const placements = [['Sun',sunIndex],['Moon',moonIndex],['Mars',marsIndex],['Mercury',mercuryIndex],
    ['Jupiter',jupiterIndex],['Venus',venusIndex],['Saturn',saturnIndex],['Rahu',rahuIndex],['Ketu',ketuIndex]];
  const planets = placements.map(([name, i]) => {
    const sign = SIGNS[i];
    return { name, sign, house: houseOf(i), degree: formatDegree(random), strength: strengthFor(name, sign, random) };
  });
  const startIndex = VIMSHOTTARI_ORDER.indexOf(nakshatraLord);
  const mahaOffset = Math.floor(random() * VIMSHOTTARI_ORDER.length);
  const maha = VIMSHOTTARI_ORDER[(startIndex + mahaOffset) % VIMSHOTTARI_ORDER.length];
  let antar = VIMSHOTTARI_ORDER[(startIndex + mahaOffset + 1 + Math.floor(random() * 8)) % VIMSHOTTARI_ORDER.length];
  if (antar === maha) antar = VIMSHOTTARI_ORDER[(VIMSHOTTARI_ORDER.indexOf(maha) + 1) % VIMSHOTTARI_ORDER.length];
  return { lagna: SIGNS[lagnaIndex], moonSign: SIGNS[moonIndex], nakshatra: `${nakshatraName} · Pada ${pada}`, dasha: `${maha} / ${antar}`, planets };
}

const PEOPLE = [
  { name: 'Deenan', date: '2020-01-01', time: '15:00', place: 'Madurai' },
  { name: 'Priya', date: '1992-05-14', time: '04:20', place: 'Chennai' },
  { name: 'Arjun', date: '1988-11-30', time: '22:05', place: 'Mumbai' },
  { name: 'Meera', date: '2001-07-09', time: '11:45', place: 'Kochi' },
  { name: 'Ravi', date: '1975-02-28', time: '06:15', place: 'Delhi' },
  { name: 'Sana', date: '1999-09-19', time: '19:30', place: 'Hyderabad' },
  { name: 'Vikram', date: '1983-03-03', time: '13:10', place: 'Bengaluru' },
  { name: 'Lakshmi', date: '1996-12-25', time: '02:40', place: 'Coimbatore' },
  { name: 'Imran', date: '1990-08-08', time: '17:55', place: 'Pune' },
  { name: 'Nisha', date: '2005-04-17', time: '09:25', place: 'Jaipur' }
];

console.log('\n1. Deterministic: the same details always give the same chart');
{
  for (const person of PEOPLE.slice(0, 4)) {
    const a = JSON.stringify(generateChart(person));
    const b = JSON.stringify(generateChart({ ...person }));
    check(`${person.name} is stable across calls`, a === b);
  }
  const spaced = { name: '  Deenan ', date: '2020-01-01', time: '15:00', place: 'Madurai  ' };
  check('whitespace differences do not change the chart',
    JSON.stringify(generateChart(PEOPLE[0])) === JSON.stringify(generateChart(spaced)));
  const cased = { ...PEOPLE[0], name: 'DEENAN', place: 'MADURAI' };
  check('case differences do not change the chart',
    JSON.stringify(generateChart(PEOPLE[0])) === JSON.stringify(generateChart(cased)));
}

console.log('\n2. Different people get different charts');
{
  const charts = PEOPLE.map(p => generateChart(p));
  const signatures = new Set(charts.map(c => `${c.lagna}|${c.moonSign}|${c.nakshatra}|${c.dasha}`));
  check(`all ${PEOPLE.length} sample people differ`, signatures.size === PEOPLE.length, `-> ${signatures.size} distinct`);

  // A single-character change must produce a different chart.
  const near = { ...PEOPLE[0], time: '15:01' };
  check('a one-minute birth time change alters the chart',
    JSON.stringify(generateChart(PEOPLE[0])) !== JSON.stringify(generateChart(near)));

  for (const c of charts) console.log(`        ${c.lagna.padEnd(12)} Lagna · ${c.moonSign.padEnd(11)} Moon · ${c.nakshatra.padEnd(24)} · ${c.dasha}`);
}

console.log('\n3. Every chart is internally consistent');
{
  // Sample far beyond the demo set to catch rare seeds.
  const many = Array.from({ length: 600 }, (_, i) =>
    generateChart({ name: `User${i}`, date: `19${70 + (i % 30)}-0${1 + (i % 9)}-1${i % 10}`, time: `${i % 24}:${i % 60}`, place: `City${i % 40}` }));

  let houseErrors = 0, nodeErrors = 0, mercuryErrors = 0, venusErrors = 0, dashaErrors = 0, countErrors = 0, degreeErrors = 0;
  for (const c of many) {
    const lagnaIndex = SIGNS.indexOf(c.lagna);
    if (c.planets.length !== 9) countErrors++;
    for (const p of c.planets) {
      const expected = mod12(SIGNS.indexOf(p.sign) - lagnaIndex) + 1;
      if (p.house !== expected) houseErrors++;
      if (!/^\d{1,2}°\d{2}′$/.test(p.degree)) degreeErrors++;
    }
    const find = n => c.planets.find(p => p.name === n);
    const sep = (a, b) => Math.min(mod12(a - b), mod12(b - a));
    const rahu = SIGNS.indexOf(find('Rahu').sign), ketu = SIGNS.indexOf(find('Ketu').sign);
    if (mod12(ketu - rahu) !== 6) nodeErrors++;
    const sun = SIGNS.indexOf(find('Sun').sign);
    if (sep(SIGNS.indexOf(find('Mercury').sign), sun) > 1) mercuryErrors++;
    if (sep(SIGNS.indexOf(find('Venus').sign), sun) > 2) venusErrors++;

    // The Mahadasha lord must lie on the Vimshottari cycle starting at the Nakshatra lord
    // (trivially true for a 9-cycle, but the Antardasha must differ from the Mahadasha).
    const [maha, antar] = c.dasha.split('/').map(s => s.trim());
    if (!VIMSHOTTARI_ORDER.includes(maha) || !VIMSHOTTARI_ORDER.includes(antar) || maha === antar) dashaErrors++;
  }

  check('all charts have nine planets', countErrors === 0, `-> ${countErrors} bad`);
  check('house always equals sign distance from the Lagna', houseErrors === 0, `-> ${houseErrors} mismatches across ${many.length * 9} placements`);
  check('Rahu and Ketu are always exactly opposite', nodeErrors === 0, `-> ${nodeErrors} bad`);
  check('Mercury is never more than one sign from the Sun', mercuryErrors === 0, `-> ${mercuryErrors} bad`);
  check('Venus is never more than two signs from the Sun', venusErrors === 0, `-> ${venusErrors} bad`);
  check('Mahadasha and Antardasha are valid and distinct', dashaErrors === 0, `-> ${dashaErrors} bad`);
  check('degrees are well formed', degreeErrors === 0, `-> ${degreeErrors} bad`);
}

console.log('\n4. Nakshatra stays consistent with the Moon sign and the Dasha');
{
  const many = Array.from({ length: 400 }, (_, i) => generateChart({ name: `N${i}`, date: '1990-01-01', time: `${i % 24}:00`, place: `P${i}` }));
  let lordErrors = 0, moonErrors = 0;
  for (const c of many) {
    const nakName = c.nakshatra.split('·')[0].trim();
    const entry = NAKSHATRAS.find(([n]) => n === nakName);
    if (!entry) { lordErrors++; continue; }
    if (!SIGNS.includes(c.moonSign)) moonErrors++;
    // The Moon must be in the sign its nakshatra falls in.
    const nakIndex = NAKSHATRAS.indexOf(entry);
    const pada = Number(c.nakshatra.match(/Pada (\d)/)?.[1] ?? 1);
    const expectedMoon = SIGNS[Math.floor((nakIndex * 800 + (pada - 1) * 200) / 1800) % 12];
    if (c.moonSign !== expectedMoon) moonErrors++;
  }
  check('every nakshatra name is from the canonical 27', lordErrors === 0, `-> ${lordErrors} bad`);
  check('Moon sign always matches its nakshatra', moonErrors === 0, `-> ${moonErrors} bad`);
}

console.log('\n5. Variety across the space');
{
  const many = Array.from({ length: 500 }, (_, i) => generateChart({ name: `V${i}`, date: '2000-01-01', time: '12:00', place: `Place${i}` }));
  const lagnas = new Set(many.map(c => c.lagna));
  const nakshatras = new Set(many.map(c => c.nakshatra.split('·')[0].trim()));
  const dashas = new Set(many.map(c => c.dasha));
  check('all 12 Lagnas occur', lagnas.size === 12, `-> ${lagnas.size}/12`);
  check('at least 25 of 27 nakshatras occur', nakshatras.size >= 25, `-> ${nakshatras.size}/27`);
  check('many distinct Dasha pairs occur', dashas.size >= 40, `-> ${dashas.size} distinct pairs`);
}


console.log('\n6. Nakshatra/sign boundaries (the Magha case)');
{
  // Each nakshatra's FIRST pada must land in the sign its start degree falls in.
  // Decimal-degree arithmetic put Magha (starts exactly at 0 Leo) in Cancer.
  const expected = [
    ['Ashwini', 'Aries'], ['Krittika', 'Aries'], ['Rohini', 'Taurus'], ['Mrigashira', 'Taurus'],
    ['Punarvasu', 'Gemini'], ['Pushya', 'Cancer'], ['Magha', 'Leo'], ['Uttara Phalguni', 'Leo'],
    ['Chitra', 'Virgo'], ['Vishakha', 'Libra'], ['Mula', 'Sagittarius'],
    // Uttara Ashadha starts at 266°40' - pada 1 is in Sagittarius, padas 2-4 in Capricorn.
    ['Uttara Ashadha', 'Sagittarius'],
    ['Dhanishta', 'Capricorn'], ['Purva Bhadrapada', 'Aquarius'], ['Revati', 'Pisces']
  ];
  const signFor = (nakName, pada) => {
    const i = NAKSHATRAS.findIndex(([n]) => n === nakName);
    return SIGNS[Math.floor((i * 800 + (pada - 1) * 200) / 1800) % 12];
  };
  const OLD = (nakName, pada) => {
    const i = NAKSHATRAS.findIndex(([n]) => n === nakName);
    return SIGNS[Math.floor((i * 13.3333 + (pada - 1) * 3.3333) / 30) % 12];
  };
  check('old decimal maths put Magha in Cancer', OLD('Magha', 1) === 'Cancer', '-> reproduces the boundary bug');
  for (const [nak, sign] of expected) {
    check(`${nak} pada 1 -> ${sign}`, signFor(nak, 1) === sign, signFor(nak, 1) === sign ? '' : `-> got ${signFor(nak, 1)}`);
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
