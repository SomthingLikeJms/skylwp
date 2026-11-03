import { expect, test } from 'vitest';
import { DEFAULT_WIDGET_POSITIONS, validWidgetPositions, widgetPixels } from '../src/ui/widgets';

test('widget positions stay relative to the screen and are clamped after a resize', () => {
  const pos = { x: 0.5, y: 0.2 },
    size = { width: 284, height: 180 };
  expect(widgetPixels(pos, { width: 1920, height: 1080 }, size)).toEqual({ left: 960, top: 216 });
  expect(widgetPixels(pos, { width: 2560, height: 1440 }, size)).toEqual({ left: 1280, top: 288 });
  expect(widgetPixels({ x: 0.95, y: 0.95 }, { width: 390, height: 800 }, size)).toEqual({
    left: 94,
    top: 608,
  });
});
test('weather and Agent positions are independent and malformed saved positions are rejected', () => {
  const next = structuredClone(DEFAULT_WIDGET_POSITIONS);
  next.weather = { x: 0.5, y: 0.1 };
  expect(next.agents).toEqual(DEFAULT_WIDGET_POSITIONS.agents);
  expect(validWidgetPositions(next)).toBe(true);
  expect(validWidgetPositions({ ...next, agents: { x: Infinity, y: 0 } })).toBe(false);
  expect(validWidgetPositions({ ...next, weather: { x: -0.1, y: 0 } })).toBe(false);
  expect(validWidgetPositions({ weather: { x: 0, y: 0 } })).toBe(false);
});
