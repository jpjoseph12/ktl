import { useState } from 'react';
import Icon from '../../components/Icon';
import CopyButton from '../../components/CopyButton';
import { PasswordField } from '../android/Onboarding';
import { apiFetch } from '../../lib/api';
import { shareText } from '../../lib/share';
import { validEmail, validName, validPassword, MIN_PASSWORD_LENGTH } from '../../lib/validation';

/* Who's on this server. Adding someone creates their account and gives
   back an invite to send them: a link that opens KTL with this server
   filled in, where they choose a password. Each invite works once and runs
   out, so a forwarded or old one is no use to anyone else. */

const EXPIRY = [
  { id: '1h', label: '1 hour' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' }
];

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ExpiryChoice({ value, onChange, id }) {
  return (
    <div className="stack-sm">
      <p className="meta" id={`${id}-label`}>Invite lasts</p>
      <div className="seg" role="tablist" aria-labelledby={`${id}-label`}>
        {EXPIRY.map((e) => (
          <button key={e.id} type="button" role="tab" aria-selected={value === e.id} onClick={() => onChange(e.id)}>{e.label}</button>
        ))}
      </div>
    </div>
  );
}

/* The invite to send, with Share and Copy. */
function InviteBox({ person, invite }) {
  const [shared, setShared] = useState('');
  async function share() {
    const how = await shareText({ title: 'Join us on KTL', text: invite.message });
    setShared(how === 'copied' ? 'Copied — paste it into a message.' : how === 'failed' ? 'Couldn’t share — use Copy instead.' : '');
  }
  return (
    <div className="card stack-sm" style={{ background: 'var(--surface-warm)' }}>
      <p className="body-sm">
        Send {person.name || 'them'} this invite. It works once, until <strong>{when(invite.expiresAt)}</strong>: they open the link,
        KTL fills in this server, and they choose a password.
      </p>
      <pre className="body-sm" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{invite.message}</pre>
      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={share}><Icon name="share" size={16} />Share</button>
        <CopyButton className="btn btn-secondary btn-sm" text={invite.message} toastMsg="Invite copied">
          <Icon name="copy" size={16} />Copy
        </CopyButton>
      </div>
      {shared && <p className="meta">{shared}</p>}
    </div>
  );
}

export default function PeopleCard({ admin }) {
  const { data, reload, setData } = admin;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [expiresIn, setExpiresIn] = useState('24h');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invites, setInvites] = useState({});
  const [links, setLinks] = useState({});
  const [open, setOpen] = useState(null); // { id, panel: 'edit' | 'password' | 'invite' | 'owner' | 'remove' }

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
    const r = await apiFetch('/api/admin/people', { method: 'POST', body: { name: name.trim(), email: email.trim(), expiresIn } });
    setInvites((l) => ({ ...l, [r.person.id]: r.invite }));
    setName('');
    setEmail('');
    await reload();
  });

  const toggle = (id, panel) => setOpen((o) => (o?.id === id && o.panel === panel ? null : { id, panel }));

  function row(p) {
    const mine = p.role === 'owner';
    const status = mine
      ? 'Runs this server'
      : !p.hasPassword
        ? (p.inviteExpiresAt ? `Invited — until ${when(p.inviteExpiresAt)}` : 'Hasn’t chosen a password yet')
        : p.lastSignIn ? `Last in ${new Date(p.lastSignIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not signed in yet';
    const panel = open?.id === p.id ? open.panel : null;
    return (
      <div key={p.id} className="stack-sm" style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--border-soft)' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <span className="grow" style={{ minWidth: 180 }}>
            <span className="item-title" style={{ display: 'block' }}>{p.name || p.email}</span>
            <span className="item-sub">{p.email} · {status}</span>
          </span>
          <span className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={panel === 'edit'} onClick={() => toggle(p.id, 'edit')}>Edit</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={panel === 'password'} onClick={() => toggle(p.id, 'password')}>Set password</button>
            {!mine && <button className="btn btn-secondary btn-sm" disabled={busy} aria-expanded={panel === 'invite'} onClick={() => toggle(p.id, 'invite')}>{p.hasPassword ? 'Sign-in link' : 'New invite'}</button>}
            {!mine && p.inHousehold && <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={panel === 'owner'} onClick={() => toggle(p.id, 'owner')}>Make owner</button>}
            {!mine && <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={panel === 'remove'} onClick={() => toggle(p.id, 'remove')}>Remove</button>}
          </span>
        </div>
        {panel === 'edit' && <EditPanel person={p} busy={busy} onSave={(body) => run(async () => { setData(await apiFetch(`/api/admin/people/${p.id}`, { method: 'PATCH', body })); setOpen(null); })} />}
        {panel === 'password' && <PasswordPanel person={p} busy={busy} onSave={(password) => run(async () => { setData(await apiFetch(`/api/admin/people/${p.id}`, { method: 'PATCH', body: { password } })); setOpen(null); })} />}
        {panel === 'invite' && (
          <div className="card stack-sm">
            {p.hasPassword ? (
              <>
                <p className="body-sm">A link that lets {p.name || 'them'} choose a new password. It works once, for an hour.</p>
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}
                  onClick={() => run(async () => { const r = await apiFetch(`/api/admin/people/${p.id}/link`, { method: 'POST' }); setLinks((l) => ({ ...l, [p.id]: r.link })); })}>
                  Make the link
                </button>
              </>
            ) : (
              <>
                <ExpiryChoice id={`exp-${p.id}`} value={expiresIn} onChange={setExpiresIn} />
                <p className="meta">A new invite cancels the one they already have.</p>
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}
                  onClick={() => run(async () => { const r = await apiFetch(`/api/admin/people/${p.id}/invite`, { method: 'POST', body: { expiresIn } }); setInvites((l) => ({ ...l, [p.id]: r.invite })); setOpen(null); await reload(); })}>
                  Make a new invite
                </button>
              </>
            )}
          </div>
        )}
        {panel === 'owner' && (
          <div className="hint">
            <Icon name="alert" size={16} />
            <span>
              Hand the server over to {p.name || p.email}? They’ll run it and use this page; you stay in the household as a member and lose access here.{' '}
              <button type="button" disabled={busy} onClick={() => run(async () => { await apiFetch(`/api/admin/people/${p.id}/owner`, { method: 'POST' }); window.location.assign('/android/household'); })}>Hand it over</button>{' · '}
              <button type="button" onClick={() => setOpen(null)}>Keep it</button>
            </span>
          </div>
        )}
        {panel === 'remove' && (
          <div className="hint">
            <Icon name="alert" size={16} />
            <span>
              Remove {p.name || p.email}? Their account and everything private to them are deleted.{' '}
              <button type="button" disabled={busy} onClick={() => run(async () => { await apiFetch(`/api/admin/people/${p.id}`, { method: 'DELETE' }); setOpen(null); await reload(); })}>Remove</button>{' · '}
              <button type="button" onClick={() => setOpen(null)}>Keep them</button>
            </span>
          </div>
        )}
        {invites[p.id] && <InviteBox person={p} invite={invites[p.id]} />}
        {links[p.id] && (
          <div className="card stack-sm" style={{ background: 'var(--surface-warm)' }}>
            <p className="body-sm">Send {p.name || 'them'} this link. It works once, for an hour, and opens straight to choosing a new password.</p>
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
              <span className="field-help">What they’ll log in with. Nothing is sent to it — you send them the invite.</span>
            </div>
            <ExpiryChoice id="exp-new" value={expiresIn} onChange={setExpiresIn} />
            <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}>
              <Icon name="plus" size={16} />Add and make an invite
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

function EditPanel({ person, busy, onSave }) {
  const [name, setName] = useState(person.name || '');
  const [email, setEmail] = useState(person.email || '');
  const ok = validName(name) && validEmail(email);
  return (
    <form className="card stack-sm" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: name.trim(), email: email.trim() }); }}>
      <div className="field">
        <label htmlFor={`edit-name-${person.id}`}>Name</label>
        <input className="input" id={`edit-name-${person.id}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <span className="field-help">What everyone in the household sees.</span>
      </div>
      <div className="field">
        <label htmlFor={`edit-email-${person.id}`}>Email</label>
        <input className="input" id={`edit-email-${person.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="off" />
        <span className="field-help">What they log in with.</span>
      </div>
      <button type="submit" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !ok}>Save</button>
    </form>
  );
}

function PasswordPanel({ person, busy, onSave }) {
  const [password, setPassword] = useState('');
  return (
    <form className="card stack-sm" onSubmit={(e) => { e.preventDefault(); if (validPassword(password)) onSave(password); }}>
      <p className="body-sm">For when someone is locked out and there’s no email server. Tell them the new password in person, and ask them to change it.</p>
      <PasswordField id={`pw-${person.id}`} label={`New password for ${person.name || person.email}`} value={password} onChange={setPassword}
        autoComplete="new-password" help={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
      <button type="submit" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !validPassword(password)}>Set password</button>
    </form>
  );
}
