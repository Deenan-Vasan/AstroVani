import { z } from 'zod';
import { config } from '../config.js';

const pointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const lineSchema = z.object({
  id: z.enum(['heart_line', 'head_line', 'life_line', 'fate_line']),
  name: z.string(),
  detected: z.boolean(),
  status: z.enum(['detected', 'approximate', 'not_clear']),
  confidence: z.number().min(0).max(1),
  visibility: z.enum(['clear', 'moderate', 'partial', 'unclear']),
  observation: z.string(),
  points: z.array(pointSchema).max(24),
  traditionalReading: z.string()
});

export const palmVisionResultSchema = z.object({
  hand: z.enum(['Right', 'Left', 'Unknown']),
  confidence: z.number().min(0).max(1),
  captureQuality: z.number().min(0).max(1),
  summary: z.string(),
  analysisMode: z.literal('vision'),
  lines: z.array(lineSchema).length(4)
});

export type PalmVisionResult = z.infer<typeof palmVisionResultSchema>;

type LineId = 'heart_line' | 'head_line' | 'life_line' | 'fate_line';

type CvCandidate = {
  id: string;
  kind: LineId;
  points: Array<[number, number]>;
  cvScore: number;
  anatomicalScore: number;
  combinedScore: number;
  note?: string;
};
type RawLine = {
  id: LineId;
  name?: string;
  status?: 'detected' | 'approximate' | 'not_clear';
  detected?: boolean;
  confidence?: number;
  points?: Array<[number, number]>;
  candidateId?: string | null;
  observation?: string;
};

const READINGS: Record<LineId, string> = {
  heart_line: 'Traditionally associated with emotional expression and relationship style.',
  head_line: 'Traditionally associated with thinking style, focus and decision-making.',
  life_line: 'Traditionally associated with vitality themes; it should not be used to predict lifespan.',
  fate_line: 'Traditionally associated with direction, work and major changes in life path.'
};

const NAMES: Record<LineId, string> = {
  heart_line: 'Heart line',
  head_line: 'Head line',
  life_line: 'Life line',
  fate_line: 'Fate line'
};

function visibility(confidence: number): 'clear' | 'moderate' | 'partial' | 'unclear' {
  if (confidence >= 0.82) return 'clear';
  if (confidence >= 0.70) return 'moderate';
  if (confidence >= 0.48) return 'partial';
  return 'unclear';
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function positiveOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? clamp01(parsed) : fallback;
}

function sortAndDedupe(points: Array<[number, number]>) {
  const out: Array<[number, number]> = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const next: [number, number] = [clamp01(Number(point[0])), clamp01(Number(point[1]))];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) continue;
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(next[0] - prev[0], next[1] - prev[1]) > 0.012) out.push(next);
  }
  return out;
}

function plausible(id: LineId, points: Array<[number, number]>, thumbSide?: 'left' | 'right') {
  if (points.length < 4) return false;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX, height = maxY - minY;
  const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;

  if (thumbSide) {
    // Rectified capture: the wrist is pinned at y=0.90 and the knuckle line at
    // y=0.20-0.28, so exact anatomical bounds can be enforced. `t` is the normalized
    // distance toward the thumb, which makes the rules handedness-independent.
    const t = (x: number) => (thumbSide === 'left' ? x : 1 - x);
    const avgT = t(avgX);

    // Nothing may hug the frame edge - that is the hand silhouette, not a crease.
    if (minX < 0.04 || maxX > 0.96 || minY < 0.06 || maxY > 0.97) return false;

    if (id === 'heart_line') return width >= 0.28 && avgY >= 0.22 && avgY <= 0.40;
    if (id === 'head_line') return width >= 0.28 && avgY >= 0.34 && avgY <= 0.58;
    // The life line arcs around the thenar mound: it must stay on the thumb half and
    // reach down toward the wrist rather than cutting straight across the palm.
    if (id === 'life_line') return height >= 0.28 && avgT <= 0.46 && maxY >= 0.62 && minY <= 0.52;
    if (id === 'fate_line') return height >= 0.24 && width <= 0.30 && avgX >= 0.34 && avgX <= 0.68;
    return true;
  }

  // Unrectified fallback. Framing is not guaranteed, so these stay permissive - with one
  // hard exception: a path running along the frame edge is the boundary between hand and
  // background, not a crease. It is long, unbroken and high contrast, so the ridge search
  // prefers it over every real line; this is what previously shipped as a confident
  // vertical "Life line" down the side of the image.
  if (minX < 0.05 || maxX > 0.95 || minY < 0.04 || maxY > 0.98) return false;

  if (id === 'heart_line') return width >= 0.20 && avgY >= 0.10 && avgY <= 0.58;
  if (id === 'head_line') return width >= 0.20 && avgY >= 0.22 && avgY <= 0.76;
  if (id === 'life_line') return height >= 0.18 && minY <= 0.70 && maxY >= 0.48;
  if (id === 'fate_line') return height >= 0.14 && avgY >= 0.28 && width <= 0.58;
  return true;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('Vision model did not return JSON.');
}

function rectifiedGeometryPrompt(thumbSide: 'left' | 'right') {
  const thumb = thumbSide === 'left' ? 'LEFT' : 'RIGHT';
  const percussion = thumbSide === 'left' ? 'RIGHT' : 'LEFT';
  const near = (l: number) => (thumbSide === 'left' ? l : 1 - l).toFixed(2);
  return `
RECTIFIED CAPTURE - THIS IS IMPORTANT AND MAKES THE TASK MUCH EASIER:
The supplied images are NOT a raw camera crop. The palm has been geometrically
rectified with an affine warp built from detected hand landmarks, so anatomy is at
known coordinates:
- The wrist is at approximately (0.50, 0.90).
- The index-finger knuckle (MCP) is at approximately (${near(0.30)}, 0.20).
- The little-finger knuckle (MCP) is at approximately (${near(0.80)}, 0.28).
- The THUMB and the thenar mound are on the ${thumb} side of the image.
- The percussion edge (below the little finger) is on the ${percussion} side.
- Pixels outside the palm body have been masked to black in the candidate map. The
  fingers are almost entirely out of frame; do NOT trace finger creases.

Expected positions in this rectified space:
- heart_line: transverse, average y between 0.24 and 0.38, spanning most of the width.
- head_line: transverse, average y between 0.38 and 0.54, spanning most of the width.
- life_line: starts near the thumb web around (${near(0.22)}, 0.38), arcs around the thenar
  mound staying on the ${thumb} half, and descends toward the wrist near (${near(0.42)}, 0.90).
  It must NOT be a straight vertical line near the image edge - that is the hand
  silhouette, not a crease.
- fate_line: roughly vertical near x=${(0.53).toFixed(2)}, rising from the lower palm.

Reject any path that runs along the outer boundary of the hand.
`;
}

export async function analyzePalmWithVision(
  imageDataUrl: string,
  enhancedImageDataUrl?: string,
  creaseCandidateImageDataUrl?: string,
  cvCandidates: CvCandidate[] = [],
  thumbSide?: 'left' | 'right'
): Promise<PalmVisionResult> {
  if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is required for vision-assisted palm crease mapping.');

  const prompt = `You are a computer-vision annotation assistant for a palmistry UI demo. Analyze ONLY the visible major palm creases in the supplied cropped palm photograph(s). Do not infer health, lifespan, identity, personality, diagnosis or biometrics.
${thumbSide ? rectifiedGeometryPrompt(thumbSide) : ''}

You may receive up to THREE aligned views of the SAME palm crop: (1) the original color image, (2) a local-contrast-normalized grayscale view, and (3) a crease-candidate response map where brighter pixels indicate dark thin/curvilinear structures that MAY be palm creases. Use all available views together. The candidate map is only an image-processing aid: do not blindly trace every bright structure. Coordinates ALWAYS refer to the original image dimensions; all views share the same crop and geometry.

Return approximate centerline coordinates for these four traditional palmistry guide labels:
- heart_line: upper major transverse crease below the finger bases
- head_line: major transverse/diagonal crease across the central palm
- life_line: curved crease beginning near the thumb/index web and arcing around the thumb mound toward the wrist
- fate_line: if visibly present, a roughly vertical central crease rising from the lower palm

IMPORTANT confidence policy:
- status="detected" when the crease is clearly traceable; confidence should normally be >= 0.70.
- status="approximate" when the crease is visible enough to trace a useful approximate path but is not crisp; confidence may be 0.38-0.69. RETURN POINTS for approximate lines.
- status="not_clear" only when there is genuinely not enough visual evidence to place a useful path; points=[].
- Do NOT require perfect studio lighting. If a major crease is visibly discernible across the original/enhanced/candidate views, prefer an approximate path over returning nothing. The candidate view is direction-aware and intentionally emphasizes long dark creases; use it to locate likely centerlines, then verify against the original.
- Cross-check candidate-map ridges against the actual crease in the original photograph before assigning a named line.
- Prefer a continuous major crease over short skin texture, finger folds, jewelry edges or palm silhouette boundaries.

Coordinate contract:
- Each [x,y] point is normalized to the supplied crop: x=0 left, x=1 right, y=0 top, y=1 bottom.
- Follow the visible crease itself, in order from one end to the other.
- Return 6-18 points for detected or approximate lines.
- Do not use finger-joint creases as palm lines.
- Keep points on visible palm skin; do not trace outside the palm silhouette.

CV CANDIDATE CONTRACT:
- A list of computer-vision candidate paths may be provided as text after the images. These candidates were extracted from dark-ridge continuity and anatomical search zones.
- For each named line, prefer selecting a matching candidate when it follows the visible crease.
- Set candidateId to the selected candidate id, or null if none match.
- Do NOT select a candidate merely because its CV score is high. Verify the path against the original photograph and the anatomy definition above.
- For life_line specifically, reject a straight diagonal path through the palm center; it should arc down the thumb/thenar side.
- For fate_line, prefer a roughly central vertical path.
- If a candidate is a good approximate match, select it even when the crease is not perfectly crisp.
- observation must describe ONLY a directly visible morphology of that named crease: continuous, broken, forked, chained, or faint. If the trace is approximate/unclear or the morphology cannot be verified, return indeterminate. Never infer a break from a gap caused by glare, blur, overlay, crop, or low contrast.

Return JSON ONLY with exactly this shape:
{
  "hand":"Right|Left|Unknown",
  "confidence":0.0,
  "captureQuality":0.0,
  "summary":"brief visual-quality summary only",
  "lines":[
    {"id":"heart_line","status":"detected|approximate|not_clear","confidence":0.0,"candidateId":"string|null","observation":"continuous|broken|forked|chained|faint|indeterminate","points":[[0.0,0.0]]},
    {"id":"head_line","status":"detected|approximate|not_clear","confidence":0.0,"candidateId":"string|null","observation":"continuous|broken|forked|chained|faint|indeterminate","points":[[0.0,0.0]]},
    {"id":"life_line","status":"detected|approximate|not_clear","confidence":0.0,"candidateId":"string|null","observation":"continuous|broken|forked|chained|faint|indeterminate","points":[[0.0,0.0]]},
    {"id":"fate_line","status":"detected|approximate|not_clear","confidence":0.0,"candidateId":"string|null","observation":"continuous|broken|forked|chained|faint|indeterminate","points":[]}
  ]
}`;

  const imageContent: any[] = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
  ];
  if (enhancedImageDataUrl) {
    imageContent.push({ type: 'text', text: 'Local-contrast-normalized grayscale view of the same crop:' });
    imageContent.push({ type: 'image_url', image_url: { url: enhancedImageDataUrl, detail: 'high' } });
  }
  if (creaseCandidateImageDataUrl) {
    imageContent.push({ type: 'text', text: 'Crease-candidate response map of the same crop. Bright ridges are possible crease structures; verify them against the original before tracing:' });
    imageContent.push({ type: 'image_url', image_url: { url: creaseCandidateImageDataUrl, detail: 'high' } });
  }
  if (cvCandidates.length) {
    imageContent.push({
      type: 'text',
      text: `Computer-vision candidate paths (coordinates normalized to the original crop):\n${JSON.stringify(cvCandidates)}`
    });
  }

  const response = await fetch(config.openai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify({
      model: config.openai.visionModel,
      temperature: 0,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: imageContent }]
    })
  });

  const body = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const message = (body as any)?.error?.message || `OpenAI vision request failed (${response.status})`;
    throw new Error(message);
  }

  const content = (body as any)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenAI vision response did not contain text output.');
  const raw = JSON.parse(extractJson(content)) as {
    hand?: string;
    confidence?: number;
    captureQuality?: number;
    summary?: string;
    lines?: RawLine[];
  };

  const byId = new Map((raw.lines ?? []).map(line => [line.id, line]));
  const ids: LineId[] = ['heart_line', 'head_line', 'life_line', 'fate_line'];
  const lines = ids.map(id => {
    const candidate = byId.get(id);
    const visionConfidence = clamp01(Number(candidate?.confidence ?? 0));
    const selectedCv = candidate?.candidateId ? cvCandidates.find(c => c.id === candidate.candidateId && c.kind === id) : undefined;
    const visionPoints = sortAndDedupe(Array.isArray(candidate?.points) ? candidate!.points! : []);
    const cvPoints = selectedCv ? sortAndDedupe(selectedCv.points) : [];

    // When Vision explicitly selects a CV candidate, keep the CV centerline as the source
    // of geometry. This avoids hallucinated pixel coordinates while still letting Vision
    // classify which extracted ridge corresponds to which traditional line.
    let points = selectedCv && plausible(id, cvPoints, thumbSide) ? cvPoints : visionPoints;
    let geometryOkay = plausible(id, points, thumbSide);

    // If Vision omitted candidateId but returned not_clear, allow a strong anatomically
    // plausible CV candidate to surface as an approximate guide. This is intentionally
    // conservative and never promotes a candidate to clear without visual confirmation.
    let fallbackCv: CvCandidate | undefined;
    if (!geometryOkay || points.length < 4) {
      fallbackCv = cvCandidates
        .filter(c => c.kind === id && plausible(id, sortAndDedupe(c.points), thumbSide))
        .sort((a, b) => b.combinedScore - a.combinedScore)[0];
      // On a rectified capture `plausible()` enforces real anatomical bounds and the CV
      // response is masked to the palm body, so a surviving candidate is trustworthy at
      // a moderate score. Without rectification nothing constrains the framing, so the
      // original stricter gate is kept - that is what previously let a hand-silhouette
      // edge through as a confident "Life line".
      const gate = thumbSide ? { combined: 0.40, anatomical: 0.38 } : { combined: 0.64, anatomical: 0.62 };
      if (fallbackCv && fallbackCv.combinedScore >= gate.combined && fallbackCv.anatomicalScore >= gate.anatomical) {
        points = sortAndDedupe(fallbackCv.points);
        geometryOkay = true;
      }
    }

    const cv = selectedCv ?? fallbackCv;
    const fusedConfidence = cv
      ? clamp01(visionConfidence * 0.42 + cv.cvScore * 0.33 + cv.anatomicalScore * 0.25)
      : visionConfidence;

    let status: 'detected' | 'approximate' | 'not_clear' = 'not_clear';
    if (geometryOkay && points.length >= 4) {
      if (selectedCv && (candidate?.status === 'detected' || fusedConfidence >= 0.72)) status = 'detected';
      else if (candidate?.status === 'detected' && fusedConfidence >= 0.62) status = 'detected';
      else if (candidate?.status === 'approximate' || fusedConfidence >= (thumbSide ? 0.34 : 0.48) || (cv?.combinedScore ?? 0) >= (thumbSide ? 0.42 : 0.64)) status = 'approximate';
    }

    const drawable = status !== 'not_clear';
    return {
      id,
      name: NAMES[id],
      detected: drawable,
      status,
      confidence: drawable ? fusedConfidence : Math.min(fusedConfidence, 0.37),
      visibility: drawable ? visibility(fusedConfidence) : 'unclear' as const,
      observation: status === 'detected' && typeof candidate?.observation === 'string'
        ? candidate.observation.trim().toLowerCase()
        : 'indeterminate',
      points: drawable ? points : [],
      traditionalReading: READINGS[id]
    };
  });

  return palmVisionResultSchema.parse({
    hand: raw.hand === 'Right' || raw.hand === 'Left' ? raw.hand : 'Unknown',
    // `?? 0.75` does not catch a literal 0, which some vision responses return and which
    // surfaced in the UI as "0% capture quality" on an otherwise usable capture.
    confidence: positiveOr(raw.confidence, 0.75),
    captureQuality: positiveOr(raw.captureQuality, 0.75),
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : 'Vision-assisted crease mapping completed on the captured palm.',
    analysisMode: 'vision',
    lines
  });
}
