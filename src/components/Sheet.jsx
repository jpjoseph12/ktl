import { useScreen } from '../context/ScreenContext';

/* Bottom sheet shell — mirrors the .sheet / .sheet-grab / .sheet-head /
   .sheet-body / .sheet-foot structure from tokens.css exactly. Consumers
   pass head/body/foot as children, in order. */
export default function Sheet({ id, titleId, children }) {
  const { openId } = useScreen();
  const isOpen = openId === id;
  return (
    <section
      className={'sheet' + (isOpen ? ' open' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-hidden={!isOpen}
    >
      <div className="sheet-grab" />
      {children}
    </section>
  );
}
