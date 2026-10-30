const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { AlarmScheduler } = require('./alarms.cjs');
const { removeLegacySamples } = require('./legacy-samples.cjs');
const { windowsIdentity, repairWindowsShortcuts } = require('./windows-integration.cjs');

const windowsApp = windowsIdentity({ isPackaged: app.isPackaged, isQa: process.env.NOTES_QA === '1', executable: process.execPath, appRoot: app.getAppPath() });
if (process.platform === 'win32') app.setAppUserModelId(windowsApp.appId);

const DATA_FILE = 'notes-data.json';
const MAX_DATA_BYTES = 20 * 1024 * 1024;
let mainWindow;
let tray;
let quitting = false;
let scheduler;
let saveQueue = Promise.resolve();
const pendingAlarms = new Map();
const notifications = new Map();

if (process.env.NOTES_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.NOTES_USER_DATA_DIR));
}

function dataPath() {
  return path.join(app.getPath('userData'), DATA_FILE);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonAtomic(filePath, value) {
  const serialized = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DATA_BYTES) {
    throw new Error('Yerel veri dosyası izin verilen boyutu aşıyor.');
  }
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, serialized, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function cleanStoredSamples(data) {
  const result = removeLegacySamples(data);
  if (result.changed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeJsonAtomic(path.join(app.getPath('userData'), 'backups', `before-content-cleanup-${stamp}.json`), data);
  }
  return result;
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function showWindow(item) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (item) sendToWindow('notes:alarm-open', item);
}

function showNotification({ key, title, body, item }) {
  return new Promise(resolve => {
    if (!Notification.isSupported()) {
      resolve({ ok: false, error: 'Bu sistem masaüstü bildirimlerini desteklemiyor.' });
      return;
    }
    let notification;
    let timer;
    const finish = result => { clearTimeout(timer); resolve(result); };
    try {
      notification = new Notification({ title, body, icon: path.join(__dirname, '..', 'build', 'icon.png'), silent: false, timeoutType: 'never', urgency: 'critical' });
      notifications.get(key)?.close();
      notifications.set(key, notification);
      notification.once('show', () => finish({ ok: true }));
      notification.once('failed', () => {
        if (notifications.get(key) === notification) notifications.delete(key);
        const error = 'Windows bildirimi gösterilemedi. Ayarlar > Sistem > Bildirimler bölümünden Notes bildirimlerini kontrol edin.';
        finish({ ok: false, error });
      });
      notification.once('click', () => showWindow(item));
      notification.once('close', () => { if (notifications.get(key) === notification) notifications.delete(key); });
      timer = setTimeout(() => finish({ ok: false, error: 'Bildirim gösterimi doğrulanamadı. Windows bildirim ayarlarını kontrol edin.' }), 5000);
      notification.show();
    } catch {
      notifications.delete(key);
      finish({ ok: false, error: 'Masaüstü bildirimi gönderilemedi.' });
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Notes',
    backgroundColor: '#08090b',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: process.env.NOTES_QA === '1' ? ['--notes-qa'] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  if (process.platform === 'win32') window.setAppDetails(windowsApp);

  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  window.once('ready-to-show', () => {
    if (process.env.NOTES_QA !== '1') window.show();
  });
  window.on('close', event => {
    if (!quitting && tray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => { mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('notes:load', async () => {
  try {
    return { ok: true, data: await readJson(dataPath()), alarmHistory: scheduler?.history || {}, pendingAlarms: [...pendingAlarms.values()] };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, data: null };
    return { ok: false, error: 'Yerel veriler okunamadı.' };
  }
});

function saveData(data) {
  const write = saveQueue.then(async () => {
    await writeJsonAtomic(dataPath(), data);
    scheduler?.update(data);
    for (const [key] of pendingAlarms) {
      if (!scheduler?.items.some(item => item.key === key)) dismissAlarm(key);
    }
  });
  saveQueue = write.catch(() => {});
  return write;
}

function dismissAlarm(key) {
  pendingAlarms.delete(key);
  notifications.get(key)?.close();
  notifications.delete(key);
}

ipcMain.handle('notes:save', async (_event, data) => {
  try { await saveData(data); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message || 'Yerel veriler kaydedilemedi.' }; }
});

if (process.env.NOTES_QA === '1') {
  ipcMain.handle('notes:notification-test', () => showNotification({ key: 'test', title: '47 Notes · Bildirim testi', body: 'Masaüstü bildirimleri hazır. Alarm ve görev hatırlatmaları burada görünecek.' }));
}
ipcMain.handle('notes:alarm-dismiss', (_event, key) => {
  if (typeof key !== 'string') return { ok: false };
  dismissAlarm(key);
  return { ok: true };
});

ipcMain.handle('notes:export', async () => {
  const window = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(window, {
    title: 'Notes yedeğini dışa aktar',
    defaultPath: `Notes-Yedek-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Notes yedeği', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await saveQueue;
    const data = await readJson(dataPath());
    await writeJsonAtomic(result.filePath, data);
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: 'Yedek oluşturulamadı.' };
  }
});

ipcMain.handle('notes:import', async () => {
  const window = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(window, {
    title: 'Notes yedeğini içe aktar',
    properties: ['openFile'],
    filters: [{ name: 'Notes yedeği', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const imported = await readJson(result.filePaths[0]);
    const { data } = await cleanStoredSamples(imported);
    if (!data || !Array.isArray(data.notes) || !Array.isArray(data.folders)) {
      throw new Error('Geçersiz yedek');
    }
    await saveData(data);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: 'Seçilen dosya geçerli bir Notes yedeği değil.' };
  }
});

// A second instance would otherwise deliver every alarm twice.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else app.on('second-instance', () => { if (app.isReady()) showWindow(); });

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  if (process.platform === 'win32' && app.isPackaged && process.env.NOTES_QA !== '1') {
    try {
      await repairWindowsShortcuts({ shell, executable: process.execPath, desktop: app.getPath('desktop'), appData: app.getPath('appData'), backupRoot: path.join(app.getPath('userData'), 'backups', 'windows-shortcuts') });
    } catch (error) { console.error('Windows kısayolları onarılamadı:', error.message); }
  }
  let history = {};
  try { history = await readJson(path.join(app.getPath('userData'), 'alarm-history.json')); }
  catch (error) { if (error.code !== 'ENOENT') console.error('Alarm geçmişi okunamadı:', error.message); }
  scheduler = new AlarmScheduler({
    history,
    saveHistory: value => writeJsonAtomic(path.join(app.getPath('userData'), 'alarm-history.json'), value),
    deliver: item => {
      pendingAlarms.set(item.key, item);
      sendToWindow('notes:alarm-fired', item);
      const time = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.scheduledAt));
      // Native delivery is independent of renderer visibility and app focus.
      void showNotification({ key: item.key, title: item.source === 'task' ? '47 Notes · Görev hatırlatması' : '47 Notes · Alarm', body: `${item.title}\n${time}`, item }).then(result => {
        if (!result.ok) sendToWindow('notes:notification-error', result.error);
      });
    },
    onError: error => {
      console.error('Alarm kontrolü başarısız:', error.message);
      sendToWindow('notes:notification-error', 'Alarm geçmişi kaydedilemedi. Disk alanını kontrol edin.');
    }
  });
  try {
    const cleaned = await cleanStoredSamples(await readJson(dataPath()));
    if (cleaned.changed) await writeJsonAtomic(dataPath(), cleaned.data);
    scheduler.update(cleaned.data);
  }
  catch (error) { if (error.code !== 'ENOENT') console.error('Alarmlar yüklenemedi:', error.message); }
  try {
    tray = new Tray(path.join(__dirname, '..', 'build', 'icon.ico'));
    tray.setToolTip('47 Notes · Alarmlar arka planda çalışıyor');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '47 Notes’u aç', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Çıkış (alarmlar durur)', click: () => app.quit() }
    ]));
    tray.on('double-click', () => showWindow());
  } catch (error) { console.error('Sistem tepsisi oluşturulamadı:', error.message); }
  createWindow();
  const alarmTimer = setInterval(() => { void scheduler.check(); }, 1000);
  powerMonitor.on('resume', () => { void scheduler.check(); });
  app.on('will-quit', () => { clearInterval(alarmTimer); tray?.destroy(); });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
