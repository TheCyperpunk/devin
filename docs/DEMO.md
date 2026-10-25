# Pralayam — the five-minute demo

Two phones, the laptop on the projector, the hotspot up. No Internet anywhere. Rehearse it three times.

## Before the judges arrive
- Laptop: hotspot or the fixed-IP Wi-Fi up first, then `npm run app:check` (it names anything wrong), then the
  **Pralayam** desktop icon (docs/DESKTOP.md; `npm start` and a browser at `https://<HUB_IP>:3443/screen.html` work
  too), F11 for full screen, passcode entered, lobby open with bots on and 45-second rounds.
- Two phones already paired (certificate trusted, app installed), one of them yours. Spare phone in your pocket.
- Sound on (speaker button) if the room allows it.

## 1. Join (30 s)
"This is Pralayam. The laptop is the control room, every phone is a boat, and there is no Internet in this room."
Hand a judge a phone, or let them scan the QR. "Pick a colour." The boat docks at the jetty on the screen.
Press **Start the night**.

## 2. Play (2 min, rounds 1–3)
"Houses are calling. The number is people, the colour is how urgent. The water rises after round 3."
Point at the phone: "Tap a place, Send. People climb aboard when you arrive. Return brings them to safety."
Let the judge play two rounds. Use **Skip round** if the room is slow. Call out the score pops.

## 3. The bend (1 min, rounds 3–5)
"Now the part this game is really about." On your phone, order a move into **Bend house**. The phone warns:
"No signal there." Choose **Set Return and go**.
"The bend has no signal. From the next round my phone cannot reach the hub. Watch." Resolve the round.
Show the phone: the grey **NO SIGNAL** banner, the estimated round, the last update time.
Queue two orders anyway: **Hold**, then **Queue as next: Mid channel**. "They wait on the phone. Nothing reaches
the hub." Point at the screen: the boat is dimmed, "no signal since R4", and the crew list says the same.
Resolve a round. "The boat followed its standing order and came back out. Now the phone is in range again."
Watch the phone's banner disappear and "2 queued" appear. Resolve two rounds: the two orders play in sequence.
"Two orders, two rounds, nothing lost, nothing played twice. That is the hub's queue: every order has an id and a
sequence number."

## 4. Airplane mode (1 min, optional but worth it)
Switch your phone to airplane mode on stage. Queue an order. Resolve a round or two on the laptop.
Airplane mode off, tap **Retry now**. The order arrives once and plays. "Same thing, real network loss."

## 5. First light (30 s)
Skip to the end. Read the three numbers and their 2018 lines. "Every order from every phone arrived exactly once."

## Rehearsal checklist (run it three times before demo day, with a timer)
1. Hub started, screen logged in, sound on, QR on the lobby: under 60 s from a cold laptop.
2. Two phones join by QR with no help from you; the third by typing the code.
3. Start the night. Say the one-line rules while round 1 counts down.
4. Round 2 or 3: one phone taps GO on the radio; say "that is a whole route, queued".
5. Send a boat into the bend. Show the phone's "No signal" banner, the screen's dashed crew card, then the
   boat coming back and its orders landing.
6. Airplane mode on one phone for 20 s, then off: the queued order arrives exactly once.
7. Skip to first light. Read the verdict line and the three numbers. Ask the room the closing question.
8. Total under five minutes; note what ran long and cut it next run.

## If something breaks
- Phone cannot load the page: wrong Wi-Fi, or the certificate is not trusted. Use the spare phone.
- Phone stuck on "Hub not reachable": the laptop changed IP. Check `HUB_IP` in `.env`; restart the hub.
- The screen shows an old round: hard-reload it; the hub keeps the game.
- Nothing works: `npm run sim` on the laptop still shows the engine playing a night in the terminal.
