// Puts a "Pralayam" icon on the Windows desktop and in the Start menu that runs the desktop app (scripts/desktop.mjs).
// The icon is drawn from web/public/icon.svg into an .ico under %LOCALAPPDATA%\Pralayam. Windows only; see docs/DESKTOP.md.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

if (process.platform !== 'win32') {
  console.error('The shortcut script is for Windows. On other systems run: npm run app');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Pralayam');
mkdirSync(dir, { recursive: true });

// .ico = 6-byte header + one 16-byte directory entry + a PNG (Windows accepts PNG inside an icon since Vista)
const png = await sharp(path.join(root, 'web', 'public', 'icon.svg'), { density: 384 }).resize(256, 256).png().toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(1, 4); // one image
head[6] = 0; // width 256 is stored as 0
head[7] = 0; // height 256 is stored as 0
head.writeUInt16LE(1, 10); // colour planes
head.writeUInt16LE(32, 12); // bits per pixel
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(22, 18); // offset of the image data
const ico = path.join(dir, 'pralayam.ico');
writeFileSync(ico, Buffer.concat([head, png]));

// PowerShell reads its inputs from the environment, so no path ever needs quoting
const script = `
$ProgressPreference = 'SilentlyContinue'
$ws = New-Object -ComObject WScript.Shell
foreach ($where in @('Desktop', 'Programs')) {
  $folder = [Environment]::GetFolderPath($where)
  $lnk = $ws.CreateShortcut((Join-Path $folder 'Pralayam.lnk'))
  $lnk.TargetPath = $env:PRALAYAM_NODE
  $lnk.Arguments = '"' + $env:PRALAYAM_SCRIPT + '"'
  $lnk.WorkingDirectory = $env:PRALAYAM_ROOT
  $lnk.IconLocation = $env:PRALAYAM_ICO
  $lnk.WindowStyle = 7
  $lnk.Description = 'Pralayam: the flood-night game. Starts the hub and opens the big screen.'
  $lnk.Save()
  Write-Output ((Join-Path $folder 'Pralayam.lnk'))
}
`;
const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
  env: { ...process.env, PRALAYAM_NODE: process.execPath, PRALAYAM_SCRIPT: path.join(root, 'scripts', 'desktop.mjs'), PRALAYAM_ROOT: root, PRALAYAM_ICO: ico },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log('Shortcuts created:\n' + out.trim().split(/\r?\n/).map((l) => '  ' + l).join('\n'));
console.log('Double-click "Pralayam" to start the hub and open the big screen. Closing the window stops the hub.');
