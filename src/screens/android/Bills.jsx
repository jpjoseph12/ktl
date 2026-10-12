import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import Sheet from '../../components/Sheet';
import Icon from '../../components/Icon';
import Pill from '../../components/Pill';
import SuggestInput from '../../components/SuggestInput';
import AddChooser, { ADD_CHOOSER_ID } from '../../components/AddChooser';
import PullToRefresh from '../../components/PullToRefresh';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { COMMON_SUBSCRIPTIONS, FREQUENCIES, equalShares, formatDue, frequencyKey, money, round2 } from '../../lib/kettle';
import { useDismissibleNotice } from '../../lib/dismissible';
import { parseBillAmount } from '../../lib/validation';
import { useWalkthrough } from '../../context/WalkthroughContext';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import useIsTablet from '../../lib/useIsTablet';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs-you', label: 'Needs you' },
  { key: 'you-pay', label: 'You pay' },
  { key: 'others-pay', label: 'Others pay' },
  { key: 'one-off', label: 'One-offs' },
  { key: 'ended', label: 'Ended' }
];

function tagsFor(item, isLending) {
  const tags = [item.payer === 'you' ? 'you-pay' : 'others-pay'];
  if (isLending) tags.push('one-off');
  if (item.endedOn) tags.push('ended');
  const s = item.status;
  if (s === 'payment-due' || s === 'awaiting-details' || s === 'sent') tags.push('needs-you');
  return tags;
}

/* Even percentage split across N members, to the nearest 0.1% — mirrors
   equalShares()'s exact-sum rounding but at percent granularity, so the
   "Custom %" starting point always reads as a clean equal split. */
function equalPercentStrings(members) {
  const n = members.length;
  if (n === 0) return {};
  const base = Math.floor((100 / n) * 10) / 10;
  const out = {};
  members.forEach((m) => { out[m.id] = base; });
  let remainder = Math.round((100 - base * n) * 10) / 10;
  let i = 0;
  while (remainder > 0 && i < n) {
    out[members[i].id] = Math.round((out[members[i].id] + 0.1) * 10) / 10;
    remainder = Math.round((remainder - 0.1) * 10) / 10;
    i++;
  }
  const strs = {};
  members.forEach((m) => { strs[m.id] = String(out[m.id]); });
  return strs;
}

function CycleStep({ state, label, note }) {
  return (
    <div className={'cycle-step' + (state ? ' ' + state : '')}>
      <span className="cycle-rail">
        <span className="cycle-dot">
          {state === 'done' && <Icon name="check" size={12} />}
          {state === 'active' && <Icon name="clock" size={12} />}
        </span>
        <span className="cycle-line" />
      </span>
      <span className="cycle-body">
        <span className="cycle-label">{label}</span>
        <span className="cycle-note">{note}</span>
      </span>
    </div>
  );
}

export default function AndroidBills() {
  const isTablet = useIsTablet();
  if (isTablet) {
    return (
      <TabletShell platform="android" active="bills">
        <BillsBody tablet />
      </TabletShell>
    );
  }
  return (
    <PhoneShell platform="android">
      <BillsBody />
    </PhoneShell>
  );
}

/* One body for both layouts: on a tablet the bill detail lives in the
   right-hand pane instead of a sheet, but every add/edit/record form is
   the same sheet, floated centre by tablet.css. */
function BillsBody({ tablet = false }) {
  const K = useKettle();
  const W = useWalkthrough();
  const members = K.members || [];
  const others = K.others || (K.partner ? [K.partner] : []);
  function nameOf(id) {
    if (!id) return 'them';
    if (K.you && id === K.you.id) return 'You';
    return K.data.people?.[id]?.name || 'them';
  }
  function possessive(id) {
    if (!id) return 'their';
    if (K.you && id === K.you.id) return 'your';
    return `${K.data.people?.[id]?.name || 'their'}’s`;
  }
  const { open, close, toast } = useScreen();
  const [filter, setFilter] = useState('all');
  const [showAllRecurring, setShowAllRecurring] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editingBillId, setEditingBillId] = useState(null);
  const [editingEndedOn, setEditingEndedOn] = useState(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [frequency, setFrequency] = useState('month:1');
  const [payerId, setPayerId] = useState(K.you?.id || '');
  const [needsDetails, setNeedsDetails] = useState(false);
  const [splitMode, setSplitMode] = useState('equal');
  const [splitAllWho, setSplitAllWho] = useState(K.you?.id || '');
  const [splitCustomPercents, setSplitCustomPercents] = useState({});
  const [nameInvalid, setNameInvalid] = useState(false);
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [splitInvalid, setSplitInvalid] = useState(false);
  const [addError, setAddError] = useState('');

  /* ── record part of a share, rather than all or nothing ──────────── */
  const [partPayItem, setPartPayItem] = useState(null);
  const [partPayAmount, setPartPayAmount] = useState('');
  const [partPayInvalid, setPartPayInvalid] = useState(false);
  const [partPayBusy, setPartPayBusy] = useState(false);
  const [partPayError, setPartPayError] = useState('');

  function openPartPay(b) {
    setPartPayItem(b);
    setPartPayAmount('');
    setPartPayInvalid(false);
    setPartPayError('');
    open('sheet-partpay');
  }

  async function submitPartPay() {
    if (!partPayItem || !K.you) return;
    const owed = partPayItem.outstanding?.[K.you.id] ?? partPayItem.yourShare;
    const value = parseFloat(partPayAmount);
    const ok = /^\d+(\.\d{1,2})?$/.test(partPayAmount.trim()) && value > 0 && value <= owed + 0.001;
    setPartPayInvalid(!ok);
    if (!ok) return;
    setPartPayBusy(true);
    try {
      const res = await K.recordPayment(partPayItem.id, K.you.id, value);
      close();
      toast(res?.closed
        ? `${money(value)} recorded — that clears ${partPayItem.name}.`
        : `${money(value)} recorded. ${money(round2(owed - value))} still to go.`);
      setPartPayItem(null);
    } catch (err) {
      setPartPayError(err.message || 'Could not record that.');
    } finally {
      setPartPayBusy(false);
    }
  }

  /* ── what a variable bill actually came to this time ─────────────── */
  const [amountItem, setAmountItem] = useState(null);
  const [actualAmount, setActualAmount] = useState('');
  const [actualInvalid, setActualInvalid] = useState(false);
  const [actualBusy, setActualBusy] = useState(false);
  const [actualError, setActualError] = useState('');

  function openActualAmount(b) {
    setAmountItem(b);
    setActualAmount(String(b.total));
    setActualInvalid(false);
    setActualError('');
    open('sheet-actual');
  }

  async function submitActualAmount() {
    if (!amountItem) return;
    const amount = parseBillAmount(actualAmount);
    setActualInvalid(amount === null);
    if (amount === null) return;
    setActualBusy(true);
    try {
      await K.recordBillAmount(amountItem.id, amount);
      close();
      toast(`${amountItem.name} recorded at ${money(amount)}.`);
      setAmountItem(null);
    } catch (err) {
      setActualError(err.message || 'Could not record that.');
    } finally {
      setActualBusy(false);
    }
  }

  /* ── add/edit money lent (one-off, between a payer and one borrower) ── */
  const [editingLendingId, setEditingLendingId] = useState(null);
  const [lName, setLName] = useState('');
  const [lAmount, setLAmount] = useState('');
  const [lPayerId, setLPayerId] = useState(K.you?.id || '');
  const [lBorrowerId, setLBorrowerId] = useState('');
  const [lSplit, setLSplit] = useState('full');
  const [lNote, setLNote] = useState('');
  const [lNameInvalid, setLNameInvalid] = useState(false);
  const [lAmountInvalid, setLAmountInvalid] = useState(false);
  const [lBorrowerInvalid, setLBorrowerInvalid] = useState(false);
  const [lBusy, setLBusy] = useState(false);
  const [lError, setLError] = useState('');

  const c = K.cycleTotals();
  const count = K.data.bills.length + K.data.lending.length;

  /* Ended bills are kept for their history, not for the running list, so
     they only surface under the Ended filter — otherwise a cancelled
     subscription would clutter "Every month" forever. */
  function visible(item, isLending) {
    if (filter === 'ended') return !!item.endedOn;
    if (item.endedOn) return false;
    return filter === 'all' || tagsFor(item, isLending).includes(filter);
  }
  const RECURRING_PREVIEW_COUNT = 6;
  const byDueSoonest = (a, b2) => (a.dueSort && b2.dueSort ? new Date(a.dueSort) - new Date(b2.dueSort) : 0);
  const visibleRecurring = K.data.bills.filter((b) => visible(b, false)).sort(byDueSoonest);
  const visibleLending = K.data.lending.filter((b) => visible(b, true));
  const nothingVisible = visibleRecurring.length === 0 && visibleLending.length === 0;
  const shownRecurring = showAllRecurring || tablet ? visibleRecurring : visibleRecurring.slice(0, RECURRING_PREVIEW_COUNT);
  const hiddenRecurringCount = visibleRecurring.length - shownRecurring.length;
  const streamingBills = K.data.bills.filter((b) => b.glyph === 'music' || b.glyph === 'play');
  const streamingSignature = streamingBills.map((b) => b.id).sort().join(',');
  const { dismissed: streamingDismissed, dismiss: dismissStreaming } = useDismissibleNotice('bills-streaming-overlap', streamingSignature);

  function row(item, isLending) {
    const share = item.payer === 'you' ? item.theirShare : item.yourShare;
    const who = item.payer === 'you'
      ? `${others.length > 1 ? 'Others' : nameOf(others[0]?.id)} owe${others.length > 1 ? '' : 's'} you`
      : `You owe ${nameOf(item.payerId)}`;
    return (
      <button
        key={item.id}
        className={tablet ? 'item list tablet-row' : 'item'}
        aria-current={tablet ? String(item.id === detailItem?.id) : undefined}
        onClick={() => { setSelectedId(item.id); if (!tablet) open('sheet-bill'); }}
      >
        <span className="glyph"><Icon name={item.glyph} size={20} /></span>
        <span className="grow">
          <span className="item-title" style={{ display: 'block' }}>{item.name}</span>
          <span className="item-sub">
            {item.endedOn
              ? `Ended ${formatDue(item.endedOn)} · ${who} ${money(share)}`
              : `${isLending ? item.date : item.due} · ${who} ${money(share)}`}
          </span>
        </span>
        <span className="item-end">
          <span className="amount num">{money(item.total)}</span>
          {item.endedOn ? <span className="pill is-sent">Ended</span> : <Pill item={item} />}
        </span>
      </button>
    );
  }

  const selected = selectedId ? K.find(selectedId) : null;
  /* The tablet pane always matches the list beside it: until a row is
     picked — or once the picked one is removed or filtered out — it shows
     the first bill the current filter leaves visible. */
  const lendingShown = filter === 'all' || filter === 'one-off' ? visibleLending : [];
  const listed = [...visibleRecurring, ...lendingShown];
  const detailItem = tablet
    ? (listed.find((i) => i.id === selected?.id) || listed[0] || null)
    : selected;

  function billDetail(b) {
    const s = b.status;
    const isLending = !b.due;
    const payerName = nameOf(b.payerId);
    const debtorLabel = b.payer === 'you' ? (others.length > 1 ? 'Others' : nameOf(others[0]?.id)) : 'You';
    const debtorVerb = debtorLabel === 'You' || debtorLabel === 'Others' ? 'send' : 'sends';
    const share = b.payer === 'you' ? b.theirShare : b.yourShare;
    const doneCount = members.filter((m) => b.details[m.id]?.done).length;

    return (
      <>
        {b.logo && (
          <span className="brand-plate">
            <img
              className={'brand-mark' + (b.logoW / b.logoH < 1.6 ? ' tall' : '')}
              src={'/assets/logos/' + b.logo} width={b.logoW} height={b.logoH} alt={b.provider}
            />
          </span>
        )}
        <dl style={{ margin: 0 }}>
          <div className="kv"><dt>Full amount</dt><dd className="num">{money(b.total)}</dd></div>
          {others.length > 0 && (
            <div className="kv">
              <dt>Split</dt>
              <dd>
                {(isLending ? members.filter((m) => m.id === b.payerId || (b.shares[m.id] || 0) > 0) : members)
                  .map((m) => `${b.total > 0 ? Math.round(((b.shares[m.id] || 0) / b.total) * 100) : 0}% ${m.id === K.you?.id ? 'you' : m.name}`)
                  .join(' · ')}
              </dd>
            </div>
          )}
          <div className="kv"><dt>Paid to the provider by</dt><dd>{payerName}</dd></div>
          <div className="kv"><dt>{debtorLabel} {debtorVerb}</dt><dd className="num">{money(share)}</dd></div>
          {(b.paid?.[K.you?.id] || 0) > 0 && (
            <div className="kv">
              <dt>You’ve paid so far</dt>
              <dd className="num">{money(b.paid[K.you.id])} of {money(b.yourShare)}</dd>
            </div>
          )}
          {!isLending && <div className="kv"><dt>Due</dt><dd>{b.due}</dd></div>}
          {b.endedOn && <div className="kv"><dt>Ended</dt><dd>{formatDue(b.endedOn)}</dd></div>}
          {b.amountHistory?.length > 1 && (
            <div className="kv">
              <dt>Last time</dt>
              <dd className="num">{money(b.amountHistory[1].amount)}</dd>
            </div>
          )}
          <div className="kv"><dt>Status</dt><dd>{K.labelOf(b)}</dd></div>
        </dl>
        <div className="stack-sm">
          <p className="eyebrow">How this one closes</p>
          <div className="cycle">
            {b.needsDetails && (
              <CycleStep
                state={doneCount === members.length && members.length > 0 ? 'done' : s === 'awaiting-details' ? 'active' : ''}
                label={'Everyone adds ' + (b.detailsLabel || 'details').toLowerCase()}
                note={members.map((m) => `${m.id === K.you?.id ? 'You' : m.name}: ${b.details[m.id]?.done ? 'in' : 'outstanding'}`).join(' · ')}
              />
            )}
            <CycleStep
              state={s === 'sent' || s === 'settled' ? 'done' : s === 'payment-due' ? 'active' : ''}
              label={debtorLabel + ' ' + debtorVerb + ' ' + money(share)}
              note={'Reminder ' + K.data.reminders.paymentLead + ' days before, at ' + K.data.reminders.paymentTime}
            />
            <CycleStep
              state={s === 'settled' ? 'done' : s === 'sent' ? 'active' : ''}
              label={payerName + ' confirm' + (payerName === 'You' ? '' : 's') + ' it landed'}
              note={s === 'settled' ? (b.settledNote || 'Closed') : (b.sentNote || 'Nudge after ' + K.data.reminders.nudgeAfter + ' hours')}
            />
          </div>
        </div>
        {b.note && <p className="hint"><Icon name="alert" size={16} />{b.note}</p>}
      </>
    );
  }

  /* `inline` lays the same actions out as a row inside the tablet detail
     card: no full-width buttons and no Close, since there's no sheet. */
  function billFoot(b, { inline = false } = {}) {
    const s = b.status;
    const isLending = !b.due;
    const share = b.payer === 'you' ? b.theirShare : b.yourShare;
    const payerName = nameOf(b.payerId);
    const reminderTarget = b.payer === 'you' ? (others.length > 1 ? 'everyone' : nameOf(others[0]?.id)) : payerName;
    const blk = inline ? '' : ' btn-block';
    let action = null;
    if (s === 'payment-due' && b.payer === 'partner') {
      action = (
        <>
          <button className={'btn btn-primary' + blk} onClick={async () => { await K.setStatus(b.id, 'sent'); close(); toast(`Marked as sent. ${payerName} has been told.`); }}>
            I’ve sent {money(b.yourOutstanding ?? share)}
          </button>
          <button className={'btn btn-secondary' + blk} onClick={() => openPartPay(b)}>
            I’ve only sent part of it
          </button>
        </>
      );
    } else if (s === 'sent' && b.payer === 'you') {
      action = (
        <button className={'btn btn-primary' + blk} onClick={async () => { await K.setStatus(b.id, 'settled'); close(); toast('Settled.'); }}>
          Confirm {money(share)} arrived
        </button>
      );
    } else if (s === 'awaiting-details') {
      action = <Link className={'btn btn-primary' + blk} to="/android/home">Add your {(b.detailsLabel || 'details').toLowerCase()}</Link>;
    } else {
      action = (
        <button className={'btn btn-secondary' + blk} onClick={() => { close(); toast(`Reminder sent to ${reminderTarget}.`); }}>
          Send a reminder now
        </button>
      );
    }
    return (
      <>
        {action}
        {!isLending && b.needsDetails && (
          <button className={'btn btn-secondary' + blk} onClick={() => openActualAmount(b)}>
            Set what it came to
          </button>
        )}
        {isLending ? (
          <button className={'btn btn-secondary' + blk} onClick={() => openEditLending(b)}>Edit this</button>
        ) : (
          <button className={'btn btn-secondary' + blk} onClick={() => openEditBill(b)}>Edit this bill</button>
        )}
        {!inline && <button className="btn btn-ghost btn-block" onClick={close}>Close</button>}
      </>
    );
  }

  function billSubtitle(b) {
    return [b.provider, !b.due ? `Lent on ${b.date}` : b.frequency].filter(Boolean).join(' · ');
  }

  function customTotal() {
    return round2(members.reduce((sum, m) => sum + (parseFloat(splitCustomPercents[m.id]) || 0), 0));
  }

  function resolveSplitPercents() {
    if (splitMode === 'all') {
      const percents = {};
      members.forEach((m) => { percents[m.id] = m.id === splitAllWho ? 100 : 0; });
      return percents;
    }
    if (splitMode === 'custom') {
      const percents = {};
      members.forEach((m) => { percents[m.id] = parseFloat(splitCustomPercents[m.id]) || 0; });
      return percents;
    }
    return undefined;
  }

  function resetAddForm() {
    setEditingBillId(null);
    setEditingEndedOn(null);
    setName('');
    setAmount('');
    setDay('1');
    setFrequency('month:1');
    setPayerId(K.you?.id || '');
    setNeedsDetails(false);
    setSplitMode('equal');
    setSplitAllWho(K.you?.id || '');
    setSplitCustomPercents({});
    setNameInvalid(false);
    setAmountInvalid(false);
    setSplitInvalid(false);
    setAddError('');
  }

  function openAddBill() {
    resetAddForm();
    open('sheet-add');
  }

  function openEditBill(b) {
    setEditingBillId(b.id);
    setEditingEndedOn(b.endedOn || null);
    setName(b.name);
    setAmount(String(b.total));
    setDay(String(new Date(b.dueSort).getDate()));
    setFrequency(frequencyKey(b.frequencyUnit || 'month', b.frequencyCount || 1));
    setPayerId(b.payerId);
    setNeedsDetails(!!b.needsDetails);

    const memberIds = members.map((m) => m.id);
    const eq = equalShares(b.total, memberIds);
    const isEqual = memberIds.every((id) => Math.abs((b.shares[id] || 0) - (eq[id] || 0)) < 0.02);
    const fullPayer = memberIds.find((id) => Math.abs((b.shares[id] || 0) - b.total) < 0.02 && b.total > 0);
    if (isEqual) {
      setSplitMode('equal');
      setSplitCustomPercents({});
    } else if (fullPayer && memberIds.every((id) => id === fullPayer || (b.shares[id] || 0) < 0.02)) {
      setSplitMode('all');
      setSplitAllWho(fullPayer);
    } else {
      setSplitMode('custom');
      const percents = {};
      memberIds.forEach((id) => { percents[id] = b.total > 0 ? String(Math.round(((b.shares[id] || 0) / b.total) * 1000) / 10) : '0'; });
      setSplitCustomPercents(percents);
    }
    setNameInvalid(false);
    setAmountInvalid(false);
    setSplitInvalid(false);
    setAddError('');
    open('sheet-add');
  }

  async function submitBill() {
    const okName = name.trim().length > 1;
    // A leading minus is allowed: a refund or correction is a negative
    // bill, split the same way, and credits the household instead.
    const okAmount = /^-?\d+(\.\d{1,2})?$/.test(amount.trim()) && parseFloat(amount) !== 0;
    const okSplit = splitMode !== 'custom' || (
      Math.abs(customTotal() - 100) < 0.51 &&
      members.every((m) => {
        const v = (splitCustomPercents[m.id] || '').trim();
        return /^\d{1,3}(\.\d{1,2})?$/.test(v) && parseFloat(v) >= 0 && parseFloat(v) <= 100;
      })
    );
    setNameInvalid(!okName);
    setAmountInvalid(!okAmount);
    setSplitInvalid(!okSplit);
    if (!okName || !okAmount || !okSplit) return;
    setAddError('');
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        total: parseFloat(amount),
        payerId,
        day: parseInt(day, 10) || 1,
        frequencyUnit: frequency.split(':')[0],
        frequencyCount: Number(frequency.split(':')[1]) || 1,
        needsDetails,
        splitPercents: others.length > 0 ? resolveSplitPercents() : undefined
      };
      if (editingBillId) {
        await K.updateBill(editingBillId, payload);
      } else {
        await K.addBill(payload);
      }
      const wasEditing = !!editingBillId;
      resetAddForm();
      close();
      toast(wasEditing ? 'Bill updated.' : 'Added. Reminders start next cycle.');
    } catch (err) {
      setAddError(err.message || 'Could not save that bill.');
    } finally {
      setBusy(false);
    }
  }

  async function endThisBill() {
    if (!editingBillId) return;
    const item = K.find(editingBillId);
    setBusy(true);
    try {
      await K.endBill(editingBillId);
      resetAddForm();
      close();
      toast(item ? `${item.name} ended. Its history stays.` : 'Ended.');
    } catch (err) {
      setAddError(err.message || 'Could not end that bill.');
    } finally {
      setBusy(false);
    }
  }

  async function restartThisBill() {
    if (!editingBillId) return;
    const item = K.find(editingBillId);
    setBusy(true);
    try {
      await K.reopenBill(editingBillId);
      resetAddForm();
      close();
      toast(item ? `${item.name} is running again.` : 'Restarted.');
    } catch (err) {
      setAddError(err.message || 'Could not restart that bill.');
    } finally {
      setBusy(false);
    }
  }

  async function removeThisBill() {
    if (!editingBillId) return;
    const item = K.find(editingBillId);
    setBusy(true);
    try {
      await K.removeBill(editingBillId);
      resetAddForm();
      close();
      toast(item ? `Removed ${item.name}.` : 'Removed.');
    } catch (err) {
      setAddError(err.message || 'Could not remove that bill.');
    } finally {
      setBusy(false);
    }
  }

  function resetLendForm() {
    setEditingLendingId(null);
    setLName('');
    setLAmount('');
    setLPayerId(K.you?.id || '');
    setLBorrowerId(others[0]?.id || '');
    setLSplit('full');
    setLNote('');
    setLNameInvalid(false);
    setLAmountInvalid(false);
    setLBorrowerInvalid(false);
    setLError('');
  }

  function openAddLending() {
    resetLendForm();
    open('sheet-lend');
  }

  function openEditLending(b) {
    setEditingLendingId(b.id);
    setLName(b.name);
    setLAmount(String(b.total));
    setLPayerId(b.payerId);
    const borrowerEntry = Object.keys(b.shares || {}).find((uid) => uid !== b.payerId);
    setLBorrowerId(borrowerEntry || others.find((m) => m.id !== b.payerId)?.id || '');
    const payerShare = (b.shares || {})[b.payerId] || 0;
    setLSplit(payerShare > 0.01 ? 'half' : 'full');
    setLNote(b.note || '');
    setLNameInvalid(false);
    setLAmountInvalid(false);
    setLBorrowerInvalid(false);
    setLError('');
    open('sheet-lend');
  }

  function onLendingPayerChange(id) {
    setLPayerId(id);
    // The borrower can never be whoever's now paying — bump it to the
    // first other member if the current choice would collide.
    if (lBorrowerId === id) {
      setLBorrowerId(members.find((m) => m.id !== id)?.id || '');
    }
  }

  async function submitLending() {
    const okName = lName.trim().length > 1;
    const okAmount = /^\d+(\.\d{1,2})?$/.test(lAmount.trim());
    const okBorrower = !!lBorrowerId && lBorrowerId !== lPayerId;
    setLNameInvalid(!okName);
    setLAmountInvalid(!okAmount);
    setLBorrowerInvalid(!okBorrower);
    if (!okName || !okAmount || !okBorrower) return;
    setLError('');
    setLBusy(true);
    try {
      const payload = {
        name: lName.trim(),
        total: parseFloat(lAmount),
        payerId: lPayerId,
        borrowerId: lBorrowerId,
        note: lNote.trim() || undefined,
        borrowerPct: lSplit === 'half' ? 50 : 100
      };
      if (editingLendingId) {
        await K.updateLending(editingLendingId, payload);
      } else {
        await K.addLending(payload);
      }
      const wasEditing = !!editingLendingId;
      resetLendForm();
      close();
      toast(wasEditing ? 'Updated.' : `Added. ${nameOf(lBorrowerId)} owes ${nameOf(lPayerId)} for this.`);
    } catch (err) {
      setLError(err.message || 'Could not save that.');
    } finally {
      setLBusy(false);
    }
  }

  /* Arriving from the add-chooser on another screen — open the form it
     asked for, then strip the param so a back-navigation or refresh
     doesn't pop the sheet open again. */
  const [searchParams, setSearchParams] = useSearchParams();
  const addParam = searchParams.get('add');
  useEffect(() => {
    if (addParam !== 'bill' && addParam !== 'lending') return;
    if (addParam === 'bill') openAddBill();
    else openAddLending();
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam]);

  async function removeThisLending() {
    if (!editingLendingId) return;
    const item = K.find(editingLendingId);
    setLBusy(true);
    try {
      await K.removeLending(editingLendingId);
      resetLendForm();
      close();
      toast(item ? `Removed ${item.name}.` : 'Removed.');
    } catch (err) {
      setLError(err.message || 'Could not remove that.');
    } finally {
      setLBusy(false);
    }
  }

  const summaryLine = `${money(c.total)} a month · split ${K.data.household.split} · ${c.closed} closed`;
  const listClass = tablet ? 'stack-sm' : 'list';

  const listContent = (
    <>
        <div className="chipbar" role="group" aria-label="Filter bills" style={tablet ? { marginInline: 0, paddingInline: 0 } : undefined}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className="chip"
              aria-pressed={filter === f.key}
              onClick={() => { setFilter(f.key); setShowAllRecurring(false); }}
            >
              {f.key === 'all' ? `All ${count}` : f.label}
            </button>
          ))}
        </div>

        {streamingBills.length > 1 && !streamingDismissed && (
          <p className="hint">
            <Icon name="alert" size={16} />
            <span>
              Your household splits {streamingBills.length} streaming services — {streamingBills.map((b) => b.name).join(', ')}.
              Worth a look if anyone wants to trim one.
            </span>
            <button className="hint-dismiss" aria-label="Dismiss" onClick={dismissStreaming}>
              <Icon name="x" size={14} />
            </button>
          </p>
        )}

        {visibleRecurring.length > 0 && (
          <section className="stack">
            <div className="section-head"><h2>Every month</h2><span className="meta">{K.data.bills.length} bills</span></div>
            <div className={listClass}>{shownRecurring.map((b) => row(b, false))}</div>
            {hiddenRecurringCount > 0 && (
              <button className="btn btn-secondary btn-block btn-sm" onClick={() => setShowAllRecurring(true)}>
                Show {hiddenRecurringCount} more
              </button>
            )}
          </section>
        )}

        {(filter === 'all' || filter === 'one-off') && (
          <section className="stack">
            <div className="section-head"><h2>Lent between you</h2><span className="meta">Settles with the balance</span></div>
            {visibleLending.length > 0 ? (
              <div className={listClass}>{visibleLending.map((b) => row(b, true))}</div>
            ) : (
              <div className="list">
                <div className="item"><span className="grow"><span className="item-sub">Nothing lent right now.</span></span></div>
              </div>
            )}
            <button className="btn btn-secondary btn-block btn-sm" onClick={openAddLending}>
              <Icon name="plus" size={16} />Add money lent
            </button>
          </section>
        )}

        {nothingVisible && (
          <p className="hint">
            <Icon name="alert" size={16} />
            {count === 0 ? 'Nothing added yet — tap "Add a cost" to get started.' : 'Nothing matches that filter.'}
          </p>
        )}

        <p className="meta" style={{ textAlign: 'center', padding: 'var(--space-2) var(--space-4) 0' }}>
          Provider marks shown on each bill are the real brand logos, used for identification only.
        </p>
    </>
  );

  return (
    <>
      {tablet ? (
        <>
          <TabletTopbar title="Recurring costs" sub={summaryLine}>
            <button ref={W.targetRef('add-first-bill')} className="btn btn-primary btn-sm" onClick={() => open(ADD_CHOOSER_ID)}>
              <Icon name="plus" size={16} />Add a cost
            </button>
          </TabletTopbar>

          <div className="tablet-columns">
            <section className="tablet-list-pane">{listContent}</section>
            <section className="tablet-detail-pane">
              {detailItem ? (
                <article className="card card-lg stack">
                  <div className="row">
                    <span className="glyph"><Icon name={detailItem.glyph} size={22} /></span>
                    <div className="grow">
                      <div className="item-title" style={{ fontSize: 'var(--text-lg)' }}>{detailItem.name}</div>
                      <div className="item-sub">{billSubtitle(detailItem)}</div>
                    </div>
                    {detailItem.endedOn ? <span className="pill is-sent">Ended</span> : <Pill item={detailItem} />}
                  </div>
                  {billDetail(detailItem)}
                  <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    {billFoot(detailItem, { inline: true })}
                  </div>
                </article>
              ) : (
                <div className="tablet-detail-empty">
                  <Icon name="list" size={32} />
                  <h2>Select a bill</h2>
                  <p className="body-sm">Choose one on the left to see the full detail.</p>
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <header className="md-appbar">
            <Link className="md-iconbtn" to="/android/home" aria-label="Back"><Icon name="back" size={22} /></Link>
            <span className="appbar-title">Recurring costs</span>
            <Link className="md-iconbtn" to="/android/household" aria-label="Settings"><Icon name="settings" size={22} /></Link>
          </header>

          <div className="md-headline">
            <p className="meta">{summaryLine}</p>
          </div>

          <PullToRefresh className="scroll has-fab" onRefresh={K.refreshNow}>{listContent}</PullToRefresh>

          <button ref={W.targetRef('add-first-bill')} className="md-fab" onClick={() => open(ADD_CHOOSER_ID)}>
            <Icon name="plus" size={22} />Add a cost
          </button>

          <AndroidNavBar active="bills" />

          <Sheet id="sheet-bill" titleId="sheet-bill-title">
            <div className="sheet-head">
              <h2 className="sheet-title" id="sheet-bill-title">{selected ? selected.name : 'Bill'}</h2>
              <p className="item-sub" style={{ marginTop: 4 }}>{selected ? billSubtitle(selected) : ''}</p>
            </div>
            <div className="sheet-body">{selected && billDetail(selected)}</div>
            <div className="sheet-foot">{selected && billFoot(selected)}</div>
          </Sheet>
        </>
      )}

      <Sheet id="sheet-add" titleId="sheet-add-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-add-title">{editingBillId ? 'Edit this bill' : 'Add a recurring cost'}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>
            {others.length > 0 ? 'Everyone in your household gets the reminders as soon as it’s saved.' : 'Invite someone to your household to split it with them.'}
          </p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (nameInvalid ? ' invalid' : '')}>
            <label htmlFor="new-name">What is it?</label>
            <SuggestInput id="new-name" placeholder="e.g. TV licence" value={name} onChange={setName} suggestions={COMMON_SUBSCRIPTIONS} />
            <span className="field-error">Give it a name you’ll both recognise.</span>
          </div>
          <div className={'field' + (amountInvalid ? ' invalid' : '')}>
            <label htmlFor="new-amount">Amount each time (£)</label>
            <input className="input num-input" id="new-amount" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="field-help">
              {parseFloat(amount) < 0
                ? 'A credit — this is money coming back, split the same way.'
                : 'Use a minus for a refund or correction, like -60.'}
            </span>
            <span className="field-error">Enter an amount, like 14.50 — or -60 for a refund.</span>
          </div>
          <div className="field">
            <label htmlFor="payer-select">Who pays the provider?</label>
            <select className="input" id="payer-select" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.id === K.you?.id ? 'You' : m.name}</option>
              ))}
            </select>
          </div>
          {others.length > 0 && (
            <div className={'field' + (splitInvalid ? ' invalid' : '')}>
              <label>How should this one be split?</label>
              <div className="seg" role="tablist" aria-label="Split for this bill">
                <button role="tab" aria-selected={splitMode === 'equal'} onClick={() => setSplitMode('equal')}>Equal ({K.data.household.split})</button>
                <button role="tab" aria-selected={splitMode === 'all'} onClick={() => setSplitMode('all')}>One pays it all</button>
                <button
                  role="tab" aria-selected={splitMode === 'custom'}
                  onClick={() => {
                    setSplitMode('custom');
                    setSplitCustomPercents((p) => (Object.keys(p).length ? p : equalPercentStrings(members)));
                  }}
                >
                  Custom %
                </button>
              </div>
              {splitMode === 'all' && (
                <select
                  className="input" style={{ marginTop: 'var(--space-2)' }}
                  aria-label="Who covers it all" value={splitAllWho} onChange={(e) => setSplitAllWho(e.target.value)}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.id === K.you?.id ? 'You cover it' : `${m.name} covers it`}</option>
                  ))}
                </select>
              )}
              {splitMode === 'custom' && (
                <>
                  <div className="stack-sm" style={{ marginTop: 'var(--space-2)' }}>
                    {members.map((m) => (
                      <div className="row-between" key={m.id}>
                        <label htmlFor={'split-pct-' + m.id} className="body-sm">{m.id === K.you?.id ? 'You' : m.name}</label>
                        <input
                          className="input num-input" style={{ maxWidth: 90 }}
                          id={'split-pct-' + m.id} type="text" inputMode="decimal"
                          value={splitCustomPercents[m.id] ?? ''}
                          onChange={(e) => setSplitCustomPercents((p) => ({ ...p, [m.id]: e.target.value }))}
                          aria-label={`${m.id === K.you?.id ? 'Your' : m.name + '’s'} share as a percentage`}
                        />
                      </div>
                    ))}
                  </div>
                  <span className="field-help">Total: {customTotal()}% — needs to add up to 100%.</span>
                  <span className="field-error">Enter a percentage for everyone, adding up to 100.</span>
                </>
              )}
              {splitMode !== 'equal' && (
                <p className="hint" style={{ marginTop: 'var(--space-2)' }}>
                  <Icon name="alert" size={16} />
                  <span>Visible to everyone in your shared activity — this only changes this one bill.</span>
                </p>
              )}
            </div>
          )}
          <div className="field">
            <label htmlFor="new-frequency">How often?</label>
            <select className="input" id="new-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map((f) => (
                <option key={frequencyKey(f.unit, f.count)} value={frequencyKey(f.unit, f.count)}>{f.label}</option>
              ))}
            </select>
          </div>
          {/* A day-of-month only means anything for monthly-style rhythms;
              a weekly cleaner doesn't land "on the 3rd". */}
          {!frequency.startsWith('week') && (
            <div className="field">
              <label htmlFor="new-day">Day of the month it’s taken</label>
              <input className="input num-input" id="new-day" type="text" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
          )}
          <label className="confirm-row" htmlFor="new-details">
            <input type="checkbox" id="new-details" checked={needsDetails} onChange={(e) => setNeedsDetails(e.target.checked)} />
            <span>Ask everyone for details before this one is due — meter readings, usage, anything that changes the amount.</span>
          </label>
          {addError && <p className="hint"><Icon name="alert" size={16} />{addError}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={submitBill}>
            {busy ? 'Saving…' : editingBillId ? 'Save changes' : 'Add and start reminders'}
          </button>
          {editingBillId && (editingEndedOn ? (
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={restartThisBill}>Start it up again</button>
          ) : (
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={endThisBill}>End this bill</button>
          ))}
          {editingBillId && (
            <button className="btn btn-danger-text btn-block" disabled={busy} onClick={removeThisBill}>Remove this bill</button>
          )}
          <button className="btn btn-ghost btn-block" onClick={() => { resetAddForm(); close(); }}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-lend" titleId="sheet-lend-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-lend-title">{editingLendingId ? 'Edit this' : 'Add money lent'}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>
            A one-off amount — split it in half, or have one person owe it all back.
          </p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (lNameInvalid ? ' invalid' : '')}>
            <label htmlFor="lend-name">What was it for?</label>
            <input className="input" id="lend-name" type="text" placeholder="e.g. Takeaway" value={lName} onChange={(e) => setLName(e.target.value)} />
            <span className="field-error">Give it a name you’ll both recognise.</span>
          </div>
          <div className={'field' + (lAmountInvalid ? ' invalid' : '')}>
            <label htmlFor="lend-amount">Amount (£)</label>
            <input className="input num-input" id="lend-amount" type="text" inputMode="decimal" placeholder="0.00" value={lAmount} onChange={(e) => setLAmount(e.target.value)} />
            <span className="field-error">Enter an amount, like 18.50.</span>
          </div>
          <div className="field">
            <label htmlFor="lend-payer">Who paid?</label>
            <select className="input" id="lend-payer" value={lPayerId} onChange={(e) => onLendingPayerChange(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.id === K.you?.id ? 'You' : m.name}</option>
              ))}
            </select>
          </div>
          <div className={'field' + (lBorrowerInvalid ? ' invalid' : '')}>
            <label htmlFor="lend-borrower">Who owes it back?</label>
            <select className="input" id="lend-borrower" value={lBorrowerId} onChange={(e) => setLBorrowerId(e.target.value)}>
              {members.filter((m) => m.id !== lPayerId).map((m) => (
                <option key={m.id} value={m.id}>{m.id === K.you?.id ? 'You' : m.name}</option>
              ))}
            </select>
            <span className="field-error">Choose who owes it back.</span>
          </div>
          <div className="field">
            <label>How much do they owe?</label>
            <div className="seg" role="tablist" aria-label="Split for this one">
              <button role="tab" aria-selected={lSplit === 'full'} onClick={() => setLSplit('full')}>All of it</button>
              <button role="tab" aria-selected={lSplit === 'half'} onClick={() => setLSplit('half')}>Half each</button>
            </div>
            <span className="field-help">
              {(() => {
                const total = parseFloat(lAmount) || 0;
                const half = round2(total / 2);
                return lSplit === 'half'
                  ? `${nameOf(lBorrowerId)} owes ${money(half)}, and ${money(round2(total - half))} is ${possessive(lPayerId)} own cost.`
                  : `${nameOf(lBorrowerId)} owes the full ${money(total)} back.`;
              })()}
            </span>
          </div>
          <div className="field">
            <label htmlFor="lend-note">Note (optional)</label>
            <input className="input" id="lend-note" type="text" placeholder="e.g. Paying back on payday" value={lNote} onChange={(e) => setLNote(e.target.value)} />
          </div>
          {lError && <p className="hint"><Icon name="alert" size={16} />{lError}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={lBusy || members.length < 2} onClick={submitLending}>
            {lBusy ? 'Saving…' : editingLendingId ? 'Save changes' : 'Add'}
          </button>
          {editingLendingId && (
            <button className="btn btn-danger-text btn-block" disabled={lBusy} onClick={removeThisLending}>Remove this</button>
          )}
          {members.length < 2 && !editingLendingId && <p className="meta" style={{ textAlign: 'center' }}>Invite someone to your household first.</p>}
          <button className="btn btn-ghost btn-block" onClick={() => { resetLendForm(); close(); }}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-actual" titleId="sheet-actual-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-actual-title">What did it come to?</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>
            {amountItem ? `${amountItem.name} — currently down as ${money(amountItem.total)}.` : ''}
          </p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (actualInvalid ? ' invalid' : '')}>
            <label htmlFor="actual-amount">What it came to this time (£)</label>
            <input
              className="input num-input" id="actual-amount" type="text" inputMode="decimal"
              placeholder="0.00" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)}
            />
            <span className="field-help">Everyone’s share moves with it, keeping the same split.</span>
            <span className="field-error">Enter what the bill came to, like 82.40.</span>
          </div>
          {amountItem?.amountHistory?.length > 0 && (
            <div className="stack-sm">
              <p className="eyebrow">What it has come to before</p>
              {amountItem.amountHistory.slice(0, 6).map((a) => (
                <div className="row-between" key={a.id}>
                  <span className="body-sm">{formatDue(a.forDate)}</span>
                  <span className="amount num">{money(a.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {actualError && <p className="hint"><Icon name="alert" size={16} />{actualError}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={actualBusy} onClick={submitActualAmount}>
            {actualBusy ? 'Recording…' : 'Record it'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-partpay" titleId="sheet-partpay-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-partpay-title">Record part of it</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>
            {partPayItem
              ? `${partPayItem.name} — ${money(partPayItem.outstanding?.[K.you?.id] ?? partPayItem.yourShare)} of your share is still owed.`
              : ''}
          </p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (partPayInvalid ? ' invalid' : '')}>
            <label htmlFor="partpay-amount">How much have you sent? (£)</label>
            <input
              className="input num-input" id="partpay-amount" type="text" inputMode="decimal"
              placeholder="0.00" value={partPayAmount} onChange={(e) => setPartPayAmount(e.target.value)}
            />
            <span className="field-help">The rest stays owed, so nobody loses track of it.</span>
            <span className="field-error">
              Enter an amount up to {partPayItem ? money(partPayItem.outstanding?.[K.you?.id] ?? partPayItem.yourShare) : '£0.00'}.
            </span>
          </div>
          {partPayError && <p className="hint"><Icon name="alert" size={16} />{partPayError}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={partPayBusy} onClick={submitPartPay}>
            {partPayBusy ? 'Recording…' : 'Record it'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <AddChooser />
    </>
  );
}
