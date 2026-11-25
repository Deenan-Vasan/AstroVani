// Verifies the multilingual helpers: language detection, spoken numbers, chapter
// transition recognition, Hindi/Tamil navigation and planet requests, localized intros.
// Dependency-free: `npm run verify:language`.
import {
  TRANSITION_SENTENCES, birthSkyIntro, cosmicThreadIntro, detectScriptLanguage, inHouse,
  isLocalizedGuidanceRequest, localizedGuidanceKind, mentionsLocalizedKundliSubject, isLocalizedNextSectionRequest, isScriptedAgentPhrase, isTransliteratedEnglish, kundliIntro, localizedChapterRequest, localizedPlanetMentions,
  nextLanguage, palmistryIntro, palmOpening, palmRetakeMessage, palmLineFallback, palmLineFromLocalizedText, stripQuotedText, sceneFromLocalizedTransition, spokenDasha, spokenDegree, spokenNumber,
  transitionSentence, type ChapterKey, type LangCode
} from '../frontend/src/lib/language.js';
import { TRANSITION_PROMPT_SENTENCES, multilingualPromptRules } from '../backend/src/services/languageGuide.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.log(`  FAIL  ${name} ${detail}`); } else console.log(`  ok    ${name}`);
};
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, actual === expected, `(got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);

// --- detection ---------------------------------------------------------------------------
eq('Tamil script -> ta', detectScriptLanguage('என் பெயர் ராஜ்'), 'ta');
eq('Devanagari -> hi', detectScriptLanguage('मेरा नाम राज है'), 'hi');
eq('Marathi markers -> mr', detectScriptLanguage('माझे नाव राज आहे'), 'mr');
eq('Telugu -> te', detectScriptLanguage('నా పేరు రాజ్'), 'te');
eq('Kannada -> kn', detectScriptLanguage('ನನ್ನ ಹೆಸರು ರಾಜ್'), 'kn');
eq('Latin -> latin', detectScriptLanguage('my name is Raj'), 'latin');
eq('code-mixed Hindi + English words -> hi', detectScriptLanguage('मेरा name Raj है'), 'hi');
eq('no letters -> undefined', detectScriptLanguage('123 ...'), undefined);

eq('sticky: short Latin keeps Tamil', nextLanguage('ta', 'ok'), 'ta');
eq('sticky: romanised Hindi keeps Hindi', nextLanguage('hi', 'haan theek hai'), 'hi');
eq('clear English sentence switches to English', nextLanguage('ta', 'what is my moon sign'), 'en');
eq('Tamil script switches from English', nextLanguage('en', 'நன்றி'), 'ta');
eq('Hindi mid-conversation from English', nextLanguage('en', 'अब हिंदी में बात करते हैं'), 'hi');
eq('explicit "speak in Hindi"', nextLanguage('en', 'please speak in Hindi'), 'hi');
eq('explicit Tamil request', nextLanguage('en', 'தமிழில் பேசுங்கள்'), 'ta');
eq('explicit English request from Hindi', nextLanguage('hi', 'अंग्रेजी में बोलो'), 'en');
eq('empty input keeps language', nextLanguage('ta', '   '), 'ta');

// --- numbers ------------------------------------------------------------------------------
eq('Hindi 14', spokenNumber(14, 'hi'), 'चौदह');
eq('Hindi 26', spokenNumber(26, 'hi'), 'छब्बीस');
eq('Hindi 99', spokenNumber(99, 'hi'), 'निन्यानवे');
eq('Hindi 0', spokenNumber(0, 'hi'), 'शून्य');
eq('Tamil 14', spokenNumber(14, 'ta'), 'பதினான்கு');
eq('Tamil 26', spokenNumber(26, 'ta'), 'இருபத்து ஆறு');
eq('Tamil 40', spokenNumber(40, 'ta'), 'நாற்பது');
eq('Marathi uses Hindi numbers', spokenNumber(7, 'mr'), 'सात');
eq('English stays digits', spokenNumber(14, 'en'), '14');
eq('out of range stays digits', spokenNumber(120, 'hi'), '120');
check('Hindi table has no duplicates', new Set(Array.from({ length: 100 }, (_, i) => spokenNumber(i, 'hi'))).size === 100);
check('Tamil 0..99 all non-empty and distinct', new Set(Array.from({ length: 100 }, (_, i) => spokenNumber(i, 'ta'))).size === 100);

eq('Hindi degree', spokenDegree('14°26′', 'hi'), 'चौदह अंश छब्बीस कला');
eq('Tamil degree', spokenDegree('14°26′', 'ta'), 'பதினான்கு டிகிரி இருபத்து ஆறு நிமிடம்');
eq('English degree', spokenDegree('14°26′', 'en'), '14 degrees 26 minutes');
eq('Hindi house', inHouse(7, 'hi'), 'आपके सातवें भाव में');
eq('Tamil house', inHouse(12, 'ta'), 'உங்கள் பன்னிரண்டாம் வீட்டில்');
eq('English house', inHouse(3, 'en'), 'in your 3rd house');
eq('Hindi dasha', spokenDasha('Venus / Mercury', 'hi'), 'शुक्र महादशा और बुध अंतर्दशा');
eq('Tamil dasha', spokenDasha('Venus / Mercury', 'ta'), 'சுக்கிரன் மகா தசை, புதன் புத்தி');

// --- transition sentences are recognised ----------------------------------------------------
const chapters: Array<Exclude<ChapterKey, 'intro'>> = ['sky', 'kundli', 'palm', 'thread'];
for (const lang of ['hi', 'ta'] as const) {
  for (const chapter of chapters) {
    eq(`${lang} transition "${chapter}" recognised`, sceneFromLocalizedTransition(transitionSentence(chapter, lang)), chapter);
    eq(`${lang} transition "${chapter}" recognised inside a longer turn`,
      sceneFromLocalizedTransition(`धन्यवाद। நன்றி. ${transitionSentence(chapter, lang)}`), chapter);
  }
}
for (const lang of ['hi', 'ta'] as const) {
  for (const chapter of chapters) {
    const intro = chapter === 'sky' ? birthSkyIntro({ sign: 'Gemini', house: 7, degree: '14°26′' }, lang)
      : chapter === 'kundli' ? kundliIntro({ lagna: 'Scorpio', moonSign: 'Gemini', dasha: 'Venus / Mercury' }, lang)
      : chapter === 'palm' ? palmistryIntro(lang) : cosmicThreadIntro(lang);
    eq(`${lang} ${chapter} intro does NOT trigger navigation`, sceneFromLocalizedTransition(intro), undefined);
    check(`${lang} ${chapter} intro has no digits (TTS would read them in English)`, !/[0-9]/.test(intro), intro);
  }
}
eq('Hindi infinitive does not navigate', sceneFromLocalizedTransition('अपना जन्म आकाश खोलने के लिए जन्म का समय बताइए।'), undefined);
eq('Tamil infinitive does not navigate', sceneFromLocalizedTransition('உங்கள் ஜாதகத்தைத் திறக்க பிறந்த நேரம் சொல்லுங்கள்.'), undefined);
eq('English text is ignored here', sceneFromLocalizedTransition('The Birth Sky is opening now.'), undefined);
check('every translated chapter sentence is unique per language',
  (['hi', 'ta', 'en'] as const).every(lang => new Set(chapters.map(c => TRANSITION_SENTENCES[lang][c])).size === 4));

// --- user navigation ------------------------------------------------------------------------
eq('Hindi next section', isLocalizedNextSectionRequest('अगले सेक्शन पर चलिए'), true);
eq('Hinglish next section', isLocalizedNextSectionRequest('agla section dikhao'), true);
eq('Tamil next section', isLocalizedNextSectionRequest('அடுத்த பகுதிக்கு செல்லலாம்'), true);
eq('plain chat is not next-section', isLocalizedNextSectionRequest('मुझे अपना भविष्य बताइए'), false);
eq('Hindi open Kundli', localizedChapterRequest('मुझे कुंडली खोलकर दिखाइए'), 'kundli');
eq('Hindi go to palmistry', localizedChapterRequest('हस्तरेखा पर चलिए'), 'palm');
eq('Tamil show horoscope', localizedChapterRequest('ஜாதகத்தைக் காட்டு'), 'kundli');
eq('Tamil open palm reading', localizedChapterRequest('கைரேகையைத் திறக்கவும்'), 'palm');
eq('naming a chapter without a verb does not navigate', localizedChapterRequest('मेरी कुंडली में क्या है?'), undefined);

// --- planet mentions -------------------------------------------------------------------------
const first = (text: string) => localizedPlanetMentions(text)[0]?.planet;
eq('Hindi Jupiter', first('गुरु के बारे में बताइए'), 'Jupiter');
eq('Hindi Mars not Tuesday', first('मंगलवार को क्या करें'), undefined);
eq('Hindi Saturn not Saturday', first('शनिवार का दिन'), undefined);
eq('Hindi Saturn', first('शनि की स्थिति क्या है'), 'Saturn');
eq('Tamil Sun with suffix', first('சூரியனைப் பற்றி சொல்லுங்கள்'), 'Sun');
eq('Tamil Saturn', first('சனி எங்கே இருக்கிறது'), 'Saturn');
eq('Tamil Saturday is not Saturn', first('சனிக்கிழமை'), undefined);
eq('Tamil Jupiter', first('குருவைப் பற்றி'), 'Jupiter');
eq('mentions come back in spoken order', localizedPlanetMentions('राहु और सूर्य').map(m => m.planet).join(','), 'Rahu,Sun');

// --- intros -------------------------------------------------------------------------------
check('English Birth Sky intro unchanged in meaning', /^The Birth Sky is now open\. Let us begin with the Sun\. The Sun is in Gemini in your 7th house at 14 degrees 26 minutes\./.test(
  birthSkyIntro({ sign: 'Gemini', house: 7, degree: '14°26′' }, 'en')));
check('Hindi Birth Sky intro uses Hindi names and words', /मिथुन/.test(birthSkyIntro({ sign: 'Gemini', house: 7, degree: '14°26′' }, 'hi')));
check('Tamil Birth Sky intro uses Tamil names and words', /மிதுனம்/.test(birthSkyIntro({ sign: 'Gemini', house: 7, degree: '14°26′' }, 'ta')));
check('Telugu falls back to English intro', palmistryIntro('te') === palmistryIntro('en'));
check('Marathi uses the Hindi intro', palmistryIntro('mr') === palmistryIntro('hi'));
check('missing Sun is handled in every language', (['en', 'hi', 'ta'] as LangCode[]).every(l => birthSkyIntro(undefined, l).length > 20));

// --- English heard as Tamil/Devanagari letters -------------------------------------------------------
eq('"where is Saturn" in Tamil letters is English', nextLanguage('ta', 'வேர் இஸ் சாத்தான்?'), 'en');
eq('"tell me about" in Tamil letters is English', nextLanguage('ta', 'டெல் மீ அபௌட் மை கரியர்'), 'en');
eq('"what is" in Devanagari letters is English', nextLanguage('hi', 'व्हाट इज़ माय करियर'), 'en');
eq('real Tamil sentence stays Tamil', nextLanguage('ta', 'என் பெயர் ராஜ்'), 'ta');
eq('real Tamil with one loan word stays Tamil', nextLanguage('ta', 'எனக்கு கரியர் பற்றி சொல்லுங்கள்'), 'ta');
eq('real Hindi stays Hindi', nextLanguage('hi', 'मेरा करियर कैसा रहेगा'), 'hi');
eq('single "ஓகே" does not switch', nextLanguage('ta', 'ஓகே'), 'ta');
check('too short to judge', !isTransliteratedEnglish('வேர்'));
eq('transliterated Saturn is a planet mention', first('வேர் இஸ் சாத்தான்'), 'Saturn');
eq('transliterated Jupiter', first('ஜூபிடர் பற்றி சொல்லு'), 'Jupiter');
eq('Devanagari Venus', first('वीनस के बारे में'), 'Venus');

// --- the agent's scripted phrases are never user speech --------------------------------------------
check('English transition phrase is scripted', isScriptedAgentPhrase('Thank you. I have everything I need. The Birth Sky is opening now.'));
check('Tamil transition phrase is scripted', isScriptedAgentPhrase('பிறப்பு வானம் இப்போது திறக்கிறது.'));
check('Hindi transition phrase is scripted', isScriptedAgentPhrase('हस्तरेखा अब खुल रही है।'));
check('real question is not scripted', !isScriptedAgentPhrase('Where is the Moon?') && !isScriptedAgentPhrase('சந்திரன் எங்கே உள்ளது?'));

// --- palm narration follows the conversation language ----------------------------------------------
const heart = { id: 'heart_line' as const, name: 'Heart line', traditionalReading: 'Traditionally associated with emotional expression.', observation: 'long and curved' };
const head = { id: 'head_line' as const, name: 'Head line', traditionalReading: 'Traditionally associated with thinking style.' };
const enOpen = palmOpening(heart, head, 'en');
check('English palm opening keeps backend text', enOpen.includes('Heart line') && enOpen.includes('long and curved') && enOpen.includes('Head line'));
const taOpen = palmOpening(heart, head, 'ta');
check('Tamil palm opening has no English letters', !/[A-Za-z]/.test(taOpen), taOpen);
check('Tamil palm opening names both lines', taOpen.includes('இதய ரேகை') && taOpen.includes('தலை ரேகை'));
const hiOpen = palmOpening(heart, head, 'hi');
check('Hindi palm opening has no English letters', !/[A-Za-z]/.test(hiOpen), hiOpen);
check('Hindi palm opening names both lines', hiOpen.includes('हृदय रेखा') && hiOpen.includes('मस्तिष्क रेखा'));
check('palm opening without a second line is fine', !/undefined/.test(palmOpening(heart, undefined, 'ta')));
for (const lang of ['hi', 'ta'] as const) {
  check(`${lang} retake message has no English letters`, !/[A-Za-z]/.test(palmRetakeMessage(lang)));
  for (const id of ['heart_line', 'head_line', 'life_line', 'fate_line'] as const) {
    const l = { id, name: 'X', traditionalReading: 'Y' };
    check(`${lang} ${id} fallback is fully translated`, !/[A-Za-z]/.test(palmLineFallback(l, id, 'detected', lang)));
    check(`${lang} ${id} unclear fallback is fully translated`, !/[A-Za-z]/.test(palmLineFallback(l, id, 'not_clear', lang)));
    check(`${lang} ${id} missing-line fallback is fully translated`, !/[A-Za-z]/.test(palmLineFallback(undefined, id, undefined, lang)));
  }
}
eq('Tamil heart line recognised', palmLineFromLocalizedText('இதய ரேகை பற்றிப் பார்ப்போம்'), 'heart_line');
eq('Hindi fate line recognised', palmLineFromLocalizedText('अब भाग्य रेखा देखते हैं'), 'fate_line');
eq('Hindi earliest line wins', palmLineFromLocalizedText('जीवन रेखा के बाद हृदय रेखा'), 'life_line');
eq('no palm line -> undefined', palmLineFromLocalizedText('नमस्ते'), undefined);
check('quoted transition is stripped (double quotes)', !/opening now/.test(stripQuotedText('I can say, "Palmistry is opening now." Would you like that?')));
check('quoted transition is stripped (single quotes)', !/opening now/.test(stripQuotedText("I can say, 'Palmistry is opening now.' Would you like that?")));
check('apostrophes are not treated as quotes', stripQuotedText("you're asking, it's fine. Palmistry is opening now.").includes('Palmistry is opening now'));
check('unquoted transition survives', stripQuotedText('Thanks. Palmistry is opening now.').includes('opening now'));

// --- backend prompt stays in sync with the frontend -------------------------------------------
const promptText = multilingualPromptRules().join(' ');
for (const lang of ['hi', 'ta'] as const) {
  for (const chapter of chapters) {
    eq(`prompt sentence ${lang}/${chapter} equals the frontend sentence`, TRANSITION_PROMPT_SENTENCES[lang][chapter], TRANSITION_SENTENCES[lang][chapter]);
    check(`prompt quotes ${lang}/${chapter} sentence`, promptText.includes(TRANSITION_SENTENCES[lang][chapter]));
  }
}
check('prompt tells the model to spell numbers as words', /NUMBERS IN SPOKEN REPLIES/.test(promptText) && /as WORDS/.test(promptText));
check('prompt covers code-mixed speech', /Hinglish/.test(promptText) && /Tanglish/.test(promptText));
check('prompt handles English heard as Indian-script text', /MIS-HEARD SCRIPT/.test(promptText) && /reply in English/.test(promptText) && /switch to English at once/.test(promptText));
check('prompt forbids mixed-script words', /ONE SCRIPT PER WORD/.test(promptText));
check('prompt forbids asking the user to switch language', /Never ask the user to choose a language/.test(promptText));

// --- Kundli guidance words ----------------------------------------------------------------
check('Tamil Rahu-Ketu request names Rahu first', first('இது போதும், எனக்கு ராகு-கேது பற்றி தெரிய வேண்டும்.') === 'Rahu');
check('Tamil puja is guidance', isLocalizedGuidanceRequest('இல்லை, அவர்களுக்குரிய பூஜை.') && localizedGuidanceKind('இல்லை, அவர்களுக்குரிய பூஜை.') === 'puja');
check('Tamil mantra is guidance', localizedGuidanceKind('மந்திரங்கள் பற்றி சொல்லவும்.') === 'mantra');
check('Hindi puja/mantra/gemstone', localizedGuidanceKind('राहु की पूजा') === 'puja' && localizedGuidanceKind('कोई मंत्र बताइए') === 'mantra' && localizedGuidanceKind('कौन सा रत्न पहनें') === 'gemstone');
check('Hindi upay is guidance', isLocalizedGuidanceRequest('इसके लिए क्या उपाय हैं'));
check('Tamil education is not a gemstone', !isLocalizedGuidanceRequest('கல்வி பற்றி சொல்லுங்கள்'));
check('Tamil/Hindi subjects recognised', mentionsLocalizedKundliSubject('என் லக்னம் என்ன') && mentionsLocalizedKundliSubject('मेरी दशा क्या है'));
check('plain chatter is not a subject', !mentionsLocalizedKundliSubject('சரி, நன்றி') && !isLocalizedGuidanceRequest('ठीक है धन्यवाद'));

check('Tamil/Hindi Birth Sky lead-ins count as scripted agent phrases', isScriptedAgentPhrase('நன்றி. எனக்குத் தேவையான அனைத்தும் கிடைத்துவிட்டன.') && isScriptedAgentPhrase('धन्यवाद। मुझे जो चाहिए था सब मिल गया।'));
check('Tamil Birth Sky lead-in plus transition opens the sky', sceneFromLocalizedTransition('நன்றி. எனக்குத் தேவையான அனைத்தும் கிடைத்துவிட்டன. பிறப்பு வானம் இப்போது திறக்கிறது.') === 'sky');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll language checks passed');
process.exit(failures ? 1 : 0);
