import { useState } from 'react';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { useKettle } from '../context/KettleContext';
import { usePrivate } from '../context/PrivateContext';
import { useScreen } from '../context/ScreenContext';
import { SERVER_URL } from '../lib/api';
import { buildExport, exportFileName } from '../lib/exportData';
import { saveFile } from '../lib/saveFile';

/* House → Your data: a copy of everything you can see, to keep. */
export default function YourDataSection() {
  const { user } = useAuth();
  const K = useKettle();
  const M = usePrivate();
  const { toast } = useScreen();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const data = buildExport({ server: SERVER_URL, email: user?.email, kettle: K, priv: M });
      const how = await saveFile(exportFileName(), new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      if (how === 'downloaded') toast('Downloaded.');
    } catch (err) {
      toast(err.message || 'Couldn’t make the file — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <div className="section-head"><h2>Your data</h2></div>
      <div className="card stack-sm">
        <p className="body-sm">
          A copy of everything you can see in KTL, as one file: the household’s bills, money lent and activity, and your own
          private space. Only yours — nobody else’s private space is ever in it.
        </p>
        <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={download}>
          <Icon name="arrow-down" size={16} />{busy ? 'Making the file…' : 'Download a copy'}
        </button>
      </div>
    </section>
  );
}
