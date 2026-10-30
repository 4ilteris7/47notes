const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('notesDesktop', {
  load: () => ipcRenderer.invoke('notes:load'),
  save: data => ipcRenderer.invoke('notes:save', data),
  exportBackup: () => ipcRenderer.invoke('notes:export'),
  importBackup: () => ipcRenderer.invoke('notes:import'),
  ...(process.argv.includes('--notes-qa') ? { testNotification: () => ipcRenderer.invoke('notes:notification-test') } : {}),
  dismissAlarm: key => ipcRenderer.invoke('notes:alarm-dismiss', key),
  onAlarm: callback => subscribe('notes:alarm-fired', callback),
  onAlarmOpen: callback => subscribe('notes:alarm-open', callback),
  onNotificationError: callback => subscribe('notes:notification-error', callback),
  platform: process.platform
});
