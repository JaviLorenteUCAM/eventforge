import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { TransportItem, TransportVehicle } from '@/lib/types';
import { footprintOf } from '@/lib/packing';

/**
 * Vista 3D de la carga.
 *   three.x -> ancho del vehiculo
 *   three.z -> largo del vehiculo
 *   three.y -> altura
 * Los bultos se anclan por esquina, igual que en la vista 2D.
 */
export function LoadView3D({
  vehicle,
  items,
  selection,
  onSelect,
  invalidIds,
}: {
  vehicle: TransportVehicle;
  items: TransportItem[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  invalidIds: Set<string>;
}) {
  const W = Number(vehicle.width_m);
  const L = Number(vehicle.length_m);
  const H = Number(vehicle.height_m);
  const span = Math.max(W, L, H);

  return (
    <div className="size-full bg-[var(--ef-canvas-2)]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [W * 1.4, H * 1.9, L * 1.5], fov: 45, near: 0.1, far: 200 }}
      >
        <color attach="background" args={['#070a12']} />
        <ambientLight intensity={0.6} />
        <hemisphereLight args={['#93c5fd', '#0f172a', 0.5]} />
        <directionalLight position={[W, H * 3, L]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />

        {/* Suelo de la caja */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[W / 2, 0, L / 2]}
          receiveShadow
          onPointerMissed={() => onSelect([])}
        >
          <planeGeometry args={[W, L]} />
          <meshStandardMaterial color="#111827" roughness={0.95} />
        </mesh>

        <Grid
          position={[W / 2, 0.003, L / 2]}
          args={[W, L]}
          cellSize={0.25}
          cellColor="#1e293b"
          sectionSize={1}
          sectionColor="#334155"
          fadeDistance={span * 4}
          infiniteGrid={false}
        />

        {/* Contorno del vehículo */}
        <lineSegments position={[W / 2, H / 2, L / 2]}>
          <edgesGeometry args={[new THREE.BoxGeometry(W, H, L)]} />
          <lineBasicMaterial color="#475569" />
        </lineSegments>

        {items.map((item) => {
          const { fx, fy } = footprintOf(item);
          const h = Number(item.height_m);
          const selected = selection.includes(item.id);
          const invalid = invalidIds.has(item.id);
          return (
            <mesh
              key={item.id}
              castShadow
              receiveShadow
              position={[Number(item.x) + fx / 2, Number(item.z) + h / 2, Number(item.y) + fy / 2]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect([item.id]);
              }}
            >
              <boxGeometry args={[fx, h, fy]} />
              <meshStandardMaterial
                color={item.color}
                roughness={0.6}
                metalness={0.05}
                emissive={selected ? '#6366f1' : invalid ? '#7f1d1d' : '#000000'}
                emissiveIntensity={selected ? 0.5 : invalid ? 0.45 : 0}
                transparent
                opacity={0.94}
              />
            </mesh>
          );
        })}

        <OrbitControls
          target={[W / 2, H / 3, L / 2]}
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={1}
          maxDistance={span * 6}
        />
      </Canvas>
    </div>
  );
}
