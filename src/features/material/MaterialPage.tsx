import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Boxes, CheckCircle2, Download, Package, Search } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Meter,
  SearchInput,
  Segmented,
  Stat,
} from '@/components/ui';
import { usePlanConnections, usePlanObjects, usePlans } from '@/data/plans';
import { useCategories, useCatalog, useWarehouseItems } from '@/data/warehouse';
import { useEvent } from '@/data/events';
import { computeMaterialNeeds, materialToCsv, summarizeMaterial } from '@/lib/materials';
import { downloadBlob, fmtKg, fmtM3, fmtNum, normalize, slugify } from '@/lib/utils';

export function MaterialPage() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const plans = usePlans(eventId);
  const planId = plans.data?.[0]?.id;
  const objects = usePlanObjects(planId);
  const connections = usePlanConnections(planId);
  const catalog = useCatalog();
  const items = useWarehouseItems();
  const categories = useCategories();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing' | 'ok'>('all');

  const needs = useMemo(
    () =>
      computeMaterialNeeds(
        objects.data ?? [],
        connections.data ?? [],
        catalog.data ?? [],
        items.data ?? [],
      ),
    [objects.data, connections.data, catalog.data, items.data],
  );

  const summary = summarizeMaterial(needs);

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const categoryName = (id: string | null) => (id ? (categoryById.get(id)?.name ?? 'Otros') : 'Otros');

  const filtered = useMemo(() => {
    const q = normalize(search);
    return needs.filter((n) => {
      if (filter === 'missing' && n.missing <= 0) return false;
      if (filter === 'ok' && n.missing > 0) return false;
      if (q && !normalize(n.name).includes(q)) return false;
      return true;
    });
  }, [needs, search, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const n of filtered) {
      const key = categoryName(n.categoryId);
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, categoryById]);

  function exportCsv() {
    const csv = materialToCsv(needs, categoryName);
    const name = `material-${slugify(event.data?.name ?? 'evento')}.csv`;
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name);
  }

  if (plans.isLoading || objects.isLoading) return <LoadingState />;

  return (
    <Page>
      <PageHeader
        title="Material"
        subtitle="Generado automáticamente a partir de los objetos y cables del plano"
        actions={
          <Button
            variant="outline"
            icon={<Download className="size-4" />}
            onClick={exportCsv}
            disabled={needs.length === 0}
          >
            Exportar CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Referencias" value={summary.lines} icon={<Package className="size-4" />} />
        <Stat
          label="Cobertura"
          value={`${summary.coverage}%`}
          hint={summary.totalMissing > 0 ? `Faltan ${fmtNum(summary.totalMissing, 0)} unidades` : 'Todo disponible'}
          tone={summary.coverage >= 100 ? 'ok' : 'warn'}
          icon={<Boxes className="size-4" />}
        />
        <Stat label="Peso estimado" value={fmtKg(summary.totalWeightKg)} />
        <Stat label="Volumen estimado" value={fmtM3(summary.totalVolumeM3)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} className="min-w-[220px] flex-1" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todo' },
            { value: 'missing', label: 'Falta material' },
            { value: 'ok', label: 'Disponible' },
          ]}
        />
      </div>

      {needs.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="Todavía no hay material"
          message="Añade objetos al plano del evento y aparecerán aquí automáticamente."
          icon={<Search className="size-5" />}
          action={
            <Link to="../plano">
              <Button size="sm" variant="primary">
                Abrir el plano
              </Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState className="mt-6" title="Nada coincide con el filtro" />
      ) : (
        <div className="mt-5 space-y-5">
          {grouped.map(([category, list]) => (
            <Card key={category} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{category}</h2>
                <span className="num text-[12px] text-dim">{list.length} referencias</span>
              </div>

              <div className="divide-y divide-[var(--ef-line)]">
                {list.map((n) => {
                  const pct = n.needed > 0 ? Math.min(100, (n.available / n.needed) * 100) : 100;
                  return (
                    <div key={n.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-[180px] flex-1">
                        <p className="text-[13.5px] text-ink">{n.name}</p>
                        <div className="mt-1.5 max-w-xs">
                          <Meter value={pct} height={5} color={n.missing > 0 ? '#f59e0b' : '#34d399'} />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-[12.5px]">
                        <Figure label="Necesario" value={`${fmtNum(n.needed, n.unit === 'm' ? 1 : 0)} ${n.unit}`} />
                        <Figure label="En almacén" value={`${fmtNum(n.available, n.unit === 'm' ? 1 : 0)} ${n.unit}`} />
                        <Figure
                          label="Faltan"
                          value={`${fmtNum(n.missing, n.unit === 'm' ? 1 : 0)} ${n.unit}`}
                          tone={n.missing > 0 ? 'danger' : 'ok'}
                        />
                      </div>

                      {n.missing > 0 ? (
                        <Badge color="#f59e0b">
                          <AlertTriangle className="size-3" /> Falta
                        </Badge>
                      ) : (
                        <Badge color="#34d399">
                          <CheckCircle2 className="size-3" /> OK
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-[12.5px] leading-relaxed text-dim">
        El cruce con el almacén se hace por unidad concreta asignada, por objeto de biblioteca o, en
        su defecto, por nombre.{' '}
        <Link to="/almacen" className="text-accent-soft hover:underline">
          Gestionar el almacén
        </Link>
        .
      </p>
    </Page>
  );
}

function Figure({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'ok' | 'danger';
}) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div className="text-right">
      <p className="text-[10.5px] uppercase tracking-[0.1em] text-dim">{label}</p>
      <p className={`num text-[13px] font-medium ${color}`}>{value}</p>
    </div>
  );
}
