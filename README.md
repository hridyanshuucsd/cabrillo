# Cabrillo

A group planning chat for 3 to 5 people, with a clearly labeled AI that listens. The group chats to agree on one plan (a weekend outing, an apartment for next year, a club social, and 17 more scenarios). The AI reads the chat, keeps "The plan so far" above it, and adds a map, a ride price, or a table when the chat calls for one. Each person also holds one private limit, such as a budget or a day they cannot do. At the end, everyone sees whose limits came up and whether the plan respects them.

Team 19, COGS 123 (Social Computing), UC San Diego. Place names are real; every limit, price, and time in a session is invented for play.

## What people can do

- **Join a class session** from a link or QR code: type a first name, agree to the research notice, and land at a table at once. No account is needed.
- **Create an account** (email and password) to host a class session, play with friends at a private table, see history, and open analytics.
- **Play now**: join the next table with whoever is online. If fewer than 3 people arrive, labeled AI players fill the empty seats.
- **Compare AI modes**: in a class session, half the tables get the listening AI and half get an answer-only AI (like ChatGPT in a group chat). The split stays balanced even when a table closes before it starts.
- **Analytics after a session**: plans, private limits, participation, what the AI did, feedback, and an anonymized transcript of every table, with CSV files ready for a statistics tool.

## The session (three steps, no timer on the chat)

| Step | What happens |
|---|---|
| 1. Briefing | Three short screens: the task and what the group decides; your private limit (keep it, get a different one, or write your own); how the chat works. Ends when everyone taps "I am ready", or 90 seconds after the table starts. A person is chatting within 3 minutes of joining. |
| 2. Chat | Chat freely. There is no timer. The plan above the chat has one chip per part (for example Where, When, Getting there, Budget). A part is filled in by what people **say** (listening tables) or by what they **tap** (all tables); the plan is what most of the table wants. When every part has a choice, a plan card appears and each person taps **Accept**. Any change to the plan clears the accepts. The plan locks when everyone has accepted. |
| 3. Results | Every limit is shown, with whether it was shared and whether the plan respects it. Six quick taps of feedback. |

**Sharing a private limit.** The limit sits in a button under the chat. Tapping it gives three choices: "Say it myself" (a draft is placed in the message box, to edit and send), "AI passes it on, with my name", or "AI passes it on, without my name". A limit that was never shared is never sent to the AI model.

**Group matters and private matters.** What the group decides is said or tapped in the open. Three things stay between one person and the AI, shown in blue with "Only you see this":

- **A private question to the AI.** The AI button next to the message box asks in the group ("Everyone sees it") or privately ("Only I see it"). Works at every table.
- **Which ride, or which time.** Whether to take a rideshare or book a table is a group decision. Once it is made, the AI asks each person privately which rides (or times) work for them, books the cheapest ride (or holds the earliest time) that works for everyone, and tells the group only the result. If nothing works for everyone it says so without naming anyone. Rides and tables are demos: nothing is booked or charged.
- **A heads-up about your limit** (listening tables): a note when the plan is heading somewhere that breaks a limit you have not shared.

**What the listening AI does.** It updates the plan from the chat; shows one line of what it is hearing; asks at most 2 questions of its own (each with tap answers); answers a question to the group about a part of the plan ("what time tho?") with the options and who picked what; speaks up when the plan stops fitting a limit somebody shared and marks the options that limit rules out; adds a map when two places are compared, a route when the plan says bus or carpool, a ride when it says rideshare, and a table when a dinner plan has a place and a time. Under another person's message, "Me too" picks what that message asked for. A question or a what-if ("if we took an uber, what would each of us pay?") is never counted as a wish. The AI never votes, and anyone can pause it.

**Asking the AI.** Type @AI (any case) or use the AI button to ask anything: about the plan, the places, costs, what to bring, or something unrelated. With a key, the answer comes in the shape that fits: a few sentences, a list, steps, a table, pros and cons with Pick buttons, the plan options to tap, or a map. Follow-up questions work. The AI never picks a winner among the group's options, never guesses a private limit, and cannot look up live information.

**The answer-only AI** (comparison tables) does none of the listening. It answers when asked (in the group or privately), passes a limit on when asked, and handles a ride or a table when someone asks for one. The plan there is filled in by taps only.

**A table that cannot agree** can end without a plan once every person asks to. The host can also end one table or all tables from the host console.

The app works without any API key: the listening is rule based and answers are scripted. Optional keys:

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: a model answers questions, rewrites the "AI hears" line, and writes the AI players' messages. With an OpenAI key the app uses the newest "Terra" model (the balanced tier) and falls back to `gpt-5.6-terra`, `gpt-5.4-mini`, then `gpt-4o-mini` if a name is not accepted for the key; `AI_MODEL` pins one model. `/api/health` shows which model answered last. Chat messages are sent with player codes in place of names. If the model is slow or rate limited, the app falls back to its rules and scripted lines, so a session never depends on it. `AI_SUMMARY=off` keeps the "AI hears" line rule based; `AI_PLAYERS=scripted` gives AI players scripted lines.
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

1. Open the site a few minutes early (the free server sleeps), sign in, choose "Set up a class session", and create it. `/api/health` should show the AI model.
2. Put the QR code on the projector. Each person who scans it types a first name and is seated at a table at once. They read the briefing while the table fills.
3. A table starts by itself when it is full, when 3 or more people have waited 40 seconds with nobody new, or 90 seconds after it opened. One or two people who have waited 90 seconds move to a table with room, or start with labeled AI players, so nobody waits more than about 3 minutes from joining to chatting. Turn "Start each table when it is full" off to hold tables until you start them.
4. When most people are in, press "Start the filling table now": people alone or in pairs move to another table first, and anyone left plays with labeled AI players.
5. Watch the tables. Each one shows its stage (filling, briefing, chatting, accepting, plan locked) and how long it has been chatting. Private notes and private questions are not shown in the console, so it is safe to project.
6. The chat has no timer. To wrap up, send a **message to every table** ("About 2 minutes left"), then press **End all running tables**.
7. Press **Open analytics**. It updates as tables finish and stays available afterward under "My past sessions".

Someone who closes the page while their table fills loses the seat after 25 seconds; someone who closes it during the chat stops holding up Accept after 45 seconds. The app has 20 scenarios, so up to 20 tables each get their own. Tables are never smaller than 3 or larger than 5.

## Analytics

Open `/analytics/CODE` (host or research admin). Everything is computed from the saved logs, so it works after a restart. People appear as codes; AI players are left out of every per-person number.

- **At a glance:** tables, people, plans locked, median time to a plan, limits that came up, limits the locked plans respect.
- **Leave out tables with AI players:** one switch recomputes everything for tables where every seat was a person.
- **Listening AI and answer-only AI, side by side:** reaching a plan, private limits, taking part, and using the AI.
- **What happened to each person's limit:** said it themselves, passed on by the AI with or without a name, came up in their words only, or never came up.
- **Feedback:** the four 1 to 5 questions as bars centered on the middle answer, plus "the AI spoke up" and "would you use this again", with a table of the same numbers and the comments.
- **Every table:** outcome, time to plan, limits, messages, questions, cards, and the transcript (private items marked).
- **Files:** `tables.csv` (one row per table), `participants.csv` (one row per person), `logs.csv`, `feedback.csv`, `sessions.csv`, `players.csv`, and `analytics.json`. The page ends with how each number is computed.

## Tests

```bash
npm run test:all         # builds, then runs every suite below (about 6 minutes)
node tests/unit.mjs      # how the chat is read and how model replies are parsed
node tests/scenarios.mjs # every scenario has a plan that respects all five limits
npm run test:e2e         # one host and six players play a class session in separate browsers; screenshots in test-shots/
node tests/mobile.mjs    # every screen at phone sizes, including with the keyboard open
node tests/cards.mjs     # the map, the ride and the table, with private answers
node tests/aiplayers.mjs # a table with AI players, scripted and against a local stand-in for OpenAI
node tests/analytics.mjs # a scripted session with a known outcome; the analytics must match it exactly
node tests/load.mjs 75   # 75 simulated students play one class session at once (about 1 minute)
node tests/smoke-remote.mjs https://your-app.onrender.com   # checks a deployed copy
node tests/live-ai.mjs https://your-app.onrender.com        # prints what the real model says at a table with AI players
```

The test uses Playwright (`npm i -D playwright && npx playwright install chromium` if it is not installed).

## Project structure

```
server/index.js     web server, API routes, realtime events, CSV export
server/game.js      one table: briefing, chat, plan from chat and taps, private questions and answers, accepting, the listening AI, AI players, logging
server/listener.js  reads the chat: which options each person supports or rejects, and the Plan so far
server/tasks.js     the first three tasks: plan fields, options, private limits, game information
server/scenarios.js 17 more scenarios, so every class table can get its own
server/lobby.js     rooms, class sessions, seating people as they join, AI mode per table
server/ai.js        everything that calls a model: answers, the "AI hears" line, AI players (scripted without a key)
server/analytics.js analytics, tables.csv, participants.csv and transcripts, computed from the saved logs
server/places.js    map coordinates, routes, ride prices, table times
server/auth.js      accounts, guests, sign-in cookies
server/db.js        Postgres tables and event logging
client/src/         React app (pages for sign-in, home, joining, the game, the host console, analytics, history)
tests/              unit, browser, phone, card, AI player, analytics and load tests
```

## Research and privacy

A limit that a person has not shared is never sent to the AI model unless they type it themselves. Private questions to the AI and private answers about a ride or a table are never shown to other players or in the live host console; they are saved under the person's code for the research team, and the consent text says so. Every action is logged with a timestamp, a player code, and whether a human, the AI, an AI player, or the host acted. Display names inside logged messages are replaced by codes. Accounts store an email, a display name, and a hashed password only. This is a course project: if you want to publish results from people outside the class, get IRB review first.
