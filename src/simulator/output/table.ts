// src/simulator/output/table.ts

import type { SimulationResult } from '../types.js';

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function padStart(str: string, len: number): string {
  return str.padStart(len);
}

export function formatTable(result: SimulationResult): string {
  const lines: string[] = [];

  lines.push(`\nScenario: ${result.scenario} (${result.mode} mode)\n`);

  const headers = ['Tick', 'Time', 'Ask', 'Bid', 'Spread', 'Buy Price', 'Sell Price', 'Events'];
  const widths = [6, 10, 8, 8, 8, 11, 11, 40];

  const headerRow = headers.map((h, i) => pad(h, widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  lines.push(headerRow);
  lines.push(separator);

  for (const entry of result.timeline) {
    const row = [
      padStart(String(entry.tick), widths[0]),
      pad(entry.elapsed, widths[1]),
      padStart(entry.ask > 0 ? entry.ask.toFixed(3) : '--', widths[2]),
      padStart(entry.bid > 0 ? entry.bid.toFixed(3) : '--', widths[3]),
      padStart(entry.botSpread !== null ? entry.botSpread.toFixed(3) : '--', widths[4]),
      padStart(entry.buyPrice !== null ? entry.buyPrice.toFixed(3) : '--', widths[5]),
      padStart(entry.sellPrice !== null ? entry.sellPrice.toFixed(3) : '--', widths[6]),
      pad(entry.events.join(', ').slice(0, widths[7]), widths[7]),
    ];
    lines.push(row.join(' | '));
  }

  lines.push('');
  lines.push('Summary:');
  lines.push(`  Ticks: ${result.summary.totalTicks} | Duration: ${result.summary.simulatedDuration} (simulated)`);
  lines.push(`  Reprices: ${result.summary.repriceCount} | Pauses: ${result.summary.pauseCount} | Emergency: ${result.summary.emergencyTriggered ? `YES (tick ${result.summary.emergencyAtTick})` : 'NO'}`);
  lines.push(`  Max spread: ${result.summary.maxSpread.toFixed(3)} | Min spread: ${result.summary.minSpread.toFixed(3)}`);

  if (result.summary.emergencyTriggered) {
    lines.push(`  Exit: EMERGENCY at tick ${result.summary.emergencyAtTick}`);
  }

  lines.push('');

  return lines.join('\n');
}
