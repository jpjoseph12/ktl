import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import useServerInfo from '../lib/useServerInfo';
import { api, apiFetch } from '../lib/api';
import { daysUntil, formatRenewal, inRenewalWindow, renewalKind } from '../lib/renewals';

const POLL_MS = 4000;
const GIVE_UP_MS = 5 * 60 * 1000;
const AREA = /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/;

function money(n) {
  return n === null || n === undefined ? null : `£${Number(n).toFixed(2)}`;
}

function when(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* When a bill's deal ends, when KTL will remind you, and — if whoever runs
   the server has added an AI provider — a search for a better deal.

   `shared` bills keep their latest result for the household to see;
   personal ones are only ever shown here, on your phone, and not saved. */
export default function DealCard({ bill, shared = false, onAddDate }) {
  const server = useServerInfo();
  const [area, setArea] = useState('');
  const [areaInvalid, setAreaInvalid] = useState(false);
  const [state, setState] = useState({ phase: 'idle' });
  const [saved, setSaved] = useState(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  // The last check anyone in the household ran on this bill.
  useEffect(() => {
    setState({ phase: 'idle' });
    setSaved(null);
    if (!shared || !bill?.id || !api) return;
    api.from('deal_checks').select('checked_at, provider, model, result')
      .eq('bill_id', bill.id).order('checked_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (live.current && data?.[0]) setSaved({ result: data[0].result, checkedAt: data[0].checked_at, model: data[0].model });
      }, () => {});
  }, [bill?.id, shared]);

  if (!bill) return null;
  const kind = renewalKind(bill.renewalKind);
  const days = daysUntil(bill.renewsOn);
  const looking = inRenewalWindow(bill);
  const aiOn = server?.ai === true;

  async function check() {
    const typed = area.trim();
    if (typed && !AREA.test(typed)) { setAreaInvalid(true); return; }
    setAreaInvalid(false);
    setState({ phase: 'running' });
    try {
      const body = { area: typed, ...(shared ? { billId: bill.id } : { personalBillId: bill.id }) };
      const { job } = await apiFetch('/api/deals/check', { method: 'POST', body });
      const started = Date.now();
      while (live.current && Date.now() - started < GIVE_UP_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!live.current) return;
        const r = await apiFetch(`/api/deals/check/${job}`);
        if (r.status === 'done') {
          setState({ phase: 'done', ...r });
          if (shared) setSaved(null);
          return;
        }
      }
      if (live.current) setState({ phase: 'error', message: 'That took too long. Try again in a moment.' });
    } catch (err) {
      if (live.current) setState({ phase: 'error', message: err.message || 'The search didn’t work. Try again.' });
    }
  }

  const shown = state.phase === 'done' ? state : saved;

  return (
    <section className="stack-sm deal-card" aria-labelledby={`deal-${bill.id}`}>
      <p className="eyebrow" id={`deal-${bill.id}`}>Deal &amp; renewal</p>
      {bill.renewsOn ? (
        <dl style={{ margin: 0 }}>
          <div className="kv">
            <dt>Deal ends</dt>
            <dd>{formatRenewal(bill.renewsOn)}{days !== null && days >= 0 ? ` · ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}` : days < 0 ? ' · ended' : ''}</dd>
          </div>
          <div className="kv">
            <dt>KTL reminds {shared ? 'everyone' : 'you'}</dt>
            <dd>{Math.round(kind.lead / 7)} weeks before</dd>
          </div>
        </dl>
      ) : (
        <p className="body-sm dim">
          Add when this deal ends and KTL will remind {shared ? 'everyone' : 'you'} when it’s time to look for a better one.
          {onAddDate && <> <button className="btn btn-ghost btn-sm" onClick={onAddDate}>Add the date</button></>}
        </p>
      )}
      {looking && (
        <p className="hint"><Icon name="refresh" size={16} /><span>Time to look for a better deal. {kind.why}</span></p>
      )}

      {aiOn && (
        <div className="stack-sm">
          <div className={'field' + (areaInvalid ? ' invalid' : '')}>
            <label htmlFor={`deal-area-${bill.id}`}>Postcode area (optional)</label>
            <input
              className="input" id={`deal-area-${bill.id}`} placeholder="e.g. M14" maxLength={4} autoComplete="off"
              value={area} onChange={(e) => setArea(e.target.value)} disabled={state.phase === 'running'}
            />
            <span className="field-help">Just the first part, for local prices. It isn’t saved.</span>
            <span className="field-error">That’s the first half of a postcode, like M14 or SW1A.</span>
          </div>
          <button className="btn btn-secondary" disabled={state.phase === 'running'} onClick={check}>
            {state.phase === 'running' ? 'Searching — this can take a minute…' : 'Check for a better deal'}
          </button>
          <p className="body-sm dim">
            An AI searches the web for you. It’s told the kind of bill, the provider, what it costs and when the deal ends —
            never your name or address. {shared ? 'Everyone in the household sees the result.' : 'Only you see the result, and it isn’t saved.'}
          </p>
          {state.phase === 'error' && <p className="hint"><Icon name="alert" size={16} /><span>{state.message}</span></p>}
        </div>
      )}

      {shown?.result && <DealResult value={shown} />}
    </section>
  );
}

function DealResult({ value }) {
  const { result, checkedAt, model } = value;
  return (
    <div className="card card-quiet stack-sm" role="region" aria-label="Deal check result">
      {result.summary && <p className="body-sm">{result.summary}</p>}
      {result.deals?.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {result.deals.map((d, i) => (
            <li key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div className="row-between">
                <strong className="body-sm">{d.provider}{d.name ? ` · ${d.name}` : ''}</strong>
                <span className="num body-sm">
                  {money(d.pricePerMonth) ? `${money(d.pricePerMonth)}/mo` : money(d.pricePerYear) ? `${money(d.pricePerYear)}/yr` : ''}
                </span>
              </div>
              {(d.contract || d.notes) && <span className="body-sm dim">{[d.contract, d.notes].filter(Boolean).join(' · ')}</span>}
              {d.url && (
                <span className="body-sm">
                  <a href={d.url} target="_blank" rel="noopener noreferrer">{new URL(d.url).hostname.replace(/^www\./, '')}</a>
                  {!d.foundInSearch && <span className="dim"> · double-check this link</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {result.tips?.length > 0 && (
        <ul className="body-sm" style={{ margin: 0, paddingLeft: '1.2em' }}>
          {result.tips.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      <p className="body-sm dim">
        Found {checkedAt ? `on ${when(checkedAt)}` : 'just now'}{model ? ` by ${model}` : ''}. Prices change and AI can get things wrong —
        check with the provider before you switch.
      </p>
    </div>
  );
}
