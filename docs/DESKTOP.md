# Pralayam as a desktop app

The laptop runs Pralayam like an installed program: open it, the hub starts, the big screen opens in its own window,
and closing that window stops the hub. Phones need nothing new: they already install the game from the hub as a web
app (open `https://<HUB_IP>:3443` on the phone, then "Add to Home screen"). There is no native phone app.

There are two ways to get that window. The **Electron app** (below) is the real application: its own window and
menu, a setup screen for first run, no browser needed. The **launcher** further down does the same with the Edge
already on the laptop and is the fallback when Electron is not installed.

## The Electron app
```
npm install            # fetches Electron once (about 110 MB, Internet needed for this step only)
npm run build
npm run electron       # or: npm run electron -w desktop
```
What it does, in order:
1. Reads its settings: `settings.json` in the app's user-data folder (`%APPDATA%\@pralayam\desktop` on Windows),
   under `.env` defaults while running from the repo.
2. If the hub IP, the passcode, the certificate, Node.js or the game build is missing, opens the **setup window**:
   pick the laptop's IP from a list, set the passcode, press *Make the certificate* (runs mkcert; Windows asks for
   permission once), then *Start the night*. The setup window is also under the Pralayam menu (press Alt to show it).
3. Starts the hub as a Node child process (or reuses a hub already running on the port), with the passcode in the
   child's environment only.
4. Opens `https://localhost:3443/screen.html` in the app window, trusting the hub's certificate by its fingerprint
   and nothing else. F11 is full screen, Ctrl+R reloads, the menu has *Phone setup page*.
5. Closing the window quits the app and stops the hub it started. The game is saved after every change, so opening
   the app again resumes the night.

Node.js 20+ must be installed on the laptop, as for `npm start`. `npm run e2e:electron` is the real-window test
of this lifecycle. Packaging into a single installer is the next step and is not done yet: it needs the hub's
production dependencies staged beside the app and electron-builder, which downloads its tools at build time.

## The launcher (no Electron)

### Set it up once (Windows)
```
npm install
copy .env.example .env      # HUB_IP and a COORDINATOR_PASSCODE of 8+ characters
npm run certs
npm run app:shortcut        # puts "Pralayam" on the desktop and in the Start menu
```
Then double-click **Pralayam**. The first run builds the game (about a minute). To remove it, delete the two
`Pralayam.lnk` files the command printed and the folder `%LOCALAPPDATA%\Pralayam`.

### What the launcher does
1. Checks `.env`, the passcode and the certificate, and says plainly what is wrong.
2. Warns if `HUB_IP` is not an address of this laptop right now (hotspot or Wi-Fi not up): the screen still works,
   phones cannot reach it.
3. Starts the hub, or reuses one that is already running.
4. Opens `https://localhost:3443/screen.html` in an Edge (or Chrome) app window: no tabs, no address bar, its own
   profile, sound allowed to start. The window trusts the hub's certificate by its fingerprint, so the laptop does not
   need the root certificate installed and nothing else is trusted.
5. Closing the window stops the hub, but only if the app started it. The game is saved after every change, so
   starting again resumes the night.

You still log in with the host passcode on the screen. It is never put in a URL or on the command line.

### Commands
| Command | What it does |
|---|---|
| `npm run app` | Same as the icon, from a terminal. `--fullscreen` opens full screen, `--keep-hub` leaves the hub running after the window closes. |
| `npm run app:check` | Prints what the app would do (screen address, browser found, hub running or not, build present) and exits. Run it before every demo. |
| `npm run app:shortcut` | Creates the desktop and Start menu icon (Windows). |
| `npm run e2e:desktop` | Real-browser test of the whole lifecycle on throwaway ports. |

### Why the launcher is kept
It needs nothing beyond Node and the Edge already on the laptop, so it is the fallback when `npm install` could not
fetch Electron (DECISIONS D21 and D22).
