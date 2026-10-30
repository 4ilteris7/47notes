const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AlarmScheduler, scheduledItems } = require('../electron/alarms.cjs');

const past = '2026-10-30T08:00:00.000Z';
const future = '2026-11-01T08:00:00.000Z';
const now = Date.parse('2026-10-30T09:00:00Z');
const alarm = { id: 'a', title: 'Toplantı', scheduledAt: past, enabled: true };

test('only valid, enabled alarms and incomplete task reminders are scheduled', () => {
  const items = scheduledItems({
    alarms: [alarm, { ...alarm, id: 'off', enabled: false }, { ...alarm, id: 'bad', scheduledAt: 'invalid' }, null],
    tasks: [{ id: 't', title: 'Görev', reminderAt: past }, { id: 'done', title: 'Bitti', done: true, reminderAt: past }, { id: 'date', title: 'Saat yok', dueDate: '2026-10-30' }]
  });
  assert.deepEqual(items.map(item => item.id), ['a', 't']);
  assert.equal(items[0].key, 'alarm:a:2026-10-30T08:00:00.000Z');
});

test('overdue alarms fire once across repeated checks, sleep and process restart', async () => {
  let saved;
  const delivered = [];
  const scheduler = new AlarmScheduler({ now: () => now, saveHistory: async value => { saved = value; }, deliver: item => delivered.push(item) });
  scheduler.update({ alarms: [alarm, { ...alarm, id: 'later', scheduledAt: future }] });
  await Promise.all([scheduler.check(), scheduler.check()]);
  await scheduler.check();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].deliveredAt, '2026-10-30T09:00:00.000Z');
  const restarted = new AlarmScheduler({ history: saved, now: () => Date.parse(future) + 60000, saveHistory: async () => {}, deliver: item => delivered.push(item) });
  restarted.update({ alarms: [alarm, { ...alarm, id: 'later', scheduledAt: future }] });
  await restarted.check();
  assert.deepEqual(delivered.map(item => item.id), ['a', 'later']);
});

test('snoozing creates a new occurrence and respects its new time', async () => {
  let clock = now;
  const delivered = [];
  const scheduler = new AlarmScheduler({ now: () => clock, saveHistory: async () => {}, deliver: item => delivered.push(item) });
  scheduler.update({ alarms: [alarm] });
  await scheduler.check();
  scheduler.update({ alarms: [{ ...alarm, scheduledAt: future }] });
  await scheduler.check();
  assert.equal(delivered.length, 1);
  clock = Date.parse(future);
  await scheduler.check();
  assert.equal(delivered.length, 2);
  assert.notEqual(delivered[0].key, delivered[1].key);
});

test('completed, removed and disabled reminders stop before delivery', async () => {
  const delivered = [];
  const scheduler = new AlarmScheduler({ now: () => now, saveHistory: async () => {}, deliver: item => delivered.push(item) });
  scheduler.update({ alarms: [alarm], tasks: [{ id: 't', title: 'Görev', reminderAt: past }] });
  scheduler.update({ alarms: [{ ...alarm, enabled: false }], tasks: [{ id: 't', title: 'Görev', reminderAt: past, done: true }] });
  await scheduler.check();
  scheduler.update({});
  await scheduler.check();
  assert.equal(delivered.length, 0);
});

test('cancelling during a history write does not deliver a stale reminder', async () => {
  let finishWrite;
  const delivered = [];
  const scheduler = new AlarmScheduler({ now: () => now, saveHistory: () => new Promise(resolve => { finishWrite = resolve; }), deliver: item => delivered.push(item) });
  scheduler.update({ alarms: [alarm] });
  const check = scheduler.check();
  scheduler.update({ alarms: [] });
  finishWrite();
  await check;
  assert.equal(delivered.length, 0);
});

test('failed history writes retry without silently consuming alarms', async () => {
  let fail = true;
  const errors = [], delivered = [];
  const scheduler = new AlarmScheduler({ now: () => now, saveHistory: async () => { if(fail) throw new Error('Disk full'); }, deliver: item => delivered.push(item), onError: error => errors.push(error) });
  scheduler.update({ alarms: [alarm] });
  await scheduler.check();
  assert.equal(delivered.length, 0);
  assert.equal(errors.length, 1);
  fail = false;
  await scheduler.check();
  assert.equal(delivered.length, 1);
});

test('offset timestamps identify the same instant and dates beyond timer limits work', async () => {
  const items = scheduledItems({ alarms: [{ ...alarm, scheduledAt: '2026-10-30T11:00:00+03:00' }, { ...alarm, id: 'far', scheduledAt: '2028-01-01T12:00:00Z' }] });
  assert.equal(items[0].scheduledAt, past);
  const delivered = [];
  const scheduler = new AlarmScheduler({ now: () => now, saveHistory: async () => {}, deliver: item => delivered.push(item) });
  scheduler.update({ alarms: [{ ...alarm, scheduledAt: '2028-01-01T12:00:00Z' }] });
  await scheduler.check();
  assert.equal(delivered.length, 0);
});
