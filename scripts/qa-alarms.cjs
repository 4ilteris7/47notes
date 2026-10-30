const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
process.env.NOTES_QA_PORT ||= '9334';
const mainPort = Number(process.env.NOTES_QA_PORT) + 10;
const { connectToPage, waitFor, delay, assert } = require('./qa-functional.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.qa-alarm-output');
const sourceMode = process.env.NOTES_QA_SOURCE === '1';
const executable = sourceMode ? path.join(root, 'node_modules/electron/dist/electron.exe') : path.join(root, 'release/win-unpacked/Notes.exe');
let child, client;
let processOutput = '';

async function start(profile) {
  const args = [...(sourceMode ? [root] : []), `--remote-debugging-port=${process.env.NOTES_QA_PORT}`, `--inspect=${mainPort}`];
  const env = { ...process.env, NOTES_USER_DATA_DIR: profile, NOTES_QA: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, args, { cwd: root, env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  child.stdout.on('data', chunk => { processOutput += chunk; });
  child.stderr.on('data', chunk => { processOutput += chunk; });
  client = await connectToPage();
  await waitFor(() => client.evaluate("Boolean(document.querySelector('#task-add-form'))"), 'Ana sayfa hazır değil.');
}

async function stop() {
  if(client?.socket?.readyState === WebSocket.OPEN) client.socket.close();
  if(child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  await delay(400);
}

async function screenshot(name) {
  await delay(450);
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await fs.writeFile(path.join(output, name), Buffer.from(shot.data, 'base64'));
}

async function closeNativeWindow() {
  const targets = await (await fetch(`http://127.0.0.1:${mainPort}/json/list`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  try {
    const expression = `(() => { const electron = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root,'package.json'))})('electron'); const window = electron.BrowserWindow.getAllWindows()[0]; window.close(); return { destroyed: window.isDestroyed(), visible: window.isVisible() }; })()`;
    const result = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Ana süreçte kapatma testi zaman aşımı.')),5000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if(message.id !== 1) return;
        clearTimeout(timer);
        if(message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
    });
    assert(result && !result.destroyed && !result.visible, 'Yerel kapatma penceresini tepsiye gizlemedi.');
  } finally { socket.close(); }
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.qa-alarm-profile-'));
  try {
    await start(profile);
    let { evaluate } = client;
    const clockBefore = await evaluate("document.querySelector('#live-clock').textContent");
    await delay(1200);
    assert(await evaluate(`document.querySelector('#live-clock').textContent !== ${JSON.stringify(clockBefore)}`), 'Canlı saat güncellenmiyor.');
    assert(await evaluate("normalizeStoredData({version:4,tasks:[{title:'Eski görev',dueDate:'2026-10-30'}]}).tasks[0].reminderAt === null"), 'Eski görev göçü başarısız.');
    assert(await evaluate("normalizeStoredData({alarms:[{title:'Bozuk',scheduledAt:'bad'}]}).alarms.length === 0"), 'Bozuk alarm kabul edildi.');
    assert(await evaluate("parseAlarmDate('2026-02-31','10:00') === null && parseAlarmDate('2026-10-30','25:99') === null"), 'Geçersiz tarih/saat kabul edildi.');

    await evaluate("document.querySelector('#top-clock').click()");
    assert(await evaluate("document.querySelector('#alarm-dialog').open"), 'Saatten alarm eklenemedi.');
    await evaluate(`(() => { const f=document.querySelector('#alarm-form'); f.elements.title.value='Geçmiş alarm'; f.elements.date.value='2020-01-01'; f.elements.time.value='10:00'; f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    assert(await evaluate("state.alarms.length === 0 && Boolean(document.querySelector('#alarm-form-error').textContent)"), 'Geçmiş alarm engellenmedi.');
    await evaluate(`(() => { const d=new Date(); d.setDate(d.getDate()+3); const f=document.querySelector('#alarm-form'); f.elements.title.value='Takvim alarmı'; f.elements.date.value=localDateIso(d); f.elements.time.value='14:30'; f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    await waitFor(() => evaluate("state.alarms.length === 1 && !document.querySelector('#alarm-dialog').open"), 'Alarm kaydedilmedi.');
    await evaluate("document.querySelector('#next-alarm').click()");
    assert(await evaluate("document.querySelector('#calendar-widget').classList.contains('expanded') && document.querySelector('#calendar-agenda').textContent.includes('Takvim alarmı') && document.querySelector('#calendar-agenda').textContent.includes('14:30')"), 'Saatli alarm doğru takvim gününde görünmüyor.');
    await screenshot('calendar-alarm.png');

    await evaluate("document.querySelector('[data-toggle-alarm]').click()");
    await waitFor(() => evaluate("!state.alarms[0].enabled && document.querySelector('[data-toggle-alarm]').getAttribute('aria-pressed') === 'false'"), 'Alarm kapatılamadı.');
    await evaluate("document.querySelector('[data-toggle-alarm]').click()");
    await waitFor(() => evaluate("state.alarms[0].enabled && document.querySelector('[data-toggle-alarm]').getAttribute('aria-pressed') === 'true'"), 'Alarm açılamadı.');
    await evaluate("document.querySelector('[data-edit-alarm]').click()");
    await screenshot('alarm-dialog.png');
    await evaluate(`(() => { const f=document.querySelector('#alarm-form'); f.elements.title.value='Düzenlenen alarm'; f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    await waitFor(() => evaluate("state.alarms[0].title === 'Düzenlenen alarm' && !document.querySelector('#alarm-dialog').open"), 'Alarm düzenlenemedi.');

    // Date selection clamps the day without recreating the calendar.
    await evaluate("(() => { selectCalendarDate(2026,11,31); const f=document.querySelector('#calendar-date-form'); f.elements.year.value='2027'; f.elements.month.value='0'; f.dispatchEvent(new Event('change',{bubbles:true})); })()");
    assert(await evaluate("state.calendarYear===2027 && state.calendarMonth===0 && state.selectedDay===31"), 'Yıl geçişi çalışmıyor.');
    await evaluate("(() => { const f=document.querySelector('#calendar-date-form'); f.elements.month.value='1'; f.dispatchEvent(new Event('change',{bubbles:true})); })()");
    assert(await evaluate("state.calendarMonth===1 && state.selectedDay===28"), 'Şubat günü sınırlandırılmadı.');
    await evaluate("(() => { const d=new Date(); selectCalendarDate(d.getFullYear(),d.getMonth(),d.getDate()); setCalendarExpanded(false); })()");
    await screenshot('home-clock.png');

    // A normal dated task still has no automatic reminder; a time enables one.
    await evaluate(`(() => { const f=document.querySelector('#task-add-form'), d=new Date(Date.now()+86400000); f.elements.title.value='Saatli görev'; f.elements.date.value=localDateIso(d); f.elements.time.value='16:45'; f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    await waitFor(() => evaluate("state.tasks.length===1 && Boolean(document.querySelector('.has-reminder'))"), 'Görev hatırlatması eklenemedi.');
    await evaluate("document.querySelector('.task-row [data-task-alarm]').click()");
    assert(await evaluate("document.querySelector('#alarm-form').elements.title.readOnly"), 'Görev alarm düzenleyicisi açılmadı.');
    await evaluate("document.querySelector('#alarm-remove').click()");
    await waitFor(() => evaluate("state.tasks[0].reminderAt===null && !document.querySelector('#alarm-dialog').open"), 'Görev hatırlatması kaldırılamadı.');

    // Native Electron API must report successful display, not merely IPC success.
    const notification = await evaluate("window.notesDesktop.testNotification()");
    await evaluate("window.notesDesktop.dismissAlarm('test')");
    assert(notification?.ok, `Windows bildirimi: ${notification?.error}`);

    await evaluate("document.querySelector('#home-new-note').click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-note-title'))"), 'Not taslağı açılamadı.');
    await evaluate("document.querySelector('#home-note-title').value='Korunan taslak'; document.querySelector('#home-note-body').value='Alarm işlemleri bu taslağı kaybetmemeli.'");

    // Exercise the main-process scheduler with second precision, while the QA window is hidden.
    await closeNativeWindow();
    await delay(300);
    assert(await evaluate("document.visibilityState === 'hidden' && Boolean(document.querySelector('#workspace'))"), 'Pencere kapatıldığında sistem tepsisinde kalmadı.');
    await evaluate(`(async () => { state.alarms[0].scheduledAt=new Date(Date.now()+2200).toISOString(); state.tasks.push({id:'completed',title:'Çalmamalı',done:true,dueDate:todayIso(),reminderAt:new Date(Date.now()-1000).toISOString()}); state.alarms.push({id:'disabled',title:'Kapalı alarm',enabled:false,scheduledAt:new Date(Date.now()-1000).toISOString()}); await saveNow(); })()`);
    await waitFor(() => evaluate("state.ringingAlarms.length===1"), 'Gizli pencerede alarm çalmadı.');
    assert(await evaluate("state.ringingAlarms[0].title==='Düzenlenen alarm'"), 'Kapalı alarm veya tamamlanan görev çaldı.');
    await screenshot('ringing-alarm.png');
    await evaluate("document.querySelector('[data-alarm-snooze]').click()");
    await waitFor(() => evaluate("state.ringingAlarms.length===0"), 'Erteleme alarmı kapatmadı.');
    assert(await evaluate("Date.parse(state.alarms[0].scheduledAt)>Date.now()+290000"), 'Alarm beş dakika ertelenmedi.');
    assert(await evaluate("document.querySelector('#home-note-title').value==='Korunan taslak' && document.querySelector('#home-note-body').value==='Alarm işlemleri bu taslağı kaybetmemeli.'"), 'Alarm erteleme not taslağını kaybetti.');
    await evaluate("state.alarms[0].scheduledAt=new Date(Date.now()+1500).toISOString(); saveNow()");
    await waitFor(() => evaluate("state.ringingAlarms.length===1"), 'Ertelenmiş alarm yeniden çalmadı.');
    await evaluate("document.querySelector('[data-alarm-dismiss]').click()");
    await waitFor(() => evaluate("state.ringingAlarms.length===0"), 'Alarm kapatılamadı.');
    const history = JSON.parse(await fs.readFile(path.join(profile, 'alarm-history.json'), 'utf8'));
    assert(Object.keys(history).length === 2, 'Alarm geçmişi kalıcı değil.');
    assert(client.runtimeErrors.length===0, `Çalışma zamanı hatası: ${client.runtimeErrors.join(' | ')}`);
    await stop();

    // Reopen the same profile: delivered occurrences stay consumed; an overdue new one is caught up.
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'notes-data.json'), 'utf8'));
    saved.alarms.push({ id: 'missed', title: 'Kaçırılan alarm', enabled: true, scheduledAt: new Date(Date.now()-60000).toISOString() });
    await fs.writeFile(path.join(profile, 'notes-data.json'), JSON.stringify(saved));
    await start(profile);
    ({ evaluate } = client);
    await waitFor(() => evaluate("state.ringingAlarms.length===1"), 'Yeniden açılışta kaçırılan alarm bildirilmedi.');
    assert(await evaluate("state.ringingAlarms[0].id==='missed' && state.alarms.length===3 && state.tasks.length===2"), 'Yeniden açılış alarmı tekrarladı veya veri kaybetti.');
    await evaluate("document.querySelector('[data-alarm-dismiss]').click()");
    await evaluate("showAlarmCalendar({scheduledAt:state.alarms[0].scheduledAt}); document.querySelector('[data-edit-alarm]').click(); document.querySelector('#alarm-remove').click()");
    await waitFor(() => evaluate("state.alarms.length===2 && !document.querySelector('#alarm-dialog').open"), 'Alarm silinemedi.');

    for (const [width,height] of [[1280,800],[1024,700]]) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate("state.calendarExpanded=false; renderWorkspace()");
      await screenshot(`home-${width}.png`);
      assert(await evaluate("document.querySelector('.window-bar').scrollWidth<=document.querySelector('.window-bar').clientWidth"), `${width}px üst çubuk taşıyor.`);
      assert(await evaluate("getComputedStyle(document.querySelector('#task-add-form input[type=date]')).display!=='none'"), `${width}px görev tarihi gizlendi.`);
      await evaluate("document.querySelector('#calendar-toggle').click()");
      await screenshot(`calendar-${width}.png`);
    }
    assert(client.runtimeErrors.length===0, `Çalışma zamanı hatası: ${client.runtimeErrors.join(' | ')}`);
    process.stdout.write(JSON.stringify({ ok:true, nativeNotification:notification.ok, scheduler:'hidden/restart/snooze/cancel verified', profile, screenshots:output },null,2));
  } finally { await stop(); }
}

run().catch(error => { process.stderr.write(`${error.stack || error.message}\n${processOutput}\n`); process.exitCode=1; });
