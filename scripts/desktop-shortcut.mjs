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

// .ico = a 6-byte header, one 16-byte directory entry per size, then the PNGs (Windows accepts PNG inside an icon).
// 256 and 32 are exact whole-number steps of the 32-cell logo, so they stay crisp; 48 and 16 are scaled down.
const src = path.join(root, 'web', 'public', 'icon-512.png');
const sizes = [256, 48, 32, 16];
const pngs = await Promise.all(sizes.map((n) => sharp(src).resize(n, n, { kernel: n === 256 || n === 32 ? 'nearest' : 'lanczos3' }).png().toBuffer()));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((n, i) => {
  const o = 6 + 16 * i;
  head[o] = n === 256 ? 0 : n; // 256 is stored as 0
  head[o + 1] = n === 256 ? 0 : n;
  head.writeUInt16LE(1, o + 4); // colour planes
  head.writeUInt16LE(32, o + 6); // bits per pixel
  head.writeUInt32LE(pngs[i].length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
const ico = path.join(dir, 'pralayam.ico');
writeFileSync(ico, Buffer.concat([head, ...pngs]));

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
