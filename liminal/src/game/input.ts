import { type Action, DEFAULT_BINDINGS } from '../data/bindings';

/**
 * Keyboard + pointer-locked mouse. Physics reads held state once per tick;
 * presses that happen between ticks are latched so a tap or a scroll-wheel
 * jump is never lost, even at low tick rates.
 */
export class Input {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  private down = new Set<string>();
  private pressedLatch = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  /** Scroll-wheel jumps waiting to be consumed by ticks. */
  private wheelJumps = 0;
  wheelJump = true;
  rawInput = true;
  /** Keyboard captured by a text field / panel: ignore game keys. */
  enabled = true;
  onPress: ((a: Action, e: KeyboardEvent) => void) | null = null;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked && this.wheelJump && e.deltaY !== 0) this.wheelJumps = Math.min(this.wheelJumps + 1, 4);
    }, { passive: true });
    target.addEventListener('click', () => this.lock());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  lock(): void {
    if (this.locked) return;
    const el = this.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = el.requestPointerLock(this.rawInput ? { unadjustedMovement: true } : undefined);
      // unadjustedMovement isn't supported everywhere (Firefox, some Linux); fall back.
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => el.requestPointerLock());
    } catch {
      el.requestPointerLock();
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private key(e: KeyboardEvent, isDown: boolean): void {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    // Typing in a panel field shouldn't move the player, but releases always
    // count, so a key can't get stuck down.
    if (typing && isDown && e.code !== 'Backquote') return;
    if (isDown) {
      if (!this.down.has(e.code)) {
        for (const a of this.actionsFor(e.code)) {
          this.pressedLatch.add(a);
          this.onPress?.(a, e);
        }
      }
      this.down.add(e.code);
    } else {
      this.down.delete(e.code);
    }
    // Keep the browser from scrolling / opening menus while playing.
    if (this.locked || ['Space', 'AltLeft', 'Backquote', 'F1', 'Tab'].includes(e.code)) e.preventDefault();
  }

  private actionsFor(code: string): Action[] {
    const out: Action[] = [];
    for (const [a, codes] of Object.entries(this.bindings) as [Action, string[]][]) if (codes.includes(code)) out.push(a);
    return out;
  }

  held(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.down.has(c));
  }

  /** Held now, or pressed at any point since the last tick. */
  heldOrLatched(a: Action): boolean {
    return this.held(a) || (this.enabled && this.pressedLatch.has(a));
  }

  /** One wheel notch = jump held for exactly one tick. */
  consumeWheelJump(): boolean {
    if (this.wheelJumps <= 0) return false;
    this.wheelJumps--;
    return true;
  }

  /** Call at the end of each physics tick. */
  endTick(): void {
    this.pressedLatch.clear();
  }

  consumeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
