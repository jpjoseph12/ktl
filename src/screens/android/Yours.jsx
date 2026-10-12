import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import Sheet from '../../components/Sheet';
import Icon from '../../components/Icon';
import Bell from '../../components/Bell';
import SuggestInput from '../../components/SuggestInput';
import AddChooser, { ADD_CHOOSER_ID } from '../../components/AddChooser';
import { useKettle } from '../../context/KettleContext';
import { usePrivate } from '../../context/PrivateContext';
import { useScreen } from '../../context/ScreenContext';
import { COMMON_SUBSCRIPTIONS, money } from '../../lib/kettle';
import { useDismissibleNotice } from '../../lib/dismissible';
import { useWalkthrough } from '../../context/WalkthroughContext';
import PullToRefresh from '../../components/PullToRefresh';
import SpendingReview from '../../components/SpendingReview';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import useIsTablet from '../../lib/useIsTablet';

const STRATEGY_HELP = {
  snowball: 'Smallest balance first — the list gets shorter fastest, which is easier to keep going with.',
  avalanche: 'Highest rate first — costs you the least interest overall.'
};

function numberLike(v) {
  return /^\d+(\.\d{1,2})?$/.test(String(v).trim().replace(/,/g, ''));
}

/* The tablet's left-hand list. The prototype has the first four and a
   sponsored card this app doesn't carry; the emergency fund is app-only. */
const CATEGORIES = [
  { id: 'overview', icon: 'wallet', label: 'What’s left' },
  { id: 'emergency', icon: 'shield', label: 'Emergency fund' },
  { id: 'personal', icon: 'card', label: 'Your own bills' },
  { id: 'debt', icon: 'trend', label: 'Debt repayment' },
  { id: 'savings', icon: 'coins', label: 'Free up money' },
  { id: 'spending', icon: 'list', label: 'Your spending' }
];

/* Walkthrough steps point at controls that, on a tablet, only exist while
   their category is showing — so the tour switches to it first. */
const TOUR_CATEGORY = {
  'add-income': 'overview',
  'toggle-debt': 'debt',
  'add-debt': 'debt',
  'add-personal-bill': 'personal'
};

export default function AndroidYours() {
  const isTablet = useIsTablet();
  if (isTablet) {
    return (
      <TabletShell platform="android" active="yours">
        <YoursBody tablet />
      </TabletShell>
    );
  }
  return (
    <PhoneShell platform="android">
      <YoursBody />
    </PhoneShell>
  );
}

function YoursBody({ tablet = false }) {
  const K = useKettle();
  const M = usePrivate();
  const W = useWalkthrough();
  const [category, setCategory] = useState('overview');
  const tourCategory = TOUR_CATEGORY[W.step?.target];
  useEffect(() => {
    if (tablet && tourCategory) setCategory(tourCategory);
  }, [tablet, tourCategory]);
  const { open, close, toast } = useScreen();
  const partnerName = K.partner?.name || 'anyone else';

  async function refreshYours() {
    await Promise.all([K.refreshNow(), M.refreshNow()]);
  }

  const st = M.state;
  const L = M.leftover();
  const P = M.payoffPlan();
  const on = st.debtModule;
  const b = K.balance();
  const paydayDaysSince = M.daysSincePayday(st.payday);
  const paydayNudge = paydayDaysSince !== null && paydayDaysSince <= 3 && b.youOwe > 0;
  const staleDebts = on ? P.rows.filter((r) => r.needsCheckIn) : [];

  const barLeft = Math.max(0, 100 - L.pctHousehold - L.pctPersonal - (on ? L.pctDebt : 0));

  /* ── sheet: your numbers (income / payday / budget) ─────────────── */
  const [income, setIncome] = useState('');
  const [payday, setPayday] = useState('');
  const [budget, setBudget] = useState('');
  const [incomeInvalid, setIncomeInvalid] = useState(false);
  const [budgetInvalid, setBudgetInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  function openMoneySheet() {
    setIncome(st.income.toFixed(2));
    setPayday(st.payday);
    // Never open showing a budget below what the minimum payments already
    // demand — even if that's what's actually saved (e.g. a debt was added
    // or its minimum raised after the budget was last set).
    setBudget(Math.max(Number(st.budget), P.minTotal).toFixed(2));
    setIncomeInvalid(false);
    setBudgetInvalid(false);
    open('sheet-money');
  }

  async function saveMoney() {
    const okIncome = numberLike(income);
    const okBudget = numberLike(budget) && parseFloat(budget) >= P.minTotal - 0.001;
    setIncomeInvalid(!okIncome);
    setBudgetInvalid(!okBudget);
    if (!okIncome || !okBudget) return;
    setBusy(true);
    try {
      // One write, one refresh — so income/budget/payday land together and
      // the screen updates in a single step rather than flickering through
      // three intermediate states while each field saves in turn.
      await M.setMany({ income: parseFloat(income), budget: parseFloat(budget), payday: payday.trim() || '28th' });
      close();
      toast('Saved. Only on your device.');
    } finally {
      setBusy(false);
    }
  }

  // A flat, predictable "what if you paid a bit more" nudge — shown next
  // to the budget field so raising it isn't just about clearing the
  // minimum-payment floor, it's an active suggestion to pay it down faster.
  // Based on the currently-saved budget (what previewMonthsSaved actually
  // simulates against), not whatever's mid-typing in the field, so the
  // amount and the "X months sooner" figure always agree with each other.
  const budgetSuggestionExtra = 50;
  const budgetSuggestionAmount = Math.max(Number(st.budget), P.minTotal) + budgetSuggestionExtra;
  const budgetSuggestionMonths = on ? M.previewMonthsSaved(budgetSuggestionExtra) : 0;

  // Live, non-blocking sanity check on whatever's currently typed — unlike
  // the minimum-payment floor above (a hard rule), there's no fair
  // universal ceiling to enforce, so this only ever warns.
  const budgetWarning = numberLike(budget) ? M.debtBudgetWarning(budget) : null;

  /* ── sheet: personal bill (add/edit) ─────────────────────────────── */
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [personalSheetTitle, setPersonalSheetTitle] = useState('Add a bill of your own');
  const [pName, setPName] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pDay, setPDay] = useState('1');
  const [pNameInvalid, setPNameInvalid] = useState(false);
  const [pAmountInvalid, setPAmountInvalid] = useState(false);
  const [pDayInvalid, setPDayInvalid] = useState(false);

  function openPersonalSheet(id) {
    setEditingPersonalId(id || null);
    const src = id ? st.personal.find((p) => p.id === id) : null;
    setPersonalSheetTitle(src ? src.name : 'Add a bill of your own');
    setPName(src ? src.name : '');
    setPAmount(src ? Number(src.amount).toFixed(2) : '');
    setPDay(src ? String(src.day) : '1');
    setPNameInvalid(false);
    setPAmountInvalid(false);
    setPDayInvalid(false);
    open('sheet-personal');
  }

  async function savePersonal() {
    const okName = pName.trim().length > 1;
    const okAmount = numberLike(pAmount);
    const day = parseInt(pDay, 10);
    const okDay = day >= 1 && day <= 31;
    setPNameInvalid(!okName);
    setPAmountInvalid(!okAmount);
    setPDayInvalid(!okDay);
    if (!okName || !okAmount || !okDay) return;
    const glyph = M.glyphFor(pName);
    const bill = { name: pName.trim(), amount: parseFloat(pAmount), day, glyph, kind: M.kindFor(glyph) };
    setBusy(true);
    try {
      if (editingPersonalId) {
        await Promise.all(Object.keys(bill).map((k) => M.setPersonal(editingPersonalId, k, bill[k])));
      } else {
        await M.addPersonal(bill);
      }
      close();
      toast(editingPersonalId ? 'Updated. Still only on your side.' : 'Added to your own bills.');
      setEditingPersonalId(null);
    } finally {
      setBusy(false);
    }
  }

  async function deletePersonal() {
    if (!editingPersonalId) return;
    const freedUp = st.personal.find((p) => p.id === editingPersonalId)?.amount || 0;
    await M.removePersonal(editingPersonalId);
    close();
    toast('Removed. That is ' + money(freedUp) + ' a month back.');
    setEditingPersonalId(null);
  }

  const kindHint = pName.trim()
    ? 'Filed as ' + M.kindFor(M.glyphFor(pName)).toLowerCase() + '.'
    : 'We’ll pick a mark from the name.';

  /* ── sheet: debt (add/edit) ───────────────────────────────────────── */
  const [editingDebtId, setEditingDebtId] = useState(null);
  const [debtSheetTitle, setDebtSheetTitle] = useState('Add a card or loan');
  const [dName, setDName] = useState('');
  const [dBalance, setDBalance] = useState('');
  const [dMin, setDMin] = useState('');
  const [dApr, setDApr] = useState('');
  const [dPromo, setDPromo] = useState('0');
  const [dNameInvalid, setDNameInvalid] = useState(false);
  const [dBalanceInvalid, setDBalanceInvalid] = useState(false);
  const [dMinInvalid, setDMinInvalid] = useState(false);
  const [aprTouched, setAprTouched] = useState(false);
  const aprSuggestion = M.standardAprFor(dName);
  // Same rateInfo() the debt list itself draws from, so the chip under this
  // field previews exactly how the account will read once it's saved.
  const liveRate = M.rateInfo({ balance: dBalance, apr: dApr, promo: dPromo });
  const rateUntouched = dApr.trim() === '' && M.num(dPromo) <= 0;

  function openDebtSheet(id) {
    setEditingDebtId(id || null);
    const src = id ? st.debts.find((d) => d.id === id) : null;
    setDebtSheetTitle(src ? src.name : 'Add a card or loan');
    setDName(src ? src.name : '');
    setDBalance(src ? Number(src.balance).toFixed(2) : '');
    setDMin(src ? Number(src.min).toFixed(2) : '');
    setDApr(src ? String(src.apr) : '');
    setDPromo(src ? String(src.promo) : '0');
    setDNameInvalid(false);
    setDBalanceInvalid(false);
    setDMinInvalid(false);
    // Editing an existing debt already has a real APR on it — only offer
    // to auto-fill the standard-rate suggestion when adding a new one.
    setAprTouched(!!src);
    open('sheet-debt');
  }

  async function saveDebt() {
    const okName = dName.trim().length > 1;
    const okBal = numberLike(dBalance);
    const okMin = numberLike(dMin);
    setDNameInvalid(!okName);
    setDBalanceInvalid(!okBal);
    setDMinInvalid(!okMin);
    if (!okName || !okBal || !okMin) return;
    const fields = { name: dName.trim(), balance: parseFloat(dBalance), min: parseFloat(dMin), apr: M.num(dApr), promo: M.num(dPromo) };
    setBusy(true);
    try {
      if (editingDebtId) {
        await M.setDebtFields(editingDebtId, fields);
      } else {
        await M.addDebt({ ...fields, kind: 'Added by you', glyph: 'card' });
      }
      close();
      toast(editingDebtId ? 'Updated.' : 'Added. Your date has moved.');
      setEditingDebtId(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDebt(id) {
    try {
      await M.confirmDebt(id);
      toast('Thanks — checked in for another 3 months.');
    } catch (err) {
      toast(err.message || 'Could not confirm that.');
    }
  }

  async function markCleared(id, name) {
    try {
      await M.clearDebt(id);
      toast(`${name} cleared. That one's done.`);
    } catch (err) {
      toast(err.message || 'Could not mark that cleared.');
    }
  }

  async function restoreDebt(id, name) {
    try {
      await M.unclearDebt(id);
      toast(`${name} is back in your plan.`);
    } catch (err) {
      toast(err.message || 'Could not restore that.');
    }
  }

  const clearedDebts = st.debts.filter((d) => d.clearedAt);

  /* Arriving from the add-chooser on another screen — open the form it
     asked for, then strip the param so a back-navigation or refresh
     doesn't pop the sheet open again. */
  const [searchParams, setSearchParams] = useSearchParams();
  const addParam = searchParams.get('add');
  useEffect(() => {
    if (addParam !== 'personal' && addParam !== 'debt') return;
    if (addParam === 'personal') openPersonalSheet(null);
    else openDebtSheet(null);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam]);

  async function deleteDebt() {
    if (!editingDebtId) return;
    await M.removeDebt(editingDebtId);
    close();
    toast('Removed from your plan.');
    setEditingDebtId(null);
  }

  async function toggleDebtModule() {
    const next = !st.debtModule;
    await M.set('debtModule', next);
    toast(next ? 'Debt repayment back on. Still only visible to you.' : 'Debt repayment off. Your plan is hidden, not deleted.');
  }

  /* ── sheet: free-up-money opportunity (add/remove) ───────────────── */
  const [editingSavingId, setEditingSavingId] = useState(null);
  const [savingSheetTitle, setSavingSheetTitle] = useState('Add something to free up');
  const [sLabel, setSLabel] = useState('');
  const [sAmount, setSAmount] = useState('');
  const [sLabelInvalid, setSLabelInvalid] = useState(false);
  const [sAmountInvalid, setSAmountInvalid] = useState(false);

  function openSavingSheet(id) {
    setEditingSavingId(id || null);
    const src = id ? st.savings.find((s) => s.id === id) : null;
    setSavingSheetTitle(src ? src.label : 'Add something to free up');
    setSLabel(src ? src.label : '');
    setSAmount(src ? Number(src.amount).toFixed(2) : '');
    setSLabelInvalid(false);
    setSAmountInvalid(false);
    open('sheet-saving');
  }

  async function saveSaving() {
    const okLabel = sLabel.trim().length > 1;
    const okAmount = numberLike(sAmount);
    setSLabelInvalid(!okLabel);
    setSAmountInvalid(!okAmount);
    if (!okLabel || !okAmount) return;
    setBusy(true);
    try {
      await M.addSaving({ label: sLabel.trim(), amount: parseFloat(sAmount), detail: 'Your own estimate', shared: false });
      close();
      toast('Added — toggle it on to model the difference.');
    } finally {
      setBusy(false);
    }
  }

  async function removeSavingRow() {
    if (!editingSavingId) return;
    await M.removeSaving(editingSavingId);
    close();
    toast('Removed.');
    setEditingSavingId(null);
  }

  /* ── sheet: emergency fund (saved amount / target months) ─────────── */
  const [efSaved, setEfSaved] = useState('');
  const [efMonths, setEfMonths] = useState('3');
  const [efSavedInvalid, setEfSavedInvalid] = useState(false);
  const EF = M.emergencyFund();

  function openEmergencySheet() {
    setEfSaved(Number(st.emergencySaved).toFixed(2));
    setEfMonths(String(st.emergencyMonths));
    setEfSavedInvalid(false);
    open('sheet-emergency');
  }

  async function saveEmergency() {
    const okSaved = numberLike(efSaved);
    setEfSavedInvalid(!okSaved);
    if (!okSaved) return;
    setBusy(true);
    try {
      await M.set('emergencySaved', parseFloat(efSaved));
      await M.set('emergencyMonths', parseInt(efMonths, 10));
      close();
      toast('Saved. Only on your device.');
    } finally {
      setBusy(false);
    }
  }

  const owned = M.personalSorted();
  const suggestions = M.subscriptionSuggestions();
  const suggestionsSignature = suggestions.map((s) => s.source + ':' + s.label).sort().join(',');
  const { dismissed: suggestionsDismissed, dismiss: dismissSuggestions } = useDismissibleNotice('yours-subscription-overlap', suggestionsSignature);
  const { dismissed: privacyNoteDismissed, dismiss: dismissPrivacyNote } = useDismissibleNotice('yours-privacy-note', 'v1');

  async function applySuggestion(s) {
    try {
      await M.addSaving({ label: s.label, amount: s.amount, detail: s.detail, shared: s.source === 'shared', applied: true });
      toast(`Modelling ${s.label} as cut — ${s.monthsSaved} month${s.monthsSaved === 1 ? '' : 's'} sooner.`);
    } catch (err) {
      toast(err.message || 'Could not add that.');
    }
  }

  /* Your spending: a bank export, read on the device. Anything it finds can
     become a Free up money line or a bill of your own. */
  const spending = (
    <SpendingReview
      userId={K.you?.id}
      tracked={[...st.personal.map((p) => p.name), ...K.data.bills.map((b) => b.name)]}
      debtOn={on}
      previewMonthsSaved={M.previewMonthsSaved}
      onModel={async (f) => {
        await M.addSaving({ label: f.label, amount: f.monthly, detail: f.detail, applied: true });
        toast(`Modelling ${f.label} — see Free up money.`);
      }}
      onAddBill={async (r) => {
        const glyph = M.glyphFor(r.name);
        await M.addPersonal({ name: r.name, amount: r.cadence === 'monthly' ? r.typical : r.monthly, day: r.day, glyph, kind: M.kindFor(glyph) });
        toast(`${r.name} added to your own bills.`);
      }}
    />
  );

  const sections = {
    setup: (
      <>
        {(!st.income || (on && st.debts.length === 0)) && (
          <section className="card card-lg stack">
            <p className="eyebrow">Get set up</p>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>A couple of things left</h2>
            <div className="stack-sm">
              {!st.income && (
                <div className="row-between">
                  <span className="item-sub">Add your take-home pay so this screen means something.</span>
                  <button ref={W.targetRef('add-income')} className="btn btn-secondary btn-sm" onClick={openMoneySheet}>Add pay</button>
                </div>
              )}
              {on && st.debts.length === 0 && (
                <div className="row-between">
                  <span className="item-sub">Add a card or loan to see a real payoff date.</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => openDebtSheet(null)}>Add one</button>
                </div>
              )}
            </div>
          </section>
        )}
      </>
    ),
    privacy: (
      <>
        {!privacyNoteDismissed && (
          <section className="private-note">
            <div className="row">
              <Icon name="lock" size={18} />
              <p>
                Your pay, your cards and your repayment plan live on <strong>this side only</strong>. They are stored apart
                from the household and never sent to {K.partner ? `${partnerName}’s` : 'anyone else’s'} device — not the numbers, not the dates, not even whether this
                part of the app is switched on.
              </p>
              <button className="hint-dismiss" aria-label="Dismiss" onClick={dismissPrivacyNote}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <button onClick={() => open('sheet-visibility')}>What {partnerName} can see</button>
          </section>
        )}
      </>
    ),
    left: (
        <section className="card card-lg stack">
          <p className="eyebrow">{on ? 'After bills and cards' : 'After household bills'}</p>
          <div>
            <div className="amount-xl num">{money(L.left)}</div>
            <p className="body-sm" style={{ marginTop: 6 }}>left to live on each month · about {money(L.weekly)} a week</p>
          </div>

          <div className="split-bar" role="img" aria-label="How your take-home pay divides">
            <span className="seg-household" style={{ width: L.pctHousehold + '%' }} />
            <span className="seg-personal" style={{ width: L.pctPersonal + '%' }} />
            <span className="seg-debt" style={{ width: (on ? L.pctDebt : 0) + '%' }} />
            <span className="seg-left" style={{ width: barLeft + '%' }} />
          </div>
          <div className="stack-sm">
            <div className="row-between">
              <span className="legend"><i className="seg-household" />Household share</span>
              <span className="amount num">{money(L.household)}</span>
            </div>
            <div className="row-between">
              <span className="legend"><i className="seg-personal" />Your own bills</span>
              <span className="amount num">{money(L.personal)}</span>
            </div>
            {on && (
              <div className="row-between">
                <span className="legend"><i className="seg-debt" />Debt plan</span>
                <span className="amount num">{money(L.debt)}</span>
              </div>
            )}
            <div className="row-between">
              <span className="legend"><i className="seg-left" />Yours to spend</span>
              <span className="amount num">{money(L.left)}</span>
            </div>
          </div>

          <hr className="divider" />
          <button className="item" style={{ padding: 'var(--space-2) 0', minHeight: 48 }} onClick={openMoneySheet}>
            <span className="glyph on-warm"><Icon name="wallet" size={18} /></span>
            <span className="grow">
              <span className="item-title" style={{ display: 'block' }}>Take-home pay</span>
              <span className="item-sub">Paid on the {st.payday}</span>
            </span>
            <span className="item-end"><span className="amount num">{money(L.income)}</span></span>
          </button>
          <p className="hint">
            <Icon name="arrow-down" size={16} />
            Your household share is read straight off the shared bills. That is the only number that crosses between the
            two halves, and it only ever crosses inwards.
          </p>
        </section>
    ),
    emergency: (
        <section className="card card-lg stack">
          <p className="eyebrow">Emergency fund</p>
          <div className="row-between" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="amount-xl num">{money(EF.saved)}</div>
              <p className="item-sub" style={{ marginTop: 4 }}>of {money(EF.target)} · {EF.months} months' outgoings</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="amount num">{EF.progressPct}%</div>
              <p className="item-sub">saved</p>
            </div>
          </div>
          <div className="progress"><span style={{ width: EF.progressPct + '%' }} /></div>
          <p className="item-sub">
            {money(EF.monthlyOutgoings)} a month in outgoings — that's about {EF.coveredMonths.toFixed(1)} months covered so far.
          </p>
          {EF.remaining > 0 ? (
            <p className="meta">{money(EF.remaining)} left to reach your target.</p>
          ) : (
            <p className="meta">Target reached — nice work.</p>
          )}
          <hr className="divider" />
          <button className="item" style={{ padding: 'var(--space-2) 0', minHeight: 48 }} onClick={openEmergencySheet}>
            <span className="glyph on-warm"><Icon name="shield" size={18} /></span>
            <span className="grow">
              <span className="item-title" style={{ display: 'block' }}>Update your fund</span>
              <span className="item-sub">Change how much you've saved, or the target</span>
            </span>
          </button>
          <p className="hint">
            <Icon name="arrow-down" size={16} />
            The target is based on your household share plus your own bills{on ? ' and minimum debt payments' : ''} —
            the same one-way figures as above.
          </p>
        </section>
    ),
    shared: (
        <section className="stack">
          <div className="section-head"><h2>On the shared side</h2></div>
          {paydayNudge && (
            <p className="hint">
              <Icon name="bell" size={16} />
              <span>Payday’s just been — you still owe {partnerName} {money(b.youOwe)}. Worth sending before it slips.</span>
            </p>
          )}
          <Link className="item list" to="/android/settle" style={{ borderRadius: 'var(--radius-lg)' }}>
            <span className="glyph"><Icon name="scale" size={20} /></span>
            <span className="grow">
              <span className="item-title" style={{ display: 'block' }}>Due to {partnerName} right now</span>
              <span className="item-sub">{b.youOwe > 0 ? 'Bills and lending still open' : 'Nothing outstanding from you'}</span>
            </span>
            <span className="item-end"><span className="amount num">{money(b.youOwe)}</span></span>
          </Link>
          {!st.payday.trim() && (
            <p className="meta">Add your payday under Take-home pay above to get nudged around it.</p>
          )}
        </section>
    ),
    personal: (
        <section className="stack">
          <div className="section-head"><h2>Your own bills</h2><span className="meta">{money(L.personal)} a month</span></div>
          <div className="list">
            {owned.length ? (
              owned.map((p) => (
                <button className="item" key={p.id} onClick={() => openPersonalSheet(p.id)}>
                  <span className="glyph"><Icon name={p.glyph} size={20} /></span>
                  <span className="grow">
                    <span className="item-title" style={{ display: 'block' }}>{p.name}</span>
                    <span className="item-sub">{p.kind} · {M.ordinal(p.day)} of the month</span>
                  </span>
                  <span className="item-end"><span className="amount num">{money(p.amount)}</span></span>
                </button>
              ))
            ) : (
              <div className="item"><span className="grow"><span className="item-sub">Nothing yet. Add your phone, car or gym.</span></span></div>
            )}
          </div>
          <button ref={W.targetRef('add-personal-bill')} className="btn btn-secondary btn-block btn-sm" onClick={() => openPersonalSheet(null)}>
            <Icon name="plus" size={16} />Add a bill of your own
          </button>
          <p className="hint">
            <Icon name="alert" size={16} />
            Phone, car, insurance, gym — anything that leaves your account and was never part of the household split. If
            it has a balance you are paying down, it belongs under debt repayment instead.
          </p>
        </section>
    ),
    debtToggle: (
        <section className="stack">
          <div className="section-head"><h2>Debt repayment</h2></div>
          <div className="list">
            <div className="item">
              <span className="glyph on-warm"><Icon name="trend" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Track cards, loans and a payoff plan</span>
                <span className="item-sub">{on ? 'On · plan, dates and balances' : 'Off · income and household only'}</span>
              </span>
              <button ref={W.targetRef('toggle-debt')} className="switch" role="switch" aria-checked={on} aria-label="Debt repayment" onClick={toggleDebtModule} />
            </div>
          </div>
          <p className="meta">Turn it off and KTL keeps tracking your pay and the household only. Nothing here was ever shared either way.</p>
        </section>
    ),
    debtPlan: (
      <>
            <section className="card card-lg stack">
              <p className="eyebrow">Debt-free</p>
              <div className="row-between" style={{ alignItems: 'flex-end' }}>
                <div>
                  <div className="big-date">{P.freeDate}</div>
                  <p className="item-sub" style={{ marginTop: 4 }}><span className="num">{P.stalled ? '—' : P.months}</span> months from now</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="amount num">{money(P.totalOwed)}</div>
                  <p className="item-sub">owed today</p>
                </div>
              </div>
              <div className="progress"><span style={{ width: P.progressPct + '%' }} /></div>
              <p className="item-sub">{P.compareLine}</p>
              {P.warning && (
                <p className="hint"><Icon name="alert" size={16} /><span>{P.warning}</span></p>
              )}
              {!P.stalled && (
                <p className="meta"><span className="num">{money(P.interest)}</span> of interest along the way</p>
              )}
            </section>

            <section className="card stack">
              <div className="field">
                <label>Order to clear them in</label>
                <div className="seg" role="tablist" aria-label="Payoff strategy">
                  <button role="tab" aria-selected={st.strategy === 'snowball'} onClick={() => M.set('strategy', 'snowball')}>Smallest first</button>
                  <button role="tab" aria-selected={st.strategy === 'avalanche'} onClick={() => M.set('strategy', 'avalanche')}>Highest rate</button>
                </div>
                <span className="field-help">{STRATEGY_HELP[st.strategy]}</span>
              </div>
              <hr className="divider" />
              <button className="item" style={{ padding: 'var(--space-2) 0', minHeight: 48 }} onClick={openMoneySheet}>
                <span className="glyph on-warm"><Icon name="coins" size={18} /></span>
                <span className="grow">
                  <span className="item-title" style={{ display: 'block' }}>Monthly budget</span>
                  <span className="item-sub">
                    {P.freed > 0 ? money(st.budget) + ' plus ' + money(P.freed) + ' freed up' : 'Minimums are ' + money(P.minTotal)}
                  </span>
                </span>
                <span className="item-end"><span className="amount num">{money(P.working)}</span></span>
              </button>
            </section>

            <section className="stack">
              <div className="section-head"><h2>The order</h2><span className="meta">{P.rows.length} {P.rows.length === 1 ? 'account' : 'accounts'}</span></div>
              {staleDebts.length > 0 && (
                <p className="hint">
                  <Icon name="clock" size={16} />
                  <span>
                    {staleDebts.length === 1
                      ? `Worth checking ${staleDebts[0].name} against your statement — it hasn’t been confirmed in ${staleDebts[0].monthsSinceConfirmed} months.`
                      : `Worth checking ${staleDebts.length} accounts against your statements — they haven’t been confirmed in 3+ months.`}
                  </span>
                </p>
              )}
              <div className="list">
                {P.rows.length ? (
                  P.rows.map((r) => (
                    <div className="item" key={r.id}>
                      <button
                        className="grow"
                        style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
                        onClick={() => openDebtSheet(r.id)}
                      >
                        {r.rank && <span className={'rank' + (r.isFocus ? ' is-focus' : '')}>{r.rank}</span>}
                        <span className="glyph"><Icon name={r.glyph} size={20} /></span>
                        <span className="grow">
                          <span className="item-title" style={{ display: 'block' }}>{r.name}</span>
                          <span className="debt-meta">
                            <span className={'rate is-' + r.rate.band}>{r.rate.label}</span>
                            <span className="debt-min">Min {money(r.min)}</span>
                            {r.isFocus && <span className="debt-note">All spare cash goes here</span>}
                            {r.projectedCleared && <span className="debt-note">Looks paid off — mark it cleared</span>}
                          </span>
                        </span>
                        <span className="item-end">
                          <span className="amount num">{money(r.balance)}</span>
                          <span className="meta debt-cost">
                            {r.rate.monthly > 0 && <span className="sr-only">Interest </span>}
                            {r.rate.cost}
                          </span>
                          <span className="meta">clear {r.dateShort}</span>
                        </span>
                      </button>
                      {r.projectedCleared ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          aria-label={`Mark ${r.name} as cleared`}
                          onClick={() => markCleared(r.id, r.name)}
                        >
                          <Icon name="check" size={16} />Cleared
                        </button>
                      ) : r.needsCheckIn && (
                        <button
                          className="btn btn-secondary btn-sm"
                          aria-label={`Confirm ${r.name}’s balance is still correct`}
                          onClick={() => confirmDebt(r.id)}
                        >
                          <Icon name="check" size={16} />Still correct
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="item"><span className="grow"><span className="item-sub">Nothing owed. Add a card or loan to build a plan.</span></span></div>
                )}
              </div>
              <button ref={W.targetRef('add-debt')} className="btn btn-secondary btn-block btn-sm" onClick={() => openDebtSheet(null)}>
                <Icon name="plus" size={16} />Add a card or loan
              </button>
            </section>

            {clearedDebts.length > 0 && (
              <section className="stack">
                <div className="section-head">
                  <h2>Cleared</h2>
                  <span className="meta">{clearedDebts.length} paid off</span>
                </div>
                <div className="list">
                  {clearedDebts.map((d) => (
                    <div className="item" key={d.id}>
                      <span className="glyph on-warm"><Icon name="check" size={18} /></span>
                      <span className="grow">
                        <span className="item-title" style={{ display: 'block' }}>{d.name}</span>
                        <span className="item-sub">Paid off {new Date(d.clearedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => restoreDebt(d.id, d.name)}>Undo</button>
                    </div>
                  ))}
                </div>
                <p className="meta">Kept as a record. Nothing here counts toward your plan or your minimums.</p>
              </section>
            )}
      </>
    ),
    savings: (
      <>
            {suggestions.length > 0 && (
              <section className="stack">
                <div className="section-head"><h2>Suggested for you</h2><span className="meta">{suggestions.length} spotted</span></div>
                <div className="list">
                  {suggestions.map((s) => (
                    <div className="item" key={s.source + ':' + s.label}>
                      <span className="glyph"><Icon name={M.glyphFor(s.label)} size={18} /></span>
                      <span className="grow">
                        <span className="item-title" style={{ display: 'block' }}>{s.label}</span>
                        <span className="item-sub">{s.detail} · {money(s.amount)}/mo</span>
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => applySuggestion(s)}>
                        {s.monthsSaved} mo sooner
                      </button>
                    </div>
                  ))}
                </div>
                {!suggestionsDismissed && (
                  <p className="hint">
                    <Icon name="alert" size={16} />
                    <span>
                      {suggestions.length > 1 ? 'You’re paying for more than one streaming subscription' : 'This one looks like a streaming subscription'} —
                      modelling it as cut shows how much sooner you’d be debt-free. Nothing gets cancelled automatically.
                    </span>
                    <button className="hint-dismiss" aria-label="Dismiss" onClick={dismissSuggestions}>
                      <Icon name="x" size={14} />
                    </button>
                  </p>
                )}
              </section>
            )}

            <section className="stack">
              <div className="section-head"><h2>Free up money</h2><span className="meta">{P.freed > 0 ? money(P.freed) + ' applied' : 'None applied'}</span></div>
              <div className="list">
                {st.savings.length ? st.savings.map((s) => (
                  <div className="item" key={s.id}>
                    <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0 }} onClick={() => openSavingSheet(s.id)}>
                      <span className="item-title" style={{ display: 'block' }}>{s.label}</span>
                      <span className="item-sub">{s.detail}</span>
                    </button>
                    <span className="amount num" style={{ marginRight: 'var(--space-2)' }}>{money(s.amount)}</span>
                    <button className="switch" role="switch" aria-checked={s.applied} aria-label={s.label} onClick={() => M.toggleSaving(s.id)} />
                  </div>
                )) : (
                  <div className="item"><span className="grow"><span className="item-sub">Nothing modelled yet.</span></span></div>
                )}
              </div>
              <button className="btn btn-secondary btn-block btn-sm" onClick={() => openSavingSheet(null)}>
                <Icon name="plus" size={16} />Add something to free up
              </button>
              <p className="hint">
                <Icon name="alert" size={16} />
                Toggling something here only models what it would do to your date. Actually cancelling a shared bill is a
                conversation with {partnerName} — KTL will not touch the household from this side.
              </p>
            </section>
      </>
    ),
    debtOff: (
          <section className="card stack">
            <div className="row">
              <span className="glyph on-warm"><Icon name="lock" size={20} /></span>
              <div className="grow">
                <div className="item-title">Debt repayment is off</div>
                <div className="item-sub">Your cards, balances and plan are hidden, not deleted.</div>
              </div>
            </div>
            <p className="body-sm">
              KTL is tracking your take-home pay and your share of the household, and telling you what is left after
              bills. Switch it back on above and the plan returns exactly as you left it.
            </p>
          </section>
    ),
    footer: (
        <p className="meta" style={{ textAlign: 'center', padding: '0 var(--space-4)' }}>
          Stored under your account, separate from the household.
        </p>
    )
  };

  const sheets = (
    <>
      <Sheet id="sheet-visibility" titleId="sheet-vis-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-vis-title">What {partnerName} can see</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>The complete list, both ways round.</p>
        </div>
        <div className="sheet-body">
          <div className="stack-sm">
            <p className="eyebrow">Shared with {partnerName}</p>
            <ul className="vis-list can-see">
              {M.visibility.shared.map((t, i) => (
                <li key={i}><Icon name="eye" size={16} /><span>{t}</span></li>
              ))}
            </ul>
          </div>
          <div className="stack-sm">
            <p className="eyebrow">Never leaves this device</p>
            <ul className="vis-list never">
              {M.visibility.never.map((t, i) => (
                <li key={i}><Icon name="lock" size={16} /><span>{t}</span></li>
              ))}
            </ul>
          </div>
          <p className="hint">
            <Icon name="lock" size={16} />
            The two halves are stored separately, under different access rules. The household side can read nothing from
            here, which is why the debt switch lives on this screen and not in the shared settings.
          </p>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-secondary btn-block" onClick={close}>Got it</button>
        </div>
      </Sheet>

      <Sheet id="sheet-money" titleId="sheet-money-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-money-title">Your numbers</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Only you ever see these.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (incomeInvalid ? ' invalid' : '')}>
            <label htmlFor="in-income">Take-home pay each month (£)</label>
            <input className="input num-input" id="in-income" type="text" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} />
            <span className="field-error">Enter what actually lands in your account, like 2640.</span>
          </div>
          <div className="field">
            <label htmlFor="in-payday">Payday</label>
            <select className="input" id="in-payday" value={payday} onChange={(e) => setPayday(e.target.value)}>
              <option value="">Not set</option>
              {Array.from({ length: 31 }, (_, i) => M.ordinal(i + 1)).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <hr className="divider" />
          <div className={'field' + (budgetInvalid ? ' invalid' : '')}>
            <label htmlFor="in-budget">Towards debt each month (£)</label>
            <input className="input num-input" id="in-budget" type="text" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <span className="field-help">Your minimums add up to {money(P.minTotal)} a month — this can’t go below that.</span>
            <span className="field-error">
              {numberLike(budget) ? `Enter at least ${money(P.minTotal)} to cover your minimum payments.` : 'Enter an amount, like 520.'}
            </span>
          </div>
          {budgetWarning && (
            <p className="hint"><Icon name="alert" size={16} /><span>{budgetWarning}</span></p>
          )}
          {on && budgetSuggestionMonths > 0 && (
            <div className="item" style={{ padding: 0 }}>
              <span className="glyph on-warm"><Icon name="trend" size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>Try {money(budgetSuggestionAmount)} instead</span>
                <span className="item-sub">£{budgetSuggestionExtra} more a month, for {budgetSuggestionMonths} {budgetSuggestionMonths === 1 ? 'month' : 'months'} sooner debt-free</span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setBudget(budgetSuggestionAmount.toFixed(2))}>Use this</button>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={saveMoney}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-emergency" titleId="sheet-emergency-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-emergency-title">Emergency fund</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Only you ever see this.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (efSavedInvalid ? ' invalid' : '')}>
            <label htmlFor="ef-saved">How much have you saved so far (£)</label>
            <input className="input num-input" id="ef-saved" type="text" inputMode="decimal" value={efSaved} onChange={(e) => setEfSaved(e.target.value)} />
            <span className="field-error">Enter an amount, like 1500.</span>
          </div>
          <div className="field">
            <label>Target — months of outgoings</label>
            <div className="seg" role="tablist" aria-label="Emergency fund target">
              {[3, 6, 12].map((m) => (
                <button key={m} role="tab" aria-selected={Number(efMonths) === m} onClick={() => setEfMonths(String(m))}>{m} months</button>
              ))}
            </div>
            <span className="field-help">{money(EF.monthlyOutgoings)} a month × {efMonths} = {money(EF.monthlyOutgoings * Number(efMonths))}.</span>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={saveEmergency}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-personal" titleId="sheet-personal-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-personal-title">{personalSheetTitle}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Yours alone — it never appears in the household.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (pNameInvalid ? ' invalid' : '')}>
            <label htmlFor="p-name">What is it?</label>
            <SuggestInput id="p-name" placeholder="e.g. EE mobile" value={pName} onChange={setPName} suggestions={COMMON_SUBSCRIPTIONS} />
            <span className="field-help">{kindHint}</span>
            <span className="field-error">Give it a name you will recognise.</span>
          </div>
          <div className={'field' + (pAmountInvalid ? ' invalid' : '')}>
            <label htmlFor="p-amount">Amount each month (£)</label>
            <input className="input num-input" id="p-amount" type="text" inputMode="decimal" placeholder="0.00" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
            <span className="field-error">Enter an amount, like 28.00.</span>
          </div>
          <div className={'field' + (pDayInvalid ? ' invalid' : '')}>
            <label htmlFor="p-day">Day of the month it goes out</label>
            <select className="input" id="p-day" value={pDay} onChange={(e) => setPDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{M.ordinal(d)}</option>
              ))}
            </select>
            <span className="field-error">Pick a day between 1 and 31.</span>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={savePersonal}>{busy ? 'Saving…' : 'Save'}</button>
          {editingPersonalId && (
            <button className="btn btn-danger-text btn-block" onClick={deletePersonal}>Remove this bill</button>
          )}
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-debt" titleId="sheet-debt-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-debt-title">{debtSheetTitle}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Private, like everything else on this screen.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (dNameInvalid ? ' invalid' : '')}>
            <label htmlFor="d-name">What is it?</label>
            <input
              className="input" id="d-name" type="text" placeholder="e.g. Barclaycard Platinum" value={dName}
              onChange={(e) => {
                const v = e.target.value;
                setDName(v);
                if (!aprTouched) {
                  const match = M.standardAprFor(v);
                  if (match) setDApr(String(match.apr));
                }
              }}
            />
            <span className="field-error">Give it a name you will recognise.</span>
          </div>
          <div className={'field' + (dBalanceInvalid ? ' invalid' : '')}>
            <label htmlFor="d-balance">Balance owed (£)</label>
            <input className="input num-input" id="d-balance" type="text" inputMode="decimal" placeholder="0.00" value={dBalance} onChange={(e) => setDBalance(e.target.value)} />
            <span className="field-error">Enter the balance, like 2480.</span>
          </div>
          <div className={'field' + (dMinInvalid ? ' invalid' : '')}>
            <label htmlFor="d-min">Minimum payment (£)</label>
            <input className="input num-input" id="d-min" type="text" inputMode="decimal" placeholder="0.00" value={dMin} onChange={(e) => setDMin(e.target.value)} />
            <span className="field-error">Enter the minimum, like 62.</span>
          </div>
          <div className="field">
            <label htmlFor="d-apr">Interest rate (% APR)</label>
            <input
              className="input num-input" id="d-apr" type="text" inputMode="decimal" placeholder="0.0" value={dApr}
              onChange={(e) => { setDApr(e.target.value); setAprTouched(true); }}
            />
            <span className="rate-preview">
              <span className={'rate is-' + liveRate.band}>{liveRate.label}</span>
              <span className="field-help">{rateUntouched ? 'Leave at 0 if it does not charge interest.' : liveRate.detail}</span>
            </span>
            {aprSuggestion && (
              <p className="hint">
                <Icon name="alert" size={16} />
                <span>
                  Typical {aprSuggestion.label} rate is <strong className="num">{aprSuggestion.apr}% APR</strong>
                  {aprSuggestion.note ? ` — ${aprSuggestion.note}` : ''}. This is a general market rate, not
                  necessarily yours — always check your actual statement or app before relying on it.
                </span>
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="d-promo">Months of 0% left</label>
            <input className="input num-input" id="d-promo" type="text" inputMode="numeric" value={dPromo} onChange={(e) => setDPromo(e.target.value)} />
            <span className="field-help">Interest is skipped for this many months.</span>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={saveDebt}>{busy ? 'Saving…' : 'Save'}</button>
          {editingDebtId && (
            <button className="btn btn-danger-text btn-block" onClick={deleteDebt}>Remove this account</button>
          )}
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>

      <Sheet id="sheet-saving" titleId="sheet-saving-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-saving-title">{savingSheetTitle}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>Model what freeing this up would do to your date.</p>
        </div>
        <div className="sheet-body">
          <div className={'field' + (sLabelInvalid ? ' invalid' : '')}>
            <label htmlFor="s-label">What could you cut?</label>
            <SuggestInput id="s-label" placeholder="e.g. Takeaway coffee" value={sLabel} onChange={setSLabel} suggestions={COMMON_SUBSCRIPTIONS} />
            <span className="field-error">Give it a name you will recognise.</span>
          </div>
          <div className={'field' + (sAmountInvalid ? ' invalid' : '')}>
            <label htmlFor="s-amount">Roughly how much a month (£)</label>
            <input className="input num-input" id="s-amount" type="text" inputMode="decimal" placeholder="0.00" value={sAmount} onChange={(e) => setSAmount(e.target.value)} />
            <span className="field-error">Enter an amount, like 25.00.</span>
          </div>
        </div>
        <div className="sheet-foot">
          {!editingSavingId && (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={saveSaving}>{busy ? 'Saving…' : 'Save'}</button>
          )}
          {editingSavingId && (
            <button className="btn btn-danger-text btn-block" onClick={removeSavingRow}>Remove this</button>
          )}
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>
    </>
  );

  if (tablet) {
    const pane = {
      overview: <>{sections.setup}{sections.privacy}{sections.left}{sections.shared}</>,
      emergency: sections.emergency,
      personal: sections.personal,
      debt: <>{sections.debtToggle}{on ? sections.debtPlan : sections.debtOff}</>,
      savings: on ? sections.savings : sections.debtOff,
      spending
    };
    return (
      <>
        <TabletTopbar title="Yours" sub={`Private to you · ${K.partner ? `${partnerName} sees` : 'nobody sees'} none of it`}>
          <button className="btn btn-secondary btn-sm" onClick={() => open('sheet-visibility')}>
            <Icon name="lock" size={16} />What {partnerName} can see
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => open(ADD_CHOOSER_ID)}>
            <Icon name="plus" size={16} />Add a cost
          </button>
        </TabletTopbar>

        <div className="tablet-columns">
          <section className="tablet-list-pane">
            <nav className="stack-sm" aria-label="Your private space">
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
            {sections.footer}
          </section>
          <section className="tablet-detail-pane">{pane[category]}</section>
        </div>

        <AddChooser />
        {sheets}
      </>
    );
  }

  return (
    <>
      <header className="md-appbar">
        <Link className="md-iconbtn" to="/android/home" aria-label="Back"><Icon name="back" size={22} /></Link>
        <span className="appbar-title">Yours</span>
        <Bell />
      </header>

      <div className="md-headline">
        <p className="meta">Private to you · {K.partner ? `${partnerName} sees` : 'nobody sees'} none of it</p>
      </div>

      <PullToRefresh className="scroll has-fab" onRefresh={refreshYours}>
        {sections.setup}
        {sections.privacy}
        {sections.left}
        {sections.emergency}
        {sections.shared}
        {sections.personal}
        {spending}
        {sections.debtToggle}
        {on && <div className="stack">{sections.debtPlan}{sections.savings}</div>}
        {!on && sections.debtOff}
        {sections.footer}
      </PullToRefresh>

      <button className="md-fab" onClick={() => open(ADD_CHOOSER_ID)}>
        <Icon name="plus" size={22} />Add a cost
      </button>

      <AndroidNavBar active="yours" />

      <AddChooser />
      {sheets}
    </>
  );
}
