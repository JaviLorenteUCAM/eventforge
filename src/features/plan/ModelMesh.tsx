import { useEffect, useMemo, useState } from 'react';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { loadModel } from './modelLoader';

/**
 * MODELO 3D (.glb) DE UN OBJETO
 * ---------------------------------------------------------------------------
 * Para lo que ninguna caja pintada reproduce —una silla gaming con su base de
 * cinco radios y su marca— la ficha puede llevar un modelo glTF. Se dibuja en
 * lugar de la caja con estas reglas:
 *
 *   · Se ESCALA a largo × alto × ancho de la ficha, eje por eje. Así ocupa en
 *     3D exactamente la huella que se ve en el 2D, y si alguien cambia las
 *     medidas del objeto el modelo las sigue.
 *   · Se CENTRA en el objeto, de modo que sus giros y su altura funcionan igual
 *     que con la caja. El frente del modelo es +Z, como el de la plantilla.
 *   · Mientras carga, o si el fichero no se puede leer, se ve `fallback` (la
 *     caja de siempre): un enlace caducado no deja un hueco en el plano.
 *
 * Cada .glb se descarga una vez (modelLoader) y las copias del plano clonan la
 * escena y comparten geometría y texturas.
 */

type GroupProps = Omit<ThreeElements['group'], 'ref' | 'children' | 'scale' | 'position'>;

interface Props extends GroupProps {
  url: string;
  length: number;
  width: number;
  height: number;
  /** Metros que se sube (o se hunde) el modelo. */
  floorOffset?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Lo que se ve mientras carga o si falla. */
  fallback: React.ReactNode;
}

export function ModelMesh({
  url,
  length,
  width,
  height,
  floorOffset = 0,
  emissive = '#000000',
  emissiveIntensity = 0,
  fallback,
  ...groupProps
}: Props) {
  const [source, setSource] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let alive = true;
    loadModel(url).then(
      (scene) => {
        if (alive) setSource(scene);
      },
      () => {
        if (alive) setSource(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);

  // Copia propia: comparte geometría y texturas con las demás, pero con sus
  // materiales, para poder resaltarla al seleccionarla sin resaltar todas.
  const instance = useMemo(() => {
    if (!source) return null;
    const root = source.clone(true);
    const materials: THREE.Material[] = [];
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const own = (m: THREE.Material) => {
        const c = m.clone();
        materials.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    return { root, materials, size };
  }, [source]);

  useEffect(
    () => () => {
      for (const m of instance?.materials ?? []) m.dispose();
    },
    [instance],
  );

  // Resalte de selección y de incidencias, como en la caja.
  useEffect(() => {
    if (!instance) return;
    const color = new THREE.Color(emissive);
    for (const m of instance.materials) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.emissive) continue;
      std.emissive.copy(color);
      // Sobre una textura oscura el resalte de la caja lo tiñe todo; a la
      // menos de la mitad se sigue viendo la tela y se nota igual qué está seleccionado.
      std.emissiveIntensity = emissiveIntensity * 0.3;
    }
  }, [instance, emissive, emissiveIntensity]);

  if (!instance) return <>{fallback}</>;

  const { size } = instance;
  const scale: [number, number, number] = [
    size.x > 0 ? Math.max(0.01, length) / size.x : 1,
    size.y > 0 ? Math.max(0.01, height) / size.y : 1,
    size.z > 0 ? Math.max(0.01, width) / size.z : 1,
  ];

  return (
    <group position={[0, floorOffset, 0]} scale={scale} {...groupProps}>
      <primitive object={instance.root} />
    </group>
  );
}
