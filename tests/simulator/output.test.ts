import { describe, it, expect } from 'vitest';
import { formatTable } from '../../src/simulator/output/table.js';
import { formatJson } from '../../src/simulator/output/json.js';
import type { SimulationResult } from '../../src/simulator/types.js';

const result: SimulationResult = {
  scenario: 'test',
  mode: 'unit',
  timeline: [
    { tick: 1, elapsed: '00:00:00', ask: 6.920, bid: 6.890, marketSpread: 0.030, buyPrice: 6.890, sellPrice: 6.920, botSpread: 0.030, events: ['priced(buy:6.890,sell:6.920)'], paused: false },
    { tick: 2, elapsed: '00:00:30', ask: 6.910, bid: 6.875, marketSpread: 0.035, buyPrice: 6.875, sellPrice: 6.910, botSpread: 0.035, events: ['repriced(buy:6.875,sell:6.910)'], paused: false },
  ],
  summary: {
    totalTicks: 2,
    simulatedDuration: '00:00:30',
    repriceCount: 1,
    pauseCount: 0,
    emergencyTriggered: false,
    emergencyAtTick: null,
    emergencyReason: null,
    maxSpread: 0.035,
    minSpread: 0.030,
  },
};

describe('formatTable', () => {
  it('outputs a table with headers and rows', () => {
    const output = formatTable(result);
    expect(output).toContain('Tick');
    expect(output).toContain('Time');
    expect(output).toContain('Ask');
    expect(output).toContain('Bid');
    expect(output).toContain('6.920');
    expect(output).toContain('6.890');
  });

  it('includes summary section', () => {
    const output = formatTable(result);
    expect(output).toContain('Summary');
    expect(output).toContain('Ticks: 2');
    expect(output).toContain('Reprices: 1');
    expect(output).toContain('Emergency: NO');
  });
});

describe('formatJson', () => {
  it('returns valid JSON', () => {
    const output = formatJson(result);
    const parsed = JSON.parse(output);
    expect(parsed.scenario).toBe('test');
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.summary.totalTicks).toBe(2);
  });
});
