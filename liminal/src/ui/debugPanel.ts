import type { Def, Schema } from '../data/schema';
import { SETTINGS, DEFAULT_SETTINGS, PRESETS, diffSettings } from '../data/settings';
import type { ConfigStore } from '../data/config';

export interface PanelHooks {
  onOpenChange(open: boolean): void;
  reloadMap(): void;
  listMaps(): Promise<string[]>;
  loadMap(path: string): void;
  currentMap(): string;
  loadMapFile(file: File): void;
  mapStatus(): string;
}

type Row = { refresh(): void; matches(q: string): boolean; el: HTMLElement };

/**
 * The live tweak panel, generated entirely from the settings schema.
 * Changed values are highlighted and get a ↺ reset button, so you can always
 * see how far you've drifted from the defaults.
 */
export class DebugPanel {
  readonly root: HTMLDivElement;
  private rows: Row[] = [];
  private statusEl: HTMLDivElement;
  private search: HTMLInputElement;
  private textBox: HTMLTextAreaElement;
  open = false;

  constructor(private config: ConfigStore, private hooks: PanelHooks) {
    this.root = el('div', 'dbg');
    document.body.append(this.root);

    const head = el('div', 'dbg-head');
    head.append(el('div', 'dbg-title', 'LIMINAL · tweak panel'), el('div', 'dbg-hint', '` toggles · changes save automatically'));
    this.root.append(head);

    const bar = el('div', 'dbg-bar');
    // Two-click confirm: browser dialogs aren't available everywhere this runs.
    let armed = 0;
    const resetAll = button('Reset all', 'Every setting back to its default', () => {
      if (!armed) {
        resetAll.textContent = 'Click again to reset';
        armed = window.setTimeout(() => { armed = 0; resetAll.textContent = 'Reset all'; }, 3000);
        return;
      }
      clearTimeout(armed); armed = 0; resetAll.textContent = 'Reset all';
      this.config.replace({}, true);
      this.refresh();
      this.flash('all settings reset');
    });
    const presets = document.createElement('select');
    presets.append(new Option('Preset…', ''));
    for (const name of Object.keys(PRESETS)) presets.append(new Option(name, name));
    presets.onchange = () => {
      if (!presets.value) return;
      this.config.replace(PRESETS[presets.value]);
      presets.value = '';
      this.refresh();
    };
    bar.append(
      presets,
      button('Copy changes', 'Copy every non-default value as JSON (handy for sharing a tuning)', () => {
        const text = JSON.stringify(diffSettings(this.config.values), null, 2);
        // Called inside the click so the clipboard is allowed; fall back to a selectable box.
        navigator.clipboard.writeText(text).then(() => this.flash('copied'), () => this.showText(text));
      }),
      button('Export', 'Save the settings file (or show it, where downloads are blocked)', () => {
        if (this.config.storageKind === 'artifact') this.showText(this.config.toJSON());
        else download('settings.json', this.config.toJSON());
      }),
      button('Import', 'Load a settings .json', () => pickFile('.json', async (f) => {
        try {
          const j = JSON.parse(await f.text());
          this.config.replace(j.settings ?? j, true);
          this.refresh();
          this.flash(`imported ${f.name}`);
        } catch (e) { this.flash(`${f.name} isn't a settings file: ${(e as Error).message}`); }
      })),
      resetAll,
    );
    this.root.append(bar);

    const mapBar = el('div', 'dbg-bar');
    const maps = document.createElement('select');
    maps.id = 'dbg-maps';
    maps.title = 'Switch map';
    void this.hooks.listMaps().then((names) => {
      for (const n of names.filter((x) => x.endsWith('.json')).sort()) maps.append(new Option(n.replace(/\.json$/, ''), `maps/${n}`));
      maps.value = this.hooks.currentMap();
    });
    maps.onchange = () => this.hooks.loadMap(maps.value);
    mapBar.append(
      maps,
      button('Reload map', 'Re-read the map JSON from disk (R respawns without reloading)', () => this.hooks.reloadMap()),
      button('Open map…', 'Load a map .json (you can also drop one onto the window)', () => pickFile('.json', (f) => this.hooks.loadMapFile(f))),
    );
    this.root.append(mapBar);

    this.search = document.createElement('input');
    this.search.className = 'dbg-search';
    this.search.id = 'dbg-search';
    this.search.placeholder = 'filter settings…';
    this.search.oninput = () => this.filter();
    this.root.append(this.search);

    const body = el('div', 'dbg-body');
    this.root.append(body);
    for (const [cKey, cat] of Object.entries(SETTINGS as Schema)) body.append(this.category(cKey, cat.label, cat.help, cat.defs));

    this.textBox = document.createElement('textarea');
    this.textBox.className = 'dbg-text';
    this.textBox.readOnly = true;
    this.textBox.hidden = true;
    this.textBox.id = 'dbg-text';
    this.root.append(this.textBox);

    this.statusEl = el('div', 'dbg-status');
    this.root.append(this.statusEl);

    config.onChange(() => this.updateStatus());
    this.setOpen(false);
  }

  toggle(): void { this.setOpen(!this.open); }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.style.display = open ? 'flex' : 'none';
    if (open) { this.refresh(); this.updateStatus(); }
    this.hooks.onOpenChange(open);
  }

  refresh(): void {
    for (const r of this.rows) r.refresh();
  }

  private updateStatus(): void {
    this.statusEl.textContent = `${this.config.status}  ·  ${this.hooks.mapStatus()}`;
  }

  /** Show text selected and ready to copy, for when the clipboard or downloads are refused. */
  private showText(text: string): void {
    this.textBox.value = text;
    this.textBox.hidden = false;
    this.textBox.focus();
    this.textBox.select();
    this.flash('select-all + copy the text below (click elsewhere to close)');
    this.textBox.onblur = () => { this.textBox.hidden = true; };
  }

  private flash(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => this.updateStatus(), 1200);
  }

  private filter(): void {
    const q = this.search.value.trim().toLowerCase();
    for (const r of this.rows) r.el.style.display = !q || r.matches(q) ? '' : 'none';
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('details')) {
      if (q) d.open = true;
    }
  }

  private category(cKey: string, label: string, help: string | undefined, defs: Record<string, Def>): HTMLElement {
    const det = document.createElement('details');
    const storeKey = `liminal:panel:${cKey}`;
    try { det.open = localStorage.getItem(storeKey) !== '0'; } catch { det.open = true; }
    det.ontoggle = () => { try { localStorage.setItem(storeKey, det.open ? '1' : '0'); } catch { /* ignore */ } };
    const sum = document.createElement('summary');
    sum.textContent = label;
    det.append(sum);
    if (help) det.append(el('div', 'dbg-cathelp', help));
    for (const [k, d] of Object.entries(defs)) {
      const row = this.row(cKey, k, d);
      this.rows.push(row);
      det.append(row.el);
    }
    return det;
  }

  private row(cKey: string, key: string, d: Def): Row {
    const vals = this.config.values as unknown as Record<string, Record<string, unknown>>;
    const defs = DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>;
    const get = () => vals[cKey][key];
    const set = (v: unknown) => { vals[cKey][key] = v; this.config.changed(); mark(); };

    const rowEl = el('div', 'dbg-row');
    const lab = el('label', 'dbg-label', d.label + ('unit' in d && d.unit ? ` (${d.unit})` : ''));
    lab.title = `${cKey}.${key}${d.help ? '\n\n' + d.help : ''}\n\ndefault: ${String(d.default)}`;
    const ctl = el('div', 'dbg-ctl');
    const reset = button('↺', 'Reset to default', () => { set(defs[cKey][key]); refresh(); });
    reset.className = 'dbg-reset';
    rowEl.append(lab, ctl, reset);

    let refresh: () => void;
    if (d.kind === 'number') {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(d.min); range.max = String(d.max); range.step = String(d.step);
      const numEl = document.createElement('input');
      numEl.type = 'number';
      numEl.step = String(d.step);
      range.oninput = () => { set(parseFloat(range.value)); numEl.value = range.value; };
      numEl.onchange = () => { const v = parseFloat(numEl.value); if (Number.isFinite(v)) { set(v); range.value = String(v); } };
      ctl.append(range, numEl);
      refresh = () => { range.value = String(get()); numEl.value = String(get()); mark(); };
    } else if (d.kind === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.onchange = () => set(cb.checked);
      ctl.append(cb);
      refresh = () => { cb.checked = get() as boolean; mark(); };
    } else if (d.kind === 'select') {
      const sel = document.createElement('select');
      for (const o of d.options) sel.append(new Option(o, o));
      sel.onchange = () => set(sel.value);
      ctl.append(sel);
      refresh = () => { sel.value = get() as string; mark(); };
    } else {
      const c = document.createElement('input');
      c.type = 'color';
      c.oninput = () => set(c.value);
      ctl.append(c);
      refresh = () => { c.value = get() as string; mark(); };
    }
    function mark() { rowEl.classList.toggle('changed', get() !== defs[cKey][key]); }
    refresh();
    const hay = `${cKey}.${key} ${d.label} ${d.help ?? ''}`.toLowerCase();
    return { el: rowEl, refresh, matches: (q) => hay.includes(q) };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.onclick = (e) => { e.preventDefault(); onClick(); };
  return b;
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickFile(accept: string, cb: (f: File) => void): void {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = accept;
  i.onchange = () => { if (i.files?.[0]) cb(i.files[0]); };
  i.click();
}
