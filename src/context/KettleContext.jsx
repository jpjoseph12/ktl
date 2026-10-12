import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiFetch } from '../lib/api';
import { subscribeToActivity } from '../lib/live';
import { isRecoverableAuthError } from '../lib/authRetry';
import { useAuth } from './AuthContext';
import {
  LABELS, OPEN, computeBalances, equalShares, formatDue, formatSince, glyphFor,
  initials as initialsOf, logoFor, frequencyLabel, monthlyEquivalent, nextDueDate,
  remainingShare, round2, sharesFromPercents
} from '../lib/kettle';
import { plannedReminders } from '../lib/reminders';
import { cancelAllReminders, notifyNow, syncReminders } from '../lib/notifications';
import { isSnoozed, snoozeUntilLater } from '../lib/snooze';

const KettleCtx = createContext(null);

export function useKettle() {
  const ctx = useContext(KettleCtx);
  if (!ctx) throw new Error('useKettle must be used within KettleProvider');
  return ctx;
}

/* `shares`/`details` can carry any number of rows (one per household
   member). `theirShare` is always the correct SUM of every other member's
   share — not one arbitrary other row — so money from a 3rd+ member is
   never silently dropped. `payer`/`theirShare`/`detailsPartner` stay as
   compat aliases (first-other-member-flavoured) for call sites not yet
   upgraded to the per-person `shares`/`details` maps. */
function normalizeShared(row, shares, details, youId, otherMemberIds, table) {
  const shareMap = {};
  const paidMap = {};
  const outstandingMap = {};
  shares.forEach((s) => {
    shareMap[s.user_id] = Number(s.share);
    paidMap[s.user_id] = Number(s.paid || 0);
    outstandingMap[s.user_id] = remainingShare(s.share, s.paid);
  });
  const detailsMap = {};
  (details || []).forEach((d) => { detailsMap[d.user_id] = { done: !!d.done, value: d.value || '' }; });
  const isLending = table === 'lending';
  const yourShare = shareMap[youId] || 0;
  return {
    id: row.id,
    _table: table,
    name: row.name,
    provider: row.provider || null,
    glyph: row.glyph,
    logo: row.logo || null,
    logoW: row.logo_w,
    logoH: row.logo_h,
    total: Number(row.total),
    payer: row.payer_id === youId ? 'you' : 'partner',
    payerId: row.payer_id,
    shares: shareMap,
    paid: paidMap,
    outstanding: outstandingMap,
    yourShare,
    yourOutstanding: outstandingMap[youId] ?? yourShare,
    theirShare: round2(Number(row.total) - yourShare),
    endedOn: row.ended_on || null,
    due: isLending ? null : formatDue(row.due_date),
    dueSort: isLending ? row.occurred_on : row.due_date,
    date: isLending ? formatDue(row.occurred_on) : undefined,
    frequency: row.frequency || null,
    frequencyUnit: row.frequency_unit || 'month',
    frequencyCount: row.frequency_count || 1,
    status: row.status,
    needsDetails: !!row.needs_details,
    detailsLabel: row.details_label,
    details: detailsMap,
    detailsYou: detailsMap[youId] || { done: false, value: '' },
    detailsPartner: detailsMap[otherMemberIds[0]] || { done: false, value: '' },
    note: row.note || null,
    settledNote: row.settled_note || null,
    sentNote: row.sent_note || null,
    householdId: row.household_id
  };
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

const EMPTY_HOUSEHOLD = {
  id: null, name: '', code: '', split: '', payoutRef: null, mode: 'chase', since: ''
};

export function KettleProvider({ children }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // isSnoozed() reads localStorage directly, which React has no way to
  // know changed — this just forces needsYou() to recompute right after
  // a new snooze is applied. Expiry itself needs no such nudge: it's
  // checked at read-time, so a stale snooze simply stops matching on
  // whatever render happens to run after it lapses.
  const [snoozeVersion, setSnoozeVersion] = useState(0);
  const [householdId, setHouseholdId] = useState(null);
  const [household, setHousehold] = useState(EMPTY_HOUSEHOLD);
  const [you, setYou] = useState(null);
  const [members, setMembers] = useState([]);
  const [bills, setBills] = useState([]);
  const [lending, setLending] = useState([]);
  const [reminders, setReminders] = useState({
    detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00',
    nudgeAfter: 24, quietFrom: '22:00', quietTo: '08:00', push: true, email: false, weeklyDigest: true
  });
  const [activity, setActivity] = useState([]);

  const bootRef = useRef(0);

  const refresh = useCallback(async (hid, youId) => {
    const [billsRes, billSharesRes, billDetailsRes, lendingRes, lendingSharesRes, remindersRes, activityRes, membersRes, amountsRes] = await Promise.all([
      api.from('bills').select('*').eq('household_id', hid),
      api.from('bill_shares').select('*').eq('household_id', hid),
      api.from('bill_details').select('*').eq('household_id', hid),
      api.from('lending').select('*').eq('household_id', hid),
      api.from('lending_shares').select('*').eq('household_id', hid),
      api.from('household_reminders').select('*').eq('household_id', hid).maybeSingle(),
      api.from('activity').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(30),
      api.from('household_members').select('household_id, user_id, role, joined_at').eq('household_id', hid),
      api.from('bill_amounts').select('*').eq('household_id', hid).order('for_date', { ascending: false })
    ]);

    const firstError = [billsRes, billSharesRes, billDetailsRes, lendingRes, lendingSharesRes, remindersRes, activityRes, membersRes, amountsRes]
      .find((r) => r.error);
    if (firstError) throw firstError.error;

    const householdRes = await api.from('households').select('*').eq('id', hid).single();
    if (householdRes.error) throw householdRes.error;

    const memberIds = membersRes.data.map((m) => m.user_id);
    const profilesRes = memberIds.length
      ? await api.from('profiles').select('id, full_name').in('id', memberIds)
      : { data: [] };
    if (profilesRes.error) throw profilesRes.error;
    const profileById = new Map(profilesRes.data.map((p) => [p.id, p]));

    const sortedMembers = membersRes.data
      .slice()
      .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at))
      .map((m) => {
        const p = profileById.get(m.user_id);
        return {
          id: m.user_id,
          name: p?.full_name || (m.user_id === youId ? 'You' : 'Household member'),
          initials: initialsOf(p?.full_name),
          role: m.role,
          joinedAt: m.joined_at
        };
      });
    const otherMemberIds = sortedMembers.filter((m) => m.id !== youId).map((m) => m.id);
    const youProfile = profileById.get(youId);

    const sharesByBill = groupBy(billSharesRes.data, 'bill_id');
    const detailsByBill = groupBy(billDetailsRes.data, 'bill_id');
    const sharesByLending = groupBy(lendingSharesRes.data, 'lending_id');
    const amountsByBill = groupBy(amountsRes.data || [], 'bill_id');

    const normBills = billsRes.data.map((row) => ({
      ...normalizeShared(row, sharesByBill.get(row.id) || [], detailsByBill.get(row.id) || [], youId, otherMemberIds, 'bills'),
      amountHistory: (amountsByBill.get(row.id) || []).map((a) => ({
        id: a.id, amount: Number(a.amount), forDate: a.for_date, note: a.note || null
      }))
    }));
    const normLending = lendingRes.data.map((row) =>
      normalizeShared(row, sharesByLending.get(row.id) || [], [], youId, otherMemberIds, 'lending')
    );

    const h = householdRes.data;
    // households.split_you/split_them is a legacy 2-person default, never
    // written to by any UI — with up to 6 members the default split is
    // always equal, so it's computed from the live member count instead.
    const equalPct = sortedMembers.length ? Math.round((100 / sortedMembers.length) * 10) / 10 : 50;
    setHousehold({
      id: h.id,
      name: h.name,
      code: h.code,
      split: sortedMembers.length > 1 ? `${equalPct}% each` : 'Just you',
      payoutRef: h.payout_ref,
      mode: h.mode,
      since: formatSince(h.created_at)
    });
    setYou(youProfile ? { id: youId, name: youProfile.full_name, initials: initialsOf(youProfile.full_name) } : { id: youId, name: 'You', initials: '?' });
    setMembers(sortedMembers);
    setBills(normBills);
    setLending(normLending);
    if (remindersRes.data) {
      setReminders({
        detailsLead: remindersRes.data.details_lead,
        detailsTime: remindersRes.data.details_time?.slice(0, 5),
        paymentLead: remindersRes.data.payment_lead,
        paymentTime: remindersRes.data.payment_time?.slice(0, 5),
        nudgeAfter: remindersRes.data.nudge_after,
        quietFrom: remindersRes.data.quiet_from?.slice(0, 5),
        quietTo: remindersRes.data.quiet_to?.slice(0, 5),
        push: remindersRes.data.push,
        email: remindersRes.data.email,
        weeklyDigest: remindersRes.data.weekly_digest
      });
    }
    setActivity(activityRes.data.map((a) => ({
      id: a.id,
      text: a.text,
      tag: a.tag,
      date: new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      who: a.user_id
    })));
  }, []);

  /* A KTL server holds one household, and everyone with an account on the
     server is in it: this joins it on first sign-in (up to six people) and
     returns its id. The server's setup creates the household, so the two
     ways this can fail are named for the boot error screen. */
  const bootstrapAndLoad = useCallback(async (currentUser) => {
    const { data: hid, error: joinErr } = await api.rpc('join_server_household');
    if (joinErr) {
      const code = ['no_household_yet', 'household_full'].find((c) => String(joinErr.message || '').includes(c));
      throw code ? Object.assign(new Error(code), { code }) : joinErr;
    }
    setHouseholdId(hid);
    await refresh(hid, currentUser.id);
  }, [refresh]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setHouseholdId(null);
      setHousehold(EMPTY_HOUSEHOLD);
      setYou(null);
      setMembers([]);
      setBills([]);
      setLending([]);
      setActivity([]);
      return;
    }
    const myBoot = ++bootRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await bootstrapAndLoad(user);
          return;
        } catch (err) {
          if (myBoot !== bootRef.current) return; // superseded by a newer boot
          if (attempt === 2 || !isRecoverableAuthError(err)) throw err;
          try { await api.auth.refreshSession(); } catch { /* keep the old token and retry anyway */ }
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    })()
      .catch((err) => { if (myBoot === bootRef.current) setError(err); })
      .finally(() => { if (myBoot === bootRef.current) setLoading(false); });
  }, [user, bootstrapAndLoad]);

  const all = useCallback(() => bills.concat(lending), [bills, lending]);
  const find = useCallback((id) => all().find((i) => i.id === id) || null, [all]);
  const statusOf = useCallback((item) => item.status, []);
  const labelOf = useCallback((item) => LABELS[item.status], []);
  const detailsIn = useCallback((bill, who) => (who === 'you' ? bill.detailsYou.done : bill.detailsPartner.done), []);

  const logActivity = useCallback(async (text, tag) => {
    if (!householdId || !you) return;
    await api.from('activity').insert({ household_id: householdId, user_id: you.id, text, tag });
  }, [householdId, you]);

  const setStatus = useCallback(async (id, status, note) => {
    const item = find(id);
    if (!item) return;
    const { error: err } = await api.from(item._table).update({ status }).eq('id', id);
    if (err) throw err;
    /* Always leave a line, even when the caller didn't pass one — the
       activity feed is what the household actually sees and what tells
       everyone else's device something happened, so a silent status
       change would be invisible to the other person. */
    const fallback = status === 'sent' ? `Marked ${item.name} as sent`
      : status === 'settled' ? `Settled ${item.name}`
      : `${item.name} is ${(LABELS[status] || status).toLowerCase()}`;
    await logActivity(note || fallback, LABELS[status]);
    await refresh(householdId, you.id);
  }, [find, householdId, you, refresh, logActivity]);

  const setFlag = useCallback(async (id, key, value, textValue) => {
    if (key !== 'detailsYou' || !you || !householdId) return;
    const payload = { bill_id: id, household_id: householdId, user_id: you.id, done: !!value, updated_at: new Date().toISOString() };
    if (textValue !== undefined) payload.value = textValue;
    const { error: err } = await api.from('bill_details').upsert(payload, { onConflict: 'bill_id,user_id' });
    if (err) throw err;
    // Confirming a bill's details is a one-shot submit (Home's form,
    // Alerts' dialog), not something fired per keystroke — safe to log,
    // and it's exactly the kind of "someone else just did something"
    // update a partner is waiting on, so it needs to reach the live stream
    // subscription the same way every other shared action already does.
    if (value) {
      const item = find(id);
      if (item) await logActivity(`Added ${(item.detailsLabel || 'details').toLowerCase()} for ${item.name}`, 'Updated');
    }
    await refresh(householdId, you.id);
  }, [you, householdId, refresh, find, logActivity]);

  const flag = useCallback((id, key) => {
    const item = find(id);
    if (!item) return undefined;
    return key === 'detailsYou' ? item.detailsYou.done : item.detailsPartner.done;
  }, [find]);

  const mode = useCallback(() => household.mode || 'chase', [household.mode]);
  const tracking = useCallback(() => mode() === 'track', [mode]);
  const closedStatus = useCallback(() => (tracking() ? 'settled' : 'sent'), [tracking]);

  const renameHousehold = useCallback(async (name) => {
    if (!householdId) return;
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Give your household a name.');
    const { error } = await api.from('households').update({ name: trimmed }).eq('id', householdId);
    if (error) throw error;
    await refresh(householdId, you.id);
  }, [householdId, you, refresh]);

  const setMode = useCallback(async (m) => {
    if (!householdId) return m;
    const { error: err } = await api.from('households').update({ mode: m }).eq('id', householdId);
    if (err) throw err;
    if (m === 'track') {
      const sentIds = all().filter((i) => i.status === 'sent');
      await Promise.all(sentIds.map((i) => api.from(i._table).update({ status: 'settled' }).eq('id', i.id)));
    }
    await refresh(householdId, you.id);
    return m;
  }, [householdId, all, refresh, you]);

  /* Per-counterparty balances — one entry per OTHER household member,
     keyed by their user id. See computeBalances() in lib/kettle.js for why
     this can't be a naive "sum every non-payer share" reduction once a
     household has 3+ people. */
  const balances = useCallback(() => {
    if (!you) return {};
    return computeBalances(all(), you.id);
  }, [all, you]);

  /* Compat aggregate summing every counterparty's balance — kept so
     existing single-number call sites (Home/Settle headline, Household's
     leave-dialog amount) stay correct for N>2 without each needing to
     learn the per-person shape immediately. */
  const balance = useCallback(() => {
    const perPerson = Object.values(balances());
    const sum = (k) => round2(perPerson.reduce((s, b) => s + b[k], 0));
    return {
      youOwe: sum('youOwe'), theyOwe: sum('theyOwe'), net: round2(sum('youOwe') - sum('theyOwe')),
      inFlightToYou: sum('inFlightToYou'), inFlightFromYou: sum('inFlightFromYou'), settled: sum('settled')
    };
  }, [balances]);

  /* An ended bill is no longer a monthly cost, so it drops out of the pot
     and the count — otherwise a cancelled subscription would keep
     inflating "£x a month" forever. */
  const cycleTotals = useCallback(() => {
    let total = 0, paidOut = 0, closed = 0;
    const now = new Date();
    const running = bills.filter((b) => !b.endedOn);
    running.forEach((b) => {
      // Normalised so an annual £240 insurance reads as the £20 a month it
      // really costs, instead of swinging the household total depending on
      // whether it happens to fall due this month.
      total += monthlyEquivalent(b.total, b.frequencyUnit, b.frequencyCount);
      if (b.status === 'settled') closed++;
      const due = b.dueSort ? new Date(b.dueSort) : null;
      if (b.status === 'settled' || (due && due <= now)) {
        paidOut += monthlyEquivalent(b.total, b.frequencyUnit, b.frequencyCount);
      }
    });
    return { total: round2(total), paidOut: round2(paidOut), closed, count: running.length };
  }, [bills]);

  /* Outstanding, not the original share — otherwise a part-payment would
     show as netted off in the balance but still owed in full on the line
     underneath it, which is the same debt disagreeing with itself. */
  const owedBreakdown = useCallback(() => {
    let billsOwed = 0, lent = 0;
    const mine = (b) => (you ? b.outstanding?.[you.id] ?? b.yourShare : b.yourShare);
    bills.forEach((b) => { if (b.payer !== 'you' && OPEN[b.status]) billsOwed += mine(b); });
    lending.forEach((b) => { if (b.payer !== 'you' && OPEN[b.status]) lent += mine(b); });
    return { bills: round2(billsOwed), lent: round2(lent), total: round2(billsOwed + lent) };
  }, [bills, lending, you]);

  /* Settles what you owe a single counterparty (`memberId`). `scope: 'net'`
     also closes out what that same person owes you, so one settle-up nets
     both directions for that pair — it never touches your balance with
     anyone else in the household. */
  const settleWith = useCallback(async (memberId, scope) => {
    const next = closedStatus();
    const open = all().filter((i) => OPEN[i.status]);
    const mine = open.filter((i) => i.payerId === memberId);
    const offset = scope === 'net' ? open.filter((i) => i.payerId === you.id && i.shares[memberId] !== undefined) : [];
    await Promise.all([
      ...mine.map((i) => api.from(i._table).update({ status: next }).eq('id', i.id)),
      ...offset.map((i) => api.from(i._table).update({ status: 'settled' }).eq('id', i.id))
    ]);
    /* Settling up used to write nothing here — a genuinely high-value
       action (potentially several items at once) that the other person
       would most want to know about immediately, and it was also just
       silently absent from "Done this month" on the Alerts screen. This
       is what the live stream elsewhere actually listens for,
       so without it neither the live refresh nor the push notification
       ever fired for a settle-up. */
    const closedCount = mine.length + offset.length;
    if (closedCount > 0) {
      const withName = members.find((m) => m.id === memberId)?.name || 'them';
      await logActivity(`Settled up with ${withName} — ${closedCount} ${closedCount === 1 ? 'item' : 'items'} closed`, 'Settled');
    }
    await refresh(householdId, you.id);
    return { status: next, mine: mine.length, offset: offset.length };
  }, [all, closedStatus, householdId, logActivity, members, refresh, you]);

  /* Compat wrapper: settles with the first other household member. Kept
     only for callers not yet upgraded to name a specific counterparty. */
  const settleAll = useCallback((scope) => settleWith(members.find((m) => m.id !== you?.id)?.id, scope), [settleWith, members, you]);

  /* `splitPercents`, when given, is a { [memberId]: percent } map covering
     every current member and summing to ~100. Omitting it (undefined/null)
     means "use the equal-split default for however many members there are
     right now" — there's no more a single stored default once a household
     can have 3-6 people, since 100/N isn't a fixed number. */
  const addBill = useCallback(async ({ name, total, payerId, day, needsDetails, splitPercents, frequencyUnit, frequencyCount }) => {
    if (!householdId || !you) return;
    if (!payerId || !members.some((m) => m.id === payerId)) throw new Error('Choose who pays the provider.');
    const memberIds = members.map((m) => m.id);
    const usingDefaultSplit = !splitPercents;
    const shareMap = usingDefaultSplit ? equalShares(total, memberIds) : sharesFromPercents(total, splitPercents);
    const unit = frequencyUnit || 'month';
    const count = frequencyCount || 1;
    const dueDate = nextDueDate(unit, count, day);
    const detected = glyphFor(name);
    const glyph = detected === 'card' ? 'calendar' : detected;
    const logoMatch = logoFor(name);

    const { data: bill, error: billErr } = await api
      .from('bills')
      .insert({
        household_id: householdId, name, glyph, total, payer_id: payerId,
        due_date: dueDate, frequency: frequencyLabel(unit, count, day),
        frequency_unit: unit, frequency_count: count,
        status: 'scheduled', needs_details: !!needsDetails, created_by: you.id,
        provider: logoMatch?.provider ?? null, logo: logoMatch?.logo ?? null,
        logo_w: logoMatch?.logoW ?? null, logo_h: logoMatch?.logoH ?? null
      })
      .select()
      .single();
    if (billErr) throw billErr;

    const shareRows = memberIds.map((id) => ({ bill_id: bill.id, household_id: householdId, user_id: id, share: shareMap[id] ?? 0 }));
    const { error: shareErr } = await api.from('bill_shares').insert(shareRows);
    if (shareErr) throw shareErr;

    const splitNote = usingDefaultSplit ? '' : ', split custom for this one';
    await logActivity(`Added ${name}, ${round2(total).toFixed(2)} a month${splitNote}`, 'Added');
    await refresh(householdId, you.id);
  }, [householdId, you, members, logActivity, refresh]);

  /* A one-off amount someone else owes you — "I covered the takeaway when
     Sam was short, they'll pay me back on payday." Unlike addBill(), this
     is never split across the whole household — it's specifically between
     the payer and ONE borrower. `borrowerPct` (default 100) controls how
     much of it the borrower owes back: at 100 only the borrower gets a
     lending_shares row (the payer implicitly owes nothing, same as a
     bill's payer); at anything less (e.g. 50 to literally halve a shared
     takeaway) the payer also gets a row for their own remaining share, so
     the two rows sum to the total exactly like a bill's shares do. */
  function lendingShareRows(total, payerId, borrowerId, borrowerPct) {
    const pct = borrowerPct === undefined || borrowerPct === null ? 100 : borrowerPct;
    const borrowerShare = round2(total * (pct / 100));
    const payerShare = round2(total - borrowerShare);
    const rows = [{ user_id: borrowerId, share: borrowerShare }];
    if (payerShare > 0) rows.push({ user_id: payerId, share: payerShare });
    return rows;
  }

  const addLending = useCallback(async ({ name, total, payerId, borrowerId, note, borrowerPct }) => {
    if (!householdId || !you) return;
    if (!payerId || !members.some((m) => m.id === payerId)) throw new Error('Choose who paid.');
    if (!borrowerId || borrowerId === payerId || !members.some((m) => m.id === borrowerId)) {
      throw new Error('Choose who owes it back.');
    }
    const glyph = glyphFor(name);

    const { data: row, error: lendErr } = await api
      .from('lending')
      .insert({
        household_id: householdId, name, glyph, total, payer_id: payerId,
        note: note || null, created_by: you.id
      })
      .select()
      .single();
    if (lendErr) throw lendErr;

    const shareRows = lendingShareRows(total, payerId, borrowerId, borrowerPct)
      .map((r) => ({ lending_id: row.id, household_id: householdId, ...r }));
    const { error: shareErr } = await api.from('lending_shares').insert(shareRows);
    if (shareErr) throw shareErr;

    await logActivity(`Lent ${name}, ${round2(total).toFixed(2)}`, 'Added');
    await refresh(householdId, you.id);
  }, [householdId, you, members, logActivity, refresh]);

  const updateLending = useCallback(async (id, { name, total, payerId, borrowerId, note, borrowerPct }) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'lending') return;
    if (!payerId || !members.some((m) => m.id === payerId)) throw new Error('Choose who paid.');
    if (!borrowerId || borrowerId === payerId || !members.some((m) => m.id === borrowerId)) {
      throw new Error('Choose who owes it back.');
    }
    const glyph = glyphFor(name);

    const { error: lendErr } = await api
      .from('lending')
      .update({ name, glyph, total, payer_id: payerId, note: note || null })
      .eq('id', id);
    if (lendErr) throw lendErr;

    const shareRows = lendingShareRows(total, payerId, borrowerId, borrowerPct)
      .map((r) => ({ lending_id: id, household_id: householdId, ...r }));
    const keepIds = shareRows.map((r) => r.user_id);
    const { error: shareErr } = await api.from('lending_shares').upsert(shareRows, { onConflict: 'lending_id,user_id' });
    if (shareErr) throw shareErr;
    // Switching from a half-split back to "all of it" (or a different
    // borrower) leaves a stale row behind — drop anyone no longer part of
    // this specific loan.
    const { error: staleErr } = await api.from('lending_shares').delete().eq('lending_id', id).not('user_id', 'in', `(${keepIds.join(',')})`);
    if (staleErr) throw staleErr;

    await logActivity(`Updated ${name}, ${round2(total).toFixed(2)}`, 'Updated');
    await refresh(householdId, you.id);
  }, [householdId, you, members, find, logActivity, refresh]);

  const removeLending = useCallback(async (id) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'lending') return;
    const { error } = await api.from('lending').delete().eq('id', id);
    if (error) throw error;
    await logActivity(`Removed ${item.name}`, 'Removed');
    await refresh(householdId, you.id);
  }, [householdId, you, find, logActivity, refresh]);

  /* An energy bill is a different number every month, so `needsDetails`
     asking for a meter reading was only ever half the job — this records
     what the bill actually came to, keeps it in the history, and re-splits
     the shares to match so the balance follows the real figure rather
     than the estimate it was set up with. Any part-payments already made
     are preserved; only the amounts owed move. */
  const recordBillAmount = useCallback(async (billId, amount, forDate) => {
    if (!householdId || !you) return;
    const item = find(billId);
    if (!item || item._table !== 'bills') return;
    const total = Number(amount);
    if (!isFinite(total) || total === 0) throw new Error('Enter what the bill came to.');

    const { error: histErr } = await api.from('bill_amounts').insert({
      bill_id: billId, household_id: householdId, amount: total,
      for_date: forDate || new Date().toISOString().slice(0, 10), recorded_by: you.id
    });
    if (histErr) throw histErr;

    const { error: billErr } = await api.from('bills').update({ total }).eq('id', billId);
    if (billErr) throw billErr;

    /* Re-split on the proportions this bill already had, so a custom or
       one-pays-it-all arrangement survives the amount changing. */
    const memberIds = members.map((m) => m.id);
    const previousTotal = item.total || 0;
    let shareMap;
    if (previousTotal > 0) {
      const percents = {};
      memberIds.forEach((id) => { percents[id] = ((item.shares?.[id] || 0) / previousTotal) * 100; });
      shareMap = sharesFromPercents(total, percents);
    } else {
      shareMap = equalShares(total, memberIds);
    }
    const shareRows = memberIds.map((id) => ({
      bill_id: billId, household_id: householdId, user_id: id,
      share: shareMap[id] ?? 0, paid: item.paid?.[id] || 0
    }));
    const { error: shareErr } = await api.from('bill_shares').upsert(shareRows, { onConflict: 'bill_id,user_id' });
    if (shareErr) throw shareErr;

    await logActivity(`${item.name} came to ${round2(total).toFixed(2)}`, 'Updated');
    await refresh(householdId, you.id);
  }, [householdId, you, members, find, logActivity, refresh]);

  /* "I've sent you £20 of the £50" — the common case between housemates
     that all-or-nothing settling couldn't express. Recording part of a
     share reduces what's chased without pretending the whole thing is
     done; once nobody owes anything on the item, it closes itself. */
  const recordPayment = useCallback(async (itemId, memberId, amount) => {
    if (!householdId || !you) return;
    const item = find(itemId);
    if (!item) return;
    const share = item.shares?.[memberId] || 0;
    const already = item.paid?.[memberId] || 0;
    const add = Number(amount) || 0;
    if (add <= 0) throw new Error('Enter an amount to record.');
    // A credit isn't something you pay off in instalments — it just
    // reduces what's owed until it's used up.
    if (share < 0) throw new Error('This one is a credit, so there is nothing to pay toward.');
    const nextPaid = round2(Math.min(share, already + add));

    const shareTable = item._table === 'bills' ? 'bill_shares' : 'lending_shares';
    const fk = item._table === 'bills' ? 'bill_id' : 'lending_id';
    const { error } = await api.from(shareTable)
      .update({ paid: nextPaid })
      .eq(fk, itemId).eq('user_id', memberId);
    if (error) throw error;

    // Everyone square on this one? Then it's done, without a second tap.
    const stillOwing = Object.keys(item.shares || {}).some((uid) => {
      if (uid === item.payerId) return false;
      const paidForUid = uid === memberId ? nextPaid : (item.paid?.[uid] || 0);
      return round2((item.shares[uid] || 0) - paidForUid) > 0.009;
    });
    if (!stillOwing) {
      const { error: closeErr } = await api.from(item._table)
        .update({ status: 'settled' }).eq('id', itemId);
      if (closeErr) throw closeErr;
    }

    await logActivity(`Recorded ${round2(add).toFixed(2)} toward ${item.name}`, 'Paid');
    await refresh(householdId, you.id);
    return { paid: nextPaid, closed: !stillOwing };
  }, [householdId, you, find, logActivity, refresh]);

  /* Cancelling a subscription shouldn't mean destroying the record of
     every month you paid for it. Ending keeps the row and its settled
     history, drops it from the monthly pot and stops it asking for next
     month's meter reading — but anything still outstanding stays owed and
     settleable, because ending a bill doesn't unspend the money. */
  const endBill = useCallback(async (id, when) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'bills') return;
    const endedOn = when || new Date().toISOString().slice(0, 10);
    const { error } = await api.from('bills').update({ ended_on: endedOn }).eq('id', id);
    if (error) throw error;
    await logActivity(`Ended ${item.name}`, 'Ended');
    await refresh(householdId, you.id);
  }, [householdId, you, find, logActivity, refresh]);

  const reopenBill = useCallback(async (id) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'bills') return;
    const { error } = await api.from('bills').update({ ended_on: null }).eq('id', id);
    if (error) throw error;
    await logActivity(`Restarted ${item.name}`, 'Updated');
    await refresh(householdId, you.id);
  }, [householdId, you, find, logActivity, refresh]);

  /* Everything still in play with this person, so the figure can be shown
     before anything is written. Nobody's balance should change without
     them seeing the number first. */
  const memberExitSummary = useCallback((userId) => {
    const open = all().filter((i) => OPEN[i.status] && (i.payerId === userId || (i.shares?.[userId] || 0) > 0));
    let theyOweYou = 0, youOweThem = 0;
    open.forEach((i) => {
      if (i.payerId === you?.id) theyOweYou += i.shares?.[userId] || 0;
      else if (i.payerId === userId) youOweThem += i.shares?.[you?.id] || 0;
    });
    return { openCount: open.length, theyOweYou: round2(theyOweYou), youOweThem: round2(youOweThem) };
  }, [all, you]);

  /* Removing someone has to resolve their open money first — the RPC
     refuses otherwise, so a half-finished removal can't strand a share
     row that still counts toward a balance nobody can see or settle.
     Two shapes, because they mean different things:
       · they paid for something → the whole open amount was owed TO them,
         and once they've gone there's nothing left to chase, so it closes.
       · they owed a share → whoever is still on that bill absorbs it, so
         the shares keep summing to the total the provider actually wants. */
  const removeMember = useCallback(async (userId) => {
    if (!householdId || !you) return;
    const leavingSelf = userId === you.id;
    const label = members.find((m) => m.id === userId)?.name || 'They';
    const open = all().filter((i) => OPEN[i.status] && (i.payerId === userId || (i.shares?.[userId] || 0) > 0));

    for (const item of open) {
      const shareTable = item._table === 'bills' ? 'bill_shares' : 'lending_shares';
      const fk = item._table === 'bills' ? 'bill_id' : 'lending_id';

      if (item.payerId === userId) {
        const patch = { status: 'settled' };
        if (item._table === 'bills') patch.settled_note = `Closed when ${label} left`;
        const { error } = await api.from(item._table).update(patch).eq('id', item.id);
        if (error) throw error;
        continue;
      }

      const leaverShare = item.shares?.[userId] || 0;
      const remaining = Object.keys(item.shares || {}).filter((id) => id !== userId);
      if (remaining.length && leaverShare > 0) {
        const extra = equalShares(leaverShare, remaining);
        const rows = remaining.map((id) => ({
          [fk]: item.id, household_id: householdId, user_id: id,
          share: round2((item.shares[id] || 0) + (extra[id] || 0))
        }));
        const { error } = await api.from(shareTable).upsert(rows, { onConflict: `${fk},user_id` });
        if (error) throw error;
      }
      const { error: delErr } = await api.from(shareTable).delete().eq(fk, item.id).eq('user_id', userId);
      if (delErr) throw delErr;
    }

    const { error } = await api.rpc('remove_household_member', {
      p_household_id: householdId, p_user_id: userId
    });
    if (error) throw error;

    // Only ever yourself on the way to deleting your account, which signs
    // you out — there's nothing left to reload.
    if (leavingSelf) return;

    // Their account goes too: everyone on a server is in its household,
    // so an account that stayed would simply rejoin.
    await apiFetch(`/api/admin/people/${userId}`, { method: 'DELETE' });
    /* The name is only readable while you share a household, so record it
       now — after this their profile is invisible to everyone here. */
    await logActivity(`${label} left the household`, 'Removed');
    await refresh(householdId, you.id);
  }, [householdId, you, members, all, logActivity, refresh]);

  /* Permanent account deletion (Google Play requires it in-app). A shared
     household is left first by the same path as "Leave this household",
     which settles or writes off open money; the server then removes
     everything tied to the account (POST /api/account/delete).
     The session's user no longer exists afterwards, so sign out locally. */
  const deleteAccount = useCallback(async () => {
    if (!you) return;
    if (members.some((m) => m.id !== you.id)) await removeMember(you.id);
    try {
      await apiFetch('/api/account/delete', { method: 'POST' });
    } catch (err) {
      throw new Error(err.status === 409
        ? 'Leave your household first, then try again.'
        : 'Your account couldn’t be deleted. Check your connection and try again.');
    }
    await cancelAllReminders().catch(() => {});
    await api.auth.signOut({ scope: 'local' });
  }, [you, members, removeMember]);

  const updateBill = useCallback(async (id, { name, total, payerId, day, needsDetails, splitPercents, frequencyUnit, frequencyCount }) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'bills') return;
    if (!payerId || !members.some((m) => m.id === payerId)) throw new Error('Choose who pays the provider.');
    const memberIds = members.map((m) => m.id);
    const usingDefaultSplit = !splitPercents;
    const shareMap = usingDefaultSplit ? equalShares(total, memberIds) : sharesFromPercents(total, splitPercents);
    const unit = frequencyUnit || 'month';
    const count = frequencyCount || 1;
    const dueDate = nextDueDate(unit, count, day);
    const detected = glyphFor(name);
    const glyph = detected === 'card' ? 'calendar' : detected;
    const logoMatch = logoFor(name);

    const { error: billErr } = await api
      .from('bills')
      .update({
        name, glyph, total, payer_id: payerId, due_date: dueDate,
        frequency: frequencyLabel(unit, count, day),
        frequency_unit: unit, frequency_count: count, needs_details: !!needsDetails,
        provider: logoMatch?.provider ?? null, logo: logoMatch?.logo ?? null,
        logo_w: logoMatch?.logoW ?? null, logo_h: logoMatch?.logoH ?? null
      })
      .eq('id', id);
    if (billErr) throw billErr;

    const shareRows = memberIds.map((mid) => ({ bill_id: id, household_id: householdId, user_id: mid, share: shareMap[mid] ?? 0 }));
    const { error: shareErr } = await api.from('bill_shares').upsert(shareRows, { onConflict: 'bill_id,user_id' });
    if (shareErr) throw shareErr;
    // A member who has since left the household (no "leave" flow ships
    // today, so this is latent, not new) can still hold a stale share row
    // from before they left — drop anything not in the current roster.
    const { error: staleErr } = await api.from('bill_shares').delete().eq('bill_id', id).not('user_id', 'in', `(${memberIds.join(',')})`);
    if (staleErr) throw staleErr;

    const splitNote = usingDefaultSplit ? '' : ', split custom for this one';
    await logActivity(`Updated ${name}, ${round2(total).toFixed(2)} a month${splitNote}`, 'Updated');
    await refresh(householdId, you.id);
  }, [householdId, you, members, find, logActivity, refresh]);

  const removeBill = useCallback(async (id) => {
    if (!householdId || !you) return;
    const item = find(id);
    if (!item || item._table !== 'bills') return;
    const { error } = await api.from('bills').delete().eq('id', id);
    if (error) throw error;
    await logActivity(`Removed ${item.name}`, 'Removed');
    await refresh(householdId, you.id);
  }, [householdId, you, find, logActivity, refresh]);

  const updateReminders = useCallback(async (patch) => {
    if (!householdId) return;
    const columnPatch = {};
    if ('detailsLead' in patch) columnPatch.details_lead = patch.detailsLead;
    if ('detailsTime' in patch) columnPatch.details_time = patch.detailsTime;
    if ('paymentLead' in patch) columnPatch.payment_lead = patch.paymentLead;
    if ('paymentTime' in patch) columnPatch.payment_time = patch.paymentTime;
    const { error: err } = await api.from('household_reminders').update(columnPatch).eq('household_id', householdId);
    if (err) throw err;
    await refresh(householdId, you.id);
  }, [householdId, refresh, you]);

  /* For pull-to-refresh: a manual re-fetch of the household's data, not a
     full re-run of bootstrapAndLoad (which also does household discovery/
     creation — unnecessary and slower once you already have one). The
     live stream already calls this same function on every
     teammate action; this just gives a person a way to force it
     themselves, for when they're not sure the subscription is even still
     connected (a long background, a network blip) rather than a reason
     to actually distrust it. */
  const refreshNow = useCallback(async () => {
    if (!householdId || !you) return;
    await refresh(householdId, you.id);
  }, [householdId, you, refresh]);

  /* Everything currently waiting on you — shared by Home's action cards
     and the Alerts screen, so the two can never drift out of sync. That
     includes snoozing: it's read here (not filtered separately by
     whichever screen happens to have the button) precisely so snoozing
     something in Alerts also clears it off Home, instead of the two
     silently disagreeing about what still needs you. */
  const needsYou = useCallback(() => {
    const out = [];
    const youId = you?.id;
    all().forEach((item) => {
      const s = item.status;
      if (s === 'payment-due' && item.payer === 'partner' && !isSnoozed(youId, `pay:${item.id}`)) out.push({ type: 'pay', item });
      if (item.needsDetails && !item.detailsYou.done && (s === 'awaiting-details' || s === 'scheduled') && !isSnoozed(youId, `details:${item.id}`)) out.push({ type: 'details', item });
      if (s === 'sent' && item.payer === 'you' && !isSnoozed(youId, `confirm:${item.id}`)) out.push({ type: 'confirm', item });
    });
    return out;
    // snoozeVersion isn't read directly — it exists purely to force a
    // recompute right after snoozeItem() writes a fresh entry that
    // isSnoozed() (a plain localStorage read) has no way to announce on
    // its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, you, snoozeVersion]);

  /* The actual fix for "Snooze" doing nothing: it used to just show a
     toast with no state change behind it, so the item was still there on
     the very next render. Keyed by type+id (not just id) so if an item
     could ever legitimately need you for more than one reason at once,
     snoozing one reason doesn't silently snooze the other. */
  const snoozeItem = useCallback((type, itemId) => {
    if (!you) return;
    snoozeUntilLater(you.id, `${type}:${itemId}`);
    setSnoozeVersion((v) => v + 1);
  }, [you]);

  /* The exact reminders the device is scheduled to fire — same planner
     feeds both this list and lib/notifications.js, so what the Alerts
     screen shows can't drift from what actually pings you. */
  const plannedNotifications = useMemo(
    () => plannedReminders({ bills, reminders, members }),
    [bills, reminders, members]
  );

  /* Display form for the Alerts screen: the next few, with the firing
     time written out. */
  const scheduled = useCallback(
    () => plannedNotifications.slice(0, 4).map((s) => ({
      ...s,
      at: `${s.at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${String(s.at.getHours()).padStart(2, '0')}:${String(s.at.getMinutes()).padStart(2, '0')}`
    })),
    [plannedNotifications]
  );

  /* Hand the plan to the OS whenever it changes. Local notifications fire
     without the app running, so a user who never opens KTL still gets
     told a bill is coming — which is the whole point of chase mode. */
  useEffect(() => {
    if (!householdId) return;
    syncReminders(plannedNotifications).catch((err) => console.error('Could not schedule reminders', err));
  }, [householdId, plannedNotifications]);

  /* Anything the OTHER people in the household do. Every meaningful action
     already writes an activity row naming who did it, so one subscription
     covers the lot — the screen updates without a manual refresh, and the
     device raises a notification for it.

     This is the live stream, not push: it reaches you whenever the app is
     running or recently backgrounded. Being told while the app is fully
     closed is push (lib/push.js), which a server only sends when it has
     been given a Firebase project. */
  const notifiedRef = useRef(new Set());
  useEffect(() => {
    if (!householdId || !you) return;
    return subscribeToActivity(householdId, (row) => {
      if (!row || row.user_id === you.id) return; // your own action — you already know
      if (notifiedRef.current.has(row.id)) return; // a re-subscribe shouldn't re-announce
      notifiedRef.current.add(row.id);
      const who = members.find((m) => m.id === row.user_id)?.name;
      notifyNow(who ? `${who} · ${household.name || 'Your household'}` : 'Your household', row.text, { activityId: row.id })
        .catch(() => {});
      refresh(householdId, you.id).catch(() => {});
    });
    // `members` and `household.name` are only read for labelling;
    // resubscribing whenever either changes would churn the socket for no
    // benefit, and the callback always closes over the current render's copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, you, refresh]);

  const openCount = useCallback(() => needsYou().length, [needsYou]);

  const others = useMemo(() => members.filter((m) => m.id !== you?.id), [members, you]);
  const partner = others[0] || null;

  const people = useMemo(() => {
    const map = {};
    members.forEach((m) => { map[m.id] = m; });
    return map;
  }, [members]);

  const dataShape = useMemo(() => ({
    household,
    people,
    bills,
    lending,
    reminders,
    activity,
    get scheduled() { return scheduled(); }
  }), [household, people, bills, lending, reminders, activity, scheduled]);

  const value = useMemo(() => ({
    loading,
    error,
    data: dataShape,
    you,
    partner,
    members,
    others,
    statusOf,
    setStatus,
    setFlag,
    flag,
    detailsIn,
    labelOf,
    find,
    all,
    balance,
    balances,
    cycleTotals,
    mode,
    setMode,
    renameHousehold,
    tracking,
    closedStatus,
    owedBreakdown,
    settleAll,
    settleWith,
    addBill,
    updateBill,
    removeBill,
    addLending,
    updateLending,
    removeLending,
    recordPayment,
    recordBillAmount,
    endBill,
    reopenBill,
    memberExitSummary,
    removeMember,
    deleteAccount,
    updateReminders,
    needsYou,
    snoozeItem,
    refreshNow,
    openCount
  }), [loading, error, dataShape, you, partner, members, others, statusOf, setStatus, setFlag, flag, detailsIn, labelOf, find, all, balance, balances, cycleTotals, mode, setMode, renameHousehold, tracking, closedStatus, owedBreakdown, settleAll, settleWith, addBill, updateBill, removeBill, addLending, updateLending, removeLending, recordPayment, recordBillAmount, endBill, reopenBill, memberExitSummary, removeMember, deleteAccount, updateReminders, needsYou, snoozeItem, refreshNow, openCount]);

  return <KettleCtx.Provider value={value}>{children}</KettleCtx.Provider>;
}
