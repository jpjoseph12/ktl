import { useEffect, useState } from 'react';

/* 268px sidebar + 380px list pane still leaves the detail pane room to
   breathe at 1000px. Narrower (a tablet held portrait) keeps the phone
   layout for the split-view screens. */
export const TABLET_QUERY = '(min-width: 1000px) and (min-height: 600px)';

/* Single-column flows (sign-in, loading) have no panes to fit, so they
   switch to the centred tablet treatment at any tablet width, portrait
   included — past this a 412px phone column just floats on dark bars. */
export const CENTERED_QUERY = '(min-width: 700px)';

function currentMatch(query) {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches;
}

export default function useIsTablet(query = TABLET_QUERY) {
  const [isTablet, setIsTablet] = useState(() => currentMatch(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setIsTablet(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return isTablet;
}
