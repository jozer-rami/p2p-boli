import { describe, it, expect } from 'vitest';
import { SimulatedClock } from '../../src/simulator/clock.js';

describe('SimulatedClock', () => {
  it('starts at the given origin time', () => {
    const clock = new SimulatedClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it('advances by tickIntervalMs on each tick', () => {
    const clock = new SimulatedClock(0);
    clock.advance(30_000);
    expect(clock.now()).toBe(30_000);
    clock.advance(30_000);
    expect(clock.now()).toBe(60_000);
  });

  it('tracks tick count', () => {
    const clock = new SimulatedClock(0);
    expect(clock.tickCount).toBe(0);
    clock.advance(30_000);
    expect(clock.tickCount).toBe(1);
    clock.advance(30_000);
    expect(clock.tickCount).toBe(2);
  });

  it('formats elapsed time as HH:MM:SS', () => {
    const clock = new SimulatedClock(0);
    expect(clock.elapsed()).toBe('00:00:00');
    clock.advance(90_000); // 1m30s
    expect(clock.elapsed()).toBe('00:01:30');
    clock.advance(3510_000); // +58m30s = 60m total
    expect(clock.elapsed()).toBe('01:00:00');
  });
});
