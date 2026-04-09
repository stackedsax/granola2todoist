import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractActionItems } from '../granola.js';

const ME = 'Alex Scammon';

// ── Nested Next Steps ──────────────────────────────────────────────────────

test('nested: includes only my sub-bullets', () => {
  const notes = `
### Next Steps
- Alex
  - Reach out to Richie
  - Forward deploy to Dallas
- Dave
  - Continue thinking through positioning
- Jonathan
  - Slack message sent to Jim
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Reach out to Richie', 'Forward deploy to Dallas']);
});

test('nested: includes Team sub-bullets', () => {
  const notes = `
### Next Steps
- Alex
  - My task
- Team (London trip)
  - Schedule stakeholder check-ins
  - Lunch with Katie
- Dave
  - Dave task
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['My task', 'Schedule stakeholder check-ins', 'Lunch with Katie']);
});

test('nested: name section headers not included as tasks', () => {
  const notes = `
### Next Steps
- Alex
  - Real task
- Dave
  - Dave task
`;
  const items = extractActionItems(notes, ME);
  // "Alex" and "Dave" must not appear as tasks
  assert.ok(!items.includes('Alex'));
  assert.ok(!items.includes('Dave'));
});

test('nested: slash-combined name including me', () => {
  const notes = `
### Next Steps
- Alex / Dave
  - Shared task
- Dave
  - Dave only
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Shared task']);
});

// ── Flat Next Steps ────────────────────────────────────────────────────────

test('flat: colon format includes my tasks', () => {
  const notes = `
### Next Steps
- Alex: Follow up on proposal
- Marcus: Review the draft
- Update the shared doc
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Alex: Follow up on proposal', 'Update the shared doc']);
});

test('flat: Alex B is not me', () => {
  const notes = `
### Next Steps
- Alex B: Do something
- Alex: Do my thing
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Alex: Do my thing']);
});

test('flat: "Name to verb" excludes other people', () => {
  const notes = `
### Next Steps
- CJ to reconnect with Jason
- Alex to send the report
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Alex to send the report']);
});

test('flat: unattributed items are included', () => {
  const notes = `
### Next Steps
- Review the agenda before Friday
- Marcus: His task
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Review the agenda before Friday']);
});

test('flat: Amanda & Tim excluded', () => {
  const notes = `
### Next Steps
- Amanda & Tim: Follow up on the contract
- Alex: Check the invoice
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Alex: Check the invoice']);
});

// ── Action Items (Fireflies-style) ─────────────────────────────────────────

test('action_items: includes tasks under my name header', () => {
  const notes = `
### Action Items
Alex Scammon:
- Send the slides
- Book the room

Marcus Brown:
- Write the summary
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Send the slides', 'Book the room']);
});

test('action_items: excludes tasks under other name headers', () => {
  const notes = `
### Action Items
Marcus Brown:
- Write the summary
- Prepare the deck
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, []);
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test('returns empty array for empty input', () => {
  assert.deepEqual(extractActionItems('', ME), []);
  assert.deepEqual(extractActionItems(null, ME), []);
});

test('returns empty array when no relevant section found', () => {
  const notes = `
## Summary
We discussed the roadmap.

## Key Decisions
Ship in Q2.
`;
  assert.deepEqual(extractActionItems(notes, ME), []);
});

test('stops at next section header', () => {
  const notes = `
### Next Steps
- Alex: Task in next steps
### Other Section
- Alex: Task outside next steps
`;
  const items = extractActionItems(notes, ME);
  assert.deepEqual(items, ['Alex: Task in next steps']);
});
