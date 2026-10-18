import { useState } from 'react';
import { Link } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import MdDialog from '../../components/MdDialog';
import Icon from '../../components/Icon';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { money } from '../../lib/kettle';
import PullToRefresh from '../../components/PullToRefresh';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import useIsTablet from '../../lib/useIsTablet';

function actionFor(type, item, K, partnerName) {
  switch (type) {
    case 'pay':
      return {
        title: `Send ${money(item.yourShare)} to ${partnerName}`,
        sub: `${item.name} · your share of ${money(item.total)}`,
        cta: K.tracking() ? `Record ${money(item.yourShare)} as paid` : `I’ve sent ${money(item.yourShare)}`,
        rows: [['Amount', money(item.yourShare)], ['To', partnerName], ...(K.data.household.payoutRef ? [['Reference', K.data.household.payoutRef]] : [])],
        commit: () => K.setStatus(item.id, K.closedStatus(), `${K.tracking() ? 'Recorded' : 'Marked'} ${money(item.yourShare)} for ${item.name}`),
        toast: K.tracking() ? `${money(item.yourShare)} recorded as paid. ${item.name} is closed.` : `${partnerName} has been told your ${money(item.yourShare)} is on the way.`
      };
    case 'details':
      return {
        title: `Add your ${(item.detailsLabel || 'details').toLowerCase()}`,
        sub: `${item.name} · ${item.detailsPartner.done ? `${partnerName} has already added theirs` : 'waiting on both of you'}`,
        cta: 'Confirm shared',
        rows: [['Bill', item.name], ['Shared with', partnerName]],
        commit: () => K.setFlag(item.id, 'detailsYou', true),
        toast: `Details shared. ${partnerName} can see them now.`
      };
    case 'confirm':
      return {
        title: `Confirm ${money(item.theirShare)} arrived`,
        sub: `${item.name} · ${partnerName} marked it sent`,
        cta: 'Yes, it arrived',
        rows: [['Amount', money(item.theirShare)], ['From', partnerName]],
        commit: () => K.setStatus(item.id, 'settled', `Confirmed ${money(item.theirShare)} received for ${item.name}`),
        toast: `${item.name} is settled.`
      };
    default:
      return null;
  }
}

function pillFor(type) {
  if (type === 'pay') return { cls: 'is-due', text: 'Money' };
  if (type === 'details') return { cls: 'is-details', text: 'Details' };
  return { cls: 'is-sent', text: 'Confirm' };
}

export default function AndroidAlerts() {
  const isTablet = useIsTablet();
  if (isTablet) {
    return (
      <TabletShell platform="android" active="alerts">
        <AlertsBody tablet />
      </TabletShell>
    );
  }
  return (
    <PhoneShell platform="android">
      <AlertsBody />
    </PhoneShell>
  );
}

/* On a tablet the picked alert opens in the right-hand pane and is acted
   on there — the pane is the confirmation, so there's no dialog. With
   nothing picked, the pane shows how the reminders work. */
function AlertsBody({ tablet = false }) {
  const K = useKettle();
  const { open, close, toast } = useScreen();
  const [pending, setPending] = useState(null);
  const partnerName = K.partner?.name || 'your partner';

  const tracking = K.tracking();
  const needsYou = K.needsYou();
  const scheduled = K.data.scheduled;

  const waiting = [];
  K.all().forEach((i) => {
    if (i.status === 'sent' && i.payer === 'partner') {
      waiting.push({ text: `${partnerName} to confirm your ${money(i.yourShare)} landed`, sub: `${i.name} · nudge in ${K.data.reminders.nudgeAfter}h` });
    }
    if (i.status === 'awaiting-details' && i.needsDetails && !i.detailsPartner.done) {
      waiting.push({ text: `${partnerName} hasn’t filed their ${(i.detailsLabel || 'details').toLowerCase()}`, sub: i.name });
    }
  });

  const steps = tracking
    ? [
        ['pencil', <>Heads-up, <span className="num">{K.data.reminders.detailsLead}</span> days before</>,
          'You’re told what’s coming and asked for anything that changes the amount. Nobody has to confirm it back.'],
        ['check', 'You close it once you’ve paid',
          'One tap records the payment — the whole amount or the netted one — and the line closes on the spot.']
      ]
    : [
        ['pencil', <>Details, <span className="num">{K.data.reminders.detailsLead}</span> days before</>,
          `Both of you are asked for details at ${K.data.reminders.detailsTime}, and have to tick that you’ve shared them.`],
        ['send', <>Money, <span className="num">{K.data.reminders.paymentLead}</span> days before</>,
          `Whoever owes gets the amount and reference at ${K.data.reminders.paymentTime}, then confirms they’ve sent it.`]
      ];

  function startAction(type, item) {
    const act = actionFor(type, item, K, partnerName);
    if (!act) return;
    setPending(act);
    open('dialog-act');
  }

  async function commit() {
    if (!pending) return;
    await pending.commit();
    close();
    toast(pending.toast);
    setPending(null);
  }

  function snooze(type, item) {
    K.snoozeItem(type, item.id);
    toast('Snoozed until later today.');
  }

  /* ── tablet: the alert shown in the right-hand pane. Once it's acted
     on or snoozed it leaves needsYou(), and the pane falls back to the
     reminder rules on its own. */
  const [pickedKey, setPickedKey] = useState(null);
  const picked = tablet ? needsYou.find(({ type, item }) => `${type}:${item.id}` === pickedKey) || null : null;
  const pickedAct = picked ? actionFor(picked.type, picked.item, K, partnerName) : null;

  async function commitPicked() {
    await pickedAct.commit();
    toast(pickedAct.toast);
  }

  const summaryLine = `${needsYou.length} need you · ${scheduled.length} scheduled this month`;

  const rulesCard = (
        <section className="card stack">
          <p className="eyebrow">{tracking ? 'How KTL works for you' : 'How KTL chases you'}</p>
          <div className="cycle">
            {steps.map((s, i) => (
              <div className="cycle-step" key={i}>
                <span className="cycle-rail">
                  <span className="cycle-dot"><Icon name={s[0]} size={12} /></span>
                  {i < steps.length - 1 && <span className="cycle-line" />}
                </span>
                <span className="cycle-body">
                  <span className="cycle-label">{s[1]}</span>
                  <span className="cycle-note">{s[2]}</span>
                </span>
              </div>
            ))}
          </div>
          <Link className="btn btn-secondary btn-block btn-sm" to="/android/household">Change how this works</Link>
        </section>
  );

  const phoneNeeds = (
        <section className="stack">
          <div className="section-head"><h2>Needs you</h2><span className="meta">{needsYou.length} open</span></div>
          <div className="stack">
            {needsYou.length ? (
              needsYou.map(({ type, item }) => {
                const act = actionFor(type, item, K, partnerName);
                return (
                  <article className="card stack" key={type + item.id}>
                    <div className="row">
                      <span className="glyph"><Icon name={item.glyph} size={20} /></span>
                      <span className="grow">
                        <span className="item-title" style={{ display: 'block' }}>{act.title}</span>
                        <span className="item-sub">{act.sub}</span>
                      </span>
                      <span className={'pill ' + (type === 'pay' ? 'is-due' : type === 'details' ? 'is-details' : 'is-sent')}>
                        {type === 'pay' ? 'Money' : type === 'details' ? 'Details' : 'Confirm'}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <button className="btn btn-secondary btn-sm grow" onClick={() => startAction(type, item)}>{act.cta}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => snooze(type, item)}>
                        Snooze
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="card"><p className="body-sm">Nothing needs you right now.{scheduled[0] ? ` Next reminder: ${scheduled[0].at}.` : ''}</p></div>
            )}
          </div>
        </section>
  );

  const tabletNeeds = (
        <section className="stack">
          <div className="section-head"><h2>Needs you</h2><span className="meta">{needsYou.length} open</span></div>
          <div className="stack-sm">
            {needsYou.length ? needsYou.map(({ type, item }) => {
              const act = actionFor(type, item, K, partnerName);
              const key = `${type}:${item.id}`;
              const pill = pillFor(type);
              return (
                <button className="item list tablet-row" key={key} aria-current={String(key === pickedKey)} onClick={() => setPickedKey(key)}>
                  <span className="glyph"><Icon name={item.glyph} size={20} /></span>
                  <span className="grow">
                    <span className="item-title" style={{ display: 'block' }}>{act.title}</span>
                    <span className="item-sub">{act.sub}</span>
                  </span>
                  <span className={'pill ' + pill.cls}>{pill.text}</span>
                </button>
              );
            }) : (
              <p className="hint"><Icon name="check-circle" size={16} /><span>Nothing needs you right now.</span></p>
            )}
          </div>
        </section>
  );

  const restSections = (
    <>
        <section className="stack">
          <div className="section-head"><h2>Waiting on {partnerName}</h2></div>
          <div className="list">
            {waiting.length ? (
              waiting.map((i, idx) => (
                <div className="item" key={idx}>
                  <span className="avatar">{K.partner?.initials}</span>
                  <span className="grow">
                    <span className="item-title" style={{ display: 'block', fontWeight: 500 }}>{i.text}</span>
                    <span className="item-sub">{i.sub}</span>
                  </span>
                  <span className="pill is-scheduled">Waiting</span>
                </div>
              ))
            ) : (
              <div className="item"><span className="grow"><span className="item-sub">Nothing outstanding — {partnerName} is up to date.</span></span></div>
            )}
          </div>
        </section>

        <section className="stack">
          <div className="section-head"><h2>Coming up</h2><span className="meta">Next {scheduled.length}</span></div>
          <ul className="list">
            {scheduled.length ? scheduled.map((s, i) => (
              <li className="item" key={i}>
                <span className="glyph on-warm"><Icon name={s.kind === 'payment' ? 'send' : s.kind === 'renewal' ? 'refresh' : 'pencil'} size={18} /></span>
                <span className="grow">
                  <span className="item-title" style={{ display: 'block', fontWeight: 500 }}>{s.title}</span>
                  <span className="item-sub">{s.sub}</span>
                </span>
                <span className="meta" style={{ textAlign: 'right', maxWidth: 84 }}>{s.at}</span>
              </li>
            )) : (
              <li className="item"><span className="grow"><span className="item-sub">Nothing scheduled yet.</span></span></li>
            )}
          </ul>
        </section>

        <section className="stack">
          <div className="section-head"><h2>Done this month</h2></div>
          <ul className="list">
            {K.data.activity.length ? K.data.activity.map((a) => (
              <li className="item" key={a.id}>
                <span className={'avatar' + (a.who === K.you?.id ? ' you' : '')}>{K.data.people[a.who]?.initials || '?'}</span>
                <span className="grow">
                  <span className="item-title" style={{ display: 'block', fontWeight: 500 }}>{a.text}</span>
                  <span className="item-sub">{a.date} · {a.tag}</span>
                </span>
              </li>
            )) : (
              <li className="item"><span className="grow"><span className="item-sub">Nothing yet this month.</span></span></li>
            )}
          </ul>
        </section>
    </>
  );

  if (tablet) {
    return (
      <>
        <TabletTopbar title="Alerts" sub={summaryLine}>
          <Link className="btn btn-secondary btn-sm" to="/android/household">
            <Icon name="settings" size={16} />Reminder settings
          </Link>
        </TabletTopbar>

        <div className="tablet-columns">
          <section className="tablet-list-pane">
            {tabletNeeds}
            {restSections}
          </section>
          <section className="tablet-detail-pane">
            {pickedAct ? (
              <article className="card card-lg stack">
                <p className="eyebrow">{pickedAct.title}</p>
                <p className="body-sm">{pickedAct.sub}</p>
                <dl style={{ margin: 0 }}>
                  {pickedAct.rows.map((r) => (
                    <div className="kv" key={r[0]}><dt>{r[0]}</dt><dd className="num">{r[1]}</dd></div>
                  ))}
                </dl>
                <p className="hint">
                  <Icon name="lock" size={16} />
                  <span>
                    {tracking
                      ? 'Confirming just records it. KTL never moves money or reads your bank.'
                      : `Confirming is what tells ${partnerName}. KTL never moves money or reads your bank.`}
                  </span>
                </p>
                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <button className="btn btn-primary" onClick={commitPicked}>{pickedAct.cta}</button>
                  <button className="btn btn-ghost" onClick={() => snooze(picked.type, picked.item)}>Snooze</button>
                </div>
              </article>
            ) : (
              <>
                {rulesCard}
                <p className="hint">
                  <Icon name={needsYou.length ? 'chevron' : 'check-circle'} size={16} />
                  <span>
                    {needsYou.length
                      ? 'Select any item on the left to confirm or act on it.'
                      : `Nothing needs you right now.${scheduled[0] ? ` Next reminder: ${scheduled[0].at}.` : ''}`}
                  </span>
                </p>
              </>
            )}
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="md-appbar">
        <Link className="md-iconbtn" to="/android/home" aria-label="Back"><Icon name="back" size={22} /></Link>
        <span className="appbar-title">Alerts</span>
        <Link className="md-iconbtn" to="/android/household" aria-label="Reminder settings"><Icon name="settings" size={22} /></Link>
      </header>

      <div className="md-headline">
        <p className="meta">{summaryLine}</p>
      </div>

      <PullToRefresh className="scroll" onRefresh={K.refreshNow}>
        {rulesCard}
        {phoneNeeds}
        {restSections}
      </PullToRefresh>

      <AndroidNavBar active="alerts" />

      <MdDialog id="dialog-act" titleId="dialog-act-title">
        <h2 id="dialog-act-title">{pending ? pending.title : 'Confirm'}</h2>
        <p className="body-sm">{pending ? pending.sub : ''}</p>
        <div style={{ marginTop: 'var(--space-4)' }}>
          {pending && (
            <dl style={{ margin: 0 }}>
              {pending.rows.map((r, i) => (
                <div className="kv" key={i}><dt>{r[0]}</dt><dd className="num">{r[1]}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={close}>Not yet</button>
          <button className="btn btn-primary btn-sm" onClick={commit}>{pending ? pending.cta : 'Confirm'}</button>
        </div>
      </MdDialog>
    </>
  );
}
