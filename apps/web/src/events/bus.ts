import { parseEvent, type CityEvent } from './protocol';

/** Stable timestamps: equal-time events keep their original arrival order. */
export class EventBus {
  private listeners = new Set<(event: CityEvent) => void>();
  subscribe(listener: (event: CityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(value: unknown): CityEvent {
    const event = parseEvent(value);
    for (const listener of this.listeners) listener(event);
    return event;
  }
}
