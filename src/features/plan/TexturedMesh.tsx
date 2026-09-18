import { useEffect, useMemo, useState } from 'react';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { boxFaceUvs } from '@/lib/textureAtlas';
import type { TextureMode } from '@/lib/types';

export interface TextureSpec {
  url: string;
  mode: TextureMode;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  /**
   * Medidas (en metros) para las que se generó la plantilla.
   *
   * La rejilla del atlas es PROPORCIONAL al objeto, así que el reparto de las
   * caras dentro de la imagen depende de las medidas con las que se exportó, no
   * de las que tenga la copia colocada en el plano. Si se usaran estas últimas,
   * al redimensionar un objeto en el plano los recuadros dejarían de coincidir
   * con sus caras y los colores saldrían desplazados.
   */
  atlas: { length: number; width: number; height: number };
}

/**
 * Carga una imagen como textura de three.js.
 *
 * Se hace a mano en lugar de con useTexture/useLoader porque las URLs son
 * FIRMADAS y cambian: la caché de useLoader guardaría la URL caducada y con
 * Suspense un fallo de red tumbaría toda la escena.
 */
function useImageTexture(url: string | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        setTexture(t);
      },
      undefined,
      () => {
        // Imagen inaccesible o URL caducada: se cae al color plano del objeto.
        if (alive) setTexture(null);
      },
    );

    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}

/** Aplica la transformación manual de la textura (solo en modo mosaico). */
function applyTile(t: THREE.Texture, spec: TextureSpec) {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(spec.scale, spec.scale);
  t.offset.set(spec.offsetX, spec.offsetY);
  t.center.set(0.5, 0.5);
  t.rotation = (spec.rotation * Math.PI) / 180;
}

interface Props extends Omit<ThreeElements['mesh'], 'ref' | 'material' | 'children' | 'args'> {
  shape: 'box' | 'cylinder' | 'plane' | 'text' | 'line';
  length: number;
  width: number;
  height: number;
  color: string;
  texture?: TextureSpec;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

/**
 * Malla del objeto con soporte de textura.
 *
 * En modo `atlas`, la imagen es el despliegue en cruz del objeto: se crean seis
 * materiales, uno por cara, cada uno apuntando a su recuadro mediante
 * offset/repeat. Así lo que se dibuja en «FRENTE» aparece exactamente en la
 * cara frontal, con sus proporciones reales.
 */
export function TexturedMesh({
  shape,
  length,
  width,
  height,
  color,
  texture,
  emissive = '#000000',
  emissiveIntensity = 0,
  transparent,
  opacity = 1,
  ...meshProps
}: Props) {
  const map = useImageTexture(texture?.url);
  const isBox = shape !== 'cylinder';

  const materials = useMemo(() => {
    const base = {
      roughness: 0.6,
      metalness: 0.05,
      emissive: new THREE.Color(emissive),
      emissiveIntensity,
      transparent,
      opacity,
    };

    if (!map || !texture) {
      return new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(color) });
    }

    if (texture.mode === 'tile' || !isBox) {
      const t = map.clone();
      t.needsUpdate = true;
      applyTile(t, texture);
      return new THREE.MeshStandardMaterial({ ...base, map: t });
    }

    // Medio téxel de margen por lado: sin él, el filtrado bilineal muestrea el
    // recuadro contiguo en el borde y aparece un ribete del color de la cara
    // vecina.
    const imageW = (map.image as { width?: number } | undefined)?.width ?? 1024;
    const imageH = (map.image as { height?: number } | undefined)?.height ?? 1024;
    const insetU = 0.5 / imageW;
    const insetV = 0.5 / imageH;

    // Atlas: un material por cara, en el orden de BoxGeometry, y con el reparto
    // calculado sobre las medidas de la PLANTILLA.
    const { length: al, width: aw, height: ah } = texture.atlas;

    return boxFaceUvs(al, aw, ah).map((uv) => {
      const t = map.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      // Los mipmaps mezclarían recuadros contiguos al ver el objeto pequeño.
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.offset.set(uv.offset[0] + insetU, uv.offset[1] + insetV);
      t.repeat.set(uv.repeat[0] - insetU * 2, uv.repeat[1] - insetV * 2);
      return new THREE.MeshStandardMaterial({ ...base, map: t });
    });
  }, [map, texture, isBox, color, emissive, emissiveIntensity, transparent, opacity]);

  // Los materiales y sus texturas clonadas se liberan al recrearse.
  useEffect(
    () => () => {
      const list = Array.isArray(materials) ? materials : [materials];
      for (const m of list) {
        m.map?.dispose();
        m.dispose();
      }
    },
    [materials],
  );

  // El material se asigna como PROP de la malla, no como hijo con `attach`.
  // Con `attach="material-0"` R3F intentaría escribir en mesh.material[0], que
  // no existe mientras mesh.material siga siendo un material suelto, y los seis
  // materiales del atlas se perderían en silencio.
  return (
    <mesh castShadow receiveShadow material={materials} {...meshProps}>
      {shape === 'cylinder' ? (
        <cylinderGeometry args={[length / 2, length / 2, Math.max(0.01, height), 28]} />
      ) : (
        <boxGeometry args={[length, Math.max(0.01, height), width]} />
      )}
    </mesh>
  );
}

/**
 * Imagen de referencia proyectada sobre el suelo (foto aérea, plano del
 * recinto, textura...). Se dibuja ligeramente por encima del suelo para evitar
 * el z-fighting, separando cada capa por su z_index.
 */
export function GroundImage({
  url,
  x,
  y,
  width,
  height,
  rotation,
  opacity,
  layer,
}: {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  layer: number;
}) {
  const map = useImageTexture(url);
  if (!map) return null;

  return (
    <mesh
      position={[x + width / 2, 0.004 + layer * 0.003, y + height / 2]}
      rotation={[-Math.PI / 2, 0, (-rotation * Math.PI) / 180]}
      receiveShadow
    >
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={map}
        transparent
        opacity={opacity}
        roughness={0.95}
        metalness={0}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
