# CyberGrid: Breach & Sync

Videojuego web multijugador de extracción en tiempo real. Canvas 2D en el cliente, servidor **autoritativo** en Node con WebSockets.

## Cumplimiento de la especificación

| Módulo | Dónde se cumple |
|---|---|
| Arquitectura de red y sockets | `server/src/index.ts` (WebSocket en `/ws`, solo con token), `server/src/game.ts` (posiciones, colisiones, daño y extracción calculados en el servidor a 30 Hz). Ping/pong cada 2 s medido en un Web Worker, latencia visible en el HUD. |
| Motor Canvas 2D y controles | `client/src/game.ts`: bucle con *delta time* (`requestAnimationFrame`), interpolación de jugadores remotos y predicción local. `client/src/input.ts`: teclado/mouse en PC; joystick y botones táctiles que solo aparecen en pantallas táctiles. |
| Endpoints de prueba | `GET /api/test/telemetry` (Win Rate, KDR, supervivencia y valor promedio extraído; agregados O(1)) y `POST /api/test/seed` (100–1000 partidas, validado con Zod). |
| Pruebas y CI | 33 pruebas en Vitest (`shared/test`, `server/test`), 7 flujos en Playwright (`e2e/`: acceso, lobbies, canvas en PC y móvil, arrastre táctil y saqueo), pipeline en `.github/workflows/ci.yml` en cada Pull Request. |
| Despliegue | `render.yaml` (Render, un solo servicio con SSL). |

## Bucle de juego actual

Cada equipo aparece junto a un cofre. Los cofres se colocan con la semilla del mapa y tienen tres estados: cerrado, abierto y vacío (arte del Cofre de la Forja). Con **F** (o el botón **Usar** en móvil) se abre el cofre y con otra pulsación se toma el botín, que va a una mochila de 10 casillas validada en el servidor. Al morir, el botín queda en el suelo como **Restos** que cualquiera puede saquear; al extraer por un portal abierto, su valor se registra en la telemetría.

## Estructura

```
shared/   Lógica compartida cliente-servidor: mapa procedural con semilla, física, daño,
          interpolación, Resonancia (anti-campeo), fases de la partida y esquemas Zod.
server/   Express + ws: autenticación, salas con estado "Listo", simulación y telemetría.
client/   Vite + TypeScript: acceso, lobby y partida en Canvas 2D.
e2e/      Flujos de autenticación, lobbies y canvas (PC y móvil emulado).
```

## Desarrollo

```bash
npm install
npm run dev:server   # API y WebSocket en http://localhost:3000
npm run dev:client   # cliente en http://localhost:5173 (proxy a /api y /ws)
```

## Pruebas

```bash
npm run typecheck
npm test                              # unitarias e integración
npm run build && npm run test:e2e     # end-to-end (levanta el servidor con partidas cortas)
```

## Endpoints de prueba

```bash
curl -X POST https://<tu-app>.onrender.com/api/test/seed \
  -H 'content-type: application/json' \
  -d '{"generate":{"count":1000,"seed":7},"reset":true}'

curl https://<tu-app>.onrender.com/api/test/telemetry
```

`/api/test/seed` también acepta `{"matches":[...]}` con entre 100 y 1000 partidas explícitas.

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | 3000 | Puerto HTTP |
| `AUTH_SECRET` | aleatoria | Firma de tokens (definirla en producción) |
| `TEST_ENDPOINTS` | true | Expone `/api/test/*` |
| `MATCH_SCALE` | 1 | Escala de duración: 1 = 18 min, 0.2 ≈ 3.6 min |
| `MIN_PLAYERS` | 1 | Jugadores listos necesarios para iniciar |

## Despliegue en Render

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio; `render.yaml` configura todo.
3. Verifica `https://<tu-app>.onrender.com/api/health`.

> Nota: los usuarios, salas y telemetría viven en memoria. Al reiniciar el servicio se pierden; para la evaluación se repueblan con `/api/test/seed`.
