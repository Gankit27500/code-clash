# Code Clash

A real-time quiz battle for 2–8 players. It uses Node.js and the built-in HTTP/WebSocket APIs, so there are no packages to install.

## Start a game

1. Install Node.js 24 LTS on the computer that will host the room.
2. Open PowerShell in this folder and run `npm start` (or `node server.js`). Run `npm test` to execute the repeatable server tests.
3. On the host computer, open `http://localhost:3000` and create a room.
4. For other players on the same Wi-Fi, share the host computer's local network address, such as `http://192.168.1.25:3000`, and the six-character room code. They open that address on their own devices and join.

The host computer must stay on and keep the server running during the game. If Windows Firewall asks, allow Node.js on your private network so other devices can connect. To stop the server, press Ctrl+C in its PowerShell window.

## Rules

- 10 multiple-choice questions, with a 15-second limit per question.
- A correct answer earns 100 points plus a speed bonus of up to 100 points. The bonus decreases with time remaining; a faster answer earns more.
- Incorrect or unanswered questions earn zero points.
- Answers lock after selection. The next question starts after all players answer, or after the timer expires; the answer and scores are then revealed.
- The highest total score wins. Tied top scores share the win.

The server keeps the room, answer submissions, deadlines, scoring, and leaderboard authoritative. Rooms can be joined from 2 to 8 devices.

## Public deployment (Render)

This project is configured as one Render Node web service. It serves the static game and its WebSocket endpoint from the same HTTPS URL, so browsers use secure WebSockets automatically. The single-instance setting is required because active rooms are held in server memory; scaling to multiple instances would split players across separate room maps.

1. Put this project in a GitHub repository that your Render account can access. Include `server.js`, `package.json`, `render.yaml`, and the `public/` folder at the repository root.
2. In Render, create a **Blueprint** and connect that repository. Render reads `render.yaml` to configure the web service.
3. Choose the paid `0.5c-512mb` plan for an always-on service. Render currently lists it at **US$7/month**. The free plan sleeps after 15 minutes without inbound traffic and can restart at any time, so it is not the recommended option for a shared live game. Check the current price before creating the service.
4. Deploy the Blueprint. Render assigns an `onrender.com` URL and provides TLS. Open that URL, create a room, and share the URL plus room code with players on other networks.
5. Confirm `https://<your-service>.onrender.com/healthz` returns `{"status":"ok"}`. Then test room creation, joining, live question/timer state, answer scoring, and the final leaderboard from separate devices.

The Blueprint uses Singapore for lower latency in South Asia, one service instance, a health check, and manual deploys. Manual deploys avoid automatically replacing the server while people are playing. Room data is in memory: a server restart or deploy ends active rooms, so deploy between games. Do not increase the instance count unless room state is moved to a shared datastore and tested across instances.
