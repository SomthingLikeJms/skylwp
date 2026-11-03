export type WidgetId = 'weather' | 'agents';
export interface WidgetPoint {
  x: number;
  y: number;
}
export type WidgetPositions = Record<WidgetId, WidgetPoint>;
export const DEFAULT_WIDGET_POSITIONS: WidgetPositions = {
  weather: { x: 0.06, y: 0.03 },
  agents: { x: 0.06, y: 0.23 },
};
export function validWidgetPositions(value: unknown): value is WidgetPositions {
  if (!value || typeof value !== 'object') return false;
  return (['weather', 'agents'] as const).every((id) => {
    const p = (value as WidgetPositions)[id];
    return (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= 1 &&
      p.y >= 0 &&
      p.y <= 1
    );
  });
}
export function widgetPixels(
  point: WidgetPoint,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
) {
  const margin = 12;
  return {
    left: Math.max(
      margin,
      Math.min(viewport.width - size.width - margin, point.x * viewport.width),
    ),
    top: Math.max(
      margin,
      Math.min(viewport.height - size.height - margin, point.y * viewport.height),
    ),
  };
}

/** Positions are relative to the viewport, independent of DPI and scene geometry. */
export class WidgetLayout {
  editing = false;
  private positions: WidgetPositions = structuredClone(DEFAULT_WIDGET_POSITIONS);
  private drag: {
    id: WidgetId;
    pointer: number;
    dx: number;
    dy: number;
    start: WidgetPoint;
  } | null = null;
  private observer: ResizeObserver;
  private elements: Record<WidgetId, HTMLElement>;
  constructor(private changed: (positions: WidgetPositions) => void) {
    this.elements = {
      weather: document.querySelector<HTMLElement>('[data-widget="weather"]')!,
      agents: document.querySelector<HTMLElement>('[data-widget="agents"]')!,
    };
    try {
      const saved = JSON.parse(localStorage.getItem('ascii-city.widgets') ?? 'null');
      if (validWidgetPositions(saved)) this.positions = saved;
    } catch {}
    this.observer = new ResizeObserver(() => this.layout());
    for (const id of ['weather', 'agents'] as const) {
      const el = this.elements[id],
        handle = el.querySelector<HTMLElement>('.widget-handle')!;
      this.observer.observe(el);
      handle.tabIndex = -1;
      handle.addEventListener('pointerdown', (event) => {
        if (!this.editing || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const box = el.getBoundingClientRect();
        this.drag = {
          id,
          pointer: event.pointerId,
          dx: event.clientX - box.left,
          dy: event.clientY - box.top,
          start: { ...this.positions[id] },
        };
        handle.setPointerCapture(event.pointerId);
        el.classList.add('dragging');
      });
      handle.addEventListener('pointermove', (event) => {
        if (!this.drag || this.drag.pointer !== event.pointerId || this.drag.id !== id) return;
        const size = el.getBoundingClientRect();
        const pixel = widgetPixels(
          {
            x: (event.clientX - this.drag.dx) / innerWidth,
            y: (event.clientY - this.drag.dy) / innerHeight,
          },
          { width: innerWidth, height: innerHeight },
          size,
        );
        this.positions[id] = { x: pixel.left / innerWidth, y: pixel.top / innerHeight };
        this.layout();
      });
      handle.addEventListener('pointerup', (event) => {
        if (!this.drag || this.drag.pointer !== event.pointerId) return;
        this.drag = null;
        el.classList.remove('dragging');
        handle.releasePointerCapture(event.pointerId);
        this.save();
      });
      handle.addEventListener('pointercancel', () => {
        if (this.drag?.id === id) {
          this.positions[id] = this.drag.start;
          this.drag = null;
          el.classList.remove('dragging');
          this.layout();
        }
      });
      handle.addEventListener('keydown', (event) => {
        if (
          !this.editing ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const amount = event.shiftKey ? 10 : 1,
          p = this.positions[id];
        p.x +=
          (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0) /
          innerWidth;
        p.y +=
          (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) /
          innerHeight;
        const rect = el.getBoundingClientRect(),
          pixel = widgetPixels(p, { width: innerWidth, height: innerHeight }, rect);
        this.positions[id] = { x: pixel.left / innerWidth, y: pixel.top / innerHeight };
        this.layout();
        this.save();
      });
    }
    addEventListener('resize', () => this.layout());
    this.layout();
  }
  get value(): WidgetPositions {
    return structuredClone(this.positions);
  }
  set(value: unknown): void {
    if (validWidgetPositions(value)) this.positions = structuredClone(value);
    this.layout();
  }
  edit(on: boolean): void {
    this.editing = on;
    document.body.classList.toggle('layout-edit', on);
    document.getElementById('layoutTools')!.hidden = !on;
    for (const el of Object.values(this.elements))
      el.querySelector<HTMLElement>('.widget-handle')!.tabIndex = on ? 0 : -1;
    this.layout();
  }
  reset(): void {
    this.positions = structuredClone(DEFAULT_WIDGET_POSITIONS);
    this.layout();
    this.save();
  }
  private save(): void {
    try {
      localStorage.setItem('ascii-city.widgets', JSON.stringify(this.positions));
    } catch {}
    this.changed(this.value);
  }
  private layout(): void {
    for (const id of ['weather', 'agents'] as const) {
      const el = this.elements[id],
        pixel = widgetPixels(
          this.positions[id],
          { width: innerWidth, height: innerHeight },
          el.getBoundingClientRect(),
        );
      el.style.left = `${pixel.left}px`;
      el.style.top = `${pixel.top}px`;
    }
  }
}
