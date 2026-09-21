import { create } from 'zustand';
import type { PlanObject } from '@/lib/types';

export type PlanTool = 'select' | 'power' | 'network' | 'signal' | 'calibrate' | 'measure';
export type PlanMode = '2d' | '3d';

interface PlanEditorState {
  mode: PlanMode;
  tool: PlanTool;
  selection: string[];
  /** Objeto de origen mientras se dibuja un cable. */
  linkFrom: string | null;

  showGrid: boolean;
  showLabels: boolean;
  showPower: boolean;
  showNetwork: boolean;
  showSignal: boolean;
  showMeasures: boolean;
  snap: boolean;

  /** Escala: pixeles por metro en la vista 2D. */
  zoom: number;
  panX: number;
  panY: number;

  clipboard: PlanObject[];

  /** Modo de ajuste de la imagen de fondo: mover y escalar la capa elegida. */
  bgEdit: boolean;
  setBgEdit: (v: boolean) => void;

  setMode: (m: PlanMode) => void;
  setTool: (t: PlanTool) => void;
  setSelection: (ids: string[]) => void;
  toggleInSelection: (id: string) => void;
  clearSelection: () => void;
  setLinkFrom: (id: string | null) => void;
  toggle: (
    key:
      | 'showGrid'
      | 'showLabels'
      | 'showPower'
      | 'showNetwork'
      | 'showSignal'
      | 'showMeasures'
      | 'snap',
  ) => void;
  setView: (v: { zoom?: number; panX?: number; panY?: number }) => void;
  zoomBy: (factor: number) => void;
  resetView: () => void;
  setClipboard: (objects: PlanObject[]) => void;
}

const DEFAULT_ZOOM = 42;

/** Estado local del editor (no se persiste: es interfaz, no datos). */
export const usePlanStore = create<PlanEditorState>((set, get) => ({
  mode: '2d',
  tool: 'select',
  selection: [],
  linkFrom: null,

  showGrid: true,
  showLabels: true,
  showPower: true,
  showNetwork: true,
  showSignal: true,
  showMeasures: false,
  snap: true,

  zoom: DEFAULT_ZOOM,
  panX: 40,
  panY: 40,

  clipboard: [],
  bgEdit: false,

  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool, linkFrom: null }),
  setSelection: (selection) => set({ selection }),
  toggleInSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),
  setLinkFrom: (linkFrom) => set({ linkFrom }),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<PlanEditorState>),
  setView: (v) => set(v),
  zoomBy: (factor) => set({ zoom: Math.min(240, Math.max(8, get().zoom * factor)) }),
  resetView: () => set({ zoom: DEFAULT_ZOOM, panX: 40, panY: 40 }),
  setClipboard: (clipboard) => set({ clipboard }),
  setBgEdit: (bgEdit) => set({ bgEdit, selection: bgEdit ? [] : get().selection }),
}));
