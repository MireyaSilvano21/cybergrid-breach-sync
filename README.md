# CyberGrid: Breach & Sync

Videojuego web multijugador de extracción en tiempo real. Canvas 2D en el cliente, servidor **autoritativo** en Node con WebSockets.

## Cumplimiento de la especificación

| Módulo | Dónde se cumple |
|---|---|
| Arquitectura de red y sockets | `server/src/index.ts` (WebSocket en `/ws`, solo con token), `server/src/game.ts` (posiciones, colisiones, daño y extracción calculados en el servidor a 30 Hz). Ping/pong cada 2 s medido en un Web Worker, latencia visible en el HUD. Compensación de lag en los golpes (el servidor revisa contra lo que vio el atacante, máx. 250 ms), ataque predicho en el cliente y búfer de interpolación adaptable a la variación de la red. |
| Motor Canvas 2D y controles | `client/src/game.ts`: bucle con *delta time* (`requestAnimationFrame`), interpolación de jugadores remotos y predicción local con reconciliación por comandos (`shared/src/prediction.ts`: el servidor aplica cada tramo de movimiento en orden y confirma hasta cuál llegó; el cliente reaplica lo pendiente, así que no hay tirones aunque la red varíe). `client/src/input.ts`: teclado/mouse en PC; joystick y botones táctiles que solo aparecen en pantallas táctiles. |
| Endpoints de prueba | `GET /api/test/telemetry` (Win Rate, KDR, supervivencia y valor promedio extraído; agregados O(1)) y `POST /api/test/seed` (100–1000 partidas, validado con Zod). |
| Pruebas y CI | 87 pruebas en Vitest (`shared/test`, `server/test`), 10 flujos en Playwright (`e2e/`: acceso, campamento con escuadra y emparejamiento, lobbies, equipos, canvas en PC y móvil, arrastre táctil, saqueo y combate), pipeline en `.github/workflows/ci.yml` en cada Pull Request. |
| Despliegue | `render.yaml` (Render, un solo servicio con SSL). |

## Bucle de juego actual

Cada equipo aparece junto a un cofre. Los cofres salen de las plantillas de sala y su tipo depende de la función de la sala: Cofre de la Forja en llegadas y galerías, Sarcófago Rúnico en los osarios, Arcón Ornamentado en santuarios y bóvedas (3 objetos, tabla rara) y un único Relicario Antiguo en el Corazón (4 objetos). Cada uno tiene tres estados: cerrado, abierto y vacío. Con **F** (o el botón **Usar** en móvil) se abre el cofre y con otra pulsación se toma el botín, que va a una mochila de 10 casillas validada en el servidor. Al morir, el botín queda en el suelo como **Restos** que cualquiera puede saquear; al extraer por un portal abierto, su valor se registra en la telemetría.

### Campamento (lobby estilo Delta Force)

Después de entrar, el lobby tiene tres pestañas:

- **Campamento:** tu escuadra (hasta 3) de pie junto a una fogata con el aspecto que eligió cada quien. Se entra a una escuadra con su código de 5 caracteres o aceptando una invitación desde la lista de conectados. El líder pulsa **Entrar a la Grid** y la escuadra va a la cola de emparejamiento como un equipo: la partida arranca al juntar 4 escuadras o, si hay el mínimo de jugadores y de equipos, tras una espera corta (`QUEUE_MIN_PLAYERS`, `QUEUE_MIN_TEAMS`, `QUEUE_WAIT_MS`; por defecto 2 jugadores, 2 equipos y 15 s). Al terminar, todos vuelven al campamento con su escuadra.
- **Preparación:** escuela (por ahora solo Tharvén; las demás se muestran como próximamente), orden de los Focos y aspecto (cuerpo, ropa y cabeza) con vista previa que gira. Se guarda en el navegador y el servidor lo valida con Zod.
- **Partidas privadas:** las salas manuales de siempre, con contraseña opcional y elección de equipo.


Hasta 4 equipos por sala (Ámbar, Violeta, Jade y Carmín) de hasta 3 jugadores; también se puede ir en dúo o solo. Quien entra a la sala va al equipo con menos jugadores (dos personas que no eligen quedan como rivales) y en el lobby puede cambiarse con **Unirme**. En la partida cada equipo sale de su propia llegada (con dos equipos, de lados opuestos del mapa), no hay daño entre compañeros, solo se puede fijar a rivales y los compañeros se ven siempre: color de faja y nombre, panel con su vida bajo la propia y flechas en el borde de la pantalla cuando no están a la vista. Los resultados se agrupan por equipo con el botín que sacaron entre todos.


`shared/src/abilities.ts` define Focos (armas) y Nombres (habilidades de escuela). El ataque básico es **automático sobre un objetivo fijado** (clic sobre un enemigo, Tab el más cercano; en móvil, el botón Atacar) y se revisa con compensación de lag. Q y E son los Nombres de la escuela y R la Inscripción del Foco en la mano; salen al instante hacia el cursor (en móvil, tocar lanza rápido y arrastrar apunta). Espacio cambia de Foco. El servidor valida recargas, recarga global de 0.3 s, alcance y línea de vista; la embestida se autoriza en el servidor y el cliente la predice con los mismos tramos de movimiento. Build de prueba: Tharvén (Llamar a la Piedra y Temblor) con Vara de Fresno y Anillo de Ámbar.

### Mapa procedural (la Grid)

`shared/src/map.ts` genera el mapa en dos niveles con la semilla de la partida:

1. **Estructura:** qué módulos de 16×16 existen, qué función tiene cada uno (llegada, galería, osario, cruce, santuario, plaza de portal, bóveda, Corazón o pasaje) y cómo se conectan (árbol al azar más lazos). El riesgo sube del borde al centro.
2. **Salas:** cada función toma una de las 28 plantillas de `shared/src/templates.ts`, girada o volteada.

Se genera un cuarto del mapa y se copia girado 90° alrededor del centro (simetría de rehilete), así los 4 equipos reciben el mismo cuarto. Las plantillas traen abismos (se ven, no se cruzan), muros delgados, rejas de un solo sentido, sellos de bóveda que se abren en la Primera Llamada y del Corazón en la Segunda, cobertura y muros en diagonal con colisión exacta.

### Estilo visual "Forja Apagada"

El cliente dibuja todo en Canvas 2D con contorno de tinta ciruela y luces saturadas: piso de losas generado por trozos de 8×8 casillas (caché LRU), muros en tres cuartos con cara y tapa, antorchas, monolitos con runas, estrado de portal con remolino, pasto que se aparta al pasar y personajes animados por piezas que miran hacia donde apuntan. La oscuridad se calcula a media resolución y la visión del jugador sigue siendo el mismo radio para todos (`VISION_RADIUS`). Los sprites de los cofres están normalizados a 256×256 en WebP con la base al 94 % de la altura, así los tres estados encajan sin saltos.

### Interfaz: madera en los menús, tiza en la partida

El acceso es la tapa de un tomo de cuero, el lobby un libro abierto (crear y elegir sala en una página, la sala en la otra) y los resultados un cofre de madera. En la partida el HUD está dibujado con tiza para no tapar el juego: vida en tramos, brújula con la fase y el tiempo, habilidades con su ícono y recarga, mochila y sincronización con el portal. Las piezas están en `client/public/assets/ui/` como archivos sueltos (SVG provisionales) para que el arte final las reemplace con el mismo nombre; la textura de tiza se aplica como máscara, así un solo ícono blanco sirve en cualquier color.


Cada personaje es una combinación de **tipo de cuerpo** (medio, esbelto alto, fornido, bajo y ágil), **ropa** (2 por escuela) y **cabeza** (6), con el Foco en la mano y una faja con el color del equipo. `shared/src/rig.ts` define las articulaciones de las tres vistas (frente, lado y espalda), 17 huesos, la cinemática directa y las animaciones (quieto, caminar, golpe, disparo, lanzar, recibir golpe y morir). `client/src/rig.ts` dibuja las piezas sobre los huesos; por ahora son piezas provisionales con el estilo del juego y, cuando lleguen las piezas del artista, se dibujan en los mismos huesos. El visor `/rig.html` muestra todas las combinaciones, animaciones y huesos. Las plantillas para el artista (lienzo de 2508×1254 por cuerpo y su `rig.json`) están en `docs/diseno/esqueleto/`.


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
| `QUEUE_MIN_PLAYERS` / `QUEUE_MIN_TEAMS` / `QUEUE_WAIT_MS` | Emparejamiento: mínimo de jugadores (2), de equipos (2) y espera en ms (15000). |
| `MIN_PLAYERS` | 1 | Jugadores listos necesarios para iniciar |

## Despliegue en Render

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio; `render.yaml` configura todo.
3. Verifica `https://<tu-app>.onrender.com/api/health`.

> Nota: los usuarios, salas y telemetría viven en memoria. Al reiniciar el servicio se pierden; para la evaluación se repueblan con `/api/test/seed`.
