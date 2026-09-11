/*
 * SUPERSEDED - no longer imported anywhere.
 *
 * `mockChart` was the single fixed chart every user received. It is replaced by
 * `services/chartGenerator.ts`, which derives a distinct chart from the birth details.
 * `mockPalm` has been unused since before that change. Kept only for reference; safe to
 * delete once you are happy with the generated charts.
 */
export const mockChart = {
  lagna: 'Scorpio',
  moonSign: 'Gemini',
  nakshatra: 'Punarvasu · Pada 2',
  dasha: 'Venus / Mercury',
  planets: [
    { name: 'Sun', sign: 'Capricorn', house: 3, degree: '12°44′', strength: 'Strong' },
    { name: 'Moon', sign: 'Gemini', house: 8, degree: '7°22′', strength: 'Neutral' },
    { name: 'Mars', sign: 'Taurus', house: 7, degree: '24°01′', strength: 'Strong' },
    { name: 'Mercury', sign: 'Scorpio', house: 1, degree: '3°18′', strength: 'Neutral' },
    { name: 'Jupiter', sign: 'Virgo', house: 11, degree: '19°55′', strength: 'Retrograde' },
    { name: 'Venus', sign: 'Aquarius', house: 4, degree: '8°33′', strength: 'Strong' },
    { name: 'Saturn', sign: 'Pisces', house: 5, degree: '11°47′', strength: 'Retrograde' },
    { name: 'Rahu', sign: 'Libra', house: 12, degree: '16°09′', strength: 'Node' },
    { name: 'Ketu', sign: 'Aries', house: 6, degree: '16°09′', strength: 'Node' }
  ]
};

export const mockPalm = {
  hand: 'Right',
  confidence: 0.91,
  summary: 'The image appears usable for a traditional palmistry-style demo reading. The production version should separate visual observations from interpretive claims and avoid medical or longevity conclusions.',
  lines: [
    { name: 'Heart line', visibility: 'clear', traditionalReading: 'Traditionally associated with emotional expression and relationship style.' },
    { name: 'Head line', visibility: 'clear', traditionalReading: 'Traditionally associated with thinking style, focus and decision-making.' },
    { name: 'Life line', visibility: 'moderate', traditionalReading: 'Traditionally associated with vitality themes; it should not be used to predict lifespan.' },
    { name: 'Fate line', visibility: 'partial', traditionalReading: 'Traditionally associated with direction, work and major changes in life path.' }
  ]
};
