const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
process.env.NOTES_QA_PORT ||= '9337';
const { connectToPage, waitFor, delay, assert } = require('./qa-functional.cjs');

async function run() {
  const root = path.resolve(__dirname,'..');
  const profile = await fs.mkdtemp(path.join(root,'.qa-migration-profile-'));
  const legacy = { version:1, folders:['Kişisel','Boş kategori'], notes:[{title:'Notes ürün notları',folder:'Kişisel',body:['İlk paragraf.','İkinci paragraf.'],kind:'NOT',excerpt:'Eski not'}], tasks:[{title:'Ürün şemasını sadeleştir',time:'11:45',done:false},{title:'Tamamlanan eski görev',done:true}],trash:[],canvas:{nodes:[],connections:[]} };
  await fs.writeFile(path.join(profile,'notes-data.json'),JSON.stringify(legacy));
  const source = process.env.NOTES_QA_SOURCE === '1';
  const executable = path.join(root, source ? 'node_modules/electron/dist/electron.exe' : 'release/win-unpacked/Notes.exe');
  const args = [...(source ? [root] : []),`--remote-debugging-port=${process.env.NOTES_QA_PORT}`];
  const env = {...process.env,NOTES_USER_DATA_DIR:profile,NOTES_QA:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable,args,{cwd:root,env,windowsHide:true,stdio:'ignore'});
  let client;
  try {
    client = await connectToPage();
    await waitFor(() => client.evaluate("Boolean(document.querySelector('#task-add-form')) && state.notes.length===1 && state.tasks.length===2"), 'Eski kayitlar goc sirasinda kayboldu.');
    await delay(350);
    const saved = JSON.parse(await fs.readFile(path.join(profile,'notes-data.json'),'utf8'));
    assert(saved.version===6 && saved.notes.length===1 && saved.tasks.length===2, 'Kayit sayisi korunmadi.');
    assert(saved.notes[0].title===legacy.notes[0].title && saved.notes[0].bodyText===legacy.notes[0].body.join('\n\n'), 'Eski not icerigi korunmadi.');
    assert(saved.tasks[0].title===legacy.tasks[0].title && saved.tasks[1].done===true, 'Eski gorevler korunmadi.');
    assert(JSON.stringify(saved.folders)===JSON.stringify(legacy.folders), 'Bos kategori dahil kategoriler korunmadi.');
    require('./verify-update-data.cjs').verify(legacy,saved);
    const ids = saved.notes.map(note=>note.id);
    await client.send('Page.reload');
    await waitFor(() => client.evaluate("Boolean(document.querySelector('#task-add-form')) && state.notes.length===1 && state.tasks.length===2"), 'Yeniden yuklemede kayitlar kayboldu.');
    assert(await client.evaluate(`JSON.stringify(state.notes.map(note=>note.id))===${JSON.stringify(JSON.stringify(ids))}`), 'Not kimlikleri tekrar uretildi.');
    assert(client.runtimeErrors.length===0,client.runtimeErrors.join(' | '));
    process.stdout.write(JSON.stringify({ok:true,version:6,notes:1,tasks:2,categories:2,legacyContentPreserved:true}));
  } finally {
    client?.socket.close();
    child.kill();
  }
}
run().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
