# Cabrillo

A group planning chat for 3 to 5 people, with a clearly labeled AI that listens. The group chats to agree on one plan (a weekend outing, an apartment for next year, a club social, and 17 more scenarios). The AI reads the chat, keeps "The plan so far" above it, and adds a map, a ride price, or a table when the chat calls for one. Each person also holds one private limit, such as a budget or a day they cannot do. At the end, everyone sees whose limits came up and whether the plan respects them.

Team 19, COGS 123 (Social Computing), UC San Diego. Place names are real; every limit, price, and time in a session is invented for play.

## What people can do

- **Join a class session** from a link or QR code: type a first name, agree to the research notice, and land at a table at once. No account is needed.
- **Create an account** (email and password) to host a class session, play with friends at a private table, see history, and export data.
- **Play now**: join the next table with whoever is online. If fewer than 3 people arrive, labeled AI players fill the empty seats.
- **Compare AI modes**: in a class session, tables alternate between the listening AI and an answer-only AI (like ChatGPT in a group chat), for a fair comparison.
- **Data export** (anonymized CSV files: logs, players, sessions, feedback). Player names are replaced by codes such as P01.

## The session (three steps, no timer on the chat)

| Step | What happens |
|---|---|
| 1. Briefing | Three short screens: the task and what the group decides; your private limit (keep it, get a different one, or write your own); how the chat works. Ends when everyone taps "I am ready", or 90 seconds after the table starts. A person is chatting within 3 minutes of joining. |
| 2. Chat | Chat freely. There is no timer. The plan above the chat has one chip per part (for example Where, When, Getting there, Budget). A part is filled in by what people **say** (listening tables) or by what they **tap** (all tables); the plan is what most of the table wants. When every part has a choice, the app says so and each person taps **Accept the plan**. Any change to the plan clears the accepts. The plan locks when everyone has accepted. |
| 3. Results | Every limit is shown, with whether it was shared and whether the plan respects it. Three quick feedback questions. |

**Sharing a private limit.** The limit sits in a button under the chat. Tapping it gives three choices: "Say it myself" (a draft is placed in the message box, to edit and send), "AI passes it on, with my name", or "AI passes it on, without my name". A limit that was never shared is never sent to the AI model.

**What the listening AI does.** It updates the plan from the chat; shows one line of what it is hearing; asks at most 2 questions of its own (each with tap answers); tells a person privately when the plan is heading somewhere that breaks their unshared limit; speaks up publicly when the plan stops fitting a limit somebody shared; adds a map when two places are compared, prices a ride when the plan says rideshare, and offers a table when a dinner plan has a place and a time. It never votes, and anyone can pause it. Type @AI (any case) to ask it anything: about the plan, the places, costs, what to bring, or something unrelated. With a key, the answer comes in the shape that fits: a few sentences, a list, steps, a table, pros and cons with Pick buttons, the plan options to tap, or a map. Follow-up questions work. "Pros and cons" questions also get the app's own facts (who wants each option, shared limits it breaks, drive time). The AI still never votes or picks a winner among the group's options, never guesses a private limit, and cannot look up live information. Rides and tables are demos: nothing is booked or charged.

**The answer-only AI** (comparison tables) does none of that. It answers when someone types @AI, and passes a limit on when asked. The plan there is filled in by taps only.

**A table that cannot agree** can end without a plan once every person asks to. The host can also end one table or all tables from the host console.

The app works without any API key: the listening is rule based and answers are scripted. Optional keys:

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: a model answers @AI questions and rewrites the "AI hears" line (with an OpenAI key the app uses the newest "Terra" model, the balanced tier, and falls back to `gpt-5.6-terra`, `gpt-5.4-mini`, then `gpt-4o-mini` if a name is not accepted for the key; `AI_MODEL` pins one model). Chat messages are sent with player codes in place of names. Set `AI_SUMMARY=off` to keep the "AI hears" line rule based.
- AI players (labeled seat fillers) use the same key to write their messages like a relaxed classmate and to reply to people; the app still checks every pick against their limit. Set `AI_PLAYERS=scripted` to use short scripted lines instead.
- `MAPBOX_TOKEN` (a Mapbox public token): in-chat maps use Mapbox tiles and Mapbox Directions. Without it, maps use Esri's free tiles and routes use the public OSRM server.

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
   - `DATABASE_URL`: the Neon connection string (required).
   - `OPENAI_API_KEY`: optional. Without it the AI uses scripted answers, which work fine for class tests.
   - `MAPBOX_TOKEN`: optional. A Mapbox public token for the in-chat maps.
   - `ADMIN_EMAILS`: optional. Your team's emails (they can export all data).
   `JWT_SECRET` is generated by Render. For local runs, copy the same names into a `.env` file (it is ignored by git).
4. Open the Render URL. Create an account, then host a class session to try it.

**Free tier notes.** Render's free server sleeps after 15 minutes without visitors and takes about a minute to wake. Open the site a few minutes before a class session. Games in progress live in the server's memory, so do not redeploy during a session.

## Running a class test

**Recommended setup for a full class (up to about 80 people):** choose "A different one for each table" and "About 4" people per table, then press "Show on projector".

1. Open the site a few minutes early (the free server sleeps), sign in, choose "Set up a class session", and create it.
2. Put the QR code on the projector. Each person who scans it types a first name and is seated at a table at once. They read the briefing while the table fills.
3. A table starts by itself when it is full, when 3 or more people have waited 40 seconds with nobody new, or 90 seconds after it opened. Turn "Start each table when it is full" off to hold tables until you start them.
4. When most people are in, press "Start the filling table now": people alone or in pairs move to another table first, and anyone left plays with labeled AI players.
5. Watch the tables. Each one shows its stage (filling, briefing, chatting, accepting, plan locked) and how long it has been chatting. You can open a table's chat early, end one table, or press **End all running tables** when you want to move on. The chat has no timer, so this button is how the activity ends for tables that are still talking.
6. Afterward, download the CSV files from the host console.

Someone who closes the page while their table fills loses the seat after 25 seconds; someone who closes it during the chat stops holding up Accept after 45 seconds. The app has 20 scenarios, so up to 20 tables each get their own; after that a scenario repeats with the other AI mode. Tables are never smaller than 3 or larger than 5.

## Tests

```bash
npm run build
npm run test:e2e         # one host and six players play a class session in separate browsers; screenshots in test-shots/
node tests/mobile.mjs    # every screen at phone sizes, including with the keyboard open
node tests/cards.mjs     # the map, ride and table cards the AI adds
node tests/aiplayers.mjs # a table with AI players: replies, the options card, the route card, the plan card
node tests/load.mjs 75   # 75 simulated students play one class session at once (about 1 minute)
node tests/scenarios.mjs # every scenario has a plan that respects all five limits
node tests/smoke-remote.mjs https://your-app.onrender.com   # checks a deployed copy
```

The test uses Playwright (`npm i -D playwright && npx playwright install chromium` if it is not installed).

## Project structure

```
server/index.js     web server, API routes, realtime events, CSV export
server/game.js      one table: briefing, chat, plan from chat and taps, accepting, the listening AI, AI players, logging
server/listener.js  reads the chat: which options each person supports or rejects, and the Plan so far
server/tasks.js     the first three tasks: plan fields, options, private limits, game information
server/scenarios.js 17 more scenarios, so every class table can get its own
server/lobby.js     rooms, class sessions, seating people as they join, AI mode per table
server/ai.js        answers to @AI questions and the "AI hears" line (OpenAI or Anthropic if a key is set, scripted otherwise)
server/places.js    map coordinates, routes, ride prices, table times
server/auth.js      accounts, guests, sign-in cookies
server/db.js        Postgres tables and event logging
client/src/         React app (pages for sign-in, home, waiting room, game, host console, history)
tests/e2e.mjs       end-to-end test
```

## Research and privacy

A limit that a person has not shared is never sent to the AI model. Every action is logged with a timestamp, a player code, and whether a human, the AI, an AI player, or the host acted. Display names inside logged messages are replaced by codes. Accounts store an email, a display name, and a hashed password only. This is a course project: if you want to publish results from people outside the class, get IRB review first.
