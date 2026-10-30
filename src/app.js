const state = {
  activeModule: 'today',
  openedNoteIndex: null,
  homeTabs: [],
  activeHomeNoteId: null,
  homeTabsInitialized: false,
  homeEditingNoteId: null,
  selectedFolder: null,
  searchQuery: '',
  selectedDay: new Date().getDate(),
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  calendarExpanded: false,
  notes: [],
  tasks: [],
  alarms: [],
  alarmHistory: {},
  ringingAlarms: [],
  trash: [],
  sortMode: 'updated',
  canvasMode: 'select',
  connectionStyle: 'curve',
  selectedNodeId: null,
  selectedConnectionId: null,
  connectionStartId: null,
  historyOpen: false,
  schemas: [],
  activeSchemaId: null,
  canvasTitle: 'Yeni şema',
  canvasView: { zoom: 1, panX: 0, panY: 0 },
  canvas: { nodes: [], connections: [] },
  trashContentsVisible: false
};

const iconPaths = {
  today: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
  canvas: '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tasks: '<path d="m4 7 2 2 4-4M12 7h8M4 15l2 2 4-4M12 15h8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M3 4l3-2M18 2l3 2M6 20l-2 2M18 20l2 2"/>',
  inbox: '<path d="M4 5h16l-2 14H6z"/><path d="M4 14h5l1 2h4l1-2h4"/>',
  star: '<path d="m12 3 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9z"/>',
  archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>',
  tag: '<path d="M20 13 13 20 4 11V4h7z"/><circle cx="8.5" cy="8.5" r="1"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};

const folders = [];
const canvasUndo = [];
const canvasRedo = [];

const storage = {
  async load() {
    if (window.notesDesktop) return window.notesDesktop.load();
    try {
      return { ok: true, data: JSON.parse(localStorage.getItem('notes-desktop-data') || 'null') };
    } catch {
      return { ok: false, error: 'Yerel veriler okunamadı.' };
    }
  },
  async save(data) {
    if (window.notesDesktop) return window.notesDesktop.save(data);
    localStorage.setItem('notes-desktop-data', JSON.stringify(data));
    return { ok: true };
  }
};

function snapshot() {
  syncActiveSchema();
  return { version: 6, notes: state.notes, folders, tasks: state.tasks, alarms: state.alarms, trash: state.trash, schemas: state.schemas, activeSchemaId: state.activeSchemaId, canvasTitle: state.canvasTitle, canvas: state.canvas, canvasView: state.canvasView };
}

function persistSoon() {
  clearTimeout(persistSoon.timer);
  persistSoon.timer = setTimeout(async () => {
    const result = await storage.save(snapshot());
    if (!result?.ok) showToast(result?.error || 'Değişiklik kaydedilemedi.');
  }, 220);
}

async function saveNow(message) {
  clearTimeout(persistSoon.timer);
  const result = await storage.save(snapshot());
  if(result?.ok && message) showToast(message);
  if(!result?.ok) showToast(result?.error || 'Değişiklik kaydedilemedi.');
  return result;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetCanvasUi() {
  state.canvasMode = 'select';
  state.selectedNodeId = null;
  state.selectedConnectionId = null;
  state.connectionStartId = null;
  state.historyOpen = false;
  canvasUndo.length = 0;
  canvasRedo.length = 0;
}

function syncActiveSchema() {
  if(!state.activeSchemaId) return;
  const schema = state.schemas.find(item => item.id === state.activeSchemaId);
  if(!schema) return;
  schema.title = state.canvasTitle.trim() || schema.title || 'Adsız şema';
  schema.canvas = cloneData(state.canvas);
  schema.canvasView = { ...state.canvasView };
  schema.updatedAt = new Date().toISOString();
}

function openSchema(schemaId) {
  syncActiveSchema();
  const schema = state.schemas.find(item => item.id === schemaId);
  if(!schema) return;
  state.activeSchemaId = schema.id;
  state.canvasTitle = schema.title;
  state.canvas = cloneData(schema.canvas);
  state.canvasView = { ...schema.canvasView };
  state.activeModule = 'canvas';
  resetCanvasUi();
}

function startBlankSchema() {
  syncActiveSchema();
  state.activeSchemaId = null;
  state.canvasTitle = 'Yeni şema';
  state.canvas = { nodes: [], connections: [] };
  state.canvasView = { zoom: 1, panX: 0, panY: 0 };
  state.activeModule = 'canvas';
  resetCanvasUi();
}

async function saveSchemaProject() {
  const suggestedTitle = state.canvas.nodes.find(node => String(node.title || node.text || '').trim());
  const fallbackTitle = String(suggestedTitle?.title || suggestedTitle?.text || `Şema ${state.schemas.length + 1}`).trim().slice(0, 48);
  const title = state.canvasTitle.trim() && state.canvasTitle.trim() !== 'Yeni şema' ? state.canvasTitle.trim().slice(0, 48) : fallbackTitle;
  const saved = {
    id: state.activeSchemaId || uid('schema'),
    title,
    updatedAt: new Date().toISOString(),
    canvas: cloneData(state.canvas),
    canvasView: { ...state.canvasView }
  };
  const existingIndex = state.schemas.findIndex(item => item.id === saved.id);
  if(existingIndex >= 0) state.schemas.splice(existingIndex, 1, saved);
  else state.schemas.unshift(saved);
  startBlankSchema();
  await saveNow();
  renderSidebar();
  renderWorkspace();
  showToast(`“${title}” kaydedildi. Yeni şema hazır.`);
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,10);
}

function localDateIso(value) {
  const date = new Date(value);
  if(!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,10);
}

function formatTime(value) {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function formatAlarmDate(value) {
  return `${localDateIso(value) === todayIso() ? 'Bugün' : new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' }).format(new Date(value))} ${formatTime(value)}`;
}

function alarmKey(item) { return `${item.source || 'alarm'}:${item.id}:${new Date(item.scheduledAt).toISOString()}`; }

function alarmStatus(item) {
  if(!item.enabled) return 'Alarm kapalı';
  if(state.alarmHistory[alarmKey(item)]) return 'Çaldı';
  return Date.parse(item.scheduledAt) <= Date.now() ? 'Bildirim bekleniyor' : 'Alarm kurulu';
}

function nextAlarm() {
  return [
    ...state.alarms.filter(alarm => alarm.enabled).map(alarm => ({ ...alarm, source: 'alarm' })),
    ...state.tasks.filter(task => !task.done && task.reminderAt).map(task => ({ ...task, source: 'task', scheduledAt: task.reminderAt }))
  ].filter(item => !state.alarmHistory[alarmKey(item)]).sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
}

function refreshAlarmSummary() {
  const button = document.querySelector('#next-alarm');
  if(!button) return;
  const item = nextAlarm();
  button.title = item?.title || 'Yeni alarm ekle';
  button.querySelector('span').textContent = item ? `${formatAlarmDate(item.scheduledAt)} · ${item.title}` : 'Henüz alarm yok';
}

function parseAlarmDate(date, time) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00`);
  if(!Number.isFinite(parsed.getTime()) || localDateIso(parsed) !== date || formatTime(parsed) !== time) return null;
  return parsed;
}

let alarmEditor = null;

function openAlarmDialog({ id, taskId, date } = {}) {
  const alarm = state.alarms.find(item => item.id === id);
  const task = state.tasks.find(item => item.id === taskId);
  if(task?.done) { showToast('Tamamlanan görev için hatırlatma kurulamaz.'); return; }
  alarmEditor = task ? { taskId: task.id } : { id: alarm?.id || null };
  const current = alarm?.scheduledAt || task?.reminderAt;
  const suggested = current ? new Date(current) : new Date(Date.now() + 5 * 60000);
  const form = document.querySelector('#alarm-form');
  form.elements.title.value = alarm?.title || task?.title || '';
  form.elements.title.readOnly = Boolean(task);
  form.elements.date.value = current ? localDateIso(current) : (date || task?.dueDate || localDateIso(suggested));
  form.elements.time.value = formatTime(suggested);
  document.querySelector('#alarm-dialog-title').textContent = task ? 'Görev hatırlatması' : alarm ? 'Alarmı düzenle' : 'Alarm ekle';
  document.querySelector('#alarm-form-error').textContent = '';
  document.querySelector('#alarm-remove').hidden = !(alarm || task?.reminderAt);
  document.querySelector('#alarm-dialog').showModal();
}

function showAlarmCalendar(item) {
  const date = new Date(item.scheduledAt);
  state.calendarYear = date.getFullYear();
  state.calendarMonth = date.getMonth();
  state.selectedDay = date.getDate();
  state.calendarExpanded = true;
  state.activeModule = 'today';
  state.openedNoteIndex = null;
  renderSidebar();
  renderWorkspace();
}

function receiveAlarm(item) {
  state.alarmHistory[item.key] = item.deliveredAt;
  if(!state.ringingAlarms.some(alarm => alarm.key === item.key)) state.ringingAlarms.push(item);
  renderAlarmAlerts();
  refreshAlarmSummary();
  document.querySelectorAll('[data-edit-alarm]').forEach(button => {
    if(button.dataset.editAlarm === item.id && item.source === 'alarm') button.querySelector('small').textContent = 'Çaldı';
  });
}

function renderAlarmAlerts() {
  document.querySelector('#alarm-alerts').innerHTML = state.ringingAlarms.map(item => `<article class="alarm-alert"><span class="overline">${item.source === 'task' ? 'GÖREV HATIRLATMASI' : 'ALARM'}</span><strong>${escapeHtml(item.title)}</strong><time>${formatAlarmDate(item.scheduledAt)}</time><div><button data-alarm-snooze="${escapeHtml(item.key)}">5 dk ertele</button><button data-alarm-view="${escapeHtml(item.key)}">Takvimde gör</button><button data-alarm-dismiss="${escapeHtml(item.key)}">Kapat</button></div></article>`).join('');
}

async function dismissRingingAlarm(key) {
  state.ringingAlarms = state.ringingAlarms.filter(item => item.key !== key);
  await window.notesDesktop?.dismissAlarm(key);
  renderAlarmAlerts();
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.notes}</svg>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function confirmRemoval({ title, message, confirmLabel = 'Sil', kicker = 'SİLME ONAYI' }) {
  const dialog = document.querySelector('#confirm-dialog');
  if(!dialog) return Promise.resolve(false);
  document.querySelector('#confirm-kicker').textContent = kicker;
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-message').textContent = message;
  document.querySelector('#confirm-accept').textContent = confirmLabel;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

function renderSidebar() {
  const nav = [['today','Ana sayfa',''],['notes','Tüm notlar',String(state.notes.length)],['canvas','Şemalar',String(state.schemas.length)]];
  document.querySelector('#workspace-nav').innerHTML = nav.map(row => `
    <button class="nav-row ${state.activeModule === row[0] ? 'active' : ''}" data-sidebar-module="${row[0]}">${icon(row[0])}<span>${row[1]}</span><span class="count">${row[2]}</span></button>
    ${row[0] === 'canvas' ? `<div class="schema-project-list">
      ${state.schemas.map(schema => `<div class="schema-project-shell ${state.activeSchemaId === schema.id ? 'active' : ''}"><button class="schema-project-row" data-schema-id="${schema.id}" title="${escapeHtml(schema.title)}">${icon('folder')}<span>${escapeHtml(schema.title)}</span></button><button class="sidebar-row-delete" data-delete-schema="${schema.id}" aria-label="Şemayı sil" title="Şemayı sil"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></div>`).join('')}
      <button class="schema-project-new" data-new-schema><span>+</span> Yeni şema</button>
    </div>` : ''}
  `).join('');
  document.querySelector('#folder-list').innerHTML = folders.map(folder => `
    <div class="folder-row-shell ${state.selectedFolder === folder ? 'active' : ''}"><button class="folder-row ${state.selectedFolder === folder ? 'active' : ''}" data-folder="${escapeHtml(folder)}"><span class="folder-chevron">${icon('chevron')}</span>${icon('folder')}<span>${escapeHtml(folder)}</span><span class="count">${state.notes.filter(note => note.folder === folder).length}</span></button><button class="sidebar-row-delete" data-delete-folder="${escapeHtml(folder)}" aria-label="Kategoriyi sil" title="Kategoriyi sil"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></div>
  `).join('');
  document.querySelector('#recent-list').innerHTML = state.notes.map((note,index) => ({note,index})).filter(item => !item.note.folder).map(({note,index}) => `
    <div class="recent-item-shell ${state.activeModule === 'today' && state.activeHomeNoteId === note.id ? 'active' : ''}"><button class="recent-item ${state.activeModule === 'today' && state.activeHomeNoteId === note.id ? 'active' : ''}" data-note-index="${index}" title="${escapeHtml(note.title)}"><span>${escapeHtml(note.title)}</span><small>${escapeHtml(note.time)}</small></button><button class="sidebar-row-delete" data-delete-recent-note="${index}" aria-label="Notu sil" title="Notu sil"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></div>
  `).join('');
  const trashCount = document.querySelector('.sidebar-trash-button small');
  if(trashCount) trashCount.textContent = String(state.trash.length);
  document.querySelector('#trash-button')?.classList.toggle('active', state.activeModule === 'trash');

  document.querySelectorAll('[data-sidebar-module]').forEach(button => button.addEventListener('click', () => {
    state.activeModule = button.dataset.sidebarModule;
    state.selectedFolder = null;
    state.searchQuery = '';
    const search = document.querySelector('#global-search-input');
    if(search) search.value = '';
    if(state.activeModule !== 'notes') state.openedNoteIndex = null;
    if(state.activeModule === 'notes') state.openedNoteIndex = null;
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelectorAll('[data-note-index]').forEach(button => button.addEventListener('click', () => {
    const note = state.notes[Number(button.dataset.noteIndex)];
    if(!note) return;
    openHomeNote(note.id);
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelectorAll('[data-folder]').forEach(button => button.addEventListener('click', () => {
    state.activeModule = 'notes';
    state.selectedFolder = button.dataset.folder;
    state.openedNoteIndex = null;
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelectorAll('[data-delete-folder]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    const folder = button.dataset.deleteFolder;
    const noteCount = state.notes.filter(note => note.folder === folder).length;
    const approved = await confirmRemoval({
      title: 'Kategoriyi sil',
      message: noteCount ? `“${folder}” kategorisi silinecek. İçindeki ${noteCount} not Kategorisiz alanına taşınacak.` : `“${folder}” kategorisi silinecek.`,
      confirmLabel: 'Kategoriyi sil'
    });
    if(!approved) return;
    state.notes.forEach(note => { if(note.folder === folder) note.folder = null; });
    const folderIndex = folders.indexOf(folder);
    if(folderIndex >= 0) folders.splice(folderIndex, 1);
    if(state.selectedFolder === folder) state.selectedFolder = null;
    persistSoon();
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelectorAll('[data-delete-recent-note]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    deleteNote(Number(button.dataset.deleteRecentNote));
  }));
  document.querySelectorAll('[data-schema-id]').forEach(button => button.addEventListener('click', () => {
    openSchema(button.dataset.schemaId);
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelector('[data-new-schema]')?.addEventListener('click', () => {
    startBlankSchema();
    persistSoon();
    renderSidebar();
    renderWorkspace();
  });
  document.querySelectorAll('[data-delete-schema]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    const schema = state.schemas.find(item => item.id === button.dataset.deleteSchema);
    if(!schema) return;
    const approved = await confirmRemoval({ title: 'Şemayı sil', message: `“${schema.title}” kalıcı olarak silinecek.`, confirmLabel: 'Şemayı sil' });
    if(!approved) return;
    state.schemas = state.schemas.filter(item => item.id !== schema.id);
    if(state.activeSchemaId === schema.id) startBlankSchema();
    persistSoon();
    renderSidebar();
    renderWorkspace();
  }));
}

function currentDateLabel() {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date()).toLocaleUpperCase('tr-TR');
}

function renderTopDate() {
  const now = new Date();
  const day = document.querySelector('#top-date-day');
  const month = document.querySelector('#top-date-month');
  const weekday = document.querySelector('#top-date-weekday');
  if(day) day.textContent = String(now.getDate()).padStart(2, '0');
  if(month) month.textContent = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(now).toLocaleUpperCase('tr-TR');
  if(weekday) weekday.textContent = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(now).toLocaleUpperCase('tr-TR');
  const clock = document.querySelector('#live-clock');
  if(clock) {
    clock.textContent = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
    clock.dateTime = now.toISOString();
  }
}

function ensureHomeNoteState() {
  const noteIds = new Set(state.notes.map(note => note.id));
  state.homeTabs = state.homeTabs.filter(id => noteIds.has(id)).slice(-5);
  if(!state.homeTabsInitialized) {
    const latest = [...state.notes].sort((a,b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
    if(latest) state.homeTabs.push(latest.id);
    state.activeHomeNoteId = latest?.id || null;
    state.homeTabsInitialized = true;
  }
  if(state.activeHomeNoteId && !noteIds.has(state.activeHomeNoteId)) state.activeHomeNoteId = null;
  if(state.activeHomeNoteId && !state.homeTabs.includes(state.activeHomeNoteId)) state.activeHomeNoteId = state.homeTabs.at(-1) || null;
  if(state.homeEditingNoteId && (!noteIds.has(state.homeEditingNoteId) || state.homeEditingNoteId !== state.activeHomeNoteId)) state.homeEditingNoteId = null;
}

function openHomeNote(noteId, { edit = false } = {}) {
  if(!state.notes.some(note => note.id === noteId)) return;
  state.homeTabsInitialized = true;
  if(!state.homeTabs.includes(noteId)) state.homeTabs.push(noteId);
  state.homeTabs = state.homeTabs.slice(-5);
  state.activeHomeNoteId = noteId;
  state.homeEditingNoteId = edit ? noteId : null;
  state.activeModule = 'today';
  state.openedNoteIndex = null;
  state.searchQuery = '';
  const search = document.querySelector('#global-search-input');
  if(search) search.value = '';
}

function closeHomeNoteTab(noteId) {
  const closingIndex = state.homeTabs.indexOf(noteId);
  if(closingIndex < 0) return;
  state.homeTabs.splice(closingIndex, 1);
  if(state.homeEditingNoteId === noteId) state.homeEditingNoteId = null;
  if(state.activeHomeNoteId === noteId) {
    state.activeHomeNoteId = state.homeTabs[Math.min(closingIndex, state.homeTabs.length - 1)] || null;
  }
  renderSidebar();
  renderWorkspace();
}

function todayTemplate() {
  ensureHomeNoteState();
  const activeNote = state.notes.find(note => note.id === state.activeHomeNoteId) || null;
  const tabs = state.homeTabs.map(noteId => state.notes.find(note => note.id === noteId)).filter(Boolean);
  const isEditing = Boolean(activeNote && state.homeEditingNoteId === activeNote.id);
  return `<div class="workspace-scroll"><div class="page home-page">
    <div class="today-grid">
      <article class="editor-card home-note-card">
        <header class="home-note-tabs">
          <div class="home-tab-list">${tabs.map(note => `<div class="home-note-tab ${activeNote?.id === note.id ? 'active' : ''}" data-home-tab-shell="${note.id}"><button class="home-tab-select" data-home-tab="${note.id}" title="${escapeHtml(note.title)}"><span data-home-tab-label="${note.id}">${escapeHtml(note.title)}</span></button><button class="home-tab-close" data-close-home-tab="${note.id}" aria-label="Sekmeyi kapat">×</button></div>`).join('')}</div>
          <button class="home-new-note" id="home-new-note" title="Yeni not"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Yeni not</span></button>
        </header>
        ${activeNote ? `<section class="home-note-editor" data-home-note-id="${activeNote.id}">
          <div class="home-note-toolbar">
            ${isEditing
              ? `<label class="home-category-meta"><span>KATEGORİ</span><select id="home-note-folder" aria-label="Not kategorisi"><option value="">Kategorisiz</option>${folders.map(folder => `<option value="${escapeHtml(folder)}" ${activeNote.folder === folder ? 'selected' : ''}>${escapeHtml(folder)}</option>`).join('')}</select></label>`
              : `<div class="home-category-meta"><span>KATEGORİ</span><strong>${escapeHtml(activeNote.folder || 'Kategorisiz')}</strong></div>`}
            <div class="home-note-actions">${isEditing ? '' : '<button class="home-note-edit" id="home-edit-note">Düzenle</button>'}<button class="home-note-delete" id="home-delete-note" aria-label="Notu sil" title="Notu çöp kutusuna taşı"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button></div>
          </div>
          ${isEditing
            ? `<input class="home-note-title-input" id="home-note-title" value="${escapeHtml(activeNote.title)}" aria-label="Not başlığı" placeholder="Not başlığı" /><textarea class="home-note-body-input" id="home-note-body" aria-label="Not içeriği" placeholder="Yazmaya başlayın…">${escapeHtml(activeNote.bodyText || '')}</textarea>`
            : `<h2 class="home-note-title-display">${escapeHtml(activeNote.title)}</h2><div class="home-note-body-display">${escapeHtml(activeNote.bodyText || 'Bu notun içeriği boş.')}</div>`}
          <footer class="editor-footer"><span>${isEditing ? 'ENTER · TAMAMLA &nbsp; / &nbsp; SHIFT + ENTER · YENİ SATIR' : escapeHtml(activeNote.time || '')}</span><span>BU CİHAZDA</span></footer>
        </section>`
        : `<div class="empty-note-state"><span class="overline">NOTLAR</span><h3>Çalışma yüzeyi hazır</h3><p>Üstteki Yeni not düğmesiyle yeni bir sekme açın veya Son Notlar bölümünden seçim yapın.</p></div>`}
      </article>
      <aside class="home-right-column">
        <section class="panel-card home-tasks-card">
          <div class="panel-title"><div><span class="overline">GÖREVLER</span><h3>Yapılacaklar</h3></div><span id="open-task-count">${state.tasks.filter(task => !task.done).length} açık</span></div>
          <div class="task-list">${state.tasks.length ? taskRows(state.tasks) : '<div class="task-empty">Henüz görev yok.</div>'}</div>
          <form class="task-add-form" id="task-add-form">
            <input name="title" placeholder="Yeni görev…" autocomplete="off" required />
            <button type="submit" aria-label="Görev ekle">+</button>
            <input name="date" type="date" value="${todayIso()}" aria-label="Görev tarihi" required />
            <input name="time" type="time" aria-label="Hatırlatma saati (isteğe bağlı)" title="Hatırlatma saati (isteğe bağlı)" />
          </form>
        </section>
        ${homeCalendarWidget()}
      </aside>
    </div>
  </div></div>`;
}

function taskRows(tasks) {
  return tasks.map((task,index) => `<div class="task-row ${task.done?'done':''}" data-task-row="${index}"><button class="task-check" data-task-index="${index}" aria-label="Görevi tamamla" aria-pressed="${task.done}"></button><span title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span><button class="task-time task-reminder ${task.reminderAt?'has-reminder':''}" data-task-alarm="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)} için hatırlatma düzenle">${task.dueDate === todayIso() ? 'Bugün' : escapeHtml(task.dueDate || '')}${task.reminderAt ? `<small>${icon('alarm')}${formatTime(task.reminderAt)}</small>` : ''}</button><button class="task-remove" data-task-remove="${index}" aria-label="Görevi sil"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button></div>`).join('');
}

function calendarCells() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const first = calendarDate(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = calendarDate(year, month, index - mondayOffset + 1);
    return { day: date.getDate(), outside: date.getMonth() !== month };
  });
}

function isoForCurrentMonthDay(day) {
  const date = calendarDate(state.calendarYear, state.calendarMonth, day);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,10);
}

function tasksForDay(day) {
  const iso = isoForCurrentMonthDay(day);
  return state.tasks.filter(task => task.dueDate === iso);
}

function compactCalendar() {
  const days = ['P','S','Ç','P','C','C','P'];
  return `<div class="mini-calendar">${days.map(d=>`<span class="dow">${d}</span>`).join('')}${calendarCells().map(cell=>`<button class="${isoForCurrentMonthDay(cell.day)===todayIso()&&!cell.outside?'today':''} ${dayHasEntries(cell.day)&&!cell.outside?'marked':''} ${cell.outside?'muted-day':''}" data-mini-day="${cell.day}" aria-label="${isoForCurrentMonthDay(cell.day)}" ${cell.outside?'disabled':''}>${cell.day}</button>`).join('')}</div>`;
}

function alarmsForDay(day) {
  const iso = isoForCurrentMonthDay(day);
  return state.alarms.filter(alarm => localDateIso(alarm.scheduledAt) === iso);
}

function dayHasEntries(day) { return tasksForDay(day).length > 0 || alarmsForDay(day).length > 0; }

function expandedCalendarDays() {
  return calendarCells().map(cell => {
    const hasEvent = dayHasEntries(cell.day) && !cell.outside;
    return `<button class="home-calendar-day ${cell.outside?'outside':''} ${cell.day===state.selectedDay&&!cell.outside?'selected':''}" data-home-day="${cell.day}" ${cell.outside?'disabled':''}><span>${cell.day}</span>${hasEvent?'<i></i>':''}</button>`;
  }).join('');
}

function calendarDate(year, month, day = 1) {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function calendarMonthTitle() {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(calendarDate(state.calendarYear, state.calendarMonth)).toLocaleUpperCase('tr-TR');
}

function calendarSelectedLabel() {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', weekday: 'long' }).format(calendarDate(state.calendarYear, state.calendarMonth, state.selectedDay)).toLocaleUpperCase('tr-TR');
}

function calendarDayOptions() {
  const last = calendarDate(state.calendarYear, state.calendarMonth + 1, 0).getDate();
  return Array.from({ length: last }, (_, index) => `<option value="${index + 1}" ${index + 1 === state.selectedDay ? 'selected' : ''}>${index + 1}</option>`).join('');
}

function calendarAgenda() {
  const agenda = [
    ...tasksForDay(state.selectedDay).map(task => ({ ...task, source: 'task', scheduledAt: task.reminderAt })),
    ...alarmsForDay(state.selectedDay).map(alarm => ({ ...alarm, source: 'alarm' }))
  ].sort((a,b) => (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0));
  return agenda.length ? agenda.map(item => `<div class="agenda-entry ${item.done?'done':''}"><time>${item.scheduledAt ? formatTime(item.scheduledAt) : '•'}</time><button class="agenda-entry-title" ${item.source === 'alarm' ? `data-edit-alarm="${escapeHtml(item.id)}"` : `data-task-alarm="${escapeHtml(item.id)}"`}>${escapeHtml(item.title)}<small>${item.source === 'alarm' ? alarmStatus(item) : (item.done ? 'Tamamlandı' : item.scheduledAt ? 'Görev hatırlatması' : 'Görev')}</small></button>${item.source === 'alarm' ? `<button class="alarm-toggle" data-toggle-alarm="${escapeHtml(item.id)}" aria-label="${item.enabled?'Alarmı kapat':'Alarmı aç'}" aria-pressed="${item.enabled}">${item.enabled?'Açık':'Kapalı'}</button>` : ''}</div>`).join('') : '<p>Bu gün için kayıt yok.</p>';
}

function homeCalendarWidget() {
  const upcoming = nextAlarm();
  return `<section class="calendar-widget ${state.calendarExpanded?'expanded':''}" id="calendar-widget">
    <header class="calendar-widget-head">
      <button class="calendar-date-trigger" id="calendar-date-trigger" popovertarget="calendar-date-picker" aria-label="Gün, ay ve yıl seç" aria-expanded="false"><span class="overline">TAKVİM</span><span class="calendar-date-heading"><strong id="calendar-month-title">${calendarMonthTitle()}</strong><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></button>
      <div class="calendar-date-picker" id="calendar-date-picker" popover="auto" aria-label="Tarih seçimi">
        <form id="calendar-date-form"><span class="overline">TARİH SEÇ</span><div class="calendar-date-fields"><label>Gün<select name="day" aria-label="Gün">${calendarDayOptions()}</select></label><label>Ay<select name="month" aria-label="Ay">${Array.from({ length: 12 }, (_, month) => `<option value="${month}" ${month === state.calendarMonth ? 'selected' : ''}>${new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(calendarDate(2026, month))}</option>`).join('')}</select></label><label>Yıl<input name="year" type="number" min="1" max="9999" step="1" value="${state.calendarYear}" aria-label="Yıl" required /></label></div><button class="calendar-date-done" type="submit">Tamam</button></form>
      </div>
      <div class="calendar-head-actions"><button class="calendar-toggle" id="calendar-toggle" aria-expanded="${state.calendarExpanded}" aria-label="Takvimi ${state.calendarExpanded?'küçült':'büyüt'}">
        <svg viewBox="0 0 24 24"><path d="${state.calendarExpanded?'M9 3v6H3M15 21v-6h6':'M9 3H3v6M15 21h6v-6'}"/><path d="${state.calendarExpanded?'m3 9 6-6M21 15l-6 6':'m3 9 6-6M21 15l-6 6'}"/></svg>
      </button></div>
    </header>
    <div class="calendar-mini-view">${compactCalendar()}<div class="calendar-alarm-summary"><button id="next-alarm" title="${escapeHtml(upcoming?.title || 'Yeni alarm ekle')}">${icon('alarm')}<span>${upcoming ? `${formatAlarmDate(upcoming.scheduledAt)} · ${escapeHtml(upcoming.title)}` : 'Henüz alarm yok'}</span></button><button data-add-alarm aria-label="Alarm ekle">+</button></div></div>
    <div class="calendar-expanded-view">
      <div class="calendar-month-panel">
        <div class="home-calendar-weekdays">${['PZT','SAL','ÇAR','PER','CUM','CMT','PAZ'].map(d=>`<span>${d}</span>`).join('')}</div>
        <div class="home-calendar-days">${expandedCalendarDays()}</div>
      </div>
      <aside class="calendar-day-panel">
        <span class="big-date" id="home-selected-date">${String(state.selectedDay).padStart(2,'0')}</span>
        <div class="month-label" id="home-selected-label">${calendarSelectedLabel()}</div>
        <h4>Günün planı</h4>
        <div class="calendar-agenda" id="calendar-agenda">${calendarAgenda()}</div>
        <form class="calendar-add-form" id="calendar-add-form"><input name="title" placeholder="Bu güne görev ekle…" required /><input name="time" type="time" aria-label="Görev hatırlatma saati (isteğe bağlı)" /><button type="submit">Ekle</button></form>
        <button class="calendar-add-alarm" data-add-alarm>${icon('alarm')} Alarm ekle</button>
      </aside>
    </div>
  </section>`;
}

function notesTemplate() {
  if(state.openedNoteIndex !== null) return noteDocumentTemplate(state.notes[state.openedNoteIndex]);
  const query = state.searchQuery.trim().toLocaleLowerCase('tr-TR');
  const visibleNotes = state.notes.map((note,index) => ({ note,index })).filter(item => {
    if(state.selectedFolder && item.note.folder !== state.selectedFolder) return false;
    if(!query) return true;
    return `${item.note.title} ${item.note.excerpt} ${item.note.bodyText || item.note.body?.join(' ') || ''}`.toLocaleLowerCase('tr-TR').includes(query);
  }).sort((a,b) => state.sortMode === 'title'
    ? a.note.title.localeCompare(b.note.title, 'tr')
    : new Date(b.note.updatedAt || 0) - new Date(a.note.updatedAt || 0));
  const heading = query ? 'Arama sonuçları' : state.selectedFolder || 'Tüm notlar';
  return `<div class="workspace-scroll"><div class="page"><header class="page-header"><div><span class="overline">KÜTÜPHANE</span><h2>${escapeHtml(heading)}</h2><div class="page-subtitle">${visibleNotes.length} kayıt · ${folders.length} kategori</div></div><div class="header-actions"><button class="ghost-button" id="sort-notes-button">Sırala: ${state.sortMode === 'title' ? 'Başlık' : 'Son düzenlenen'}</button></div></header>
    ${visibleNotes.length ? `<div class="notes-layout">${visibleNotes.map(({note,index})=>`<article class="note-tile" data-open-note="${index}"><span class="note-kind">KATEGORİ · ${escapeHtml(note.folder || 'Kategorisiz')}</span><button class="note-tile-menu-button" data-note-menu-index="${index}" aria-label="Not seçenekleri">•••</button><h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.excerpt)}</p><footer><span>${escapeHtml(note.time)}</span></footer><div class="note-tile-menu" data-note-tile-menu="${index}"><button data-duplicate-note="${index}">Çoğalt</button><button class="danger" data-delete-note="${index}">Sil</button></div></article>`).join('')}</div>`
    : `<div class="library-empty"><span class="overline">NOTLAR</span><h3>${query ? 'Eşleşen not yok' : 'Kütüphane boş'}</h3><p>${query ? 'Arama ifadenizi değiştirin.' : 'İlk notunuzu oluşturun; kayıtlar yalnızca bu cihazda tutulur.'}</p>${query ? '' : '<button class="solid-button" data-quick-note>+ İlk notu oluştur</button>'}</div>`}
  </div></div>`;
}

function noteDocumentTemplate(note) {
  const bodyText = note.bodyText || note.body?.join('\n\n') || '';
  const bodyParagraphs = bodyText.split(/\n\s*\n/).filter(Boolean);
  return `<div class="workspace-scroll note-document-scroll"><article class="note-document">
    <header class="note-document-topbar">
      <button id="close-note-button" class="document-back" aria-label="Tüm notlara dön">${icon('chevron')}<span>Tüm notlar</span></button>
      <div class="document-actions"><span>${escapeHtml(note.time || '')}</span><button class="note-save-button" id="save-note-button">Kaydet</button><button class="note-more-button" id="note-menu-button" aria-label="Not seçenekleri">•••</button><div class="note-document-menu" id="note-document-menu"><button id="duplicate-current-note">Çoğalt</button><button class="danger" id="delete-current-note">Notu sil</button></div></div>
    </header>
    <div class="note-document-inner">
      <div class="document-kicker"><span>KATEGORİ</span><select id="note-folder-select" aria-label="Not kategorisi"><option value="">Kategorisiz</option>${folders.map(folder => `<option value="${escapeHtml(folder)}" ${note.folder === folder ? 'selected' : ''}>${escapeHtml(folder)}</option>`).join('')}</select></div>
      <input class="document-title" value="${escapeHtml(note.title)}" aria-label="Not başlığı" />
      <div class="document-body" contenteditable="true" data-note-body data-placeholder="Yazmaya başlayın…" aria-label="Not içeriği">${bodyParagraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>
      <footer class="document-footer"><span>${bodyText.trim().split(/\s+/).filter(Boolean).length} kelime</span><span>Bu cihazda</span></footer>
    </div>
  </article></div>`;
}

function trashTemplate() {
  return `<div class="workspace-scroll"><div class="page"><header class="page-header"><div><span class="overline">GERİ DÖNÜŞÜM</span><h2>Çöp kutusu</h2><div class="page-subtitle">${state.trash.length} silinmiş not</div></div>${state.trash.length ? '<div class="header-actions"><button class="trash-empty-all" id="empty-trash-button">Tümünü sil</button></div>' : ''}</header>
    ${state.trash.length ? `<section class="trash-vault"><div><span class="overline">GİZLİ İÇERİK</span><h3>${state.trash.length} kayıt çöp kutusunda</h3><p>Silinen notların başlık ve içerikleri varsayılan olarak gösterilmez.</p></div><button class="ghost-button" id="toggle-trash-contents">${state.trashContentsVisible ? 'İçeriği gizle' : 'İçeriği göster'}</button></section>${state.trashContentsVisible ? `<div class="trash-list">${state.trash.map((note,index) => `<article class="trash-row"><div><strong>${escapeHtml(note.title)}</strong><span>${escapeHtml(note.deletedAtLabel || '')}</span></div><div><button data-restore-note="${index}">Geri yükle</button><button class="danger" data-purge-note="${index}">Kalıcı sil</button></div></article>`).join('')}</div>` : ''}`
    : '<div class="library-empty"><span class="overline">ÇÖP KUTUSU</span><h3>Çöp kutusu boş</h3><p>Silinen notlar burada görünür.</p></div>'}
  </div></div>`;
}

function canvasTemplate() {
  const selectedConnection = state.canvas.connections.find(connection => connection.id === state.selectedConnectionId);
  const modeNames = { select: 'Seç ve taşı', card: 'Kart ekle', text: 'Metin ekle', connect: 'Bağlantı kur' };
  const zoom = Math.max(.45, Math.min(1.6, Number(state.canvasView?.zoom) || 1));
  const panX = Number(state.canvasView?.panX) || 0;
  const panY = Number(state.canvasView?.panY) || 0;
  const nodes = state.canvas.nodes.map(node => {
    const selected = node.id === state.selectedNodeId ? 'selected' : '';
    const connecting = node.id === state.connectionStartId ? 'connecting-source' : '';
    const width = Number(node.width) || (node.type === 'text' ? 220 : 240);
    const height = Number(node.height) || (node.type === 'text' ? 112 : 168);
    const deleteButton = `<button class="node-delete-button" data-delete-canvas-node="${node.id}" aria-label="Öğeyi sil"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>`;
    const resizeHandle = `<button class="node-resize-handle" data-resize-node="${node.id}" aria-label="Kartı yeniden boyutlandır" title="Yeniden boyutlandır"><i></i></button>`;
    if(node.type === 'text') {
      return `<article class="schema-node schema-text-node ${selected} ${connecting}" data-node-id="${node.id}" style="left:${node.x}px;top:${node.y}px;width:${width}px;height:${height}px"><header class="node-drag-handle"><span>METİN</span>${deleteButton}</header><textarea class="node-inline-text" data-node-text="${node.id}" aria-label="Şema metni" spellcheck="true">${escapeHtml(node.text || '')}</textarea><footer><span>Enter ile uygula</span></footer>${resizeHandle}<i class="node-port top"></i><i class="node-port right"></i><i class="node-port bottom"></i><i class="node-port left"></i></article>`;
    }
    return `<article class="schema-node ${selected} ${connecting}" data-node-id="${node.id}" style="left:${node.x}px;top:${node.y}px;width:${width}px;height:${height}px"><header class="node-drag-handle"><span>KART</span>${deleteButton}</header><input class="node-inline-title" data-node-title="${node.id}" value="${escapeHtml(node.title || '')}" placeholder="Kart başlığı" aria-label="Kart başlığı" /><textarea class="node-inline-body" data-node-body="${node.id}" placeholder="Açıklama" aria-label="Kart açıklaması" spellcheck="true">${escapeHtml(node.body || '')}</textarea><footer><span>${state.canvas.connections.filter(item => item.from === node.id || item.to === node.id).length} bağlantı</span><span>Enter ile uygula</span></footer>${resizeHandle}<i class="node-port top"></i><i class="node-port right"></i><i class="node-port bottom"></i><i class="node-port left"></i></article>`;
  }).join('');
  const paths = state.canvas.connections.map(connection => {
    const style = connection.style === 'straight' ? 'straight' : 'curve';
    const selected = connection.id === state.selectedConnectionId ? 'selected' : '';
    return `<path class="schema-branch ${style} ${selected}" data-connection-id="${connection.id}" data-from="${connection.from}" data-to="${connection.to}" data-style="${style}" d="M0 0"/><path class="schema-arrowhead ${style} ${selected}" data-connection-arrow="${connection.id}" d="M0 0"/>`;
  }).join('');
  const connectionBar = selectedConnection ? `<div class="connection-context-bar"><span>BAĞLANTI</span><button class="${selectedConnection.style !== 'straight' ? 'active' : ''}" data-connection-style="curve">Esnek ok</button><button class="${selectedConnection.style === 'straight' ? 'active' : ''}" data-connection-style="straight">Doğrusal ok</button><button class="danger" id="delete-selected-connection"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>Sil</button></div>` : '';
  return `<div class="canvas-page">
    <div class="canvas-surface refined-canvas" id="canvas-surface">
      <label class="canvas-breadcrumb canvas-overlay-title"><span>Şemalar</span><b>/</b><input id="canvas-title-input" value="${escapeHtml(state.canvasTitle)}" aria-label="Şema adı" maxlength="48" /></label>
      <div class="canvas-floating-toolbar" role="toolbar" aria-label="Şema araçları">
        <button class="tool-button ${state.canvasMode === 'select' ? 'active' : ''}" data-canvas-tool="select" title="Seç ve taşı"><svg viewBox="0 0 24 24"><path d="m5 3 6.5 16 2.1-6.1L20 10z"/></svg><span>Seç</span></button>
        <button class="tool-button ${state.canvasMode === 'card' ? 'active' : ''}" data-canvas-tool="card" title="Kart ekle"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg><span>Kart</span></button>
        <button class="tool-button text-tool ${state.canvasMode === 'text' ? 'active' : ''}" data-canvas-tool="text" title="Metin ekle"><b>T</b><span>Metin</span></button>
        <button class="tool-button ${state.canvasMode === 'connect' ? 'active' : ''}" data-canvas-tool="connect" title="Bağlantı kur"><svg viewBox="0 0 24 24"><path d="M5 17 17 5M11 5h6v6"/></svg><span>Bağlantı</span></button>
        <i class="tool-divider"></i>
        <button class="tool-button connection-tool ${state.connectionStyle === 'curve' ? 'active' : ''}" data-default-connection-style="curve" title="Esnek ok"><svg viewBox="0 0 24 24"><path d="M4 17c4-11 11-11 16-5"/><path d="m16 8 4 4-5 2"/></svg><span>Esnek</span></button>
        <button class="tool-button connection-tool ${state.connectionStyle === 'straight' ? 'active' : ''}" data-default-connection-style="straight" title="Doğrusal ok"><svg viewBox="0 0 24 24"><path d="M4 18 19 6"/><path d="m14 5 5 1-1 5"/></svg><span>Doğrusal</span></button>
      </div>
      <div class="canvas-floating-actions"><button class="ghost-button" id="canvas-history-button">Geçmiş</button><button class="ghost-button canvas-save-button" id="save-schema-project">Şemayı kaydet</button><button class="solid-button" id="add-canvas-card">+ Kart</button></div>
      <div class="canvas-caption"><span>${modeNames[state.canvasMode]}</span><strong>${state.canvasMode === 'connect' && state.connectionStartId ? 'Hedef kartı seçin · Esc ile iptal' : 'Kartı başlığından taşıyın · Köşesinden boyutlandırın'}</strong></div>
      <svg class="canvas-lines" id="canvas-lines">${paths}</svg>
      <div class="canvas-world" id="canvas-world" style="transform:translate3d(${panX}px,${panY}px,0) scale(${zoom})">${nodes}</div>
      ${!state.canvas.nodes.length ? '<div class="canvas-empty-state"><h3>Boş şema</h3><p>İlk kartı ekleyin; içeriği doğrudan kart üzerinde düzenleyin ve araç paletinden bağlantı kurun.</p><button class="solid-button" id="empty-add-card">+ İlk kartı ekle</button></div>' : ''}
      ${connectionBar}
      ${state.historyOpen ? `<div class="canvas-history-panel"><strong>Şema geçmişi</strong><button id="canvas-undo" ${canvasUndo.length ? '' : 'disabled'}>Geri al</button><button id="canvas-redo" ${canvasRedo.length ? '' : 'disabled'}>Yinele</button></div>` : ''}
      <div class="canvas-statusbar"><span>${state.canvas.nodes.length} öğe · ${state.canvas.connections.length} bağlantı</span><div class="canvas-zoom-controls" aria-label="Şema yakınlaştırma"><button id="canvas-zoom-out" aria-label="Uzaklaştır" title="Uzaklaştır">−</button><button id="canvas-zoom-reset" title="Yüzde 100'e dön"><b id="canvas-zoom-value">${Math.round(zoom * 100)}%</b></button><button id="canvas-zoom-in" aria-label="Yakınlaştır" title="Yakınlaştır">+</button></div><small class="canvas-zoom-hint">Tekerlek ile yakınlaştır</small></div>
    </div>
  </div>`;
}

const templates = { today: todayTemplate, notes: notesTemplate, canvas: canvasTemplate, trash: trashTemplate };

function renderWorkspace() {
  // Calendar and alarm actions must preserve text currently being edited.
  const title = document.querySelector('#home-note-title');
  const draft = title ? {
    id: title.closest('[data-home-note-id]').dataset.homeNoteId,
    title: title.value,
    body: document.querySelector('#home-note-body').value,
    folder: document.querySelector('#home-note-folder').value
  } : null;
  document.querySelector('#workspace').innerHTML = templates[state.activeModule]();
  if(draft && state.homeEditingNoteId === draft.id && document.querySelector('#home-note-title')) {
    document.querySelector('#home-note-title').value = draft.title;
    document.querySelector('#home-note-body').value = draft.body;
    document.querySelector('#home-note-folder').value = draft.folder;
    const label = document.querySelector(`[data-home-tab-label="${draft.id}"]`);
    if(label) label.textContent = draft.title.trim() || 'Başlıksız not';
  }
  bindWorkspaceEvents();
}

function createNewNote() {
  const now = new Date();
  const note = {
    id: uid('note'),
    title: 'Başlıksız not',
    kind: 'NOT',
    time: new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(now),
    folder: state.selectedFolder,
    excerpt: 'Yeni not',
    bodyText: '',
    updatedAt: now.toISOString()
  };
  state.notes.unshift(note);
  openHomeNote(note.id, { edit: true });
  persistSoon();
  renderSidebar();
  renderWorkspace();
  requestAnimationFrame(() => document.querySelector('#home-note-title')?.select());
}

function duplicateNote(index) {
  const source = state.notes[index];
  if(!source) return;
  const copy = { ...source, id: uid('note'), title: `${source.title} — Kopya`, time: 'Şimdi', updatedAt: new Date().toISOString() };
  state.notes.unshift(copy);
  openHomeNote(copy.id, { edit: true });
  persistSoon();
  renderSidebar();
  renderWorkspace();
}

async function deleteNote(index) {
  const note = state.notes[index];
  if(!note) return;
  const approved = await confirmRemoval({
    title: 'Notu çöp kutusuna taşı',
    message: `“${note.title}” çalışma alanından kaldırılacak. Çöp kutusundan geri yükleyebilirsiniz.`,
    confirmLabel: 'Çöp kutusuna taşı'
  });
  if(!approved) return;
  const removedId = note.id;
  const tabIndex = state.homeTabs.indexOf(removedId);
  state.trash.unshift({ ...note, deletedAt: new Date().toISOString(), deletedAtLabel: 'Az önce' });
  state.notes.splice(index, 1);
  state.homeTabs = state.homeTabs.filter(id => id !== removedId);
  if(state.homeEditingNoteId === removedId) state.homeEditingNoteId = null;
  if(state.activeHomeNoteId === removedId) {
    state.activeHomeNoteId = state.homeTabs[Math.min(Math.max(tabIndex, 0), state.homeTabs.length - 1)] || null;
  }
  state.openedNoteIndex = null;
  persistSoon();
  renderSidebar();
  renderWorkspace();
  showToast('Not çöp kutusuna taşındı.');
}

function pushCanvasHistory() {
  canvasUndo.push(JSON.stringify(state.canvas));
  if(canvasUndo.length > 50) canvasUndo.shift();
  canvasRedo.length = 0;
}

function restoreCanvasSnapshot(serialized) {
  state.canvas = JSON.parse(serialized);
  state.selectedNodeId = null;
  state.selectedConnectionId = null;
  state.connectionStartId = null;
  persistSoon();
  renderWorkspace();
  renderSidebar();
}

function clampCanvasZoom(value) {
  return Math.max(.45, Math.min(1.6, Math.round(Number(value || 1) * 100) / 100));
}

function screenToCanvasPoint(surface, clientX, clientY) {
  const rect = surface.getBoundingClientRect();
  const zoom = clampCanvasZoom(state.canvasView.zoom);
  return {
    x: (clientX - rect.left - state.canvasView.panX) / zoom,
    y: (clientY - rect.top - state.canvasView.panY) / zoom
  };
}

function getVisibleCanvasBounds(surface) {
  const zoom = clampCanvasZoom(state.canvasView.zoom);
  const { panX, panY } = state.canvasView;
  return {
    left: (16 - panX) / zoom,
    top: (92 - panY) / zoom,
    right: (surface.clientWidth - 16 - panX) / zoom,
    bottom: (surface.clientHeight - 38 - panY) / zoom
  };
}

function applyCanvasView(surface) {
  const world = surface?.querySelector('#canvas-world');
  if(!surface || !world) return;
  const zoom = clampCanvasZoom(state.canvasView.zoom);
  state.canvasView.zoom = zoom;
  surface.style.setProperty('--canvas-zoom', zoom);
  world.style.transform = `translate3d(${state.canvasView.panX}px,${state.canvasView.panY}px,0) scale(${zoom})`;
  const value = surface.querySelector('#canvas-zoom-value');
  if(value) value.textContent = `${Math.round(zoom * 100)}%`;
  cancelAnimationFrame(applyCanvasView.connectionFrame);
  applyCanvasView.connectionFrame = requestAnimationFrame(updateCanvasConnections);
}

function setCanvasZoom(surface, nextZoom, clientX, clientY) {
  if(!surface) return;
  const oldZoom = clampCanvasZoom(state.canvasView.zoom);
  const zoom = clampCanvasZoom(nextZoom);
  if(zoom === oldZoom) return;
  const rect = surface.getBoundingClientRect();
  const anchorX = Number.isFinite(clientX) ? clientX - rect.left : surface.clientWidth / 2;
  const anchorY = Number.isFinite(clientY) ? clientY - rect.top : surface.clientHeight / 2;
  const worldX = (anchorX - state.canvasView.panX) / oldZoom;
  const worldY = (anchorY - state.canvasView.panY) / oldZoom;
  state.canvasView.zoom = zoom;
  state.canvasView.panX = Math.round((anchorX - worldX * zoom) * 100) / 100;
  state.canvasView.panY = Math.round((anchorY - worldY * zoom) * 100) / 100;
  applyCanvasView(surface);
  persistSoon();
}

function findAvailableCanvasPosition(surface, preferredX, preferredY, width, height) {
  const bounds = getVisibleCanvasBounds(surface);
  const minX = Math.round(bounds.left);
  const minY = Math.round(bounds.top);
  const maxX = Math.max(minX, Math.round(bounds.right - width));
  const maxY = Math.max(minY, Math.round(bounds.bottom - height));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const preferred = { x: clamp(Math.round(preferredX), minX, maxX), y: clamp(Math.round(preferredY), minY, maxY) };
  const candidates = [preferred];
  const stepX = width + 28;
  const stepY = height + 28;
  for(let y = minY; y <= maxY; y += stepY) {
    for(let x = minX; x <= maxX; x += stepX) candidates.push({ x, y });
  }
  candidates.sort((a,b) => Math.hypot(a.x-preferred.x,a.y-preferred.y) - Math.hypot(b.x-preferred.x,b.y-preferred.y));
  const isFree = candidate => !state.canvas.nodes.some(node => {
    const nodeWidth = Number(node.width) || (node.type === 'text' ? 220 : 240);
    const nodeHeight = Number(node.height) || (node.type === 'text' ? 112 : 168);
    return candidate.x < node.x + nodeWidth + 18 && candidate.x + width + 18 > node.x && candidate.y < node.y + nodeHeight + 18 && candidate.y + height + 18 > node.y;
  });
  return candidates.find(isFree) || preferred;
}

function addCanvasNode(type, x, y) {
  pushCanvasHistory();
  const width = type === 'text' ? 220 : 240;
  const height = type === 'text' ? 112 : 168;
  const surface = document.querySelector('#canvas-surface');
  const position = surface ? findAvailableCanvasPosition(surface, x, y, width, height) : { x, y };
  const node = type === 'text'
    ? { id: uid('text'), type: 'text', x: position.x, y: position.y, width, height, text: '' }
    : { id: uid('card'), type: 'card', x: position.x, y: position.y, width, height, title: '', body: '' };
  state.canvas.nodes.push(node);
  state.selectedNodeId = node.id;
  state.selectedConnectionId = null;
  state.canvasMode = 'select';
  persistSoon();
  renderWorkspace();
  renderSidebar();
  requestAnimationFrame(() => document.querySelector(type === 'text' ? `[data-node-text="${node.id}"]` : `[data-node-title="${node.id}"]`)?.focus());
}

function deleteCanvasNode(nodeId) {
  const node = state.canvas.nodes.find(item => item.id === nodeId);
  if(!node) return;
  pushCanvasHistory();
  state.canvas.nodes = state.canvas.nodes.filter(item => item.id !== nodeId);
  state.canvas.connections = state.canvas.connections.filter(item => item.from !== nodeId && item.to !== nodeId);
  state.selectedNodeId = null;
  state.connectionStartId = state.connectionStartId === nodeId ? null : state.connectionStartId;
  persistSoon();
  renderWorkspace();
  renderSidebar();
  showToast(node.type === 'text' ? 'Metin silindi · Geçmişten geri alabilirsiniz.' : 'Kart silindi · Geçmişten geri alabilirsiniz.');
}

async function deleteCanvasConnection(connectionId) {
  const connection = state.canvas.connections.find(item => item.id === connectionId);
  if(!connection) return;
  const approved = await confirmRemoval({ title: 'Bağlantıyı sil', message: 'Seçili ok şemadan kaldırılacak.', confirmLabel: 'Bağlantıyı sil' });
  if(!approved) return;
  pushCanvasHistory();
  state.canvas.connections = state.canvas.connections.filter(item => item.id !== connectionId);
  state.selectedConnectionId = null;
  persistSoon();
  renderWorkspace();
}

function setCalendarExpanded(expanded) {
  const widget = document.querySelector('#calendar-widget');
  if(!widget) return;
  state.calendarExpanded = expanded;
  widget.classList.toggle('expanded', expanded);
  const button = widget.querySelector('#calendar-toggle');
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Takvimi küçült' : 'Takvimi büyüt');
  button.innerHTML = expanded
    ? '<svg viewBox="0 0 24 24"><path d="M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M9 3H3v6M15 21h6v-6M3 9l6-6M21 15l-6 6"/></svg>';
}

function refreshCalendar() {
  const widget = document.querySelector('#calendar-widget');
  if(!widget) return;
  widget.querySelector('.mini-calendar').outerHTML = compactCalendar();
  widget.querySelector('.home-calendar-days').innerHTML = expandedCalendarDays();
  widget.querySelector('#calendar-month-title').textContent = calendarMonthTitle();
  widget.querySelector('#home-selected-date').textContent = String(state.selectedDay).padStart(2, '0');
  widget.querySelector('#home-selected-label').textContent = calendarSelectedLabel();
  widget.querySelector('#calendar-agenda').innerHTML = calendarAgenda();
  const form = widget.querySelector('#calendar-date-form');
  form.elements.day.innerHTML = calendarDayOptions();
  form.elements.month.value = String(state.calendarMonth);
  form.elements.year.value = String(state.calendarYear);
  refreshAlarmSummary();
}

function selectCalendarDate(year, month, day) {
  if(!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(day) || day < 1 || day > 31) return false;
  state.calendarYear = year;
  state.calendarMonth = month;
  state.selectedDay = Math.min(day, calendarDate(year, month + 1, 0).getDate());
  refreshCalendar();
  return true;
}

function positionCalendarPicker() {
  const picker = document.querySelector('#calendar-date-picker');
  const trigger = document.querySelector('#calendar-date-trigger');
  if(!picker || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(310, window.innerWidth - 24);
  const height = picker.offsetHeight || 170;
  const top = rect.bottom + height + 10 <= window.innerHeight - 12 ? rect.bottom + 10 : Math.max(12, rect.top - height - 10);
  picker.style.width = width + 'px';
  picker.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px';
  picker.style.top = top + 'px';
}

function bindCalendarEvents() {
  const widget = document.querySelector('#calendar-widget');
  if(!widget) return;
  const picker = widget.querySelector('#calendar-date-picker');
  const form = widget.querySelector('#calendar-date-form');
  const applyDate = () => form.checkValidity() && selectCalendarDate(Number(form.elements.year.value), Number(form.elements.month.value), Number(form.elements.day.value));
  picker.addEventListener('beforetoggle', event => {
    if(event.newState === 'open') positionCalendarPicker();
  });
  picker.addEventListener('toggle', event => {
    widget.querySelector('#calendar-date-trigger').setAttribute('aria-expanded', String(event.newState === 'open'));
    if(event.newState === 'open') positionCalendarPicker();
  });
  form.addEventListener('change', applyDate);
  widget.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if(!button || button.disabled) return;
    if(button.id === 'calendar-toggle') { setCalendarExpanded(!state.calendarExpanded); return; }
    if(button.hasAttribute('data-home-day')) { selectCalendarDate(state.calendarYear, state.calendarMonth, Number(button.dataset.homeDay)); return; }
    if(button.hasAttribute('data-mini-day')) {
      selectCalendarDate(state.calendarYear, state.calendarMonth, Number(button.dataset.miniDay));
      setCalendarExpanded(true);
      return;
    }
    if(button.hasAttribute('data-add-alarm')) { openAlarmDialog({ date: isoForCurrentMonthDay(state.selectedDay) }); return; }
    if(button.hasAttribute('data-edit-alarm')) { openAlarmDialog({ id: button.dataset.editAlarm }); return; }
    if(button.hasAttribute('data-task-alarm')) { openAlarmDialog({ taskId: button.dataset.taskAlarm }); return; }
    if(button.hasAttribute('data-toggle-alarm')) {
      const alarm = state.alarms.find(item => item.id === button.dataset.toggleAlarm);
      if(!alarm) return;
      if(!alarm.enabled && Date.parse(alarm.scheduledAt) <= Date.now()) { openAlarmDialog({ id: alarm.id }); return; }
      alarm.enabled = !alarm.enabled;
      if(!alarm.enabled) state.ringingAlarms = state.ringingAlarms.filter(item => item.source !== 'alarm' || item.id !== alarm.id);
      renderAlarmAlerts();
      await saveNow();
      refreshCalendar();
      return;
    }
    if(button.id === 'next-alarm') {
      const item = nextAlarm();
      if(item) {
        selectCalendarDate(new Date(item.scheduledAt).getFullYear(), new Date(item.scheduledAt).getMonth(), new Date(item.scheduledAt).getDate());
        setCalendarExpanded(true);
      } else openAlarmDialog();
    }
  });
  widget.addEventListener('submit', async event => {
    event.preventDefault();
    if(event.target.id === 'calendar-date-form') {
      if(applyDate()) picker.hidePopover();
      return;
    }
    if(event.target.id !== 'calendar-add-form') return;
    const data = new FormData(event.target);
    const title = String(data.get('title') || '').trim();
    if(!title) return;
    const date = isoForCurrentMonthDay(state.selectedDay);
    const time = String(data.get('time') || '');
    const reminder = time ? parseAlarmDate(date, time) : null;
    if(time && (!reminder || reminder.getTime() <= Date.now())) { showToast('Hatırlatma için gelecekte bir tarih ve saat seçin.'); return; }
    state.tasks.push({ id: uid('task'), title, dueDate: date, reminderAt: reminder?.toISOString() || null, done: false });
    await saveNow();
    renderWorkspace();
  });
}

function bindWorkspaceEvents() {
  const activeHomeNote = state.notes.find(note => note.id === state.activeHomeNoteId);
  const homeTitle = document.querySelector('#home-note-title');
  const homeBody = document.querySelector('#home-note-body');
  const updateHomeTabPreview = () => {
    if(!activeHomeNote || !homeTitle) return;
    const tabLabel = document.querySelector(`[data-home-tab-label="${activeHomeNote.id}"]`);
    if(tabLabel) tabLabel.textContent = homeTitle.value.trim() || 'Başlıksız not';
  };
  const commitHomeNote = async () => {
    if(!activeHomeNote || !homeTitle || !homeBody) return;
    activeHomeNote.title = homeTitle.value.trim() || 'Başlıksız not';
    activeHomeNote.bodyText = homeBody.value;
    activeHomeNote.folder = document.querySelector('#home-note-folder')?.value || null;
    activeHomeNote.excerpt = activeHomeNote.bodyText.trim().slice(0, 145) || 'Yeni not';
    activeHomeNote.time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    activeHomeNote.updatedAt = new Date().toISOString();
    await saveNow();
    state.homeEditingNoteId = null;
    renderSidebar();
    renderWorkspace();
  };
  document.querySelector('#home-new-note')?.addEventListener('click', createNewNote);
  document.querySelectorAll('[data-home-tab]').forEach(button => button.addEventListener('click', () => {
    state.activeHomeNoteId = button.dataset.homeTab;
    state.homeEditingNoteId = null;
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelectorAll('[data-close-home-tab]').forEach(button => button.addEventListener('click', () => closeHomeNoteTab(button.dataset.closeHomeTab)));
  homeTitle?.addEventListener('input', updateHomeTabPreview);
  [homeTitle, homeBody].forEach(input => input?.addEventListener('keydown', event => {
    if(event.key !== 'Enter' || (event.currentTarget === homeBody && event.shiftKey)) return;
    event.preventDefault();
    commitHomeNote();
  }));
  document.querySelector('#home-edit-note')?.addEventListener('click', () => {
    if(!activeHomeNote) return;
    state.homeEditingNoteId = activeHomeNote.id;
    renderWorkspace();
    requestAnimationFrame(() => document.querySelector('#home-note-title')?.focus());
  });
  document.querySelector('#home-delete-note')?.addEventListener('click', () => {
    const index = state.notes.findIndex(note => note.id === state.activeHomeNoteId);
    if(index >= 0) deleteNote(index);
  });
  document.querySelectorAll('.task-check').forEach(button => button.addEventListener('click', async () => {
    const index = Number(button.dataset.taskIndex);
    state.tasks[index].done = !state.tasks[index].done;
    button.closest('.task-row').classList.toggle('done', state.tasks[index].done);
    button.setAttribute('aria-pressed', String(state.tasks[index].done));
    const count = document.querySelector('#open-task-count');
    if(count) count.textContent = `${state.tasks.filter(task => !task.done).length} açık`;
    const summary = document.querySelector('#home-open-task-summary');
    if(summary) summary.textContent = String(state.tasks.filter(task => !task.done).length);
    if(state.tasks[index].done) {
      const ringing = state.ringingAlarms.filter(item => item.source === 'task' && item.id === state.tasks[index].id);
      for(const item of ringing) await dismissRingingAlarm(item.key);
    }
    await saveNow();
  }));
  document.querySelectorAll('[data-task-remove]').forEach(button => button.addEventListener('click', async () => {
    const index = Number(button.dataset.taskRemove);
    const task = state.tasks[index];
    if(!task) return;
    const approved = await confirmRemoval({
      title: 'Görevi sil',
      message: `“${task.title}” görev listesinden kalıcı olarak kaldırılacak.`,
      confirmLabel: 'Görevi sil'
    });
    if(!approved) return;
    state.tasks = state.tasks.filter(item => item.id !== task.id);
    state.ringingAlarms = state.ringingAlarms.filter(item => item.source !== 'task' || item.id !== task.id);
    renderAlarmAlerts();
    await saveNow();
    renderWorkspace();
  }));
  bindCalendarEvents();
  document.querySelectorAll('.task-row [data-task-alarm]').forEach(button => button.addEventListener('click', () => openAlarmDialog({ taskId: button.dataset.taskAlarm })));
  document.querySelector('#task-add-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') || '').trim();
    if(!title) return;
    const date = String(data.get('date') || todayIso());
    const time = String(data.get('time') || '');
    const reminder = time ? parseAlarmDate(date, time) : null;
    if(time && (!reminder || reminder.getTime() <= Date.now())) { showToast('Hatırlatma için gelecekte bir tarih ve saat seçin.'); return; }
    state.tasks.push({ id: uid('task'), title, dueDate: date, reminderAt: reminder?.toISOString() || null, done: false });
    await saveNow();
    renderWorkspace();
  });
  document.querySelectorAll('[data-quick-note]').forEach(button => button.addEventListener('click', createNewNote));
  document.querySelectorAll('[data-open-note]').forEach(tile => tile.addEventListener('click', () => {
    state.openedNoteIndex = Number(tile.dataset.openNote);
    renderSidebar();
    renderWorkspace();
  }));
  document.querySelector('#sort-notes-button')?.addEventListener('click', () => {
    state.sortMode = state.sortMode === 'updated' ? 'title' : 'updated';
    renderWorkspace();
  });
  document.querySelectorAll('[data-note-menu-index]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const menu = document.querySelector(`[data-note-tile-menu="${button.dataset.noteMenuIndex}"]`);
    document.querySelectorAll('.note-tile-menu.open').forEach(item => { if(item !== menu) item.classList.remove('open'); });
    menu?.classList.toggle('open');
  }));
  document.querySelectorAll('[data-duplicate-note]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    duplicateNote(Number(button.dataset.duplicateNote));
  }));
  document.querySelectorAll('[data-delete-note]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    deleteNote(Number(button.dataset.deleteNote));
  }));
  document.querySelector('#close-note-button')?.addEventListener('click', () => {
    state.openedNoteIndex = null;
    renderSidebar();
    renderWorkspace();
  });
  document.querySelector('#save-note-button')?.addEventListener('click', () => saveNow());
  document.querySelector('#note-menu-button')?.addEventListener('click', () => document.querySelector('#note-document-menu')?.classList.toggle('open'));
  document.querySelector('#duplicate-current-note')?.addEventListener('click', () => duplicateNote(state.openedNoteIndex));
  document.querySelector('#delete-current-note')?.addEventListener('click', () => deleteNote(state.openedNoteIndex));
  document.querySelector('.document-title')?.addEventListener('input', event => {
    const note = state.notes[state.openedNoteIndex];
    note.title = event.target.value || 'Başlıksız not';
    note.time = 'Şimdi';
    note.updatedAt = new Date().toISOString();
    persistSoon();
    renderSidebar();
  });
  document.querySelector('[data-note-body]')?.addEventListener('input', event => {
    const note = state.notes[state.openedNoteIndex];
    note.bodyText = event.target.innerText.trim();
    note.excerpt = note.bodyText.slice(0, 145) || 'Yeni not';
    note.time = 'Şimdi';
    note.updatedAt = new Date().toISOString();
    persistSoon();
  });
  document.querySelector('#note-folder-select')?.addEventListener('change', event => {
    const note = state.notes[state.openedNoteIndex];
    note.folder = event.target.value || null;
    note.updatedAt = new Date().toISOString();
    persistSoon();
    renderSidebar();
  });
  document.querySelector('#toggle-trash-contents')?.addEventListener('click', () => {
    state.trashContentsVisible = !state.trashContentsVisible;
    renderWorkspace();
  });
  document.querySelector('#empty-trash-button')?.addEventListener('click', () => {
    state.trash = [];
    state.trashContentsVisible = false;
    persistSoon();
    renderSidebar();
    renderWorkspace();
    showToast('Çöp kutusu tamamen temizlendi.');
  });
  document.querySelectorAll('[data-restore-note]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.restoreNote);
    const [note] = state.trash.splice(index, 1);
    delete note.deletedAt;
    delete note.deletedAtLabel;
    note.updatedAt = new Date().toISOString();
    state.notes.unshift(note);
    persistSoon();
    renderSidebar();
    renderWorkspace();
    showToast('Not geri yüklendi.');
  }));
  document.querySelectorAll('[data-purge-note]').forEach(button => button.addEventListener('click', async () => {
    const index = Number(button.dataset.purgeNote);
    const note = state.trash[index];
    if(!note) return;
    const approved = await confirmRemoval({
      title: 'Notu kalıcı olarak sil',
      message: `“${note.title}” tamamen silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: 'Kalıcı olarak sil',
      kicker: 'KALICI İŞLEM'
    });
    if(!approved) return;
    state.trash.splice(index, 1);
    persistSoon();
    renderSidebar();
    renderWorkspace();
  }));
  bindCanvasInteractions();
}

function bindCanvasInteractions() {
  const surface = document.querySelector('#canvas-surface');
  if(!surface) return;
  const titleInput = document.querySelector('#canvas-title-input');
  titleInput?.addEventListener('input', event => {
    state.canvasTitle = event.target.value;
    const activeSchema = state.schemas.find(item => item.id === state.activeSchemaId);
    if(activeSchema) activeSchema.title = state.canvasTitle.trim() || 'Adsız şema';
    persistSoon();
    renderSidebar();
  });
  titleInput?.addEventListener('keydown', event => {
    if(event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget.blur();
    saveNow();
  });
  document.querySelector('#save-schema-project')?.addEventListener('click', saveSchemaProject);
  requestAnimationFrame(() => {
    applyCanvasView(surface);
    updateCanvasConnections();
  });

  surface.addEventListener('wheel', event => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
    const factor = Math.exp(-Math.max(-240, Math.min(240, delta)) * .0017);
    setCanvasZoom(surface, state.canvasView.zoom * factor, event.clientX, event.clientY);
  }, { passive: false });
  document.querySelector('#canvas-zoom-out')?.addEventListener('click', () => {
    setCanvasZoom(surface, state.canvasView.zoom - .1);
  });
  document.querySelector('#canvas-zoom-in')?.addEventListener('click', () => {
    setCanvasZoom(surface, state.canvasView.zoom + .1);
  });
  document.querySelector('#canvas-zoom-reset')?.addEventListener('click', () => {
    state.canvasView = { zoom: 1, panX: 0, panY: 0 };
    applyCanvasView(surface);
    persistSoon();
  });

  document.querySelectorAll('[data-canvas-tool]').forEach(button => button.addEventListener('click', () => {
    state.canvasMode = button.dataset.canvasTool;
    state.connectionStartId = null;
    state.selectedConnectionId = null;
    renderWorkspace();
  }));
  document.querySelectorAll('[data-default-connection-style]').forEach(button => button.addEventListener('click', () => {
    state.connectionStyle = button.dataset.defaultConnectionStyle;
    state.canvasMode = 'connect';
    state.connectionStartId = null;
    state.selectedConnectionId = null;
    renderWorkspace();
  }));
  const addCenteredCard = () => {
    const rect = surface.getBoundingClientRect();
    const center = screenToCanvasPoint(surface, rect.left + surface.clientWidth / 2, rect.top + surface.clientHeight / 2);
    addCanvasNode('card', center.x - 120, center.y - 84);
  };
  document.querySelector('#add-canvas-card')?.addEventListener('click', addCenteredCard);
  document.querySelector('#empty-add-card')?.addEventListener('click', addCenteredCard);
  document.querySelector('#canvas-history-button')?.addEventListener('click', () => {
    state.historyOpen = !state.historyOpen;
    renderWorkspace();
  });
  document.querySelector('#canvas-undo')?.addEventListener('click', () => {
    if(!canvasUndo.length) return;
    canvasRedo.push(JSON.stringify(state.canvas));
    restoreCanvasSnapshot(canvasUndo.pop());
  });
  document.querySelector('#canvas-redo')?.addEventListener('click', () => {
    if(!canvasRedo.length) return;
    canvasUndo.push(JSON.stringify(state.canvas));
    restoreCanvasSnapshot(canvasRedo.pop());
  });

  surface.addEventListener('pointerdown', event => {
    if(event.target.closest('.schema-node, .canvas-floating-toolbar, .canvas-floating-actions, .connection-context-bar, .canvas-history-panel, button, input, textarea')) return;
    if(state.canvasMode === 'card' || state.canvasMode === 'text') {
      const width = state.canvasMode === 'text' ? 220 : 240;
      const height = state.canvasMode === 'text' ? 112 : 168;
      const point = screenToCanvasPoint(surface, event.clientX, event.clientY);
      addCanvasNode(state.canvasMode, point.x - width / 2, point.y - height / 2);
      return;
    }
    if(state.canvasMode === 'select') {
      state.selectedNodeId = null;
      state.selectedConnectionId = null;
      renderWorkspace();
    }
  });

  let active = null, activeModel = null, startX = 0, startY = 0, left = 0, top = 0, moved = false, dragHistoryCaptured = false;
  let resizing = null, resizeModel = null, resizeStartX = 0, resizeStartY = 0, resizeWidth = 0, resizeHeight = 0;
  surface.querySelectorAll('.schema-node').forEach(node => node.addEventListener('pointerdown', event => {
    event.stopPropagation();
    const nodeId = node.dataset.nodeId;
    if(state.canvasMode === 'connect') {
      if(!state.connectionStartId) {
        state.connectionStartId = nodeId;
        state.selectedNodeId = nodeId;
        renderWorkspace();
        return;
      }
      if(state.connectionStartId !== nodeId) {
        const duplicate = state.canvas.connections.some(item => (item.from === state.connectionStartId && item.to === nodeId) || (item.to === state.connectionStartId && item.from === nodeId));
        if(!duplicate) {
          pushCanvasHistory();
          const connection = { id: uid('connection'), from: state.connectionStartId, to: nodeId, style: state.connectionStyle };
          state.canvas.connections.push(connection);
          state.selectedConnectionId = connection.id;
        }
      }
      state.connectionStartId = null;
      state.selectedNodeId = null;
      state.canvasMode = 'select';
      persistSoon();
      renderWorkspace();
      renderSidebar();
      return;
    }
    if(state.canvasMode !== 'select') return;
    state.selectedNodeId = nodeId;
    state.selectedConnectionId = null;
    surface.querySelectorAll('.schema-node').forEach(item => item.classList.toggle('selected', item === node));
    if(event.target.closest('input, textarea, button, .node-resize-handle')) return;
    active = node;
    activeModel = state.canvas.nodes.find(item => item.id === nodeId);
    startX = event.clientX;
    startY = event.clientY;
    left = activeModel.x;
    top = activeModel.y;
    moved = false;
    dragHistoryCaptured = false;
    node.setPointerCapture(event.pointerId);
    node.style.zIndex = 7;
  }));
  surface.querySelectorAll('[data-resize-node]').forEach(handle => handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    const nodeId = handle.dataset.resizeNode;
    resizing = surface.querySelector(`[data-node-id="${nodeId}"]`);
    resizeModel = state.canvas.nodes.find(item => item.id === nodeId);
    if(!resizing || !resizeModel) return;
    state.selectedNodeId = nodeId;
    state.selectedConnectionId = null;
    surface.querySelectorAll('.schema-node').forEach(item => item.classList.toggle('selected', item === resizing));
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    resizeWidth = Number(resizeModel.width) || resizing.offsetWidth;
    resizeHeight = Number(resizeModel.height) || resizing.offsetHeight;
    pushCanvasHistory();
    handle.setPointerCapture(event.pointerId);
  }));
  surface.addEventListener('pointermove', event => {
    if(resizing && resizeModel) {
      const zoom = clampCanvasZoom(state.canvasView.zoom);
      const bounds = getVisibleCanvasBounds(surface);
      const maxWidth = Math.max(210, bounds.right - resizeModel.x);
      const maxHeight = Math.max(126, bounds.bottom - resizeModel.y);
      const nextWidth = Math.max(200, Math.min(maxWidth, resizeWidth + (event.clientX - resizeStartX) / zoom));
      const nextHeight = Math.max(126, Math.min(maxHeight, resizeHeight + (event.clientY - resizeStartY) / zoom));
      resizing.style.width = `${Math.round(nextWidth)}px`;
      resizing.style.height = `${Math.round(nextHeight)}px`;
      resizeModel.width = Math.round(nextWidth);
      resizeModel.height = Math.round(nextHeight);
      updateCanvasConnections();
      return;
    }
    if(!active) return;
    const zoom = clampCanvasZoom(state.canvasView.zoom);
    const bounds = getVisibleCanvasBounds(surface);
    const modelWidth = Number(activeModel.width) || active.offsetWidth;
    const modelHeight = Number(activeModel.height) || active.offsetHeight;
    const nextLeft = Math.max(bounds.left, Math.min(bounds.right - modelWidth, left + (event.clientX - startX) / zoom));
    const nextTop = Math.max(bounds.top, Math.min(bounds.bottom - modelHeight, top + (event.clientY - startY) / zoom));
    moved = moved || Math.abs(event.clientX-startX) > 2 || Math.abs(event.clientY-startY) > 2;
    if(moved && !dragHistoryCaptured) {
      pushCanvasHistory();
      dragHistoryCaptured = true;
    }
    active.style.left = `${nextLeft}px`;
    active.style.top = `${nextTop}px`;
    activeModel.x = Math.round(nextLeft);
    activeModel.y = Math.round(nextTop);
    updateCanvasConnections();
  });
  surface.addEventListener('pointerup', () => {
    if(resizing) {
      resizing = null;
      resizeModel = null;
      persistSoon();
      return;
    }
    if(!active) return;
    active.style.zIndex = 3;
    active = null;
    activeModel = null;
    persistSoon();
  });

  surface.querySelectorAll('[data-connection-id]').forEach(path => path.addEventListener('pointerdown', event => {
    event.stopPropagation();
    state.selectedConnectionId = path.dataset.connectionId;
    state.selectedNodeId = null;
    renderWorkspace();
  }));

  const bindInlineField = (selector, property) => document.querySelectorAll(selector).forEach(field => {
    const nodeId = field.dataset.nodeTitle || field.dataset.nodeBody || field.dataset.nodeText;
    field.addEventListener('focus', () => {
      state.selectedNodeId = nodeId;
      state.selectedConnectionId = null;
      surface.querySelectorAll('.schema-node').forEach(item => item.classList.toggle('selected', item.dataset.nodeId === nodeId));
      if(!field.dataset.historyCaptured) {
        pushCanvasHistory();
        field.dataset.historyCaptured = 'true';
      }
    });
    field.addEventListener('input', event => {
      const model = state.canvas.nodes.find(item => item.id === nodeId);
      if(model) model[property] = event.target.value;
      persistSoon();
    });
    field.addEventListener('keydown', event => {
      if(event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.blur();
        saveNow();
        const card = surface.querySelector(`[data-node-id="${nodeId}"]`);
        card?.classList.add('committed');
        window.setTimeout(() => card?.classList.remove('committed'), 420);
      }
    });
  });
  bindInlineField('[data-node-title]', 'title');
  bindInlineField('[data-node-body]', 'body');
  bindInlineField('[data-node-text]', 'text');

  document.querySelectorAll('[data-delete-canvas-node]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    deleteCanvasNode(button.dataset.deleteCanvasNode);
  }));
  document.querySelectorAll('[data-connection-style]').forEach(button => button.addEventListener('click', () => {
    const connection = state.canvas.connections.find(item => item.id === state.selectedConnectionId);
    if(!connection) return;
    pushCanvasHistory();
    connection.style = button.dataset.connectionStyle;
    state.connectionStyle = connection.style;
    persistSoon();
    renderWorkspace();
  }));
  document.querySelector('#delete-selected-connection')?.addEventListener('click', async () => {
    await deleteCanvasConnection(state.selectedConnectionId);
  });
}

function updateCanvasConnections() {
  const surface = document.querySelector('#canvas-surface');
  const svg = document.querySelector('#canvas-lines');
  if(!surface || !svg) return;
  svg.setAttribute('viewBox', `0 0 ${surface.clientWidth} ${surface.clientHeight}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const surfaceRect = surface.getBoundingClientRect();
  const relativeRect = element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - surfaceRect.left,
      top: rect.top - surfaceRect.top,
      right: rect.right - surfaceRect.left,
      bottom: rect.bottom - surfaceRect.top,
      width: rect.width,
      height: rect.height
    };
  };
  svg.querySelectorAll('[data-connection-id]').forEach(path => {
    const from = surface.querySelector(`[data-node-id="${path.dataset.from}"]`);
    const to = surface.querySelector(`[data-node-id="${path.dataset.to}"]`);
    if(!from || !to) return;
    const fromBox = relativeRect(from);
    const toBox = relativeRect(to);
    const fromCenter = { x: fromBox.left + fromBox.width / 2, y: fromBox.top + fromBox.height / 2 };
    const toCenter = { x: toBox.left + toBox.width / 2, y: toBox.top + toBox.height / 2 };
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;
    const overlapsHorizontally = fromBox.left < toBox.right && fromBox.right > toBox.left;
    const overlapsVertically = fromBox.top < toBox.bottom && fromBox.bottom > toBox.top;
    let sx, sy, tx, ty, control1, control2;
    if(overlapsHorizontally && overlapsVertically) {
      const routeAbove = Math.min(fromBox.top, toBox.top) > 120;
      sx = fromCenter.x;
      tx = toCenter.x;
      if(routeAbove) {
        sy = fromBox.top;
        ty = toBox.top;
        const routeY = Math.max(54, Math.min(fromBox.top, toBox.top) - 46);
        control1 = `${sx} ${routeY}`;
        control2 = `${tx} ${routeY}`;
      } else {
        sy = fromBox.bottom;
        ty = toBox.bottom;
        const routeY = Math.max(sy, ty) + 46;
        control1 = `${sx} ${routeY}`;
        control2 = `${tx} ${routeY}`;
      }
    } else if(!overlapsHorizontally && (overlapsVertically || Math.abs(dx) >= Math.abs(dy))) {
      const direction = dx >= 0 ? 1 : -1;
      sx = fromCenter.x + direction * fromBox.width / 2;
      sy = fromCenter.y;
      tx = toCenter.x - direction * toBox.width / 2;
      ty = toCenter.y;
      const bend = Math.max(34, Math.abs(tx - sx) * .42);
      control1 = `${sx + bend * direction} ${sy}`;
      control2 = `${tx - bend * direction} ${ty}`;
    } else {
      const direction = dy >= 0 ? 1 : -1;
      sx = fromCenter.x;
      sy = fromCenter.y + direction * fromBox.height / 2;
      tx = toCenter.x;
      ty = toCenter.y - direction * toBox.height / 2;
      const bend = Math.max(34, Math.abs(ty - sy) * .42);
      control1 = `${sx} ${sy + bend * direction}`;
      control2 = `${tx} ${ty - bend * direction}`;
    }
    const straight = path.dataset.style === 'straight';
    path.setAttribute('d', straight
      ? `M ${sx} ${sy} L ${tx} ${ty}`
      : `M ${sx} ${sy} C ${control1}, ${control2}, ${tx} ${ty}`);
    const arrow = svg.querySelector(`[data-connection-arrow="${path.dataset.connectionId}"]`);
    if(arrow) {
      const [controlX, controlY] = straight ? [sx, sy] : control2.split(' ').map(Number);
      const angle = Math.atan2(ty - controlY, tx - controlX);
      const length = 8;
      const wing = 4;
      const baseX = tx - Math.cos(angle) * length;
      const baseY = ty - Math.sin(angle) * length;
      const leftX = baseX + Math.sin(angle) * wing;
      const leftY = baseY - Math.cos(angle) * wing;
      const rightX = baseX - Math.sin(angle) * wing;
      const rightY = baseY + Math.cos(angle) * wing;
      arrow.setAttribute('d', `M ${leftX} ${leftY} L ${tx} ${ty} L ${rightX} ${rightY}`);
    }
  });
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(()=>toast.classList.remove('show'),2300);
}

document.querySelector('#top-clock').addEventListener('click', () => openAlarmDialog({ date: todayIso() }));
document.querySelector('#alarm-cancel').addEventListener('click', () => document.querySelector('#alarm-dialog').close());
document.querySelector('#alarm-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.elements.title.value.trim();
  const scheduled = parseAlarmDate(form.elements.date.value, form.elements.time.value);
  const error = document.querySelector('#alarm-form-error');
  if(!title || !scheduled || scheduled.getTime() <= Date.now()) {
    error.textContent = 'Bir başlık ve gelecekte bir tarih/saat seçin.';
    return;
  }
  const previousAlarms = cloneData(state.alarms);
  const previousTasks = cloneData(state.tasks);
  const editing = { ...alarmEditor };
  if(editing.taskId) {
    const task = state.tasks.find(item => item.id === editing.taskId);
    if(!task || task.done) { error.textContent = 'Bu görev için hatırlatma kurulamaz.'; return; }
    task.reminderAt = scheduled.toISOString();
    task.dueDate = form.elements.date.value;
  } else {
    const alarm = { id: editing.id || uid('alarm'), title, scheduledAt: scheduled.toISOString(), enabled: true };
    const index = state.alarms.findIndex(item => item.id === editing.id);
    if(index >= 0) state.alarms.splice(index, 1, alarm);
    else state.alarms.push(alarm);
  }
  const result = await saveNow();
  if(!result?.ok) {
    state.alarms = previousAlarms;
    state.tasks = previousTasks;
    error.textContent = result?.error || 'Alarm kaydedilemedi.';
    return;
  }
  state.ringingAlarms = state.ringingAlarms.filter(item => !(item.source === (editing.taskId ? 'task' : 'alarm') && item.id === (editing.taskId || editing.id)));
  renderAlarmAlerts();
  document.querySelector('#alarm-dialog').close();
  renderWorkspace();
  showToast('Hatırlatma kuruldu.');
});
document.querySelector('#alarm-remove').addEventListener('click', async () => {
  const previousAlarms = cloneData(state.alarms);
  const previousTasks = cloneData(state.tasks);
  const editing = { ...alarmEditor };
  if(editing.taskId) {
    const task = state.tasks.find(item => item.id === editing.taskId);
    if(task) task.reminderAt = null;
  } else state.alarms = state.alarms.filter(item => item.id !== editing.id);
  const result = await saveNow();
  if(!result?.ok) { state.alarms = previousAlarms; state.tasks = previousTasks; return; }
  state.ringingAlarms = state.ringingAlarms.filter(item => !(item.source === (editing.taskId ? 'task' : 'alarm') && item.id === (editing.taskId || editing.id)));
  renderAlarmAlerts();
  document.querySelector('#alarm-dialog').close();
  renderWorkspace();
  showToast('Hatırlatma kaldırıldı.');
});
document.querySelector('#alarm-alerts').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if(!button) return;
  const key = button.dataset.alarmDismiss || button.dataset.alarmSnooze || button.dataset.alarmView;
  const item = state.ringingAlarms.find(alarm => alarm.key === key);
  if(!item) return;
  if(button.dataset.alarmView) { showAlarmCalendar(item); return; }
  if(button.dataset.alarmSnooze) {
    const scheduledAt = new Date(Date.now() + 5 * 60000).toISOString();
    if(item.source === 'task') {
      const task = state.tasks.find(task => task.id === item.id);
      if(task && !task.done) { task.reminderAt = scheduledAt; task.dueDate = localDateIso(scheduledAt); }
    } else {
      const alarm = state.alarms.find(alarm => alarm.id === item.id);
      if(alarm) { alarm.scheduledAt = scheduledAt; alarm.enabled = true; }
    }
    const result = await saveNow();
    if(!result?.ok) return;
    renderWorkspace();
    showToast('Alarm 5 dakika ertelendi.');
  }
  await dismissRingingAlarm(key);
});

window.notesDesktop?.onAlarm(receiveAlarm);
window.notesDesktop?.onAlarmOpen(showAlarmCalendar);
window.notesDesktop?.onNotificationError(showToast);

document.querySelector('#add-folder-button').addEventListener('click', () => {
  const name = window.prompt('Kategori adı');
  if(!name?.trim()) return;
  const cleanName = name.trim().slice(0, 40);
  if(folders.some(folder => folder.toLocaleLowerCase('tr-TR') === cleanName.toLocaleLowerCase('tr-TR'))) {
    showToast('Bu kategori zaten var.');
    return;
  }
  folders.push(cleanName);
  state.selectedFolder = cleanName;
  state.activeModule = 'notes';
  persistSoon();
  renderSidebar();
  renderWorkspace();
});

document.querySelector('#trash-button').addEventListener('click', () => {
  state.activeModule = 'trash';
  state.trashContentsVisible = false;
  state.openedNoteIndex = null;
  state.selectedFolder = null;
  state.searchQuery = '';
  const search = document.querySelector('#global-search-input');
  if(search) search.value = '';
  renderSidebar();
  renderWorkspace();
});

document.querySelector('#export-button').addEventListener('click', async () => {
  await storage.save(snapshot());
  if(!window.notesDesktop) {
    showToast('Yedekleme masaüstü uygulamasında kullanılabilir.');
    return;
  }
  const result = await window.notesDesktop.exportBackup();
  if(result?.ok) showToast('Yedek oluşturuldu.');
  else if(!result?.canceled) showToast(result?.error || 'Yedek oluşturulamadı.');
});

document.querySelector('#import-button').addEventListener('click', async () => {
  if(!window.notesDesktop) {
    showToast('Yedek yükleme masaüstü uygulamasında kullanılabilir.');
    return;
  }
  const result = await window.notesDesktop.importBackup();
  if(result?.ok && result.data) {
    applyStoredData(normalizeStoredData(result.data));
    await saveNow();
    state.openedNoteIndex = null;
    state.selectedFolder = null;
    state.activeModule = 'today';
    renderSidebar();
    renderWorkspace();
    showToast('Yedek yüklendi.');
  } else if(!result?.canceled) {
    showToast(result?.error || 'Yedek yüklenemedi.');
  }
});

const globalSearch = document.querySelector('#global-search-input');
globalSearch.addEventListener('input', event => {
  state.searchQuery = event.target.value;
  state.activeModule = 'notes';
  state.selectedFolder = null;
  state.openedNoteIndex = null;
  renderSidebar();
  renderWorkspace();
});

document.addEventListener('keydown', event => {
  const target = event.target;
  const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if(event.key === 'Escape' && state.activeModule === 'canvas' && state.connectionStartId) {
    state.connectionStartId = null;
    state.canvasMode = 'select';
    renderWorkspace();
  }
  if((event.key === 'Delete' || event.key === 'Backspace') && state.activeModule === 'canvas' && !isEditing) {
    if(state.selectedNodeId) {
      event.preventDefault();
      deleteCanvasNode(state.selectedNodeId);
    } else if(state.selectedConnectionId) {
      event.preventDefault();
      deleteCanvasConnection(state.selectedConnectionId);
    }
  }
});

function normalizeStoredData(data) {
  const sourceNotes = Array.isArray(data?.notes) ? data.notes : [];
  const sourceTasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const normalizeCanvas = source => source && Array.isArray(source.nodes) && Array.isArray(source.connections)
    ? {
        nodes: source.nodes.filter(node => node && typeof node === 'object').map(node => ({
          ...node,
          id: node.id || uid('node'),
          x: Number(node.x) || 40,
          y: Number(node.y) || 104,
          width: Math.max(200, Math.min(520, Number(node.width) || (node.type === 'text' ? 220 : 240))),
          height: Math.max(112, Math.min(420, Number(node.height) || (node.type === 'text' ? 112 : 168)))
        })),
        connections: source.connections.filter(connection => connection && typeof connection === 'object' && connection.from && connection.to).map(connection => ({ ...connection, id: connection.id || uid('connection'), style: connection.style === 'straight' ? 'straight' : 'curve' }))
      }
    : { nodes: [], connections: [] };
  const normalizeCanvasView = source => {
    const panX = Number(source?.panX);
    const panY = Number(source?.panY);
    return { zoom: clampCanvasZoom(source?.zoom), panX: Number.isFinite(panX) ? panX : 0, panY: Number.isFinite(panY) ? panY : 0 };
  };
  const notes = sourceNotes
    .filter(note => note && typeof note === 'object')
    .map(note => ({
      ...note,
      id: note.id || uid('note'),
      title: String(note.title || 'Başlıksız not'),
      kind: String(note.kind || 'NOT'),
      time: String(note.time || ''),
      folder: typeof note.folder === 'string' && note.folder.trim() ? note.folder.trim() : null,
      excerpt: String(note.excerpt || ''),
      bodyText: String(note.bodyText || (Array.isArray(note.body) ? note.body.join('\n\n') : '')),
      updatedAt: note.updatedAt || new Date().toISOString()
    }));
  const tasks = sourceTasks
    .filter(task => task && typeof task === 'object' && String(task.title || '').trim())
    .map(task => ({ ...task, id: String(task.id || uid('task')), title: String(task.title), dueDate: String(task.dueDate || todayIso()), reminderAt: typeof task.reminderAt === 'string' && Number.isFinite(Date.parse(task.reminderAt)) ? new Date(task.reminderAt).toISOString() : null, done: Boolean(task.done) }));
  const alarms = (Array.isArray(data?.alarms) ? data.alarms : [])
    .filter(alarm => alarm && typeof alarm.title === 'string' && alarm.title.trim() && typeof alarm.scheduledAt === 'string' && Number.isFinite(Date.parse(alarm.scheduledAt)))
    .map(alarm => ({ id: String(alarm.id || uid('alarm')), title: alarm.title.trim().slice(0,200), scheduledAt: new Date(alarm.scheduledAt).toISOString(), enabled: alarm.enabled !== false }));
  const canvas = normalizeCanvas(data?.canvas);
  const trash = Array.isArray(data?.trash) ? data.trash.filter(note => note && typeof note === 'object') : [];
  const canvasView = normalizeCanvasView(data?.canvasView);
  const schemas = Array.isArray(data?.schemas) ? data.schemas.filter(schema => schema && typeof schema === 'object').map((schema,index) => ({
    id: schema.id || uid('schema'),
    title: String(schema.title || `Şema ${index + 1}`).trim().slice(0,48) || `Şema ${index + 1}`,
    updatedAt: schema.updatedAt || new Date().toISOString(),
    canvas: normalizeCanvas(schema.canvas),
    canvasView: normalizeCanvasView(schema.canvasView)
  })) : [];
  const activeSchemaId = schemas.some(schema => schema.id === data?.activeSchemaId) ? data.activeSchemaId : null;
  const canvasTitle = String(data?.canvasTitle || (activeSchemaId ? schemas.find(schema => schema.id === activeSchemaId)?.title : 'Yeni şema')).slice(0,48) || 'Yeni şema';
  const requestedFolders = Array.isArray(data?.folders) ? data.folders.filter(folder => typeof folder === 'string' && folder.trim()).map(folder => folder.trim()) : [];
  const usedFolders = notes.map(note => note.folder).filter(Boolean);
  const normalizedFolders = [...new Set([...requestedFolders, ...usedFolders])];
  return { notes, tasks, alarms, trash, schemas, activeSchemaId, canvasTitle, canvas, canvasView, folders: normalizedFolders };
}

function applyStoredData(data) {
  state.notes = data.notes;
  state.tasks = data.tasks;
  state.alarms = data.alarms;
  state.ringingAlarms = state.ringingAlarms.filter(item => item.source === 'alarm'
    ? state.alarms.some(alarm => alarm.enabled && alarm.id === item.id && alarm.scheduledAt === item.scheduledAt)
    : state.tasks.some(task => !task.done && task.id === item.id && task.reminderAt === item.scheduledAt));
  renderAlarmAlerts();
  state.trash = data.trash;
  state.schemas = data.schemas;
  state.activeSchemaId = data.activeSchemaId;
  const activeSchema = state.schemas.find(schema => schema.id === state.activeSchemaId);
  state.canvas = cloneData(activeSchema?.canvas || data.canvas);
  state.canvasView = { ...(activeSchema?.canvasView || data.canvasView) };
  state.canvasTitle = activeSchema?.title || data.canvasTitle || 'Yeni şema';
  state.homeTabs = [];
  state.activeHomeNoteId = null;
  state.homeTabsInitialized = false;
  state.homeEditingNoteId = null;
  folders.splice(0, folders.length, ...data.folders);
}

async function boot() {
  renderTopDate();
  const result = await storage.load();
  state.alarmHistory = { ...(result?.alarmHistory || {}), ...state.alarmHistory };
  for(const item of result?.pendingAlarms || []) receiveAlarm(item);
  if(result?.ok && result.data) {
    const version = Number(result.data.version || 1);
    applyStoredData(normalizeStoredData(result.data));
    if(version < 6) await saveNow();
  } else if(result && !result.ok) {
    showToast(result.error || 'Yerel veriler okunamadı.');
  }
  renderSidebar();
  renderWorkspace();
  if(!result?.data) await saveNow();
  let lastDay = todayIso();
  setInterval(() => {
    renderTopDate();
    refreshAlarmSummary();
    const day = todayIso();
    if(day !== lastDay) {
      if(state.calendarYear === Number(lastDay.slice(0,4)) && state.calendarMonth === Number(lastDay.slice(5,7)) - 1 && state.selectedDay === Number(lastDay.slice(8))) {
        const now = new Date();
        state.calendarYear = now.getFullYear(); state.calendarMonth = now.getMonth(); state.selectedDay = now.getDate();
      }
      // Update the calendar without replacing an in-progress note or task draft.
      if(state.activeModule === 'today') {
        refreshCalendar();
      }
      lastDay = day;
    }
  }, 1000);
}

window.addEventListener('resize', positionCalendarPicker);

boot();
