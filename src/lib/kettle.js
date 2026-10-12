/* KTL — icon paths + pure formatting helpers.
   Household data lives on the server and is fetched/mutated by
   KettleContext. This file only ever
   holds static assets or pure functions. */

/* ── icons ───────────────────────────────────────────────────────── */
export const PATHS = {
  home: '<path d="M3 10.2 12 3.5l9 6.7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  landmark: '<path d="M3 21h18M4 10h16M12 3 3 8h18zM6 10v11M10 10v11M14 10v11M18 10v11"/>',
  bolt: '<path d="M13 2 4.5 13.2h6L11 22l8.5-11.2h-6z"/>',
  droplet: '<path d="M12 3.2c3.6 4 5.6 6.7 5.6 9.3A5.6 5.6 0 0 1 12 18a5.6 5.6 0 0 1-5.6-5.5c0-2.6 2-5.3 5.6-9.3z"/>',
  wifi: '<path d="M2.5 9a15 15 0 0 1 19 0M6 12.6a10 10 0 0 1 12 0M9.5 16.2a5 5 0 0 1 5 0"/><circle cx="12" cy="19.6" r="1"/>',
  play: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m10 9 5 3-5 3z"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  shield: '<path d="M12 3 4.5 6v5.6c0 4.3 3 8.1 7.5 9.4 4.5-1.3 7.5-5.1 7.5-9.4V6z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 12h11l2-8.5H6.4"/>',
  train: '<rect x="5" y="3.5" width="14" height="12.5" rx="3"/><path d="M5 10h14M8.5 20l-2 2M15.5 20l2 2M8 19h8"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 4.5-1.5 6-1.5 6h15S18 13.5 18 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5 15.4 6.6M8.6 13.5l6.8 3.9"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.6 2.9-5.6 6.5-5.6s6.5 2 6.5 5.6"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M18 14.9c2.2.6 3.5 2.4 3.5 5.1"/>',
  scale: '<path d="M12 4v16M6 8h12M6 8 3 15h6zM18 8l-3 7h6zM8 20h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  pencil: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
  'arrow-up': '<path d="M12 20V4M5.5 10.5 12 4l6.5 6.5"/>',
  'arrow-down': '<path d="M12 4v16M18.5 13.5 12 20l-6.5-6.5"/>',
  lock: '<rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.8"/><path d="M10.5 18.5h3"/>',
  gym: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
  car: '<path d="M4 16.5v2.5h3v-2.5M17 16.5V19h3v-2.5"/><path d="M3.2 16.5h17.6v-4l-2-.6-2-4.4H7.2l-2 4.4-2 .6z"/><path d="M6.8 14h1.4M15.8 14h1.4"/>',
  wallet: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2"/><rect x="2.5" y="7.5" width="19" height="12" rx="2.5"/><path d="M16 13.5h2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  trend: '<path d="M3 17.5 9.5 11l4 4L21 7.5"/><path d="M15.5 7.5H21v5.5"/>',
  coins: '<ellipse cx="9" cy="6.5" rx="6" ry="2.8"/><path d="M3 6.5v5c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8v-5"/><path d="M15 12.2c3 .3 6 1.5 6 3.1v2.2c0 1.5-2.7 2.8-6 2.8s-6-1.3-6-2.8v-2"/>',
  signal: '<path d="M2 20h3v-5H2zM8 20h3V9H8zM14 20h3V4h-3zM20 20h2V11h-2z"/>'
};

export const OPEN = { scheduled: 1, 'awaiting-details': 1, 'payment-due': 1 };

export const LABELS = {
  scheduled: 'Scheduled',
  'awaiting-details': 'Needs details',
  'payment-due': 'Payment due',
  sent: 'Sent · unconfirmed',
  settled: 'Settled'
};

export const CLASSES = {
  scheduled: 'is-scheduled',
  'awaiting-details': 'is-details',
  'payment-due': 'is-due',
  sent: 'is-sent',
  settled: 'is-settled'
};

/* Alerts moved behind the badged bell in the app bar so the fifth tab
   slot could go to the private half of the app. Five tabs is the ceiling. */
export const TABS = [
  { id: 'home', label: 'Home', icon: 'home', file: 'home' },
  { id: 'bills', label: 'Bills', icon: 'list', file: 'bills' },
  { id: 'balance', label: 'Balance', icon: 'scale', file: 'settle' },
  { id: 'yours', label: 'Yours', icon: 'lock', file: 'yours' },
  { id: 'house', label: 'House', icon: 'users', file: 'household' }
];

/* The tablet sidebar has room for Alerts as its own destination, so it
   comes back as a badged item instead of hiding behind the app-bar bell. */
export const TABLET_TABS = [
  { id: 'home', label: 'Home', icon: 'home', file: 'home' },
  { id: 'bills', label: 'Bills', icon: 'list', file: 'bills' },
  { id: 'balance', label: 'Balance', icon: 'scale', file: 'settle' },
  { id: 'alerts', label: 'Alerts', icon: 'bell', file: 'alerts', badge: true },
  { id: 'yours', label: 'Yours', icon: 'lock', file: 'yours' },
  { id: 'house', label: 'House', icon: 'users', file: 'household' }
];

export const SCREENS = [
  { file: 'onboarding', title: 'Onboarding', note: 'Passwordless sign-up — name and email, then a sign-in link.' },
  { file: 'home', title: 'Home', note: 'What needs you today, the running balance, and where the month has got to.' },
  { file: 'alerts', title: 'Alerts', note: 'The reminder queue: needs you, waiting on your household, scheduled, done.' },
  { file: 'bills', title: 'Bills', note: 'Recurring costs, filterable, each opening a detail sheet with the real provider mark.' },
  { file: 'settle', title: 'Balance', note: 'Line-by-line ledger, in-flight transfers and a single settle-up.' },
  { file: 'yours', title: 'Yours', note: 'The private half: pay, your own bills, cards and a payoff plan. None of it shared.' },
  { file: 'household', title: 'Household', note: 'The share code, who’s paired, and the reminder schedule you both get.' }
];

/* ── bill categorisation ───────────────────────────────────────────
   Picks a mark from what a bill is called, so adding one needs a name
   and nothing else — no category dropdown, no per-provider setup.
   Shared (household) and personal bills both use this, so "Netflix"
   gets the same 'play' glyph wherever it's added. */
const KIND_LABEL = {
  phone: 'Phone', car: 'Car', gym: 'Gym', shield: 'Insurance',
  train: 'Travel', music: 'Music', play: 'TV', card: 'Personal'
};
export function glyphFor(name) {
  const t = String(name).toLowerCase();
  if (/phone|mobile|sim|\bee\b|o2|vodafone|three|giffgaff|voxi|lebara/.test(t)) return 'phone';
  if (/insur|cover|protection|warranty/.test(t)) return 'shield';
  if (/\bcar\b|vehicle|motor|parking|petrol|fuel/.test(t)) return 'car';
  if (/gym|fitness|yoga|climb|swim|pilates|virgin active|nuffield/.test(t)) return 'gym';
  if (/train|rail|travel|bus|\btube\b|oyster/.test(t)) return 'train';
  if (/spotify|music|audible|podcast|tidal|deezer/.test(t)) return 'music';
  if (/netflix|tv|licence|stream|disney|prime|paramount|britbox|discovery|youtube/.test(t)) return 'play';
  return 'card';
}
export function kindFor(glyph) { return KIND_LABEL[glyph] || KIND_LABEL.card; }

/* Real provider brand marks — deliberately a short, hand-picked list, not
   an attempt to cover every provider glyphFor() recognises. Only add an
   entry once the matching SVG actually exists in public/assets/logos/,
   with its real intrinsic width/height (used to decide the "tall" vs
   "wide" brand-plate treatment in the bill detail sheet) — never a guess. */
const LOGO_LIBRARY = [
  { pattern: /netflix/i, logo: 'netflix.svg', w: 1000, h: 464, provider: 'Netflix' },
  { pattern: /spotify/i, logo: 'spotify.svg', w: 400, h: 400, provider: 'Spotify' },
  { pattern: /octopus energy|\boctopus\b/i, logo: 'octopus-energy.svg', w: 470, h: 67, provider: 'Octopus Energy' },
  { pattern: /\baviva\b/i, logo: 'aviva.svg', w: 957, h: 688, provider: 'Aviva' },
  { pattern: /virgin media/i, logo: 'virgin-media.svg', w: 190, h: 111, provider: 'Virgin Media' }
];

export function logoFor(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  const match = LOGO_LIBRARY.find((entry) => entry.pattern.test(t));
  return match ? { logo: match.logo, logoW: match.w, logoH: match.h, provider: match.provider } : null;
}

/* Common UK subscriptions/providers, for the "what is it?" autocomplete
   on both the shared and personal add-bill forms. Every name here is
   picked so glyphFor() above resolves it correctly — e.g. "NOW" contains
   no matching keyword, so it's written as "NOW TV" instead. Picking one
   still just fills the text field; nothing here is stored or matched
   against directly. */
export const COMMON_SUBSCRIPTIONS = [
  // streaming / TV
  'Netflix', 'Disney+', 'Amazon Prime Video', 'NOW TV', 'Sky TV', 'Apple TV+',
  'Paramount+', 'BritBox', 'Discovery+', 'YouTube Premium',
  // music / audio
  'Spotify', 'Spotify Premium', 'Apple Music', 'Amazon Music', 'YouTube Music',
  'Audible', 'Deezer', 'Tidal',
  // mobile
  'EE mobile', 'O2 mobile', 'Vodafone mobile', 'Three mobile', 'giffgaff mobile',
  'Tesco Mobile', 'Sky Mobile', 'Voxi', 'Lebara mobile',
  // gym / fitness
  'PureGym', 'The Gym Group', 'Virgin Active', 'Fitness First', 'Nuffield Health'
];

/* ── formatting ──────────────────────────────────────────────────── */
export function money(n, opts) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n).toFixed(2);
  const parts = v.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '£' + parts.join('.') + (opts && opts.suffix ? opts.suffix : '');
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/* "Jordan Doyle" -> "JD". Used anywhere a real profile needs an avatar. */
export function initials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

export function formatDue(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/* YYYY-MM-DD for a date's own local calendar day. `.toISOString()` converts
   to UTC first, which silently shifts the date back a day for anyone in a
   timezone ahead of UTC (e.g. British Summer Time) — a bill due "the 1st"
   would get stored as the 30th/31st of the *previous* month. */
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ── N-way splitting ─────────────────────────────────────────────── */

/* Splits `total` evenly across `memberIds`, guaranteeing the shares sum to
   exactly `total` to the penny — equal division rarely divides evenly
   (100 / 3 = 33.33 repeating), so leftover pennies are handed out one at a
   time, in member order, rather than silently rounding money away. */
export function equalShares(total, memberIds) {
  const n = memberIds.length;
  if (n === 0) return {};
  const base = Math.floor((total / n) * 100) / 100;
  const shares = {};
  memberIds.forEach((id) => { shares[id] = base; });
  let remainder = round2(total - base * n);
  let i = 0;
  while (remainder > 0 && i < n) {
    shares[memberIds[i]] = round2(shares[memberIds[i]] + 0.01);
    remainder = round2(remainder - 0.01);
    i++;
  }
  return shares;
}

/* Turns a { [memberId]: percent } map (summing to ~100) into a
   { [memberId]: amount } map summing to EXACTLY `total`, fixing up
   per-share rounding drift on the last member in iteration order. */
export function sharesFromPercents(total, percentByMember) {
  const ids = Object.keys(percentByMember);
  const shares = {};
  ids.forEach((id) => { shares[id] = round2(total * (percentByMember[id] / 100)); });
  const allocated = round2(ids.reduce((sum, id) => sum + shares[id], 0));
  const drift = round2(total - allocated);
  if (drift !== 0 && ids.length) shares[ids[ids.length - 1]] = round2(shares[ids[ids.length - 1]] + drift);
  return shares;
}

/* What's left of a share after part-payments. Clamping has to respect the
   sign: a refund or credit is a NEGATIVE share (the payer owes the
   household money back), and a blunt Math.max(0, …) would silently erase
   it. So each direction clamps only toward zero — you can never overpay
   past square, in either direction. */
export function remainingShare(share, paid) {
  const s = Number(share) || 0;
  const p = Number(paid) || 0;
  return s < 0 ? round2(Math.min(0, s - p)) : round2(Math.max(0, s - p));
}

/* Pairwise, per-counterparty balances relative to `youId`, from a flat
   list of { payerId, status, shares: { [memberId]: amount } } items.
   A bill's shares only create a you<->X relationship when you or X is the
   payer — a bill a third housemate paid creates you<->housemate and
   X<->housemate debts, never a you<->X debt, so summing every non-payer
   share into "what everyone owes you" would double-count/misattribute
   money the moment a household has 3+ people. */
export function computeBalances(items, youId) {
  const out = {};
  function bucket(id) {
    if (!out[id]) out[id] = { youOwe: 0, theyOwe: 0, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 };
    return out[id];
  }
  items.forEach((item) => {
    const s = item.status;
    const payerId = item.payerId;
    Object.entries(item.shares || {}).forEach(([uid, amt]) => {
      if (uid === payerId) return;
      /* What's still owed, not what the split says — a part-payment
         already handed over must stop being chased. Settled and in-flight
         buckets keep the full share, because those record what the amount
         WAS, not what remains. */
      const alreadyPaid = (item.paid || {})[uid] || 0;
      const open = remainingShare(amt, alreadyPaid);
      if (payerId === youId) {
        const b = bucket(uid);
        if (s === 'settled') b.settled = round2(b.settled + amt);
        else if (s === 'sent') b.inFlightToYou = round2(b.inFlightToYou + amt);
        else if (OPEN[s]) b.theyOwe = round2(b.theyOwe + open);
      } else if (uid === youId) {
        const b = bucket(payerId);
        if (s === 'settled') b.settled = round2(b.settled + amt);
        else if (s === 'sent') b.inFlightFromYou = round2(b.inFlightFromYou + amt);
        else if (OPEN[s]) b.youOwe = round2(b.youOwe + open);
      }
      // else: neither side is you — a debt between two other members,
      // correctly does not touch your pairwise balance with either.
    });
  });
  Object.values(out).forEach((b) => { b.net = round2(b.youOwe - b.theyOwe); });
  return out;
}

/* The next real calendar date that falls on `day` — this month if it
   hasn't passed yet, otherwise next month. Used when someone adds a
   recurring bill and only gives a day-of-month. */
export function nextDateForDay(day) {
  const now = new Date();
  const d = Math.max(1, Math.min(31, Math.round(day)));
  let year = now.getFullYear();
  let month = now.getMonth();
  const candidate = new Date(year, month, d);
  if (candidate < new Date(year, month, now.getDate())) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(d, lastDayOfMonth);
  const result = new Date(year, month, clampedDay);
  return toLocalISODate(result);
}

/* ── recurrence ──────────────────────────────────────────────────── */

export const FREQUENCIES = [
  { unit: 'week', count: 1, label: 'Weekly' },
  { unit: 'week', count: 2, label: 'Fortnightly' },
  { unit: 'week', count: 4, label: 'Four-weekly' },
  { unit: 'month', count: 1, label: 'Monthly' },
  { unit: 'month', count: 3, label: 'Quarterly' },
  { unit: 'month', count: 6, label: 'Twice a year' },
  { unit: 'year', count: 1, label: 'Yearly' }
];

export function frequencyKey(unit, count) {
  return `${unit}:${count}`;
}

export function frequencyLabel(unit, count, day) {
  const match = FREQUENCIES.find((f) => f.unit === unit && f.count === Number(count));
  const base = match ? match.label : `Every ${count} ${unit}${Number(count) === 1 ? '' : 's'}`;
  // A day-of-month only means something for monthly-style recurrence;
  // saying "Weekly, on the 3rd" would be nonsense.
  if (unit === 'month' && day) return `${base}, on the ${day}${ordinalSuffix(day)}`;
  if (unit === 'year' && day) return `${base}, on the ${day}${ordinalSuffix(day)}`;
  return base;
}

/* What a bill costs per month, whatever its actual rhythm. An annual £240
   insurance is £20 a month of real money even though it leaves once a
   year, so the household's "£x a month" figure has to normalise or it
   swings wildly depending on what happens to be due. */
export function monthlyEquivalent(total, unit, count) {
  const n = Number(total) || 0;
  const every = Math.max(1, Number(count) || 1);
  if (unit === 'week') return round2((n * 52) / 12 / every);
  if (unit === 'year') return round2(n / (12 * every));
  return round2(n / every);
}

/* The next date a bill of this rhythm falls due, counting from today.
   Weekly-style bills step from today; monthly and yearly ones anchor to a
   day-of-month so "the 1st" stays the 1st. */
export function nextDueDate(unit, count, day) {
  const every = Math.max(1, Number(count) || 1);
  if (unit === 'week') {
    const at = new Date();
    at.setDate(at.getDate() + every * 7);
    return toLocalISODate(at);
  }
  if (unit === 'year') {
    const now = new Date();
    const d = Math.max(1, Math.min(31, Math.round(day) || 1));
    let year = now.getFullYear();
    const month = now.getMonth();
    const candidate = new Date(year, month, d);
    if (candidate < new Date(year, month, now.getDate())) year += every;
    const clamped = Math.min(d, new Date(year, month + 1, 0).getDate());
    return toLocalISODate(new Date(year, month, clamped));
  }
  // Monthly-style: the existing day-of-month walk, then forward by the
  // extra whole months a quarterly/half-yearly bill needs.
  const base = nextDateForDay(day);
  if (every === 1) return base;
  const [y, m, dd] = base.split('-').map(Number);
  const target = new Date(y, m - 1 + (every - 1), 1);
  const clamped = Math.min(dd, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  return toLocalISODate(new Date(target.getFullYear(), target.getMonth(), clamped));
}
