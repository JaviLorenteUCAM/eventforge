import { useCallback, useRef, useState } from 'react';

export interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const LIMIT = 60;

interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  lastLabel?: string;
}

/**
 * Deshacer / rehacer basado en COMANDOS.
 *
 * Cada acción del editor registra cómo revertirse y cómo repetirse. Es más
 * fiable que guardar instantáneas completas del plano: no depende del tamaño
 * del plano y se lleva bien con la base de datos remota (cada undo/redo es una
 * escritura real, de modo que el resto del equipo ve el resultado).
 *
 * Las pilas viven en refs (no deben provocar renders por sí mismas) y el estado
 * visible de los botones se publica aparte, en `status`.
 */
export function useHistory() {
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);
  const busy = useRef(false);
  const [status, setStatus] = useState<HistoryStatus>({ canUndo: false, canRedo: false });

  const sync = useCallback(() => {
    setStatus({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      lastLabel: past.current[past.current.length - 1]?.label,
    });
  }, []);

  const push = useCallback(
    (entry: HistoryEntry) => {
      past.current.push(entry);
      if (past.current.length > LIMIT) past.current.shift();
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(async () => {
    if (busy.current) return;
    const entry = past.current.pop();
    if (!entry) return;
    busy.current = true;
    try {
      await entry.undo();
      future.current.push(entry);
    } finally {
      busy.current = false;
      sync();
    }
  }, [sync]);

  const redo = useCallback(async () => {
    if (busy.current) return;
    const entry = future.current.pop();
    if (!entry) return;
    busy.current = true;
    try {
      await entry.redo();
      past.current.push(entry);
    } finally {
      busy.current = false;
      sync();
    }
  }, [sync]);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: status.canUndo,
    canRedo: status.canRedo,
    lastLabel: status.lastLabel,
  };
}
