import { useScreen } from '../context/ScreenContext';

export default function CopyButton({ text, toastMsg, className, children }) {
  const { toast } = useScreen();
  function handleClick() {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast(toastMsg || text + ' copied');
  }
  return (
    <button className={className} onClick={handleClick}>
      {children}
    </button>
  );
}
