import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { isRecoverableAuthError } from '../lib/authRetry';
import { useAuth } from './AuthContext';
import { useKettle } from './KettleContext';
import {
  VISIBILITY,
  daysSincePayday,
  debtBadge,
  debtBudgetWarning as debtBudgetWarningOf,
  dateAfter,
  emergencyFundPlan as emergencyFundPlanOf,
  glyphFor,
  kindFor,
  leftover as leftoverOf,
  monthlyInterestFor,
  num,
  ordinal,
  payoffPlan as payoffPlanOf,
  personalSorted as personalSortedOf,
  personalTotal as personalTotalOf,
  previewMonthsSaved as previewMonthsSavedOf,
  rateInfo,
  standardAprFor,
  subscriptionSuggestions as subscriptionSuggestionsOf
} from '../lib/private';

/* PRIVACY BOUNDARY — every table this context touches (private_settings,
   personal_bills, debts, savings_opportunities) is owner-only under RLS.
   Only Yours.jsx (and its own components) import usePrivate(). The one
   value that crosses inward — your live share of the household bills —
   comes from useKettle() below and is never written back out. */
const PrivateCtx = createContext(null);

export function usePrivate() {
  const ctx = useContext(PrivateCtx);
  if (!ctx) throw new Error('usePrivate must be used within PrivateProvider');
  return ctx;
}

const DEFAULT_SETTINGS = {
  debtModule: true, income: 0, payday: '28th', budget: 0, strategy: 'snowball',
  emergencySaved: 0, emergencyMonths: 3
};

/* App field names that differ from their personal_bills column. */
const PERSONAL_COLUMNS = { renewsOn: 'renews_on', renewalKind: 'renewal_kind' };

export function PrivateProvider({ children }) {
  const { user } = useAuth();
  const { data: kettleData } = useKettle();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [debts, setDebts] = useState([]);
  const [personal, setPersonalRows] = useState([]);
  const [savings, setSavings] = useState([]);
  const bootRef = useRef(0);

  const refresh = useCallback(async (userId) => {
    const [settingsRes, debtsRes, personalRes, savingsRes] = await Promise.all([
      api.from('private_settings').select('*').eq('user_id', userId).maybeSingle(),
      api.from('debts').select('*').eq('user_id', userId).order('created_at'),
      api.from('personal_bills').select('*').eq('user_id', userId).order('created_at'),
      api.from('savings_opportunities').select('*').eq('user_id', userId).order('created_at')
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (debtsRes.error) throw debtsRes.error;
    if (personalRes.error) throw personalRes.error;
    if (savingsRes.error) throw savingsRes.error;

    let row = settingsRes.data;
    if (!row) {
      const { data: created, error } = await api
        .from('private_settings')
        .upsert({ user_id: userId, ...toColumns(DEFAULT_SETTINGS) })
        .select()
        .single();
      if (error) throw error;
      row = created;
    }

    setSettings({
      debtModule: row.debt_module,
      income: Number(row.income),
      payday: row.payday,
      budget: Number(row.budget),
      strategy: row.strategy,
      emergencySaved: Number(row.emergency_saved),
      emergencyMonths: Number(row.emergency_months)
    });
    setDebts(debtsRes.data.map((d) => ({
      id: d.id, name: d.name, kind: d.kind, glyph: d.glyph,
      balance: Number(d.balance), apr: Number(d.apr), min: Number(d.min_payment), promo: d.promo_months,
      confirmedAt: d.balance_confirmed_at,
      clearedAt: d.cleared_at || null
    })));
    setPersonalRows(personalRes.data.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, glyph: p.glyph, amount: Number(p.amount), day: p.day,
      renewsOn: p.renews_on || null, renewalKind: p.renewal_kind || null
    })));
    setSavings(savingsRes.data.map((s) => ({
      id: s.id, label: s.label, detail: s.detail, amount: Number(s.amount), shared: s.shared, applied: s.applied
    })));
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setSettings(DEFAULT_SETTINGS);
      setDebts([]);
      setPersonalRows([]);
      setSavings([]);
      return;
    }
    /* Mirrors KettleContext's boot guard — including the retry, which
       this was missing until a real report: closing and reopening the
       app lost Yours-tab data (income, personal bills, debts) while
       Bills/Home/Settle/Household came back fine. Same root cause
       KettleContext already handles — a cold start's first request can
       hit a momentarily-unusable token ("JWT issued at future", a few
       seconds of clock skew; or a stale one needing a refresh) — but
       this provider had no equivalent recovery, and since `user` doesn't
       change once the hiccup passes, the effect below never re-ran on
       its own. Without the counter a slow earlier load could land after
       a newer one and overwrite it. */
    const myBoot = ++bootRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await refresh(user.id);
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
  }, [user, refresh]);

  function toColumns(patch) {
    const out = {};
    if ('debtModule' in patch) out.debt_module = patch.debtModule;
    if ('income' in patch) out.income = patch.income;
    if ('payday' in patch) out.payday = patch.payday;
    if ('budget' in patch) out.budget = patch.budget;
    if ('strategy' in patch) out.strategy = patch.strategy;
    if ('emergencySaved' in patch) out.emergency_saved = patch.emergencySaved;
    if ('emergencyMonths' in patch) out.emergency_months = patch.emergencyMonths;
    return out;
  }

  const set = useCallback(async (key, value) => {
    if (!user) return value;
    const { error } = await api.from('private_settings').update(toColumns({ [key]: value })).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
    return value;
  }, [user, refresh]);

  /* Writes several settings fields in one round trip and one refresh,
     instead of one set() call per field. A form that changes income,
     budget and payday together should read back as one consistent update,
     not three sequential ones each re-fetching the whole row in between. */
  const setMany = useCallback(async (patch) => {
    if (!user) return patch;
    const { error } = await api.from('private_settings').update(toColumns(patch)).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
    return patch;
  }, [user, refresh]);

  const setDebt = useCallback(async (id, key, value) => {
    if (!user) return;
    const column = { min: 'min_payment', promo: 'promo_months' }[key] || key;
    const { error } = await api.from('debts').update({ [column]: value }).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  /* Writes every changed field of an edited debt in one UPDATE (instead of
     one setDebt() call per field) and stamps balance_confirmed_at at the
     same time — typing in a real current balance from a statement IS a
     confirmation, so the edit-save flow should reset the check-in clock
     as part of the same write, not need a separate call bolted on. */
  const setDebtFields = useCallback(async (id, patch) => {
    if (!user) return;
    const columns = { min: 'min_payment', promo: 'promo_months' };
    const out = { balance_confirmed_at: new Date().toISOString() };
    Object.keys(patch).forEach((k) => { out[columns[k] || k] = patch[k]; });
    const { error } = await api.from('debts').update(out).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  /* Clearing a debt is the thing the whole payoff plan was working
     toward, so it archives rather than deletes — the row stays as a
     record of something finished, and drops out of the active plan. */
  const clearDebt = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('debts')
      .update({ cleared_at: new Date().toISOString(), balance: 0 })
      .eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const unclearDebt = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('debts')
      .update({ cleared_at: null }).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  /* The one-tap "still correct" action — stamps the check-in clock only,
     never touches balance/apr/min/promo. Kept deliberately separate from
     setDebt()'s generic column map so nothing else can stamp this by
     accident. */
  const confirmDebt = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('debts')
      .update({ balance_confirmed_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const addDebt = useCallback(async (debt) => {
    if (!user) return;
    const { error } = await api.from('debts').insert({
      user_id: user.id, name: debt.name, kind: debt.kind || 'Personal', glyph: debt.glyph || 'card',
      balance: debt.balance, apr: debt.apr || 0, min_payment: debt.min, promo_months: debt.promo || 0
    });
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const removeDebt = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('debts').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const setPersonal = useCallback(async (id, key, value) => {
    if (!user) return;
    const column = PERSONAL_COLUMNS[key] || key;
    // Nothing to clear: skip it, so this works on a server from before renewals.
    if (PERSONAL_COLUMNS[key] && !value && !personal.find((p) => p.id === id)?.[key]) return;
    const { error } = await api.from('personal_bills').update({ [column]: value }).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh, personal]);

  const addPersonal = useCallback(async (bill) => {
    if (!user) return;
    const { error } = await api.from('personal_bills').insert({
      user_id: user.id, name: bill.name, kind: bill.kind || 'Personal', glyph: bill.glyph || 'card',
      amount: bill.amount, day: bill.day,
      ...(bill.renewsOn || bill.renewalKind ? { renews_on: bill.renewsOn || null, renewal_kind: bill.renewalKind || null } : {})
    });
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const removePersonal = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('personal_bills').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const addSaving = useCallback(async (saving) => {
    if (!user) return;
    const { error } = await api.from('savings_opportunities').insert({
      user_id: user.id, label: saving.label, detail: saving.detail || null, amount: saving.amount,
      shared: !!saving.shared, applied: !!saving.applied
    });
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const removeSaving = useCallback(async (id) => {
    if (!user) return;
    const { error } = await api.from('savings_opportunities').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
  }, [user, refresh]);

  const toggleSaving = useCallback(async (id) => {
    if (!user) return false;
    const current = savings.find((s) => s.id === id);
    const next = !current?.applied;
    const { error } = await api.from('savings_opportunities').update({ applied: next }).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    await refresh(user.id);
    return next;
  }, [user, savings, refresh]);

  const refreshNow = useCallback(async () => {
    if (!user) return;
    await refresh(user.id);
  }, [user, refresh]);

  const state = useMemo(() => ({ ...settings, debts, personal, savings }), [settings, debts, personal, savings]);

  /* The one figure that crosses the privacy wall, computed here (inside
     the boundary) from KettleContext's live bills — never the other
     way around. */
  const householdShare = useMemo(
    () => kettleData.bills.reduce((t, b) => t + b.yourShare, 0),
    [kettleData.bills]
  );

  /* Same one-way pattern as householdShare above: only name/glyph/your
     own share of each streaming-type household bill crosses in, purely
     to spot subscription overlap — never a total, a balance, or anything
     that could be written back out. */
  const sharedSubscriptionBills = useMemo(
    () => kettleData.bills
      .filter((b) => b.glyph === 'music' || b.glyph === 'play')
      .map((b) => ({ name: b.name, glyph: b.glyph, yourShare: b.yourShare })),
    [kettleData.bills]
  );

  const personalTotal = useCallback(() => personalTotalOf(state), [state]);
  const personalSorted = useCallback(() => personalSortedOf(state), [state]);
  const payoffPlan = useCallback(() => payoffPlanOf(state), [state]);
  const previewMonthsSaved = useCallback((extra) => previewMonthsSavedOf(state, extra), [state]);
  const leftover = useCallback(() => leftoverOf(state, householdShare), [state, householdShare]);
  const debtBudgetWarning = useCallback((budgetValue) => debtBudgetWarningOf(state, householdShare, budgetValue), [state, householdShare]);
  const emergencyFund = useCallback(() => emergencyFundPlanOf(state, householdShare), [state, householdShare]);
  const subscriptionSuggestions = useCallback(
    () => subscriptionSuggestionsOf(state, sharedSubscriptionBills),
    [state, sharedSubscriptionBills]
  );

  const value = useMemo(() => ({
    loading,
    error,
    state,
    set,
    setMany,
    setDebt,
    setDebtFields,
    confirmDebt,
    clearDebt,
    unclearDebt,
    addDebt,
    removeDebt,
    setPersonal,
    addPersonal,
    removePersonal,
    addSaving,
    removeSaving,
    toggleSaving,
    personalTotal,
    personalSorted,
    payoffPlan,
    previewMonthsSaved,
    leftover,
    debtBudgetWarning,
    emergencyFund,
    subscriptionSuggestions,
    ordinal,
    glyphFor,
    kindFor,
    debtBadge,
    monthlyInterestFor,
    rateInfo,
    dateAfter,
    daysSincePayday,
    standardAprFor,
    num,
    visibility: VISIBILITY,
    refreshNow
  }), [loading, error, state, set, setMany, setDebt, setDebtFields, confirmDebt, clearDebt, unclearDebt, addDebt, removeDebt, setPersonal, addPersonal, removePersonal, addSaving, removeSaving, toggleSaving, personalTotal, personalSorted, payoffPlan, previewMonthsSaved, leftover, debtBudgetWarning, emergencyFund, subscriptionSuggestions, refreshNow]);

  return <PrivateCtx.Provider value={value}>{children}</PrivateCtx.Provider>;
}
