const { createHash } = require('node:crypto');

const CONTENT_VERSION = 6;
// Exact fingerprints of the untouched records shipped by the first prototype.
// Titles alone never identify a sample; edited records are retained.
const noteHashes = new Set([
  '829e8f945562adf5e4ca829c6e65af3ba805da806ecb29bc1e92d6d237030ff2',
  '6df7e91e200b80ff5212abd70d0ff4f1b6946dc7ce7cd4ac87746aedd9db7f33',
  'a3affd8a9f265d6f9c009e417f2ee1ff768eeb1c91bb1b6c87680d88d114e0a2',
  'bb2c8dbc1eb886d087ab55dc3b78f45f9b5af346cc80909cd10e10ca65088a7d',
  '6c302803d63d0f583c68fd5513a90e74e97583625527ea21d310be3aabb38e02',
  'ee93886fd0fef69308241e3ce6284c802d3bd9617da2ea0559b784c9d3b3c67b'
]);
const taskHashes = new Set([
  '83f23b229edd8e119e59f6fa71d24579f04ae8cf7f081d8f5202e41957329609',
  '4eb3da0d551b7caaa8bf9870befa36835aaebb58bf55544eb6635fa5053ca9d1',
  '56bede77c50867a56d42927300964169c29bfaf42785fc9fcf597f5af3807ea4',
  '842915069fa953daac01a1760c473f23438008d8a4ab5bbd63355673e7465404'
]);
const defaultFolders = ['Kişisel', 'Projeler', 'Okuma', 'Referans'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function isLegacyNote(note) {
  if (!note || typeof note !== 'object') return false;
  const body = typeof note.bodyText === 'string' ? note.bodyText : Array.isArray(note.body) ? note.body.join('\n\n') : '';
  return noteHashes.has(hash([note.title, note.kind || 'NOT', note.excerpt || '', note.folder ?? null, body]));
}

function isLegacyTask(task) {
  if (!task || typeof task !== 'object' || task.reminderAt) return false;
  const originalKeys = new Set(['id', 'title', 'time', 'done', 'dueDate', 'reminderAt']);
  if (Object.keys(task).some(key => !originalKeys.has(key))) return false;
  // Moving a migrated sample to another day counts as a user edit.
  const match = /^task-([a-z0-9]+)-[a-z0-9]{6}$/.exec(task.id || '');
  if (match && task.dueDate) {
    const created = new Date(parseInt(match[1], 36));
    if (!Number.isFinite(created.getTime())) return false;
    const localDay = new Date(created.getTime() - created.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (localDay !== task.dueDate) return false;
  }
  return taskHashes.has(hash([task.title, task.time, Boolean(task.done)]));
}

function removeLegacySamples(source) {
  const removed = { notes: 0, tasks: 0, trash: 0, folders: 0 };
  if (!source || Number(source.version || 1) >= CONTENT_VERSION) return { data: source, removed, changed: false };
  const data = { ...source };
  for (const kind of ['notes', 'tasks', 'trash']) {
    if (!Array.isArray(source[kind])) continue;
    const matches = kind === 'tasks' ? isLegacyTask : isLegacyNote;
    data[kind] = source[kind].filter(record => !matches(record));
    removed[kind] = source[kind].length - data[kind].length;
  }
  const recordsRemoved = removed.notes + removed.tasks + removed.trash;
  if (recordsRemoved && Array.isArray(source.folders) && source.folders.length === defaultFolders.length && defaultFolders.every(folder => source.folders.includes(folder))) {
    const used = new Set([...(data.notes || []), ...(data.trash || [])].map(note => note?.folder).filter(Boolean));
    data.folders = source.folders.filter(folder => used.has(folder));
    removed.folders = source.folders.length - data.folders.length;
  }
  return { data, removed, changed: recordsRemoved + removed.folders > 0 };
}

module.exports = { CONTENT_VERSION, removeLegacySamples };
