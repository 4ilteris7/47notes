const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/legacy-samples.json');
const { removeLegacySamples } = require('../electron/legacy-samples.cjs');
const clone = value => structuredClone(value);

test('only untouched prototype records are removed, including records in trash', () => {
  const source = clone({ ...fixtures, trash: fixtures.notes });
  const result = removeLegacySamples(source);
  assert.deepEqual(result.removed, { notes: 6, tasks: 4, trash: 6, folders: 4 });
  assert.equal(result.data.notes.length, 0);
  assert.equal(result.data.tasks.length, 0);
  assert.equal(source.notes.length, 6, 'The original backup object must not be mutated');
});

test('same titles with user text, edited excerpts or categories are preserved', () => {
  const note = clone(fixtures.notes[0]);
  const notes = [
    { ...note, bodyText: 'Kendi yazdığım not.' },
    { ...note, excerpt: 'Kendi açıklamam' },
    { ...note, folder: 'Yeni kategori' },
    { ...note, bodyText: '' },
    { title: 'Test sonuçları', bodyText: 'Bu gerçek bir kullanıcı notu.' }
  ];
  const result = removeLegacySamples({ version: 5, notes, tasks: [] });
  assert.deepEqual(result.data.notes, notes);
  assert.equal(result.changed, false);
});

test('modified or scheduled sample tasks count as user records', () => {
  const task = fixtures.tasks[0];
  const created = new Date(2026, 9, 30, 12).getTime().toString(36);
  const tasks = [
    { ...task, done: true },
    { ...task, time: '18:00' },
    { ...task, reminderAt: '2027-01-01T10:00:00Z' },
    { ...task, description: 'Kullanıcı açıklaması' },
    { ...task, id: 'task-' + created + '-abcdef', dueDate: '2026-11-01' }
  ];
  assert.deepEqual(removeLegacySamples({ version: 5, tasks }).data.tasks, tasks);
});

test('real notes and their folders survive; custom folder sets are left alone', () => {
  const note = { title: 'Kendi notum', bodyText: 'İçerik', folder: 'Kişisel' };
  const source = { ...clone(fixtures), notes: [...clone(fixtures.notes), note] };
  const result = removeLegacySamples(source);
  assert.deepEqual(result.data.notes, [note]);
  assert.deepEqual(result.data.folders, ['Kişisel']);
  source.folders.push('Müşteriler');
  assert.deepEqual(removeLegacySamples(source).data.folders, source.folders);
});

test('cleanup is idempotent and never reapplied to a migrated workspace', () => {
  const cleaned = removeLegacySamples(clone(fixtures));
  assert.equal(removeLegacySamples(cleaned.data).changed, false);
  const migrated = { ...clone(fixtures), version: 6 };
  assert.strictEqual(removeLegacySamples(migrated).data, migrated);
  assert.equal(removeLegacySamples(migrated).changed, false);
});
