const fs = require('node:fs');
const assert = require('node:assert/strict');
const { removeLegacySamples } = require('../electron/legacy-samples.cjs');

function verify(before, after) {
  const cleanup = removeLegacySamples(before);
  before = cleanup.data;
  const counts = {};
  for (const kind of ['notes','tasks','alarms','trash','schemas']) {
    const available = [...(after[kind] || [])];
    for (const record of before[kind] || []) {
      const index = available.findIndex(candidate => record.id ? candidate.id === record.id : candidate.title === record.title);
      assert(index >= 0, `A saved ${kind} record was not preserved.`);
      const [next] = available.splice(index,1);
      for (const key of Object.keys(record)) {
        if (key === 'updatedAt') continue;
        assert.deepEqual(next[key], record[key], `A saved ${kind}.${key} value changed during update.`);
      }
      if (kind === 'notes' && Array.isArray(record.body) && !record.bodyText) {
        assert.equal(next.bodyText, record.body.join('\n\n'), 'Legacy note paragraphs were not converted intact.');
      }
    }
    counts[kind] = (after[kind] || []).length;
  }
  for (const folder of before.folders || []) assert((after.folders || []).includes(folder), 'A saved category was not preserved.');
  return { ok:true, recordsPreserved:true, ...counts, categories:(after.folders || []).length, removedSamples:cleanup.removed };
}

if (require.main === module) {
  try {
    const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const after=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
    process.stdout.write(JSON.stringify(verify(before,after)));
  } catch(error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
module.exports = { verify };
