import { useState } from 'react';
import { Link } from 'react-router-dom';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import MdDialog from '../../components/MdDialog';
import Icon from '../../components/Icon';
import Pill from '../../components/Pill';
import CopyButton from '../../components/CopyButton';
import BalanceList from '../../components/BalanceList';
import AddChooser, { ADD_CHOOSER_ID } from '../../components/AddChooser';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { money, round2 } from '../../lib/kettle';
import { parseBillAmount } from '../../lib/validation';

export default function TabletHome() {
  return (
    <TabletShell platform="android" active="home">
      <TabletHomeBody />
    </TabletShell>
  );
}

const actionKey = (a) => `action:${a.type}:${a.item.id}`;

function useHomeModel() {
  const K = useKettle();
  const others = K.others || (K.partner ? [K.partner] : []);
  const partnerName = K.partner?.name || 'your partner';
  const personName = (id) => K.data.people?.[id]?.name;
  return { K, others, partnerName, personName, tracking: K.tracking() };
}

function TabletHomeBody() {
  const { K, others, partnerName } = useHomeModel();
  const { open, close, toast } = useScreen();

  const b = K.balance();
  const c = K.cycleTotals();
  const needsYou = K.needsYou();
  const flight = b.inFlightToYou + b.inFlightFromYou;
  const items = [...K.data.bills, ...K.data.lending];

  /* Selection is derived, not stored blindly: once an action is done it
     drops out of needsYou, and the pane falls back to whatever needs you
     next — then to the balance — the same way the prototype resets. */
  const [picked, setPicked] = useState(null);
  const pickedValid = picked === 'balance'
    || (picked?.startsWith('bill:') && items.some((i) => i.id === picked.slice(5)))
    || needsYou.some((a) => actionKey(a) === picked);
  const selected = pickedValid ? picked : (needsYou[0] ? actionKey(needsYou[0]) : 'balance');
  const selectedAction = needsYou.find((a) => actionKey(a) === selected);
  const selectedBill = selected.startsWith('bill:') ? items.find((i) => i.id === selected.slice(5)) : null;

  const upcoming = K.data.bills
    .filter((i) => i.status !== 'settled')
    .slice()
    .sort((a, b2) => (a.dueSort && b2.dueSort ? new Date(a.dueSort) - new Date(b2.dueSort) : 0))
    .slice(0, 4);

  const netLabel = b.net === 0
    ? 'You’re square'
    : others.length === 1
      ? (b.net > 0 ? `You owe ${partnerName}` : `${partnerName} owes you`)
      : (b.net > 0 ? 'You owe overall' : 'Owed to you overall');

  const month = new Date().toLocaleString('en-GB', { month: 'long' });

  async function confirmReceived() {
    const item = selectedAction?.item;
    if (!item) return;
    await K.setStatus(item.id, 'settled', `Confirmed ${money(item.theirShare)} received for ${item.name}`);
    close();
    toast(`${item.name} is settled.`);
  }

  async function notReceived() {
    const item = selectedAction?.item;
    if (!item) return;
    await K.setStatus(item.id, 'payment-due');
    close();
    toast(`We’ve flagged the ${money(item.theirShare)} as missing.`);
  }

  return (
    <>
      <TabletTopbar title={month} sub={`${c.closed} of ${c.count} bills closed · ${money(c.total)} pot`}>
        <button className="btn btn-primary btn-sm" onClick={() => open(ADD_CHOOSER_ID)}>
          <Icon name="plus" size={16} />Add a cost
        </button>
      </TabletTopbar>

      <div className="tablet-columns">
        <section className="tablet-list-pane">
          {K.data.bills.length === 0 && K.data.lending.length === 0 && (
            <section className="card card-lg stack">
              <p className="eyebrow">Get started</p>
              <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Add your first shared bill</h2>
              <p className="body-sm">
                Rent, council tax, energy — whatever you actually split. {K.partner ? `${partnerName} sees it the moment you add it.` : 'Once someone joins, they’ll see it too.'}
              </p>
              <button className="btn btn-primary btn-block" onClick={() => open(ADD_CHOOSER_ID)}>
                <Icon name="plus" size={17} />Add a cost
              </button>
            </section>
          )}

          <div className="stack">
            <div className="section-head"><h2>Needs you</h2><span className="meta">{needsYou.length} open</span></div>
            <div className="stack-sm">
              {needsYou.length ? needsYou.map((a) => (
                <ActionRow key={actionKey(a)} action={a} current={selected === actionKey(a)} onSelect={() => setPicked(actionKey(a))} />
              )) : (
                <p className="hint"><Icon name="check-circle" size={16} /><span>Nothing needs you right now.</span></p>
              )}
            </div>
          </div>

          <div className="stack">
            <div className="section-head">
              <h2>{others.length > 1 ? 'Your household balance' : `Between you and ${partnerName}`}</h2>
            </div>
            <button className="item list tablet-row" aria-current={String(selected === 'balance')} onClick={() => setPicked('balance')}>
              <span className="glyph"><Icon name="scale" size={20} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>{netLabel}</span>
                <span className="item-sub">{flight > 0 ? `${money(flight)} in flight` : 'Tap for the full breakdown'}</span>
              </span>
              <span className="item-end"><span className="amount-lg num">{money(Math.abs(b.net))}</span></span>
            </button>
          </div>

          <div className="stack">
            <div className="section-head"><h2>This month’s bills</h2></div>
            {c.total > 0 && (
              <div className="card stack">
                <div className="progress"><span style={{ width: Math.round((c.paidOut / c.total) * 100) + '%' }} /></div>
                <p className="meta">{money(c.paidOut)} of {money(c.total)} paid to providers · {c.closed} of {c.count} bills closed</p>
              </div>
            )}
            <div className="stack-sm">
              {upcoming.length ? upcoming.map((item) => (
                <UpcomingRow key={item.id} item={item} current={selected === `bill:${item.id}`} onSelect={() => setPicked(`bill:${item.id}`)} />
              )) : (
                <p className="hint"><Icon name="list" size={16} /><span>Nothing added yet. Use Add a cost to add your first recurring cost.</span></p>
              )}
            </div>
          </div>

          {K.data.activity.length > 0 && (
            <div className="stack">
              <div className="section-head"><h2>Recent</h2></div>
              <ul className="list">
                {K.data.activity.slice(0, 3).map((a) => <ActivityRow key={a.id} a={a} />)}
              </ul>
            </div>
          )}
        </section>

        <section className="tablet-detail-pane">
          {selectedAction?.type === 'pay' && <PayDetail key={selected} item={selectedAction.item} />}
          {selectedAction?.type === 'details' && <DetailsDetail key={selected} item={selectedAction.item} />}
          {selectedAction?.type === 'confirm' && <ConfirmDetail key={selected} item={selectedAction.item} />}
          {selected === 'balance' && <BalanceDetail />}
          {selectedBill && <BillDetail key={selected} item={selectedBill} />}
        </section>
      </div>

      <MdDialog id="dialog-confirm" titleId="dialog-confirm-title">
        {selectedAction?.type === 'confirm' && (
          <>
            <h2 id="dialog-confirm-title">
              {others.length === 1 ? `Did ${partnerName}’s ${money(selectedAction.item.theirShare)} land?` : `Did the ${money(selectedAction.item.theirShare)} land?`}
            </h2>
            <p className="body-sm">{selectedAction.item.name}. Confirming closes the bill and stops the reminders for it.</p>
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

function ActionRow({ action: { type, item }, current, onSelect }) {
  const { others, partnerName, personName } = useHomeModel();
  const title = type === 'confirm'
    ? (others.length === 1 ? `${partnerName} sent you ${money(item.theirShare)}` : `${money(item.theirShare)} marked as sent`)
    : item.name;
  const sub = type === 'pay'
    ? `Send ${money(item.yourShare)} to ${personName(item.payerId) || 'them'}`
    : type === 'details'
      ? `Your ${(item.detailsLabel || 'details').toLowerCase()} ${item.detailsLabel ? 'are' : 'is'} still missing`
      : `${item.name} · waiting on your confirmation`;
  return (
    <button className="item list tablet-row" aria-current={String(current)} onClick={onSelect}>
      <span className="glyph"><Icon name={item.glyph} size={18} /></span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block' }}>{title}</span>
        <span className="item-sub">{sub}</span>
      </span>
      <Pill item={item} />
    </button>
  );
}

function UpcomingRow({ item, current, onSelect }) {
  const { others } = useHomeModel();
  const direction = item.payer === 'you'
    ? `${others.length > 1 ? 'others' : (others[0]?.name || 'your partner')} owe${others.length > 1 ? '' : 's'} ${money(item.theirShare)}`
    : `you owe ${money(item.yourShare)}`;
  return (
    <button className="item list tablet-row" aria-current={String(current)} onClick={onSelect}>
      <span className="glyph"><Icon name={item.glyph} size={20} /></span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block' }}>{item.name}</span>
        <span className="item-sub">{item.due || item.date} · {direction}</span>
      </span>
      <span className="item-end">
        <Pill item={item} />
        <span className="meta num">{money(item.total)}</span>
      </span>
    </button>
  );
}

function ActivityRow({ a }) {
  const { data, you } = useKettle();
  const person = data.people?.[a.who];
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

function BrandPlate({ item }) {
  if (!item.logo) return null;
  return (
    <span className="brand-plate">
      <img
        className={'brand-mark' + (item.logoW / item.logoH < 1.6 ? ' tall' : '')}
        src={'/assets/logos/' + item.logo}
        width={item.logoW}
        height={item.logoH}
        alt={item.provider || ''}
      />
    </span>
  );
}

function DetailHead({ item, sub }) {
  return (
    <div className="row">
      <span className="glyph"><Icon name={item.glyph} size={22} /></span>
      <div className="grow">
        <div className="item-title">{item.name}</div>
        <div className="item-sub">{sub}</div>
      </div>
      <Pill item={item} />
    </div>
  );
}

function PayDetail({ item }) {
  const { K, partnerName, personName, tracking } = useHomeModel();
  const { toast } = useScreen();
  const payee = personName(item.payerId) || partnerName;
  const ref = K.data.household.payoutRef;

  async function markSent() {
    await K.setStatus(item.id, K.closedStatus(), `${tracking ? 'Recorded' : 'Marked'} ${money(item.yourShare)} for ${item.name}`);
    toast(tracking ? `${money(item.yourShare)} recorded as paid. ${item.name} is closed.` : `${payee} has been told your ${money(item.yourShare)} is on the way.`);
  }

  return (
    <article className="card card-lg stack">
      <DetailHead item={item} sub={item.due ? `${payee} pays the bill · due ${item.due}` : `${payee} paid the bill`} />
      <div>
        <div className="amount-xl num">{money(item.yourShare)}</div>
        <p className="item-sub" style={{ marginTop: 4 }}>your share of {money(item.total)} — send it to {payee}</p>
      </div>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <button className="btn btn-primary" onClick={markSent}>
          <Icon name="send" size={17} />{tracking ? `Record ${money(item.yourShare)} as paid` : `Mark ${money(item.yourShare)} as sent`}
        </button>
        <Link className="btn btn-secondary" to="/android/bills">View the bill</Link>
      </div>
      <hr className="divider" />
      <dl style={{ margin: 0 }}>
        <div className="kv"><dt>Pay to</dt><dd>{payee}</dd></div>
        {ref && <div className="kv"><dt>Reference</dt><dd className="num">{ref}</dd></div>}
      </dl>
      {ref && (
        <CopyButton className="btn btn-secondary" text={ref} toastMsg={`Reference ${ref} copied`}>
          <Icon name="copy" size={16} />Copy the reference
        </CopyButton>
      )}
      <p className="hint">
        <Icon name="lock" size={16} />
        <span>
          {tracking
            ? 'KTL never moves money. Send it in your banking app, then record it here — the bill closes on the spot.'
            : `KTL never moves money. Send it in your banking app, then mark it here — ${payee} gets told straight away.`}
        </span>
      </p>
    </article>
  );
}

function DetailsDetail({ item }) {
  const { K, others, partnerName } = useHomeModel();
  const { toast } = useScreen();
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);
  const [amount, setAmount] = useState(String(item.total));
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [error, setError] = useState('');
  const othersDone = others.filter((m) => item.details?.[m.id]?.done).length;
  const audience = others.length > 1 ? 'Your household' : partnerName;

  // Same as the phone sheet: the new amount has its own field, so it
  // re-splits the bill instead of being filed away as details text.
  async function submit() {
    const next = parseBillAmount(amount);
    setAmountInvalid(next === null);
    if (next === null) return;
    const changed = round2(next) !== round2(item.total);
    setError('');
    try {
      if (changed) await K.recordBillAmount(item.id, next);
      await K.setFlag(item.id, 'detailsYou', true, value.trim() || undefined);
    } catch (err) {
      setError(err.message || 'Couldn’t save that. Check your connection and try again.');
      return;
    }
    toast(changed ? `${item.name} updated to ${money(next)}. ${audience} can see it now.` : `Details shared. ${audience} can see them now.`);
  }

  return (
    <article className="card card-lg stack">
      <DetailHead
        item={item}
        sub={othersDone === others.length && others.length > 0 ? 'Everyone else has added theirs. Yours is still missing.' : 'Waiting on everyone, including you.'}
      />
      <BrandPlate item={item} />
      <div className={'field' + (amountInvalid ? ' invalid' : '')}>
        <label htmlFor="tablet-details-amount">What it came to this time (£)</label>
        <input className="input num-input" id="tablet-details-amount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="field-help">Change it if this month’s bill is different. Everyone’s share follows.</span>
        <span className="field-error">Enter what the bill came to, like 82.40.</span>
      </div>
      <div className="field">
        <label htmlFor="tablet-details-value">{item.detailsLabel || 'Anything else to share? (optional)'}</label>
        <input className="input" id="tablet-details-value" type="text" value={value} onChange={(e) => setValue(e.target.value)} />
        {item.due && <span className="field-help">Due before the bill lands on {item.due}.</span>}
      </div>
      <label className="confirm-row" htmlFor="tablet-details-confirm">
        <input type="checkbox" id="tablet-details-confirm" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I confirm I’ve shared this with {others.length > 1 ? 'my household' : partnerName}.</span>
      </label>
      {error && <p className="hint"><Icon name="alert" size={16} />{error}</p>}
      <button className="btn btn-primary" disabled={!checked} onClick={submit}>Confirm details shared</button>
    </article>
  );
}

function ConfirmDetail({ item }) {
  const { others, partnerName } = useHomeModel();
  const { open } = useScreen();
  return (
    <article className="card card-lg stack">
      <DetailHead
        item={item}
        sub={others.length === 1 ? `${partnerName} marked ${money(item.theirShare)} as sent` : `${money(item.theirShare)} marked as sent`}
      />
      <p className="body-sm">{others.length === 1 ? `${partnerName}’s` : 'They’re'} waiting on your confirmation that it landed.</p>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <button className="btn btn-primary" onClick={() => open('dialog-confirm')}>Confirm received</button>
      </div>
    </article>
  );
}

function BalanceDetail() {
  const { K, others, partnerName, tracking } = useHomeModel();
  const b = K.balance();
  const perPerson = K.balances ? K.balances() : {};
  const net = Math.abs(b.net);
  const flight = b.inFlightToYou + b.inFlightFromYou;
  const owedTotal = b.youOwe + b.theyOwe;
  const pct = owedTotal > 0 ? Math.round((b.youOwe / owedTotal) * 100) : 50;
  const single = others.length === 1;

  return (
    <article className="card card-lg stack">
      <p className="eyebrow">{single ? `Between you and ${partnerName}` : 'Your household balance'}</p>
      <div className="row" style={{ alignItems: 'baseline', gap: 'var(--space-3)' }}>
        <span className="amount-xl num">{money(net)}</span>
        <span className="body-sm">
          {net === 0 ? 'you’re square' : single ? (b.net > 0 ? `you owe ${partnerName}` : `${partnerName} owes you`) : (b.net > 0 ? 'you owe overall' : 'owed to you overall')}
        </span>
      </div>
      {single ? (
        <>
          <div className="balance-bar" role="img" aria-label="Split of what each of you owes">
            <span className="you-side" style={{ width: pct + '%' }} />
            <span className="them-side" style={{ width: (100 - pct) + '%' }} />
          </div>
          <div className="stack-sm">
            <div className="row-between"><span className="legend"><i className="you-side" />You owe {partnerName}</span><span className="amount num owed">{money(b.youOwe)}</span></div>
            <div className="row-between"><span className="legend"><i className="them-side" />{partnerName} owes you</span><span className="amount num owing">{money(b.theyOwe)}</span></div>
          </div>
        </>
      ) : (
        <BalanceList people={others} balances={perPerson} />
      )}
      <hr className="divider" />
      <p className="item-sub">
        {flight > 0
          ? `${money(flight)} in flight, not yet confirmed`
          : tracking ? `${money(b.youOwe)} owed across bills and lending` : 'Everything sent has been confirmed'}
      </p>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Link className="btn btn-primary" to="/android/settle">Settle up</Link>
        {b.youOwe > 0 && single && (
          <Link className="btn btn-secondary" to="/android/settle?scope=full">I’ve paid the whole lot</Link>
        )}
      </div>
    </article>
  );
}

function BillDetail({ item }) {
  const { others, partnerName, personName } = useHomeModel();
  const isLending = item._table === 'lending';
  const payer = item.payer === 'you' ? 'You' : (personName(item.payerId) || partnerName);
  const debtor = item.payer === 'you' ? (others.length === 1 ? partnerName : 'Everyone else') : 'You';
  const share = item.payer === 'you' ? item.theirShare : item.yourShare;

  return (
    <article className="card card-lg stack">
      <DetailHead
        item={item}
        sub={[item.provider, isLending ? `Lent on ${item.date}` : item.frequency].filter(Boolean).join(' · ')}
      />
      <BrandPlate item={item} />
      <dl style={{ margin: 0 }}>
        <div className="kv"><dt>Full amount</dt><dd className="num">{money(item.total)}</dd></div>
        <div className="kv"><dt>Paid to the provider by</dt><dd>{payer}</dd></div>
        <div className="kv"><dt>{debtor} {debtor === 'You' || debtor === 'Everyone else' ? 'send' : 'sends'}</dt><dd className="num">{money(share)}</dd></div>
        {!isLending && item.due && <div className="kv"><dt>Due</dt><dd>{item.due}</dd></div>}
      </dl>
      {item.note && <p className="hint"><Icon name="alert" size={16} /><span>{item.note}</span></p>}
      <Link className="btn btn-secondary" to="/android/bills">Open in Bills</Link>
    </article>
  );
}
