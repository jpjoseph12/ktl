import { Link } from 'react-router-dom';
import { money } from '../lib/kettle';

/* One row per OTHER household member — shared by Home's summary card and
   Settle's full breakdown so the two can never show different numbers for
   the same pairwise balance. `balances` is the { [memberId]: { net, ... } }
   shape from KettleContext's balances(). */
export default function BalanceList({ people, balances, linkTo, onSelect }) {
  if (!people.length) {
    return <p className="hint">Invite someone to your household to start splitting bills.</p>;
  }
  return (
    <div className="stack-sm">
      {people.map((m) => {
        const b = balances[m.id] || { net: 0 };
        const inner = (
          <>
            <span className="legend">{m.name}</span>
            <span className={'amount num' + (b.net > 0 ? ' owed' : b.net < 0 ? ' owing' : '')}>
              {b.net === 0 ? 'Square' : b.net > 0 ? `You owe ${money(b.net)}` : `Owes you ${money(-b.net)}`}
            </span>
          </>
        );
        if (linkTo) return <Link className="row-between" to={linkTo(m.id)} key={m.id}>{inner}</Link>;
        if (onSelect) return <button className="row-between item" key={m.id} onClick={() => onSelect(m.id)}>{inner}</button>;
        return <div className="row-between" key={m.id}>{inner}</div>;
      })}
    </div>
  );
}
