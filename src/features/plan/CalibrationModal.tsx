import { useEffect, useState } from 'react';
import { Ruler } from 'lucide-react';
import { Button, Checkbox, Field, Modal, NumberInput } from '@/components/ui';
import type { PlanBackground } from '@/lib/types';
import { fmtNum, round } from '@/lib/utils';
import type { CalibrationLine } from './Editor2D';

export interface CalibrationResult {
  /** Factor a aplicar a la capa (y opcionalmente al recinto). */
  factor: number;
  background: Partial<PlanBackground>;
  /** Nuevas medidas del recinto, si se pide ajustarlo a la imagen. */
  plan?: { width_m: number; depth_m: number };
}

/**
 * Convierte un trazo sobre la imagen en la escala real del escenario.
 *
 * La imagen se escala alrededor del PUNTO MEDIO del trazo, de modo que el
 * elemento que se acaba de medir se queda donde está y no hay que volver a
 * buscarlo tras calibrar.
 */
export function CalibrationModal({
  line,
  background,
  onClose,
  onApply,
}: {
  line: CalibrationLine | null;
  background: PlanBackground | null;
  onClose: () => void;
  onApply: (result: CalibrationResult) => void;
}) {
  const [realLength, setRealLength] = useState(5);
  const [fitPlan, setFitPlan] = useState(true);

  useEffect(() => {
    if (line) setRealLength(Math.max(0.1, round(line.measured, 1)));
  }, [line]);

  if (!line) return null;

  const factor = realLength / Math.max(0.0001, line.measured);
  const midX = (line.x0 + line.x1) / 2;
  const midY = (line.y0 + line.y1) / 2;

  const newWidth = background ? round(Number(background.width_m) * factor, 3) : 0;
  const newHeight = background ? round(Number(background.height_m) * factor, 3) : 0;

  function apply() {
    if (!background) return;

    // Escalado respecto al punto medio del trazo.
    const nx = round(midX - (midX - Number(background.x)) * factor, 3);
    const ny = round(midY - (midY - Number(background.y)) * factor, 3);

    const result: CalibrationResult = {
      factor,
      background: fitPlan
        ? { x: 0, y: 0, width_m: newWidth, height_m: newHeight }
        : { x: nx, y: ny, width_m: newWidth, height_m: newHeight },
    };

    if (fitPlan) {
      result.plan = { width_m: newWidth, depth_m: newHeight };
    }

    onApply(result);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Ruler className="size-4 text-[var(--ef-cyan)]" />
          Calibrar la escala
        </span>
      }
      description="Indica cuánto mide en la realidad la línea que acabas de trazar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={apply} disabled={!background || realLength <= 0}>
            Aplicar escala
          </Button>
        </>
      }
    >
      {!background ? (
        <p className="text-[13px] text-warn">
          Selecciona primero la capa de imagen que quieres calibrar en el panel de fondos.
        </p>
      ) : (
        <div className="space-y-4">
          <Field label="Longitud real de la línea" required>
            <NumberInput
              value={realLength}
              onChange={(v) => setRealLength(Math.max(0.01, v))}
              unit="m"
              step={0.1}
              min={0.01}
            />
          </Field>

          <div className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px]">
            <Row label="Medida actual del trazo" value={`${fmtNum(line.measured, 2)} m`} />
            <Row label="Factor de corrección" value={`× ${fmtNum(factor, 3)}`} />
            <div className="my-2 border-t border-line" />
            <Row
              label="Imagen antes"
              value={`${fmtNum(Number(background.width_m), 2)} × ${fmtNum(Number(background.height_m), 2)} m`}
            />
            <Row
              label="Imagen después"
              value={`${fmtNum(newWidth, 2)} × ${fmtNum(newHeight, 2)} m`}
              strong
            />
          </div>

          <Checkbox
            label="Ajustar el recinto al tamaño de la imagen"
            checked={fitPlan}
            onChange={(e) => setFitPlan(e.target.checked)}
          />
          <p className="-mt-2 text-[11.5px] leading-relaxed text-dim">
            {fitPlan
              ? `El escenario pasará a medir ${fmtNum(newWidth, 2)} × ${fmtNum(newHeight, 2)} m y la imagen quedará encajada en la esquina. Es lo habitual la primera vez que calibras.`
              : 'La imagen se escala en su sitio y el recinto no cambia. Útil si añades una segunda capa sobre un escenario ya calibrado.'}
          </p>

          {factor > 20 || factor < 0.05 ? (
            <p className="rounded-lg border border-[color-mix(in_oklab,var(--ef-warn)_40%,transparent)] bg-[color-mix(in_oklab,var(--ef-warn)_10%,transparent)] px-2.5 py-2 text-[11.5px] text-ink">
              El cambio de escala es muy grande (×{fmtNum(factor, 2)}). Comprueba que la línea y la
              medida se corresponden.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
