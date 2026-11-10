import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadModel } from './modelLoader';

/**
 * MODELO 3D DEL RECINTO, ENCAJADO SOBRE SU IMAGEN DE FONDO
 * ---------------------------------------------------------------------------
 * Lo que ya hay en el sitio —las pérgolas de la UCAM con sus cubiertas, pasos
 * cubiertos y pilares— no es un objeto del evento: no se mueve, no se
 * selecciona y no debe estorbar al colocar nada debajo. Por eso va colgado de
 * la imagen de fondo a la que corresponde y solo se dibuja en 3D.
 *
 * El modelo está en el MARCO DE LA IMAGEN: origen en su esquina superior
 * izquierda, X hacia la derecha y Z hacia abajo de la foto, en metros. En los
 * «extras» de la escena trae las medidas de esa imagen
 * (`eventforge.imageWidthM` / `imageHeightM`), así que aquí se escala para que
 * la imagen mida lo que mida su capa ya calibrada, y se gira y se coloca igual
 * que ella. Si el modelo no trae esas medidas se usa tal cual, en metros.
 *
 * Encima va el AJUSTE de la capa (desplazamiento, giro y escala), para cuando
 * la foto del plano no es exactamente la captura para la que se hizo el
 * modelo. Giro y escala se aplican alrededor del centro de la imagen.
 *
 * No lleva manejadores de eventos: los clics lo atraviesan hasta el suelo y
 * los objetos, de modo que se puede seguir colocando y arrastrando debajo.
 */
export function EnvironmentModel({
  url,
  x,
  y,
  width,
  height,
  rotation,
  offsetX = 0,
  offsetY = 0,
  extraRotation = 0,
  scale = 1,
}: {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  offsetX?: number;
  offsetY?: number;
  extraRotation?: number;
  scale?: number;
}) {
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

  const root = useMemo(() => {
    if (!source) return null;
    const copy = source.clone(true);
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return copy;
  }, [source]);

  if (!root || !source) return null;

  const frame = (source.userData as { eventforge?: { imageWidthM?: number; imageHeightM?: number } })
    .eventforge;
  const sx = frame?.imageWidthM ? width / frame.imageWidthM : 1;
  const sz = frame?.imageHeightM ? height / frame.imageHeightM : 1;
  // La altura no viene en la imagen: escala con la media de los otros dos,
  // que es la corrección que la calibración le ha hecho a los supuestos.
  const sy = (sx + sz) / 2;

  return (
    // Mismo giro que la imagen (alrededor de su centro) y el modelo desde su
    // esquina superior izquierda.
    <group
      position={[x + width / 2 + offsetX, 0, y + height / 2 + offsetY]}
      rotation={[0, (-(rotation + extraRotation) * Math.PI) / 180, 0]}
      scale={scale > 0 ? scale : 1}
    >
      <group position={[-width / 2, 0, -height / 2]} scale={[sx, sy, sz]}>
        <primitive object={root} />
      </group>
    </group>
  );
}
