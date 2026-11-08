/**
 * Declarative setting definitions. One schema drives three things:
 * the typed values object the game reads, the debug panel widgets, and what
 * gets saved to config/settings.json. Add a setting here and it appears in the
 * panel and the save file automatically.
 */
export interface NumDef { kind: 'number'; default: number; min: number; max: number; step: number; label: string; help?: string; unit?: string }
export interface BoolDef { kind: 'bool'; default: boolean; label: string; help?: string }
export interface SelectDef { kind: 'select'; default: string; options: readonly string[]; label: string; help?: string }
export interface ColorDef { kind: 'color'; default: string; label: string; help?: string }
export type Def = NumDef | BoolDef | SelectDef | ColorDef;

export interface Category { label: string; help?: string; defs: Record<string, Def> }
export type Schema = Record<string, Category>;

type ValueOf<D> = D extends NumDef ? number : D extends BoolDef ? boolean : string;
export type Values<S extends Schema> = { [C in keyof S]: { -readonly [K in keyof S[C]['defs']]: ValueOf<S[C]['defs'][K]> } };

export const num = (label: string, def: number, min: number, max: number, step: number, help?: string, unit?: string): NumDef =>
  ({ kind: 'number', label, default: def, min, max, step, help, unit });
export const bool = (label: string, def: boolean, help?: string): BoolDef => ({ kind: 'bool', label, default: def, help });
export const select = <T extends string>(label: string, def: T, options: readonly T[], help?: string): SelectDef =>
  ({ kind: 'select', label, default: def, options, help });
export const color = (label: string, def: string, help?: string): ColorDef => ({ kind: 'color', label, default: def, help });

export function defaultsOf<S extends Schema>(schema: S): Values<S> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [c, cat] of Object.entries(schema)) {
    out[c] = {};
    for (const [k, d] of Object.entries(cat.defs)) out[c][k] = d.default;
  }
  return out as Values<S>;
}

/** Coerce an untrusted value (from a JSON file) to a valid one, or undefined to keep the current value. */
export function coerce(d: Def, v: unknown): number | boolean | string | undefined {
  switch (d.kind) {
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'bool': return typeof v === 'boolean' ? v : undefined;
    case 'select': return typeof v === 'string' && d.options.includes(v) ? v : undefined;
    case 'color': return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
  }
}
