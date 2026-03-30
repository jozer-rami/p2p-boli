// src/simulator/clock.ts

export class SimulatedClock {
  private currentMs: number;
  private readonly originMs: number;
  private _tickCount = 0;

  constructor(originMs: number = Date.now()) {
    this.originMs = originMs;
    this.currentMs = originMs;
  }

  now(): number {
    return this.currentMs;
  }

  get tickCount(): number {
    return this._tickCount;
  }

  advance(ms: number): void {
    this.currentMs += ms;
    this._tickCount++;
  }

  elapsed(): string {
    const totalSeconds = Math.floor((this.currentMs - this.originMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  }
}
