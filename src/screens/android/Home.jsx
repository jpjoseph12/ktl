import { useState } from 'react';
import { Link } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import Sheet from '../../components/Sheet';
import MdDialog from '../../components/MdDialog';
import Icon from '../../components/Icon';
import Pill from '../../components/Pill';
import CopyButton from '../../components/CopyButton';
import Bell from '../../components/Bell';
import BalanceList from '../../components/BalanceList';
import AddChooser, { ADD_CHOOSER_ID } from '../../components/AddChooser';
import PullToRefresh from '../../components/PullToRefresh';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { money, round2 } from '../../lib/kettle';
import { parseBillAmount } from '../../lib/validation';
import useIsTablet from '../../lib/useIsTablet';
import TabletHome from '../tablet/Home';

export default function AndroidHome() {
  const isTablet = useIsTablet();
  if (isTablet) return <TabletHome />;
  return (
    <PhoneShell platform="android">
      <HomeBody />
    </PhoneShell>
  );
}

function HomeBody() {
  const K = useKettle();
  const { you, partner, data: { household } } = K;
  const others = K.others || (partner ? [partner] : []);
  const { open, close, toast } = useScreen();
  const partnerName = partner?.name || 'your partner';

  const b = K.balance();
  const perPerson = K.balances ? K.balances() : {};
  const c = K.cycleTotals();
  const tracking = K.tracking();
  const flight = b.inFlightToYou + b.inFlightFromYou;

  const needsYou = K.needsYou();

  /* ── the one action currently open in a sheet/dialog ─────────────── */
  const [selected, setSelected] = useState(null);

  function startAction(action) {
    setSelected(action);
    if (action.type === 'pay') open('sheet-pay');
    else if (action.type === 'details') open('sheet-details');
    else if (action.type === 'confirm') open('dialog-confirm');
  }

  const [detailsValue, setDetailsValue] = useState('');
  const [detailsChecked, setDetailsChecked] = useState(false);
  const [detailsAmount, setDetailsAmount] = useState('');
  const [detailsAmountInvalid, setDetailsAmountInvalid] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  function openDetailsSheet(action) {
    setDetailsValue('');
    setDetailsChecked(false);
    setDetailsAmount(String(action.item.total));
    setDetailsAmountInvalid(false);
    setDetailsError('');
    startAction(action);
  }

  async function markSent() {
    if (!selected) return;
    const item = selected.item;
    await K.setStatus(item.id, K.closedStatus(), `${tracking ? 'Recorded' : 'Marked'} ${money(item.yourShare)} for ${item.name}`);
    close();
    toast(tracking ? `${money(item.yourShare)} recorded as paid. ${item.name} is closed.` : `${partnerName} has been told your ${money(item.yourShare)} is on the way.`);
  }

  /* The details sheet is the one prompt a variable bill puts in front of
     you each cycle, so it's also where the new amount gets typed. Without
     its own field that figure landed in the free-text details and the
     bill kept its old total. */
  async function submitDetails() {
    if (!selected) return;
    const item = selected.item;
    const amount = parseBillAmount(detailsAmount);
    setDetailsAmountInvalid(amount === null);
    if (amount === null) return;
    const changed = round2(amount) !== round2(item.total);
    setDetailsError('');
    try {
      if (changed) await K.recordBillAmount(item.id, amount);
      await K.setFlag(item.id, 'detailsYou', true, detailsValue.trim() || undefined);
    } catch (err) {
      setDetailsError(err.message || 'Couldn’t save that. Check your connection and try again.');
      return;
    }
    close();
    toast(changed
      ? `${item.name} updated to ${money(amount)}. ${partnerName} can see it now.`
      : `Details shared. ${partnerName} can see them now.`);
  }

  async function confirmReceived() {
    if (!selected) return;
    const item = selected.item;
    await K.setStatus(item.id, 'settled', `Confirmed ${money(item.theirShare)} received for ${item.name}`);
    close();
    toast(`${item.name} is settled.`);
  }

  async function notReceived() {
    if (!selected) return;
    const item = selected.item;
    await K.setStatus(item.id, 'payment-due');
    close();
    toast(`We’ve flagged the ${money(item.theirShare)} as missing.`);
  }

  const upcoming = K.data.bills
    .filter((i) => i.status !== 'settled')
    .slice()
    .sort((a, b2) => (a.dueSort && b2.dueSort ? new Date(a.dueSort) - new Date(b2.dueSort) : 0))
    .slice(0, 4);

  return (
    <>
      <header className="md-appbar">
        <Link className="md-iconbtn" to="/android/household" aria-label={`${household.name} household`}>
          <span className="avatar you" aria-hidden="true">{you?.initials}</span>
        </Link>
        <span className="appbar-title">KTL</span>
        <Bell />
        <Link className="md-iconbtn" to="/android/household" aria-label="Settings">
          <Icon name="settings" size={22} />
        </Link>
      </header>

      <div className="md-headline">
        <h1>{household.name || 'Your household'}</h1>
        <p className="meta">{c.closed} of {c.count} bills closed · {money(c.total)} pot</p>
      </div>

      <PullToRefresh className="scroll has-fab" onRefresh={K.refreshNow}>
        {K.data.bills.length === 0 && K.data.lending.length === 0 && (
          <section className="card card-lg stack">
            <p className="eyebrow">Get started</p>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Add your first shared bill</h2>
            <p className="body-sm">
              Rent, council tax, energy — whatever you actually split. {partner ? `${partnerName} sees it the moment you add it.` : `Once ${partnerName === 'your partner' ? 'someone joins' : partnerName + ' joins'}, they’ll see it too.`}
            </p>
            <Link className="btn btn-primary btn-block" to="/android/bills">
              <Icon name="plus" size={17} />Add a cost
            </Link>
            <p className="hint">
              <Icon name="lock" size={16} />
              <span>Your own pay, bills and any debt stay separate — that’s all set up on the <strong>Yours</strong> tab, never here.</span>
            </p>
          </section>
        )}

        {needsYou.length > 0 && (
          <section className="stack">
            <div className="section-head"><h2>Needs you</h2><span className="meta">{needsYou.length} open</span></div>

            {needsYou.map(({ type, item }) => (
              <article className={'card stack' + (type === 'pay' ? ' card-lg' : '')} key={type + item.id}>
                <div className="row">
                  <span className="glyph"><Icon name={item.glyph} size={20} /></span>
                  <div className="grow">
                    <div className="item-title">{item.name}</div>
                    <div className="item-sub">
                      {type === 'pay' && `Send your ${money(item.yourShare)} share to ${K.data.people[item.payerId]?.name || 'them'}`}
                      {type === 'details' && (() => {
                        const othersDone = others.filter((m) => item.details[m.id]?.done).length;
                        return othersDone === others.length && others.length > 0 ? 'Everyone else has added theirs.' : 'Waiting on everyone.';
                      })()}
                      {type === 'confirm' && `Marked ${money(item.theirShare)} sent — check it landed`}
                    </div>
                  </div>
                  <Pill item={item} />
                </div>

                {type === 'pay' && (
                  <>
                    <div>
                      <div className="amount-lg num">{money(item.yourShare)}</div>
                      <p className="item-sub" style={{ marginTop: 4 }}>your share of {money(item.total)}</p>
                    </div>
                    <div className="stack-sm">
                      <button className="btn btn-primary btn-block" onClick={() => startAction({ type, item })}>
                        <Icon name="send" size={17} />{tracking ? `Record ${money(item.yourShare)} as paid` : `Mark ${money(item.yourShare)} as sent`}
                      </button>
                      <Link className="btn btn-ghost btn-block" to="/android/bills">View the bill</Link>
                    </div>
                  </>
                )}

                {type === 'details' && (
                  <div className="row-between">
                    <span className="meta">{item.due ? `Due ${item.due}` : 'Details needed'}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetailsSheet({ type, item })}>Add details</button>
                  </div>
                )}

                {type === 'confirm' && (
                  <div className="row-between">
                    <span className="meta">Waiting on your confirmation</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => startAction({ type, item })}>Confirm received</button>
                  </div>
                )}
              </article>
            ))}
          </section>
        )}

        <section>
          <div className="card card-lg stack">
            <p className="eyebrow">{others.length > 1 ? 'Your household balance' : `Between you and ${partnerName}`}</p>
            <BalanceList people={others} balances={perPerson} />
            <hr className="divider" />
            <div className="row-between">
              <span className="item-sub">
                {flight > 0
                  ? money(flight) + ' in flight, not yet confirmed'
                  : tracking
                  ? money(b.youOwe) + ' owed across bills and lending'
                  : 'Everything sent has been confirmed'}
              </span>
              <Link className="meta" to="/android/settle" style={{ color: 'var(--fg-2)' }}>Breakdown →</Link>
            </div>
            {b.youOwe > 0 && others.length === 1 && (
              <Link className="btn btn-secondary btn-sm btn-block" to="/android/settle?scope=full">
                I’ve paid the whole lot
              </Link>
            )}
          </div>
        </section>

        <section className="stack">
          <div className="section-head">
            <h2>This month’s bills</h2>
            <Link className="meta" to="/android/bills" style={{ color: 'var(--fg-2)' }}>All {c.count} →</Link>
          </div>
          {c.total > 0 && (
            <div className="card stack">
              <div className="progress"><span style={{ width: Math.round((c.paidOut / c.total) * 100) + '%' }} /></div>
              <p className="meta">
                {money(c.paidOut)} of {money(c.total)} paid to providers · {c.closed} of {c.count} bills closed
              </p>
            </div>
          )}
          <div className="list">
            {upcoming.length ? upcoming.map((item) => (
              <UpcomingRow key={item.id} item={item} />
            )) : (
              <div className="item"><span className="grow"><span className="item-sub">Nothing added yet. Use the button below to add your first recurring cost.</span></span></div>
            )}
          </div>
        </section>

        {K.data.activity.length > 0 && (
          <section className="stack">
            <div className="section-head"><h2>Recent</h2></div>
            <ul className="list">
              {K.data.activity.slice(0, 3).map((a) => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </ul>
          </section>
        )}
      </PullToRefresh>

      <button className="md-fab" onClick={() => open(ADD_CHOOSER_ID)}>
        <Icon name="plus" size={22} />Add a cost
      </button>

      <AndroidNavBar active="home" />

      <Sheet id="sheet-pay" titleId="sheet-pay-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-pay-title">
            {selected ? `Send ${money(selected.item.yourShare)} to ${K.data.people[selected.item.payerId]?.name || partnerName}` : 'Send'}
          </h2>
        </div>
        <div className="sheet-body">
          {selected && (
            <>
              <dl style={{ margin: 0 }}>
                <div className="kv"><dt>For</dt><dd>{selected.item.name}</dd></div>
                <div className="kv"><dt>Your share</dt><dd className="num">{money(selected.item.yourShare)} of {money(selected.item.total)}</dd></div>
                <div className="kv"><dt>Pay to</dt><dd>{K.data.people[selected.item.payerId]?.name || partnerName}</dd></div>
                {household.payoutRef && <div className="kv"><dt>Reference</dt><dd className="num">{household.payoutRef}</dd></div>}
              </dl>
              {household.payoutRef && (
                <CopyButton className="btn btn-secondary btn-block" text={household.payoutRef} toastMsg={`Reference ${household.payoutRef} copied`}>
                  <Icon name="copy" size={17} />Copy the reference
                </CopyButton>
              )}
              <p className="hint">
                <Icon name="lock" size={16} />
                <span>
                  {tracking
                    ? 'KTL never moves money. Send it in your banking app, then tap below — the bill closes on the spot.'
                    : `KTL never moves money. Send it in your banking app, then confirm here — ${K.data.people[selected.item.payerId]?.name || partnerName} gets told straight away.`}
                </span>
              </p>
            </>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" onClick={markSent}>
            {tracking ? 'Record as paid' : 'I’ve sent it'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={close}>Not yet</button>
        </div>
      </Sheet>

      <Sheet id="sheet-details" titleId="sheet-details-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-details-title">
            {selected ? `Your ${(selected.item.detailsLabel || 'details').toLowerCase()}` : 'Details'}
          </h2>
          {selected?.item.due && <p className="item-sub" style={{ marginTop: 4 }}>Due before the bill lands on {selected.item.due}.</p>}
        </div>
        <div className="sheet-body">
          {selected?.item.logo && (
            <span className="brand-plate">
              <img className="brand-mark" src={'/assets/logos/' + selected.item.logo} width={selected.item.logoW} height={selected.item.logoH} alt={selected.item.provider} />
            </span>
          )}
          <div className={'field' + (detailsAmountInvalid ? ' invalid' : '')}>
            <label htmlFor="home-details-amount">What it came to this time (£)</label>
            <input className="input num-input" id="home-details-amount" type="text" inputMode="decimal" value={detailsAmount} onChange={(e) => setDetailsAmount(e.target.value)} />
            <span className="field-help">Change it if this month’s bill is different. Everyone’s share follows.</span>
            <span className="field-error">Enter what the bill came to, like 82.40.</span>
          </div>
          <div className="field">
            <label htmlFor="home-details-value">{selected?.item.detailsLabel || 'Anything else to share? (optional)'}</label>
            <input className="input" id="home-details-value" type="text" value={detailsValue} onChange={(e) => setDetailsValue(e.target.value)} />
          </div>
          <label className="confirm-row" htmlFor="home-details-confirm">
            <input type="checkbox" id="home-details-confirm" checked={detailsChecked} onChange={(e) => setDetailsChecked(e.target.checked)} />
            <span>I confirm I’ve shared this with {others.length > 1 ? 'my household' : partnerName}.</span>
          </label>
          {detailsError && <p className="hint"><Icon name="alert" size={16} />{detailsError}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={!detailsChecked} onClick={submitDetails}>Confirm details shared</button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <MdDialog id="dialog-confirm" titleId="dialog-confirm-title">
        {selected && (
          <>
            <h2 id="dialog-confirm-title">
              {others.length === 1 ? `Did ${partnerName}’s ${money(selected.item.theirShare)} land?` : `Did the ${money(selected.item.theirShare)} land?`}
            </h2>
            <p className="body-sm">
              {selected.item.name}. Confirming closes the bill and stops the reminders for it.
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button className="btn btn-ghost btn-sm" onClick={notReceived}>Not arrived</button>
          <button className="btn btn-primary btn-sm" onClick={confirmReceived}>Yes, it arrived</button>
        </div>
      </MdDialog>

      <AddChooser />
    </>
  );
}

function UpcomingRow({ item }) {
  const K = useKettle();
  const others = K.others || (K.partner ? [K.partner] : []);
  const direction = item.payer === 'you'
    ? `${others.length > 1 ? 'others' : (others[0]?.name || 'your partner')} owe${others.length > 1 ? '' : 's'} ${money(item.theirShare)}`
    : `you owe ${money(item.yourShare)}`;
  return (
    <Link className="item" to="/android/bills">
      <span className="glyph"><Icon name={item.glyph} size={20} /></span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block' }}>{item.name}</span>
        <span className="item-sub">{item.due || item.date} · {direction}</span>
      </span>
      <span className="item-end">
        <Pill item={item} />
        <span className="meta num">{money(item.total)}</span>
      </span>
    </Link>
  );
}

function ActivityRow({ a }) {
  const { data, you } = useKettle();
  const person = data.people[a.who];
  return (
    <li className="item">
      <span className={'avatar' + (a.who === you?.id ? ' you' : '')}>{person ? person.initials : '?'}</span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block', fontWeight: 500 }}>{a.text}</span>
        <span className="item-sub">{a.date} · {a.tag}</span>
      </span>
    </li>
  );
}
