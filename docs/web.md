# Web

A static website (Next.js) that reads HORI's results as files, talks to NASA services directly from the browser and
uses the database only for what needs people.

## The assistant

- Plain-language answers **without an LLM**: they are built from the numbers by rules, so the same question always gives
  the same answer and every figure can be traced.
- Three reading levels, chosen in the question box: **Simple**, **Normal**, **Expert**.
- It keeps the context of the conversation («¿y en Chihuahua?», «¿y la lluvia?»).
- **Generated components** in the answer, depending on the topic: trend charts, latest NASA conditions, livestock heat
  stress, natural events (NASA EONET), Mars dust, planets, and a simulated astronaut panel (always labelled).

Try: «¿Cómo cambia la temperatura en Durango?», «¿Mis vacas tienen calor?», «¿Qué está pasando en el mundo?»,
«La evolución de la Tierra», «Muéstrame Chihuahua en 3D», «Reporta: el arroyo se secó en Torreón».

## Monitoring

- **Map and globe** of the verdicts, as a 3D globe or a flat map.
- **NASA imagery under the data**: Blue Marble, live infrared every 10 minutes (GOES-East, GOES-West, Himawari) and
  daily layers; sharp Sentinel-2 imagery when you zoom in.
- **Evolution of the Earth**: the planet year by year, 1981 → 2025.
- **Live**: satellites now, your places, natural events.
- **Evidence**: the details behind any zone.

## 3D

- **Real 3D view**: any zone as it is — measured relief and 10 m satellite imagery.
- **Generated scene**: a diorama driven by the place's real data, with a timeline by day (NASA POWER) or by year (HORI).
  Mars and the Moon too. Always labelled as generated.

## Swarm and accounts

People with an account (email and password) can send reports to the swarm. Looking at the data never needs an account.
The session is kept on the device until you sign out.

## Interaction and app

Voice, camera gestures (pinch, palm, thumbs up, fist), numbered targets, keyboard and gamepad. Installable as an app
(PWA) and usable offline with what was already seen.

## Run

```bash
cd apps/web && npm install && npm run dev
```

`npm run build` produces the static site in `out/`.
