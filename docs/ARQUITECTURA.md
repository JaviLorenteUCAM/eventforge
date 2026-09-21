# Arquitectura de EventForge

Documento técnico. Para instalar y desplegar, ve al [README](../README.md).

---

## 1. Visión general

```text
                              INTERNET
                                 │
                                 ▼
        ┌────────────────────────────────────────────────┐
        │  VERCEL · CDN global                           │
        │  index.html + JS + CSS (ficheros estáticos)    │
        │  Sin servidor propio · sin estado              │
        └───────────────────────┬────────────────────────┘
                                │  fetch HTTPS
                                │  apikey: anon  +  Authorization: Bearer <JWT>
                                ▼
        ┌────────────────────────────────────────────────┐
        │  SUPABASE                                      │
        │                                                │
        │  ┌──────────────┐   PostgREST                  │
        │  │  PostgreSQL  │◄──── API REST autogenerada   │
        │  │  19 tablas   │      + Row Level Security    │
        │  │  2 funciones │                              │
        │  └──────┬───────┘                              │
        │         │ WAL                                  │
        │         ▼                                      │
        │  ┌──────────────┐  websocket                   │
        │  │  Realtime    │◄──── cambios en vivo         │
        │  └──────────────┘                              │
        │                                                │
        │  ┌──────────────┐  ┌──────────────────────┐    │
        │  │  Auth (JWT)  │  │  Storage (4 buckets) │    │
        │  └──────────────┘  └──────────────────────┘    │
        │                                                │
        │  ┌──────────────────────────────────────────┐  │
        │  │  Edge Function `access` (Deno)           │  │
        │  │  valida el código y emite la sesión      │  │
        │  └──────────────────────────────────────────┘  │
        └────────────────────────────────────────────────┘
```

El frontend **nunca** es la fuente de verdad. El navegador cachea (React Query) y guarda
preferencias locales (tema, zoom, menú plegado), pero cualquier dato de negocio vive en
PostgreSQL.

---

## 2. Capas del frontend

```text
  src/lib/          Lógica pura, sin React ni Supabase.
                    issues.ts · materials.ts · packing.ts · utils.ts
                    → Es el "núcleo" del producto: se puede probar aislado
                      y no depende de la interfaz.

  src/data/         Capa de acceso a datos. Un módulo por entidad.
                    Envuelve PostgREST con React Query y traduce los errores
                    de PostgreSQL a mensajes en castellano.

  src/features/     Un módulo por sección de la aplicación. Sin llamadas
                    directas a Supabase: siempre a través de src/data.

  src/components/   Sistema de diseño (ui/) y estructura (layout/).
```

Regla práctica: **una página nunca importa `supabase` directamente**. Si necesita datos,
pasa por `src/data`.

---

## 3. Sistema de coordenadas

Todo se mide en **metros** y **kilogramos**. No hay píxeles en la base de datos.

### Planos (`plan_objects`)

```text
        x  ──────────────────►  (ancho del recinto)
   y │  ┌───────────────────┐
     │  │                   │
     ▼  │        ■ (x,y)    │   (x, y) es el CENTRO del objeto
        │                   │   rotation gira alrededor de ese centro
        └───────────────────┘
        z = altura sobre el suelo (para objetos encima de mesas)
```

En 3D: `plano.x → three.x`, `plano.y → three.z`, `altura → three.y`.

El SVG del editor 2D dibuja directamente en metros dentro de un `<g transform="translate(pan)
scale(zoom)">`. Los trazos usan `vector-effect="non-scaling-stroke"` y los textos
`fontSize = px / zoom`, de modo que el grosor y la letra son constantes en pantalla a
cualquier nivel de zoom.

### Gestos en el lienzo 2D

| Entrada | Acción |
|---|---|
| Rueda del ratón | Zoom centrado en el cursor |
| Espacio o botón central + arrastrar | Desplazar el plano |
| Un dedo sobre el fondo | Desplazar el plano (en ratón, marco de selección) |
| Dos dedos | Pellizcar para hacer zoom, manteniendo bajo los dedos el mismo punto del plano |

En la vista 3D los botones van remapeados (`OrbitControls.mouseButtons`): el izquierdo se
deja libre para seleccionar y arrastrar objetos, el derecho gira la cámara y la rueda pulsada
desplaza. Por defecto three.js pone el giro en el izquierdo, que es justo el que hace falta
para trabajar.

El pellizco se resuelve llevando la cuenta de los punteros activos (`pointers`, un `Map` por
`pointerId`): cuando aparece el segundo dedo se cancela el arrastre en curso y se guarda el
estado inicial del gesto (distancia, centro, zoom y desplazamiento). Es la única forma de que
un pellizco que empieza encima de un objeto no lo arrastre.

### Cables con trazado

Un cable guarda solo sus **puntos intermedios** (`plan_connections.waypoints`, jsonb en
metros). Los dos extremos NO se guardan: se calculan a partir de los objetos conectados, de
modo que al mover una mesa el cable la sigue sin tener que reescribir el trazo.

Al dibujar llegan decenas de puntos por segundo. Antes de guardar se aplica Douglas-Peucker
(`simplifyPath`, tolerancia 8 cm): se conservan las curvas y se tiran los puntos que caen
prácticamente sobre la recta anterior. Una lista vacía es un cable recto, que es como se
comportaban todos antes de esta versión.

La longitud es el recorrido en planta más el desnivel entre los dos extremos
(`cableLength`), y quien la pide le suma la holgura.

### Modo silueta

Recortar la textura no basta cuando el objeto no es un bloque: la caja sigue teniendo seis
caras y los laterales quedan flotando. En modo `silhouette` no se textura una caja, se
construye la geometría a partir de la imagen.

La cadena está en `lib/silhouette.ts` y es toda de cálculo puro:

1. `maskFromImage()` — imagen → máscara binaria (1 = material). Reduce a 256 px de lado: el
   contorno no mejora con más resolución y el trazado es cuadrático. Cuenta como aire tanto
   el alfa bajo como el color clave, así que funciona igual con un PNG recortado que con un
   dibujo con el hueco en magenta.
2. `traceContours()` — recorrido del borde con la regla de la mano derecha (*moore boundary
   tracing*): se avanza pegado al material girando siempre hacia el mismo lado.
3. `simplifyPath()` (el mismo Douglas-Peucker que usan los cables) quita el dentado.
4. Se clasifican los contornos por área y contención: los que caen dentro de otro son huecos.
   Solo un nivel de anidamiento; un hueco dentro de un hueco volvería a ser material, pero eso
   no pasa dibujando soportes.

En `TexturedMesh` el resultado se pasa a `THREE.Shape` + `ExtrudeGeometry` con la profundidad
del objeto, centrada en el origen. Dos detalles:

- **UV propias.** El generador por defecto de `ExtrudeGeometry` devuelve las UV en METROS; hay
  que reescribirlas a 0..1 o la textura sale a escala aleatoria.
- **Dos materiales.** `ExtrudeGeometry` separa las tapas de los cantos en dos grupos: las tapas
  llevan la imagen y los cantos, color liso. Estirar la textura por el canto del corte queda
  embarrado.

### Huecos en las texturas

Dos mecanismos, un solo resultado:

1. **Alfa del PNG.** El material lleva `alphaTest: 0.5` siempre que hay textura, así que
   cualquier imagen con transparencia recorta sola. Se usa `alphaTest` y no `transparent`
   porque el recorte es duro: no hay que ordenar nada por profundidad, el objeto se sigue
   comportando como opaco y el borde queda limpio.
2. **Color clave** (`texture_key_color`, `texture_key_tolerance`). La imagen se dibuja en un
   `<canvas>`, se pone a cero el alfa de los píxeles que se parecen al color y se monta una
   `CanvasTexture`. La comparación es la distancia euclídea en RGB normalizada sobre 441,67
   (√3·255²); hace falta margen porque el color se ensucia al guardar en JPEG o al reescalar.

Además `side: THREE.DoubleSide`: al abrir un hueco se ve el interior de la caja, y sin esto
las caras de dentro desaparecerían.

El recorte se aplica al cargar, en `useImageTexture`, y el resultado se cachea en el estado
del componente: no se recalcula por frame.

### Los tres giros de un objeto

`plan_objects` guarda `rotation` (giro en planta), `tilt` (inclinación) y `roll` (vuelco
sobre su propia cara), en grados. Se aplican en orden yaw → pitch → roll, que en three.js es
el Euler `'YXZ'`.

Correspondencia de ejes, que es donde es fácil equivocarse:

| Eje propio | three.js | Ángulo que gira sobre él |
|---|---|---|
| largo | x | `tilt` |
| alto | y | `rotation` |
| ancho | z | `roll` |

(`boxGeometry` recibe `[length, height, width]`, de ahí la correspondencia.)

**Las medidas no cambian al girar.** Lo que cambia es el hueco, y lo calcula `footprintOf()`
(`lib/geometry.ts`) como la caja recta que envuelve al objeto girado:

    lado_i = Σ_j |R_ij| · medida_j

Con `tilt` y `roll` a cero devuelve las medidas tal cual, que es el caso normal y no cuesta
nada. De ahí beben la planta (lo que se dibuja y dónde se puede pulsar), `restingZ()` (para
apoyar cosas encima) y el 3D (para que la base siga en el suelo).

En el 3D hay dos grupos anidados a propósito: el de fuera solo POSICIONA y el de dentro gira.
Si las etiquetas y los símbolos colgaran del grupo que gira, se irían de lado en cuanto la
tele se pusiera vertical.

### Cámara del 3D

La rueda NO usa el zoom de OrbitControls. Ese zoom acorta el radio alrededor del punto de
mira, así que en una sala de 90 metros giras la rueda y sigues dando vueltas al mismo sitio:
nunca llegas a la alfombra del rincón.

En su lugar hay un manejador propio (`Editor3D.tsx`) que lanza un rayo por el cursor, mira qué
malla hay debajo y usa esa PROFUNDIDAD para todo:

- el paso es el 12 % de ella por muesca, así que se adapta solo (metros contra la pared del
  fondo, centímetros sobre una regleta) y nunca traspasa lo que se apunta;
- el pivote se coloca sobre esa superficie, en el eje de la cámara, para que al rotar se orbite
  alrededor de lo que se mira. En el eje y no en el punto exacto del cursor: el `lookAt` de
  OrbitControls giraría la vista de golpe.

Un paso proporcional al radio no vale: como el pivote viaja con la cámara, el radio no cambia
al avanzar y el paso se queda igual de grande cerca que lejos.

Se engancha en el elemento PADRE del lienzo y en fase de captura, para llegar antes que el
manejador de OrbitControls sin desactivar su zoom (que en táctil hace falta para el pellizco).

El suelo se dibuja 1 cm por debajo del cero y la rejilla a 5 mm. Con todo a la misma altura,
la cara inferior de un objeto apoyado competía con el suelo por el mismo píxel y parpadeaba;
las alfombras casi no se veían y había que subirlas a mano.

### Los cuatro cableados

`plan_connections.kind` admite `power`, `network`, `signal` y `usb` (migraciones `0009` y
`0013`). Los dos últimos son la imagen (HDMI, DisplayPort, USB-C, SDI) y los periféricos.

Ni la señal ni el USB añaden tipos de objeto al análisis: cada uno se deduce de dos columnas
—`requires_signal`/`signal_out_count` y `requires_usb`/`usb_port_count`— con la misma regla.

| Papel | Cómo se reconoce |
|---|---|
| Fuente | tiene salidas y no necesita recibir (cámara, reproductor) |
| Repartidor | tiene salidas **y** necesita recibir (splitter, matriz) |
| Consumidor | necesita recibir (tele, monitor) |

Se eligió así en vez de crear `signal_source`/`signal_splitter` obligatorios porque el mismo
aparato cambia de papel según cómo se use: un portátil es fuente en una sala y consumidor en
otra. Los tipos existen en `ObjectKind` para etiquetar el almacén, pero el análisis no
depende de ellos.

Las reglas compartidas entre la barra, el lienzo 2D y el 3D (`isCableTool`, `toolKind`,
`dashFor`, `isFeed`) viven en `features/plan/cables.ts`, fuera de los componentes: exportarlas
desde un archivo con componentes rompe el recargado en caliente de Vite.

### Acometidas

El punto de luz (`power_source`) y el punto de red (`network_source`) no salen del almacén:
son parte del recinto, no material que se compre. Van con las figuras básicas en
`BASIC_SHAPES` (`PlanPage.tsx`), que ahora puede fijar también `kind`, `color` y las tomas o
puertos que ofrecen.

Se dibujan como un círculo con su símbolo: `FeedSymbol` (`Editor2D.tsx`) lo resuelve por
`kind`, en una caja de 1×1 que se escala al tamaño del objeto, así que vale para cualquier
medida. En 3D el símbolo va en un `Html` flotando sobre el cilindro, porque un cilindro de
40 cm no se distingue de nada más.

### Estilos del material

`warehouse_item_variants` describe acabados del mismo objeto, cada uno con sus unidades y su
textura. `plan_objects.variant_id` recuerda con cuál se colocó cada copia.

Dos decisiones que conviene no deshacer:

1. **Las unidades del estilo son suyas.** Seis manteles negros no cubren la necesidad de uno
   rojo, así que `computeVariantStock()` cuenta por estilo y no reparte entre ellos.
2. **`adds_material` es lo que separa los dos casos de uso.** Sin él, un photocall con otro
   dibujo pediría un «photocall» extra en el listado, y una mesa con mantel no pediría el
   mantel. Es una casilla en la interfaz precisamente porque solo lo sabe quien monta.

### Almacén primero

Desde la migración `0006`, la ficha del almacén (`warehouse_items`) lleva también `kind`,
`shape`, `color`, `requires_power`, `requires_network`, `power_w`, `outlet_count`,
`port_count` y las columnas de textura. Es decir: **el artículo del almacén es el objeto**.

`object_catalog` se mantiene para las piezas propias de un evento y empieza vacío (la
migración borra el catálogo de sistema). `plan_objects` puede apuntar a cualquiera de los
dos, y `computeStock()` (`src/lib/materials.ts`) cuenta cuántas unidades de cada artículo
están ya colocadas en el plano para mostrar `disponibles/total`.

Las existencias **no bloquean**: se puede colocar material que no se tiene. Esa es
precisamente la información que interesa —lo que hay que alquilar— y aparece en el listado de
material bajo *«falta material»*.

---

## 4. Decisiones de base de datos

| Decisión | Motivo |
|---|---|
| `uuid` como clave primaria | Permite generar el id en el cliente antes de escribir, lo que hace posible el *deshacer* exacto (restaurar una fila con su id original y que los cables sigan apuntando a ella). |
| Estados como `text` + `CHECK` en lugar de `ENUM` | `ALTER TYPE ... ADD VALUE` no funciona dentro de una transacción en PostgreSQL. Con `CHECK` se amplía sin bloqueos. |
| `numeric(10,3)` para medidas | Evita los errores de redondeo de coma flotante al sumar volúmenes y pesos. |
| `timestamptz` siempre | Se guarda en UTC y cada navegador lo muestra en su zona horaria. |
| Índices en todas las claves foráneas consultadas | Las páginas filtran constantemente por `event_id` y `plan_id`. |
| `ON DELETE CASCADE` de evento hacia abajo | Borrar un evento debe llevarse su plano, horarios, tareas y cargas sin dejar huérfanos. |
| `ON DELETE SET NULL` hacia catálogos | Borrar un objeto de la biblioteca no debe destruir los planos que lo usaron. |
| `duplicate_event()` en PL/pgSQL | Copiar un evento implica decenas de inserciones con remapeo de ids. Hacerlo en el servidor lo vuelve atómico: o se copia todo, o nada. |
| Vistas con `security_invoker = true` | Para que hereden las políticas RLS de las tablas base en lugar de saltárselas. |

### Qué se calcula en el cliente y por qué

El listado de material, las incidencias del plano y las métricas de carga **se calculan en el
navegador** (`src/lib/`), no en SQL. Motivos:

- Son cálculos sobre conjuntos pequeños (cientos de filas, no millones).
- El editor necesita recalcularlos **mientras arrastras**, antes de escribir en la base de
  datos. En SQL habría que ir y volver en cada movimiento.
- La lógica de negocio queda en un único sitio, legible y fácil de ajustar.

Si algún día los planos crecen mucho, `v_event_material_needs` (en el esquema) muestra cómo
llevar la agregación al servidor sin cambiar el modelo.

---

## 5. Deshacer / rehacer

Implementado con **comandos**, no con instantáneas (`src/features/plan/useHistory.ts` +
`usePlanOps.ts`).

```text
  Acción del usuario
        │
        ▼
  usePlanOps.addObjects([...])  ──► escribe en PostgreSQL
        │
        └──► devuelve { undo, redo, label }
                    │
                    ▼
             history.push(entry)
```

Cada entrada sabe deshacerse escribiendo en la base de datos. Ventajas:

- El coste no depende del tamaño del plano.
- Al deshacer, el cambio también se propaga al resto del equipo (es una escritura real).
- Restaurar un objeto eliminado conserva su `id`, de modo que los cables que colgaban de él
  vuelven a ser válidos.

Límite: 60 pasos, y el historial es por sesión de editor (no se comparte entre usuarios).

---

## 6. Detección de incidencias

`src/lib/issues.ts` construye un grafo no dirigido por cada tipo de cable y hace un recorrido
en anchura desde las fuentes.

```text
  Electricidad                          Red
  ------------                          ---
  FUENTES: power_source                 FUENTES: network_switch, network_router
    (cuadro, toma de pared)
                                        PROPAGAN: switch, router, punto de red
  PROPAGAN: power_strip
    (regletas, alargaderas)             CONSUMEN: requires_network
    ...pero solo si ellas mismas
       están alimentadas

  CONSUMEN: requires_power
```

Lo importante del diseño: un consumidor **no propaga**. Que un PC esté enchufado no alimenta
al PC de al lado aunque haya un cable entre ellos por error. Solo las regletas, switches y
routers reparten.

Saturación: se cuentan los cables que llegan a cada regleta o switch y se comparan con
`outlet_count` / `port_count`. A las regletas se les descuenta una toma, la de su propia
alimentación.

---

## 6-bis. Imágenes de fondo, calibración y texturas

### Calibración

El problema: una foto aérea no trae escala. La solución es dejar que el usuario aporte **una
sola medida conocida** y derivar el resto.

```text
  El usuario traza P0 → P1 sobre la imagen.
  d      = distancia del trazo, en las unidades ACTUALES del plano
  real   = lo que el usuario dice que mide de verdad
  k      = real / d                     ← factor de corrección

  La imagen se escala alrededor del PUNTO MEDIO del trazo:
      w' = w · k
      x' = mx − (mx − x) · k
  …así el elemento recién medido no se mueve de sitio.

  Si se marca «ajustar el recinto», la imagen se lleva a (0,0) y el plano
  adopta sus medidas: width_m = w', depth_m = h'.
```

Las capas viven en `plan_backgrounds` con coordenadas en metros, igual que todo lo demás, de
modo que después de calibrar no hay ninguna conversión especial en el resto del editor.

### Atlas de texturas (`src/lib/textureAtlas.ts`)

Una caja se despliega en una rejilla **proporcional a sus medidas reales**:

```text
  columnas (ancho):   W        L        W        L
  filas (alto)
     W              [     ] [ARRIBA ] [     ] [      ]
     H              [ IZDA] [FRENTE ] [ DCHA] [ATRÁS ]
     W              [     ] [ ABAJO ] [     ] [      ]

  L = largo (X) · W = ancho/fondo (Z) · H = alto (Y)
  Atlas: 2·(L+W) × (H+2·W)
```

En 3D se crean **seis materiales**, uno por cara, que comparten la misma imagen pero con
`offset`/`repeat` distintos apuntando a su recuadro. El orden es el de `THREE.BoxGeometry`
(`+X, −X, +Y, −Y, +Z, −Z`) y la conversión invierte el eje Y, porque el atlas se define con
origen arriba-izquierda y las UV de three.js tienen el origen abajo-izquierda.

Dos detalles que costaron depuración y conviene no volver a romper:

1. **El material se pasa como prop de `<mesh material={...}>`, nunca como hijo con
   `attach="material-0"`.** Con `attach`, R3F intenta escribir en `mesh.material[0]` mientras
   `mesh.material` sigue siendo un material suelto, y los seis materiales se pierden en
   silencio: el objeto se queda con su color plano y no hay ningún error.
2. **Las texturas se cargan a mano con `THREE.TextureLoader`**, no con `useTexture`/`useLoader`
   de drei. Las URLs son firmadas y caducan; la caché de `useLoader` guardaría la URL vieja y,
   con Suspense, un fallo de red tumbaría la escena entera en lugar de degradar a color plano.
3. **El reparto de caras se calcula con las medidas de la FICHA DE ORIGEN (almacén o
   biblioteca), no con las de la copia colocada en el plano** (`TextureSpec.atlas`). La rejilla del atlas es proporcional al
   objeto para el que se exportó la plantilla; si se usaran las medidas de la instancia, al
   redimensionar un objeto en el plano los recuadros dejarían de coincidir con sus caras y los
   colores saldrían desplazados. Con la referencia fija, redimensionar una copia simplemente
   estira la textura, que es lo esperado. La contrapartida: si se cambian las medidas de la
   ficha de origen hay que volver a exportar la plantilla, y la interfaz lo avisa.

   Como la textura vive en la ficha, editarla desde el plano afecta a todas las copias. Por eso
   `ObjectTextureFlow` pregunta antes si se quiere cambiar el original o duplicar la ficha y
   reenlazar solo ese objeto del plano.
4. **Medio téxel de margen y sin mipmaps** en cada cara. Sin el margen, el filtrado bilineal
   muestrea el recuadro contiguo justo en el borde y aparece un ribete del color de la cara
   vecina; con mipmaps, al ver el objeto pequeño se mezclan recuadros entre sí.

### Escenarios

`save_plan_as_scenario()` y `load_scenario_into_plan()` son funciones PL/pgSQL por el mismo
motivo que `duplicate_event()`: copiar un plano son decenas de inserciones con remapeo de ids
y debe ser atómico. `load_scenario_into_plan(…, p_replace => true)` vacía antes el plano; con
`false` superpone. En ambos casos el recinto adopta las medidas del escenario, porque es lo
que define el espacio real.

---

## 7. Simulación de carga

`src/lib/packing.ts`.

- **Métricas** (`computeLoadMetrics`): volumen usado, volumen del vehículo, ocupación, peso
  frente al máximo, bultos fuera de los límites, bultos solapados y m³ que faltan.
- **Colocación automática** (`autoPack`): algoritmo de *estanterías por capas*. Ordena por
  superficie descendente, rellena filas a lo ancho, avanza en profundidad y, al agotarla,
  empieza una capa nueva encima. Elige la orientación (0° o 90°) que mejor encaje a lo ancho.
- **Apilado manual**: al soltar un bulto encima de otros, `nextStackHeight()` calcula la cota
  superior de lo que hay debajo y lo coloca ahí.

Es una versión 1 honesta: da un punto de partida razonable que luego se ajusta a mano, y los
cálculos de volumen, peso y colisión son reales. La evolución natural está descrita en el
apartado 17 del README.

---

## 8. Rendimiento

| Medida | Dónde |
|---|---|
| `three.js` en un *chunk* aparte, cargado solo al abrir el Plano | `vite.config.ts` + `React.lazy` en `App.tsx` |
| Arrastre sin escrituras: la posición vive en estado local y solo se confirma al soltar | `Editor2D.tsx` |
| Actualizaciones optimistas al mover un objeto | `data/plans.ts` |
| Realtime invalida consultas en lugar de fusionar *payloads* | `data/realtime.ts` |
| Selectores atómicos de Zustand (nunca objetos nuevos por render) | `store/ui.ts`, `planStore.ts` |
| `useMemo` en todos los cálculos derivados (material, incidencias, agrupaciones) | páginas de `features/` |
| El halo del fondo se pinta una sola vez con `body::before`, sin coste por frame | `index.css` |
| `prefers-reduced-motion` desactiva todas las animaciones | `index.css` |

Tamaño del *bundle* inicial (gzip): ~126 kB de aplicación + 55 kB de Supabase + 14 kB de
React. Three.js (309 kB gzip) **no** se descarga hasta que abres un editor.

---

## 9. Accesibilidad y responsive

- Prioridad: escritorio → tablet → móvil.
- Dashboard, eventos, calendario, tareas, horarios, material y almacén son totalmente
  usables en móvil.
- Los editores 2D/3D funcionan en tablet y en móvil. En móvil el lienzo ocupa toda la
  pantalla: la barra de herramientas se reduce a iconos, y la biblioteca, el inspector y el
  resto de opciones se abren como **hoja inferior** (`MobileSheet`), una cada vez, en lugar de
  robarle sitio al plano de forma permanente. El zoom y el desplazamiento se hacen con los
  dedos (ver «Gestos en el lienzo 2D»).
- Todos los botones de solo icono llevan `aria-label` y `title`.
- Foco visible en todos los controles (`:focus-visible`).
- Los diálogos cierran con `Escape` y bloquean el desplazamiento del fondo.
- Modo claro completo mediante `<html data-theme="light">`.

---

## 10. Convenciones de código

- **Español** en la interfaz, los comentarios y los mensajes de error.
- **Inglés** en nombres de variables, funciones y columnas (estándar del ecosistema).
- Los comentarios explican **por qué**, no **qué**.
- Sin `any`: el proyecto compila con `strict: true` y `noUnusedLocals`.
- Los ficheros de `src/lib/` no importan React.
