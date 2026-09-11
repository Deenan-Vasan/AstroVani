export type PalmCvLineId = 'heart_line' | 'head_line' | 'life_line' | 'fate_line';

export type PalmCvCandidate = {
  id: string;
  kind: PalmCvLineId;
  points: Array<[number, number]>;
  cvScore: number;
  anatomicalScore: number;
  combinedScore: number;
  note: string;
};

type ResponseField = { width: number; height: number; values: Float32Array; max: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function buildResponse(source: HTMLCanvasElement, targetWidth = 320): ResponseField {
  const width = Math.min(targetWidth, source.width);
  const height = Math.max(1, Math.round(width * source.height / source.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { width, height, values: new Float32Array(width * height), max: 1 };
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    gray[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  // Remove slow lighting gradients using an integral-image local mean. Major palm
  // creases then become positive dark-ridge responses even under uneven illumination.
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const mean = (x: number, y: number, r: number) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
    const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
    const s = width + 1;
    const sum = integral[(y1 + 1) * s + x1 + 1] - integral[y0 * s + x1 + 1]
      - integral[(y1 + 1) * s + x0] + integral[y0 * s + x0];
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  const field = new Float32Array(width * height);
  let max = 1;
  const at = (x: number, y: number) => gray[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  const dirs = [
    { tx: 1, ty: 0, nx: 0, ny: 1 },
    { tx: 0, ty: 1, nx: 1, ny: 0 },
    { tx: 1, ty: 1, nx: 1, ny: -1 },
    { tx: 1, ty: -1, nx: 1, ny: 1 },
    { tx: 2, ty: 1, nx: 1, ny: -2 },
    { tx: 2, ty: -1, nx: 1, ny: 2 }
  ];
  for (let y = 8; y < height - 8; y++) {
    for (let x = 8; x < width - 8; x++) {
      const center = at(x, y);
      const localDark = Math.max(0, mean(x, y, 10) - center);
      let ridge = 0;
      for (const d of dirs) {
        const n1 = (at(x + d.nx * 2, y + d.ny * 2) + at(x - d.nx * 2, y - d.ny * 2)) * 0.5;
        const n2 = (at(x + d.nx * 5, y + d.ny * 5) + at(x - d.nx * 5, y - d.ny * 5)) * 0.5;
        const tangent = (at(x + d.tx * 3, y + d.ty * 3) + at(x - d.tx * 3, y - d.ty * 3)) * 0.5;
        const crossDark = Math.max(0, n1 * 0.7 + n2 * 0.3 - center);
        const continuity = Math.max(0, 1 - Math.abs(tangent - center) / 24);
        ridge = Math.max(ridge, crossDark * (0.65 + continuity * 0.55));
      }
      const nx = x / width, ny = y / height;
      const borderMask = nx < 0.045 || nx > 0.955 || ny < 0.045 || ny > 0.965 ? 0.08 : 1;
      const value = (ridge * 0.82 + localDark * 0.34) * borderMask;
      field[y * width + x] = value;
      max = Math.max(max, value);
    }
  }
  return { width, height, values: field, max };
}

function horizontalPath(field: ResponseField, yMinN: number, yMaxN: number, id: string, kind: PalmCvLineId) {
  const { width: w, height: h, values, max } = field;
  const x0 = Math.round(w * 0.08), x1 = Math.round(w * 0.92), stepX = 3;
  const y0 = Math.round(h * yMinN), y1 = Math.round(h * yMaxN);
  const ys = y1 - y0 + 1;
  const cols = Math.floor((x1 - x0) / stepX) + 1;
  const dp = Array.from({ length: cols }, () => new Float32Array(ys).fill(-1e9));
  const prev = Array.from({ length: cols }, () => new Int16Array(ys).fill(-1));
  for (let yi = 0; yi < ys; yi++) dp[0][yi] = values[(y0 + yi) * w + x0] / max;
  for (let c = 1; c < cols; c++) {
    const x = x0 + c * stepX;
    for (let yi = 0; yi < ys; yi++) {
      let best = -1e9, bestPrev = yi;
      for (let d = -7; d <= 7; d++) {
        const py = yi + d;
        if (py < 0 || py >= ys) continue;
        const v = dp[c - 1][py] - Math.abs(d) * 0.028 - d * d * 0.003;
        if (v > best) { best = v; bestPrev = py; }
      }
      const response = values[(y0 + yi) * w + x] / max;
      dp[c][yi] = best + response * 1.38;
      prev[c][yi] = bestPrev;
    }
  }
  let yi = 0;
  for (let i = 1; i < ys; i++) if (dp[cols - 1][i] > dp[cols - 1][yi]) yi = i;
  const dense: Array<[number, number]> = [];
  let responseSum = 0;
  for (let c = cols - 1; c >= 0; c--) {
    const x = x0 + c * stepX;
    const y = y0 + yi;
    dense.push([x / w, y / h]);
    responseSum += values[y * w + x] / max;
    yi = c > 0 ? prev[c][yi] : yi;
  }
  dense.reverse();
  const points = dense.filter((_, i) => i % Math.max(1, Math.floor(dense.length / 12)) === 0 || i === dense.length - 1);
  const avgY = points.reduce((s, p) => s + p[1], 0) / points.length;
  const spanX = points[points.length - 1][0] - points[0][0];
  const cvScore = clamp01((responseSum / cols - 0.10) / 0.52);
  const centerTarget = kind === 'heart_line' ? 0.30 : 0.47;
  const anatomicalScore = clamp01(1 - Math.abs(avgY - centerTarget) / 0.23) * clamp01(spanX / 0.65);
  return { id, kind, points, cvScore, anatomicalScore, combinedScore: cvScore * 0.62 + anatomicalScore * 0.38, note: kind === 'heart_line' ? 'upper transverse CV ridge' : 'central transverse/diagonal CV ridge' } satisfies PalmCvCandidate;
}

function verticalPath(field: ResponseField, xMinN: number, xMaxN: number, id: string, kind: PalmCvLineId, side?: 'left' | 'right') {
  const { width: w, height: h, values, max } = field;
  const y0 = Math.round(h * 0.27), y1 = Math.round(h * 0.90), stepY = 3;
  const x0 = Math.round(w * xMinN), x1 = Math.round(w * xMaxN);
  const xs = x1 - x0 + 1;
  const rows = Math.floor((y1 - y0) / stepY) + 1;
  const dp = Array.from({ length: rows }, () => new Float32Array(xs).fill(-1e9));
  const prev = Array.from({ length: rows }, () => new Int16Array(xs).fill(-1));
  for (let xi = 0; xi < xs; xi++) dp[0][xi] = values[y0 * w + x0 + xi] / max;
  for (let r = 1; r < rows; r++) {
    const y = y0 + r * stepY;
    for (let xi = 0; xi < xs; xi++) {
      let best = -1e9, bestPrev = xi;
      for (let d = -7; d <= 7; d++) {
        const px = xi + d;
        if (px < 0 || px >= xs) continue;
        const v = dp[r - 1][px] - Math.abs(d) * 0.028 - d * d * 0.003;
        if (v > best) { best = v; bestPrev = px; }
      }
      const response = values[y * w + x0 + xi] / max;
      dp[r][xi] = best + response * 1.38;
      prev[r][xi] = bestPrev;
    }
  }
  let xi = 0;
  for (let i = 1; i < xs; i++) if (dp[rows - 1][i] > dp[rows - 1][xi]) xi = i;
  const dense: Array<[number, number]> = [];
  let responseSum = 0;
  for (let r = rows - 1; r >= 0; r--) {
    const y = y0 + r * stepY;
    const x = x0 + xi;
    dense.push([x / w, y / h]);
    responseSum += values[y * w + x] / max;
    xi = r > 0 ? prev[r][xi] : xi;
  }
  dense.reverse();
  const points = dense.filter((_, i) => i % Math.max(1, Math.floor(dense.length / 12)) === 0 || i === dense.length - 1);
  const xsN = points.map(p => p[0]);
  const meanX = xsN.reduce((a, b) => a + b, 0) / xsN.length;
  const xSwing = Math.max(...xsN) - Math.min(...xsN);
  const cvScore = clamp01((responseSum / rows - 0.10) / 0.52);
  let anatomicalScore: number;
  if (kind === 'fate_line') {
    anatomicalScore = clamp01(1 - Math.abs(meanX - 0.5) / 0.28) * clamp01(1 - xSwing / 0.34);
  } else {
    const sideCenter = side === 'left' ? 0.27 : 0.73;
    // Life-line candidates should live on the thumb side and have some curvature rather
    // than becoming a straight diagonal across the middle of the palm.
    anatomicalScore = clamp01(1 - Math.abs(meanX - sideCenter) / 0.28) * clamp01((xSwing - 0.035) / 0.18 + 0.45);
  }
  return { id, kind, points, cvScore, anatomicalScore, combinedScore: cvScore * 0.62 + anatomicalScore * 0.38, note: kind === 'fate_line' ? 'central vertical CV ridge' : `${side} thumb-side curved/vertical CV ridge` } satisfies PalmCvCandidate;
}

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function applyMask(field: ResponseField, polygon: Array<[number, number]>) {
  // Zero the ridge response outside the palm body. Without this, the strongest dark
  // "line" in the frame is usually the hand's own silhouette against a bright
  // background - a long, perfectly continuous edge that the DP path tracker locks onto
  // and reports as a Life line. Finger creases above the knuckle line are excluded for
  // the same reason.
  const { width, height, values } = field;
  let max = 1;
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!pointInPolygon((x + 0.5) / width, ny, polygon)) values[i] = 0;
      else max = Math.max(max, values[i]);
    }
  }
  field.max = max;
  return field;
}

export type PalmCvOptions = {
  /** Palm-body polygon in the same normalized space as the canvas. */
  mask?: Array<[number, number]>;
  /** Which side of a rectified capture the thumb sits on. */
  thumbSide?: 'left' | 'right';
};

export function extractPalmCvCandidates(source: HTMLCanvasElement, options?: PalmCvOptions): PalmCvCandidate[] {
  let field = buildResponse(source);
  if (options?.mask?.length) field = applyMask(field, options.mask);

  // On a rectified capture these bands are anatomically meaningful: the wrist sits at
  // y=0.90 and the knuckle line at y=0.20-0.28, so the heart line genuinely lives just
  // below the knuckles and the life line genuinely hugs the thumb side.
  const rectified = Boolean(options?.thumbSide);
  const thumbLeft = options?.thumbSide !== 'right';
  const band = (a: number, b: number): [number, number] => (thumbLeft ? [a, b] : [1 - b, 1 - a]);

  const [lifeMinX, lifeMaxX] = rectified ? band(0.08, 0.46) : [0.08, 0.48];
  const [lifeAltMinX, lifeAltMaxX] = rectified ? band(0.20, 0.58) : [0.52, 0.92];
  const lifeSide: 'left' | 'right' = thumbLeft ? 'left' : 'right';

  const candidates: PalmCvCandidate[] = rectified
    ? [
      horizontalPath(field, 0.22, 0.40, 'heart-cv-1', 'heart_line'),
      horizontalPath(field, 0.36, 0.56, 'head-cv-1', 'head_line'),
      verticalPath(field, 0.38, 0.66, 'fate-cv-1', 'fate_line'),
      verticalPath(field, lifeMinX, lifeMaxX, 'life-cv-1', 'life_line', lifeSide),
      verticalPath(field, lifeAltMinX, lifeAltMaxX, 'life-cv-2', 'life_line', lifeSide)
    ]
    : [
      horizontalPath(field, 0.16, 0.42, 'heart-cv-1', 'heart_line'),
      horizontalPath(field, 0.34, 0.62, 'head-cv-1', 'head_line'),
      verticalPath(field, 0.34, 0.66, 'fate-cv-1', 'fate_line'),
      verticalPath(field, 0.08, 0.48, 'life-left-cv-1', 'life_line', 'left'),
      verticalPath(field, 0.52, 0.92, 'life-right-cv-1', 'life_line', 'right')
    ];

  return candidates
    .map(c => ({ ...c, combinedScore: clamp01(c.combinedScore) }))
    .filter(c => c.points.length >= 6 && c.cvScore >= 0.12 && !hugsFrameBorder(c.points))
    .sort((a, b) => b.combinedScore - a.combinedScore);
}

function hugsFrameBorder(points: Array<[number, number]>) {
  // A path pinned to the edge of the frame is the hand's own silhouette against the
  // background. Rejected unconditionally - including on unrectified captures, where the
  // palm mask is unavailable and this is the only defence.
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return Math.min(...xs) < 0.05 || Math.max(...xs) > 0.95
    || Math.min(...ys) < 0.04 || Math.max(...ys) > 0.98;
}
