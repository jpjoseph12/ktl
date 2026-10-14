import { describe, expect, it } from 'vitest';
import { buildExport, exportFileName } from './exportData';

const kettle = {
  you: { id: 'u1', name: 'Alex' },
  members: [{ id: 'u1', name: 'Alex', role: 'owner' }, { id: 'u2', name: 'Sam', role: 'member' }],
  data: {
    household: { id: 'h1', name: 'Flat 4', mode: 'chase', payoutRef: 'FLAT4' },
    reminders: { detailsLead: 5 },
    bills: [{ id: 'b1', name: 'Rent', total: 1200, helper: () => 1 }],
    lending: [],
    activity: [{ id: 'a1', text: 'Sam added Rent' }]
  }
};
const priv = { state: { income: 2150, debts: [{ name: 'Card', balance: 900 }] } };

describe('Download your data', () => {
  it('has the household’s shared side and your own private space, labelled', () => {
    const out = buildExport({ server: 'https://ktl.example.com', email: 'alex@example.com', kettle, priv, now: new Date('2026-10-14T12:00:00Z') });
    expect(out.you).toEqual({ name: 'Alex', email: 'alex@example.com' });
    expect(out.household.name).toBe('Flat 4');
    expect(out.household.transferReference).toBe('FLAT4');
    expect(out.household.people).toEqual([{ name: 'Alex', role: 'owner' }, { name: 'Sam', role: 'member' }]);
    expect(out.household.bills).toEqual([{ id: 'b1', name: 'Rent', total: 1200 }]);
    expect(out.yours).toEqual(priv.state);
    expect(out.exportedAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('is plain JSON — nothing that can’t be written to a file', () => {
    const out = buildExport({ server: 'x', email: 'y', kettle, priv });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('names the file by date', () => {
    expect(exportFileName(new Date('2026-10-14T12:00:00Z'))).toBe('ktl-my-data-2026-10-14.json');
  });
});
