/**
 * Default key bindings, by KeyboardEvent.code (physical key, layout
 * independent). Overridable via "bindings" in config/settings.json.
 *
 * Crouch is on C as well as Ctrl because Ctrl+W closes a browser tab.
 * The desktop build can make Ctrl the main crouch key.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'duck' | 'sprint' | 'walk'
  | 'noclip' | 'respawn' | 'panel' | 'flyUp' | 'flyDown';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  duck: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft'],
  walk: ['AltLeft'],
  noclip: ['KeyV'],
  respawn: ['KeyR'],
  panel: ['Backquote', 'F1'],
  flyUp: ['Space'],
  flyDown: ['KeyC', 'ControlLeft'],
};
