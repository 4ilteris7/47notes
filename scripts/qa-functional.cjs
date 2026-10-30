const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, '.qa-profile');
const output = path.resolve(root, '.qa-output');
const sourceMode = process.env.NOTES_QA_SOURCE === '1';
const executable = sourceMode
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'release', 'win-unpacked', 'Notes.exe');
const port = Number(process.env.NOTES_QA_PORT || 9333);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(check, message, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(message);
}

async function connectToPage() {
  let target;
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find(item => item.type === 'page' && item.url.includes('index.html'));
      return Boolean(target);
    } catch {
      return false;
    }
  }, 'Notes hata ayıklama hedefi açılamadı.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const runtimeErrors = [];
  let autoAcceptDialogs = true;

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.text || 'Runtime exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      runtimeErrors.push(message.params.entry.text);
    }
    if (message.method === 'Page.javascriptDialogOpening' && autoAcceptDialogs) {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(error => runtimeErrors.push(error.message));
    }
  });

  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} zaman aşımına uğradı.`));
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    let result;
    try { result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); }
    catch (error) { throw new Error(`${error.message} İfade: ${expression.slice(0, 240)}`); }
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Sayfa değerlendirme hatası');
    return result.result.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await waitFor(() => evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#workspace'))"), 'Uygulama yüklenmedi.');

  return { socket, send, evaluate, runtimeErrors, setAutoAccept: value => { autoAcceptDialogs = value; } };
}

async function run() {
  assert(profile.startsWith(`${root}${path.sep}`), 'QA profil yolu proje dışında.');
  assert(output.startsWith(`${root}${path.sep}`), 'QA çıktı yolu proje dışında.');
  await fs.rm(profile, { recursive: true, force: true });
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(output, { recursive: true });

  const childArgs = sourceMode ? [root, `--remote-debugging-port=${port}`] : [`--remote-debugging-port=${port}`];
  const child = spawn(executable, childArgs, {
    cwd: root,
    env: { ...process.env, NOTES_USER_DATA_DIR: profile, NOTES_QA: '1' },
    stdio: 'ignore',
    windowsHide: true
  });

  let client;
  try {
    client = await connectToPage();
    const { evaluate, send } = client;

    assert(await evaluate("Boolean(document.querySelector('.empty-note-state'))"), 'İlk açılış not alanı boş değil.');
    assert(await evaluate("Boolean(document.querySelector('.task-empty'))"), 'İlk açılış görev alanı boş değil.');
    assert(await evaluate("document.querySelectorAll('.mini-calendar .marked').length === 0"), 'Takvimde sahte işaretli gün var.');
    assert(await evaluate("document.querySelector('.brand-mark').textContent.trim() === '47'"), '47 logosu görünmüyor.');
    assert(await evaluate("Boolean(document.querySelector('#top-date-day').textContent)"), 'Üst tarih alanı doldurulmadı.');
    assert(await evaluate("!document.querySelector('.home-page > .page-header')"), 'Ana ekrandaki eski büyük tarih başlığı kaldırılmadı.');
    assert(await evaluate("!document.querySelector('#new-entry-button') && document.querySelectorAll('#home-new-note').length === 1 && !document.querySelector('.home-note-card [data-quick-note]')"), 'Yeni not düğmesi ana çalışma alanında tek bir konuma alınmadı.');
    assert(await evaluate("!document.body.textContent.includes('Notu aç')"), 'Ana sayfada eski not ön izleme eylemi hâlâ görünüyor.');
    assert(await evaluate("!document.body.textContent.toLocaleLowerCase('tr-TR').includes('ctrl') && !document.querySelector('kbd')"), 'Ctrl kısayol ifadeleri arayüzden kaldırılmadı.');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert(await evaluate("state.notes.length === 0"), 'Ctrl+N kısayolu devre dışı bırakılmadı.');
    const dateType = await evaluate(`(() => { const day=parseFloat(getComputedStyle(document.querySelector('#top-date-day')).fontSize), month=parseFloat(getComputedStyle(document.querySelector('#top-date-month')).fontSize); return {day,month}; })()`);
    assert(dateType.day >= 31 && dateType.month >= 10, 'Üst tarih metinleri büyütülmedi.');
    assert(await evaluate("document.querySelector('[data-sidebar-module=today] svg path').getAttribute('d').includes('m3 11')"), 'Ana sayfa simgesi ev simgesine dönüştürülmedi.');
    const surfaceColors = await evaluate(`['.home-note-card','.home-tasks-card','#calendar-widget'].map(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor)`);
    assert(surfaceColors.every(color => color === 'rgb(2, 3, 4)'), 'İşaretli ana yüzeyler aynı dark piano black renge alınmadı.');

    await evaluate(`(() => {
      const form = document.querySelector('#task-add-form');
      const date = new Date();
      const targetDay = date.getDate() < new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() ? date.getDate() + 1 : date.getDate() - 1;
      const target = new Date(date.getFullYear(), date.getMonth(), targetDay);
      const local = new Date(target.getTime() - target.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      form.elements.title.value = 'QA görevi';
      form.elements.date.value = local;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return targetDay;
    })()`);
    await waitFor(() => evaluate("document.querySelectorAll('.task-row').length === 1"), 'Görev eklenmedi.');
    const taskFlow = await evaluate(`(() => { const list=document.querySelector('.home-tasks-card .task-list').getBoundingClientRect(), row=document.querySelector('.home-tasks-card .task-row').getBoundingClientRect(); const style=getComputedStyle(document.querySelector('.home-tasks-card .task-list')); return {display:style.display,direction:style.flexDirection,justify:style.justifyContent,topGap:Math.round(row.top-list.top),rowHeight:Math.round(row.height)}; })()`);
    assert(taskFlow.display === 'flex' && taskFlow.direction === 'column' && taskFlow.justify === 'flex-start' && taskFlow.topGap <= 2 && taskFlow.rowHeight < 70, 'Görevler Yapılacaklar başlığının altından aşağı doğru sıralanmıyor.');
    assert(await evaluate("document.querySelectorAll('.mini-calendar .marked').length === 1"), 'Görev günü takvimde işaretlenmedi.');
    await evaluate("document.querySelector('.task-check').click()");
    assert(await evaluate("document.querySelector('.task-row').classList.contains('done')"), 'Görev tamamlanamadı.');
    await evaluate("document.querySelector('[data-task-remove]').click()");
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"), 'Görev silme onayı açılmadı.');
    await evaluate("document.querySelector('.confirm-cancel').click()");
    assert(await evaluate("document.querySelectorAll('.task-row').length === 1"), 'Görev silme iptali çalışmadı.');

    const collapsedWidth = await evaluate("document.querySelector('#calendar-widget').getBoundingClientRect().width");
    await evaluate("document.querySelector('#calendar-toggle').click()");
    await waitFor(() => evaluate("document.querySelector('#calendar-widget').classList.contains('expanded')"), 'Takvim büyümedi.');
    const expandedWidth = await evaluate("document.querySelector('#calendar-widget').getBoundingClientRect().width");
    assert(expandedWidth > collapsedWidth * 1.8, 'Takvim büyütme davranışı yetersiz.');
    await evaluate("document.querySelector('#calendar-toggle').click()");
    await waitFor(() => evaluate("!document.querySelector('#calendar-widget').classList.contains('expanded')"), 'Takvim küçülmedi.');
    const homeShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
    await fs.writeFile(path.join(output, 'home.png'), Buffer.from(homeShot.data, 'base64'));
    await evaluate("document.querySelector('#home-new-note').click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-note-title'))"), 'Yeni not ana sayfada açılmadı.');
    await evaluate(`(() => {
      const title = document.querySelector('#home-note-title');
      title.value = 'QA yerel not';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const body = document.querySelector('#home-note-body');
      body.value = 'Kalıcı ve yerel içerik.';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-edit-note')) && !document.querySelector('#home-note-title')"), 'Enter ile kayıt sonrasında düzenleme kapanmadı.');
    assert(await evaluate("Boolean(document.querySelector('.home-page')) && !document.querySelector('.note-document')"), 'Not düzenleme ana sayfadan başka ekrana geçti.');
    assert(await evaluate("Boolean(document.querySelector('#home-delete-note'))"), 'Ana not alanında silme düğmesi yok.');
    assert(await evaluate("document.querySelector('.home-note-title-display').textContent === 'QA yerel not' && document.querySelector('.home-note-body-display').textContent === 'Kalıcı ve yerel içerik.'"), 'Kaydedilen not ana sayfada salt okunur görünmüyor.');
    assert(await evaluate("document.querySelector('.home-category-meta span').textContent === 'KATEGORİ' && !document.querySelector('.home-category-meta').textContent.includes('NOT')"), 'Not türü kaldırılıp lüks kategori etiketi yerleştirilmedi.');
    assert(await evaluate("state.notes.some(note => note.title === 'QA yerel not' && note.bodyText === 'Kalıcı ve yerel içerik.') && document.querySelector('[data-sidebar-module=notes] .count').textContent === '1'"), 'Ana sayfada kaydedilen not Tüm notlar alanına aktarılmadı.');
    const homeEditorLayout = await evaluate(`(() => { const card=document.querySelector('.home-note-card').getBoundingClientRect(), tabs=document.querySelector('.home-note-tabs').getBoundingClientRect(), del=document.querySelector('#home-delete-note').getBoundingClientRect(), body=document.querySelector('.home-note-body-display').getBoundingClientRect(); return {tabsTop:Math.abs(tabs.top-card.top),tabsWidth:Math.abs(tabs.width-card.width),deleteInside:del.right<=card.right&&del.top>=card.top,bodyHeight:body.height}; })()`);
    assert(homeEditorLayout.tabsTop < 2 && homeEditorLayout.tabsWidth < 2, 'Not sekmeleri kartın üst çizgisine oturmadı.');
    assert(homeEditorLayout.deleteInside && homeEditorLayout.bodyHeight > 200, 'Not silme düğümü veya düzenleme alanı kart sınırlarının dışında.');
    await evaluate("document.querySelector('#home-edit-note').click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-note-title'))"), 'Düzenle seçeneği notu yeniden düzenlemeye açmadı.');
    await evaluate("document.querySelector('#home-note-title').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-edit-note'))"), 'Düzenleme ikinci kez kapatılamadı.');
    for(let index = 0; index < 6; index += 1) {
      await evaluate("document.querySelector('#home-new-note').click()");
      await delay(50);
    }
    await waitFor(() => evaluate("document.querySelectorAll('.home-note-tab').length === 5"), 'Not sekmeleri yatay düzende beş açık sekmeyle sınırlandırılmadı.');
    const tabLayout = await evaluate(`(() => { const tabs=[...document.querySelectorAll('.home-note-tab')].slice(0,2).map(tab=>tab.getBoundingClientRect()); return {tops:tabs.map(tab=>Math.round(tab.top)),lefts:tabs.map(tab=>Math.round(tab.left)),height:document.querySelector('.home-note-tabs').getBoundingClientRect().height}; })()`);
    assert(tabLayout.height <= 52 && Math.abs(tabLayout.tops[0]-tabLayout.tops[1]) <= 1 && tabLayout.lefts[1] > tabLayout.lefts[0], 'Not sekmeleri yatay ve yan yana yerleşmedi.');
    await evaluate("document.querySelector('.home-note-tab.active [data-close-home-tab]').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.home-note-tab').length === 4 && Boolean(document.querySelector('.home-note-title-display'))"), 'Yatay not sekmesi kapatılamadı.');
    await evaluate("document.querySelector('[data-note-index]').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.home-note-tab').length === 5 && document.querySelector('.home-note-title-display').textContent === 'Başlıksız not'"), 'Son Notlar kaydı ana sayfadaki yatay sekmelerde açılmadı.');
    await evaluate("document.querySelector('#home-delete-note').click()");
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"), 'Ana sayfa not silme onayı açılmadı.');
    await evaluate("document.querySelector('#confirm-accept').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.home-note-tab').length === 4 && document.querySelector('#trash-button small').textContent === '1'"), 'Ana sayfadaki not silinemedi veya sekme dengesi bozuldu.');
    await evaluate(`(async () => { const note=state.notes.find(item=>item.title==='QA yerel not'); state.notes=[note]; state.trash=[]; state.homeTabs=[note.id]; state.activeHomeNoteId=note.id; state.homeEditingNoteId=null; await saveNow(); renderSidebar(); renderWorkspace(); })()`);
    await evaluate("document.querySelector('[data-sidebar-module=notes]').click()");
    assert(await evaluate("document.querySelectorAll('.note-tile').length === 1"), 'Kaydedilen not listede görünmedi.');
    await evaluate("document.querySelector('.note-tile-menu-button').click()");
    assert(await evaluate("document.querySelector('.note-tile-menu').classList.contains('open')"), 'Not seçenekleri açılmadı.');
    await evaluate("document.querySelector('[data-delete-note]').click()");
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"), 'Not silme onayı açılmadı.');
    await evaluate("document.querySelector('#confirm-accept').click()");
    await waitFor(() => evaluate("document.querySelector('#trash-button small').textContent === '1'"), 'Not çöp kutusuna taşınmadı.');
    await evaluate("document.querySelector('#trash-button').click()");
    assert(await evaluate("Boolean(document.querySelector('#empty-trash-button')) && !document.querySelector('.trash-row')"), 'Çöp kutusu içeriği varsayılan olarak gizlenmedi veya Tümünü sil düğmesi yok.');
    await evaluate("document.querySelector('#toggle-trash-contents').click()");
    await evaluate("document.querySelector('[data-restore-note]').click()");
    await waitFor(() => evaluate("document.querySelector('#trash-button small').textContent === '0'"), 'Not geri yüklenmedi.');
    assert(await evaluate("Boolean(document.querySelector('[data-delete-recent-note]'))"), 'Son Notlar alanında silme kontrolü yok.');
    await evaluate(`(() => { window.prompt=()=> 'QA Kategori'; document.querySelector('#add-folder-button').click(); })()`);
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-delete-folder=\"QA Kategori\"]'))"), 'Kategori silme kontrolü eklenmedi.');
    await evaluate("document.querySelector('[data-delete-folder=\"QA Kategori\"]').click()");
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"), 'Kategori silme onayı açılmadı.');
    await evaluate("document.querySelector('#confirm-accept').click()");
    await waitFor(() => evaluate("!document.querySelector('[data-folder=\"QA Kategori\"]')"), 'Kategori silinemedi.');
    await evaluate(`(() => { state.trash=[{id:'trash-qa',title:'Gizli QA notu',deletedAtLabel:'Az önce'}]; state.activeModule='trash'; state.trashContentsVisible=false; persistSoon(); renderSidebar(); renderWorkspace(); })()`);
    assert(await evaluate("!document.querySelector('.trash-row') && Boolean(document.querySelector('#empty-trash-button'))"), 'Çöp kutusundaki gizli kayıtlar kendiliğinden listelendi.');
    await evaluate("document.querySelector('#empty-trash-button').click()");
    await waitFor(() => evaluate("state.trash.length === 0 && document.querySelector('#trash-button small').textContent === '0'"), 'Çöp kutusu tek tıkla tamamen temizlenmedi.');
    assert(await evaluate("!document.querySelector('#confirm-dialog').open"), 'Tümünü sil işlemi gereksiz ikinci onay istedi.');

    await evaluate("document.querySelector('[data-sidebar-module=canvas]').click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('#canvas-surface'))"), 'Şema alanı açılmadı.');
    assert(await evaluate("Boolean(document.querySelector('#canvas-surface > .canvas-floating-toolbar'))"), 'Şema araçları tuval içine taşınmadı.');
    await evaluate("document.querySelector('#add-canvas-card').click()");
    await evaluate("document.querySelector('#add-canvas-card').click()");
    assert(await evaluate("document.querySelectorAll('.schema-node').length === 2"), 'Şema kartları eklenmedi.');
    assert(await evaluate(`(() => { const n=[...document.querySelectorAll('.schema-node')].map(x=>x.getBoundingClientRect()); return !(n[0].left < n[1].right && n[0].right > n[1].left && n[0].top < n[1].bottom && n[0].bottom > n[1].top); })()`), 'Yeni şema kartları üst üste geldi.');
    const gridBeforeZoom = await evaluate(`(() => { const style=getComputedStyle(document.querySelector('#canvas-surface')); return {size:style.backgroundSize,position:style.backgroundPosition}; })()`);
    const cardWidthBeforeZoom = await evaluate("document.querySelector('.schema-node').getBoundingClientRect().width");
    await evaluate(`(() => { const s=document.querySelector('#canvas-surface'), r=s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:480,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); })()`);
    await waitFor(() => evaluate("Number(document.querySelector('#canvas-zoom-value').textContent.replace('%','')) < 100"), 'Tekerlekle uzaklaştırma çalışmadı.');
    const zoomResult = await evaluate(`(() => { const s=document.querySelector('#canvas-surface'), n=document.querySelector('.schema-node'); return { percent:Number(document.querySelector('#canvas-zoom-value').textContent.replace('%','')), width:n.getBoundingClientRect().width, transform:document.querySelector('#canvas-world').style.transform, surfaceWidth:s.clientWidth }; })()`);
    assert(zoomResult.percent <= 75, 'Şema yeterli ölçüde uzaklaşmadı.');
    assert(zoomResult.width < cardWidthBeforeZoom * .8, 'Kartlar zoom ile küçülmedi.');
    assert(zoomResult.transform.includes('scale('), 'Şema dünyası ölçeklenmedi.');
    const gridAfterZoom = await evaluate(`(() => { const style=getComputedStyle(document.querySelector('#canvas-surface')); return {size:style.backgroundSize,position:style.backgroundPosition}; })()`);
    assert(JSON.stringify(gridAfterZoom) === JSON.stringify(gridBeforeZoom), 'Noktalı şema zemini zoom ile hareket etti veya ölçeklendi.');
    await evaluate("document.querySelector('[data-canvas-tool=card]').click()");
    await evaluate(`(() => { const s=document.querySelector('#canvas-surface'), r=s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.right-36,clientY:r.bottom-74,pointerId:17})); })()`);
    await waitFor(() => evaluate("document.querySelectorAll('.schema-node').length === 3"), 'Uzaklaştırılan alana yeni kart eklenemedi.');
    assert(await evaluate("parseFloat(document.querySelector('.schema-node.selected').style.left) > document.querySelector('#canvas-surface').clientWidth"), 'Uzaklaştırma yeni çalışma alanı açmadı.');
    await evaluate("document.querySelector('.schema-node.selected [data-delete-canvas-node]').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.schema-node').length === 2"), 'Zoom test kartı silinemedi.');
    assert(await evaluate("!document.querySelector('#confirm-dialog').open"), 'Kart silme işlemi gereksiz onay istedi.');
    await delay(350);
    const canvasShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await fs.writeFile(path.join(output, 'canvas.png'), Buffer.from(canvasShot.data, 'base64'));

    await evaluate("document.querySelector('[data-canvas-tool=connect]').click()");
    await evaluate(`(() => { const n=document.querySelectorAll('.schema-node')[0], r=n.getBoundingClientRect(); n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+10,clientY:r.top+10,pointerId:1})); })()`);
    await evaluate(`(() => { const n=document.querySelectorAll('.schema-node')[1], r=n.getBoundingClientRect(); n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+10,clientY:r.top+10,pointerId:2})); })()`);
    await waitFor(() => evaluate("document.querySelectorAll('[data-connection-id]').length === 1"), 'Şema bağlantısı kurulmadı.');
    await waitFor(() => evaluate("document.querySelector('[data-connection-id]').getAttribute('d') !== 'M0 0'"), 'Şema bağlantısı çizilmedi.');
    const pathBefore = await evaluate("document.querySelector('[data-connection-id]').getAttribute('d')");
    assert(pathBefore, 'Şema bağlantı yolu boş.');
    assert(!/NaN|Infinity/.test(pathBefore), 'Şema bağlantı koordinatları geçersiz.');
    const syncBefore = await evaluate(`(() => { const s=document.querySelector('#canvas-surface').getBoundingClientRect(), n=[...document.querySelectorAll('.schema-node')].slice(0,2).map(el=>{const r=el.getBoundingClientRect();return {left:r.left-s.left,right:r.right-s.left,top:r.top-s.top,bottom:r.bottom-s.top}}), p=document.querySelector('[data-connection-id]'), a=p.getPointAtLength(0), b=p.getPointAtLength(p.getTotalLength()), clamp=(v,min,max)=>Math.max(min,Math.min(max,v)), edge=(pt,r)=>Math.min(Math.hypot(pt.x-r.left,pt.y-clamp(pt.y,r.top,r.bottom)),Math.hypot(pt.x-r.right,pt.y-clamp(pt.y,r.top,r.bottom)),Math.hypot(pt.x-clamp(pt.x,r.left,r.right),pt.y-r.top),Math.hypot(pt.x-clamp(pt.x,r.left,r.right),pt.y-r.bottom)); return {start:edge(a,n[0]),end:edge(b,n[1]),stroke:getComputedStyle(p).strokeWidth}; })()`);
    assert(syncBefore.start < 2 && syncBefore.end < 2, 'Zoom sırasında bağlantı uçları kart kenarlarından koptu.');
    const arrowSync = await evaluate(`(() => { const p=document.querySelector('[data-connection-id]'), a=document.querySelector('[data-connection-arrow]'), end=p.getPointAtLength(p.getTotalLength()), tip=a.getPointAtLength(a.getTotalLength()/2); return {distance:Math.hypot(end.x-tip.x,end.y-tip.y),length:a.getTotalLength()}; })()`);
    assert(arrowSync.distance < .5 && arrowSync.length >= 15, 'Ok başı bağlantı ucuyla senkron değil.');
    await evaluate("document.querySelector('[data-connection-style=straight]').click()");
    await waitFor(() => evaluate("document.querySelector('[data-connection-id]').getAttribute('d').includes(' L ')"), 'Doğrusal ok çalışmadı.');
    await evaluate("document.querySelector('[data-connection-style=curve]').click()");
    await waitFor(() => evaluate("document.querySelector('[data-connection-id]').getAttribute('d').includes(' C ')"), 'Esnek ok çalışmadı.');
    await evaluate("document.querySelector('#canvas-history-button').click()");
    await evaluate("document.querySelector('#canvas-undo').click()");
    await waitFor(() => evaluate("document.querySelector('[data-connection-id]').dataset.style === 'straight'"), 'Şema geri alma çalışmadı.');
    await evaluate("document.querySelector('#canvas-redo').click()");
    await waitFor(() => evaluate("document.querySelector('[data-connection-id]').dataset.style === 'curve'"), 'Şema yineleme çalışmadı.');
    await evaluate("document.querySelector('#canvas-history-button').click()");
    await evaluate("document.querySelector('[data-canvas-tool=select]').click()");

    const box = await evaluate(`(() => { const r=document.querySelectorAll('.schema-node')[0].getBoundingClientRect(); return {x:r.left+32,y:r.top+6}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 95, y: box.y + 55, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 95, y: box.y + 55, button: 'left', clickCount: 1 });
    await waitFor(() => evaluate("Boolean(document.querySelector('.schema-node.selected [data-node-title]'))"), 'Kart seçilmedi.');
    const pathAfter = await evaluate("document.querySelector('[data-connection-id]').getAttribute('d')");
    assert(pathAfter !== pathBefore, 'Kart hareketinde bağlantı çizgisi güncellenmedi.');
    const syncAfter = await evaluate(`(() => { const s=document.querySelector('#canvas-surface').getBoundingClientRect(), n=[...document.querySelectorAll('.schema-node')].slice(0,2).map(el=>{const r=el.getBoundingClientRect();return {left:r.left-s.left,right:r.right-s.left,top:r.top-s.top,bottom:r.bottom-s.top}}), p=document.querySelector('[data-connection-id]'), a=p.getPointAtLength(0), b=p.getPointAtLength(p.getTotalLength()), clamp=(v,min,max)=>Math.max(min,Math.min(max,v)), edge=(pt,r)=>Math.min(Math.hypot(pt.x-r.left,pt.y-clamp(pt.y,r.top,r.bottom)),Math.hypot(pt.x-r.right,pt.y-clamp(pt.y,r.top,r.bottom)),Math.hypot(pt.x-clamp(pt.x,r.left,r.right),pt.y-r.top),Math.hypot(pt.x-clamp(pt.x,r.left,r.right),pt.y-r.bottom)); return {start:edge(a,n[0]),end:edge(b,n[1]),stroke:getComputedStyle(p).strokeWidth}; })()`);
    assert(syncAfter.start < 2 && syncAfter.end < 2, 'Sürükleme sırasında bağlantı uçları kartlardan koptu.');
    assert(parseFloat(syncAfter.stroke) >= 1.3, 'Uzaklaştırmada bağlantı çizgisi okunamayacak kadar inceldi.');
    const widthBefore = await evaluate("document.querySelector('.schema-node.selected').getBoundingClientRect().width");
    const resizeBox = await evaluate(`(() => { const r=document.querySelector('.schema-node.selected [data-resize-node]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: resizeBox.x, y: resizeBox.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizeBox.x + 60, y: resizeBox.y + 35, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizeBox.x + 60, y: resizeBox.y + 35, button: 'left', clickCount: 1 });
    assert(await evaluate(`document.querySelector('.schema-node.selected').getBoundingClientRect().width > ${widthBefore + 30}`), 'Kart boyutlandırma çalışmadı.');
    await evaluate(`(() => { const input=document.querySelector('.schema-node.selected [data-node-title]'); input.value='Bağlı kart'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
    assert(await evaluate("[...document.querySelectorAll('[data-node-title]')].some(node => node.value === 'Bağlı kart')"), 'Kart metni kart üzerinde düzenlenmedi.');
    await evaluate(`(() => { const p=document.querySelector('[data-connection-id]'); p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:4})); })()`);
    await waitFor(() => evaluate("Boolean(document.querySelector('#delete-selected-connection'))"), 'Bağlantı seçilemedi.');
    await evaluate("document.querySelector('#delete-selected-connection').click()");
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"), 'Bağlantı silme onayı açılmadı.');
    await evaluate("document.querySelector('#confirm-accept').click()");
    await waitFor(() => evaluate("document.querySelectorAll('[data-connection-id]').length === 0"), 'Bağlantı silinemedi.');

    await evaluate("document.querySelector('[data-canvas-tool=card]').click()");
    await evaluate(`(() => { const s=document.querySelector('#canvas-surface'), r=s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+360,clientY:r.top+180,pointerId:5})); })()`);
    await waitFor(() => evaluate("document.querySelectorAll('.schema-node').length === 3"), 'Kart aracı çalışmadı.');
    await evaluate("document.querySelector('.schema-node.selected [data-delete-canvas-node]').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.schema-node').length === 2"), 'Kart silinemedi.');
    await evaluate("document.querySelector('[data-canvas-tool=text]').click()");
    await evaluate(`(() => { const s=document.querySelector('#canvas-surface'), r=s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+390,clientY:r.top+190,pointerId:6})); })()`);
    await waitFor(() => evaluate("Boolean(document.querySelector('.schema-text-node'))"), 'Metin aracı çalışmadı.');
    await evaluate(`(() => { const input=document.querySelector('.schema-text-node [data-node-text]'); input.value='QA metni'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
    assert(await evaluate("document.querySelector('.schema-text-node [data-node-text]').value === 'QA metni'"), 'Şema metni düzenlenmedi.');
    await evaluate("document.querySelector('.schema-text-node [data-delete-canvas-node]').click()");
    await waitFor(() => evaluate("document.querySelectorAll('.schema-node').length === 2"), 'Şema öğesi silinemedi.');

    await evaluate(`(() => { const input=document.querySelector('#canvas-title-input'); input.value='QA şeması'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#save-schema-project').click(); })()`);
    await waitFor(() => evaluate("state.schemas.length === 1 && state.activeSchemaId === null && document.querySelectorAll('.schema-node').length === 0"), 'Şema kaydedildikten sonra boş yeni şema açılmadı.');
    assert(await evaluate("document.querySelector('[data-sidebar-module=canvas] .count').textContent === '1' && Boolean(document.querySelector('[data-schema-id]')) && Boolean(document.querySelector('[data-delete-schema]'))"), 'Kaydedilen şema sol panelde proje olarak görünmedi.');
    await evaluate("document.querySelector('[data-schema-id]').click()");
    await waitFor(() => evaluate("state.activeSchemaId !== null && document.querySelectorAll('.schema-node').length === 2"), 'Sol paneldeki şema projesi yeniden açılamadı.');

    await evaluate("document.querySelector('[data-sidebar-module=today]').click()");

    await delay(500);
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'notes-data.json'), 'utf8'));
    assert(saved.version === 6, 'Yerel veri sürümü yanlış.');
    assert(saved.notes.length === 1 && saved.notes[0].title === 'QA yerel not', 'Not yerel dosyada saklanmadı.');
    assert(saved.tasks.length === 1 && saved.tasks[0].done === true, 'Görev yerel dosyada saklanmadı.');
    assert(saved.schemas.length === 1 && saved.schemas[0].title === 'QA şeması' && saved.schemas[0].canvas.nodes.length === 2, 'Şema projesi yerel dosyada saklanmadı.');
    assert(saved.schemas[0].canvasView && saved.schemas[0].canvasView.zoom < 1, 'Şema zoom görünümü proje içinde saklanmadı.');
    assert(client.runtimeErrors.length === 0, `Çalışma zamanı hatası: ${client.runtimeErrors.join(' | ')}`);

    process.stdout.write(JSON.stringify({ ok: true, notes: saved.notes.length, tasks: saved.tasks.length, schemas: saved.schemas.length, nodes: saved.schemas[0].canvas.nodes.length, screenshots: output }, null, 2));
  } finally {
    if (client?.socket?.readyState === WebSocket.OPEN) client.socket.close();
    child.kill();
    await delay(250);
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { connectToPage, waitFor, delay, assert };
