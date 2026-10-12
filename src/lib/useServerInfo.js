import { useEffect, useState } from 'react';
import { fetchServerInfo } from './api';

/* What this server says about itself — whether it's set up yet, whether
   anyone can sign up, whether it sends email. `null` while asking; an
   unreachable server comes back as { unreachable: true } so screens can
   fall back to their defaults instead of hanging. */
export default function useServerInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    fetchServerInfo()
      .then((i) => { if (live) setInfo(i); })
      .catch(() => { if (live) setInfo({ unreachable: true }); });
    return () => { live = false; };
  }, []);
  return info;
}
