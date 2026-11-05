# Cabrillo

A 10 minute group planning session for 3 to 5 people, with an AI that listens. The group chats to agree on one plan (a weekend outing, a class project split, or a club social). A clearly labeled AI reads the chat, keeps a shared "Plan so far", and asks a question now and then. Each person also holds one private limit, such as a budget or a day they cannot do. At the end, everyone sees whose limits came up and whether the plan respects them.

Team 19, COGS 123 (Social Computing), UC San Diego. Place names are real; every limit, price, and time in a session is invented for play.

## What people can do

- **Create an account** (email and password) or **play as a guest** with just a name. Both require agreeing to the research notice, which says that an AI reads the table chat.
- **Play now**: join the next table with whoever is online. If fewer than 3 people arrive within a minute, labeled AI players fill the empty seats.
- **Private table**: pick a task, create a code, and play with friends.
- **Class session** (accounts only): pick a task and the AI mode, everyone joins one code, the host presses Start, and the app splits people into tables of 3 to 5. The host console shows every table live, can move a table to the next stage, and can run the AI by hand (Wizard of Oz).
- **Compare AI modes**: in a class session, tables can alternate between the listening AI and an answer-only AI (like ChatGPT group chats), for a fair comparison.
- **History** and **data export** (anonymized CSV files: logs, players, sessions, feedback). Player names are replaced by codes such as P01.

## The session (10 minutes)

| Stage | Length | What happens |
|---|---|---|
| Set up | 1 min | Read the task and your private limit. Ends early when every person taps "I am ready". |
| Chat | 6 min | Chat freely. Ask for a ride or a table ("book an uber", "reserve a table") and the AI prepares a booking card with a price and an even split; it books (as a demo, nothing is charged) only when everyone taps "Price looks right". The listening AI updates the Plan so far, asks at most 2 questions (limits check, a conflict, an open question, or a consensus check; the cap was lowered from 3 after the Phase 2 survey), and invites quiet people privately. Anyone can pause it. Type @AI to ask it something. Ends early when everyone taps "Ready to confirm". |
| Confirm | 2 min | The AI drafts the plan from the chat. Anyone can change a choice; any change clears all accepts. The plan locks when everyone accepts a complete plan. |
| Wrap up | 1 min | Every limit is shown, with when it came up and whether the plan respects it. Three quick feedback questions. |

The listening AI is rule based, so it works without any API key. An optional `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` lets a model answer @AI questions; otherwise answers are scripted.

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
4. Watch the tables. To test the AI by hand, press **Run the AI myself** on a table and type as the AI. Questions players ask the AI then wait for you.
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
server/game.js      one table: stages, timers, the listening AI's interjections and nudges, AI players, logging
server/listener.js  reads the chat: which options each person supports or rejects, and the Plan so far
server/tasks.js     the tasks: plan fields, options, private limits, game information
server/lobby.js     rooms, class sessions, Play now matching, table splitting, AI mode per table
server/ai.js        answers to @AI questions (Anthropic or OpenAI if a key is set, scripted otherwise)
server/auth.js      accounts, guests, sign-in cookies
server/db.js        Postgres tables and event logging
client/src/         React app (pages for sign-in, home, waiting room, game, host console, history)
tests/e2e.mjs       end-to-end test
```

## Research and privacy

Every action is logged with a timestamp, a player code, and whether a human, the AI, an AI player, or the host acted. Display names inside logged messages are replaced by codes. Accounts store an email, a display name, and a hashed password only. This is a course project: if you want to publish results from people outside the class, get IRB review first.
