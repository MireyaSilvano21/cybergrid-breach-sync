# CyberGrid: Breach & Sync

Videojuego web multijugador de extracción en tiempo real. Canvas 2D en el cliente, servidor **autoritativo** en Node con WebSockets.

## Cumplimiento de la especificación

| Módulo | Dónde se cumple |
|---|---|
| Arquitectura de red y sockets | `server/src/index.ts` (WebSocket en `/ws`, solo con token), `server/src/game.ts` (posiciones, colisiones, daño y extracción calculados en el servidor a 30 Hz). Ping/pong cada 2 s medido en un Web Worker, latencia visible en el HUD. Compensación de lag en los golpes (el servidor revisa contra lo que vio el atacante, máx. 250 ms), ataque predicho en el cliente y búfer de interpolación adaptable a la variación de la red. |
| Motor Canvas 2D y controles | `client/src/game.ts`: bucle con *delta time* (`requestAnimationFrame`), interpolación de jugadores remotos y predicción local con reconciliación por comandos (`shared/src/prediction.ts`: el servidor aplica cada tramo de movimiento en orden y confirma hasta cuál llegó; el cliente reaplica lo pendiente, así que no hay tirones aunque la red varíe). `client/src/input.ts`: teclado/mouse en PC; joystick y botones táctiles que solo aparecen en pantallas táctiles. |
| Endpoints de prueba | `GET /api/test/telemetry` (Win Rate, KDR, supervivencia y valor promedio extraído; agregados O(1)) y `POST /api/test/seed` (100–1000 partidas, validado con Zod). |
| Pruebas y CI | 55 pruebas en Vitest (`shared/test`, `server/test`), 7 flujos en Playwright (`e2e/`: acceso, lobbies, canvas en PC y móvil, arrastre táctil y saqueo), pipeline en `.github/workflows/ci.yml` en cada Pull Request. |
| Despliegue | `render.yaml` (Render, un solo servicio con SSL). |

## Bucle de juego actual

Cada equipo aparece junto a un cofre. Los cofres salen de las plantillas de sala y su tipo depende de la función de la sala: Cofre de la Forja en llegadas y galerías, Sarcófago Rúnico en los osarios, Arcón Ornamentado en santuarios y bóvedas (3 objetos, tabla rara) y un único Relicario Antiguo en el Corazón (4 objetos). Cada uno tiene tres estados: cerrado, abierto y vacío. Con **F** (o el botón **Usar** en móvil) se abre el cofre y con otra pulsación se toma el botín, que va a una mochila de 10 casillas validada en el servidor. Al morir, el botín queda en el suelo como **Restos** que cualquiera puede saquear; al extraer por un portal abierto, su valor se registra en la telemetría.

### Mapa procedural (la Grid)

`shared/src/map.ts` genera el mapa en dos niveles con la semilla de la partida:

1. **Estructura:** qué módulos de 16×16 existen, qué función tiene cada uno (llegada, galería, osario, cruce, santuario, plaza de portal, bóveda, Corazón o pasaje) y cómo se conectan (árbol al azar más lazos). El riesgo sube del borde al centro.
2. **Salas:** cada función toma una de las 28 plantillas de `shared/src/templates.ts`, girada o volteada.

Se genera un cuarto del mapa y se copia girado 90° alrededor del centro (simetría de rehilete), así los 4 equipos reciben el mismo cuarto. Las plantillas traen abismos (se ven, no se cruzan), muros delgados, rejas de un solo sentido, sellos de bóveda que se abren en la Primera Llamada y del Corazón en la Segunda, cobertura y muros en diagonal con colisión exacta.

### Estilo visual "Forja Apagada"

El cliente dibuja todo en Canvas 2D con contorno de tinta ciruela y luces saturadas: piso de losas generado por trozos de 8×8 casillas (caché LRU), muros en tres cuartos con cara y tapa, antorchas, monolitos con runas, estrado de portal con remolino, pasto que se aparta al pasar y personajes con túnica que miran hacia donde apuntan. La oscuridad se calcula a media resolución y la visión del jugador sigue siendo el mismo radio para todos (`VISION_RADIUS`). Los sprites de los cofres están normalizados a 256×256 en WebP con la base al 94 % de la altura, así los tres estados encajan sin saltos.

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
