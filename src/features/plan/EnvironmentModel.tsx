import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { frameScale } from './modelFootprint';
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
 * (`eventforge.imageWidthM` / `imageHeightM`): si la capa es esa misma
 * captura, se escala para encajar con su calibración; si es otra imagen, va a
 * su tamaño real. Siempre con la MISMA escala en los tres ejes (frameScale),
 * y girado y colocado igual que la imagen. Sin esas medidas, en metros.
 *
 * Encima va el AJUSTE de la capa (desplazamiento, giro y escala), para cuando
 * la foto del plano no es exactamente la captura para la que se hizo el
 * modelo. Aquí giro y escala van alrededor del centro de la imagen, pero el
 * panel y el 2D corrigen el desplazamiento para que, en la práctica, giren y
 * escalen alrededor del centro del propio modelo (aroundCentre).
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

  const extras = (source.userData as { eventforge?: { imageWidthM?: number; imageHeightM?: number } })
    .eventforge;
  // La misma escala en los tres ejes: escalar ancho y alto por separado
  // convertía los pabellones cuadrados en rombos (ver frameScale).
  const s = frameScale(
    width,
    height,
    extras?.imageWidthM && extras.imageHeightM
      ? { width: extras.imageWidthM, height: extras.imageHeightM }
      : null,
  );

  return (
    // Mismo giro que la imagen (alrededor de su centro) y el modelo desde su
    // esquina superior izquierda.
    <group
      position={[x + width / 2 + offsetX, 0, y + height / 2 + offsetY]}
      rotation={[0, (-(rotation + extraRotation) * Math.PI) / 180, 0]}
      scale={scale > 0 ? scale : 1}
    >
      <group position={[-width / 2, 0, -height / 2]} scale={s}>
        <primitive object={root} />
      </group>
    </group>
  );
}
