import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import AndroidNavBar from '../../components/android/AndroidNavBar';
import Sheet from '../../components/Sheet';
import Icon from '../../components/Icon';
import Pill from '../../components/Pill';
import CopyButton from '../../components/CopyButton';
import Bell from '../../components/Bell';
import BalanceList from '../../components/BalanceList';
import { useKettle } from '../../context/KettleContext';
import { useScreen } from '../../context/ScreenContext';
import { OPEN, money, round2 } from '../../lib/kettle';
import PullToRefresh from '../../components/PullToRefresh';
import TabletShell, { TabletTopbar } from '../../components/tablet/TabletShell';
import useIsTablet from '../../lib/useIsTablet';

/* On a tablet a line is a selectable card that opens its detail in the
   right-hand pane; on the phone it's a static row in a list. */
function Line({ item, amount, sub, onSelect, current }) {
  const inner = (
    <>
      <span className="glyph"><Icon name={item.glyph} size={20} /></span>
      <span className="grow">
        <span className="item-title" style={{ display: 'block' }}>{item.name}</span>
        <span className="item-sub">{sub}</span>
      </span>
      <span className="item-end">
        <span className="amount num">{money(amount)}</span>
        <Pill item={item} />
      </span>
    </>
  );
  if (onSelect) {
    return <button className="item list tablet-row" aria-current={String(!!current)} onClick={onSelect}>{inner}</button>;
  }
  return <div className="item">{inner}</div>;
}

function EmptyLine({ text }) {
  return (
    <div className="item">
      <span className="grow"><span className="item-sub">{text}</span></span>
    </div>
  );
}

export default function AndroidSettle() {
  const isTablet = useIsTablet();
  if (isTablet) {
    return (
      <TabletShell platform="android" active="balance">
        <SettleBody tablet />
      </TabletShell>
    );
  }
  return (
    <PhoneShell platform="android">
      <SettleBody />
    </PhoneShell>
  );
}

function SettleBody({ tablet = false }) {
  const K = useKettle();
  const others = K.others || (K.partner ? [K.partner] : []);
  const singleOther = others.length === 1 ? others[0] : null;
  function nameOf(id) {
    if (!id) return 'them';
    if (K.you && id === K.you.id) return 'You';
    return K.data.people?.[id]?.name || 'them';
  }
  const { open, close, toast } = useScreen();
  const [searchParams] = useSearchParams();
  const wantsFull = searchParams.get('scope') === 'full';
  const [tab, setTab] = useState('open');
  const [scope, setScope] = useState(wantsFull ? 'full' : 'net');
  const [busy, setBusy] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(singleOther?.id || null);

  const perPerson = K.balances ? K.balances() : {};
  const b = K.balance();
  const bSel = perPerson[selectedMemberId] || { youOwe: 0, theyOwe: 0, net: 0 };
  const selectedName = nameOf(selectedMemberId);
  const tracking = K.tracking();
  const asOf = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' });

  const youList = [], theyList = [], flight = [], closed = [];
  let settledTotal = 0;
  K.all().forEach((i) => {
    const s = i.status;
    const when = i.due ? 'Due ' + i.due : 'Lent ' + i.date;
    if (s === 'settled') {
      const amt = i.payer === 'you' ? i.theirShare : i.yourShare;
      closed.push({ item: i, amount: amt, sub: when + ' · closed' });
      settledTotal += amt;
    } else if (s === 'sent') {
      const amt = i.payer === 'you' ? i.theirShare : i.yourShare;
      flight.push({ item: i, amount: amt, sub: i.payer === 'you' ? 'Sent — confirm when it lands' : `You sent it — waiting on ${nameOf(i.payerId)}` });
    } else if (OPEN[s]) {
      /* What's still owed after any part-payment, so a line can't claim
         more than the balance above it says. */
      const yoursLeft = K.you ? i.outstanding?.[K.you.id] ?? i.yourShare : i.yourShare;
      const theirsLeft = Object.keys(i.shares || {})
        .filter((uid) => uid !== K.you?.id && uid !== i.payerId)
        .reduce((sum, uid) => sum + (i.outstanding?.[uid] ?? i.shares[uid] ?? 0), 0);
      const partPaid = (i.paid?.[K.you?.id] || 0) > 0 ? ' · part paid' : '';
      if (i.payer !== 'you') youList.push({ item: i, amount: yoursLeft, sub: when + ' · to ' + nameOf(i.payerId) + partPaid });
      else theyList.push({ item: i, amount: round2(theirsLeft), sub: when });
    }
  });

  const effectiveScope = bSel.net <= 0 ? 'full' : scope;

  const scopeHelp = bSel.net <= 0
    ? `${selectedName} owes you more than you owe them, so there is nothing to net off.`
    : effectiveScope === 'net'
    ? `Offsets the ${money(bSel.theyOwe)} ${selectedName} owes you — one transfer and you are square.`
    : `The whole amount you owe ${selectedName}. What they owe you stays open and settles on its own.`;

  const covers = selectedMemberId ? K.all().filter((i) => i.payerId === selectedMemberId && OPEN[i.status]) : [];

  useEffect(() => {
    if (wantsFull && singleOther && K.balance().youOwe > 0) open('sheet-settle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSettleFor(memberId) {
    setSelectedMemberId(memberId);
    const bTarget = perPerson[memberId] || { net: 0 };
    setScope(bTarget.net > 0 ? 'net' : 'full');
    open('sheet-settle');
  }

  async function settleUp() {
    if (!selectedMemberId) return;
    const before = perPerson[selectedMemberId] || { net: 0, theyOwe: 0 };
    const amt = effectiveScope === 'net' ? before.net : bSel.youOwe;
    setBusy(true);
    try {
      await K.settleWith(selectedMemberId, effectiveScope);
      close();
      toast(
        (tracking ? 'Recorded ' : 'Sent ') + money(amt) + ' · ' +
        (effectiveScope === 'net'
          ? (tracking ? `you and ${selectedName} are square.` : `${selectedName} confirms and you are square.`)
          : `${selectedName} still owes you ${money(before.theyOwe)}.`)
      );
    } finally {
      setBusy(false);
    }
  }

  function settleCta() {
    if (bSel.youOwe > 0) return bSel.net > 0 ? `Settle up ${money(bSel.net)}` : `Pay the ${money(bSel.youOwe)} you owe`;
    return bSel.theyOwe > 0 ? `${selectedName} settles up next` : 'Nothing to settle';
  }

  /* ── tablet: which line's detail is in the right-hand pane ─────────
     Only lines in the tab currently showing can be picked; switching tab
     (or the line closing) drops the pane back to the summary. */
  const [pickedId, setPickedId] = useState(null);
  const tabLines = tab === 'open' ? [...youList, ...theyList] : tab === 'flight' ? flight : closed;
  const pickedLine = tablet ? tabLines.find((l) => l.item.id === pickedId) || null : null;
  const lineProps = (l) => (tablet
    ? { onSelect: () => setPickedId(l.item.id), current: pickedLine?.item.id === l.item.id }
    : {});
  const lineList = (lines, emptyText) => (tablet && lines.length ? (
    <div className="stack-sm">
      {lines.map((l) => <Line key={l.item.id} item={l.item} amount={l.amount} sub={l.sub} {...lineProps(l)} />)}
    </div>
  ) : (
    <div className="list">
      {lines.length ? lines.map((l) => <Line key={l.item.id} item={l.item} amount={l.amount} sub={l.sub} />) : <EmptyLine text={emptyText} />}
    </div>
  ));

  const tabsContent = (
    <>
        <div className="seg" role="tablist" aria-label="Which items to show">
          <button role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>Open</button>
          {!tracking && (
            <button role="tab" aria-selected={tab === 'flight'} onClick={() => setTab('flight')}>In flight</button>
          )}
          <button role="tab" aria-selected={tab === 'closed'} onClick={() => setTab('closed')}>Settled</button>
        </div>

        {tab === 'open' && (
          <div className="stack">
            <section className="stack">
              <div className="section-head"><h2>{others.length > 1 ? 'You owe' : `You owe ${selectedName}`}</h2><span className="meta num">{money(b.youOwe)}</span></div>
              {lineList(youList, 'Nothing outstanding from you.')}
            </section>
            <section className="stack">
              <div className="section-head"><h2>{others.length > 1 ? 'Owed to you' : `${selectedName} owes you`}</h2><span className="meta num">{money(b.theyOwe)}</span></div>
              {lineList(theyList, 'Nothing outstanding from your household.')}
            </section>
            {!tablet && (
              <p className="hint">
                <Icon name="scale" size={16} />
                KTL nets what you owe each person, so one transfer per person settles them up. Every line still closes on its own once it’s confirmed.
              </p>
            )}
          </div>
        )}

        {tab === 'flight' && !tracking && (
          <div className="stack">
            <section className="stack">
              <div className="section-head"><h2>Sent, not yet confirmed</h2></div>
              {lineList(flight, 'No transfers waiting on a confirmation.')}
            </section>
            <p className="hint">
              <Icon name="clock" size={16} />
              Money sitting here has been sent but nobody has confirmed it arrived. KTL nudges the payer after <span className="num">{K.data.reminders.nudgeAfter}</span> hours.
            </p>
          </div>
        )}

        {tab === 'closed' && (
          <div className="stack">
            <section className="stack">
              <div className="section-head"><h2>Settled in {monthName}</h2><span className="meta num">{money(Math.round(settledTotal * 100) / 100)}</span></div>
              {lineList(closed, 'Nothing closed yet this month.')}
            </section>
          </div>
        )}
    </>
  );

  const settleSheet = (
      <Sheet id="sheet-settle" titleId="sheet-settle-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-settle-title">Settle up{selectedMemberId ? ` with ${selectedName}` : ''}</h2>
          <p className="item-sub" style={{ marginTop: 4 }}>
            Closes {covers.length} open {covers.length === 1 ? 'item' : 'items'} on your side.
          </p>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>How much are you sending?</label>
            <div className="seg" role="tablist" aria-label="Amount to send">
              <button role="tab" aria-selected={effectiveScope === 'net'} disabled={bSel.net <= 0} onClick={() => setScope('net')}>
                Net <span className="opt-amount">{money(Math.max(bSel.net, 0))}</span>
              </button>
              <button role="tab" aria-selected={effectiveScope === 'full'} onClick={() => setScope('full')}>
                In full <span className="opt-amount">{money(bSel.youOwe)}</span>
              </button>
            </div>
            <span className="field-help">{scopeHelp}</span>
          </div>
          <dl style={{ margin: 0 }}>
            <div className="kv"><dt>You send</dt><dd className="num">{money(effectiveScope === 'net' ? bSel.net : bSel.youOwe)}</dd></div>
            {effectiveScope === 'net' && (
              <div className="kv"><dt>Less what {selectedName} owes</dt><dd className="num">− {money(bSel.theyOwe)}</dd></div>
            )}
            <div className="kv"><dt>To</dt><dd>{selectedName}</dd></div>
            {K.data.household.payoutRef && <div className="kv"><dt>Reference</dt><dd className="num">{K.data.household.payoutRef}</dd></div>}
          </dl>
          {K.data.household.payoutRef && (
            <CopyButton className="btn btn-secondary btn-block" text={K.data.household.payoutRef} toastMsg={`Reference ${K.data.household.payoutRef} copied`}>
              <Icon name="copy" size={17} />Copy the reference
            </CopyButton>
          )}
          <div className="stack-sm">
            <p className="eyebrow">What it closes</p>
            {covers.map((i) => (
              <div className="row-between" key={i.id}>
                <span className="body-sm">{i.name}</span>
                <span className="amount num">{money(i.yourShare)}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            <Icon name="lock" size={16} />
            <span>
              {tracking
                ? `KTL never touches your money. This only records that you have paid — nothing waits on ${selectedName}.`
                : `KTL never touches your money. Make the transfer in your banking app, then confirm here so ${selectedName} knows to look for it.`}
            </span>
          </p>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={settleUp}>
            {busy ? 'Settling…' : tracking ? `Record ${money(effectiveScope === 'net' ? bSel.net : bSel.youOwe)} as paid` : `Confirm I’ve sent ${money(effectiveScope === 'net' ? bSel.net : bSel.youOwe)}`}
          </button>
          <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
        </div>
      </Sheet>
  );

  if (tablet) {
    const bTotal = bSel.youOwe + bSel.theyOwe;
    const pct = bTotal > 0 ? Math.round((bSel.youOwe / bTotal) * 100) : 50;
    const picked = pickedLine?.item;
    return (
      <>
        <TabletTopbar title="Balance" sub={`As of ${asOf}`}>
          {singleOther && (
            <button className="btn btn-primary btn-sm" disabled={bSel.youOwe <= 0} onClick={() => openSettleFor(selectedMemberId)}>
              <Icon name="send" size={16} /><span>{settleCta()}</span>
            </button>
          )}
        </TabletTopbar>

        <div className="tablet-columns">
          <section className="tablet-list-pane">{tabsContent}</section>
          <section className="tablet-detail-pane">
            {picked ? (
              <article className="card card-lg stack">
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', paddingInline: 'var(--space-2)' }} onClick={() => setPickedId(null)}>
                  <Icon name="back" size={16} />Back to summary
                </button>
                <div className="row">
                  <span className="glyph"><Icon name={picked.glyph} size={22} /></span>
                  <div className="grow">
                    <div className="item-title">{picked.name}</div>
                    <div className="item-sub">{picked.due ? 'Due ' + picked.due : 'Lent ' + picked.date}</div>
                  </div>
                  <Pill item={picked} />
                </div>
                <dl style={{ margin: 0 }}>
                  <div className="kv"><dt>Full amount</dt><dd className="num">{money(picked.total)}</dd></div>
                  <div className="kv">
                    <dt>
                      {picked.payer === 'you'
                        ? (others.length > 1 ? 'Owed to you' : `${selectedName} owes you`)
                        : `You owe ${nameOf(picked.payerId)}`}
                    </dt>
                    <dd className="num">{money(pickedLine.amount)}</dd>
                  </div>
                </dl>
                {picked.status === 'sent' && (
                  <p className="body-sm">
                    {picked.payer === 'you' ? 'It’s been sent — confirm when it lands.' : `You sent it — waiting on ${nameOf(picked.payerId)} to confirm.`}
                  </p>
                )}
              </article>
            ) : others.length > 1 ? (
              <article className="card card-lg stack">
                <p className="eyebrow">Your household balance</p>
                <BalanceList people={others} balances={perPerson} onSelect={openSettleFor} />
                <p className="meta" style={{ textAlign: 'center' }}>Select someone to settle up with them.</p>
                <hr className="divider" />
                <p className="hint">
                  <Icon name="scale" size={16} />
                  KTL nets what you owe each person, so one transfer per person settles them up. Select any line on the left to see its own detail.
                </p>
              </article>
            ) : (
              <article className="card card-lg stack">
                <p className="eyebrow">{singleOther ? `Between you and ${selectedName}` : 'Your balance'}</p>
                <div>
                  <div className="amount-xl num">{money(Math.abs(bSel.net))}</div>
                  <p className="body-sm" style={{ marginTop: 6 }}>
                    {bSel.net === 0 ? `you’re square with ${selectedName}` : bSel.net > 0 ? `you owe ${selectedName}` : `${selectedName} owes you`}
                  </p>
                </div>
                <div className="balance-bar" role="img" aria-label="Split of what each of you owes">
                  <span className="you-side" style={{ width: pct + '%' }} />
                  <span className="them-side" style={{ width: (100 - pct) + '%' }} />
                </div>
                <div className="stack-sm">
                  <div className="row-between">
                    <span className="legend"><i className="you-side" />You owe {selectedName}</span>
                    <span className="amount num owed">{money(bSel.youOwe)}</span>
                  </div>
                  <div className="row-between">
                    <span className="legend"><i className="them-side" />{selectedName} owes you</span>
                    <span className="amount num owing">{money(bSel.theyOwe)}</span>
                  </div>
                </div>
                <button className="btn btn-primary btn-block" disabled={bSel.youOwe <= 0} onClick={() => openSettleFor(selectedMemberId)}>
                  <Icon name="send" size={17} /><span>{settleCta()}</span>
                </button>
                <p className="meta" style={{ textAlign: 'center' }}>
                  {tracking
                    ? 'One transfer clears everything you owe. KTL just records it — nobody has to confirm.'
                    : `One transfer clears everything you owe. ${selectedName} still confirms it landed.`}
                </p>
                <hr className="divider" />
                <p className="hint">
                  <Icon name="scale" size={16} />
                  KTL nets these off, so you only ever make one transfer. Select any line on the left to see its own detail.
                </p>
              </article>
            )}
          </section>
        </div>

        {settleSheet}
      </>
    );
  }

  return (
    <>
      <header className="md-appbar">
        <Link className="md-iconbtn" to="/android/home" aria-label="Back"><Icon name="back" size={22} /></Link>
        <span className="appbar-title">Balance</span>
        <Bell />
      </header>

      <PullToRefresh className="scroll" onRefresh={K.refreshNow}>
        {others.length > 1 ? (
          <section className="card card-lg stack">
            <p className="eyebrow">As of {asOf}</p>
            <BalanceList people={others} balances={perPerson} onSelect={openSettleFor} />
            <p className="meta" style={{ textAlign: 'center' }}>Tap someone to settle up with them.</p>
          </section>
        ) : (
          <section className="card card-lg stack">
            <p className="eyebrow">As of {asOf}</p>
            <div>
              <div className="amount-xl num">{money(Math.abs(bSel.net))}</div>
              <p className="body-sm" style={{ marginTop: 6 }}>
                {bSel.net === 0 ? `you’re square with ${selectedName}` : bSel.net > 0 ? `you owe ${selectedName}` : `${selectedName} owes you`}
              </p>
            </div>
            <div className="stack-sm">
              <div className="row-between">
                <span className="legend"><i className="you-side" />You owe {selectedName}</span>
                <span className="amount num owed">{money(bSel.youOwe)}</span>
              </div>
              <div className="row-between">
                <span className="legend"><i className="them-side" />{selectedName} owes you</span>
                <span className="amount num owing">{money(bSel.theyOwe)}</span>
              </div>
            </div>
            <button className="btn btn-primary btn-block" disabled={bSel.youOwe <= 0} onClick={() => openSettleFor(selectedMemberId)}>
              <Icon name="send" size={17} /><span>{settleCta()}</span>
            </button>
            <p className="meta" style={{ textAlign: 'center' }}>
              {tracking
                ? 'One transfer clears everything you owe. KTL just records it — nobody has to confirm.'
                : `One transfer clears everything you owe. ${selectedName} still confirms it landed.`}
            </p>
          </section>
        )}

        {tabsContent}
      </PullToRefresh>

      <AndroidNavBar active="balance" />

      {settleSheet}
    </>
  );
}
