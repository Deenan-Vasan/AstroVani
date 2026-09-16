import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { generateChart } from './services/chartGenerator.js';
import { getIntegrationStatus } from './services/integrationStatus.js';
import { makeChannelName, makeRtcUid } from './services/agoraRtcSession.js';
import { getAvatarDiagnostics, getTtsDiagnostics, speakAgoraAgent, startAgoraAgent, stopAgoraAgent, thinkAgoraAgent, updateAgoraAgentChart, updateAgoraAgentPalm } from './services/agoraConvoAi.js';
import { extractBirthProfile } from './services/profileExtractor.js';
import { analyzePalmWithVision } from './services/palmVision.js';

const app = express();
// `*` opts out of the allow-list entirely; otherwise only the configured frontend
// origins may call the API from a browser. Requests without an Origin header
// (curl, health checks, server-to-server) are always allowed.
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendUrls.includes('*')) return callback(null, true);
    // Reject by omitting the header rather than erroring, so the browser blocks the
    // response without the API returning a 500.
    return callback(null, config.frontendUrls.includes(origin.replace(/\/+$/, '')));
  }
}));
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'astro-cosmic-journey-api', integrations: getIntegrationStatus() });
});

app.get('/api/diagnostics/tts', (_req, res) => {
  res.json(getTtsDiagnostics());
});

app.get('/api/diagnostics/avatar', (_req, res) => {
  res.json(getAvatarDiagnostics());
});

const sessionSchema = z.object({
  name: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  place: z.string().min(1),
  language: z.string().min(1)
});


const extractProfileSchema = z.object({
  transcript: z.array(z.string()).min(1).max(60),
  current: sessionSchema.partial().optional().default({})
});

app.post('/api/profile/extract', async (req, res) => {
  const parsed = extractProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid profile extraction request', details: parsed.error.flatten() });
  try {
    const result = await extractBirthProfile(parsed.data.transcript, parsed.data.current);
    return res.json(result);
  } catch (error) {
    console.error('Birth profile extraction failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to extract birth profile.' });
  }
});

app.post('/api/session', async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid birth profile', details: parsed.error.flatten() });

  try {
    const chart = await generateChart(parsed.data);
    console.log(`[chart] ${parsed.data.name}: ${chart.lagna} Lagna · ${chart.moonSign} Moon · ${chart.nakshatra} · ${chart.dasha}`);
    return res.json({
      sessionId: randomUUID(),
      mode: config.mockMode ? 'mock' : 'live',
      profile: parsed.data,
      chart,
      nextExperienceEvent: { event: 'REVEAL_BIRTH_SKY', payload: { place: parsed.data.place } }
    });
  } catch (error) {
    console.error('Birth chart calculation failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to calculate birth chart.' });
  }
});

app.post('/api/agora/rtc-session', (_req, res) => {
  try {
    if (!config.agora.appId) {
      return res.status(503).json({ error: 'Agora RTC is not configured. Add AGORA_APP_ID to .env.' });
    }
    const channel = makeChannelName();
    const uid = makeRtcUid();
    return res.json({
      appId: config.agora.appId,
      channel,
      uid,
      agentUid: config.agora.agentUid,
      avatarUid: config.agora.avatarUid,
      authentication: 'app-id-only'
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create Agora RTC session.' });
  }
});

const startAgentSchema = z.object({
  channel: z.string().min(1),
  clientUid: z.number().int().positive(),
  profile: sessionSchema.partial().optional()
});

app.post('/api/agora/agent/start', async (req, res) => {
  const parsed = startAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid Agora agent start request', details: parsed.error.flatten() });
  try {
    const agent = await startAgoraAgent(parsed.data);
    return res.json(agent);
  } catch (error) {
    console.error('Agora agent start failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to start Agora Conversational AI agent.' });
  }
});


app.post('/api/agora/agent/greet', async (req, res) => {
  const agentId = String(req.body?.agentId || '');
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });
  try {
    await speakAgoraAgent(agentId, config.agora.greeting);
    return res.json({ success: true, text: config.agora.greeting });
  } catch (error) {
    console.error('Agora agent greeting failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to send Agora greeting.' });
  }
});

const updateChartSchema = z.object({
  agentId: z.string().min(1),
  profile: sessionSchema.partial()
});

/**
 * Re-brief a running agent once voice onboarding has collected the birth details.
 * The agent joins before the profile exists, so without this it would keep describing
 * the generator's default chart while the UI shows the user's own.
 */
app.post('/api/agora/agent/chart', async (req, res) => {
  const parsed = updateChartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'agentId and profile are required', details: parsed.error.flatten() });
  try {
    const chart = await generateChart(parsed.data.profile);
    await updateAgoraAgentChart(parsed.data.agentId, parsed.data.profile);
    console.log(`[chart] agent re-briefed: ${chart.lagna} Lagna · ${chart.moonSign} Moon · ${chart.dasha} Dasha`);
    return res.json({ success: true, chart });
  } catch (error) {
    console.error('Agora agent chart update failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to update the agent chart context.' });
  }
});

const palmAgentSchema = z.object({
  agentId: z.string().min(1),
  profile: sessionSchema.partial().optional(),
  palm: z.object({
    hand: z.string(), confidence: z.number(), captureQuality: z.number(), summary: z.string(),
    lines: z.array(z.object({
      id: z.enum(['heart_line','head_line','life_line','fate_line']), name: z.string(),
      status: z.enum(['detected','approximate','estimated','not_clear']), confidence: z.number(),
      visibility: z.string(), observation: z.string().optional(), traditionalReading: z.string()
    }))
  })
});

app.post('/api/agora/agent/palm', async (req, res) => {
  const parsed = palmAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'agentId and palm analysis are required', details: parsed.error.flatten() });
  try {
    const p = parsed.data.palm;
    const lines = p.lines.map(line => `${line.name}: status=${line.status}, confidence=${Math.round(line.confidence * 100)}%, visibility=${line.visibility}, observed morphology=${line.observation || 'indeterminate'}; reading=${line.traditionalReading}`).join(' | ');
    const context = [
      'CURRENT PALM CAPTURE CONTEXT: The AstroVani application has captured and analyzed the user palm. You DO have access to the RESULT of that image analysis even though you do not inspect raw camera pixels yourself.',
      `Hand=${p.hand}; capture quality=${Math.round(p.captureQuality * 100)}%; analysis summary=${p.summary}.`,
      `Line analysis: ${lines}`,
      'PALM RESPONSE RULE: Answer all follow-up palm questions from these captured results. Never say you cannot see/access the palm when this context exists. Speak naturally as Jyotishi: do NOT mention capture quality percentages, confidence scores, computer vision, tracing, coordinates, analysis pipelines, or implementation details unless the user explicitly asks how the technology works. Do not replace the observed result with generic palmistry. If status=detected, you may describe only morphology actually present in observed morphology. If status=approximate, say the line appears visible but avoid claiming broken, chained, forked, deep, long, short, or curved unless observed morphology explicitly says so. If status=estimated or not_clear, say that property is not clear enough to determine. Never invent whether a line is broken or unbroken. Use traditionalReading only as a traditional interpretation, not as a scientific fact.'
    ].join('\n');
    await updateAgoraAgentPalm(parsed.data.agentId, parsed.data.profile, context);
    return res.json({ success: true });
  } catch (error) {
    console.error('Agora agent palm context update failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to update palm context.' });
  }
});

app.post('/api/agora/agent/speak', async (req, res) => {
  const agentId = String(req.body?.agentId || '');
  const text = String(req.body?.text || '').trim();
  const interruptable = req.body?.interruptable !== false;
  if (!agentId || !text) return res.status(400).json({ error: 'agentId and text are required' });
  try {
    await speakAgoraAgent(agentId, text, interruptable);
    return res.json({ success: true });
  } catch (error) {
    console.error('Agora agent speak failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to speak through Agora agent.' });
  }
});

app.post('/api/agora/agent/think', async (req, res) => {
  const agentId = String(req.body?.agentId || '');
  const text = String(req.body?.text || '').trim();
  if (!agentId || !text) return res.status(400).json({ error: 'agentId and text are required' });
  try {
    await thinkAgoraAgent(agentId, text);
    return res.json({ success: true });
  } catch (error) {
    console.error('Agora agent think failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to send the user prompt to Agora agent.' });
  }
});

app.post('/api/agora/agent/stop', async (req, res) => {
  const agentId = String(req.body?.agentId || '');
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });
  try {
    const result = await stopAgoraAgent(agentId);
    return res.json({ success: true, result });
  } catch (error) {
    console.error('Agora agent stop failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to stop Agora Conversational AI agent.' });
  }
});

const palmSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').min(1000),
  enhancedImageDataUrl: z.string().startsWith('data:image/').min(1000).optional(),
  creaseCandidateImageDataUrl: z.string().startsWith('data:image/').min(500).optional(),
  cvCandidates: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['heart_line','head_line','life_line','fate_line']),
    points: z.array(z.tuple([z.number(), z.number()])).min(4).max(32),
    cvScore: z.number().min(0).max(1),
    anatomicalScore: z.number().min(0).max(1),
    combinedScore: z.number().min(0).max(1),
    note: z.string().optional()
  })).max(12).optional(),
  // Set when the capture was rectified into canonical palm space.
  thumbSide: z.enum(['left', 'right']).optional()
});
app.post('/api/palm/analyze', async (req, res) => {
  const parsed = palmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A captured palm image is required' });
  try {
    const result = await analyzePalmWithVision(parsed.data.imageDataUrl, parsed.data.enhancedImageDataUrl, parsed.data.creaseCandidateImageDataUrl, parsed.data.cvCandidates, parsed.data.thumbSide);
    return res.json(result);
  } catch (error) {
    console.error('Palm vision analysis failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to analyze palm creases.' });
  }
});

app.post('/api/experience/event', (req, res) => {
  const event = String(req.body?.event || '');
  if (!event) return res.status(400).json({ error: 'event is required' });
  return res.json({ accepted: true, event, at: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`AstroVani API running on http://localhost:${config.port}`);
  console.log(`Mode: real astronomical birth-chart calculation / ${config.mockMode ? 'mock-capable integrations' : 'live integrations'}`);
});
