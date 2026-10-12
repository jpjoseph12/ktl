import { useScreen } from '../context/ScreenContext';

export default function Scrim() {
  const { openId, close } = useScreen();
  const isOpen = !!openId;
  return (
    <div
      className={'scrim' + (isOpen ? ' open' : '')}
      aria-hidden={!isOpen}
      onClick={close}
    />
  );
}
