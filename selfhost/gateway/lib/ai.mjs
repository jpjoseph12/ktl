import Anthropic from '@anthropic-ai/sdk';

/* Deal checks: asks the AI provider the server's owner chose to search the
 * web for a better deal on one bill, and returns what it found in one
 * shape whichever provider answered.
 *
 * Only the minimum leaves the server: what kind of bill it is, who it's
 * with, what it costs, when the deal ends, and — if the person typed one
 * for this search — a postcode area. Never names, emails, other bills or
 * anything from anyone's private space.
 *
 * Providers (KTL_AI_PROVIDER): anthropic (Claude, via the official SDK
 * with its web search tool), openai (Responses API, web_search) and gemini
 * (Interactions API, google_search). KTL_AI_MODEL overrides the default
 * model for the chosen provider. */

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', console: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', model: 'gpt-5.5', keyHint: 'sk-…', console: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Gemini (Google)', model: 'gemini-3.8-flash', keyHint: 'AIza…', console: 'https://aistudio.google.com/apikey' }
};

export const KINDS = {
  energy: 'gas and/or electricity tariff',
  broadband: 'home broadband',
  mobile: 'mobile phone SIM plan',
  insurance: 'insurance policy',
  other: 'household bill'
};

const MAX_DEALS = 6;

/* What kind of bill its name and icon suggest, when nobody has said. Kept
   in step with guessRenewalKind() in the app's src/lib/renewals.js. */
export function kindFromName(name = '', glyph = '') {
  const t = String(name).toLowerCase();
  if (/energy|\bgas\b|electric|octopus|\bedf\b|e\.?on\b|\bovo\b|scottish power|utility warehouse/.test(t)) return 'energy';
  if (/broadband|internet|fibre|fiber|wi-?fi|\bbt\b|virgin media|talktalk|plusnet|hyperoptic|\bsky\b/.test(t)) return 'broadband';
  if (/insur|\bcover\b|protection|warranty|aviva|direct line|admiral|churchill/.test(t)) return 'insurance';
  if (/phone|mobile|\bsim\b|\bee\b|\bo2\b|vodafone|\bthree\b|giffgaff|voxi|lebara/.test(t)) return 'mobile';
  return { bolt: 'energy', flame: 'energy', wifi: 'broadband', phone: 'mobile', shield: 'insurance' }[glyph] || 'other';
}
export const kindFromGlyph = (glyph) => kindFromName('', glyph);
const clip = (v, n) => String(v ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, n);

/* The tidy, minimal description of the bill the AI sees. */
export function describeBill(bill, { area = '', today = new Date() } = {}) {
  const kind = KINDS[bill.kind] ? bill.kind : 'other';
  const monthly = bill.frequencyUnit === 'year' ? bill.amount / 12 : bill.frequencyUnit === 'week' ? (bill.amount * 52) / 12 : bill.amount;
  const lines = [
    `Kind: ${KINDS[kind]}${bill.name && kind === 'other' ? ` (${clip(bill.name, 40)})` : ''}`,
    bill.provider ? `Current provider: ${clip(bill.provider, 60)}` : (bill.name ? `Named in the app as: ${clip(bill.name, 40)}` : null),
    `Current cost: about £${monthly.toFixed(2)} a month`,
    bill.renewsOn ? `Current deal ends: ${bill.renewsOn}` : 'Current deal end date: not known',
    area ? `Location: ${clip(area, 8).toUpperCase()} postcode area, United Kingdom` : 'Location: United Kingdom (no area given)',
    `Today: ${today.toISOString().slice(0, 10)}`
  ];
  return lines.filter(Boolean).join('\n');
}

export function dealPrompt(bill, options) {
  return `Search the web for better deals than this household's current one, available to new customers in the UK right now.

${describeBill(bill, options)}

Look at current prices on comparison sites and providers' own pages. Find up to ${MAX_DEALS} deals that would genuinely cost less than the current cost, or give clearly more for the same money, for someone like this. For energy, compare fixed and variable tariffs against the current price cap. For each deal, give the provider, the deal's name, its price per month (or per year for insurance), any contract length or exit fees, and the page you found it on. Then a short summary of whether switching looks worthwhile, and any tips (e.g. haggling with the current provider before renewal). Be honest when nothing is cheaper, or when you couldn't find reliable prices.`;
}

const JSON_SHAPE = `{"summary": string, "deals": [{"provider": string, "name": string, "pricePerMonth": number|null, "pricePerYear": number|null, "contract": string, "notes": string, "url": string}], "tips": [string]}`;

/* Makes whatever a provider returned safe to store and show: capped
   lengths and counts, only http(s) links, and each link marked as found
   in the search results (or not), so a made-up link stands out. */
export function normaliseResult(raw, sources = []) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const known = new Set(sources.map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean));
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : null);
  const link = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.toString() : ''; } catch { return ''; } };
  const deals = (Array.isArray(r.deals) ? r.deals : []).slice(0, MAX_DEALS).map((d) => {
    const url = link(d?.url);
    let host = '';
    try { host = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
    return {
      provider: clip(d?.provider, 60),
      name: clip(d?.name, 100),
      pricePerMonth: num(d?.pricePerMonth),
      pricePerYear: num(d?.pricePerYear),
      contract: clip(d?.contract, 120),
      notes: clip(d?.notes, 300),
      url,
      foundInSearch: Boolean(host && known.has(host))
    };
  }).filter((d) => d.provider || d.name);
  return {
    summary: clip(r.summary, 800),
    deals,
    tips: (Array.isArray(r.tips) ? r.tips : []).slice(0, 5).map((t) => clip(t, 240)).filter(Boolean),
    sources: sources.slice(0, 12).map((s) => ({ title: clip(s.title, 120), url: link(s.url) })).filter((s) => s.url)
  };
}

/* The JSON at the end of a model's answer — fenced or bare. */
export function extractJson(text) {
  const s = String(text || '');
  const fenced = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]).pop();
  for (const candidate of [fenced, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next */ }
  }
  return null;
}

/* ── Claude (official SDK) ──────────────────────────────────────────── */

const REPORT_TOOL = {
  name: 'report_deals',
  description: 'Report what you found, once you have finished searching. Call this exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'deals', 'tips'],
    properties: {
      summary: { type: 'string' },
      deals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'name', 'pricePerMonth', 'pricePerYear', 'contract', 'notes', 'url'],
          properties: {
            provider: { type: 'string' },
            name: { type: 'string' },
            pricePerMonth: { type: ['number', 'null'] },
            pricePerYear: { type: ['number', 'null'] },
            contract: { type: 'string' },
            notes: { type: 'string' },
            url: { type: 'string' }
          }
        }
      },
      tips: { type: 'array', items: { type: 'string' } }
    }
  }
};

export async function askClaude({ apiKey, model, prompt, timeZone = 'Europe/London', client }) {
  const anthropic = client || new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  const messages = [{ role: 'user', content: `${prompt}\n\nWhen you're done, call report_deals with what you found.` }];
  const sources = [];
  // The dynamic-filtering web search and server-side refusal fallbacks are
  // for the Opus and Sonnet lines; a Haiku model gets the basic search.
  const haiku = /haiku/i.test(model);
  const extra = haiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 16000,
      // Opus 5.5's default effort is medium; say so explicitly.
      output_config: { effort: 'medium' },
      // If a safety classifier declines, the API re-runs on a fallback model.
      ...extra,
      tools: [
        { type: haiku ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'GB', timezone: timeZone } },
        REPORT_TOOL
      ],
      tool_choice: { type: 'auto' },
      messages
    });
    for (const block of response.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === 'web_search_result') sources.push({ title: r.title, url: r.url });
      }
    }
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this search.'), { code: 'ai_refused' });
    const report = response.content.find((b) => b.type === 'tool_use' && b.name === 'report_deals');
    if (report) return normaliseResult(report.input, sources);
    if (response.stop_reason === 'pause_turn') {
      // A long search paused; send its turn back to let it carry on.
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    // Answered in text instead of calling the tool: take the JSON if there is any.
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (parsed) return normaliseResult(parsed, sources);
    return normaliseResult({ summary: text }, sources);
  }
  throw Object.assign(new Error('The search took too long. Try again.'), { code: 'ai_timeout' });
}

/* ── OpenAI (Responses API) ─────────────────────────────────────────── */

export async function askOpenAI({ apiKey, model, prompt, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search', search_context_size: 'medium', user_location: { type: 'approximate', country: 'GB' } }],
      input: `${prompt}\n\nEnd your reply with only a JSON object in a \`\`\`json block, shaped like: ${JSON_SHAPE}`
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(res.status, body?.error?.message);
  const texts = [];
  const sources = [];
  for (const item of body.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (typeof c.text === 'string') texts.push(c.text);
      for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url) sources.push({ title: a.title, url: a.url });
    }
  }
  const text = texts.join('\n') || body.output_text || '';
  return normaliseResult(extractJson(text) || { summary: text }, sources);
}

/* ── Gemini (Interactions API) ──────────────────────────────────────── */

export async function askGemini({ apiKey, model, prompt, fetchImpl = fetch }) {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: `${prompt}\n\nEnd your reply with only a JSON object in a \`\`\`json block, shaped like: ${JSON_SHAPE}`,
      tools: [{ type: 'google_search' }]
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(res.status, body?.error?.message);
  // Read text and url_citation annotations wherever they sit in the reply.
  const texts = [];
  const sources = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'url_citation' && node.url) sources.push({ title: node.title, url: node.url });
    if (node.type === 'text' && typeof node.text === 'string') texts.push(node.text);
    Object.values(node).forEach((v) => { if (v && typeof v === 'object') walk(v); });
  }(body));
  const text = body.output_text || texts.join('\n');
  return normaliseResult(extractJson(text) || { summary: text }, sources);
}

function providerError(status, message) {
  const code = status === 401 || status === 403 ? 'ai_bad_key' : status === 429 ? 'ai_rate_limited' : 'ai_failed';
  const text = code === 'ai_bad_key'
    ? 'The AI provider didn’t accept the API key. Check it on the admin page.'
    : code === 'ai_rate_limited' ? 'The AI provider is busy or out of credit. Try again later.' : `The AI provider couldn’t search: ${clip(message || status, 200)}`;
  return Object.assign(new Error(text), { code, status });
}

export async function findDeals({ provider, apiKey, model, bill, area, timeZone, fetchImpl, client }) {
  const p = PROVIDERS[provider];
  if (!p || !apiKey) throw Object.assign(new Error('No AI provider is set up on this server.'), { code: 'ai_off' });
  const prompt = dealPrompt(bill, { area });
  const use = model || p.model;
  try {
    if (provider === 'anthropic') return await askClaude({ apiKey, model: use, prompt, timeZone, client });
    if (provider === 'openai') return await askOpenAI({ apiKey, model: use, prompt, fetchImpl });
    return await askGemini({ apiKey, model: use, prompt, fetchImpl });
  } catch (err) {
    if (err.code) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw providerError(401);
    if (err instanceof Anthropic.RateLimitError) throw providerError(429);
    if (err instanceof Anthropic.APIError) throw providerError(err.status, err.message);
    throw Object.assign(new Error(`The AI provider couldn’t be reached: ${clip(err.message, 160)}`), { code: 'ai_failed' });
  }
}

/* The admin page's "Test": the cheapest call that proves the key works. */
export async function testProvider({ provider, apiKey, model, fetchImpl = fetch, client }) {
  const p = PROVIDERS[provider];
  if (!p || !apiKey) throw Object.assign(new Error('Choose a provider and add its API key first.'), { code: 'ai_off' });
  const use = model || p.model;
  try {
    if (provider === 'anthropic') {
      const anthropic = client || new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
      await anthropic.messages.create({ model: use, max_tokens: 16, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with: OK' }] });
    } else if (provider === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: use, input: 'Reply with: OK', max_output_tokens: 16 }), signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) throw providerError(res.status, (await res.json().catch(() => ({})))?.error?.message);
    } else {
      const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: use, input: 'Reply with: OK' }), signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) throw providerError(res.status, (await res.json().catch(() => ({})))?.error?.message);
    }
    return { ok: true, provider, model: use };
  } catch (err) {
    if (err.code) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw providerError(401);
    if (err instanceof Anthropic.APIError) throw providerError(err.status, err.message);
    throw Object.assign(new Error(`Couldn’t reach the AI provider: ${clip(err.message, 160)}`), { code: 'ai_failed' });
  }
}
