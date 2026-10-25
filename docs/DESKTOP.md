# Pralayam as a desktop app

The laptop runs Pralayam like an installed program: double-click the icon, the hub starts, the big screen opens in
its own window, and closing that window stops the hub. Phones need nothing new: they already install the game from the
hub as a web app (open `https://<HUB_IP>:3443` on the phone, then "Add to Home screen").

## Set it up once (Windows)
```
npm install
copy .env.example .env      # HUB_IP and a COORDINATOR_PASSCODE of 8+ characters
npm run certs
npm run app:shortcut        # puts "Pralayam" on the desktop and in the Start menu
```
Then double-click **Pralayam**. The first run builds the game (about a minute). To remove it, delete the two
`Pralayam.lnk` files the command printed and the folder `%LOCALAPPDATA%\Pralayam`.

## What the app does
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

## Commands
| Command | What it does |
|---|---|
| `npm run app` | Same as the icon, from a terminal. `--fullscreen` opens full screen, `--keep-hub` leaves the hub running after the window closes. |
| `npm run app:check` | Prints what the app would do (screen address, browser found, hub running or not, build present) and exits. Run it before every demo. |
| `npm run app:shortcut` | Creates the desktop and Start menu icon (Windows). |
| `npm run e2e:desktop` | Real-browser test of the whole lifecycle on throwaway ports. |

## Why not Electron or a packaged .exe
It would add roughly 100 MB, a second build pipeline, and a rebuild of the SQLite module for Electron's runtime, and
it would change nothing a player sees. The launcher uses the Edge already on the laptop, adds no dependencies, and keeps
`npm start` working as before (DECISIONS D21). A single installer can be added later without touching the game.
