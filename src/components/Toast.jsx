import { useScreen } from '../context/ScreenContext';
import Icon from './Icon';

export default function Toast() {
  const { toastMsg, toastVisible } = useScreen();
  return (
    <div className={'toast' + (toastVisible ? ' open' : '')} role="status" aria-live="polite">
      <Icon name="check-circle" size={18} />
      <span>{toastMsg}</span>
    </div>
  );
}
