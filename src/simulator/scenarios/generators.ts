// src/simulator/scenarios/generators.ts

import type { ScenarioTick } from '../types.js';

interface PricePoint {
  ask: number;
  bid: number;
}

interface LinearParams {
  from: PricePoint;
  to: PricePoint;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

interface OscillateParams {
  center: PricePoint;
  amplitude: number;
  period: number;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

interface SpreadSqueezeParams {
  start: PricePoint;
  endSpread: number;
  ticks: number;
  totalAsk?: number;
  totalBid?: number;
}

function interpolate(from: number, to: number, i: number, total: number): number {
  return from + (to - from) * (i / (total - 1));
}

export function linearDrop(params: LinearParams): ScenarioTick[] {
  const { from, to, ticks, totalAsk = 500, totalBid = 500 } = params;
  return Array.from({ length: ticks }, (_, i) => ({
    ask: interpolate(from.ask, to.ask, i, ticks),
    bid: interpolate(from.bid, to.bid, i, ticks),
    totalAsk,
    totalBid,
  }));
}

export function linearRecover(params: LinearParams): ScenarioTick[] {
  return linearDrop(params);
}

export function oscillate(params: OscillateParams): ScenarioTick[] {
  const { center, amplitude, period, ticks, totalAsk = 500, totalBid = 500 } = params;
  return Array.from({ length: ticks }, (_, i) => {
    const offset = amplitude * Math.sin((2 * Math.PI * i) / period);
    return {
      ask: center.ask + offset,
      bid: center.bid + offset,
      totalAsk,
      totalBid,
    };
  });
}

export function spreadSqueeze(params: SpreadSqueezeParams): ScenarioTick[] {
  const { start, endSpread, ticks, totalAsk = 500, totalBid = 500 } = params;
  const startSpread = start.ask - start.bid;
  const mid = (start.ask + start.bid) / 2;

  return Array.from({ length: ticks }, (_, i) => {
    const currentSpread = interpolate(startSpread, endSpread, i, ticks);
    return {
      ask: mid + currentSpread / 2,
      bid: mid - currentSpread / 2,
      totalAsk,
      totalBid,
    };
  });
}

export function stale(ticks: number): ScenarioTick[] {
  return Array.from({ length: ticks }, () => ({
    ask: 0,
    bid: 0,
    totalAsk: 0,
    totalBid: 0,
  }));
}
