import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import { Network, Zap } from "lucide-react";
import * as THREE from "three";
import type {
  Plan,
  PlanBackground,
  PlanConnection,
  PlanIssue,
  PlanObject,
} from "@/lib/types";
import { cablePath, footprintOf } from "@/lib/geometry";
import { round, snap as snapTo } from "@/lib/utils";
import { usePlanStore } from "./planStore";
import type { CommitUpdate } from "./Editor2D";
import { isFeed } from "./cables";
import { GroundImage, TexturedMesh, type TextureSpec } from "./TexturedMesh";

/**
 * EDITOR 3D
 *
 * Correspondencia de ejes con el plano 2D:
 *   plano.x  ->  three.x
 *   plano.y  ->  three.z   (profundidad)
 *   altura   ->  three.y
 *
 * Los objetos se dibujan con sus DIMENSIONES REALES en metros. Se pueden
 * seleccionar y arrastrar sobre el suelo; la rotación y el escalado se ajustan
 * desde el inspector, que escribe en la misma base de datos.
 */

interface Props {
  plan: Plan;
  objects: PlanObject[];
  connections: PlanConnection[];
  backgrounds: PlanBackground[];
  /** Rutas de Storage ya resueltas a URL firmada. */
  backgroundUrls: Map<string, string>;
  /** Textura de cada objeto del plano, indexada por su id. */
  textures: Map<string, TextureSpec>;
  issuesByObject: Map<string, PlanIssue[]>;
  onCommit: (updates: CommitUpdate[], label: string) => void;
  onGlReady: (
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) => void;
}

export function Editor3D(props: Props) {
  const { plan } = props;
  const W = Number(plan.width_m);
  const D = Number(plan.depth_m);

  // Encuadre inicial: cámara en diagonal, lo bastante lejos para ver el recinto
  // completo con un campo de visión de 45°.
  const span = Math.max(W, D);
  const camera: [number, number, number] = [
    W / 2 + span * 0.6,
    span * 0.7,
    D / 2 + span * 0.85,
  ];

  return (
    <div className="size-full bg-[var(--ef-canvas-2)]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        // near bajo para poder pegarse a un objeto sin que se recorte.
        camera={{ position: camera, fov: 45, near: 0.02, far: 500 }}
        onPointerMissed={() => usePlanStore.getState().clearSelection()}
      >
        <color attach="background" args={["#070a12"]} />
        <fog
          attach="fog"
          args={["#070a12", Math.max(W, D) * 1.6, Math.max(W, D) * 4]}
        />

        <Scene {...props} />
      </Canvas>
    </div>
  );
}

function Scene({
  plan,
  objects,
  connections,
  backgrounds,
  backgroundUrls,
  textures,
  issuesByObject,
  onCommit,
  onGlReady,
}: Props) {
  const { gl, scene, camera } = useThree();
  const selection = usePlanStore((s) => s.selection);
  const setSelection = usePlanStore((s) => s.setSelection);
  const toggleInSelection = usePlanStore((s) => s.toggleInSelection);
  const clearSelection = usePlanStore((s) => s.clearSelection);
  const showLabels = usePlanStore((s) => s.showLabels);
  const showPower = usePlanStore((s) => s.showPower);
  const showNetwork = usePlanStore((s) => s.showNetwork);
  const showSignal = usePlanStore((s) => s.showSignal);
  const snapOn = usePlanStore((s) => s.snap);
  const tool = usePlanStore((s) => s.tool);
  const linkFrom = usePlanStore((s) => s.linkFrom);

  const W = Number(plan.width_m);
  const D = Number(plan.depth_m);
  const grid = Number(plan.grid_size_m) || 0.5;

  const [dragId, setDragId] = useState<string | null>(null);
  const dragStart = useRef<{
    x: number;
    y: number;
    px: number;
    pz: number;
  } | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  /** Punto de mira inicial: el centro del recinto. Solo al abrir el plano. */
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.target.set(Number(plan.width_m) / 2, 0.6, Number(plan.depth_m) / 2);
    c.update();
    // A partir de aquí manda el usuario: no se repone en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  /**
   * Lleva la cámara hasta un objeto: pasa a ser el punto de mira y la cámara
   * se acerca a una distancia proporcional a su tamaño, conservando la
   * dirección desde la que se estaba mirando.
   *
   * Es la forma cómoda de ver algo de cerca en una sala de 90 metros: sin
   * esto hay que orbitar alrededor del centro y no se llega.
   */
  const focusOn = useCallback(
    (o: PlanObject) => {
      const c = controlsRef.current;
      if (!c) return;
      const box = footprintOf(o);
      const target = new THREE.Vector3(
        Number(o.x),
        Number(o.z) + box.height / 2,
        Number(o.y),
      );
      const size = Math.max(box.length, box.width, box.height, 0.2);
      const dir = new THREE.Vector3()
        .subVectors(camera.position, c.target)
        .normalize();
      // Si la cámara estuviera justo encima, la dirección degenera.
      if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.001) {
        dir.set(0.6, 0.6, 0.6).normalize();
      }

      camera.position.copy(target).addScaledVector(dir, size * 2.2 + 0.4);
      c.target.copy(target);
      c.update();
    },
    [camera],
  );

  // Tecla F: enfocar lo seleccionado, como en cualquier editor 3D.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const first = objects.find((o) => selection.includes(o.id));
      if (first) focusOn(first);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objects, selection, focusOn]);

  useEffect(() => {
    onGlReady(gl, scene, camera);
  }, [gl, scene, camera, onGlReady]);

  const objectById = useMemo(
    () => new Map(objects.map((o) => [o.id, o])),
    [objects],
  );

  const positionOf = useCallback(
    (o: PlanObject) => {
      if (preview && preview.id === o.id) return { x: preview.x, y: preview.y };
      return { x: Number(o.x), y: Number(o.y) };
    },
    [preview],
  );

  function handleGroundMove(e: ThreeEvent<PointerEvent>) {
    if (!dragId || !dragStart.current) return;
    const o = objectById.get(dragId);
    if (!o) return;
    let x = dragStart.current.x + (e.point.x - dragStart.current.px);
    let y = dragStart.current.y + (e.point.z - dragStart.current.pz);
    // Mayús invierte el ajuste, igual que en el plano 2D.
    if (snapOn !== e.shiftKey) {
      x = snapTo(x, grid);
      y = snapTo(y, grid);
    } else {
      x = round(x, 3);
      y = round(y, 3);
    }
    setPreview({ id: dragId, x, y });
  }

  function endDrag() {
    if (dragId && preview && preview.id === dragId) {
      const o = objectById.get(dragId);
      if (o && (Number(o.x) !== preview.x || Number(o.y) !== preview.y)) {
        onCommit(
          [
            {
              id: dragId,
              patch: { x: preview.x, y: preview.y },
              previous: { x: Number(o.x), y: Number(o.y) },
            },
          ],
          "Mover objeto",
        );
      }
    }
    setDragId(null);
    setPreview(null);
    dragStart.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#93c5fd", "#0f172a", 0.5]} />
      <directionalLight
        position={[W, Math.max(W, D), D * 0.5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-Math.max(W, D)}
        shadow-camera-right={Math.max(W, D)}
        shadow-camera-top={Math.max(W, D)}
        shadow-camera-bottom={-Math.max(W, D)}
      />

      {/* Suelo: recibe sombras y captura los arrastres */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[W / 2, 0, D / 2]}
        receiveShadow
        onPointerDown={(e) => {
          // Igual que con los objetos: la rueda es para moverse, no para
          // cambiar la selección.
          if (e.button !== 0) return;
          if (tool === "select") clearSelection();
        }}
        onPointerMove={handleGroundMove}
        onPointerUp={endDrag}
      >
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#111827" roughness={0.95} metalness={0} />
      </mesh>

      <Grid
        position={[W / 2, 0.002, D / 2]}
        args={[W, D]}
        cellSize={grid}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={grid * 10}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={Math.max(W, D) * 3}
        infiniteGrid={false}
      />

      {/* Imágenes de referencia proyectadas sobre el suelo */}
      {backgrounds
        .filter((b) => b.visible && backgroundUrls.has(b.id))
        .map((b, i) => (
          <GroundImage
            key={b.id}
            url={backgroundUrls.get(b.id)!}
            x={Number(b.x)}
            y={Number(b.y)}
            width={Number(b.width_m)}
            height={Number(b.height_m)}
            rotation={Number(b.rotation)}
            opacity={Number(b.opacity)}
            layer={i}
          />
        ))}

      {/* Paredes de referencia */}
      <lineSegments position={[W / 2, Number(plan.height_m) / 2, D / 2]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(W, Number(plan.height_m), D)]}
        />
        <lineBasicMaterial color="#334155" />
      </lineSegments>

      {objects.map((o) => {
        const pos = positionOf(o);
        const l = Number(o.length_m);
        const w = Number(o.width_m);
        const h = Math.max(0.01, Number(o.height_m));
        const isSelected = selection.includes(o.id);
        const hasError = issuesByObject
          .get(o.id)
          ?.some((i) => i.severity === "error");

        // Los objetos de tipo texto no tienen volumen: solo rótulo flotante.
        if (o.shape === "text") {
          return (
            <Html
              key={o.id}
              position={[pos.x, Number(o.z) + 0.05, pos.y]}
              center
              distanceFactor={12}
              style={{ pointerEvents: "none" }}
            >
              <span
                className="whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-semibold"
                style={{
                  color: o.color,
                  textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                }}
              >
                {o.label || "Texto"}
              </span>
            </Html>
          );
        }

        // Alto REAL, ya girado: es lo que hay que subir para que la base
        // siga apoyada en el suelo y lo que marca dónde va la etiqueta.
        const realH = footprintOf(o).height;

        return (
          <group key={o.id} position={[pos.x, Number(o.z) + realH / 2, pos.y]}>
            <group
              // Giro en planta, inclinación y vuelco sobre su propia cara, en
              // ese orden (el de toda la vida: yaw → pitch → roll).
              rotation={[
                (Number(o.tilt) * Math.PI) / 180,
                (-Number(o.rotation) * Math.PI) / 180,
                (Number(o.roll) * Math.PI) / 180,
                "YXZ",
              ]}
            >
              <TexturedMesh
                shape={o.shape}
                length={l}
                width={w}
                height={h}
                color={o.color}
                texture={textures.get(o.id)}
                emissive={
                  isSelected ? "#6366f1" : hasError ? "#7f1d1d" : "#000000"
                }
                emissiveIntensity={isSelected ? 0.45 : hasError ? 0.35 : 0}
                transparent={o.shape === "plane"}
                opacity={o.shape === "plane" ? 0.85 : 1}
                onPointerDown={(e) => {
                  // Solo el botón izquierdo. Con la rueda se desplaza la vista,
                  // y si el puntero pasaba por encima de algo se lo llevaba por
                  // delante sin querer.
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  if (tool !== "select") return;
                  if (e.shiftKey) toggleInSelection(o.id);
                  else setSelection([o.id]);
                  if (o.locked) return;
                  setDragId(o.id);
                  dragStart.current = {
                    x: Number(o.x),
                    y: Number(o.y),
                    px: e.point.x,
                    pz: e.point.z,
                  };
                  if (controlsRef.current) controlsRef.current.enabled = false;
                }}
                onPointerUp={endDrag}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  focusOn(o);
                }}
              />

              {isSelected ? (
                <lineSegments position={[0, 0, 0]}>
                  <edgesGeometry
                    args={[new THREE.BoxGeometry(l * 1.04, h * 1.04, w * 1.04)]}
                  />
                  <lineBasicMaterial color="#818cf8" />
                </lineSegments>
              ) : null}

              {linkFrom === o.id ? (
                <lineSegments>
                  <edgesGeometry
                    args={[new THREE.BoxGeometry(l * 1.12, h * 1.12, w * 1.12)]}
                  />
                  <lineBasicMaterial color="#22d3ee" />
                </lineSegments>
              ) : null}
            </group>

            {/* En 3D el punto de luz y el de red llevan su símbolo encima:
                un cilindro de 40 cm no se distingue de nada más. */}
            {isFeed(o.kind) ? (
              <Html
                position={[0, realH / 2 + 0.12, 0]}
                center
                distanceFactor={10}
                occlude={false}
                style={{ pointerEvents: "none" }}
              >
                <span
                  className="grid size-7 place-items-center rounded-full border-2"
                  style={{
                    borderColor: o.color,
                    color: o.color,
                    background:
                      "color-mix(in oklab, var(--ef-canvas) 75%, transparent)",
                  }}
                >
                  {o.kind === "power_source" ? (
                    <Zap className="size-4" />
                  ) : (
                    <Network className="size-4" />
                  )}
                </span>
              </Html>
            ) : null}

            {showLabels && o.label ? (
              <Html
                position={[0, realH / 2 + 0.22, 0]}
                center
                distanceFactor={14}
                occlude={false}
                style={{ pointerEvents: "none" }}
              >
                <span
                  className="whitespace-nowrap rounded-md border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_82%,transparent)] px-1.5 py-0.5 text-[11px] text-ink"
                  style={{ backdropFilter: "blur(4px)" }}
                >
                  {o.label}
                </span>
              </Html>
            ) : null}
          </group>
        );
      })}

      {/* Cables */}
      {connections.map((c) => {
        if (c.kind === "power" && !showPower) return null;
        if (c.kind === "network" && !showNetwork) return null;
        if (c.kind === "signal" && !showSignal) return null;
        const a = objectById.get(c.from_object_id);
        const b = objectById.get(c.to_object_id);
        if (!a || !b) return null;
        const pa = positionOf(a);
        const pb = positionOf(b);
        const ya = Number(a.z) + Number(a.height_m) * 0.35;
        const yb = Number(b.z) + Number(b.height_m) * 0.35;

        // El trazo se dibuja en planta; aquí se le da altura: sale del aparato,
        // baja al suelo para recorrer el camino y vuelve a subir al destino.
        const flat = cablePath(
          { ...a, x: pa.x, y: pa.y },
          { ...b, x: pb.x, y: pb.y },
          c.waypoints,
        );
        const floor = 0.03;
        const points: [number, number, number][] = flat.map((p, i) => {
          if (i === 0) return [p.x, ya, p.y];
          if (i === flat.length - 1) return [p.x, yb, p.y];
          return [p.x, floor, p.y];
        });
        if (points.length === 2) {
          // Cable recto: una curva suave queda más legible que una línea a ras.
          points.splice(1, 0, [
            (pa.x + pb.x) / 2,
            Math.min(ya, yb) * 0.4 + floor,
            (pa.y + pb.y) / 2,
          ]);
        }

        return (
          <Line
            key={c.id}
            points={points}
            color={c.color}
            lineWidth={c.kind === "power" ? 2.2 : 1.8}
            dashed={c.kind !== "power"}
            dashScale={c.kind === "signal" ? 4 : 8}
          />
        );
      })}

      {/*
        Botones del ratón:
          IZQUIERDO -> libre, para seleccionar y arrastrar objetos
          DERECHO   -> girar la cámara
          RUEDA     -> desplazar la vista (y girándola, acercar y alejar)

        Por defecto three.js pone el giro en el botón izquierdo, que es
        justamente el que hace falta para trabajar con los objetos.
      */}
      {/*
        Sin `target` como prop: drei lo reescribe en CADA render y, como el
        array se crea nuevo cada vez, el punto de mira volvía al centro de la
        sala una y otra vez. En un recinto de 90 metros eso significaba que por
        mucho que acercaras con la rueda nunca llegabas al objeto: la cámara se
        iba al medio. Ahora se coloca una sola vez, al abrir el plano, y a
        partir de ahí mandan el desplazamiento, el zoom y la tecla F.
      */}
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        // Lo justo para no meterse dentro de un objeto pequeño.
        minDistance={0.08}
        maxDistance={Math.max(W, D) * 4}
        // La rueda acerca hacia donde apunta el ratón, como en el plano 2D, en
        // vez de hacia el centro de la órbita.
        zoomToCursor
        mouseButtons={{
          LEFT: undefined as unknown as THREE.MOUSE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        makeDefault
      />
    </>
  );
}
