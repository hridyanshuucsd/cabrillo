# Cabrillo

A 10 minute multiplayer role-play where 3 to 5 people decide how to use a campus space. Each player gets a secret role card with a goal and a private fact. The table edits one shared plan, a clearly labeled AI Administrator keeps time and the rules, and at the end every card is revealed.

Team 19, COGS 123 (Social Computing), UC San Diego. All places, roles, and facts in the game are fictional.

## What people can do

- **Create an account** (email and password) or **play as a guest** with just a name. Both require agreeing to the research logging notice.
- **Play now**: join the next table with whoever is online. If fewer than 3 people arrive within a minute, labeled AI players fill the empty seats.
- **Private table**: create a code and play with friends.
- **Class session** (accounts only): everyone joins one code, the host presses Start, and the app splits people into tables of 3 to 5. The host console shows every table live, can move a table to the next stage, and can switch the AI to manual so a teammate speaks for it (Wizard of Oz).
- **History**: account holders see their past sessions.
- **Data export**: the host downloads anonymized CSV files (logs, players, sessions, feedback). Player names are replaced by codes such as P01.

## The session (10 minutes)

| Stage | Length | What happens |
|---|---|---|
| Brief | 1 min | Read your role card. Ends early when every human taps "I am ready". |
| Explore | 3 min | Switch map layers, ask the AI factual questions, decide whether to share your private fact. |
| Negotiate | 5 min | Edit one shared plan (study space, club hub, green space, parking). It must total 100% with no use above 40%. The deal locks when every human accepts. Any edit clears all accepts. |
| Reveal | 1 min | Every card turns over. Two quick feedback questions. |

## Run it on your computer

Requires Node 20 or newer.

```bash
npm install
npm run dev        # starts a local database, the server on :3000, and the app on http://localhost:5173
```

To test with several players, open the app in a normal window, a private window, and a second browser.

## Put it online (free, about 15 minutes)

1. **Database (Neon).** Sign up at https://neon.tech, create a project, and copy the connection string (it starts with `postgres://`).
2. **Code (GitHub).** Push this folder to a GitHub repository.
3. **Server (Render).** Sign up at https://render.com, click New, then Blueprint, and choose the repository. Render reads `render.yaml`. When asked, paste:
   - `DATABASE_URL`: the Neon connection string.
   - `ADMIN_EMAILS`: your team's emails (they can export all data).
   - `ANTHROPIC_API_KEY`: optional. Without it the AI uses scripted answers, which work fine for class tests.
4. Open the Render URL. Create an account, then host a class session to try it.

**Free tier notes.** Render's free server sleeps after 15 minutes without visitors and takes about a minute to wake. Open the site a few minutes before a class session. Games in progress live in the server's memory, so do not redeploy during a session.

## Running a class test

1. Sign in, choose "Set up a class session", optionally paste your Google Form feedback link, and create it.
2. Put the join link or code on your intro slide. Classmates open it on their phones and continue as guests.
3. When everyone is waiting, press **Start tables**. Late arrivals can be seated by pressing Start again.
4. Watch the tables. To test the AI by hand, press **Run the AI myself** on a table and type as the Administrator. Questions players ask the AI then wait for you.
5. Afterward, download the CSV files from the host console.

## Tests

```bash
npm run build
npm run test:e2e   # one host and four players play a full session in separate browsers; screenshots in test-shots/
```

The test uses Playwright (`npm i -D playwright && npx playwright install chromium` if it is not installed).

## Project structure

```
server/index.js     web server, API routes, realtime events, CSV export
server/game.js      one table: stages, timers, actions, AI Administrator, AI players, logging
server/lobby.js     rooms, class sessions, Play now matching, table splitting
server/scenario.js  the North Lot scenario: uses, roles, goals, facts, map layers
server/ai.js        AI answers (Anthropic or OpenAI if a key is set, scripted otherwise)
server/auth.js      accounts, guests, sign-in cookies
server/db.js        Postgres tables and event logging
client/src/         React app (pages for sign-in, home, waiting room, game, host console, history)
tests/e2e.mjs       end-to-end test
```

## Research and privacy

Every action is logged with a timestamp, a player code, and whether a human, the AI, or the host acted. Display names inside logged messages are replaced by codes. Accounts store an email, a display name, and a hashed password only. This is a course project: if you want to publish results from people outside the class, get IRB review first.
