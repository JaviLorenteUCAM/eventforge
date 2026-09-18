import type { PostgrestError } from '@supabase/supabase-js';
import { humanizeError, supabase } from '@/lib/supabase';

/**
 * Capa fina sobre PostgREST.
 * Centraliza el manejo de errores para que la UI reciba mensajes en castellano.
 */

export class ApiError extends Error {
  code?: string;
  constructor(error: PostgrestError | Error | unknown) {
    super(humanizeError(error));
    this.name = 'ApiError';
    this.code = (error as PostgrestError)?.code;
  }
}

function unwrap<T>({ data, error }: { data: T | null; error: PostgrestError | null }): T {
  if (error) throw new ApiError(error);
  return data as T;
}

/**
 * Constructor de consultas de PostgREST reducido a los metodos que usamos.
 * Se declara a mano porque los genericos reales de postgrest-js sobre un cliente
 * sin tipos generados hacen que TypeScript se pierda ("instantiation too deep").
 */
export interface QueryBuilder {
  eq(column: string, value: unknown): QueryBuilder;
  neq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  is(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
}

export async function selectAll<T>(
  table: string,
  build?: (q: QueryBuilder) => QueryBuilder,
  columns = '*',
): Promise<T[]> {
  const query = supabase.from(table).select(columns) as unknown as QueryBuilder;
  const finished = (build ? build(query) : query) as unknown as PromiseLike<{
    data: T[] | null;
    error: PostgrestError | null;
  }>;
  const res = await finished;
  return unwrap(res) ?? [];
}

export async function insertRow<T>(table: string, values: Record<string, unknown>): Promise<T> {
  const res = await supabase.from(table).insert(values).select().single();
  return unwrap(res as { data: T | null; error: PostgrestError | null });
}

export async function insertRows<T>(table: string, values: Record<string, unknown>[]): Promise<T[]> {
  if (values.length === 0) return [];
  const res = await supabase.from(table).insert(values).select();
  return unwrap(res as { data: T[] | null; error: PostgrestError | null }) ?? [];
}

export async function updateRow<T>(
  table: string,
  id: string,
  values: Record<string, unknown>,
): Promise<T> {
  const res = await supabase.from(table).update(values).eq('id', id).select().single();
  return unwrap(res as { data: T | null; error: PostgrestError | null });
}

export async function upsertRows<T>(
  table: string,
  values: Record<string, unknown>[],
  onConflict?: string,
): Promise<T[]> {
  if (values.length === 0) return [];
  const res = await supabase
    .from(table)
    .upsert(values, onConflict ? { onConflict } : undefined)
    .select();
  return unwrap(res as { data: T[] | null; error: PostgrestError | null }) ?? [];
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new ApiError(error);
}

export async function deleteWhere(
  table: string,
  column: string,
  value: string | string[],
): Promise<void> {
  const q = supabase.from(table).delete();
  const { error } = Array.isArray(value) ? await q.in(column, value) : await q.eq(column, value);
  if (error) throw new ApiError(error);
}
