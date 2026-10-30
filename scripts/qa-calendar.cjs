const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
process.env.NOTES_QA_PORT ||= '9338';
const {connectToPage,waitFor,delay,assert}=require('./qa-functional.cjs');

async function run() {
  const root=path.resolve(__dirname,'..');
  const profile=await fs.mkdtemp(path.join(root,'.qa-calendar-profile-'));
  const output=path.join(root,'.qa-calendar-output');
  await fs.mkdir(output,{recursive:true});
  const source=process.env.NOTES_QA_SOURCE==='1';
  const executable=path.join(root,source?'node_modules/electron/dist/electron.exe':'release/win-unpacked/Notes.exe');
  const env={...process.env,NOTES_USER_DATA_DIR:profile,NOTES_QA:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[...(source?[root]:[]),'--remote-debugging-port='+process.env.NOTES_QA_PORT],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  let client;
  try {
    client=await connectToPage();
    const {evaluate,send}=client;
    await waitFor(()=>evaluate("Boolean(document.querySelector('#calendar-date-trigger'))"),'Takvim basligi yuklenmedi.');
    assert(await evaluate("!document.querySelector('#notification-test, #calendar-today, [data-calendar-month]') && !document.body.textContent.includes('Masaüstü bildirimini dene')"),'Eski test veya gezinme dugmeleri kaldirilmadi.');
    await evaluate("window.qaCalendarRoot=document.querySelector('#calendar-widget'); window.qaCalendarAnimations=0; qaCalendarRoot.addEventListener('animationstart',()=>qaCalendarAnimations++); document.querySelector('#calendar-date-trigger').click()");
    await waitFor(()=>evaluate("document.querySelector('#calendar-date-picker').matches(':popover-open')"),'Basliktan tarih secici acilmadi.');
    await evaluate("(() => { const f=document.querySelector('#calendar-date-form'); f.elements.year.value='2027'; f.elements.month.value='0'; f.elements.day.value='31'; f.dispatchEvent(new Event('change',{bubbles:true})); })()");
    assert(await evaluate("state.calendarYear===2027 && state.calendarMonth===0 && state.selectedDay===31 && !state.calendarExpanded && qaCalendarRoot===document.querySelector('#calendar-widget')"),'Kucuk takvim secim sirasinda acildi veya yeniden olusturuldu.');
    await evaluate("(() => { const f=document.querySelector('#calendar-date-form'); f.elements.month.value='1'; f.elements.month.dispatchEvent(new Event('change',{bubbles:true})); })()");
    assert(await evaluate("state.selectedDay===28 && document.querySelector('#calendar-date-form').elements.day.options.length===28 && document.querySelector('#calendar-date-picker').matches(':popover-open')"),'Subat gunu veya acik secici korunmadi.');
    await evaluate("(() => { const f=document.querySelector('#calendar-date-form'); f.elements.year.value='2028'; f.elements.year.dispatchEvent(new Event('change',{bubbles:true})); f.elements.day.value='29'; f.elements.day.dispatchEvent(new Event('change',{bubbles:true})); })()");
    assert(await evaluate("state.calendarYear===2028 && state.selectedDay===29 && isoForCurrentMonthDay(29)==='2028-02-29' && document.querySelector('#calendar-month-title').textContent==='ŞUBAT 2028'"),'Artik yil veya baslik guncellenmedi.');
    await evaluate("document.querySelector('#calendar-date-form').requestSubmit()");
    await waitFor(()=>evaluate("!document.querySelector('#calendar-date-picker').matches(':popover-open')"),'Tamam seciciyi kapatmadi.');
    await evaluate("document.querySelector('#calendar-toggle').click(); document.querySelector('#calendar-add-form').elements.title.value='Ajanda taslağı'");
    await delay(400);
    const box=await evaluate("(() => {const r=qaCalendarRoot.getBoundingClientRect(); return {width:r.width,height:r.height};})()");
    await evaluate("selectCalendarDate(2028,2,17)");
    assert(await evaluate("state.calendarExpanded && qaCalendarRoot===document.querySelector('#calendar-widget') && qaCalendarAnimations===0 && document.querySelector('#calendar-add-form').elements.title.value==='Ajanda taslağı' && document.querySelector('#home-selected-date').textContent==='17'"),'Tarih degisimi takvimi veya ajanda taslagini yeniledi.');
    const after=await evaluate("(() => {const r=qaCalendarRoot.getBoundingClientRect(); return {width:r.width,height:r.height};})()");
    assert(after.width===box.width && after.height===box.height,'Tarih degisiminde takvim boyutu degisti.');
    await evaluate("document.querySelector('[data-home-day=\"18\"]:not([disabled])').click(); document.querySelector('#calendar-date-trigger').click()");
    assert(await evaluate("state.selectedDay===18 && qaCalendarRoot===document.querySelector('#calendar-widget')"),'Gun seciminde takvim yeniden olusturuldu.');
    await delay(50);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await waitFor(()=>evaluate("!document.querySelector('#calendar-date-picker').matches(':popover-open')"),'Escape tarih seciciyi kapatmadi.');
    await evaluate("document.querySelector('[data-add-alarm]').click()");
    assert(await evaluate("document.querySelector('#alarm-form').elements.date.value==='2028-03-18'"),'Alarm secilen takvim gununu kullanmiyor.');
    await evaluate("document.querySelector('#alarm-cancel').click(); document.querySelector('#calendar-add-form').requestSubmit()");
    await waitFor(()=>evaluate("state.tasks.some(t=>t.title==='Ajanda taslağı' && t.dueDate==='2028-03-18')"),'Gorev secilen tarihe eklenmedi.');
    for(const width of [1280,1024]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      await evaluate("document.querySelector('#calendar-date-trigger').click()");
      await delay(120);
      assert(await evaluate("(() => {const r=document.querySelector('#calendar-date-picker').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()"),width+'px tarih secici ekran disinda.');
      const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
      await fs.writeFile(path.join(output,'calendar-picker-'+width+'.png'),Buffer.from(shot.data,'base64'));
      await evaluate("document.querySelector('#calendar-date-picker').hidePopover()");
    }
    assert(client.runtimeErrors.length===0,client.runtimeErrors.join(' | '));
    process.stdout.write(JSON.stringify({ok:true,dateSelection:true,stableCalendar:true,noNavigationAnimation:true,screenshots:output}));
  } finally {client?.socket.close();child.kill();}
}
run().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
