import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import Sheet from '../../components/Sheet';
import MdDialog from '../../components/MdDialog';
import Icon from '../../components/Icon';
import CopyButton from '../../components/CopyButton';
import Bell from '../../components/Bell';
import ChangePassword from '../../components/ChangePassword';
import ServerSection from '../../components/ServerSection';
import { quietHoursOn } from '../../lib/reminders';
import SecuritySection from '../../components/LockSettings';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { useWalkthrough } from '../../context/WalkthroughContext';
import { money } from '../../lib/kettle';
import { permissionState, requestPermission } from '../../lib/notifications';
import PullToRefresh from '../../components/PullToRefresh';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import useIsTablet from '../../lib/useIsTablet';

const MODE_NOTE = {
  chase: 'Both of you are prompted and both of you confirm. Best when money actually moves between you every month.',
  track: 'KTL becomes a shared ledger rather than a chaser. Use this if you settle up your own way and just want the numbers to agree.'
};
const MODE_POINTS = {
  chase: [
    'Details reminder five days out, money reminder two days out.',
    'Every step closes on a person tapping a confirmation.',
    'Anything left unconfirmed gets one nudge after 24 hours.'
  ],
  track: [
    'KTL records the costs, the split and the running balance.',
    'You still get the heads-up that a bill is coming.',
    'No money chase, no nudges, nobody has to confirm anything back.',
    'Say you have paid — in full or netted — and the line closes on the spot.'
  ]
};

/* A reminder setting saved for the whole household. Each phone re-plans
   its reminders from it as soon as it changes. */
function SavedSwitch({ label, on, onLabel, offLabel, save }) {
  const { toast } = useScreen();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="switch" role="switch" aria-checked={on} aria-label={label} disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await save(!on);
          toast(on ? offLabel : onLabel);
        } catch {
          toast('That didn’t save — try again.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/* The real one. Reminders are scheduled on the device itself, so this
   reflects the OS permission rather than a setting we keep our own copy
   of — if it's off, nothing this app schedules will ever appear. */
function NotificationSetting() {
  const { toast } = useScreen();
  const [state, setState] = useState('checking');

  useEffect(() => {
    permissionState().then(setState);
  }, []);

  async function enable() {
    const next = await requestPermission();
    setState(next);
    if (next === 'granted') toast('Reminders on. We’ll ping you before each bill.');
    else if (next === 'denied') toast('Blocked in Android settings — turn notifications on for KTL there.');
    else if (next === 'unavailable') toast('Reminders only work in the installed app.');
  }

  const granted = state === 'granted';
  return (
    <div className="item">
      <span className="glyph on-warm"><Icon name="bell" size={18} /></span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block' }}>Reminders on this device</span>
        <span className="item-sub">
          {state === 'checking' && 'Checking…'}
          {granted && 'On — bill reminders arrive even if KTL is closed'}
          {state === 'denied' && 'Blocked — turn notifications on for KTL in Android settings'}
          {(state === 'prompt' || state === 'prompt-with-rationale') && 'Off — tap to allow reminders'}
          {state === 'unavailable' && 'Only available in the installed app'}
        </span>
      </span>
      {!granted && state !== 'checking' && state !== 'unavailable' && (
        <button className="btn btn-secondary btn-sm" onClick={enable}>Turn on</button>
      )}
      {granted && <span className="pill is-settled">On</span>}
    </div>
  );
}

/* In the order the phone stacks them. On a tablet this is the settings
   list in the left pane, and the picked one fills the right. */
const CATEGORIES = [
  { id: 'members', icon: 'users', label: 'Who’s in' },
  { id: 'private', icon: 'lock', label: 'Your private space' },
  { id: 'mode', icon: 'settings', label: 'How you use KTL' },
  { id: 'reminders', icon: 'bell', label: 'Reminders' },
  { id: 'money', icon: 'coins', label: 'Money' },
  { id: 'help', icon: 'refresh', label: 'Help' },
  { id: 'server', icon: 'signal', label: 'Server' },
  { id: 'security', icon: 'shield', label: 'App lock' },
  { id: 'password', icon: 'lock', label: 'Password' },
  { id: 'deleteAccount', icon: 'alert', label: 'Delete your account' }
];

export default function AndroidHousehold() {
  const isTablet = useIsTablet();
  if (isTablet) {
    return (
      <TabletShell platform="android" active="house">
        <HouseholdBody tablet />
      </TabletShell>
    );
  }
  return (
    <PhoneShell platform="android">
      <HouseholdBody />
    </PhoneShell>
  );
}

function HouseholdBody({ tablet = false }) {
  const K = useKettle();
  const [category, setCategory] = useState('members');
  const W = useWalkthrough();
  /* The people step points at the members list, which on a tablet only
     exists while that category is showing. */
  const tourOnPeople = W.step?.target === 'household-people';
  useEffect(() => {
    if (tablet && tourOnPeople) setCategory('members');
  }, [tablet, tourOnPeople]);
  const { you, partner, members, data: { household } } = K;
  const partnerName = partner?.name || 'your partner';
  const memberList = members || (partner ? [{ id: you?.id, name: you?.name, initials: you?.initials }, partner] : you ? [{ id: you.id, name: you.name, initials: you.initials }] : []);
  const { open, close, toast } = useScreen();
  const mode = K.mode();
  const isOwner = (members || []).find((m) => m.id === you?.id)?.role === 'owner';

  const [removing, setRemoving] = useState(null);
  const [busyExit, setBusyExit] = useState(false);
  const EMPTY_EXIT = { openCount: 0, theyOweYou: 0, youOweThem: 0 };
  const exitSummary = you ? K.memberExitSummary(you.id) : EMPTY_EXIT;
  const removeSummary = removing ? K.memberExitSummary(removing.id) : EMPTY_EXIT;

  function openRemoveDialog(member) {
    setRemoving(member);
    open('dialog-remove-member');
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyExit(true);
    try {
      await K.removeMember(removing.id);
      close();
      toast(`${removing.name} removed.`);
      setRemoving(null);
    } catch (err) {
      toast(err.message || 'Could not remove them.');
    } finally {
      setBusyExit(false);
    }
  }

  async function confirmDeleteAccount() {
    setBusyExit(true);
    try {
      await K.deleteAccount();
      // Signed out now — the app returns to the welcome screen by itself.
    } catch (err) {
      close();
      toast(err.message || 'Your account couldn’t be deleted.');
      setBusyExit(false);
    }
  }

  const [detailsLead, setDetailsLead] = useState(household.id ? K.data.reminders.detailsLead : 5);
  const [paymentLead, setPaymentLead] = useState(household.id ? K.data.reminders.paymentLead : 2);
  const [detailsTime, setDetailsTime] = useState(K.data.reminders.detailsTime);
  const [paymentTime, setPaymentTime] = useState(K.data.reminders.paymentTime);
  const [savingLead, setSavingLead] = useState(false);

  const [nickname, setNickname] = useState('');
  const [nicknameInvalid, setNicknameInvalid] = useState(false);
  const [renaming, setRenaming] = useState(false);

  function openRenameSheet() {
    setNickname(household.name || '');
    setNicknameInvalid(false);
    open('sheet-rename');
  }

  async function saveRename() {
    if (!nickname.trim()) {
      setNicknameInvalid(true);
      return;
    }
    setRenaming(true);
    try {
      await K.renameHousehold(nickname);
      close();
      toast('Household renamed.');
    } catch (err) {
      toast(err.message || 'Could not rename your household.');
    } finally {
      setRenaming(false);
    }
  }

  async function saveLead() {
    setSavingLead(true);
    try {
      await K.updateReminders({ detailsLead, detailsTime, paymentLead, paymentTime });
      close();
      toast(memberList.length > 1 ? 'Schedule saved. Everyone gets the same reminders.' : 'Schedule saved.');
    } catch (err) {
      toast(err.message || 'Could not save the schedule.');
    } finally {
      setSavingLead(false);
    }
  }

  async function setModeAndToast(m) {
    await K.setMode(m);
    toast(m === 'track' ? 'Tracking only. KTL will record, not chase.' : 'Chase and confirm is back on for both of you.');
  }

  const peopleLine = `${memberList.length > 1 ? `${memberList.length} people` : 'Just you so far'} · on KTL since ${household.since}`;

  /* Each settings group, keyed by its CATEGORIES id. The phone stacks them
     all in one scroll; the tablet shows one at a time beside the list. */
  const sections = {
    members: (
        <section className="stack">
          <div className="section-head"><h2>Who’s in</h2><span className="meta">{memberList.length} of 6</span></div>
          <div className="list" ref={W.targetRef('household-people')}>
            {memberList.map((m) => (
              <div className="item" key={m.id}>
                <span className={'avatar lg' + (m.id === you?.id ? ' you' : '')}>{m.initials}</span>
                <span className="grow">
                  <span className="item-title" style={{ display: 'block' }}>{m.name}{m.id === you?.id ? ' (you)' : ''}</span>
                  <span className="item-sub">{m.role === 'owner' ? 'Runs this server' : 'In this household'}</span>
                </span>
                {isOwner && m.id !== you?.id ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => openRemoveDialog(m)}>Remove</button>
                ) : (
                  <span className="pill is-settled">In</span>
                )}
              </div>
            ))}
            {memberList.length < 2 && (
              <div className="item">
                <span className="grow">
                  <span className="item-title" style={{ display: 'block' }}>Nobody else yet</span>
                  <span className="item-sub">
                    {isOwner ? 'Add the people you share with under Server → People and server settings.' : 'Whoever runs this server adds people.'}
                  </span>
                </span>
              </div>
            )}
          </div>
        </section>
    ),
    private: (
        <section className="stack">
          <div className="section-head"><h2>Your private space</h2><span className="meta">Not shared</span></div>
          <Link className="item list" to="/android/yours" style={{ borderRadius: 'var(--radius-lg)' }}>
            <span className="glyph on-warm"><Icon name="lock" size={18} /></span>
            <span className="grow">
              <span className="item-title" style={{ display: 'block' }}>Pay, cards and anything you owe elsewhere</span>
              <span className="item-sub">Kept apart from the household. {memberList.length > 1 ? 'Everyone here has one of these too, and nobody can see inside anyone else’s.' : 'Nobody else can see inside it, ever.'}</span>
            </span>
          </Link>
        </section>
    ),
    mode: (
        <section className="stack">
          <div className="section-head"><h2>How you use KTL</h2><span className="meta">{memberList.length > 1 ? 'Applies to everyone' : 'Applies to you'}</span></div>
          <div className="card stack">
            <div className="seg" role="tablist" aria-label="How you use KTL">
              <button role="tab" aria-selected={mode === 'chase'} onClick={() => setModeAndToast('chase')}>Chase and confirm</button>
              <button role="tab" aria-selected={mode === 'track'} onClick={() => setModeAndToast('track')}>Tracking only</button>
            </div>
            <p className="body-sm">{MODE_NOTE[mode]}</p>
            <ul className="stack-sm">
              {MODE_POINTS[mode].map((t, i) => (
                <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }} key={i}>
                  <span style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 3 }}><Icon name="check" size={15} /></span>
                  <span className="body-sm">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
    ),
    reminders: (
        <section className="stack">
          <div className="section-head"><h2>Reminders</h2><span className="meta">{memberList.length > 1 ? 'Applies to everyone' : 'Applies to you'}</span></div>
          {mode === 'track' && (
            <p className="hint">
              <Icon name="alert" size={16} />
              Money reminders and confirmation nudges are off in tracking mode. The heads-up that a bill is coming still goes out.
            </p>
          )}
          <div className="list">
            <NotificationSetting />
            <button className="item" onClick={() => open('sheet-lead')}>
              <span className="glyph on-warm"><Icon name="pencil" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Ask for details</span>
                <span className="item-sub">{K.data.reminders.detailsLead} days before the bill, at {K.data.reminders.detailsTime}</span>
              </span>
            </button>
            <button className="item" onClick={() => open('sheet-lead')}>
              <span className="glyph on-warm"><Icon name="send" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Ask for the money</span>
                <span className="item-sub">{K.data.reminders.paymentLead} days before the bill, at {K.data.reminders.paymentTime}</span>
              </span>
            </button>
            <div className="item">
              <span className="glyph on-warm"><Icon name="clock" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Nudge if nobody confirms</span>
                <span className="item-sub">{K.data.reminders.nudgeAfter > 0 ? `After ${K.data.reminders.nudgeAfter} hours, once per item` : 'Off'}</span>
              </span>
              <SavedSwitch label="Nudge if nobody confirms" on={K.data.reminders.nudgeAfter > 0}
                save={(v) => K.updateReminders({ nudgeAfter: v ? 24 : 0 })}
                onLabel="Nudges back on" offLabel="Nudges off — nothing will chase a missing confirmation" />
            </div>
            <div className="item">
              <span className="glyph on-warm"><Icon name="bell" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Quiet hours</span>
                <span className="item-sub">{quietHoursOn(K.data.reminders) ? `Nothing between ${K.data.reminders.quietFrom} and ${K.data.reminders.quietTo}` : 'Off — reminders can arrive at any time'}</span>
              </span>
              <SavedSwitch label="Quiet hours" on={quietHoursOn(K.data.reminders)}
                save={(v) => K.updateReminders(v ? { quietFrom: '22:00', quietTo: '08:00' } : { quietFrom: '00:00', quietTo: '00:00' })}
                onLabel="Quiet hours on" offLabel="Quiet hours off" />
            </div>
            <div className="item">
              <span className="glyph on-warm"><Icon name="calendar" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Sunday summary</span>
                <span className="item-sub">{K.data.reminders.weeklyDigest !== false ? 'Sunday at 18:00: what’s due in the week ahead' : 'Off'}</span>
              </span>
              <SavedSwitch label="Sunday summary" on={K.data.reminders.weeklyDigest !== false}
                save={(v) => K.updateReminders({ weeklyDigest: v })}
                onLabel="Sunday summary on" offLabel="Sunday summary off" />
            </div>
          </div>
        </section>
    ),
    money: (
        <section className="stack">
          <div className="section-head"><h2>Money</h2></div>
          <div className="list">
            <div className="item">
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Default split</span>
                <span className="item-sub">Applies to every new bill unless you change it</span>
              </span>
              <span className="tag num">{household.split}</span>
            </div>
            {household.payoutRef && (
              <div className="item">
                <span className="grow">
                  <span className="item-title" style={{ display: 'block' }}>Transfer reference</span>
                  <span className="item-sub">Added to every settle-up so it’s findable later</span>
                </span>
                <span className="tag num">{household.payoutRef}</span>
              </div>
            )}
          </div>
          <p className="hint">
            <Icon name="lock" size={16} />
            KTL stores the details you type in and nothing else. It has no bank connection and never initiates a payment.
          </p>
        </section>
    ),
    help: (
        <section className="stack">
          <div className="section-head"><h2>Help</h2></div>
          <div className="list">
            <button className="item" onClick={W.restart}>
              <span className="glyph on-warm"><Icon name="refresh" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Restart the walkthrough</span>
                <span className="item-sub">Get guided through setting KTL up again</span>
              </span>
            </button>
          </div>
        </section>
    ),
    server: <ServerSection isOwner={you && memberList.find((m) => m.id === you.id)?.role === 'owner'} />,
    security: <SecuritySection />,
    password: (
        <section className="stack">
          <div className="section-head"><h2>Password</h2></div>
          <ChangePassword />
        </section>
    ),
    deleteAccount: (
        <section className="stack">
          <div className="section-head"><h2>Delete your account</h2></div>
          <div className="card stack">
            <p className="body-sm">
              Permanently deletes your account and everything only you can see — your pay, cards, loans, personal
              bills and plan.
              {memberList.length > 1 && ' Anything still open between you and the household is written off first.'}
              {' '}Bills and loans you paid for are removed from the household’s history; the rest stays with the
              people still in it.
            </p>
            <button className="btn btn-danger-text" style={{ alignSelf: 'flex-start' }} onClick={() => open('dialog-delete-account')}>
              Delete my account
            </button>
          </div>
        </section>
    )
  };

  return (
    <>
      {tablet ? (
        <>
          <TabletTopbar title={household.name || 'Your household'} sub={peopleLine}>
            <button className="btn btn-secondary btn-sm" onClick={openRenameSheet}>
              <Icon name="pencil" size={16} />Rename
            </button>
          </TabletTopbar>

          <div className="tablet-columns">
            <section className="tablet-list-pane">
              <nav className="stack-sm" aria-label="Household settings">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    className="item list tablet-row"
                    aria-current={String(c.id === category)}
                    onClick={() => setCategory(c.id)}
                  >
                    <span className="glyph on-warm"><Icon name={c.icon} size={18} /></span>
                    <span className="grow"><span className="item-title" style={{ display: 'block' }}>{c.label}</span></span>
                  </button>
                ))}
              </nav>
            </section>
            <section className="tablet-detail-pane">{sections[category]}</section>
          </div>
        </>
      ) : (
        <>
          <header className="md-appbar">
            <Link className="md-iconbtn" to="/android/home" aria-label="Back"><Icon name="back" size={22} /></Link>
            <span className="appbar-title">Household</span>
            <Bell />
          </header>

          <div className="md-headline">
            <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
              <h1>{household.name || 'Your household'}</h1>
              <button className="md-iconbtn" aria-label="Rename your household" onClick={openRenameSheet}>
                <Icon name="pencil" size={18} />
              </button>
            </div>
            <p className="meta">{peopleLine}</p>
          </div>

          <PullToRefresh className="scroll" onRefresh={K.refreshNow}>
            {CATEGORIES.map((c) => <Fragment key={c.id}>{sections[c.id]}</Fragment>)}
          </PullToRefresh>

          <AndroidNavBar active="house" />
        </>
      )}

      <Sheet id="sheet-rename" titleId="sheet-rename-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-rename-title">Rename your household</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>{memberList.length > 1 ? 'Everyone in your household sees this too' : partnerName + ' sees this too'} — it's the shared name, not just yours.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (nicknameInvalid ? ' invalid' : '')}>
            <label htmlFor="household-nickname">Household name</label>
            <input className="input" id="household-nickname" type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <span className="field-error">Give it a name.</span>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={renaming} onClick={saveRename}>{renaming ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-lead" titleId="sheet-lead-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-lead-title">When should we ask?</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Counted back from the day the provider takes the money.</p>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>Details reminder</label>
            <div className="seg" role="tablist" aria-label="Days before, details">
              {[3, 5, 7].map((d) => (
                <button key={d} role="tab" aria-selected={detailsLead === d} onClick={() => setDetailsLead(d)}>{d} days</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="lead-details-time">Time of day</label>
            <input className="input num-input" id="lead-details-time" type="time" value={detailsTime} onChange={(e) => setDetailsTime(e.target.value)} />
          </div>
          <hr className="divider" />
          <div className="field">
            <label>Money reminder</label>
            <div className="seg" role="tablist" aria-label="Days before, money">
              {[1, 2, 4].map((d) => (
                <button key={d} role="tab" aria-selected={paymentLead === d} onClick={() => setPaymentLead(d)}>{d} day{d === 1 ? '' : 's'}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="lead-payment-time">Time of day</label>
            <input className="input num-input" id="lead-payment-time" type="time" value={paymentTime} onChange={(e) => setPaymentTime(e.target.value)} />
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={savingLead} onClick={saveLead}>
            {savingLead ? 'Saving…' : 'Save the schedule'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <MdDialog id="dialog-delete-account" titleId="dialog-delete-account-title">
        <h2 id="dialog-delete-account-title">Delete your account?</h2>
        {memberList.length > 1 && exitSummary.openCount > 0 && (
          <p className="body-sm">
            This first closes <span className="num">{exitSummary.openCount}</span> open{' '}
            {exitSummary.openCount === 1 ? 'item' : 'items'}.
            {exitSummary.youOweThem > 0 && <> The <span className="num">{money(exitSummary.youOweThem)}</span> you owe is written off.</>}
            {exitSummary.theyOweYou > 0 && <> The <span className="num">{money(exitSummary.theyOweYou)}</span> owed to you is written off.</>}
          </p>
        )}
        <p className="body-sm">Your account and everything in Yours are deleted for good. This can’t be undone.</p>
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={close}>Keep my account</button>
          <button className="btn btn-danger-text btn-sm" disabled={busyExit} onClick={confirmDeleteAccount}>
            {busyExit ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </MdDialog>

      <MdDialog id="dialog-remove-member" titleId="dialog-remove-title">
        <h2 id="dialog-remove-title">Remove {removing?.name}?</h2>
        <p className="body-sm">
          {removeSummary.openCount > 0 ? (
            <>
              This closes <span className="num">{removeSummary.openCount}</span> open {removeSummary.openCount === 1 ? 'item' : 'items'} of theirs.
              {removeSummary.theyOweYou > 0 && <> The <span className="num">{money(removeSummary.theyOweYou)}</span> they owe you is written off,</>}
              {removeSummary.youOweThem > 0 && <> the <span className="num">{money(removeSummary.youOweThem)}</span> you owe them is written off,</>}
              {' '}and their share of anything still running is absorbed by whoever is left.
            </>
          ) : (
            <>Nothing of theirs is outstanding, so no balances change.</>
          )}
        </p>
        <p className="body-sm">Their account is deleted too, so they can’t sign back in. Settled history stays, but their name won’t show on it once they’re gone.</p>
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={close}>Keep them</button>
          <button className="btn btn-danger-text btn-sm" disabled={busyExit} onClick={confirmRemove}>
            {busyExit ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </MdDialog>
    </>
  );
}
