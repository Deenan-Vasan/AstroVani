import { useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { analyzePalm } from '../api';
import type { PalmResult } from '../types';
import type { ICameraVideoTrack } from 'agora-rtc-sdk-ng';
import { extractPalmCvCandidates } from './palmCv';

export type PalmLineId = 'heart_line' | 'head_line' | 'life_line' | 'fate_line';

type PalmSceneProps = {
  focusLine?: PalmLineId;
  agoraCameraTrack?: ICameraVideoTrack | null;
  onNext: () => void;
  onAnalyzed?: (result: PalmResult) => void | Promise<void>;
};

type PalmValidation = {
  ready: boolean;
  handDetected: boolean;
  insideGuide: boolean;
  sizeOkay: boolean;
  openPalm: boolean;
  upright: boolean;
  steady: boolean;
  message: string;
};

type CaptureDebug = {
  /** Landmarks in display space, i.e. after the preview mirror is applied. */
  landmarks: Point2[];
  rectification: PalmRectification;
};

type PalmTraceStatus = 'detected' | 'approximate' | 'estimated';
type PalmPaths = Record<PalmLineId, { label: string; path: string; labelX: number; labelY: number; status: PalmTraceStatus }>;

type Point2 = { x: number; y: number };
type PalmPoint = [number, number];

type CameraQuality = {
  brightness: number;
  sharpness: number;
  lightingOkay: boolean;
  focusOkay: boolean;
  score: number;
};

type CameraInfo = {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  facingMode: string;
  continuousFocus: boolean;
};

const EMPTY_QUALITY: CameraQuality = { brightness: 0, sharpness: 0, lightingOkay: false, focusOkay: false, score: 0 };
const GUIDE = { left: 0.19, right: 0.81, top: 0.07, bottom: 0.93 };

function normalizePalmLine(name: string): PalmLineId | undefined {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'heart_line' || normalized === 'head_line' || normalized === 'life_line' || normalized === 'fate_line') return normalized;
  return undefined;
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsOf(points: NormalizedLandmark[]) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function validatePalm(points: NormalizedLandmark[], previousCenter?: { x: number; y: number }): PalmValidation {
  if (!points.length) {
    return { ready: false, handDetected: false, insideGuide: false, sizeOkay: false, openPalm: false, upright: false, steady: false, message: 'No palm detected · place one open palm inside the guide' };
  }

  const b = boundsOf(points);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const area = width * height;
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const insideGuide = b.minX > GUIDE.left && b.maxX < GUIDE.right && b.minY > GUIDE.top && b.maxY < GUIDE.bottom;
  const sizeOkay = area > 0.13 && area < 0.47 && height > 0.5;

  // Require four fingers to look extended relative to their MCP joints. This rejects fists
  // and most non-palm captures without pretending to identify palm creases.
  const wrist = points[0];
  const fingerPairs: Array<[number, number]> = [[8, 5], [12, 9], [16, 13], [20, 17]];
  const extended = fingerPairs.filter(([tip, mcp]) => distance(points[tip], wrist) > distance(points[mcp], wrist) * 1.22).length;
  const openPalm = extended >= 3;

  // Keep the wrist-to-middle-finger axis reasonably vertical so the normalized crop is stable.
  const middleMcp = points[9];
  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const angleFromVertical = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
  const upright = angleFromVertical < 32;

  const steady = previousCenter ? Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y) < 0.035 : false;
  const ready = insideGuide && sizeOkay && openPalm && upright && steady;

  let message = 'Palm ready ✓ · hold steady and capture';
  if (!insideGuide) message = 'Move your palm fully inside the highlighted area';
  else if (!sizeOkay && area <= 0.13) message = 'Move your palm closer to the camera';
  else if (!sizeOkay) message = 'Move your palm slightly farther from the camera';
  else if (!openPalm) message = 'Open your fingers and face your palm toward the camera';
  else if (!upright) message = 'Keep your palm upright';
  else if (!steady) message = 'Hold your palm steady for a moment';

  return { ready, handDetected: true, insideGuide, sizeOkay, openPalm, upright, steady, message };
}




function isLikelyMobileDevice() {
  return window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

type PalmCrop = { x: number; y: number; width: number; height: number };

// Output geometry of a captured palm. The SVG crease overlay uses a 100x125 viewBox,
// and `.captured-palm` is displayed with `object-fit: cover`, so every stage of the
// pipeline has to agree on this single 4:5 aspect ratio.
const OUTPUT_ASPECT = 4 / 5;
const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 1500;

function fitCropToAspect(crop: PalmCrop, sourceW: number, sourceH: number, targetAspect = OUTPUT_ASPECT): PalmCrop {
  // The crop is expressed in normalized [0,1] frame coordinates, but a camera frame is
  // not square (typically 16:9). Drawing a normalized box straight into a fixed-aspect
  // canvas therefore stretches the palm - a 0.56x0.66 box on a 1280x720 frame is
  // 717x475 real pixels (aspect 1.51) being squeezed into a 4:5 canvas, i.e. an ~1.9x
  // vertical stretch. Expand the deficient axis until the crop's PIXEL aspect matches
  // the output canvas, so the capture is geometrically faithful.
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = crop.width;
  let height = crop.height;

  const pixelAspect = (width * sourceW) / (height * sourceH);
  if (pixelAspect < targetAspect) width = (targetAspect * height * sourceH) / sourceW;
  else if (pixelAspect > targetAspect) height = (width * sourceW) / (targetAspect * sourceH);

  // Clamping may only shrink. Scale both axes by the same factor so the corrected
  // pixel aspect survives the clamp.
  const overflow = Math.max(width, height, 1);
  if (overflow > 1) {
    width /= overflow;
    height /= overflow;
  }

  return {
    x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
    y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
    width,
    height
  };
}

function getPalmCrop(points: NormalizedLandmark[], sourceW: number, sourceH: number): PalmCrop {
  if (points.length) {
    const palmIndices = [0, 1, 2, 5, 9, 13, 17];
    const palmPoints = palmIndices.map(i => points[i]);
    const b = boundsOf(palmPoints);
    const palmCenterX = (b.minX + b.maxX) / 2;
    const palmW = b.maxX - b.minX;
    const palmH = b.maxY - b.minY; // wrist-to-knuckle span (the palm body, excluding fingers)

    // Anchor the crop to the palm body itself rather than a symmetric zoom around
    // its center. A center-based box drifts upward into the fingers/webbing on a
    // tilted hand (the framing seen in practice). Instead: a small margin above the
    // knuckle line (just enough to keep finger bases visible for context) and a
    // larger margin below the wrist (to include the heel of the palm, where the
    // life/fate lines terminate).
    const topMargin = palmH * 0.30;
    const bottomMargin = palmH * 0.56;
    const top = b.minY - topMargin;
    const bottom = b.maxY + bottomMargin;
    const height = Math.max(0.42, bottom - top);
    const width = Math.max(0.28, palmW * 1.4);
    return fitCropToAspect({ x: palmCenterX - width / 2, y: top, width, height }, sourceW, sourceH);
  }
  // Detector fallback: keep a generous central crop. The live capture guide asks the
  // user to keep the entire palm body inside this region, while the quality gate prevents
  // an obviously blurred/overexposed frame from being accepted.
  return fitCropToAspect({ x: 0.22, y: 0.18, width: 0.56, height: 0.74 }, sourceW, sourceH);
}

function drawCrop(video: HTMLVideoElement, crop: PalmCrop, mirror: boolean, width: number, height: number) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const sourceX = Math.round(crop.x * sourceW);
  const sourceY = Math.round(crop.y * sourceH);
  const sourceCropW = Math.max(1, Math.round(crop.width * sourceW));
  const sourceCropH = Math.max(1, Math.round(crop.height * sourceH));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#070710';
  ctx.fillRect(0, 0, width, height);
  if (mirror) {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sourceX, sourceY, sourceCropW, sourceCropH, 0, 0, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(video, sourceX, sourceY, sourceCropW, sourceCropH, 0, 0, width, height);
  }
  return canvas;
}

// Native-resolution crop: no resampling at all. The burst frames are fused at native
// pixel scale and only the fused result is resized (once, with Lanczos), so we never
// stack a bilinear upscale on top of another bilinear upscale.
function drawCropNative(video: HTMLVideoElement, crop: PalmCrop, mirror: boolean) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  return drawCrop(video, crop, mirror, Math.max(1, Math.round(crop.width * sourceW)), Math.max(1, Math.round(crop.height * sourceH)));
}

function drawPalmFrame(video: HTMLVideoElement, points: NormalizedLandmark[], manualFallback: boolean, mirror: boolean, width = 960, height = 1200) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  return drawCrop(video, getPalmCrop(points, sourceW, sourceH), mirror, width, height);
}

/* ------------------------------------------------------------------------------
   Palm rectification.

   An axis-aligned crop leaves the palm at whatever angle, scale and position the
   user happened to hold it, so "the upper third of the image" is not reliably the
   region above the heart line. Instead we solve an affine transform that maps three
   MediaPipe landmarks (wrist, index MCP, little-finger MCP) onto fixed canonical
   positions. After the warp the palm is always upright and scale-normalized, which
   means the CV search bands, the anatomical plausibility checks and the estimated
   line templates can all be expressed as constants in one shared coordinate space.
   ------------------------------------------------------------------------------ */

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

type PalmRectification = {
  transform: Affine; // display-normalized -> canonical-normalized
  mirror: boolean;
  thumbSide: 'left' | 'right';
  nativeWidth: number;
  nativeHeight: number;
};

// Canonical landmark targets, expressed in the 4:5 output space. The thumb is always
// adjacent to the index finger, so in this base layout the thenar mound occupies the
// region left of x=0.30 and the percussion edge is right of x=0.80.
const CANONICAL_WRIST: Point2 = { x: 0.50, y: 0.90 };
const CANONICAL_INDEX_MCP: Point2 = { x: 0.30, y: 0.20 };
const CANONICAL_PINKY_MCP: Point2 = { x: 0.80, y: 0.28 };

// Generous palm-body outline in canonical space: everything above the knuckle line
// (the fingers) and everything beyond the hand silhouette is excluded.
const CANONICAL_PALM_POLYGON: Array<[number, number]> = [
  [0.22, 0.14], [0.86, 0.22], [0.93, 0.50], [0.80, 0.86],
  [0.52, 0.99], [0.28, 0.94], [0.07, 0.64], [0.09, 0.32]
];

const flipX = (p: Point2): Point2 => ({ x: 1 - p.x, y: p.y });

function signedArea(a: Point2, b: Point2, c: Point2) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

function solveAffine(src: [Point2, Point2, Point2], dst: [Point2, Point2, Point2]): Affine | null {
  const [p1, p2, p3] = src;
  const det = (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const solve = (u1: number, u2: number, u3: number) => {
    const a = ((u2 - u1) * (p3.y - p1.y) - (u3 - u1) * (p2.y - p1.y)) / det;
    const c = ((u3 - u1) * (p2.x - p1.x) - (u2 - u1) * (p3.x - p1.x)) / det;
    return { a, c, e: u1 - a * p1.x - c * p1.y };
  };
  const x = solve(dst[0].x, dst[1].x, dst[2].x);
  const y = solve(dst[0].y, dst[1].y, dst[2].y);
  return { a: x.a, c: x.c, e: x.e, b: y.a, d: y.c, f: y.e };
}

export function applyAffine(t: Affine, p: Point2): Point2 {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

// Landmarks arrive in unmirrored video coordinates; the preview and capture are
// mirrored for a front-facing camera. Everything downstream works in display space.
function toDisplaySpace(p: NormalizedLandmark, mirror: boolean): Point2 {
  return { x: mirror ? 1 - p.x : p.x, y: p.y };
}

function buildPalmRectification(
  points: NormalizedLandmark[],
  mirror: boolean,
  sourceW: number,
  sourceH: number
): PalmRectification | null {
  if (points.length < 21) return null;
  const wrist = toDisplaySpace(points[0], mirror);
  const indexMcp = toDisplaySpace(points[5], mirror);
  const pinkyMcp = toDisplaySpace(points[17], mirror);

  const observed = signedArea(wrist, indexMcp, pinkyMcp);
  if (!Number.isFinite(observed) || Math.abs(observed) < 1e-5) return null;

  // Pick the canonical layout whose winding matches the observed hand, so the solved
  // transform is a pure rotate/scale/shear and never a reflection. Reflecting would
  // render the captured palm flipped relative to the live preview the user just saw.
  let target: [Point2, Point2, Point2] = [CANONICAL_WRIST, CANONICAL_INDEX_MCP, CANONICAL_PINKY_MCP];
  let thumbSide: 'left' | 'right' = 'left';
  if (Math.sign(signedArea(target[0], target[1], target[2])) !== Math.sign(observed)) {
    target = [flipX(target[0]), flipX(target[1]), flipX(target[2])];
    thumbSide = 'right';
  }

  const transform = solveAffine([wrist, indexMcp, pinkyMcp], target);
  if (!transform) return null;

  // Sample the warp at roughly the source pixel density: the rectification itself is
  // then near-lossless, and the single Lanczos pass afterwards handles the resize.
  const spanPx = Math.hypot((indexMcp.x - wrist.x) * sourceW, (indexMcp.y - wrist.y) * sourceH);
  const canonicalSpan = Math.hypot((target[1].x - target[0].x) * OUTPUT_ASPECT, target[1].y - target[0].y) || 0.72;
  const nativeHeight = Math.round(Math.max(600, Math.min(2000, spanPx / canonicalSpan)));

  return {
    transform,
    mirror,
    thumbSide,
    nativeWidth: Math.round(nativeHeight * OUTPUT_ASPECT),
    nativeHeight
  };
}

function drawRectifiedPalm(video: HTMLVideoElement, rect: PalmRectification, outW: number, outH: number) {
  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#070710';
  ctx.fillRect(0, 0, outW, outH);

  // Compose three stages into the single canvas matrix:
  //   video pixels -> display-normalized (applying mirror) -> canonical -> canvas px.
  const A = rect.transform;
  const m = rect.mirror ? -1 : 1;
  const t = rect.mirror ? 1 : 0;
  ctx.setTransform(
    (A.a * m * outW) / sourceW,
    (A.b * m * outH) / sourceW,
    (A.c * outW) / sourceH,
    (A.d * outH) / sourceH,
    (A.a * t + A.e) * outW,
    (A.b * t + A.f) * outH
  );
  ctx.drawImage(video, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

export function palmPolygonFor(thumbSide: 'left' | 'right'): Array<[number, number]> {
  return thumbSide === 'left'
    ? CANONICAL_PALM_POLYGON
    : CANONICAL_PALM_POLYGON.map(([x, y]) => [1 - x, y] as [number, number]);
}

export function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Zero out everything outside the palm body. Applied to the crease-candidate images
// sent to the vision model so hand-silhouette edges and finger creases are not even
// visible as candidate structures.
function maskCanvasToPalm(source: HTMLCanvasElement, thumbSide: 'left' | 'right') {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  const polygon = palmPolygonFor(thumbSide);
  const w = source.width;
  const h = source.height;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      if (pointInPolygon((x + 0.5) / w, ny, polygon)) continue;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);
  return source;
}

function measureCanvasQuality(source: HTMLCanvasElement): CameraQuality {
  const probe = document.createElement('canvas');
  probe.width = 180;
  probe.height = 225;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return EMPTY_QUALITY;
  ctx.drawImage(source, 0, 0, probe.width, probe.height);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  const lum = new Float32Array(probe.width * probe.height);
  let sum = 0;
  let dark = 0;
  let blown = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = y;
    sum += y;
    if (y < 35) dark++;
    if (y > 238) blown++;
  }
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < probe.height - 1; y += 2) {
    for (let x = 1; x < probe.width - 1; x += 2) {
      const i = y * probe.width + x;
      const gx = Math.abs(lum[i + 1] - lum[i - 1]);
      const gy = Math.abs(lum[i + probe.width] - lum[i - probe.width]);
      edgeSum += gx + gy;
      edgeCount++;
    }
  }
  const brightness = sum / lum.length;
  const sharpness = edgeCount ? edgeSum / edgeCount : 0;
  const darkRatio = dark / lum.length;
  const blownRatio = blown / lum.length;
  const lightingOkay = brightness >= 55 && brightness <= 215 && darkRatio < 0.18 && blownRatio < 0.18;
  // Mean two-axis local edge energy. A close, out-of-focus webcam palm usually falls
  // below ~6, while readable skin creases typically produce >7-8 on this 180x225 probe.
  const focusOkay = sharpness >= 6.0;
  const focusScore = Math.max(0, Math.min(1, (sharpness - 3.5) / 8.5));
  const lightScore = Math.max(0, 1 - Math.abs(brightness - 135) / 125) * (1 - Math.min(0.8, darkRatio + blownRatio));
  return { brightness, sharpness, lightingOkay, focusOkay, score: focusScore * 0.68 + lightScore * 0.32 };
}

function sleep(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms));
}

function lanczosKernel(x: number, a: number) {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function lanczosWeights(srcSize: number, dstSize: number, a: number) {
  const scale = dstSize / srcSize;
  // When downscaling the kernel has to widen in source space; when upscaling it stays
  // at its natural width. This is the standard Lanczos resize formulation.
  const support = scale < 1 ? a / scale : a;
  const step = scale < 1 ? scale : 1;
  const indices: Int32Array[] = [];
  const weights: Float32Array[] = [];
  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.ceil(center - support));
    const end = Math.min(srcSize - 1, Math.floor(center + support));
    const count = Math.max(1, end - start + 1);
    const idx = new Int32Array(count);
    const wts = new Float32Array(count);
    let sum = 0;
    for (let k = 0; k < count; k++) {
      const s = Math.min(srcSize - 1, start + k);
      const w = lanczosKernel((s - center) * step, a);
      idx[k] = s;
      wts[k] = w;
      sum += w;
    }
    if (sum !== 0) for (let k = 0; k < count; k++) wts[k] /= sum;
    indices.push(idx);
    weights.push(wts);
  }
  return { indices, weights };
}

function resampleLanczos(source: HTMLCanvasElement, dstW: number, dstH: number, a = 3) {
  // Separable Lanczos-3. Browser `drawImage` upscaling is bilinear, which turns a
  // cropped 720p/1080p palm into mush; Lanczos preserves crease edges far better.
  // Running the two passes separately keeps this at ~7 taps per axis instead of 49
  // taps per output pixel.
  const srcW = source.width;
  const srcH = source.height;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  const output = document.createElement('canvas');
  output.width = dstW;
  output.height = dstH;
  const octx = output.getContext('2d', { willReadFrequently: true });
  if (!sctx || !octx || !srcW || !srcH) return source;

  const src = sctx.getImageData(0, 0, srcW, srcH).data;
  const horizontal = lanczosWeights(srcW, dstW, a);
  const tmp = new Float32Array(dstW * srcH * 3);
  for (let y = 0; y < srcH; y++) {
    const rowOffset = y * srcW * 4;
    for (let x = 0; x < dstW; x++) {
      const idx = horizontal.indices[x];
      const wts = horizontal.weights[x];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < idx.length; k++) {
        const o = rowOffset + idx[k] * 4;
        const w = wts[k];
        r += src[o] * w;
        g += src[o + 1] * w;
        b += src[o + 2] * w;
      }
      const t = (y * dstW + x) * 3;
      tmp[t] = r;
      tmp[t + 1] = g;
      tmp[t + 2] = b;
    }
  }

  const vertical = lanczosWeights(srcH, dstH, a);
  const image = octx.createImageData(dstW, dstH);
  const dst = image.data;
  for (let y = 0; y < dstH; y++) {
    const idx = vertical.indices[y];
    const wts = vertical.weights[y];
    for (let x = 0; x < dstW; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < idx.length; k++) {
        const t = (idx[k] * dstW + x) * 3;
        const w = wts[k];
        r += tmp[t] * w;
        g += tmp[t + 1] * w;
        b += tmp[t + 2] * w;
      }
      const o = (y * dstW + x) * 4;
      dst[o] = Math.max(0, Math.min(255, r));
      dst[o + 1] = Math.max(0, Math.min(255, g));
      dst[o + 2] = Math.max(0, Math.min(255, b));
      dst[o + 3] = 255;
    }
  }
  octx.putImageData(image, 0, 0);
  return output;
}


function fusePalmCanvases(frames: HTMLCanvasElement[]) {
  if (!frames.length) return null;
  if (frames.length === 1) return frames[0];
  const width = frames[0].width;
  const height = frames[0].height;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const out = output.getContext('2d', { willReadFrequently: true });
  if (!out) return frames[0];

  // Median fusion keeps crease edges from the sharpest frames while rejecting single-frame
  // sensor noise. We only fuse the best three frames, captured within a very short burst.
  const sample = frames.slice(0, 3).map(frame => {
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    return ctx?.getImageData(0, 0, width, height);
  }).filter(Boolean) as ImageData[];
  if (sample.length < 2) return frames[0];
  const fused = out.createImageData(width, height);
  const vals = new Array<number>(sample.length);
  for (let i = 0; i < fused.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      for (let f = 0; f < sample.length; f++) vals[f] = sample[f].data[i + channel];
      vals.sort((a, b) => a - b);
      fused.data[i + channel] = vals[Math.floor(vals.length / 2)];
    }
    fused.data[i + 3] = 255;
  }
  out.putImageData(fused, 0, 0);
  return output;
}

async function captureNativeStill(track: MediaStreamTrack, points: NormalizedLandmark[], manualFallback: boolean, mirror: boolean) {
  const ImageCaptureCtor = (window as any).ImageCapture;
  if (!ImageCaptureCtor || track.readyState !== 'live') return null;
  try {
    const capture = new ImageCaptureCtor(track);
    const blob: Blob = await capture.takePhoto();
    const bitmap = await createImageBitmap(blob);
    const crop = getPalmCrop(points, bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { bitmap.close(); return null; }
    const sx = Math.round(crop.x * bitmap.width);
    const sy = Math.round(crop.y * bitmap.height);
    const sw = Math.max(1, Math.round(crop.width * bitmap.width));
    const sh = Math.max(1, Math.round(crop.height * bitmap.height));
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch (error) {
    console.warn('[Palmistry] Native still capture unavailable; using best video frame', error);
    return null;
  }
}


async function capturePalmFromAgoraTrack(
  track: MediaStreamTrack | undefined,
  points: NormalizedLandmark[],
  manualFallback: boolean,
  mirror: boolean
) {
  // Palm capture deliberately consumes the already-running Agora camera source.
  // It never disables/stops the Agora ICameraVideoTrack and never opens a competing
  // getUserMedia session on the same physical camera. This keeps the published user
  // video uninterrupted while Palmistry captures a 720p source frame for analysis.
  if (!track || track.readyState !== 'live') return null;
  const settings = track.getSettings?.() ?? {};

  // ImageCapture on a cloned track can still trigger device-specific renegotiation on
  // some browsers, so use the live video frames instead. The short burst/fusion path
  // below preserves the Agora camera session and gives CV several sharp frames.
  return { settings };
}

function enhancePalmCanvas(source: HTMLCanvasElement) {
  // Analysis-only local contrast enhancement. The original capture remains unchanged
  // for display; this aligned grayscale view is only sent to the vision analyzer.
  const workW = Math.min(720, source.width);
  const workH = Math.round(workW * source.height / source.width);
  const work = document.createElement('canvas');
  work.width = workW;
  work.height = workH;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source.toDataURL('image/jpeg', 0.94);
  ctx.drawImage(source, 0, 0, workW, workH);
  const image = ctx.getImageData(0, 0, workW, workH);
  const data = image.data;
  const lum = new Float32Array(workW * workH);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const integral = new Float64Array((workW + 1) * (workH + 1));
  for (let y = 0; y < workH; y++) {
    let row = 0;
    for (let x = 0; x < workW; x++) {
      row += lum[y * workW + x];
      integral[(y + 1) * (workW + 1) + x + 1] = integral[y * (workW + 1) + x + 1] + row;
    }
  }
  const localMean = (x: number, y: number, radius: number) => {
    const x0 = Math.max(0, x - radius), x1 = Math.min(workW - 1, x + radius);
    const y0 = Math.max(0, y - radius), y1 = Math.min(workH - 1, y + radius);
    const stride = workW + 1;
    const sum = integral[(y1 + 1) * stride + x1 + 1] - integral[y0 * stride + x1 + 1]
      - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0];
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  for (let y = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++) {
      const p = y * workW + x;
      // Remove slow illumination variation, then strengthen shallow local creases.
      const normalized = 132 + (lum[p] - localMean(x, y, 12)) * 2.15;
      const gamma = 255 * Math.pow(Math.max(0, Math.min(1, normalized / 255)), 0.92);
      const v = Math.max(0, Math.min(255, (gamma - 128) * 1.28 + 128));
      const i = p * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const enhanced = document.createElement('canvas');
  enhanced.width = source.width;
  enhanced.height = source.height;
  const out = enhanced.getContext('2d');
  if (!out) return work.toDataURL('image/jpeg', 0.95);
  out.imageSmoothingEnabled = true;
  out.drawImage(work, 0, 0, source.width, source.height);
  return enhanced.toDataURL('image/jpeg', 0.96);
}

function boxBlurChannel(src: Float32Array, w: number, h: number, radius: number) {
  // Separable box blur (horizontal pass then vertical pass) using a sliding sum.
  // This approximates a gaussian blur cheaply enough to run on a full-resolution
  // capture at interaction time.
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[rowOffset + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[rowOffset + x] = sum / windowSize;
      const nextX = x + radius + 1;
      const prevX = x - radius;
      sum += src[rowOffset + Math.min(w - 1, nextX)] - src[rowOffset + Math.max(0, prevX)];
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / windowSize;
      const nextY = y + radius + 1;
      const prevY = y - radius;
      sum += tmp[Math.min(h - 1, nextY) * w + x] - tmp[Math.max(0, prevY) * w + x];
    }
  }
  return out;
}

function claheLuma(lum: Float32Array, w: number, h: number, tilesX = 8, tilesY = 10, clipLimit = 2.6) {
  // Contrast Limited Adaptive Histogram Equalization on the luminance channel.
  // Plain global equalization blows out skin tone; CLAHE lifts local crease contrast
  // while the clip limit stops flat skin regions from turning into amplified noise.
  const bins = 256;
  const tileW = Math.ceil(w / tilesX);
  const tileH = Math.ceil(h / tilesY);
  const maps: Float32Array[] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW, x1 = Math.min(w, x0 + tileW);
      const y0 = ty * tileH, y1 = Math.min(h, y0 + tileH);
      const hist = new Float32Array(bins);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.max(0, Math.min(255, Math.round(lum[y * w + x])))] += 1;
          count += 1;
        }
      }
      const map = new Float32Array(bins);
      if (!count) {
        for (let i = 0; i < bins; i++) map[i] = i;
        maps.push(map);
        continue;
      }
      const limit = Math.max(1, (clipLimit * count) / bins);
      let excess = 0;
      for (let i = 0; i < bins; i++) {
        if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
      }
      const share = excess / bins;
      let cumulative = 0;
      for (let i = 0; i < bins; i++) {
        cumulative += hist[i] + share;
        map[i] = (cumulative / count) * 255;
      }
      maps.push(map);
    }
  }

  // Bilinear blend between the four surrounding tile mappings so tile seams do not
  // show up as blocky rectangles across the palm.
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(tilesY - 1, Math.max(0, (y - tileH / 2) / tileH));
    const ty0 = Math.floor(fy);
    const ty1 = Math.min(tilesY - 1, ty0 + 1);
    const wy = fy - ty0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tilesX - 1, Math.max(0, (x - tileW / 2) / tileW));
      const tx0 = Math.floor(fx);
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const wx = fx - tx0;
      const v = Math.max(0, Math.min(255, Math.round(lum[y * w + x])));
      const a = maps[ty0 * tilesX + tx0][v];
      const b = maps[ty0 * tilesX + tx1][v];
      const c = maps[ty1 * tilesX + tx0][v];
      const d = maps[ty1 * tilesX + tx1][v];
      out[y * w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return out;
}

function enhancePalmCanvasForDisplay(source: HTMLCanvasElement) {
  // Display-only enhancement: CLAHE for local crease contrast, then a multi-scale
  // unsharp mask. Keeps full color (unlike the grayscale analysis enhancement) and
  // recovers the crease definition that a cropped, upscaled camera frame loses. The
  // image sent to the backend for vision analysis is untouched by this function.
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source.toDataURL('image/jpeg', 0.96);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const n = w * h;

  const lum = new Float32Array(n);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const equalized = claheLuma(lum, w, h);

  // Fine radius sharpens the crease edge itself; the broad radius restores the tonal
  // separation between a crease valley and the surrounding skin.
  const fineRadius = Math.max(1, Math.round(Math.min(w, h) / 420));
  const broadRadius = Math.max(3, Math.round(Math.min(w, h) / 110));
  const fine = boxBlurChannel(equalized, w, h, fineRadius);
  const broad = boxBlurChannel(equalized, w, h, broadRadius);

  for (let p = 0; p < n; p++) {
    const base = equalized[p];
    const target = Math.max(0, Math.min(255, base + (base - fine[p]) * 0.85 + (base - broad[p]) * 0.45));
    const original = lum[p];
    const i = p * 4;
    if (original < 1) {
      data[i] = data[i + 1] = data[i + 2] = target;
      continue;
    }
    // Preserve hue by scaling RGB against the luminance change, with a mild pull
    // toward neutral so the boosted contrast does not amplify chroma noise.
    const ratio = target / original;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, data[i + c] * ratio * 0.86 + target * 0.14));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

function makeCreaseCandidateCanvas(source: HTMLCanvasElement, thumbSide?: 'left' | 'right') {
  // Analysis-only, multi-scale black-hat-like map. Brighter pixels mean "possible dark
  // curvilinear structure"; the vision model must verify these ridges against the original.
  const w = Math.min(640, source.width);
  const h = Math.round(w * source.height / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
    gray[p] = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
  }

  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const mean = (x: number, y: number, r: number) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const stride = w + 1;
    return (integral[(y1 + 1) * stride + x1 + 1] - integral[y0 * stride + x1 + 1]
      - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0])
      / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  const response = new Float32Array(w * h);
  let maxResponse = 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const fine = Math.max(0, mean(x, y, 4) - gray[p]);
      const medium = Math.max(0, mean(x, y, 9) - gray[p]);
      const broad = Math.max(0, mean(x, y, 18) - gray[p]);
      const gx = Math.abs(gray[p + 1] - gray[p - 1]);
      const gy = Math.abs(gray[p + w] - gray[p - w]);
      const value = Math.max(fine * 1.15, medium, broad * 0.72) + Math.min(16, (gx + gy) * 0.18);
      response[p] = value;
      maxResponse = Math.max(maxResponse, value);
    }
  }

  const output = ctx.createImageData(w, h);
  const scale = Math.max(18, maxResponse * 0.72);
  for (let p = 0; p < response.length; p++) {
    const n = Math.max(0, Math.min(1, response[p] / scale));
    const v = Math.round(Math.pow(n, 0.72) * 255);
    const i = p * 4;
    output.data[i] = output.data[i + 1] = output.data[i + 2] = v;
    output.data[i + 3] = 255;
  }
  ctx.putImageData(output, 0, 0);
  if (thumbSide) maskCanvasToPalm(canvas, thumbSide);
  return canvas.toDataURL('image/png');
}


function makeDirectionalCreaseCanvas(source: HTMLCanvasElement, thumbSide?: 'left' | 'right') {
  // Direction-aware dark-line response. A true crease should stay dark along its tangent
  // while being darker than nearby pixels across the line. This is substantially more
  // selective than a generic edge map and suppresses broad illumination gradients.
  const w = Math.min(720, source.width);
  const h = Math.round(w * source.height / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) gray[p] = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];

  const response = new Float32Array(w * h);
  let maxR = 1;
  const dirs = [
    { tx: 1, ty: 0, nx: 0, ny: 1 },
    { tx: 0, ty: 1, nx: 1, ny: 0 },
    { tx: 1, ty: 1, nx: 1, ny: -1 },
    { tx: 1, ty: -1, nx: 1, ny: 1 }
  ];
  const at = (x: number, y: number) => gray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 8; y < h - 8; y++) {
    for (let x = 8; x < w - 8; x++) {
      const center = at(x, y);
      let best = 0;
      for (const d of dirs) {
        const acrossNear = (at(x + d.nx * 3, y + d.ny * 3) + at(x - d.nx * 3, y - d.ny * 3)) * 0.5;
        const acrossFar = (at(x + d.nx * 6, y + d.ny * 6) + at(x - d.nx * 6, y - d.ny * 6)) * 0.5;
        const along = (at(x + d.tx * 4, y + d.ty * 4) + at(x - d.tx * 4, y - d.ty * 4)) * 0.5;
        const darkness = Math.max(0, (acrossNear * 0.65 + acrossFar * 0.35) - center);
        const continuity = Math.max(0, 16 - Math.abs(along - center));
        best = Math.max(best, darkness * (0.72 + continuity / 32));
      }
      // Suppress image borders and the very top/bottom where crop edges often look like creases.
      const nx = x / w, ny = y / h;
      const mask = nx < 0.06 || nx > 0.94 || ny < 0.05 || ny > 0.96 ? 0.12 : 1;
      const value = best * mask;
      response[y * w + x] = value;
      maxR = Math.max(maxR, value);
    }
  }
  const out = ctx.createImageData(w, h);
  const scale = Math.max(10, maxR * 0.58);
  for (let p = 0; p < response.length; p++) {
    const n = Math.max(0, Math.min(1, response[p] / scale));
    const v = Math.round(Math.pow(n, 0.62) * 255);
    const i = p * 4;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  if (thumbSide) maskCanvasToPalm(canvas, thumbSide);
  return canvas.toDataURL('image/png');
}

function smoothPath(points: Array<[number, number]>) {
  if (points.length < 2) return '';
  const scaled = points.map(([x, y]) => ({ x: x * 100, y: y * 125 }));
  if (scaled.length === 2) return `M${scaled[0].x.toFixed(1)} ${scaled[0].y.toFixed(1)} L${scaled[1].x.toFixed(1)} ${scaled[1].y.toFixed(1)}`;

  // Catmull-Rom -> cubic Bezier. This follows the returned crease points smoothly
  // instead of connecting them with artificial straight segments.
  let d = `M${scaled[0].x.toFixed(1)} ${scaled[0].y.toFixed(1)}`;
  for (let i = 0; i < scaled.length - 1; i++) {
    const p0 = scaled[Math.max(0, i - 1)];
    const p1 = scaled[i];
    const p2 = scaled[i + 1];
    const p3 = scaled[Math.min(scaled.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Anatomical templates in canonical (rectified) palm space. Because rectification
// pins the wrist and both outer MCP joints to fixed positions, these are plain
// constants rather than a projection - the only variable left is which side the
// thumb is on.
const ESTIMATED_LINE_TEMPLATES: Record<PalmLineId, Array<[number, number]>> = {
  heart_line: [[0.88, 0.34], [0.76, 0.30], [0.62, 0.285], [0.48, 0.29], [0.36, 0.31], [0.28, 0.34]],
  head_line: [[0.20, 0.40], [0.34, 0.425], [0.48, 0.45], [0.62, 0.465], [0.75, 0.475], [0.86, 0.48]],
  life_line: [[0.22, 0.38], [0.18, 0.48], [0.19, 0.60], [0.24, 0.72], [0.32, 0.83], [0.42, 0.92]],
  fate_line: [[0.52, 0.92], [0.525, 0.80], [0.53, 0.66], [0.535, 0.52], [0.54, 0.42], [0.545, 0.34]]
};

function estimatedLinesFor(thumbSide: 'left' | 'right'): Partial<Record<PalmLineId, Array<[number, number]>>> {
  const out: Partial<Record<PalmLineId, Array<[number, number]>>> = {};
  for (const [id, template] of Object.entries(ESTIMATED_LINE_TEMPLATES) as Array<[PalmLineId, Array<[number, number]>]>) {
    out[id] = thumbSide === 'left'
      ? template.map(([x, y]) => [x, y] as [number, number])
      : template.map(([x, y]) => [1 - x, y] as [number, number]);
  }
  return out;
}

function sanitizePalmLines(result: PalmResult, thumbSide?: 'left' | 'right'): PalmResult {
  // Precision-first policy: do not render weak or anatomically implausible traces merely
  // to fill all four canonical lines. This deliberately prefers "not clear" over a
  // convincing-looking path on a shadow, palm boundary or secondary crease.
  const plausible = (line: PalmResult['lines'][number]) => {
    const pts = line.points;
    if (pts.length < 4) return false;
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX, spanY = maxY - minY;
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const nearFrame = pts.filter(([x, y]) => x < 0.075 || x > 0.925 || y < 0.06 || y > 0.96).length / pts.length;
    if (nearFrame > 0.28) return false;

    if (line.id === 'heart_line') {
      return spanX >= 0.38 && meanY >= 0.20 && meanY <= 0.43 && spanY <= 0.28;
    }
    if (line.id === 'head_line') {
      return spanX >= 0.34 && meanY >= 0.32 && meanY <= 0.62 && spanY <= 0.34;
    }
    if (line.id === 'fate_line') {
      return spanY >= 0.28 && meanX >= 0.34 && meanX <= 0.66 && spanX <= 0.30;
    }
    if (line.id === 'life_line') {
      // A true life-line candidate curves from the thumb-index valley around the thenar
      // mound toward the wrist. The hand silhouette instead stays pinned to the outer
      // edge. Compare the upper and lower portions to ensure the trace bends inward.
      if (spanY < 0.30 || spanX < 0.07 || !thumbSide) return false;
      const upper = [...pts].sort((a, b) => a[1] - b[1]).slice(0, Math.max(2, Math.ceil(pts.length * 0.25)));
      const lower = [...pts].sort((a, b) => b[1] - a[1]).slice(0, Math.max(2, Math.ceil(pts.length * 0.25)));
      const upperX = upper.reduce((sum, p) => sum + p[0], 0) / upper.length;
      const lowerX = lower.reduce((sum, p) => sum + p[0], 0) / lower.length;
      const inward = thumbSide === 'left' ? lowerX - upperX : upperX - lowerX;
      const sideOkay = thumbSide === 'left' ? meanX <= 0.52 : meanX >= 0.48;
      return sideOkay && inward >= 0.035;
    }
    return false;
  };

  return {
    ...result,
    lines: result.lines.map(line => {
      const minConfidence = line.status === 'detected' ? 0.52 : 0.45;
      const accepted = (line.status === 'detected' || line.status === 'approximate')
        && line.confidence >= minConfidence
        && plausible(line);
      if ((line.status === 'detected' || line.status === 'approximate') && !accepted) {
        return {
          ...line,
          detected: false,
          status: 'not_clear' as const,
          visibility: 'not clear enough for a reliable guide',
          points: []
        };
      }
      return line;
    })
  };
}

function applyEstimatedLines(
  result: PalmResult,
  estimated: Partial<Record<PalmLineId, Array<[number, number]>>>
): PalmResult {
  // Rather than telling the user to retake, fill any crease the vision model could not
  // trace with an anatomically-derived guide. These are clearly marked as estimated in
  // both the overlay and the observations panel - they are positional guides from hand
  // geometry, NOT creases that were actually seen in the photograph.
  return {
    ...result,
    lines: result.lines.map(line => {
      if (line.status !== 'not_clear') return line;
      const points = estimated[line.id];
      if (!points || points.length < 4) return line;
      return {
        ...line,
        detected: true,
        status: 'estimated' as const,
        confidence: Math.max(line.confidence, 0.3),
        visibility: 'estimated',
        points
      };
    })
  };
}

/*
 * Label placement.
 *
 * The overlay is rendered with preserveAspectRatio="xMidYMid slice" so it crops exactly
 * like the image's `object-fit: cover`. In a container wider than the 4:5 viewBox that
 * means the TOP AND BOTTOM of the viewBox are cropped away: at a 1.15 container aspect
 * only y in [19, 106] of 125 is on screen, and at 1.5 only y in [29, 96].
 *
 * Labels used to sit on each path's final point, so the Life line - which ends at the
 * wrist around y=113 - had its label rendered outside the visible window entirely. This
 * safe band is sized for container aspects up to ~1.5.
 */
const LABEL_SAFE = { minX: 9, maxX: 74, minY: 31, maxY: 94 };
const LABEL_MIN_GAP = 8.5;

function labelAnchorFor(points: PalmPoint[]) {
  const scaled = points.map(([x, y]) => ({ x: x * 100, y: y * 125 }));
  // Walk back from the end of the trace for the last vertex that is inside the safe
  // band, so the label still reads as belonging to the end of the line where possible.
  for (let i = scaled.length - 1; i >= 0; i--) {
    const p = scaled[i];
    if (p.x >= LABEL_SAFE.minX && p.x <= LABEL_SAFE.maxX && p.y >= LABEL_SAFE.minY && p.y <= LABEL_SAFE.maxY) {
      return p;
    }
  }
  // No vertex qualifies (a line living entirely in the cropped region): clamp the end.
  const last = scaled[scaled.length - 1];
  return {
    x: Math.min(LABEL_SAFE.maxX, Math.max(LABEL_SAFE.minX, last.x)),
    y: Math.min(LABEL_SAFE.maxY, Math.max(LABEL_SAFE.minY, last.y))
  };
}

function palmPathsFromVision(result: PalmResult): PalmPaths | null {
  const detected = result.lines.filter(line => line.detected && line.points.length >= 4);
  if (!detected.length) return null;

  const entries = detected.map(line => {
    const id = normalizePalmLine(line.id || line.name);
    if (!id) return null;
    const anchor = labelAnchorFor(line.points);
    const status: PalmTraceStatus = line.status === 'approximate' ? 'approximate'
      : line.status === 'estimated' ? 'estimated'
      : 'detected';
    return {
      id,
      meta: {
        label: line.name,
        path: smoothPath(line.points),
        labelX: Math.min(LABEL_SAFE.maxX, anchor.x + 2),
        labelY: anchor.y - 2,
        status
      }
    };
  }).filter(Boolean) as Array<{ id: PalmLineId; meta: PalmPaths[PalmLineId] }>;

  // Push apart labels that would otherwise stack on top of each other. Heart and head
  // lines in particular both terminate near the percussion edge at similar heights.
  const ordered = [...entries].sort((a, b) => a.meta.labelY - b.meta.labelY);
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].meta.labelY - ordered[i - 1].meta.labelY;
    if (gap < LABEL_MIN_GAP) ordered[i].meta.labelY = ordered[i - 1].meta.labelY + LABEL_MIN_GAP;
  }
  // Nudge back up if de-overlapping pushed the last label past the safe band.
  const overflow = ordered.length ? ordered[ordered.length - 1].meta.labelY - LABEL_SAFE.maxY : 0;
  if (overflow > 0) {
    for (const entry of ordered) entry.meta.labelY = Math.max(LABEL_SAFE.minY, entry.meta.labelY - overflow);
  }

  return Object.fromEntries(entries.map(e => [e.id, e.meta])) as PalmPaths;
}

const MEDIAPIPE_VERSION = '0.10.22';
const MODEL_CDN_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
// The file FilesetResolver actually requests from the WASM root. Kept in sync with
// frontend/scripts/setup-mediapipe.mjs, which uses it as its copy success criterion.
const WASM_ENTRY = 'vision_wasm_internal.js';

// Same-origin assets first. Palmistry is unusable without hand landmarks, so depending
// on three third-party hosts at runtime is a real availability risk: a blocked CDN made
// the detector fail to initialize, which silently disabled rectification, the palm mask
// and the estimated-line fallback all at once.
// `npm run setup:mediapipe` populates the local paths; CDNs remain as a fallback.
const DETECTOR_SOURCES: Array<{ label: string; wasmRoot: string; modelAssetPath: string; local?: boolean }> = [
  { label: 'self-hosted', wasmRoot: '/mediapipe/wasm', modelAssetPath: '/models/hand_landmarker.task', local: true },
  { label: 'jsDelivr CDN', wasmRoot: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`, modelAssetPath: MODEL_CDN_URL },
  { label: 'unpkg CDN', wasmRoot: `https://unpkg.com/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`, modelAssetPath: MODEL_CDN_URL }
];

/** Returns null when the asset is usable, or a human-readable reason when it is not. */
async function assetProblem(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return `${url} → HTTP ${response.status}`;
    // A dev server that rewrites unknown paths to index.html will happily 200 here, so
    // confirm it is not HTML before trusting it.
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return `${url} → served index.html (file not present)`;
    return null;
  } catch (error) {
    return `${url} → ${error instanceof Error ? error.message : 'unreachable'}`;
  }
}

function DetectorErrorBanner({ attempts, onRetry, retrying }: { attempts: string[]; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="detector-error-banner" role="alert">
      <div className="detector-error-head">
        <strong>Hand detector unavailable — palm capture is disabled</strong>
        <button className="ghost-btn" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</button>
      </div>
      <p>
        Palmistry needs MediaPipe hand landmarks to locate your palm. Without them the
        crease guides cannot be placed correctly, so capture is blocked rather than
        showing lines that would be guesses.
      </p>
      <p className="detector-error-fix">
        Fix: run <code>npm run setup:mediapipe</code> in <code>frontend/</code> to serve the
        detector from this app instead of a CDN, then reload.
      </p>
      <details>
        <summary>What failed ({attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'})</summary>
        <ul>{attempts.map((line, i) => <li key={i}>{line}</li>)}</ul>
      </details>
    </div>
  );
}

// MediaPipe hand connections, used only by the debug overlay.
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

function CaptureDebugOverlay({ debug }: { debug: CaptureDebug }) {
  // Everything is projected through the same rectifying transform the capture used, so
  // this shows exactly what the pipeline believed about the hand. If the skeleton does
  // not sit on the anatomy in the photo, the landmarks are at fault; if it does and the
  // traces are still wrong, the line fitting is.
  const { transform, thumbSide } = debug.rectification;
  const project = (p: Point2) => {
    const c = applyAffine(transform, p);
    return { x: c.x * 100, y: c.y * 125 };
  };
  const points = debug.landmarks.map(project);
  const polygon = palmPolygonFor(thumbSide)
    .map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 125).toFixed(1)}`)
    .join(' ');
  const anchors: Array<[string, Point2]> = [
    ['wrist', CANONICAL_WRIST],
    ['index', thumbSide === 'left' ? CANONICAL_INDEX_MCP : flipX(CANONICAL_INDEX_MCP)],
    ['pinky', thumbSide === 'left' ? CANONICAL_PINKY_MCP : flipX(CANONICAL_PINKY_MCP)]
  ];

  return (
    <svg className="palm-debug-overlay" viewBox="0 0 100 125" preserveAspectRatio="xMidYMid slice" aria-label="Capture diagnostics">
      <polygon className="debug-mask" points={polygon} />
      {points.length >= 21 && HAND_CONNECTIONS.map(([a, b]) => (
        <line key={`${a}-${b}`} className="debug-bone" x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} />
      ))}
      {points.map((p, i) => <circle key={i} className="debug-joint" cx={p.x} cy={p.y} r={0.8} />)}
      {anchors.map(([label, p]) => (
        <g key={label}>
          <circle className="debug-anchor" cx={p.x * 100} cy={p.y * 125} r={1.6} />
          <text className="debug-anchor-label" x={p.x * 100 + 2.5} y={p.y * 125 + 1}>{label}</text>
        </g>
      ))}
    </svg>
  );
}

export function PalmScene({ onNext, focusLine, agoraCameraTrack, onAnalyzed }: PalmSceneProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const lastCenterRef = useRef<{ x: number; y: number }>();
  const latestLandmarksRef = useRef<NormalizedLandmark[]>([]);
  // Last detection that actually contained a full 21-point hand, plus when it happened.
  // Capture uses this instead of `latestLandmarksRef` so one dropped frame cannot
  // silently downgrade the capture to the no-landmark fallback path.
  const lastValidLandmarksRef = useRef<NormalizedLandmark[]>([]);
  const lastValidLandmarkAtRef = useRef(0);
  const readySinceRef = useRef<number | null>(null);
  const lastQualityCheckRef = useRef(0);
  const cameraQualityRef = useRef<CameraQuality>(EMPTY_QUALITY);
  const mirrorCameraRef = useRef(true);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [result, setResult] = useState<PalmResult | null>(null);
  const [capturedPalm, setCapturedPalm] = useState<string | null>(null);
  const [status, setStatus] = useState('Camera is off');
  const [detectorStatus, setDetectorStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [validation, setValidation] = useState<PalmValidation>({ ready: false, handDetected: false, insideGuide: false, sizeOkay: false, openPalm: false, upright: false, steady: false, message: 'Open the camera to begin' });
  const [palmPaths, setPalmPaths] = useState<PalmPaths | null>(null);
  const [cameraQuality, setCameraQuality] = useState<CameraQuality>(EMPTY_QUALITY);
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);
  const [isBurstCapturing, setIsBurstCapturing] = useState(false);
  const [captureDebug, setCaptureDebug] = useState<CaptureDebug | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [detectorError, setDetectorError] = useState<string[] | null>(null);
  const [detectorSource, setDetectorSource] = useState<string | null>(null);

  const readiness = useMemo(() => [
    ['Hand', validation.handDetected],
    ['Position', validation.insideGuide],
    ['Size', validation.sizeOkay],
    ['Open palm', validation.openPalm],
    ['Steady', validation.steady],
    ['Focus', cameraQuality.focusOkay],
    ['Lighting', cameraQuality.lightingOkay]
  ] as Array<[string, boolean]>, [validation, cameraQuality]);

  const cameraReady = cameraQuality.focusOkay && cameraQuality.lightingOkay;
  // Capture now REQUIRES a working hand detector. Without landmarks there is no palm
  // rectification, no palm mask and no anatomical frame, so any lines produced are
  // guesses dressed up with confidence percentages - the hand's own silhouette gets
  // reported as a Life line. Declining to capture is more honest than that.
  const captureEnabled = !!stream && !isBurstCapturing
    && detectorStatus === 'ready' && validation.ready && cameraReady;

  async function ensureDetector() {
    if (detectorRef.current) return detectorRef.current;
    setDetectorStatus('loading');
    setDetectorError(null);
    setStatus('Loading the hand detector…');

    const attempts: string[] = [];
    for (const source of DETECTOR_SOURCES) {
      // Probe first: MediaPipe's own failure for a missing asset is an opaque abort,
      // which is exactly what made the previous silent degradation so hard to diagnose.
      if (source.local) {
        // Probe BOTH assets. Checking only the model previously let a half-installed
        // state through: the model downloaded fine while the WASM copy silently failed,
        // so this source was attempted and died with an opaque MediaPipe abort.
        const problems = (await Promise.all([
          assetProblem(`${source.wasmRoot}/${WASM_ENTRY}`),
          assetProblem(source.modelAssetPath)
        ])).filter((p): p is string => p !== null);
        if (problems.length) {
          attempts.push(`${source.label}: not installed — ${problems.join('; ')} (run \`npm run setup:mediapipe\` in frontend/)`);
          continue;
        }
      }
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          const vision = await FilesetResolver.forVisionTasks(source.wasmRoot);
          detectorRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: source.modelAssetPath, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.58,
            minHandPresenceConfidence: 0.58,
            minTrackingConfidence: 0.55
          });
          console.log(`[Palmistry] Hand detector ready via ${source.label} (${delegate}).`);
          setDetectorSource(`${source.label} · ${delegate}`);
          setDetectorStatus('ready');
          return detectorRef.current;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          attempts.push(`${source.label} (${delegate}): ${detail}`);
          console.warn(`[Palmistry] Hand detector failed via ${source.label} using ${delegate}:`, error);
        }
      }
    }

    console.error('[Palmistry] Unable to initialize MediaPipe Hand Landmarker. Attempts:', attempts);
    setDetectorError(attempts);
    setDetectorStatus('error');
    setStatus('Hand detector unavailable · palm capture is disabled until it loads');
    return null;
  }

  function stopValidationLoop() {
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }

  function startValidationLoop() {
    stopValidationLoop();
    const tick = () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      const now = performance.now();

      if (video && video.readyState >= 2) {
        let nextValidation = validation;
        if (detector && now - lastDetectRef.current > 120) {
          lastDetectRef.current = now;
          try {
            const detection = detector.detectForVideo(video, now);
            const points = detection.landmarks?.[0] ?? [];
            latestLandmarksRef.current = points;
            // A dropped detection frame used to wipe the landmarks the capture path
            // relies on, while `captureEnabled` still read the previous (ready) React
            // state. Clicking in that window produced a zero-landmark capture: the
            // generic fallback crop (mostly fingers) and no estimated-line geometry.
            // Retain the last frame that actually contained a hand.
            if (points.length >= 21) {
              lastValidLandmarksRef.current = points;
              lastValidLandmarkAtRef.current = now;
            }
            const b = points.length ? boundsOf(points) : undefined;
            const center = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : undefined;
            const next = validatePalm(points, lastCenterRef.current);
            if (center) lastCenterRef.current = center;

            if (next.ready) {
              readySinceRef.current ??= now;
              if (now - readySinceRef.current < 500) {
                next.ready = false;
                next.message = 'Great position · hold steady…';
              }
            } else {
              readySinceRef.current = null;
            }
            nextValidation = next;
            setValidation({ ...next });
          } catch (error) {
            console.warn('[Palmistry] Hand validation frame skipped', error);
          }
        }

        if (now - lastQualityCheckRef.current > 320) {
          lastQualityCheckRef.current = now;
          try {
            const manualFallback = !detector;
            const probeFrame = drawPalmFrame(video, latestLandmarksRef.current, manualFallback, mirrorCameraRef.current, 360, 450);
            const quality = measureCanvasQuality(probeFrame);
            cameraQualityRef.current = quality;
            setCameraQuality(quality);

            if (!detector) {
              // Camera quality is irrelevant while the detector is down: capture is
              // blocked either way, and the banner explains the actual problem.
              setStatus('Hand detector unavailable · palm capture is disabled until it loads');
            } else if (nextValidation.ready) {
              if (!quality.lightingOkay) setStatus('Palm position is good · improve lighting before capture');
              else if (!quality.focusOkay) setStatus('Palm position is good · move slightly farther away for sharper focus');
              else setStatus('Palm ready ✓ · focus and lighting look good');
            } else {
              setStatus(nextValidation.message);
            }
          } catch (error) {
            console.warn('[Palmistry] Camera quality probe skipped', error);
          }
        }
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }

  async function startCamera() {
    try {
      stopValidationLoop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
      setCapturedPalm(null);
      setResult(null);
      setPalmPaths(null);
      setCameraQuality(EMPTY_QUALITY);
      cameraQualityRef.current = EMPTY_QUALITY;
      setCameraInfo(null);
      setCaptureDebug(null);
      latestLandmarksRef.current = [];
      lastValidLandmarksRef.current = [];
      lastValidLandmarkAtRef.current = 0;
      lastCenterRef.current = undefined;
      readySinceRef.current = null;
      setValidation({ ready: false, handDetected: false, insideGuide: false, sizeOkay: false, openPalm: false, upright: false, steady: false, message: 'Opening high-quality palm camera…' });
      setStatus('Opening high-quality palm camera…');

      const mobile = isLikelyMobileDevice();
      let media: MediaStream;
      let usingAgoraCamera = false;

      // Prefer the exact camera source already used by the Agora self-view. Opening a
      // second getUserMedia stream from the same webcam can cause the browser/driver to
      // negotiate a darker, lower-quality secondary feed with different exposure. A clone
      // of Agora's underlying MediaStreamTrack keeps Palmistry visually consistent with
      // the bright user tile while remaining safe to stop independently after capture.
      const agoraMediaTrack = agoraCameraTrack?.getMediaStreamTrack?.();
      if (agoraMediaTrack && agoraMediaTrack.readyState === 'live') {
        const clonedTrack = agoraMediaTrack.clone();
        media = new MediaStream([clonedTrack]);
        usingAgoraCamera = true;
        console.log('[Palmistry] Reusing Agora camera source for palm capture', clonedTrack.getSettings?.());
      } else {
        // Fallback for sessions where the Agora camera is unavailable. Prefer the rear
        // camera on phones because it normally has better close-focus detail.
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: mobile ? 'environment' : 'user' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false
        };
        try {
          media = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (highResError) {
          console.warn('[Palmistry] High-resolution camera request failed; retrying with compatible defaults', highResError);
          media = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: mobile ? 'environment' : 'user' }, width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false
          });
        }
      }

      const track = media.getVideoTracks()[0];
      const capabilities = (track.getCapabilities?.() ?? {}) as any;
      const settings = track.getSettings?.() ?? {};
      const advanced: Record<string, unknown> = {};
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
      if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
      if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
      if (Object.keys(advanced).length) {
        try {
          await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
        } catch (constraintError) {
          console.warn('[Palmistry] Continuous camera controls are not supported by this browser/device', constraintError);
        }
      }

      const updated = track.getSettings?.() ?? settings;
      const facing = String(updated.facingMode || (mobile ? 'environment' : 'user'));
      mirrorCameraRef.current = facing !== 'environment';
      setCameraInfo({
        label: usingAgoraCamera ? `Agora camera · ${track.label || 'user video'}` : (track.label || (facing === 'environment' ? 'Rear camera' : 'Front camera')),
        width: Number(updated.width || 0),
        height: Number(updated.height || 0),
        frameRate: Number(updated.frameRate || 0),
        facingMode: facing,
        continuousFocus: advanced.focusMode === 'continuous'
      });

      setStream(media);
      streamRef.current = media;
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus(usingAgoraCamera ? 'Agora camera ready ✓ · align the palm inside the guide' : 'Camera ready · keep the palm farther from the lens until Focus turns green');

      void ensureDetector().then(detector => {
        if (detector) {
          setStatus('Place one open palm inside the highlighted area');
        } else {
          setStatus('Hand detector unavailable · palm capture is disabled until it loads');
        }
        // Keep the loop running either way so the preview and quality readout stay live
        // and a successful retry takes effect without reopening the camera.
        startValidationLoop();
      });
    } catch (error) {
      console.error('[Palmistry] Unable to open camera', error);
      setStatus('Camera permission was not granted or no compatible camera is available');
    }
  }

  async function capture() {
    // `captureEnabled` now requires detectorStatus === 'ready', so this is always false.
    // Retained only because capturePalmFromAgoraTrack still accepts the argument.
    const manualFallback = false;
    if (!videoRef.current || !canvasRef.current || !captureEnabled) return;
    const video = videoRef.current;
    setIsBurstCapturing(true);
    setStatus('Capturing the sharpest palm frame…');

    try {
      const sourceW = video.videoWidth || 1280;
      const sourceH = video.videoHeight || 720;
      const mirror = mirrorCameraRef.current;

      // Prefer the last detection that actually contained a hand. `latestLandmarksRef`
      // is cleared by any dropped frame, and capturing on one of those frames is what
      // silently fell back to the generic finger-heavy crop.
      const live = latestLandmarksRef.current;
      const capturePoints = (live.length >= 21 ? live : lastValidLandmarksRef.current).slice();

      // Freeze the geometry once so every burst frame shares identical framing, which is
      // what makes median fusion valid and keeps the overlay coordinate space stable.
      const rectification = buildPalmRectification(capturePoints, mirror, sourceW, sourceH);
      const frozenCrop = getPalmCrop(capturePoints, sourceW, sourceH);
      const thumbSide = rectification?.thumbSide;
      setCaptureDebug(rectification
        ? { landmarks: capturePoints.map(p => toDisplaySpace(p, mirror)), rectification }
        : null);
      if (!rectification) {
        console.warn('[Palmistry] No usable hand landmarks at capture; falling back to an axis-aligned crop. Line placement will be approximate.');
      }

      // A click does not freeze the very first frame. Sample a short burst and select
      // the sharpest, best-exposed frame. This is especially helpful for laptop webcams
      // that are still settling autofocus while the palm is close to the lens.
      const candidates: Array<{ canvas: HTMLCanvasElement; quality: CameraQuality }> = [];
      for (let i = 0; i < 5; i++) {
        if (i) await sleep(85);
        const frame = rectification
          ? drawRectifiedPalm(video, rectification, rectification.nativeWidth, rectification.nativeHeight)
          : drawCropNative(video, frozenCrop, mirror);
        const quality = measureCanvasQuality(frame);
        candidates.push({ canvas: frame, quality });
        setStatus(`Capturing best frame… ${i + 1}/5`);
      }
      candidates.sort((a, b) => b.quality.score - a.quality.score);
      const best = candidates[0];
      if (!best) throw new Error('No camera frame was available.');

      if (!best.quality.lightingOkay || !best.quality.focusOkay) {
        setCameraQuality(best.quality);
        cameraQualityRef.current = best.quality;
        setStatus(!best.quality.focusOkay
          ? 'Capture paused · move slightly farther from the lens and hold steady for sharper focus'
          : 'Capture paused · use brighter, even light and avoid glare on the palm');
        setIsBurstCapturing(false);
        return;
      }

      // Capture only from the already-running Agora camera source. Do not disable the
      // RTC camera and do not open a second physical-camera session: both can blank the
      // published self video on browsers that allow only one active camera owner.
      const activeTrack = streamRef.current?.getVideoTracks?.()[0];
      setStatus('Capturing palm from the live Agora video…');
      const agoraCapture = await capturePalmFromAgoraTrack(activeTrack, capturePoints, manualFallback, mirror);
      const fused = fusePalmCanvases(candidates.slice(0, 3).map(c => c.canvas));
      const nativeSource = fused || best.canvas;

      // Single, high-quality resize from native crop pixels straight to the output
      // size. Lanczos-3 retains crease edges that bilinear drawImage smears away.
      setStatus('Enhancing the captured palm…');
      await sleep(0); // let the status paint before the synchronous resample
      const analysisSource = resampleLanczos(nativeSource, OUTPUT_WIDTH, OUTPUT_HEIGHT);

      const canvas = canvasRef.current;
      canvas.width = analysisSource.width;
      canvas.height = analysisSource.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas capture is unavailable.');
      ctx.drawImage(analysisSource, 0, 0);

      const palmDataUrl = canvas.toDataURL('image/jpeg', 0.97);
      const enhancedPalmDataUrl = enhancePalmCanvas(canvas);
      const genericCandidate = makeCreaseCandidateCanvas(canvas, thumbSide);
      const directionalCandidate = makeDirectionalCreaseCanvas(canvas, thumbSide);
      const creaseCandidateImageDataUrl = directionalCandidate || genericCandidate;
      // Actual CV extraction runs before the multimodal classifier. Dynamic-programming
      // paths follow dark ridge continuity inside anatomically plausible zones, producing
      // concrete candidates for Heart/Head/Life/Fate instead of asking Vision to invent
      // coordinates from scratch. On a rectified capture the search bands and the palm
      // mask are both meaningful, so silhouette edges and finger creases are excluded.
      const cvCandidates = extractPalmCvCandidates(canvas, thumbSide
        ? { mask: palmPolygonFor(thumbSide), thumbSide }
        : undefined);
      setPalmPaths(null);
      // The backend still analyzes the untouched raw frame (palmDataUrl); only what the
      // user sees is enhanced. This keeps vision analysis working from true pixel data
      // while compensating, for display purposes, for the softness inherent in a
      // cropped-and-upscaled capture.
      setCapturedPalm(enhancePalmCanvasForDisplay(canvas));
      setCameraQuality(best.quality);
      cameraQualityRef.current = best.quality;
      const sourceSettings = agoraCapture?.settings as MediaTrackSettings | undefined;
      const sourceLabel = sourceSettings?.width && sourceSettings?.height
        ? `${sourceSettings.width}×${sourceSettings.height} Agora source ✓ · `
        : `${sourceW}×${sourceH} Agora source · `;
      setStatus(`${sourceLabel}extracting CV crease candidates and mapping visible lines…`);
      stopValidationLoop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);

      const data = await analyzePalm(palmDataUrl, enhancedPalmDataUrl, creaseCandidateImageDataUrl, cvCandidates, thumbSide);
      // Precision-first: never draw a synthetic major crease when the photo does not
      // support it. Weak approximate candidates are rejected instead of being replaced
      // by anatomical templates that can look convincing but do not follow the user's
      // actual crease.
      const merged = sanitizePalmLines({
        ...data,
        captureQuality: data.captureQuality > 0 ? data.captureQuality : best.quality.score
      }, thumbSide);
      setResult(merged);
      setPalmPaths(palmPathsFromVision(merged));
      // Palm analysis is now an application event, not something the user must narrate.
      // The parent immediately re-briefs the running Conversational AI agent with the
      // exact Vision/CV result and starts a grounded spoken walkthrough.
      void Promise.resolve(onAnalyzed?.(merged)).catch(error => {
        console.error('[Palmistry] Unable to synchronize palm result with Jyotishi', error);
      });

      const detectedCount = merged.lines.filter(line => line.status === 'detected').length;
      const approximateCount = merged.lines.filter(line => line.status === 'approximate').length;
      const estimatedCount = merged.lines.filter(line => line.status === 'estimated').length;
      if (detectedCount || approximateCount || estimatedCount) {
        const parts = [
          detectedCount ? `${detectedCount} clear` : '',
          approximateCount ? `${approximateCount} approximate` : '',
          estimatedCount ? `${estimatedCount} estimated` : ''
        ].filter(Boolean).join(' · ');
        setStatus(`Palm analyzed ✓ · ${parts} crease guide${detectedCount + approximateCount + estimatedCount === 1 ? '' : 's'} mapped`);
      } else {
        setStatus('Palm analyzed · no major creases were clear enough to map. Retake with the palm flat and evenly lit.');
      }
    } catch (error) {
      console.error('[Palmistry] Palm capture / vision analysis failed', error);
      setResult(null);
      setPalmPaths(null);
      setStatus(error instanceof Error ? `Palm analysis unavailable · ${error.message}` : 'Palm analysis unavailable · please retake the palm');
    } finally {
      setIsBurstCapturing(false);
    }
  }

  useEffect(() => () => {
    stopValidationLoop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    detectorRef.current?.close();
    detectorRef.current = null;
  }, []);

  return (
    <div className="scene-wrap palm-scene">
      <div className="scene-copy">
        <div className="eyebrow">CHAPTER 04 · YOUR COSMIC IMPRINT</div>
        <h2>The sky is one map. Your palm is another.</h2>
        <p>Position one open palm inside the guided window. Capture is enabled only when the hand is visible, centered, open, upright and steady.</p>
      </div>
      <div className="palm-layout">
        <div className={`camera-stage glass-panel ${capturedPalm ? 'captured' : ''} ${stream ? 'validating' : ''} ${validation.ready ? 'palm-ready' : ''}`}>
          {!capturedPalm && <video ref={videoRef} className={mirrorCameraRef.current ? '' : 'camera-native'} autoPlay playsInline muted />}
          {capturedPalm && <img className="captured-palm" src={capturedPalm} alt="Normalized captured palm" />}
          {!stream && !capturedPalm && <div className="camera-placeholder">✋<span>Open the palm camera to begin</span></div>}

          {!capturedPalm && stream && (
            <>
              <div className="camera-dim-mask" aria-hidden="true" />
              <div className="camera-quality-panel" aria-live="polite">
                <span className={cameraQuality.focusOkay ? 'ok' : ''}>Focus {cameraQuality.focusOkay ? '✓' : '○'}</span>
                <span className={cameraQuality.lightingOkay ? 'ok' : ''}>Lighting {cameraQuality.lightingOkay ? '✓' : '○'}</span>
                {cameraInfo && <small>{cameraInfo.width || 'Auto'}×{cameraInfo.height || 'Auto'}{cameraInfo.continuousFocus ? ' · AF' : ''}</small>}
              </div>
              <div className={`hand-guide ${validation.ready && cameraReady ? 'ready' : ''}`}>
                <div className="palm-guide-copy"><strong>{validation.ready && cameraReady ? 'Palm ready ✓' : validation.ready ? 'Hold for focus…' : 'Place palm here'}</strong><span>Fingers open · palm upright</span></div>
              </div>
              <div className="palm-readiness" aria-live="polite">
                {readiness.map(([label, ok]) => <span key={label} className={ok ? 'ok' : ''}>{ok ? '✓' : '○'} {label}</span>)}
              </div>
            </>
          )}

          {capturedPalm && palmPaths && (
            <svg className="palm-line-overlay" viewBox="0 0 100 125" preserveAspectRatio="xMidYMid slice" aria-label="Vision-assisted palm crease guides">
              {(Object.entries(palmPaths) as Array<[PalmLineId, PalmPaths[PalmLineId]]>).map(([id, meta]) => (
                <g key={id} className={`palm-trace ${id} ${meta.status} ${focusLine === id ? 'active' : focusLine ? 'dimmed' : ''}`}>
                  {/* Dark halo underneath keeps every trace legible over skin tone. */}
                  <path className="palm-trace-halo" d={meta.path} />
                  <path className="palm-trace-stroke" d={meta.path} />
                  <text x={meta.labelX} y={meta.labelY}>{meta.label}{meta.status === 'estimated' ? ' · est.' : ''}</text>
                </g>
              ))}
            </svg>
          )}

          {capturedPalm && showDebug && captureDebug && <CaptureDebugOverlay debug={captureDebug} />}

          {capturedPalm && palmPaths && (
            <div className="palm-trace-legend" aria-label="Palm trace confidence legend">
              <span><i className="solid" /> traced</span>
              <span><i className="dashed" /> approximate</span>
            </div>
          )}

          {capturedPalm && (
            <button
              className={`palm-debug-toggle ${showDebug ? 'on' : ''}`}
              onClick={() => setShowDebug(value => !value)}
              title={captureDebug
                ? 'Show the detected hand skeleton, canonical anchors and palm mask used for this capture'
                : 'No hand landmarks were available for this capture'}
            >
              {showDebug ? '◉' : '○'} Debug
              {captureDebug ? '' : ' · no landmarks'}
            </button>
          )}

          <div className={`camera-status ${captureEnabled ? 'ready' : ''}`}><span className="live-dot" /> {status}</div>
          <div className="camera-actions">
            <button className="ghost-btn" onClick={startCamera}>{capturedPalm ? 'Retake Palm' : 'Open Palm Camera'}</button>
            {!capturedPalm && <button className="primary-btn" onClick={capture} disabled={!captureEnabled}>{isBurstCapturing ? 'Selecting Best Frame…' : 'Capture Palm'}</button>}
          </div>
          {stream && cameraInfo && <div className="camera-device-chip" title={cameraInfo.label}>{cameraInfo.label.startsWith('Agora camera') ? 'Agora camera' : cameraInfo.facingMode === 'environment' ? 'Rear camera' : 'Front camera'} · {cameraInfo.width || 'auto'}×{cameraInfo.height || 'auto'}{detectorSource ? ` · detector: ${detectorSource}` : ''}</div>}
          <canvas ref={canvasRef} hidden />
        </div>
        <div className="palm-result glass-panel">
          <div className="eyebrow">PALM OBSERVATIONS</div>
          {detectorError && (detectorStatus === 'error' || detectorStatus === 'loading') && (
            // Kept mounted through a retry so the button can show progress instead of
            // the whole banner vanishing and reappearing.
            <DetectorErrorBanner
              attempts={detectorError}
              retrying={detectorStatus === 'loading'}
              onRetry={() => { detectorRef.current = null; void ensureDetector(); }}
            />
          )}
          {result ? <>
            <h3>{result.hand} hand · {Math.round(result.captureQuality * 100)}% capture quality</h3>
            <p>{result.summary}</p>
            <div className="line-list">{result.lines.map(line => {
              const id = normalizePalmLine(line.name);
              const badge = line.status === 'detected' ? `${line.visibility} · ${Math.round(line.confidence * 100)}%`
                : line.status === 'approximate' ? `approximate · ${Math.round(line.confidence * 100)}%`
                : line.status === 'estimated' ? 'estimated position'
                : 'not clear';
              const body = line.status === 'detected' ? line.traditionalReading
                : line.status === 'approximate' ? `Approximate vision trace from the captured palm. ${line.traditionalReading}`
                : line.status === 'estimated' ? `Not traced in the photo. This guide is positioned from your hand's landmark geometry, so treat it as indicative only. ${line.traditionalReading}`
                : 'This crease was not clear enough in the captured image to draw a reliable guide. Try a brighter, sharper retake.';
              // `line-<id>` carries the same accent colour the overlay trace uses, so a
              // card can be matched to its line on the palm at a glance.
              return <div className={`line-card ${id ? `line-${id}` : ''} status-${line.status} ${id && focusLine === id ? 'active' : ''}`} key={line.name}>
                <strong><i className="line-swatch" aria-hidden="true" />{line.name}</strong><span>{badge}</span><small>{body}</small>
              </div>;
            })}</div>
            <div className="disclaimer">Traditional palmistry-style demo only. MediaPipe is used for capture validation/cropping when available. After capture, a vision model traces visually discernible major creases and returns normalized coordinates used to draw the guides. Clear traces are drawn solid; moderate-confidence traces are drawn as approximate dashed guides. Where no crease could be traced, a dotted <em>estimated</em> guide is placed from hand-landmark geometry — that guide reflects typical palm anatomy, not a crease observed in your photograph. These are approximate visual annotations, not medical, biometric or scientific measurements.</div>
          </> : <div className="empty-result">Capture a validated palm to populate the synchronized interpretation panel.</div>}
        </div>
      </div>
      <button className="primary-btn scene-next" onClick={onNext}>Open the Cosmic Thread →</button>
    </div>
  );
}
