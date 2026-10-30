const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { APP_ID, windowsIdentity, quoteWindowsArgument, ownsShortcut, repairWindowsShortcuts } = require('../electron/windows-integration.cjs');

test('installed taskbar launch targets Notes.exe with no development arguments', () => {
  const executable = 'C:\\Users\\Sample User\\Apps\\Notes\\Notes.exe';
  const appRoot = 'C:\\Projects\\Notes Source';
  const installed = windowsIdentity({ isPackaged: true, isQa: false, executable, appRoot });
  const development = windowsIdentity({ isPackaged: false, isQa: false, executable: 'C:\\Electron\\electron.exe', appRoot });
  const qa = windowsIdentity({ isPackaged: true, isQa: true, executable, appRoot });
  assert.equal(installed.appId, APP_ID);
  assert.equal(installed.relaunchCommand, '"' + executable + '"');
  assert.equal(installed.relaunchDisplayName, 'Notes');
  assert.equal(installed.appIconPath, executable);
  assert.equal(development.relaunchCommand, '"C:\\Electron\\electron.exe" "C:\\Projects\\Notes Source"');
  assert.notEqual(development.appId, installed.appId);
  assert.notEqual(qa.appId, installed.appId);
});

test('Windows command-line quoting preserves spaces, quotes and trailing slashes', () => {
  assert.equal(quoteWindowsArgument('C:\\Notes folder\\'), '"C:\\Notes folder\\\\"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
});

test('another Electron app is never considered a Notes shortcut', () => {
  assert.equal(ownsShortcut({ target:'C:\\Tools\\electron.exe',appUserModelId:'another.editor' },'C:\\Notes\\Notes.exe'),false);
  assert.equal(ownsShortcut({ target:'C:\\Tools\\electron.exe',appUserModelId:APP_ID },'C:\\Notes\\Notes.exe'),true);
});

test('broken pins are repaired in place, backed up and do not affect other apps', async t => {
  const workspace = path.resolve(__dirname,'..');
  const directory = await fs.mkdtemp(path.join(workspace,'.qa-windows-links-'));
  t.after(async () => {
    assert(directory.startsWith(workspace + path.sep));
    await fs.rm(directory,{recursive:true,force:true});
  });
  const desktop = path.join(directory,'Desktop');
  const appData = path.join(directory,'Roaming');
  const pins = path.join(appData,'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar');
  await fs.mkdir(pins,{recursive:true});
  await fs.mkdir(desktop,{recursive:true});
  const executable = path.join(directory,'Installed','Notes.exe');
  const broken = path.join(pins,'Electron.lnk');
  const unrelated = path.join(pins,'Another app.lnk');
  const healthy = path.join(desktop,'Notes.lnk');
  const correct = {target:executable,args:'',cwd:path.dirname(executable),icon:executable,iconIndex:0,appUserModelId:APP_ID};
  const shortcuts = new Map([
    [broken,{target:path.join(directory,'electron.exe'),args:'',appUserModelId:APP_ID}],
    [unrelated,{target:path.join(directory,'other.exe'),args:'',appUserModelId:'other.app'}],
    [healthy,correct]
  ]);
  for(const file of shortcuts.keys()) await fs.writeFile(file,'original shortcut bytes');
  const writes = [];
  const shell = {
    readShortcutLink(file) { if(!shortcuts.has(file)) throw new Error('Missing link'); return {...shortcuts.get(file)}; },
    writeShortcutLink(file,operation,options) { assert.equal(operation,'update'); writes.push(file); shortcuts.set(file,{...shortcuts.get(file),...options}); return true; }
  };
  const result = await repairWindowsShortcuts({shell,executable,desktop,appData,backupRoot:path.join(directory,'Backups')});
  assert.deepEqual(writes,[broken]);
  assert.deepEqual(result.repaired,[broken]);
  assert.equal(shortcuts.get(broken).target,executable);
  assert.equal(shortcuts.get(broken).args,'');
  assert.equal(shortcuts.get(unrelated).target,path.join(directory,'other.exe'));
  assert.equal(await fs.readFile(path.join(result.backupDirectory,'taskbar','Electron.lnk'),'utf8'),'original shortcut bytes');
  await repairWindowsShortcuts({shell,executable,desktop,appData,backupRoot:path.join(directory,'Backups')});
  assert.equal(writes.length,1,'A correct pin must not be rewritten every launch');
});
