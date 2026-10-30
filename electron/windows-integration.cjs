const path = require('node:path');
const fs = require('node:fs/promises');

const APP_ID = 'local.notes.desktop';

function quoteWindowsArgument(value) {
  return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function windowsIdentity({ isPackaged, isQa, executable, appRoot }) {
  const appId = APP_ID + (isQa ? '.qa' : isPackaged ? '' : '.dev');
  const args = isPackaged ? '' : quoteWindowsArgument(appRoot);
  return {
    appId,
    appIconPath: isPackaged ? executable : path.join(appRoot, 'build', 'icon.ico'),
    appIconIndex: 0,
    relaunchCommand: quoteWindowsArgument(executable) + (args ? ' ' + args : ''),
    relaunchDisplayName: isQa ? 'Notes QA' : isPackaged ? 'Notes' : 'Notes Geliştirme'
  };
}

function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

function ownsShortcut(details, executable) {
  return details.appUserModelId === APP_ID || samePath(details.target, executable);
}

function correctShortcut(details, executable) {
  return samePath(details.target, executable) && !details.args && samePath(details.cwd, path.dirname(executable)) && samePath(details.icon, executable) && details.iconIndex === 0 && details.appUserModelId === APP_ID;
}

async function repairWindowsShortcuts({ shell, executable, desktop, appData, backupRoot }) {
  const taskbar = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const locations = [
    { scope: 'desktop', file: path.join(desktop, 'Notes.lnk') },
    { scope: 'start-menu', file: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Notes.lnk') }
  ];
  try {
    for (const entry of await fs.readdir(taskbar, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) locations.push({ scope: 'taskbar', file: path.join(taskbar, entry.name) });
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const repaired = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(backupRoot, stamp);
  for (const location of locations) {
    let before;
    try { before = shell.readShortcutLink(location.file); }
    catch { continue; }
    // Do not rewrite another app, including other Electron applications.
    if (!ownsShortcut(before, executable) || correctShortcut(before, executable)) continue;
    const backupFile = path.join(backupDirectory, location.scope, path.basename(location.file));
    await fs.mkdir(path.dirname(backupFile), { recursive: true });
    await fs.copyFile(location.file, backupFile);
    const options = { target: executable, cwd: path.dirname(executable), args: '', description: 'Notes', icon: executable, iconIndex: 0, appUserModelId: APP_ID };
    if (!shell.writeShortcutLink(location.file, 'update', options)) throw new Error('Notes kısayolu onarılamadı: ' + location.file);
    const after = shell.readShortcutLink(location.file);
    if (!correctShortcut(after, executable)) throw new Error('Notes kısayolu doğrulanamadı: ' + location.file);
    repaired.push({ file: location.file, before, after });
  }
  if (repaired.length) await fs.writeFile(path.join(backupDirectory, 'repair.json'), JSON.stringify({ repaired }, null, 2), 'utf8');
  return { repaired: repaired.map(item => item.file), backupDirectory: repaired.length ? backupDirectory : null };
}

module.exports = { APP_ID, windowsIdentity, quoteWindowsArgument, ownsShortcut, correctShortcut, repairWindowsShortcuts };
