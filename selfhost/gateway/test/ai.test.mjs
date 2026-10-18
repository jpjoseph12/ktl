import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { askClaude, askGemini, askOpenAI, dealPrompt, describeBill, extractJson, findDeals, kindFromGlyph, normaliseResult } from '../lib/ai.mjs';

const BILL = { kind: 'energy', name: 'Energy', provider: 'Octopus Energy', amount: 96.4, frequencyUnit: 'month', renewsOn: '2026-11-30' };

describe('what a deal check sends', () => {
  it('describes only the bill: kind, provider, cost, end date, and an area if typed', () => {
    const text = describeBill(BILL, { area: 'm14', today: new Date('2026-10-18T09:00:00Z') });
    assert.match(text, /gas and\/or electricity tariff/);
    assert.match(text, /Current provider: Octopus Energy/);
    assert.match(text, /about £96\.40 a month/);
    assert.match(text, /Current deal ends: 2026-11-30/);
    assert.match(text, /M14 postcode area/);
    assert.match(text, /Today: 2026-10-18/);
  });

  it('turns yearly and weekly bills into a monthly cost, and leaves out the area unless given', () => {
    assert.match(describeBill({ ...BILL, kind: 'insurance', amount: 360, frequencyUnit: 'year' }), /about £30\.00 a month/);
    assert.match(describeBill({ ...BILL, amount: 12, frequencyUnit: 'week' }), /about £52\.00 a month/);
    assert.match(describeBill(BILL), /United Kingdom \(no area given\)/);
  });

  it('asks for honest answers, including when nothing is cheaper', () => {
    assert.match(dealPrompt(BILL), /honest when nothing is cheaper/);
  });

  it('guesses the kind from the bill’s icon', () => {
    assert.equal(kindFromGlyph('bolt'), 'energy');
    assert.equal(kindFromGlyph('wifi'), 'broadband');
    assert.equal(kindFromGlyph('home'), 'other');
  });
});

describe('what comes back', () => {
  it('keeps only safe links, caps everything, and marks links not seen in the search', () => {
    const out = normaliseResult({
      summary: 'x'.repeat(2000),
      deals: [
        { provider: 'EDF', name: 'Fix 12', pricePerMonth: '88.5', pricePerYear: null, contract: '12 months', notes: '', url: 'https://www.edfenergy.com/tariffs' },
        { provider: 'Shady', name: 'Too good', pricePerMonth: 1, url: 'javascript:alert(1)' },
        { provider: 'Made up', name: 'Phantom', pricePerMonth: 50, url: 'https://not-searched.example/deal' }
      ],
      tips: ['Ask your provider to match it']
    }, [{ title: 'EDF tariffs', url: 'https://edfenergy.com/x' }]);
    assert.equal(out.summary.length, 800);
    assert.equal(out.deals[0].pricePerMonth, 88.5);
    assert.equal(out.deals[0].foundInSearch, true);
    assert.equal(out.deals[1].url, '');
    assert.equal(out.deals[2].foundInSearch, false);
    assert.deepEqual(out.tips, ['Ask your provider to match it']);
  });

  it('finds the JSON in an answer, fenced or bare', () => {
    assert.deepEqual(extractJson('Here you go:\n```json\n{"summary":"a"}\n```'), { summary: 'a' });
    assert.deepEqual(extractJson('{"summary":"b"} done'), { summary: 'b' });
    assert.equal(extractJson('no json here'), null);
  });
});

describe('providers', () => {
  it('Claude: searches, carries on after a pause, and reads the report', async () => {
    const calls = [];
    const client = {
      beta: {
        messages: {
          create: async (req) => {
            calls.push(req);
            if (calls.length === 1) {
              return { stop_reason: 'pause_turn', content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'EDF', url: 'https://www.edfenergy.com/t' }] }] };
            }
            return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'report_deals', input: { summary: 'Switching saves about £8 a month.', deals: [{ provider: 'EDF', name: 'Fix', pricePerMonth: 88, pricePerYear: null, contract: '12 months', notes: '', url: 'https://www.edfenergy.com/t' }], tips: [] } }] };
          }
        }
      }
    };
    const out = await askClaude({ apiKey: 'k', model: 'claude-opus-5-5', prompt: 'p', client });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].tools[0].type, 'web_search_20260209');
    assert.deepEqual(calls[0].tools[0].user_location, { type: 'approximate', country: 'GB', timezone: 'Europe/London' });
    assert.equal(calls[0].fallbacks, 'default');
    assert.equal(calls[1].messages.at(-1).role, 'assistant');
    assert.equal(out.deals[0].foundInSearch, true);
    assert.match(out.summary, /saves about £8/);
  });

  it('Claude: a Haiku model gets the basic search and no fallback', async () => {
    let seen;
    const client = { beta: { messages: { create: async (req) => { seen = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"summary":"ok","deals":[],"tips":[]}' }] }; } } } };
    const out = await askClaude({ apiKey: 'k', model: 'claude-haiku-5-5', prompt: 'p', client });
    assert.equal(seen.tools[0].type, 'web_search_20250305');
    assert.equal(seen.fallbacks, undefined);
    assert.equal(out.summary, 'ok');
  });

  it('OpenAI: reads the answer’s JSON and its cited links', async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      return {
        ok: true,
        json: async () => ({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: '```json\n{"summary":"s","deals":[{"provider":"BT","name":"Fibre","pricePerMonth":30,"url":"https://bt.com/x"}],"tips":[]}\n```', annotations: [{ type: 'url_citation', url: 'https://www.bt.com/broadband', title: 'BT' }] }] }] })
      };
    };
    const out = await askOpenAI({ apiKey: 'sk', model: 'gpt-5.5', prompt: 'p', fetchImpl });
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.auth, 'Bearer sk');
    assert.equal(sent.body.tools[0].type, 'web_search');
    assert.equal(out.deals[0].provider, 'BT');
    assert.equal(out.deals[0].foundInSearch, true);
  });

  it('Gemini: finds text and citations wherever they sit in the reply', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ steps: [{ type: 'google_search_call' }, { type: 'model_output', content: [{ type: 'text', text: '{"summary":"g","deals":[],"tips":["haggle"]}', annotations: [{ type: 'url_citation', url: 'https://uswitch.com/a', title: 'Uswitch' }] }] }] })
    });
    const out = await askGemini({ apiKey: 'AIza', model: 'gemini-3.8-flash', prompt: 'p', fetchImpl });
    assert.equal(out.summary, 'g');
    assert.deepEqual(out.tips, ['haggle']);
    assert.equal(out.sources[0].url, 'https://uswitch.com/a');
  });

  it('says plainly when the key is wrong, or nothing is set up', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    await assert.rejects(findDeals({ provider: 'openai', apiKey: 'x', bill: BILL, fetchImpl }), { code: 'ai_bad_key' });
    await assert.rejects(findDeals({ provider: '', apiKey: '', bill: BILL }), { code: 'ai_off' });
  });
});
