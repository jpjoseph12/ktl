import { useState } from 'react';
import Icon from '../../components/Icon';
import CopyButton from '../../components/CopyButton';
import { apiFetch } from '../../lib/api';
import { validEmail, validName } from '../../lib/validation';

/* Who's on this server. Adding someone creates their account and gives
   back a one-time link: they open it, choose a password, and they're in
   the household — no email server needed, no codes. */
export default function PeopleCard({ admin }) {
  const { data, reload } = admin;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [links, setLinks] = useState({});
  const [confirming, setConfirming] = useState(null);

  if (!data) return null;
  const inHousehold = data.people.filter((p) => p.inHousehold);
  const others = data.people.filter((p) => !p.inHousehold);
  const full = inHousehold.length >= data.maxPeople;

  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(async () => {
    if (!validName(name) || !validEmail(email)) throw new Error('Enter their name and a valid email address.');
    const r = await apiFetch('/api/admin/people', { method: 'POST', body: { name: name.trim(), email: email.trim() } });
    setLinks((l) => ({ ...l, [r.person.id]: r.link }));
    setName('');
    setEmail('');
    await reload();
  });

  const newLink = (person) => run(async () => {
    const r = await apiFetch(`/api/admin/people/${person.id}/link`, { method: 'POST' });
    setLinks((l) => ({ ...l, [person.id]: r.link }));
  });

  const remove = (person) => run(async () => {
    await apiFetch(`/api/admin/people/${person.id}`, { method: 'DELETE' });
    setConfirming(null);
    await reload();
  });

  function row(p) {
    const status = p.role === 'owner'
      ? 'Runs this server'
      : !p.hasPassword
        ? 'Hasn’t chosen a password yet'
        : p.lastSignIn ? `Last in ${new Date(p.lastSignIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not signed in yet';
    return (
      <div key={p.id} className="stack-sm" style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--border-soft)' }}>
        <div className="row-between">
          <span className="grow">
            <span className="item-title" style={{ display: 'block' }}>{p.name || p.email}</span>
            <span className="item-sub">{p.email} · {status}</span>
          </span>
          {p.role !== 'owner' && (
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => newLink(p)}>Sign-in link</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(p.id)}>Remove</button>
            </span>
          )}
        </div>
        {confirming === p.id && (
          <div className="hint">
            <Icon name="alert" size={16} />
            <span>
              Remove {p.name || p.email}? Their account and everything private to them are deleted.{' '}
              <button type="button" onClick={() => remove(p)}>Remove</button>{' · '}
              <button type="button" onClick={() => setConfirming(null)}>Keep them</button>
            </span>
          </div>
        )}
        {links[p.id] && (
          <div className="card stack-sm" style={{ background: 'var(--surface-warm)' }}>
            <p className="body-sm">Send {p.name || 'them'} this link. It works once, for an hour: they open it, choose a password, and they’re in.</p>
            <code style={{ wordBreak: 'break-all', fontSize: 'var(--text-xs)' }}>{links[p.id]}</code>
            <CopyButton className="btn btn-secondary btn-sm" text={links[p.id]} toastMsg="Link copied">
              <Icon name="copy" size={16} />Copy the link
            </CopyButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="section-head"><h2>People</h2><span className="meta">{inHousehold.length} of {data.maxPeople}</span></div>
      <div className="card stack-sm">
        {inHousehold.map(row)}
        {!full ? (
          <form className="stack-sm" style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-soft)' }} onSubmit={(e) => { e.preventDefault(); if (!busy) add(); }}>
            <p className="item-title">Add someone you share with</p>
            <div className="field">
              <label htmlFor="person-name">Name</label>
              <input className="input" id="person-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="person-email">Email</label>
              <input className="input" id="person-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="off" />
              <span className="field-help">What they’ll log in with. Nothing is sent to it unless email is set up below.</span>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}>
              <Icon name="plus" size={16} />Add them
            </button>
          </form>
        ) : (
          <p className="meta" style={{ paddingTop: 'var(--space-3)' }}>The household is full — six people is the most KTL holds.</p>
        )}
        {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
      </div>
      {others.length > 0 && (
        <div className="card stack-sm">
          <p className="item-title">Other accounts on this server</p>
          <p className="meta">Not in the household — usually left over from before. Remove them if nobody uses them.</p>
          {others.map(row)}
        </div>
      )}
    </section>
  );
}
