import { useEffect, useMemo, useState } from 'react';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { boxFaceUvs } from '@/lib/textureAtlas';
import { silhouetteFromImage } from '@/lib/silhouette';
import { bleedImage, buildVolume, readAlpha, type VolumeMesh } from '@/lib/volume';
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
  /**
   * Color que se recorta de la imagen, en hexadecimal. Sirve para dejar huecos
   * de verdad —el centro vacío de un soporte de televisión— sin necesidad de un
   * PNG con transparencia: se pinta el hueco de un color que no se use en el
   * resto del dibujo y se marca aquí.
   */
  keyColor?: string | null;
  /** Cuánto se parecen los píxeles que también se recortan: 0 exacto, 1 todo. */
  keyTolerance?: number;
  /**
   * Metros que se sube (o se hunde, si es negativo) la forma sacada de la
   * imagen. Una silla tallada desde sus fotos puede quedar flotando: las
   * ruedas son tan finas que no sobreviven al cruce de las vistas, o la foto
   * deja aire por debajo.
   */
  floorOffset?: number;
}

/**
 * Recorta de la imagen todo lo que se parezca al color indicado.
 *
 * Se compara en RGB con una distancia euclídea normalizada: hace falta margen
 * porque el color se ensucia al guardar en JPEG o al reescalar, y un recorte
 * exacto dejaría un halo de píxeles sueltos por los bordes.
 */
function keyOutColor(image: CanvasImageSource & { width: number; height: number }, hex: string, tolerance: number) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);

  const key = new THREE.Color(hex);
  const kr = key.r * 255;
  const kg = key.g * 255;
  const kb = key.b * 255;
  // 441.67 = distancia máxima posible en RGB (raíz de 3 × 255²).
  const limit = Math.max(0, Math.min(1, tolerance)) * 441.673;

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb);
    if (d <= limit) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Carga una imagen como textura de three.js.
 *
 * Se hace a mano en lugar de con useTexture/useLoader porque las URLs son
 * FIRMADAS y cambian: la caché de useLoader guardaría la URL caducada y con
 * Suspense un fallo de red tumbaría toda la escena.
 */
function useImageTexture(
  url: string | undefined,
  keyColor?: string | null,
  keyTolerance = 0.12,
): THREE.Texture | null {
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

        // Con color clave, la imagen pasa por un lienzo donde se le quita el
        // alfa a lo que se le parezca. Sin él se usa tal cual: si el PNG ya
        // trae transparencia, el recorte por alfa del material hace el resto.
        if (keyColor) {
          const img = t.image as (CanvasImageSource & { width: number; height: number }) | undefined;
          const cut = img?.width ? keyOutColor(img, keyColor, keyTolerance) : null;
          if (cut) {
            const canvasTexture = new THREE.CanvasTexture(cut);
            canvasTexture.colorSpace = THREE.SRGBColorSpace;
            canvasTexture.anisotropy = 4;
            t.dispose();
            setTexture(canvasTexture);
            return;
          }
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
  }, [url, keyColor, keyTolerance]);

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

/**
 * GEOMETRÍA EXTRUIDA A PARTIR DE LA IMAGEN
 *
 * En modo silueta la imagen no se pinta sobre una caja: se lee su contorno y se
 * le da fondo. Lo sólido de la imagen se convierte en volumen macizo y lo
 * transparente en aire, así que un soporte de televisión sale como dos patas
 * unidas por su base y el hueco lo es por los cuatro costados, en lugar de ser
 * una carcasa con los laterales enteros.
 *
 * Devuelve null si no se puede leer el contorno; el llamante vuelve entonces a
 * la caja de siempre.
 */
function useSilhouetteGeometry(
  map: THREE.Texture | null,
  spec: TextureSpec | undefined,
  length: number,
  width: number,
  height: number,
): THREE.ExtrudeGeometry | null {
  const geometry = useMemo(() => {
    if (!map || spec?.mode !== 'silhouette') return null;
    const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image?.width) return null;

    const sil = silhouetteFromImage(image, {
      keyColor: spec.keyColor,
      keyTolerance: spec.keyTolerance,
    });
    if (!sil || sil.outers.length === 0) return null;

    // La silueta viene en 0..1; se lleva a metros y se centra en el origen.
    const toShape = (points: { x: number; y: number }[]) => {
      const path = new THREE.Shape();
      points.forEach((p, i) => {
        const x = (p.x - 0.5) * length;
        const y = (p.y - 0.5) * height;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      return path;
    };

    const shapes = sil.outers.map((outer, i) => {
      const shape = toShape(outer);
      shape.holes = sil.holes[i].map((hole) => {
        const p = new THREE.Path();
        hole.forEach((q, j) => {
          const x = (q.x - 0.5) * length;
          const y = (q.y - 0.5) * height;
          if (j === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        });
        p.closePath();
        return p;
      });
      return shape;
    });

    const depth = Math.max(0.01, width);
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: false,
      steps: 1,
      // Las UV por defecto vienen en METROS; se rehacen abajo en 0..1.
      UVGenerator: {
        generateTopUV(_g, vertices, a, b, c) {
          const uv = (i: number) =>
            new THREE.Vector2(
              vertices[i * 3] / length + 0.5,
              vertices[i * 3 + 1] / height + 0.5,
            );
          return [uv(a), uv(b), uv(c)];
        },
        generateSideWallUV() {
          // Los cantos llevan color liso, no textura: son la superficie del
          // corte y con la imagen estirada quedarían embarrados.
          const z = new THREE.Vector2(0, 0);
          return [z, z.clone(), z.clone(), z.clone()];
        },
      },
    });
    // La extrusión crece hacia +Z; se centra para que el objeto siga estando
    // donde dice su posición.
    geo.translate(0, 0, -depth / 2);
    return geo;
  }, [map, spec, length, width, height]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}

/**
 * Lo calculado para cada imagen y medidas. Tallar una silla cuesta unos
 * cientos de milisegundos; con veinte sillas iguales en el plano se hace una
 * vez y el resto lo reutiliza. Cada malla crea su propia geometría y textura a
 * partir de estos datos, así que puede liberarlas sin afectar a las demás.
 */
const volumeCache = new Map<string, { mesh: VolumeMesh; canvas: HTMLCanvasElement } | null>();

function volumeKey(url: string, spec: TextureSpec, l: number, w: number, h: number) {
  // Las URL firmadas cambian de token, pero la ruta es la misma imagen.
  const path = url.split('?')[0];
  const a = spec.atlas;
  return [path, spec.keyColor ?? '', spec.keyTolerance ?? '', l, w, h, a.length, a.width, a.height].join('|');
}

/**
 * VOLUMEN TALLADO CON LAS VISTAS (modo `volume`)
 *
 * La plantilla es la misma cruz de seis caras que el modo por caras, pero con
 * el fondo de cada foto recortado. En vez de pegar las fotos sobre una caja,
 * se cruzan sus contornos para sacar la forma del objeto y se pinta cada parte
 * con la foto que la ve de frente. Ver `src/lib/volume.ts`.
 */
function useVolume(
  map: THREE.Texture | null,
  spec: TextureSpec | undefined,
  length: number,
  width: number,
  height: number,
): { geometry: THREE.BufferGeometry; map: THREE.Texture } | null {
  const result = useMemo(() => {
    if (!map || !spec || spec.mode !== 'volume') return null;
    const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image?.width) return null;

    const key = volumeKey(spec.url, spec, length, width, height);
    let data = volumeCache.get(key);
    if (data === undefined) {
      const alpha = readAlpha(image, spec.keyColor, spec.keyTolerance);
      const mesh = alpha ? buildVolume(alpha, spec.atlas, length, width, height) : null;
      const canvas = mesh ? bleedImage(image, spec.keyColor, spec.keyTolerance) : null;
      data = mesh && canvas ? { mesh, canvas } : null;
      if (volumeCache.size > 32) volumeCache.delete(volumeCache.keys().next().value!);
      volumeCache.set(key, data);
    }
    if (!data) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.mesh.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.mesh.uvs, 2));
    geometry.computeBoundingSphere();

    const texture = new THREE.CanvasTexture(data.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return { geometry, map: texture };
  }, [map, spec, length, width, height]);

  useEffect(
    () => () => {
      result?.geometry.dispose();
      result?.map.dispose();
    },
    [result],
  );
  return result;
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
  const map = useImageTexture(texture?.url, texture?.keyColor, texture?.keyTolerance);
  const isBox = shape !== 'cylinder';
  const silhouette = useSilhouetteGeometry(map, texture, length, width, height);
  const volume = useVolume(isBox ? map : null, texture, length, width, height);

  const materials = useMemo(() => {
    const base = {
      roughness: 0.6,
      metalness: 0.05,
      emissive: new THREE.Color(emissive),
      emissiveIntensity,
      transparent,
      opacity,
      // Los píxeles sin alfa desaparecen del todo. Se usa alphaTest y no
      // `transparent` a secas porque así no hay que ordenar nada por
      // profundidad: el hueco es hueco, con borde limpio, y el objeto se sigue
      // comportando como opaco.
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    };

    if (!map || !texture) {
      return new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(color) });
    }

    // Volumen: la forma ya es la del objeto, así que no se recorta nada por
    // alfa (los bordes saldrían mordidos) y basta con una cara.
    if (volume) {
      return new THREE.MeshStandardMaterial({
        ...base,
        map: volume.map,
        alphaTest: 0,
        side: THREE.FrontSide,
      });
    }

    // Silueta: dos materiales, uno para las caras (con la imagen) y otro para
    // los cantos del corte (color liso). ExtrudeGeometry los separa en grupos.
    if (silhouette) {
      const t = map.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      return [
        new THREE.MeshStandardMaterial({ ...base, map: t }),
        new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(color) }),
      ];
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
  }, [map, texture, isBox, silhouette, volume, color, emissive, emissiveIntensity, transparent, opacity]);

  // Los materiales y sus texturas clonadas se liberan al recrearse.
  useEffect(
    () => () => {
      const list = Array.isArray(materials) ? materials : [materials];
      for (const m of list) {
        // La textura del volumen es suya y la libera useVolume.
        if (m.map && m.map !== volume?.map) m.map.dispose();
        m.dispose();
      }
    },
    [materials, volume],
  );

  // Solo se mueve la forma sacada de la imagen; una caja pintada ya apoya
  // exacta. Se hace con un grupo y no tocando la geometría, que en el modo
  // volumen comparte sus datos con las demás copias del mismo material.
  const lift = silhouette || volume ? Number(texture?.floorOffset) || 0 : 0;

  // El material se asigna como PROP de la malla, no como hijo con `attach`.
  // Con `attach="material-0"` R3F intentaría escribir en mesh.material[0], que
  // no existe mientras mesh.material siga siendo un material suelto, y los seis
  // materiales del atlas se perderían en silencio.
  return (
    <group position={[0, lift, 0]}>
      <mesh
        castShadow
        receiveShadow
        material={materials}
        geometry={silhouette ?? volume?.geometry ?? undefined}
        {...meshProps}
      >
        {silhouette || volume ? null : shape === 'cylinder' ? (
          <cylinderGeometry args={[length / 2, length / 2, Math.max(0.01, height), 28]} />
        ) : (
          <boxGeometry args={[length, Math.max(0.01, height), width]} />
        )}
      </mesh>
    </group>
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
        // Siempre por delante de la rejilla, que va un centímetro por debajo:
        // con la cámara lejos la profundidad no da para separarlas y la rejilla
        // atravesaba la foto a trozos.
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}
