# Pralayam — visual design system ("Monsoon night")

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

Band colours stay semantically identical to Relief Mesh: red = alarm, orange = ember, yellow = lamp.
Contrast: every text token on `--night-0..2` is ≥ 7:1; `--ink-3` on `--night-1` is 4.6:1 and only used for hints.

## 3. Type
Self-hosted (OFL, `web/public/fonts/*.woff2`, fetched once by `npm run fonts`, never from a CDN at runtime):
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

## 6. Phone layout (390 × 844, works at 320)
```
┌──────────────────────────┐
│ ▮ Asha · Boat 1   R4 0:32│  top: crew colour chip, round, timer (lamp)
│ ●●●● 3/4 aboard  💧🍚🩺  │  status strip: passengers, kits
├──────────────────────────┤
│   mini map (your area)   │  your node + neighbours only, calls as rings
├──────────────────────────┤
│  ▶ MOVE                  │  order list: 64px rows, one tap = select, second tap = confirm
│    School · 1 call · 55  │
│    Jetty                 │
│  ▶ RESCUE 3 here         │
│  ▶ DROP   💧 water       │
│  ▶ RETURN to camp (2)    │
├──────────────────────────┤
│  Standing order: Return ▾│
│ [  SEND ORDER  ] (lamp)  │
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
