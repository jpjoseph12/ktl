import { useRef, useState } from 'react';
import Icon from './Icon';
import { money } from '../lib/kettle';
import { analyseSpending, readTransactions } from '../lib/spending';

/* Yours → Your spending. Load a bank export (Monzo's CSV), see where the
   money goes and what's worth a look, and turn any of it into a "free up
   money" line or a bill of your own.

   The file never leaves the device and isn't saved: it's read here,
   analysed in memory and kept only until the app closes, and only for
   the person who loaded it. */

let remembered = null; // { userId, analysis }

const FINDING_ICON = { double: 'alert', rise: 'trend', untracked: 'calendar', overlap: 'play', spike: 'trend', often: 'coins', habit: 'cart' };
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MAX_BYTES = 10 * 1024 * 1024;

export default function SpendingReview({ userId, tracked, debtOn, previewMonthsSaved, onModel, onAddBill }) {
  const [analysis, setAnalysis] = useState(() => (remembered?.userId === userId ? remembered.analysis : null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(() => new Set());
  const input = useRef(null);

  function keep(next) {
    remembered = next ? { userId, analysis: next } : null;
    setAnalysis(next);
    setDone(new Set());
  }

  async function load(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) return setError('That file is too big to be a transactions export.');
    setBusy(true);
    try {
      keep(analyseSpending(readTransactions(await file.text()), { tracked }));
    } catch (err) {
      setError(err.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function act(id, fn) {
    try {
      await fn();
      setDone((s) => new Set(s).add(id));
    } catch (err) {
      setError(err.message || 'Could not add that.');
    }
  }

  const picker = (
    <input ref={input} type="file" accept=".csv,text/csv,text/comma-separated-values" hidden onChange={load} aria-label="Choose a bank export" />
  );

  if (!analysis) {
    return (
      <section className="stack">
        <div className="section-head"><h2>Your spending</h2><span className="meta">From a bank export</span></div>
        <div className="card stack">
          <p className="body-sm">
            Load a transactions export from Monzo and KTL shows where your money goes, what repeats, anything odd, and
            what you could realistically cut.
          </p>
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="list" size={17} />{busy ? 'Reading…' : 'Choose a Monzo export (.csv)'}
          </button>
          {picker}
          {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
          <p className="hint">
            <Icon name="lock" size={16} />
            <span>
              Read on this device only — never uploaded, not even to KTL’s server, and not saved. In Monzo: Account →
              Export transactions → CSV. A few months gives the best picture.
            </span>
          </p>
        </div>
      </section>
    );
  }

  const a = analysis;
  const topCats = a.categories.slice(0, 6);
  const biggest = topCats[0]?.monthly || 1;
  const regular = a.recurring.filter((r) => r.active);

  return (
    <section className="stack">
      <div className="section-head"><h2>Your spending</h2><span className="meta">{Math.max(1, Math.round(a.days / 30.44))} months of it</span></div>

      <div className="card stack">
        <div>
          <div className="amount-lg num">{money(a.spentMonthly)}</div>
          <p className="item-sub" style={{ marginTop: 4 }}>
            a month on average · {fmtDate(a.from)} to {fmtDate(a.to)} · {a.count} transactions
          </p>
        </div>
        {a.setAside > 0 && (
          <p className="meta">Pots, savings and transfers aren’t counted as spending ({money(a.setAside)} over the period).</p>
        )}
      </div>

      {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}

      {a.findings.length > 0 && (
        <>
          <div className="section-head"><h2>Worth a look</h2><span className="meta">{a.findings.length} spotted</span></div>
          <div className="list">
            {a.findings.map((f) => {
              const sooner = debtOn && f.monthly > 0 && f.label ? previewMonthsSaved(f.monthly) : 0;
              return (
                <div className="item" key={f.id}>
                  <span className="glyph"><Icon name={FINDING_ICON[f.kind] || 'alert'} size={18} /></span>
                  <span className="grow">
                    <span className="item-title" style={{ display: 'block' }}>{f.title}</span>
                    <span className="item-sub">{f.detail}</span>
                  </span>
                  {done.has(f.id) ? (
                    <span className="tag">Added</span>
                  ) : f.kind === 'untracked' ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => act(f.id, () => onAddBill(f.recurring))}>Add to my bills</button>
                  ) : sooner > 0 ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => act(f.id, () => onModel(f))}>{sooner} mo sooner</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="hint">
            <Icon name="alert" size={16} />
            <span>Nothing gets cancelled. “Mo sooner” adds it to Free up money so you can see what it would do to your date.</span>
          </p>
        </>
      )}

      <div className="section-head"><h2>Where it goes</h2><span className="meta">a month</span></div>
      <div className="list">
        {topCats.map((c) => (
          <div className="item" key={c.category}>
            <span className="grow stack-sm">
              <span className="item-title" style={{ display: 'block' }}>{c.category}</span>
              <span className="progress" style={{ display: 'block' }}><span style={{ width: `${Math.round((c.monthly / biggest) * 100)}%` }} /></span>
            </span>
            <span className="amount num">{money(c.monthly)}</span>
          </div>
        ))}
      </div>

      {regular.length > 0 && (
        <>
          <div className="section-head"><h2>Regular payments</h2><span className="meta">{money(regular.reduce((s, r) => s + r.monthly, 0))} a month</span></div>
          <div className="list">
            {regular.map((r) => (
              <div className="item" key={r.key}>
                <span className="glyph"><Icon name={r.glyph} size={18} /></span>
                <span className="grow">
                  <span className="item-title" style={{ display: 'block' }}>{r.name}</span>
                  <span className="item-sub">{money(r.amount)} {r.cadenceLabel}{r.tracked ? ' · already in KTL' : ''}</span>
                </span>
                <span className="amount num">{money(r.monthly)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head"><h2>Biggest places</h2></div>
      <div className="list">
        {a.merchants.slice(0, 5).map((m) => (
          <div className="item" key={m.key}>
            <span className="grow">
              <span className="item-title" style={{ display: 'block' }}>{m.name}</span>
              <span className="item-sub">{m.count} {m.count === 1 ? 'payment' : 'payments'}</span>
            </span>
            <span className="amount num">{money(m.monthly)}/mo</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>Load a different export</button>
        <button className="btn btn-ghost btn-sm" onClick={() => keep(null)}>Clear</button>
      </div>
      {picker}
    </section>
  );
}

/* For tests: forget anything loaded earlier. */
export function forgetSpending() { remembered = null; }
