import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import Icon from './Icon';
import { useScreen } from '../context/ScreenContext';

export const ADD_CHOOSER_ID = 'sheet-add-choice';

/* Every "add something" entry point in the app opens this one sheet, so
   the FAB never guesses what you meant. The shared and private halves own
   their own forms (Bills.jsx, Yours.jsx), so picking an option hands off
   via ?add=<kind> and the destination screen opens the matching sheet —
   that keeps a single chooser without lifting four unrelated forms out of
   the screens that own their state. */
const OPTIONS = [
  {
    kind: 'bill',
    to: '/android/bills',
    icon: 'calendar',
    title: 'Recurring cost',
    sub: 'Rent, subscriptions — anything that repeats every month'
  },
  {
    kind: 'lending',
    to: '/android/bills',
    icon: 'send',
    title: 'Money lent',
    sub: 'A one-off amount someone owes back'
  },
  {
    kind: 'personal',
    to: '/android/yours',
    icon: 'lock',
    title: 'Personal bill',
    sub: 'Yours alone — never shown to your household'
  },
  {
    kind: 'debt',
    to: '/android/yours',
    icon: 'card',
    title: 'Card or loan',
    sub: 'Private too — tracked in your payoff plan'
  }
];

export default function AddChooser() {
  const { close } = useScreen();
  const navigate = useNavigate();

  function pick(option) {
    close();
    navigate(`${option.to}?add=${option.kind}`);
  }

  return (
    <Sheet id={ADD_CHOOSER_ID} titleId="sheet-add-choice-title">
      <div className="sheet-head">
        <h2 className="sheet-title" id="sheet-add-choice-title">Add a cost</h2>
        <p className="item-sub" style={{ marginTop: 4 }}>Shared or private — pick what this one is.</p>
      </div>
      <div className="sheet-body">
        <div className="list chooser-list">
          {OPTIONS.map((option, i) => (
            <button
              className="item chooser-item"
              key={option.kind}
              style={{ '--stagger': `${i * 40}ms` }}
              onClick={() => pick(option)}
            >
              <span className="glyph on-warm"><Icon name={option.icon} size={20} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>{option.title}</span>
                <span className="item-sub">{option.sub}</span>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn btn-ghost btn-block" onClick={close}>Cancel</button>
      </div>
    </Sheet>
  );
}
