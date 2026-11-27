/**
 * Multilingual helpers for the Jyotishi experience.
 *
 * The voice agent (ASR -> LLM -> TTS) can already converse in several languages, but the
 * application around it used to be English-only: chapter intros were fixed English strings
 * spoken through /speak, and chapter navigation was triggered by matching English phrases.
 * This module is the single place that knows about languages. It has no React or browser
 * dependencies so it can be verified in isolation (scripts/verify-language.ts).
 *
 * Fully translated: English, Hindi, Tamil. Other languages are still recognised and the
 * agent still replies in them, but scripted lines fall back to English (Marathi uses the
 * Hindi lines). Translations here deserve a native-speaker review before launch.
 */

export type LangCode = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'mr';
export type ChapterKey = 'sky' | 'kundli' | 'palm' | 'thread' | 'intro';

/** The languages whose scripted lines are translated. */
type TranslatedLang = 'en' | 'hi' | 'ta';

function translatedLang(lang: LangCode): TranslatedLang {
  if (lang === 'hi' || lang === 'mr') return 'hi';
  if (lang === 'ta') return 'ta';
  return 'en';
}

/* ------------------------------------------------------------------ */
/* Language detection                                                  */
/* ------------------------------------------------------------------ */

const SCRIPT_RANGES: Array<[LangCode, RegExp]> = [
  ['ta', /[஀-௿]/g],
  ['te', /[ఀ-౿]/g],
  ['kn', /[ಀ-೿]/g],
  ['hi', /[ऀ-ॿ]/g] // Devanagari: Hindi, refined to Marathi below
];

const MARATHI_MARKERS = /(?:^|\s)(?:आहे|आहेत|मला|तुम्ही|काय|नाही|माझे|माझा|माझी|आणि|मी)(?=\s|[.,?!।]|$)/;
const ENGLISH_STOPWORDS = /\b(?:the|is|are|what|how|please|my|me|you|can|tell|about|and|to|of|in|it|this|that|i|want|show|will|would|should)\b/gi;

/** Which language the script of `text` suggests, or 'latin' for plain Latin text. */
export function detectScriptLanguage(text: string): LangCode | 'latin' | undefined {
  let best: LangCode | undefined;
  let bestCount = 0;
  let total = 0;
  for (const [lang, pattern] of SCRIPT_RANGES) {
    const count = (text.match(pattern) || []).length;
    total += count;
    if (count > bestCount) { best = lang; bestCount = count; }
  }
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  total += latin;
  if (!total) return undefined;
  // Code-mixed speech ("मेरा name Raj है"): the non-Latin script wins when it is a real share.
  if (best && bestCount >= 2 && bestCount / total >= 0.3) {
    return best === 'hi' && MARATHI_MARKERS.test(text) ? 'mr' : best;
  }
  return 'latin';
}

/**
 * Common English words as the recogniser spells them in Tamil and Devanagari when it
 * mis-hears English speech as Tamil or Hindi. A message made mostly of these is English.
 */
const TRANSLITERATED_ENGLISH = new Set([
  // Tamil script
  'வேர்', 'இஸ்', 'வாட்', 'டெல்', 'மீ', 'அபௌட்', 'அபவுட்', 'அபௌட', 'மை', 'தி', 'கேன்', 'யூ', 'ஷோ', 'நெக்ஸ்ட்',
  'செக்ஷன்', 'ப்ளீஸ்', 'பிளீஸ்', 'யெஸ்', 'நோ', 'ஹாய்', 'ஹலோ', 'தேங்க்ஸ்', 'தேங்க்', 'ஹவ்', 'வொய்', 'வெண்',
  'ஹூ', 'திஸ்', 'தட்', 'வித்', 'அண்ட்', 'பட்', 'இட்', 'ஆர்', 'அம்', 'ஆன்', 'இன்', 'ஆஃப்', 'ஃபார்', 'டூ', 'ஐ',
  'லெட்ஸ்', 'கோ', 'டு', 'வில்', 'வாண்ட்', 'நீட்', 'எக்ஸ்ப்ளைன்', 'எக்ஸ்பிளைன்', 'டெல்லிங்', 'கரியர்', 'மேரேஜ்',
  'ஹெல்த்', 'லைஃப்', 'ஃபியூச்சர்', 'பிளேஸ்', 'ப்ளேஸ்', 'பிளானட்', 'பிளானெட்', 'ப்ளானட்', 'ஹவுஸ்', 'சைன்',
  // Devanagari
  'वेयर', 'वेअर', 'इज़', 'इज', 'व्हाट', 'वॉट', 'टेल', 'मी', 'अबाउट', 'माय', 'द', 'कैन', 'यू', 'शो', 'नेक्स्ट',
  'सेक्शन', 'प्लीज', 'प्लीज़', 'येस', 'यस', 'नो', 'हाय', 'हेलो', 'हैलो', 'थैंक्स', 'हाउ', 'व्हाई', 'हू', 'दिस',
  'दैट', 'विद', 'एंड', 'बट', 'इट', 'आर', 'ऑन', 'इन', 'ऑफ', 'फॉर', 'लेट्स', 'गो', 'विल', 'वांट', 'नीड', 'करियर',
  'मैरिज', 'हेल्थ', 'लाइफ', 'फ्यूचर', 'प्लेस', 'प्लैनेट', 'हाउस', 'साइन', 'एक्सप्लेन'
]);

/** True when a Tamil/Devanagari message is mostly English words written phonetically. */
export function isTransliteratedEnglish(text: string): boolean {
  const tokens = text.split(/[\s.,!?;:।'"()\-]+/u).filter(t => /[\u0900-\u097F\u0B80-\u0BFF]/u.test(t));
  if (tokens.length < 2) return false;
  const hits = tokens.filter(t => TRANSLITERATED_ENGLISH.has(t)).length;
  return hits >= 2 && hits / tokens.length >= 0.4;
}

const EXPLICIT_REQUESTS: Array<[LangCode, RegExp]> = [
  ['hi', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+hindi\b/i],
  ['hi', /(?:हिंदी|हिन्दी)\s*(?:में|मे)/],
  ['ta', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+tamil\b/i],
  ['ta', /தமிழில்/],
  ['te', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+telugu\b/i],
  ['te', /తెలుగులో/],
  ['kn', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+kannada\b/i],
  ['kn', /ಕನ್ನಡದಲ್ಲಿ/],
  ['mr', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+marathi\b/i],
  ['mr', /मराठीत/],
  ['en', /\b(?:in|speak|talk|reply|switch to|continue in|answer in)\s+english\b/i],
  ['en', /(?:अंग्रेज़ी|अंग्रेजी|इंग्लिश)\s*(?:में|मे)/],
  ['en', /ஆங்கிலத்தில்/]
];

/**
 * The conversation language after the user says `text`.
 *
 * Sticky on purpose: a short or romanised utterance ("haan", "ok", "sari") carries no
 * reliable signal, so it must not flip a Tamil or Hindi conversation back to English.
 * Switching to English needs a clearly English sentence (at least two English function words).
 */
export function nextLanguage(previous: LangCode, text: string): LangCode {
  for (const [lang, pattern] of EXPLICIT_REQUESTS) {
    if (pattern.test(text)) return lang;
  }
  // The recogniser sometimes writes English speech in Tamil/Devanagari letters
  // ("வேர் இஸ் சாத்தான்" = "where is Saturn"); that is English, whatever the script.
  if (isTransliteratedEnglish(text)) return 'en';
  const detected = detectScriptLanguage(text);
  if (!detected) return previous;
  if (detected !== 'latin') return detected;
  const englishWords = (text.match(ENGLISH_STOPWORDS) || []).length;
  return englishWords >= 2 ? 'en' : previous;
}

/* ------------------------------------------------------------------ */
/* Spoken numbers, names                                               */
/* ------------------------------------------------------------------ */

const HI_NUMBERS = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे'
];

const TA_UNITS = [
  'பூஜ்யம்', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது',
  'பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது'
];
const TA_TENS = ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'];
const TA_TENS_STEM = ['', '', 'இருபத்து', 'முப்பத்து', 'நாற்பத்து', 'ஐம்பத்து', 'அறுபத்து', 'எழுபத்து', 'எண்பத்து', 'தொண்ணூற்று'];

/**
 * `n` spelled out in the conversation language, so a TTS voice reads it in that language
 * instead of falling back to an English "fourteen". Falls back to digits outside 0..99 or
 * for languages without a table (the agent prompt asks the model to spell numbers itself).
 */
export function spokenNumber(n: number, lang: LangCode): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  const t = translatedLang(lang);
  if (t === 'hi') return HI_NUMBERS[n];
  if (t === 'ta') {
    if (n < 20) return TA_UNITS[n];
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    return unit === 0 ? TA_TENS[tens] : `${TA_TENS_STEM[tens]} ${TA_UNITS[unit]}`;
  }
  return String(n);
}

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const;
const SIGN_NAMES: Record<'hi' | 'ta', string[]> = {
  hi: ['मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन'],
  ta: ['மேஷம்', 'ரிஷபம்', 'மிதுனம்', 'கடகம்', 'சிம்மம்', 'கன்னி', 'துலாம்', 'விருச்சிகம்', 'தனுசு', 'மகரம்', 'கும்பம்', 'மீனம்']
};

const PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'] as const;
const PLANET_NAMES: Record<'hi' | 'ta', string[]> = {
  hi: ['सूर्य', 'चंद्र', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'राहु', 'केतु'],
  ta: ['சூரியன்', 'சந்திரன்', 'செவ்வாய்', 'புதன்', 'குரு', 'சுக்கிரன்', 'சனி', 'ராகு', 'கேது']
};

export function localizedSign(sign: string, lang: LangCode): string {
  const t = translatedLang(lang);
  const index = SIGNS.findIndex(s => s.toLowerCase() === sign.trim().toLowerCase());
  return t === 'en' || index < 0 ? sign : SIGN_NAMES[t][index];
}

export function localizedPlanet(planet: string, lang: LangCode): string {
  const t = translatedLang(lang);
  const index = PLANETS.findIndex(p => p.toLowerCase() === planet.trim().toLowerCase());
  return t === 'en' || index < 0 ? planet : PLANET_NAMES[t][index];
}

const HOUSE_ORDINALS: Record<'hi' | 'ta', string[]> = {
  hi: ['', 'पहले', 'दूसरे', 'तीसरे', 'चौथे', 'पाँचवें', 'छठे', 'सातवें', 'आठवें', 'नौवें', 'दसवें', 'ग्यारहवें', 'बारहवें'],
  ta: ['', 'முதல்', 'இரண்டாம்', 'மூன்றாம்', 'நான்காம்', 'ஐந்தாம்', 'ஆறாம்', 'ஏழாம்', 'எட்டாம்', 'ஒன்பதாம்', 'பத்தாம்', 'பதினொன்றாம்', 'பன்னிரண்டாம்']
};

function englishOrdinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** "your 7th house" / "आपके सातवें भाव में" / "உங்கள் ஏழாம் வீட்டில்". */
export function inHouse(house: number, lang: LangCode): string {
  const t = translatedLang(lang);
  if (t === 'en' || house < 1 || house > 12) return `in your ${englishOrdinal(house)} house`;
  return t === 'hi' ? `आपके ${HOUSE_ORDINALS.hi[house]} भाव में` : `உங்கள் ${HOUSE_ORDINALS.ta[house]} வீட்டில்`;
}

/** "14°26′" -> degrees and minutes spoken in the conversation language. */
export function spokenDegree(degree: string, lang: LangCode): string {
  const match = degree.match(/(\d+)\D+(\d+)/);
  if (!match) return degree;
  const deg = Number(match[1]);
  const min = Number(match[2]);
  const t = translatedLang(lang);
  if (t === 'hi') return `${spokenNumber(deg, lang)} अंश ${spokenNumber(min, lang)} कला`;
  if (t === 'ta') return `${spokenNumber(deg, lang)} டிகிரி ${spokenNumber(min, lang)} நிமிடம்`;
  return `${deg} degrees ${min} minutes`;
}

/** "Venus / Mercury" (Mahadasha / Antardasha) in words. */
export function spokenDasha(dasha: string, lang: LangCode): string {
  const lords = dasha.split('/').map(part => part.trim()).filter(Boolean);
  const t = translatedLang(lang);
  if (t === 'hi') {
    if (lords.length > 1) return `${localizedPlanet(lords[0], lang)} महादशा और ${localizedPlanet(lords[1], lang)} अंतर्दशा`;
    return lords[0] ? `${localizedPlanet(lords[0], lang)} दशा` : 'अभी निर्धारित नहीं';
  }
  if (t === 'ta') {
    if (lords.length > 1) return `${localizedPlanet(lords[0], lang)} மகா தசை, ${localizedPlanet(lords[1], lang)} புத்தி`;
    return lords[0] ? `${localizedPlanet(lords[0], lang)} தசை` : 'இன்னும் தீர்மானிக்கப்படவில்லை';
  }
  return lords.length > 1 ? `${lords[0]} and ${lords[1]}` : (lords[0] || 'not yet determined');
}

/* ------------------------------------------------------------------ */
/* Chapter transition sentences and how they are recognised            */
/* ------------------------------------------------------------------ */

/**
 * The exact sentence Jyotishi speaks as a chapter opens. The app opens the chapter when it
 * hears one of these, so the agent prompt (backend) quotes them verbatim; keep both in sync.
 */
export const TRANSITION_SENTENCES: Record<TranslatedLang, Record<ChapterKey, string>> = {
  en: {
    intro: 'Returning to Arrival now.',
    sky: 'The Birth Sky is opening now.',
    kundli: 'Your Kundli is opening now.',
    palm: 'Palmistry is opening now.',
    thread: 'The Cosmic Thread is opening now.'
  },
  hi: {
    intro: 'Returning to Arrival now.',
    sky: 'जन्म आकाश अब खुल रहा है।',
    kundli: 'आपकी कुंडली अब खुल रही है।',
    palm: 'हस्तरेखा अब खुल रही है।',
    thread: 'कॉस्मिक थ्रेड अब खुल रहा है।'
  },
  ta: {
    intro: 'Returning to Arrival now.',
    sky: 'பிறப்பு வானம் இப்போது திறக்கிறது.',
    kundli: 'உங்கள் ஜாதகம் இப்போது திறக்கிறது.',
    palm: 'கைரேகை இப்போது திறக்கிறது.',
    thread: 'காஸ்மிக் நூல் இப்போது திறக்கிறது.'
  }
};

export function transitionSentence(scene: ChapterKey, lang: LangCode): string {
  return TRANSITION_SENTENCES[translatedLang(lang)][scene];
}

// Chapter names as they may be spoken or transcribed. Tamil and Hindi attach suffixes to
// nouns (ஜாதகம் -> ஜாதகத்தை), so these are stems matched without a trailing boundary.
const CHAPTER_NOUNS: Record<'sky' | 'kundli' | 'palm' | 'thread', RegExp> = {
  sky: /(?:जन्म\s*-?\s*आकाश|बर्थ\s*स्काई|பிறப்பு\s*வான|பிறப்பு\s*ஆகாய|பர்த்\s*ஸ்கை)/u,
  kundli: /(?:कुंडली|कुण्डली|ஜாதக|குண்டலி)/u,
  palm: /(?:हस्त\s*रेखा|पामिस्ट्री|கைரேகை|பாமிஸ்ட்ரி)/u,
  thread: /(?:कॉस्मिक\s*(?:थ्रेड|धागा)|ब्रह्मांडीय\s*धागा|காஸ்மிக்\s*(?:நூல|த்ரெட்|திரெட்)|பிரபஞ்ச\s*நூல)/u
};

// Present-continuous "is opening now" forms. Infinitives ("to open", "खोलने के लिए",
// "திறக்க") are deliberately excluded so a sentence like "to open your Birth Sky, tell me
// your birth time" never navigates.
const OPENING_NOW = /(?:खुल\s*(?:रहा|रही|रहे)\s*(?:है|हैं)|खोल\s*(?:रहा|रही)\s*(?:हूँ|हूं)|திறக்கிறது|திறக்கிறேன்|திறக்கப்படுகிறது)/u;

/**
 * Chapter named by a localized "<chapter> is opening now" sentence, if any. English
 * patterns live in App.tsx; this covers Hindi and Tamil.
 */
export function sceneFromLocalizedTransition(text: string): Exclude<ChapterKey, 'intro'> | undefined {
  for (const sentence of text.match(/[^.!?।]+[.!?।]?/gu) ?? []) {
    if (!OPENING_NOW.test(sentence)) continue;
    for (const scene of ['sky', 'kundli', 'palm', 'thread'] as const) {
      if (CHAPTER_NOUNS[scene].test(sentence)) return scene;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Understanding what the USER asked for, in any language              */
/* ------------------------------------------------------------------ */

const NEXT_SECTION = [
  /\b(?:move|go|continue|proceed|advance)?\s*(?:to\s+)?(?:the\s+)?next\s+(?:section|chapter)\b/i,
  /\bagl[ae]\s+(?:section|chapter|bhag|adhyay)\b/i,
  /अगल[ेा]\s*(?:सेक्शन|भाग|अध्याय|चरण|खंड)/u,
  /அடுத்த\s*(?:பகுதி|பிரிவு|அத்தியாயம்|செக்ஷன்|சேப்டர்)/u
];

export function isLocalizedNextSectionRequest(text: string): boolean {
  return NEXT_SECTION.some(pattern => pattern.test(text));
}

const NAVIGATION_VERBS = /(?:खोल|दिखा|जाओ|जाइए|जाएं|चलो|चलिए|ले\s*चल|ले\s*जा|பார்க்க|காட்டு|திற|போ(?:ங்க|கலாம்|வோம்)?(?:\s|$)|செல்|கொண்டு\s*செல்|அழைத்து\s*செல்)/u;

/** Chapter the user asked to open or go to, in Hindi or Tamil. */
export function localizedChapterRequest(text: string): Exclude<ChapterKey, 'intro'> | undefined {
  if (!NAVIGATION_VERBS.test(text)) return undefined;
  for (const scene of ['sky', 'kundli', 'palm', 'thread'] as const) {
    if (CHAPTER_NOUNS[scene].test(text)) return scene;
  }
  return undefined;
}

// Planet names as spoken in Hindi and Tamil. Tamil and Hindi inflect nouns
// ("சூரியனை", "गुरु से"), so these are stems; weekday names that share a stem
// (मंगलवार, சனிக்கிழமை) are excluded.
const LOCALIZED_PLANETS: Array<{ planet: (typeof PLANETS)[number]; pattern: RegExp }> = [
  { planet: 'Sun', pattern: /(?:सूर्य|सूरज|சூரிய|(?<![\u0B80-\u0BFF])சன்(?![\u0B80-\u0BFF])|(?<![\u0900-\u097F])सन(?![\u0900-\u097F]))/u },
  { planet: 'Moon', pattern: /(?:चंद्र|चन्द्र|चांद|चाँद|சந்திர|(?<![\u0B80-\u0BFF])மூன்(?![\u0B80-\u0BFF])|(?<![\u0900-\u097F])मून(?![\u0900-\u097F]))/u },
  { planet: 'Mars', pattern: /(?:मंगल(?!वार)|செவ்வாய்|மார்ஸ்|मार्स)/u },
  { planet: 'Mercury', pattern: /(?:बुध(?!वार)|புதன்|மெர்குரி|மர்குரி|मर्करी|मरकरी)/u },
  { planet: 'Jupiter', pattern: /(?:बृहस्पति|गुरु(?!वार)|வியாழன்|குரு|ஜூபிடர்|ஜுபிடர்|ஜூபிட்டர்|जुपिटर|ज्यूपिटर)/u },
  { planet: 'Venus', pattern: /(?:शुक्र(?!वार)|சுக்கிர|வெள்ளி(?!க்?\s*கிழமை)|வீனஸ்|वीनस)/u },
  { planet: 'Saturn', pattern: /(?:शनि(?!वार)|சனி(?!க்?\s*கிழமை)|சாட்டர்ன்|சாடர்ன்|சேட்டர்ன்|சாத்தான்|सैटर्न)/u },
  { planet: 'Rahu', pattern: /(?:राहु|ராகு)/u },
  { planet: 'Ketu', pattern: /(?:केतु|கேது)/u }
];

/** Every Hindi/Tamil planet mention in `text`, in the order spoken. */
export function localizedPlanetMentions(text: string): Array<{ planet: string; index: number }> {
  const found: Array<{ planet: string; index: number }> = [];
  for (const { planet, pattern } of LOCALIZED_PLANETS) {
    const match = pattern.exec(text);
    if (match) found.push({ planet, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/* Kundli remedy / subject words as spoken in Hindi and Tamil (stems; both languages inflect). */
const GUIDANCE_PATTERNS = {
  puja: /(?:पूजा|पूजन|मंदिर|अनुष्ठान|பூஜை|பூசை|கோவில்|கோயில்|வழிபாடு|ஹோமம்)/u,
  mantra: /(?:मंत्र|मन्त्र|जाप|மந்திர|மந்த்ர|ஜபம்)/u,
  gemstone: /(?:रत्न|नगीना|मोती|मूंगा|पुखराज|नीलम|पन्ना|ரத்தின|மாணிக்க|முத்து|பவளம்|நீலம்)/u,
  practice: /(?:व्रत|उपवास|दान|सेवा|விரதம்|உபவாசம்|தானம்|சேவை)/u,
  general: /(?:उपाय|परिहार|उपचार|मार्गदर्शन|पारंपरिक|பரிகார|வழிகாட்டு|பாரம்பரிய)/u
} as const;

export type LocalizedGuidanceKind = 'puja' | 'mantra' | 'gemstone' | 'practice';

/** Is this a Hindi/Tamil request for remedies or traditional guidance? */
export function isLocalizedGuidanceRequest(text: string): boolean {
  return Object.values(GUIDANCE_PATTERNS).some(pattern => pattern.test(text));
}

export function localizedGuidanceKind(text: string): LocalizedGuidanceKind | undefined {
  for (const kind of ['puja', 'mantra', 'gemstone', 'practice'] as const) {
    if (GUIDANCE_PATTERNS[kind].test(text)) return kind;
  }
  return undefined;
}

/** Hindi/Tamil words for chart subjects (lagna, dasha, house, nakshatra, dosha, kundli). */
export function mentionsLocalizedKundliSubject(text: string): boolean {
  return /(?:लग्न|दशा|भाव|नक्षत्र|राशि|कुंडली|कुण्डली|दोष|मांगलिक|कालसर्प|साढ़ेसाती|லக்ன|தசை|திசை|வீடு|நட்சத்திரம்|ராசி|ஜாதகம்|தோஷம்|செவ்வாய்\s*தோஷம்|காலசர்ப்ப|ஏழரை)/u.test(text);
}

/* ------------------------------------------------------------------ */
/* Scripted chapter introductions                                      */
/* ------------------------------------------------------------------ */

export type SunPlacement = { sign: string; house: number; degree: string };

export function birthSkyIntro(sun: SunPlacement | undefined, lang: LangCode): string {
  const t = translatedLang(lang);
  if (t === 'hi') {
    const placement = sun
      ? `सूर्य ${inHouse(sun.house, lang)}, ${localizedSign(sun.sign, lang)} राशि में, ${spokenDegree(sun.degree, lang)} पर है।`
      : 'सूर्य से शुरुआत करते हैं।';
    return `जन्म आकाश अब खुल गया है। चलिए सूर्य से शुरू करते हैं। ${placement} यह स्थिति परंपरागत रूप से आत्म-अभिव्यक्ति, संवाद, सीखने और अपने विचार साझा करने के आत्मविश्वास पर ज़ोर देती है। आप मुझे कभी भी टोक सकते हैं या किसी दूसरे ग्रह के बारे में पूछ सकते हैं।`;
  }
  if (t === 'ta') {
    const placement = sun
      ? `சூரியன் ${inHouse(sun.house, lang)}, ${localizedSign(sun.sign, lang)} ராசியில், ${spokenDegree(sun.degree, lang)} இடத்தில் உள்ளது.`
      : 'சூரியனிலிருந்து தொடங்குவோம்.';
    return `பிறப்பு வானம் இப்போது திறந்துள்ளது. சூரியனிலிருந்து தொடங்கலாம். ${placement} இந்த நிலை பாரம்பரியமாக சுய வெளிப்பாடு, தகவல் தொடர்பு, கற்றல் மற்றும் உங்கள் கருத்துகளைப் பகிரும் தன்னம்பிக்கையை வலியுறுத்துகிறது. நீங்கள் எப்போது வேண்டுமானாலும் குறுக்கிடலாம் அல்லது வேறு கிரகத்தைப் பற்றிக் கேட்கலாம்.`;
  }
  const placement = sun
    ? `The Sun is in ${sun.sign} in your ${englishOrdinal(sun.house)} house at ${spokenDegree(sun.degree, lang)}.`
    : 'The Sun opens your birth sky.';
  return `The Birth Sky is now open. Let us begin with the Sun. ${placement} This placement traditionally emphasizes self-expression, communication, learning, and the confidence to share your ideas. You can interrupt me at any time or ask about another planet.`;
}

export type KundliFacts = { lagna: string; moonSign: string; dasha: string };

export function kundliIntro(chart: KundliFacts, lang: LangCode): string {
  const t = translatedLang(lang);
  const dasha = spokenDasha(chart.dasha, lang);
  if (t === 'hi') {
    return `आपकी कुंडली अब खुल गई है। वही नौ ग्रहों की स्थितियाँ इस वैदिक कुंडली में दिखाई गई हैं। आपका लग्न ${localizedSign(chart.lagna, lang)} है, आपकी चंद्र राशि ${localizedSign(chart.moonSign, lang)} है, और आपकी वर्तमान दशा ${dasha} है। हम किसी ग्रह, भाव, दशा, दोष, रत्न, मंत्र, पूजा या पारंपरिक मार्गदर्शन पर बात कर सकते हैं। क्या आप चाहेंगे कि हम आपके लग्न, चंद्र राशि, वर्तमान दशा या किसी विशेष ग्रह से शुरू करें?`;
  }
  if (t === 'ta') {
    return `உங்கள் ஜாதகம் இப்போது திறந்துள்ளது. அதே ஒன்பது கிரக நிலைகள் இந்த வேத ஜாதகத்தில் காட்டப்பட்டுள்ளன. உங்கள் லக்னம் ${localizedSign(chart.lagna, lang)}, உங்கள் சந்திர ராசி ${localizedSign(chart.moonSign, lang)}, உங்கள் தற்போதைய தசை ${dasha}. ஒரு கிரகம், வீடு, தசை, தோஷம், ரத்தினம், மந்திரம், பூஜை அல்லது பாரம்பரிய வழிகாட்டுதல் பற்றிப் பேசலாம். உங்கள் லக்னம், சந்திர ராசி, தற்போதைய தசை அல்லது ஒரு குறிப்பிட்ட கிரகத்திலிருந்து தொடங்கலாமா?`;
  }
  return `Your Kundli is now open. The same nine Navagraha placements are translated into this Vedic chart. Your Lagna is ${chart.lagna}, your Moon sign is ${chart.moonSign}, and your current illustrative Dasha is ${dasha}. We can explore a planet, house, Dasha, Dosha, gemstone, mantra, puja, or traditional guidance. Would you like me to begin with your Lagna, Moon sign, current Dasha, or a specific planet?`;
}

export function palmistryIntro(lang: LangCode): string {
  const t = translatedLang(lang);
  if (t === 'hi') {
    return 'हस्तरेखा अब खुल गई है। कृपया पाम कैमरा खोलें, एक खुली हथेली को गाइड के भीतर रखें, और जब वह बीच में, सीधी और स्थिर हो तब उसे कैप्चर करें। कैप्चर के बाद हम हृदय रेखा, मस्तिष्क रेखा, जीवन रेखा और भाग्य रेखा को एक-एक करके देखेंगे।';
  }
  if (t === 'ta') {
    return 'கைரேகை இப்போது திறந்துள்ளது. தயவுசெய்து பாம் கேமராவைத் திறந்து, ஒரு திறந்த உள்ளங்கையை வழிகாட்டிக்குள் வைத்து, அது நடுவில், நேராக, அசையாமல் இருக்கும்போது படம் எடுக்கவும். அதன் பிறகு இதய ரேகை, தலை ரேகை, ஆயுள் ரேகை, விதி ரேகை ஆகியவற்றை ஒவ்வொன்றாகப் பார்ப்போம்.';
  }
  return 'Palmistry is now open. Please open the Palm Camera, place one open palm inside the guide, and capture your palm when it is centered, upright, and steady. After the capture, I can guide you through the Heart line, Head line, Life line, and Fate line step by step.';
}

/** Spoken when the birth place could not be found, so no chart was made. Never name a chart that is not theirs. */
export function placeNotFoundLine(place: string | undefined, lang: LangCode): string {
  const t = translatedLang(lang);
  const named = place?.trim();
  if (t === 'hi') {
    return named
      ? `मुझे "${named}" जगह नहीं मिल पाई। क्या आप पास का कोई बड़ा शहर या ज़िला बता सकते हैं?`
      : 'मैं अभी आपकी कुंडली तैयार नहीं कर पाया। कृपया अपना जन्म स्थान फिर से बताइए, या पास का कोई बड़ा शहर बताइए।';
  }
  if (t === 'ta') {
    return named
      ? `"${named}" என்ற இடத்தை என்னால் கண்டுபிடிக்க முடியவில்லை. அருகிலுள்ள ஒரு பெரிய நகரம் அல்லது மாவட்டத்தைச் சொல்ல முடியுமா?`
      : 'இப்போது உங்கள் ஜாதகத்தைத் தயாரிக்க முடியவில்லை. உங்கள் பிறந்த இடத்தை மீண்டும் சொல்லுங்கள், அல்லது அருகிலுள்ள பெரிய நகரத்தைச் சொல்லுங்கள்.';
  }
  return named
    ? `I could not find "${named}" on my map, so I cannot make your chart yet. Could you tell me a larger town or the district nearby?`
    : 'I could not prepare your chart just now. Please tell me your birth place again, or a larger town nearby.';
}

export function cosmicThreadIntro(lang: LangCode): string {
  const t = translatedLang(lang);
  if (t === 'hi') {
    return 'कॉस्मिक थ्रेड अब खुल गया है। यह टाइमलाइन आपके गणना किए गए चार्ट के विषयों और ग्रहों की अवधियों को एक मार्गदर्शित यात्रा में जोड़ती है। आप वर्तमान चरण, आने वाली अवधि या जीवन के किसी विषय के बारे में पूछ सकते हैं।';
  }
  if (t === 'ta') {
    return 'காஸ்மிக் நூல் இப்போது திறந்துள்ளது. இந்தக் காலவரிசை உங்கள் கணக்கிடப்பட்ட ஜாதகத்தின் கருப்பொருள்களையும் கிரகக் காலங்களையும் ஒரு வழிகாட்டப்பட்ட பயணமாக இணைக்கிறது. தற்போதைய கட்டம், வரவிருக்கும் காலம் அல்லது வாழ்க்கைத் தலைப்பு பற்றிக் கேட்கலாம்.';
  }
  return 'The Cosmic Thread is now open. This timeline connects your calculated chart themes and planetary periods into one guided journey. Ask me about the current phase, an upcoming period, or a life theme you want to explore.';
}

// --- Palmistry ----------------------------------------------------------------------------------
// The palm analysis arrives from the backend with English names and readings. Spoken (/speak)
// palm lines must follow the conversation language, so Hindi and Tamil text lives here.

export type PalmLineKey = 'heart_line' | 'head_line' | 'life_line' | 'fate_line';

const PALM_NAMES: Record<'hi' | 'ta', Record<PalmLineKey, string>> = {
  hi: { heart_line: 'हृदय रेखा', head_line: 'मस्तिष्क रेखा', life_line: 'जीवन रेखा', fate_line: 'भाग्य रेखा' },
  ta: { heart_line: 'இதய ரேகை', head_line: 'தலை ரேகை', life_line: 'ஆயுள் ரேகை', fate_line: 'விதி ரேகை' }
};

const PALM_READINGS: Record<'hi' | 'ta', Record<PalmLineKey, string>> = {
  hi: {
    heart_line: 'पारंपरिक रूप से यह रेखा भावनात्मक अभिव्यक्ति और रिश्तों की शैली से जुड़ी मानी जाती है।',
    head_line: 'पारंपरिक रूप से यह रेखा सोचने की शैली, एकाग्रता और निर्णय लेने से जुड़ी मानी जाती है।',
    life_line: 'पारंपरिक रूप से यह रेखा जीवन-शक्ति के विषयों से जुड़ी मानी जाती है; इससे आयु का अनुमान नहीं लगाना चाहिए।',
    fate_line: 'पारंपरिक रूप से यह रेखा दिशा, कार्य और जीवन-पथ के बड़े बदलावों से जुड़ी मानी जाती है।'
  },
  ta: {
    heart_line: 'பாரம்பரியமாக இது உணர்வு வெளிப்பாடு மற்றும் உறவு பாணியுடன் தொடர்புடையதாகக் கருதப்படுகிறது.',
    head_line: 'பாரம்பரியமாக இது சிந்தனை முறை, கவனம் மற்றும் முடிவெடுக்கும் திறனுடன் தொடர்புடையதாகக் கருதப்படுகிறது.',
    life_line: 'பாரம்பரியமாக இது உயிர்ச்சக்தி தொடர்பான கருப்பொருள்களுடன் தொடர்புடையது; இதைக் கொண்டு ஆயுளைக் கணிக்கக் கூடாது.',
    fate_line: 'பாரம்பரியமாக இது திசை, தொழில் மற்றும் வாழ்க்கைப் பாதையின் பெரிய மாற்றங்களுடன் தொடர்புடையதாகக் கருதப்படுகிறது.'
  }
};

export type PalmLineText = { id: PalmLineKey; name: string; traditionalReading: string; observation?: string };

/** Line name in the conversation language (English keeps the backend's name). */
export function palmLineName(line: PalmLineText, lang: LangCode): string {
  const t = translatedLang(lang);
  return t === 'en' ? line.name : PALM_NAMES[t][line.id];
}

/** Traditional reading in the conversation language (English keeps the backend's text). */
export function palmLineReading(line: PalmLineText, lang: LangCode): string {
  const t = translatedLang(lang);
  return t === 'en' ? line.traditionalReading : PALM_READINGS[t][line.id];
}

/** Optional "It appears ..." remark. The observation is free English from the vision model, so it is only spoken in English. */
function palmMorphology(line: PalmLineText, lang: LangCode): string {
  if (translatedLang(lang) !== 'en') return '';
  return line.observation && line.observation !== 'indeterminate' ? ` It appears ${line.observation}.` : '';
}

export function palmOpening(first: PalmLineText, second: PalmLineText | undefined, lang: LangCode): string {
  const t = translatedLang(lang);
  const a = palmLineName(first, lang);
  const b = second ? palmLineName(second, lang) : '';
  const reading = `${a}: ${palmLineReading(first, lang)}${palmMorphology(first, lang)}`;
  if (t === 'hi') {
    return `अब मुझे आपकी हथेली की मुख्य रेखाएँ दिख रही हैं। मैं आपकी ${a} से शुरू करता हूँ। ${reading}${b ? ` उसके बाद हम आपकी ${b} देखेंगे।` : ''}`;
  }
  if (t === 'ta') {
    return `இப்போது உங்கள் உள்ளங்கையின் முக்கிய ரேகைகள் எனக்குத் தெரிகின்றன. உங்கள் ${a}யிலிருந்து தொடங்குகிறேன். ${reading}${b ? ` அதன் பிறகு உங்கள் ${b}யைப் பார்ப்போம்.` : ''}`;
  }
  return `I can see your major palm lines now. Let me begin with your ${a}. ${reading}${b ? ` After that, we can look at your ${b}.` : ''}`;
}

export function palmRetakeMessage(lang: LangCode): string {
  const t = translatedLang(lang);
  if (t === 'hi') return 'मुझे आपकी हथेली दिख रही है, लेकिन भरोसेमंद मार्गदर्शित पाठ के लिए मुख्य रेखाएँ अभी पर्याप्त साफ़ नहीं हैं। कृपया हथेली को सीधी रखकर, कैमरे के पास और समान रोशनी में दोबारा कैप्चर करें।';
  if (t === 'ta') return 'உங்கள் உள்ளங்கை எனக்குத் தெரிகிறது, ஆனால் நம்பகமான வழிகாட்டப்பட்ட வாசிப்புக்கு முக்கிய ரேகைகள் இன்னும் போதுமான அளவு தெளிவாக இல்லை. தயவுசெய்து உள்ளங்கையை நேராக, கேமராவுக்கு அருகில், சீரான வெளிச்சத்தில் மீண்டும் படம் எடுக்கவும்.';
  return 'I can see your palm, but the major lines are not clear enough for a reliable guided reading yet. Please retake it with your palm flat, close to the camera, and evenly lit.';
}

const PALM_DISCLAIMER = {
  en: 'This is a traditional palmistry-style interpretation, not a medical or scientific assessment.',
  hi: 'यह एक पारंपरिक हस्तरेखा-शैली की व्याख्या है, कोई चिकित्सीय या वैज्ञानिक आकलन नहीं।',
  ta: 'இது ஒரு பாரம்பரிய கைரேகை பாணி விளக்கம்; மருத்துவ அல்லது அறிவியல் மதிப்பீடு அல்ல.'
};

/** Spoken fallback when the agent was asked about one line but produced no speech. */
export function palmLineFallback(line: PalmLineText | undefined, lineId: PalmLineKey, status: string | undefined, lang: LangCode): string {
  const t = translatedLang(lang);
  const name = line ? palmLineName(line, lang) : (t === 'en' ? lineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : PALM_NAMES[t][lineId]);
  const lead = t === 'hi' ? `आइए आपकी ${name} पर ध्यान दें।` : t === 'ta' ? `உங்கள் ${name}யைப் பற்றிப் பார்ப்போம்.` : `Let us focus on your ${name}.`;
  if (!line) {
    return t === 'hi' ? `${lead} इस रेखा का स्पष्ट कैप्चर किया हुआ पाठ मेरे पास अभी नहीं है। अधिक भरोसेमंद व्याख्या के लिए कृपया तेज़ और समान रोशनी में हथेली दोबारा कैप्चर करें।`
      : t === 'ta' ? `${lead} இந்த ரேகைக்கான தெளிவான வாசிப்பு என்னிடம் இன்னும் இல்லை. மேலும் நம்பகமான விளக்கத்திற்கு, பிரகாசமான சீரான வெளிச்சத்தில் உள்ளங்கையை மீண்டும் படம் எடுக்கவும்.`
      : `${lead} I do not have a clear captured reading for that line yet, so please retake the palm image in brighter, even lighting if you would like a more grounded interpretation.`;
  }
  if (status === 'not_clear' || status === 'estimated') {
    return t === 'hi' ? `${lead} कैप्चर की गई तस्वीर में यह रेखा साफ़ नहीं थी, इसलिए गाइड सामान्य हथेली की बनावट के आधार पर रखा गया है। मैं इससे पक्का पाठ नहीं दे सकता। कृपया हथेली सीधी, पास और समान रोशनी में रखकर दोबारा कैप्चर करें।`
      : t === 'ta' ? `${lead} படத்தில் இந்த ரேகை தெளிவாக இல்லை, அதனால் வழிகாட்டி பொதுவான உள்ளங்கை அமைப்பின் அடிப்படையில் வைக்கப்பட்டுள்ளது. இதிலிருந்து உறுதியான வாசிப்பை நான் தர முடியாது. உள்ளங்கையை நேராக, அருகில், சீரான வெளிச்சத்தில் வைத்து மீண்டும் படம் எடுக்கவும்.`
      : `${lead} This guide is placed from typical palm anatomy because the crease was not clear enough in the captured image. I should not make a confident reading from it. You can retake the image with your palm flat, close and evenly lit.`;
  }
  return `${lead} ${palmLineReading(line, lang)}${palmMorphology(line, lang)} ${PALM_DISCLAIMER[t]}`;
}

/** Which palm line does a Hindi/Tamil agent turn start with? (first 280 chars, like the English matcher) */
export function palmLineFromLocalizedText(text: string): PalmLineKey | undefined {
  const opening = text.slice(0, 280);
  const stems: Array<[PalmLineKey, RegExp]> = [
    ['heart_line', /हृदय\s*रेखा|ह्रदय\s*रेखा|இதய\s*ரேகை/],
    ['head_line', /मस्तिष्क\s*रेखा|दिमाग़?\s*की\s*रेखा|தலை\s*ரேகை/],
    ['life_line', /जीवन\s*रेखा|ஆயுள்\s*ரேகை|உயிர்\s*ரேகை/],
    ['fate_line', /भाग्य\s*रेखा|விதி\s*ரேகை|அதிர்ஷ்ட\s*ரேகை/]
  ];
  const hits = stems.map(([id, re]) => ({ id, at: opening.search(re) })).filter(h => h.at >= 0).sort((x, y) => x.at - y.at);
  return hits[0]?.id;
}

/** Remove quoted passages so a quoted example ("Palmistry is opening now.") is not read as a command. */
export function stripQuotedText(text: string): string {
  return text
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/(^|[\s(])['‘][^'‘’]*['’]/g, '$1 ');
}

/**
 * Is this one of the application's own scripted phrases (chapter transition sentence)?
 * Some Conversational AI builds hand the agent's words back as USER transcription, so a
 * "user" line that is exactly a transition sentence is never real speech and must not
 * count as the user speaking, switch the language, or cancel an introduction.
 */
export function isScriptedAgentPhrase(text: string): boolean {
  return /\b(?:the birth sky|your kundli|kundli|palmistry|the cosmic thread) is opening now\b/i.test(text)
    || /\breturning to arrival now\b/i.test(text)
    || /\bi have everything i need\b/i.test(text)
    || /(?:எனக்குத் தேவையான அனைத்தும் கிடைத்துவிட்டன|मुझे जो चाहिए था सब मिल गया)/u.test(text)
    || sceneFromLocalizedTransition(text) !== undefined;
}
