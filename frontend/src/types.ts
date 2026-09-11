export type SceneName = 'intro' | 'sky' | 'kundli' | 'palm' | 'thread';

export type BirthProfile = {
  name: string;
  date: string;
  time: string;
  place: string;
  language: string;
};

export type BirthProfileExtraction = Partial<BirthProfile> & {
  complete: boolean;
};

export type ChartData = {
  lagna: string;
  moonSign: string;
  nakshatra: string;
  dasha: string;
  calculation?: { mode: string; engine: string; ayanamsha: string; ayanamshaDegrees: number; utc: string; latitude: number; longitude: number; timezone: string; resolvedPlace: string; note: string; };
  planets: Array<{
    name: string;
    sign: string;
    house: number;
    degree: string;
    strength: string;
    longitude?: number;
    tropicalLongitude?: number;
    retrograde?: boolean;
  }>;
};

export type PalmPoint = [number, number];

export type PalmResult = {
  hand: string;
  confidence: number;
  captureQuality: number;
  summary: string;
  analysisMode: 'vision';
  lines: Array<{
    id: 'heart_line' | 'head_line' | 'life_line' | 'fate_line';
    name: string;
    detected: boolean;
    // 'estimated' is applied client-side only: when the vision model returns
    // 'not_clear', the frontend substitutes an anatomical guide derived from the
    // MediaPipe hand landmarks. The backend never emits this status.
    status: 'detected' | 'approximate' | 'estimated' | 'not_clear';
    confidence: number;
    visibility: string;
    /** Conservative image-grounded morphology, e.g. continuous, broken, forked, or indeterminate. */
    observation?: string;
    points: PalmPoint[];
    traditionalReading: string;
  }>;
};
