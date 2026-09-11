import { config } from '../config.js';

export type PartialBirthProfile = {
  name?: string;
  date?: string;
  time?: string;
  place?: string;
  language?: string;
};

export async function extractBirthProfile(transcript: string[], current: PartialBirthProfile) {
  if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is required to extract birth details from the live transcript.');

  const response = await fetch(config.openai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: [
            'Extract a birth profile from a conversation between an AI guide and a user.',
            'Return ONLY a compact JSON object with keys: name, date, time, place, language, complete.',
            'Use null for unknown fields. Never guess missing values.',
            'Normalize date to YYYY-MM-DD when the user clearly supplied enough information.',
            'Normalize time to HH:MM in 24-hour format when the user clearly supplied enough information.',
            'Keep place as the user expressed it, cleaned up for readability.',
            'language should be the language primarily spoken by the user when identifiable, otherwise null.',
            'complete must be true only when name, date, time, and place are all known.',
            'The current object contains previously extracted values. Preserve them unless the user clearly corrects them.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({ current, transcript: transcript.slice(-24) })
        }
      ]
    })
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI profile extraction failed (${response.status}): ${raw.slice(0, 500)}`);

  const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  const content = parsed.choices?.[0]?.message?.content?.trim() || '{}';
  const jsonText = content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  const result = JSON.parse(jsonText) as Record<string, unknown>;

  const merged = {
    name: clean(result.name) ?? current.name,
    date: clean(result.date) ?? current.date,
    time: clean(result.time) ?? current.time,
    place: clean(result.place) ?? current.place,
    language: clean(result.language) ?? current.language
  };

  return {
    ...merged,
    // Derive completion from actual merged state instead of trusting an LLM flag.
    complete: Boolean(merged.name && merged.date && merged.time && merged.place)
  };
}

function clean(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : undefined;
}
