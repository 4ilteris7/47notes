param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NotesWindowProperties {
  [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out Key key);
    [PreserveSig] int GetValue(ref Key key, out Value value);
    [PreserveSig] int SetValue(ref Key key, ref Value value);
    [PreserveSig] int Commit();
  }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out Store store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern void SHChangeNotify(uint kind, uint flags, string item, IntPtr other);
  public static string Read(IntPtr window, uint id) {
    Store store; Guid storeId = typeof(Store).GUID;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref storeId, out store));
    try {
      Key key = new Key { format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id=id };
      Value value;
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.type==31 ? Marshal.PtrToStringUni(value.text) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
  public static void RefreshLink(string file) { SHChangeNotify(0x2000,0x1005,file,IntPtr.Zero); }
}
'@
$taskUser = [Environment]::GetFolderPath('UserProfile')
$taskExecutable = Join-Path $taskUser 'AppData\Local\Programs\Notes\Notes.exe'
$taskPinDir = Join-Path $taskUser 'AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$taskWsh = New-Object -ComObject WScript.Shell
$taskShell = New-Object -ComObject Shell.Application
$taskPins = @()
foreach ($taskFile in (Get-ChildItem -LiteralPath $taskPinDir -Filter '*.lnk' -File)) {
  $taskLink = $taskWsh.CreateShortcut($taskFile.FullName)
  $taskItem = $taskShell.Namespace($taskFile.DirectoryName).ParseName($taskFile.Name)
  if ($taskItem.ExtendedProperty('System.AppUserModel.ID') -eq 'local.notes.desktop' -or $taskLink.TargetPath -eq $taskExecutable) {
    if ($Refresh) { [NotesWindowProperties]::RefreshLink($taskFile.FullName) }
    $taskPins += [pscustomobject]@{file=$taskFile.FullName;target=$taskLink.TargetPath;arguments=$taskLink.Arguments;icon=$taskLink.IconLocation;appId=$taskItem.ExtendedProperty('System.AppUserModel.ID')}
  }
}
$taskWindows = @()
foreach ($taskProcess in (Get-Process -Name Notes -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExecutable -and $_.MainWindowHandle -ne 0 })) {
  $taskWindows += [pscustomobject]@{processId=$taskProcess.Id;title=$taskProcess.MainWindowTitle;appId=[NotesWindowProperties]::Read($taskProcess.MainWindowHandle,5);relaunchCommand=[NotesWindowProperties]::Read($taskProcess.MainWindowHandle,2);relaunchName=[NotesWindowProperties]::Read($taskProcess.MainWindowHandle,4);relaunchIcon=[NotesWindowProperties]::Read($taskProcess.MainWindowHandle,3)}
}
[pscustomobject]@{pins=$taskPins;windows=$taskWindows} | ConvertTo-Json -Depth 5
