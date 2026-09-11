// Verifies the North Indian kundli board geometry: each house centroid and sign label
// lies inside its own compartment, the houses run anticlockwise from top-centre, sign
// numbers follow the Lagna, and stacked planets stay inside their compartment.
// Mirrors frontend/src/scenes/KundliScene.tsx.

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) { failures++; console.log(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name} ${detail}`);
};

const HOUSE_CENTERS = {
  1: [200, 104], 2: [104, 40], 3: [40, 104], 4: [104, 200],
  5: [40, 296], 6: [104, 360], 7: [200, 296], 8: [296, 360],
  9: [360, 296], 10: [296, 200], 11: [360, 104], 12: [296, 40]
};
const HOUSE_SIGN_LABEL = {
  1: [200, 58], 2: [46, 26], 3: [24, 62], 4: [58, 200],
  5: [24, 338], 6: [46, 374], 7: [200, 342], 8: [354, 374],
  9: [376, 338], 10: [342, 200], 11: [376, 62], 12: [354, 26]
};
const ZODIAC = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];

/*
 * Compartment polygons, derived from the lines the SVG actually draws:
 *   square 8..392, both diagonals, and the four mid-edge lines.
 * Corner points: TL(8,8) TR(392,8) BR(392,392) BL(8,392)
 * Edge midpoints: T(200,8) R(392,200) B(200,392) L(8,200); centre C(200,200)
 * Diagonal/rhombus intersections: (104,104) (296,104) (296,296) (104,296)
 */
const HOUSE_POLYGONS = {
  1:  [[200,8],[296,104],[200,200],[104,104]],      // top kite
  2:  [[8,8],[200,8],[104,104]],                    // top-left, upper triangle
  3:  [[8,8],[104,104],[8,200]],                    // top-left, left triangle
  4:  [[8,200],[104,104],[200,200],[104,296]],      // left kite
  5:  [[8,200],[8,392],[104,296]],                  // bottom-left, left triangle
  6:  [[8,392],[200,392],[104,296]],                // bottom-left, lower triangle
  7:  [[200,392],[104,296],[200,200],[296,296]],    // bottom kite
  8:  [[200,392],[392,392],[296,296]],              // bottom-right, lower triangle
  9:  [[392,392],[392,200],[296,296]],              // bottom-right, right triangle
  10: [[392,200],[296,296],[200,200],[296,104]],    // right kite
  11: [[392,200],[392,8],[296,104]],                // top-right, right triangle
  12: [[392,8],[200,8],[296,104]]                   // top-right, upper triangle
};

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polygonArea(polygon) {
  let a = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    a += (polygon[j][0] * polygon[i][1]) - (polygon[i][0] * polygon[j][1]);
  }
  return Math.abs(a / 2);
}

console.log('\n1. Every house centroid sits inside its own compartment');
for (let h = 1; h <= 12; h++) {
  const [cx, cy] = HOUSE_CENTERS[h];
  check(`house ${h} centroid (${cx},${cy})`, pointInPolygon(cx, cy, HOUSE_POLYGONS[h]));
}

console.log('\n2. Every sign label sits inside its own compartment');
for (let h = 1; h <= 12; h++) {
  const [lx, ly] = HOUSE_SIGN_LABEL[h];
  check(`house ${h} label (${lx},${ly})`, pointInPolygon(lx, ly, HOUSE_POLYGONS[h]));
}

console.log('\n3. No centroid falls inside a DIFFERENT compartment');
{
  let strays = 0;
  for (let h = 1; h <= 12; h++) {
    const [cx, cy] = HOUSE_CENTERS[h];
    for (let other = 1; other <= 12; other++) {
      if (other === h) continue;
      if (pointInPolygon(cx, cy, HOUSE_POLYGONS[other])) { strays++; console.log(`        house ${h} centroid also inside house ${other}`); }
    }
  }
  check('compartments do not overlap at the centroids', strays === 0, `-> ${strays} strays`);
}

console.log('\n4. The twelve compartments tile the whole board');
{
  const total = Object.values(HOUSE_POLYGONS).reduce((sum, p) => sum + polygonArea(p), 0);
  const board = 384 * 384;
  check('areas sum to the full square', Math.abs(total - board) < 1, `-> ${total} vs ${board}`);
}

console.log('\n5. Houses run anticlockwise from top-centre');
{
  // Anticlockwise on screen (y down) means the angle from centre DECREASES in standard
  // maths orientation; check the sequence turns consistently the same way.
  const angle = h => {
    const [cx, cy] = HOUSE_CENTERS[h];
    return Math.atan2(-(cy - 200), cx - 200); // flip y so positive is "up"
  };
  check('house 1 is at the top', Math.abs(angle(1) - Math.PI / 2) < 0.01, `-> ${(angle(1) * 180 / Math.PI).toFixed(0)}°`);
  check('house 4 is at the left', Math.abs(Math.abs(angle(4)) - Math.PI) < 0.01, `-> ${(angle(4) * 180 / Math.PI).toFixed(0)}°`);
  check('house 7 is at the bottom', Math.abs(angle(7) + Math.PI / 2) < 0.01, `-> ${(angle(7) * 180 / Math.PI).toFixed(0)}°`);
  check('house 10 is at the right', Math.abs(angle(10)) < 0.01, `-> ${(angle(10) * 180 / Math.PI).toFixed(0)}°`);

  let monotonic = true;
  for (let h = 1; h < 12; h++) {
    // Each step should advance anticlockwise by roughly 30 degrees.
    let delta = angle(h + 1) - angle(h);
    while (delta <= 0) delta += 2 * Math.PI;
    if (delta < 0.2 || delta > 1.4) { monotonic = false; console.log(`        house ${h} -> ${h + 1} turns ${(delta * 180 / Math.PI).toFixed(0)}°`); }
  }
  check('each step advances anticlockwise by roughly one house', monotonic);
}

console.log('\n6. Sign numbers follow the Lagna');
{
  for (const lagna of ['Aries', 'Scorpio', 'Pisces']) {
    const lagnaIndex = ZODIAC.indexOf(lagna);
    const signs = Array.from({ length: 12 }, (_, i) => ZODIAC[(lagnaIndex + i) % 12]);
    check(`${lagna} Lagna: house 1 shows ${lagna}`, signs[0] === lagna);
    check(`${lagna} Lagna: house 7 is the opposite sign`, signs[6] === ZODIAC[(lagnaIndex + 6) % 12]);
    check(`${lagna} Lagna: twelve distinct signs`, new Set(signs).size === 12);
  }
}

console.log('\n7. A planet is drawn in the compartment its house says');
{
  // Sample chart: Scorpio Lagna, so house = (signIndex - 7) mod 12 + 1.
  const lagnaIndex = ZODIAC.indexOf('Scorpio');
  const planets = [
    { name: 'Sun', sign: 'Capricorn' }, { name: 'Moon', sign: 'Gemini' },
    { name: 'Mars', sign: 'Taurus' }, { name: 'Mercury', sign: 'Scorpio' },
    { name: 'Jupiter', sign: 'Virgo' }, { name: 'Venus', sign: 'Aquarius' },
    { name: 'Saturn', sign: 'Pisces' }, { name: 'Rahu', sign: 'Libra' }, { name: 'Ketu', sign: 'Aries' }
  ].map(p => ({ ...p, house: ((ZODIAC.indexOf(p.sign) - lagnaIndex + 12) % 12) + 1 }));

  let misplaced = 0;
  for (const p of planets) {
    const [cx, cy] = HOUSE_CENTERS[p.house];
    if (!pointInPolygon(cx, cy, HOUSE_POLYGONS[p.house])) misplaced++;
  }
  check('all nine planets land in their own house box', misplaced === 0, `-> ${misplaced} misplaced`);
  check('Mercury in Scorpio sits in house 1', planets.find(p => p.name === 'Mercury').house === 1);
  check('Mars in Taurus sits in house 7', planets.find(p => p.name === 'Mars').house === 7);
  for (const p of planets) console.log(`        ${p.name.padEnd(8)} ${p.sign.padEnd(12)} -> house ${String(p.house).padStart(2)} at (${HOUSE_CENTERS[p.house]})`);
}

const HOUSE_STACK = {
  1: { band: 62, bias: 8 }, 4: { band: 62, bias: 0 }, 7: { band: 62, bias: -8 }, 10: { band: 62, bias: 0 },
  2: { band: 30, bias: 12 }, 12: { band: 30, bias: 12 },
  6: { band: 30, bias: -12 }, 8: { band: 30, bias: -12 },
  3: { band: 34, bias: 0 }, 5: { band: 34, bias: 0 }, 9: { band: 34, bias: 0 }, 11: { band: 34, bias: 0 }
};

console.log('\n8. Stacked planets stay inside their compartment');
{
  // Worst case: a stellium crowded into one house. Corner triangles are the tightest,
  // and all nine grahas in one house is legal even if rare.
  let overflow = 0;
  for (let h = 1; h <= 12; h++) {
    for (let count = 1; count <= 9; count++) {
      const { band, bias } = HOUSE_STACK[h];
      const preferred = count >= 5 ? 13 : count === 4 ? 16 : count === 3 ? 19 : 22;
      const spacing = count > 1 ? Math.min(preferred, (2 * band) / (count - 1)) : 0;
      const [cx, cy] = HOUSE_CENTERS[h];
      const top = cy + bias - ((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const y = top + i * spacing;
        // Text baseline plus its ascender/descender band.
        if (!pointInPolygon(cx, y - 6, HOUSE_POLYGONS[h]) || !pointInPolygon(cx, y + 3, HOUSE_POLYGONS[h])) {
          overflow++;
          if (overflow <= 5) console.log(`        house ${h} with ${count} planets: row ${i + 1} at y=${y.toFixed(0)} escapes`);
        }
      }
    }
  }
  check('stacks of up to 9 stay in bounds for every house', overflow === 0, `-> ${overflow} overflowing rows`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
