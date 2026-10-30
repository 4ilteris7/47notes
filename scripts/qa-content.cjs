const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
process.env.NOTES_QA_PORT ||= '9339';
const { connectToPage, waitFor, delay, assert } = require('./qa-functional.cjs');
const fixtures = require('./fixtures/legacy-samples.json');

async function run() {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(root, '.qa-content-profile-'));
  const ownNote = { id:'own',title:'Kendi notum',kind:'NOT',bodyText:'Kullanıcının gerçek içeriği.',folder:null };
  const edited = { ...fixtures.notes[0],id:'edited',bodyText:'Başlığı aynı, içeriği kullanıcı tarafından değiştirildi.' };
  const ownTask = { id:'own-task',title:'Kendi görevim',done:false,dueDate:'2027-01-01' };
  const ownTrash = { id:'own-trash',title:'Test sonuçlarım',bodyText:'Kullanıcı tarafından silinen not.' };
  const before = { version:5,notes:[ownNote,edited],tasks:[...fixtures.tasks,ownTask],trash:[...fixtures.notes,ownTrash],folders:fixtures.folders,alarms:[],schemas:[] };
  await fs.writeFile(path.join(profile,'notes-data.json'),JSON.stringify(before));
  const source = process.env.NOTES_QA_SOURCE === '1';
  const executable = path.join(root,source?'node_modules/electron/dist/electron.exe':'release/win-unpacked/Notes.exe');
  const env = { ...process.env,NOTES_USER_DATA_DIR:profile,NOTES_QA:'1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable,[...(source?[root]:[]),'--remote-debugging-port='+process.env.NOTES_QA_PORT],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  let client;
  try {
    client = await connectToPage();
    const { evaluate } = client;
    await waitFor(()=>evaluate("Boolean(document.querySelector('#task-add-form')) && state.notes.length===2 && state.tasks.length===1 && state.trash.length===1"),'Ornek kayitlar temizlenmedi veya kullanici kaydi kayboldu.');
    assert(await evaluate("state.notes.some(n=>n.id==='own') && state.notes.some(n=>n.id==='edited') && state.tasks[0].id==='own-task' && state.trash[0].id==='own-trash'"),'Kullanici kayitlari korunmadi.');
    assert(await evaluate("!document.body.textContent.includes('Haftalık not taslağı') && !document.body.textContent.includes('Renk kararlarını arşivle') && document.querySelectorAll('.task-row').length===1"),'Ana sayfada ornek gorevler gorunuyor.');
    assert(await evaluate("typeof analyticsTemplate==='undefined' && typeof tasksTemplate==='undefined' && typeof calendarTemplate==='undefined' && typeof renderFeatures==='undefined'"),'Eski sahte ekranlar pakette kaldi.');
    await evaluate("document.querySelector('#trash-button').click(); document.querySelector('#toggle-trash-contents').click()");
    assert(await evaluate("document.body.textContent.includes('Test sonuçlarım') && !document.body.textContent.includes('Sessiz arayüzler')"),'Cop kutusunda ornek not kaldi veya kullanici notu silindi.');
    await delay(250);
    const saved = JSON.parse(await fs.readFile(path.join(profile,'notes-data.json'),'utf8'));
    assert(saved.version===6,'Tek seferlik temizlik surumu kaydedilmedi.');
    const backups = await fs.readdir(path.join(profile,'backups'));
    assert(backups.length===1,'Temizlik oncesi yedek olusturulmadi.');
    const backup = JSON.parse(await fs.readFile(path.join(profile,'backups',backups[0]),'utf8'));
    assert(JSON.stringify(backup)===JSON.stringify(before),'Yedek ozgun veriyi korumuyor.');
    require('./verify-update-data.cjs').verify(before,saved);
    await client.send('Page.reload');
    await waitFor(()=>evaluate("Boolean(document.querySelector('#task-add-form')) && state.notes.length===2 && state.tasks.length===1"),'Temizlik sonrasi yeniden acilis kayitlari degistirdi.');
    assert((await fs.readdir(path.join(profile,'backups'))).length===1,'Temizlik tekrarlandi.');
    assert(client.runtimeErrors.length===0,client.runtimeErrors.join(' | '));
    process.stdout.write(JSON.stringify({ok:true,samplesRemoved:true,userRecordsPreserved:true,backupVerified:true}));
  } finally { client?.socket.close(); child.kill(); }
}
run().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
