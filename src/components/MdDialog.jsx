import { useScreen } from '../context/ScreenContext';

export default function MdDialog({ id, titleId, children }) {
  const { openId } = useScreen();
  const isOpen = openId === id;
  return (
    <div
      className={'md-dialog' + (isOpen ? ' open' : '')}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-hidden={!isOpen}
    >
      {children}
    </div>
  );
}
