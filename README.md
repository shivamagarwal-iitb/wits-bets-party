# Wits & Bets Party

A multiplayer, phone-friendly trivia and virtual-chip wagering game. Independent fan-inspired implementation; not affiliated with the Wits & Wagers publisher.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Visit http://localhost:3000 on the host computer.
5. Click **Create game room**. Other devices must use the host computer's LAN IP address instead of localhost, e.g. `http://192.168.1.20:3000/?room=ABC123`. Your firewall may need to allow TCP port 3000.

## Deploy publicly

Deploy as a persistent Node.js web service (e.g. Render or Railway). Build command: `npm install`; start command: `npm start`. Configure `PUBLIC_URL=https://your-domain.example` so generated QR codes use your public URL. WebSockets must be enabled. Use one server instance for this in-memory version.

## Game flow

Lobby → Guessing → Betting → Results → Next round → Final leaderboard.

- Host creates a 5-, 7-, or 10-round game and shares a six-character room code.
- Each player starts with 100 virtual chips.
- Players submit one private whole-number guess per round, which can be updated until the host reveals guesses.
- Unique guesses are sorted and shown with displayed odds.
- Players may place up to two bets of 1–20 chips each per round, on any displayed guess.
- Closest guess **without going over** wins. A winning bet returns its stake plus profit at the displayed odds; all other bets lose their stakes. If all guesses exceed the correct answer, no bets win.
- The host manually advances the phases; there is no timer in v1.

## Important v1 limitations

- Game state is **in memory** and is lost on server restart. For production add a durable database (PostgreSQL/Redis), shared Socket.IO adapter, and persistence.
- Host and player identities are held in browser localStorage. Keep room links and host device private; for public events add stronger authentication, rate limiting, and abuse protection.
- This game uses **virtual chips only**. No real-money betting, payment integration, cash prizes, or redemption.
- The supplied trivia questions are original/common-fact examples, not copied proprietary game cards.
- One room per browser profile is supported. To test multiple players on one computer, use separate private browser windows or browser profiles.
- QR generation uses `PUBLIC_URL` (or the host browser origin), so when hosting on localhost, use the public deployment URL or a reachable LAN URL for phone scans.
