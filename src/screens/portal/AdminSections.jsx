import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { AddressCard, FromContainer, SignupCard, useSaver } from './SettingsCards';
import { apiFetch } from '../../lib/api';

/* The admin page's own sections — the ones that aren't a single settings
   card shared with the setup page. */

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|[^.]+$|.+\.(local|lan|home|internal)$)/i;

function Pill({ ok, children }) {
  return <span className={'pill ' + (ok ? 'is-settled' : 'is-due')}>{children}</span>;
}

export function OverviewSection({ data }) {
  const url = (() => { try { return new URL(data.siteUrl); } catch { return null; } })();
  const secure = url?.protocol === 'https:';
  const reachableOnlyAtHome = url && PRIVATE_HOST.test(url.hostname);
  const latest = data.backups.at(-1);
  const backupAgeDays = latest?.mtime ? (Date.now() - new Date(latest.mtime).getTime()) / 86_400_000 : Infinity;
  const inHousehold = data.people.filter((p) => p.inHousehold);
  const waiting = inHousehold.filter((p) => !p.hasPassword);
  const containerSet = Object.entries(data.settings).filter(([, v]) => v.source === 'container').map(([k]) => k);

  const checklist = [
    { done: inHousehold.length > 1, label: 'Add the people you share with', to: 'people', optional: false },
    { done: waiting.length === 0, label: waiting.length ? `${waiting.length === 1 ? waiting[0].name || waiting[0].email : `${waiting.length} people`} still to choose a password` : 'Everyone has a password', to: 'people' },
    { done: secure, label: secure ? 'Reached over https' : 'Use an https address before using KTL away from home', to: 'access' },
    { done: backupAgeDays < 2, label: latest ? (backupAgeDays < 2 ? 'Backed up in the last two days' : 'The latest backup is more than two days old') : 'No backup yet', to: 'backups' },
    { done: data.settings.smtpHost.set, label: 'Email, so people can reset their own password', to: 'email', optional: true },
    { done: data.push.configured, label: 'Push notifications', to: 'push', optional: true }
  ];

  return (
    <>
      {data.update?.newer && (
        <section className="card stack-sm" aria-label="Update available">
          <div className="row-between">
            <span className="item-title">KTL {data.update.latest} is out</span>
            <span className="pill is-due">Update</span>
          </div>
          <p className="body-sm">
            This server runs {data.update.current}. To update: on Unraid, <strong>Docker → ktl → Update</strong>; with Docker,
            {' '}<code>docker pull ghcr.io/jpjoseph12/ktl:latest</code> and recreate the container. Your data stays, and a backup is taken
            nightly — or take one first under Backups.
          </p>
          {data.update.url && <a className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} href={data.update.url} target="_blank" rel="noreferrer">What’s new</a>}
        </section>
      )}
      <section className="stack">
        <div className="section-head"><h2>Server</h2><Pill ok={data.health?.healthy}>{data.health?.healthy ? 'All working' : 'Needs a look'}</Pill></div>
        <div className="card stack-sm">
          <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Pill ok={data.health?.database}>Database</Pill>
            <Pill ok={data.health?.auth}>Sign-in</Pill>
            <Pill ok={data.health?.api}>Data</Pill>
          </div>
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="meta">Address</dt><dd className="body-sm num" style={{ margin: 0, wordBreak: 'break-all' }}>{data.siteUrl}</dd></div>
            <div className="row-between"><dt className="meta">People</dt><dd className="body-sm" style={{ margin: 0 }}>{inHousehold.length} of {data.maxPeople}</dd></div>
            <div className="row-between"><dt className="meta">Latest backup</dt><dd className="body-sm" style={{ margin: 0 }}>{latest?.mtime ? new Date(latest.mtime).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'None yet'}</dd></div>
            <div className="row-between"><dt className="meta">Version</dt><dd className="body-sm num" style={{ margin: 0 }}>KTL {data.version || '—'}{data.update && !data.update.newer ? ' · up to date' : ''}</dd></div>
          </dl>
          {!data.health?.healthy && (
            <p className="hint"><Icon name="alert" size={16} /><span>Part of the server isn’t answering. Its log has the details: <code>docker logs ktl</code>. Restarting the container usually clears it.</span></p>
          )}
          {!secure && !reachableOnlyAtHome && (
            <p className="hint"><Icon name="lock" size={16} /><span>This address isn’t https, so passwords would cross the internet unencrypted. Put KTL behind a Cloudflare Tunnel or a reverse proxy with HTTPS.</span></p>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="section-head"><h2>Finish setting up</h2><span className="meta">{checklist.filter((c) => c.done).length} of {checklist.length}</span></div>
        <div className="list">
          {checklist.map((c) => (
            <Link key={c.label} className="item" to={`/admin/${c.to}`}>
              <span className={'glyph ' + (c.done ? 'on-warm' : '')}><Icon name={c.done ? 'check' : 'chevron'} size={16} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>{c.label}</span>
                {c.optional && !c.done && <span className="item-sub">Optional</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {containerSet.length > 0 && (
        <section className="stack">
          <div className="section-head"><h2>Set by the container</h2></div>
          <div className="card stack-sm">
            <p className="body-sm">These come from the container’s environment, so they can only be changed there: {containerSet.join(', ')}.</p>
          </div>
        </section>
      )}
    </>
  );
}

const MODES = [
  { id: 'chase', label: 'Chase and confirm', sub: 'Both of you are reminded and both confirm: details first, then the money. Best when money moves between you every month.' },
  { id: 'track', label: 'Tracking only', sub: 'A shared ledger, no chasing. Saying you’ve paid closes the line straight away.' }
];

export function HouseholdSection({ admin }) {
  const { data, setData } = admin;
  const r = { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00', nudgeAfter: 24, quietFrom: '22:00', quietTo: '08:00', weeklyDigest: true, ...(data.household.reminders || {}) };
  const [form, setForm] = useState(() => ({
    name: data.household.name || '', mode: data.household.mode || 'chase', payoutRef: data.household.payoutRef || '',
    detailsLead: String(r.detailsLead), detailsTime: r.detailsTime, paymentLead: String(r.paymentLead), paymentTime: r.paymentTime,
    nudge: r.nudgeAfter > 0, quiet: r.quietFrom !== r.quietTo, digest: r.weeklyDigest !== false
  }));
  const { busy, run, feedback } = useSaver();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => run(async () => {
    setData(await apiFetch('/api/admin/household', {
      method: 'PUT',
      body: {
        name: form.name,
        mode: form.mode,
        payoutRef: form.payoutRef,
        reminders: {
          detailsLead: Number(form.detailsLead), detailsTime: form.detailsTime, paymentLead: Number(form.paymentLead), paymentTime: form.paymentTime,
          nudgeAfter: form.nudge ? (r.nudgeAfter > 0 ? r.nudgeAfter : 24) : 0,
          ...(form.quiet ? (r.quietFrom !== r.quietTo ? {} : { quietFrom: '22:00', quietTo: '08:00' }) : { quietFrom: '00:00', quietTo: '00:00' }),
          weeklyDigest: form.digest
        }
      }
    }));
  }, 'Saved. Everyone sees it straight away.');

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <section className="stack">
        <div className="section-head"><h2>Name</h2></div>
        <div className="card stack-sm">
          <div className="field">
            <label htmlFor="household-name">Household name</label>
            <input className="input" id="household-name" value={form.name} onChange={set('name')} maxLength={60} />
            <span className="field-help">Shown to everyone in the household, and in invites.</span>
          </div>
          <div className="field">
            <label htmlFor="household-reference">Transfer reference</label>
            <input className="input num-input" id="household-reference" value={form.payoutRef} onChange={set('payoutRef')} maxLength={18} placeholder="e.g. FLAT4 BILLS" />
            <span className="field-help">Optional. Shown with every payment, to put on the bank transfer. Up to 18 characters.</span>
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="section-head"><h2>How you use KTL</h2></div>
        <div className="card stack-sm">
          <div className="seg" role="tablist" aria-label="How you use KTL">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={form.mode === m.id} onClick={() => setForm((f) => ({ ...f, mode: m.id }))}>{m.label}</button>
            ))}
          </div>
          <p className="body-sm">{MODES.find((m) => m.id === form.mode)?.sub}</p>
          {form.mode === 'track' && data.household.mode !== 'track' && (
            <p className="meta">Anything already marked as sent is settled when you save.</p>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="section-head"><h2>Reminders</h2></div>
        <div className="card stack-sm">
          <p className="body-sm">When each phone reminds people about a bill. Each person can still turn reminders off on their own phone.</p>
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 140 }}>
              <label htmlFor="details-lead">Share the details (days before)</label>
              <input className="input num-input" id="details-lead" inputMode="numeric" value={form.detailsLead} onChange={(e) => setForm((f) => ({ ...f, detailsLead: e.target.value.replace(/\D/g, '') }))} />
            </div>
            <div className="field" style={{ minWidth: 120 }}>
              <label htmlFor="details-time">at</label>
              <input className="input num-input" id="details-time" type="time" value={form.detailsTime} onChange={set('detailsTime')} />
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 140 }}>
              <label htmlFor="payment-lead">Send the money (days before)</label>
              <input className="input num-input" id="payment-lead" inputMode="numeric" value={form.paymentLead} onChange={(e) => setForm((f) => ({ ...f, paymentLead: e.target.value.replace(/\D/g, '') }))} />
            </div>
            <div className="field" style={{ minWidth: 120 }}>
              <label htmlFor="payment-time">at</label>
              <input className="input num-input" id="payment-time" type="time" value={form.paymentTime} onChange={set('paymentTime')} />
            </div>
          </div>
          {[
            ['nudge', 'Nudge if nobody confirms', 'One follow-up a day after the money reminder, while a bill is still open.'],
            ['quiet', 'Quiet hours', 'Nothing between 22:00 and 08:00 — reminders wait until morning.'],
            ['digest', 'Sunday summary', 'Sunday at 18:00: what’s due in the week ahead.']
          ].map(([key, title, sub]) => (
            <div className="row-between" key={key}>
              <span className="grow">
                <span className="body-sm" style={{ display: 'block' }}>{title}</span>
                <span className="meta">{sub}</span>
              </span>
              <button type="button" className="switch" role="switch" aria-checked={form[key]} aria-label={title}
                onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))} />
            </div>
          ))}
        </div>
      </section>

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save household'}</button>
      {feedback}
    </form>
  );
}

export function AccessSection({ admin }) {
  const { data, save } = admin;
  const { busy, run, feedback } = useSaver();
  const p = data.settings.trustProxy;
  const on = p?.value === 'true';
  return (
    <>
      <AddressCard admin={admin} />
      <SignupCard admin={admin} />
      <section className="stack">
        <div className="section-head"><h2>Reverse proxy</h2><span className="meta">{on ? 'Trusted' : 'Not trusted'}</span></div>
        <div className="card stack-sm">
          <div className="row-between">
            <span className="body-sm">KTL is behind a reverse proxy on another machine</span>
            <button className="switch" role="switch" aria-checked={on} aria-label="Trust a reverse proxy"
              disabled={busy || p?.source === 'container'} onClick={() => run(() => save({ trustProxy: !on }))} />
          </div>
          <p className="meta">
            Turn this on if Nginx Proxy Manager, SWAG, Caddy or Traefik on another machine sits in front of KTL, so sign-in rate
            limits see each person’s real address. Leave it off otherwise — and with a Cloudflare Tunnel, which is trusted already.
          </p>
          {p?.source === 'container' && <FromContainer />}
          {feedback}
        </div>
      </section>
    </>
  );
}
