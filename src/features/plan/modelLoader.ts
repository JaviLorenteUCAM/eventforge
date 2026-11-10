import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Cada .glb se descarga y se interpreta una vez; quien lo pinte clona la
 * escena y comparte geometría y texturas con las demás copias.
 */
const cache = new Map<string, Promise<THREE.Group>>();

export function loadModel(url: string): Promise<THREE.Group> {
  // Las URL firmadas cambian de token, pero la ruta es el mismo fichero.
  const key = url.split('?')[0];
  let promise = cache.get(key);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    // Si falla se olvida, para volver a intentarlo con la siguiente URL.
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return promise;
}
