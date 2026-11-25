/**
 * System-prompt rules that make Jyotishi converse naturally in several languages, including
 * code-mixed speech (Hinglish, Tanglish ...) and spoken numbers.
 *
 * Kept free of imports so scripts/verify-language.ts can check it against the frontend.
 *
 * The chapter transition sentences below MUST match frontend/src/lib/language.ts
 * (TRANSITION_SENTENCES): the app opens a chapter when it hears one of them, and the
 * verification script fails if the two drift apart.
 */
export const TRANSITION_PROMPT_SENTENCES = {
  hi: {
    sky: 'जन्म आकाश अब खुल रहा है।',
    kundli: 'आपकी कुंडली अब खुल रही है।',
    palm: 'हस्तरेखा अब खुल रही है।',
    thread: 'कॉस्मिक थ्रेड अब खुल रहा है।'
  },
  ta: {
    sky: 'பிறப்பு வானம் இப்போது திறக்கிறது.',
    kundli: 'உங்கள் ஜாதகம் இப்போது திறக்கிறது.',
    palm: 'கைரேகை இப்போது திறக்கிறது.',
    thread: 'காஸ்மிக் நூல் இப்போது திறக்கிறது.'
  }
} as const;

function transitionTable() {
  const row = (label: string, s: Record<'sky' | 'kundli' | 'palm' | 'thread', string>) =>
    `${label}: Birth Sky "${s.sky}" Kundli "${s.kundli}" Palmistry "${s.palm}" Cosmic Thread "${s.thread}"`;
  return [
    row('Hindi', TRANSITION_PROMPT_SENTENCES.hi),
    row('Tamil', TRANSITION_PROMPT_SENTENCES.ta)
  ].join('; ');
}

export function multilingualPromptRules(): string[] {
  return [
    'MULTILINGUAL CONVERSATION: The speech recognizer understands English, Hindi, Tamil, Telugu, Marathi and Kannada together, and the user may speak or switch between them at any moment, with no announcement. Work out the language of EVERY user message yourself and answer in that language. Follow the user when they switch (for example English to Hindi, or Hindi to Tamil) and when they switch back. Never ask the user to choose a language, to switch language, or to repeat themselves in English. If the user explicitly asks for a language, use it until they change.',
    'CODE-MIXED SPEECH: People often mix languages in one sentence (Hinglish, Tanglish, Hindi or Tamil with English words). Mirror the way the user speaks: keep the sentence in their main language and leave in English the words they themselves use in English. Familiar astrology terms (Lagna, Kundli, Dasha, planet names) may be said in the user\'s language or in English, whichever the user uses. Short or ambiguous replies ("ok", "haan", "sari") do not change the language; keep using the language of the conversation.',
    'SCRIPT: Write each language in its own script (Devanagari for Hindi and Marathi, Tamil script for Tamil, Telugu script, Kannada script). Do not romanise it; the voice engine reads native script correctly. English words inside a sentence may stay in the Latin alphabet. Keep the user\'s name and place names exactly as they were given.',
    'MIS-HEARD SCRIPT: Because several languages are recognised at once, the recognizer sometimes writes English speech in Tamil, Devanagari or another Indian script, as the English words sounded (for example "ஹாபோர்ட் சாட்டர்ன்" or "अबाउट सैटर्न" for "about Saturn"; a Tamil-script "டெல் மீ அபௌட் மை கரியர்" for "tell me about my career"). The script of a message is NOT proof of its language. If the words are English written phonetically, treat the user as speaking English, understand them as the English sentence, and reply in English. Decide by the meaning and the sound of the words, and by what the user has been saying in the last few messages. If a user who was speaking Tamil or Hindi starts speaking English, switch to English at once and stay in it until they change again. Never answer a phonetic English message in Tamil or Hindi just because it is written in that script.',
    'ONE SCRIPT PER WORD: Never mix scripts inside one word (for example Tamil and Devanagari letters together). Write a planet or sign name either in the reply language\'s own script or in English, not a blend of scripts.',
    'NUMBERS IN SPOKEN REPLIES: When you reply in any language other than English, write every number as WORDS in that language, never as digits: degrees, minutes, house numbers, ages, years, dates, durations and counts. For example in Hindi "चौदह अंश छब्बीस कला", in Tamil "பதினான்கு டிகிரி இருபத்து ஆறு நிமிடம்". Digits would be read aloud in English and break the conversation. In English you may use digits.',
    `CHAPTER TRANSITION SENTENCES: The application recognises a chapter opening only from these exact sentences. When the instructions below tell you to say a transition sentence, say the one for the user's current language, word for word. ${transitionTable()}. For any other language (English, Telugu, Kannada, Marathi, ...) say the English sentence given in the instructions. A short lead-in such as "Thank you. I have everything I need." may be in the user's language, but the transition sentence itself must be exact. This rule overrides any English transition sentence quoted elsewhere in these instructions.`
  ];
}
