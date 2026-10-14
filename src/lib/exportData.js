/* "Download your data": everything this person can see in KTL, as one
   JSON file. Built on the device from what's already loaded — the
   household's shared side (bills, money lent, activity, settings) and
   their own private space. Nobody else's private space is ever in it:
   the app never has it. */

const plain = (value) => JSON.parse(JSON.stringify(value ?? null, (key, v) => (typeof v === 'function' ? undefined : v)));

export function buildExport({ server, email, kettle, priv, now = new Date() }) {
  const d = kettle?.data || {};
  return {
    about: 'Your data from KTL, exported by you. The household section is what everyone in it can see; "yours" is private to you.',
    exportedAt: now.toISOString(),
    server,
    you: { name: kettle?.you?.name || '', email: email || '' },
    household: {
      name: d.household?.name || '',
      mode: d.household?.mode || '',
      transferReference: d.household?.payoutRef || null,
      people: (kettle?.members || []).map((m) => ({ name: m.name, role: m.role })),
      reminders: plain(d.reminders),
      bills: plain(d.bills || []),
      moneyLent: plain(d.lending || []),
      activity: plain(d.activity || [])
    },
    yours: plain(priv?.state || {})
  };
}

export function exportFileName(now = new Date()) {
  return `ktl-my-data-${now.toISOString().slice(0, 10)}.json`;
}
