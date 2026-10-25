# Pralayam — visual design system ("Monsoon night", pixel edition)

> **2026-10-25, after G3:** the screen was restyled as an old 2D pixel game at the team's request. What follows in
> this section is the pixel edition that is live; the original "glass and glow" sections below it stay as the
> source of layout, copy and motion rules, read through the pixel lens (no blur, no gradients, no rounded corners).

## 0. Pixel edition

**Research we leaned on.** Retro UI guides agree on a few rules: align every panel and sprite to an integer pixel or
tile grid and scale only by whole numbers; use a compact indexed palette with explicit light, midtone, shadow and
status colours and turn smoothing off; build dialog frames from stair-stepped corners and hard pixel drop shadows
rather than soft shadows; keep typography blocky and short. NES/SNES HUDs put the score (zero-padded), the round and
a timer on one strip, blink what needs attention, and animate in steps, never with easing.

**Palette, 16 colours** (`web/src/screen/sprites.ts`, mirrored as `--p-*` tokens in `web/src/game/theme.css`):
black #0b0b14 · navy #141b33 · blue-dark #1c2b55 · blue #2a4ba3 · water-1 #1f6f8b · water-2 #36a3c9 · foam #9be7ff ·
wall #e8d9b5 · roof #b5473a · wood #4a2f1f · yellow #ffd23f · orange #ff7b2e · red #ff3c5f · green #3fd6a0 ·
grey #8a93a6 · white #f4f1ea. Bands: red = red, orange = orange, yellow = yellow (urgency bands).

**Type.** Press Start 2P (OFL) for headings, numbers, labels and buttons at 10–44 px; Pixelify Sans (OFL) for body at
15–22 px; both bundled from `@fontsource`. No pixel Malayalam exists, so `html[lang=ml]` falls back to Noto Sans
Malayalam. Font smoothing is turned off on the big screen.

**Boxes.** Every panel is the NES dialog box: 4 px light frame, 4 px dark inset line, 8 px hard shadow. Buttons are
the same box with a 4 px shadow that shrinks to 2 px when pressed. No border radius anywhere.

**Map.** Everything is rects on a 4-unit grid with `shape-rendering: crispEdges`: houses, temple, school, camp,
hospital, jetty and boats are bitmap sprites (`sprites.ts`); the river is a staircase polygon that climbs 28 units per
water level in 7 steps; the surface is a dithered checker band with a square-wave foam row drifting in 4 steps; dead
zones are checkerboard squares with a dashed frame; calls are square frames in the band colour (red ones blink);
boats slide between nodes in 10 steps; rain is 2×8 blocks falling in 14 steps. Node names are uppercase; a flooded
house shows its roof over two rows of water and a "~" after its name; a safe shelter shows "✦".

**HUD.** Score is zero-padded (0170, -045). Stars are 9×7 pixel sprites. The timer sits in a yellow frame and turns
red under 10 s. Toasts are small black boxes with a coloured 3 px frame. A faint CRT scanline overlay (12 %) sits
under the overlays so the lobby QR stays crisp for cameras; the small QR in the bar is raised above it.

**Second pass: what the best 2D games do.** Looking at Stardew Valley, Advance Wars, Fire Emblem, Zelda (A Link to
the Past) and Celeste gave five rules we now follow. (1) A tile *world*, not sprites on a flat card: the land is a
dithered soil tile with grass ticks, coconut palms stand on the banks, the paddy fields are striped tiles, and the river
is a channel with two banks (a polyline centre line keeps every house on a bank) that widens upward as the level rises,
so a flooded house really stands in water. (2) Every sprite has a 1-pixel black outline (an `feMorphology` dilate
filter) and every label a dark stroke, so they read on any tile at 5 m. (3) Light sells night: houses with people
calling get a dithered yellow halo and lit windows. (4) Units are alive: boats bob two frames at rest, foam alternates
two frames, rain falls diagonally, lightning flashes every ~23 s. (5) Feedback where it happens: score pops ("+30",
"-45") rise from the house in 8 steps; the panel shows people as pixel figures (child, elder, person) and kits as icons;
the water level is a four-segment bar. Roads are a dark bed with a dashed wood crown. The lobby logo is three-layer
(yellow, orange step, black drop).

**Third pass: craft rules from the pixel-art guides (2026-10-25).** We read the 2D-art skill guides on
awesomeskill.ai and gameskill.dev (the Aseprite draw/shade/outline/animate rules, the "pixel art as code" lighting
model, the Unity pixel-perfect notes) and applied the rules that fit a night flood on a projector:

1. *One light, upper-left, on every sprite.* Each material now has a base, one shadow step and one light step
   (`shade()` and `light()` in `web/src/game/sprites.ts`). Ramps are hue-shifted: shadows move toward blue-purple
   and lose saturation, lights move toward yellow and gain it; "just darker" is never used. Roofs catch light on the
   left slope, walls shade on the right, a shadow row sits under every eave and every base.
2. *Lamps are the hero of a night.* Light falls off in three rings, solid → 50 % ordered dither → 25 % dither, into
   the ambient land colour; rings are crosses, not boxes, so the pool has cut corners. Called houses glow while someone
   waits, safe places glow all night (hospital in white), and every boat carries a lantern on its mast with its own
   small pool, so crews read in the dark. People stand on a flooded roof while the call still has roof rounds left.
3. *No semi-transparent pixels.* Roads, dead-zone checkers, paddy rows, rain, water dither and lamp rings are all solid
   palette mixes (`mix()`), as the guides' validators demand. Dither only sits between neighbours on a ramp.
4. *Water as a ramp.* Deep water is a 50 % dither of water-1 over the mid tone, a lighter water-2 shelf runs inside
   the bank, then the foam line; foam ticks swap on two frames.
5. *Integer scaling.* The map picks the largest scale at which one 4-unit pixel is a whole number of device pixels
   and windowboxes in its frame (the land tile fills the gutters); the phone draws at one unit per CSS pixel, snapped
   the same way. Nothing shimmers.
6. *Idle is not a metronome.* The boat bob is four whole-pixel frames with 150/100/100/150 holds; the crew marks and
   label lag one frame behind the hull (secondary motion). Lightning has an anticipation flicker before the strike.
7. *Depth.* Sprites are y-sorted so a southern house overlaps its northern neighbour; rain falls in two sheets, a
   slower dim one far away and a faster bright one in front.

The sprite sheet is validated by `web/src/game/sprites.test.ts`: no ragged rows, no glyph without a colour, ramps
that darken and cool or lighten and warm.

**Logo and icons (2026-10-25).** The logo is one pixel scene, `web/src/game/logo.ts`: an orange rescue boat with a
red pennant and one big lantern on dark flood water, a child waving from a half-drowned roof, rain, and the lantern's
light as a warm dithered ramp (dusk brown, ember, burnt orange; never yellow mixed into navy, which goes khaki). It is
32x32 cells, full bleed, drawn with the same palette and ramps as the sprites. `npm run icons` renders it to
`icon.svg` (favicon and in-app mark), `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` and a maskable
`icon-maskable-512.png` (the same scene on a 40-cell grid so a circular crop keeps the boat); the Windows shortcut
builds a multi-size `.ico` from the 512. A unit test keeps the subject inside the crop-safe circle.

**Motion.** Stepped only: `steps(n)` on every transition and keyframe; blink at 0.8 s; "▶ PRESS START" blinks in the
lobby. `prefers-reduced-motion` stops all of it.


The game must feel premium on a projector and on a five-year-old Android phone, with nothing loaded from the
Internet. One design system for both surfaces; the big screen is the hero, the phone is the controller.

## 1. Mood
A night of rain seen from a control room: dark water, lamplight, radio glow. Calm, not panicky. Hand-drawn map
on dark paper, not a satellite view. Everything that matters glows; everything else recedes.

## 2. Tokens (CSS custom properties, `web/src/game/theme.css`)

| Token | Value | Use |
|---|---|---|
| `--night-0` | `#070D18` | page background (screen) |
| `--night-1` | `#0B1526` | map paper / cards |
| `--night-2` | `#12203A` | raised cards, buttons |
| `--night-3` | `#1C2F52` | borders, dividers (at 60% alpha) |
| `--water-0` | `#0C3146` | deep water |
| `--water-1` | `#16607A` | water surface |
| `--water-2` | `#2FA8C4` | water highlight / waves |
| `--lamp` | `#FFB74D` | lamplight, timers, selected |
| `--ember` | `#FF6B35` | rescue action, orange band |
| `--alarm` | `#FF3B5C` | red band, lost, danger |
| `--moss` | `#2EC4B6` | saved, safe, in contact |
| `--signal-off` | `#8A93A6` | out of contact, disabled |
| `--ink` | `#F4F1EA` | primary text (warm white) |
| `--ink-2` | `#B9C0CF` | secondary text |
| `--ink-3` | `#7D8597` | hints |
| `--glass` | `rgba(255,255,255,.06)` | glass card fill |
| `--glass-line` | `rgba(255,255,255,.12)` | glass card border |
| `--shadow` | `0 20px 60px rgba(0,0,0,.45)` | floating panels |
| `--radius` | `20px` (screen) / `16px` (phone) | |

Band colours: red = alarm, orange = ember, yellow = lamp.
Contrast: every text token on `--night-0..2` is ≥ 7:1; `--ink-3` on `--night-1` is 4.6:1 and only used for hints.

## 3. Type
Self-hosted (OFL) via the `@fontsource` packages, bundled by Vite into `web/dist/assets`, never from a CDN at runtime:
- **Fraunces** (display, optical size 72+, soft serif) for the title, round numbers, the score.
- **Manrope** (UI) for everything else.
- **Noto Sans Malayalam** for `html[lang=ml]`, same sizes +5%.

Big screen (1080p, read from 5 m): title 88px, round number 120px, score 72px, call cards 28px, hints 22px.
Phone: display 36px, buttons 20px, body 17px, hint 14px. Line height 1.2 display / 1.45 body.
Numbers use `font-variant-numeric: tabular-nums` so timers do not jitter.

## 4. The map
- SVG, 1000 × 600 map units, drawn once, animated with CSS/JS transforms.
- Paper: `--night-1` with a subtle noise (inline SVG `feTurbulence`, 4% opacity), hand-drawn feel from a 1.5px
  stroke in `--ink-3` with `stroke-linecap: round` and slightly irregular paths.
- Water: a layered path with three sine-wave strokes in `--water-1/2` drifting at 8 s / 11 s / 14 s periods.
  Water level is a clip-path height; rising animates over 1.2 s with `cubic-bezier(.2,.8,.2,1)`.
- Nodes: house = small isometric roof icon; temple = spire; school = flag; camp = tent; hospital = cross; jetty =
  pier. Flooded house: roof only, blue tint, a tiny pulse. Dead zones: hatched region with a crossed-out radio icon.
- Calls: a glowing ring (band colour) with the people count inside and small icons for child/elderly/urgent.
  Ring radius breathes 2 s; red band breathes faster (1.2 s).
- Boats: 36px rounded hull in the crew colour with the crew's initials, a white wake while moving. Move
  animation: 800 ms along the edge (`offset-path`), slight bob. Out of contact: 40% opacity, dashed outline, a
  dotted line to its last-heard node, label "no signal since R4".
- Rain: 60 thin lines falling (CSS animation, `will-change: transform`), 12% opacity, off when
  `prefers-reduced-motion`.

## 5. Big screen layout (1920 × 1080)
```
┌───────────────────────────────────────────────────────────────────────┐
│ PRALAYAM  Thuruthu ward                 Round 4 / 10   ⏱ 0:32   ★★☆  │  top bar, glass, 96px
├───────────────────────────────────────────────┬───────────────────────┤
│                                               │  CALLS (by urgency)   │
│                                               │  ● 92  Vattappara     │
│              hand-drawn map                   │     6 people · child  │
│          boats, calls, water, rain            │  ● 71  Pallithode     │
│                                               │  ● 55  School         │
│                                               │  …                    │
│                                               ├───────────────────────┤
│                                               │  CREWS                │
│                                               │  ▮ Asha  at school 3/4│
│                                               │  ▮ Boat 2  no signal  │
├───────────────────────────────────────────────┴───────────────────────┤
│  SCORE 180  · saved 12 · lost 0              [QR]  join: 10.10.19.202 │  bottom bar
└───────────────────────────────────────────────────────────────────────┘
```
- Lobby: the map dimmed, a 420px QR in the centre with "scan to crew a boat", crews dock at the jetty as they
  join (hull slides in, name tag fades up). "Start" button for the host.
- Resolving: top bar shows "Resolving…"; events play as toasts bottom-left ("Asha rescued 3 at Vattappara +30")
  and animations on the map; the score counts up with a 600 ms tween.
- End: map fades to 30%, a centred glass panel: Fraunces "First light", stars animate in, three stat rows with the
  2018 lines, crews ranked by people delivered, "Play again" / "Show the real tool" (opens the dashboard).

## 6. Phone layout (390 × 844, works at 320) — full-screen edition
Three bands, top to bottom, nothing hidden behind a button. No app header while playing.
```
┌──────────────────────────┐
│ ▮ Asha      Round 4  0:32│  HUD strips: crew chip, round, timer (lamp); seats, queued, kits
│ ▢▢▢▢ 3/4 aboard  💧🍚🩺  │
│      the same WardMap    │  pan box (one unit per CSS pixel): the map stays where you left it;
│      as the big screen   │  it frames your boat once, then only if the boat leaves the window.
│ Go to Vattappara · 2 mv  │  floating over the map's foot: the tapped place with one GO, or the
│ 4 waiting   [GO] [✕]     │  "en route" line, or "You are at … · tap a place". No-signal banner
│                          │  and the round card float over the map's head.
├──────────────────────────┤
│ ➜ Move · Kavala          │  the move list, always open (max 54% of the screen, scrolls inside):
│ ➜ Move · Kumbalam        │  single-move rows, SEND ORDER / QUEUE NEXT, "if I lose signal"
│ [     SEND ORDER      ]  │  hold/return, language toggle
└──────────────────────────┘
```
- Confirm: button fills left-to-right 300 ms, haptic `navigator.vibrate(20)`, row shows "sent ✓" and stays
  editable until the deadline ("change").
- No signal: a full-width banner at the top in `--signal-off` with a radio icon: "No signal here · 2 orders
  queued · last update 1 min ago". The map and numbers go to 60% and show "last known". The timer reads
  "~R6" with a tilde.
- Round result: a 2 s card slides up: "+30 · you rescued 3 at Vattappara".
- End: same stats as the screen, your own line "you delivered 7".
- All targets ≥ 56px, text ≥ 17px, no horizontal scroll at 320px, Malayalam labels tested.

## 7. Motion rules
Durations: 150 ms micro (hover, press), 300 ms panels, 800 ms boat move, 1200 ms water. Easing
`cubic-bezier(.2,.8,.2,1)` for enters, `ease-in` for exits. Never more than three things animating at once on the
phone. Everything respects `prefers-reduced-motion` (rain off, moves become fades).

## 8. Sound (WebAudio, synthesized, no files; muted until the host taps the speaker)
- Rain bed: filtered noise, −28 dB, on the big screen only.
- Call opened: two-note chime (E5 → B5, 120 ms).
- Rescued: short rising arpeggio. Saved at camp: warm major chord, 400 ms.
- Lost: low thud (80 Hz sine, 300 ms) and a 1 s pause in the rain.
- Round end: single soft bell. Phone: a 60 ms tick on send, nothing else.

## 9. Iconography
One inline SVG sprite, 1.75px strokes, rounded: house, roof, temple, school, tent, cross, pier, boat, person,
child, elderly, water drop, rice bowl, medical kit, radio, radio-off, star, clock. Emoji only as a fallback.

## 10. Accessibility
Colour never carries meaning alone (band rings also differ in ring thickness and show the number). Live regions
for round changes. Focus rings in `--lamp`. The phone works with font scaling at 130%.
