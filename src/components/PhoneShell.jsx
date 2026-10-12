import { ScreenProvider } from '../context/ScreenContext';
import Scrim from './Scrim';
import Toast from './Toast';

/* The `.screen` / `.phone-ui` frame every screen renders into, plus a
   fresh ScreenProvider (sheet/dialog layer + toast) per mount — same
   isolation as loading a standalone HTML file in the original prototype. */
export default function PhoneShell({ platform, children }) {
  return (
    <div className="screen">
      <div className={'phone-ui ' + platform}>
        <ScreenProvider>
          {children}
          <Scrim />
          <Toast />
        </ScreenProvider>
      </div>
    </div>
  );
}
