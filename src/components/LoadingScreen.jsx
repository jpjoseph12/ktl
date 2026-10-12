import { useEffect, useState } from 'react';
import useIsTablet, { CENTERED_QUERY } from '../lib/useIsTablet';

/* A load that settles in 150ms should paint nothing. A brand mark that
   appears and vanishes inside a blink reads as a flicker rather than as
   feedback, so the mark and the dots are held back until the load has
   actually outlasted this. */
const PAINT_AFTER = 250;

/* Past this, silence starts to read as "frozen". The note doesn't claim to
   know why — it only confirms the app is still trying, which is the one
   thing the user can't tell from a spinner. */
const SLOW_AFTER = 6000;

/* True once `ms` has passed since mount. `ms <= 0` is true from the first
   render, so a caller can opt out of either gate without a second code path.
   A gate that has already opened stays open if `ms` later changes — a wait
   that has visibly passed 250ms should never un-paint itself. */
function useElapsed(ms) {
  const [elapsed, setElapsed] = useState(() => ms <= 0);

  useEffect(() => {
    if (ms <= 0) return undefined;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);

  return elapsed;
}

/* The three-pulse indicator on its own, for anywhere that needs the same
   waiting signal without the full screen. */
export function LoadingDots() {
  return (
    <div className="boot-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function LoadingBrand() {
  return (
    <div className="boot-brand">
      <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
      <p className="splash-wordmark">KTL</p>
    </div>
  );
}

/*
 * The full-screen wait: auth resolving, the household bootstrap, the private
 * figures. It renders into the same `.screen` / `.phone-ui` frame every real
 * screen uses, so the frame is already in place when the screen takes over —
 * the previous version filled the browser viewport and then snapped into the
 * phone frame on web. It deliberately does NOT go through PhoneShell: that
 * mounts a ScreenProvider plus Scrim and Toast, and Toast is a second
 * `role="status"` live region, which would give a screen reader two polite
 * regions competing on a screen that has exactly one thing to say. Nothing
 * can open a sheet or fire a toast mid-boot anyway.
 *
 *   label     what is being waited on, e.g. "Loading your household".
 *             Announced to assistive tech from the first frame, before
 *             anything is painted.
 *   slowNote  shown once the wait passes `slowAfter`.
 *   delay     how long the load may take before anything is painted.
 *   slowAfter how long before the slow note appears.
 */
export default function LoadingScreen({
  label = 'Loading',
  slowNote = 'Still going. A slow connection can take a moment.',
  delay = PAINT_AFTER,
  slowAfter = SLOW_AFTER,
  platform = 'android',
}) {
  const painted = useElapsed(delay);
  const slow = useElapsed(slowAfter);
  /* Same frame the screen after it will use: the full-bleed tablet frame
     once the viewport is tablet-wide, the phone column otherwise. */
  const wide = useIsTablet(CENTERED_QUERY);

  /* One live region for the whole wait, mounted immediately and never
     swapped — remounting it around the paint gate would announce the same
     label twice. The visible half is what waits. */
  return (
    <div className={wide ? 'tablet-shell portrait ' + platform : 'screen'}>
      <div className={wide ? 'tablet-frame' : 'phone-ui ' + platform}>
        <div className="boot" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{slow ? `${label}. ${slowNote}` : label}</span>
          {painted && (
            <>
              <LoadingBrand />
              <div className="boot-copy">
                <LoadingDots />
                <p className="boot-label" aria-hidden="true">{label}</p>
                {slow && <p className="boot-slow" aria-hidden="true">{slowNote}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
