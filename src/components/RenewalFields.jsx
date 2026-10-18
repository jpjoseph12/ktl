import { RENEWAL_KINDS, guessRenewalKind, renewalKind } from '../lib/renewals';

/* What a bill form saves for its renewal: the end date, and the kind —
   the one picked, or the guess from its name once there's a date. */
export function renewalPayload(name, renewsOn, pick, glyph) {
  const kind = pick || (renewsOn ? guessRenewalKind(name, glyph) : null);
  return { renewsOn: renewsOn || null, renewalKind: kind || null };
}

/* "When does the deal end?" and "What kind of bill is it?" for the shared
   and personal bill forms. Leaving the kind on "Work it out" keeps
   following the name as it's typed. */
export default function RenewalFields({ idPrefix, name, glyph, renewsOn, onRenewsOn, pick, onPick }) {
  const guess = guessRenewalKind(name, glyph);
  const kind = renewalKind(pick || guess);
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-renews`}>When does the deal end? (optional)</label>
        <input className="input" id={`${idPrefix}-renews`} type="date" value={renewsOn || ''} onChange={(e) => onRenewsOn(e.target.value)} />
        <span className="field-help">
          {renewsOn
            ? `KTL will remind you ${Math.round(kind.lead / 7)} weeks before, so there’s time to find a better deal.`
            : 'For contracts and fixed deals — energy, broadband, mobile, insurance.'}
        </span>
      </div>
      {renewsOn && (
        <div className="field">
          <label htmlFor={`${idPrefix}-renewal-kind`}>What kind of deal is it?</label>
          <select className="input" id={`${idPrefix}-renewal-kind`} value={pick || ''} onChange={(e) => onPick(e.target.value)}>
            <option value="">{`Work it out (${renewalKind(guess).label.toLowerCase()})`}</option>
            {RENEWAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
      )}
    </>
  );
}
