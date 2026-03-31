// dashboard/src/hooks/useActivityLog.ts
import { useEffect, useRef, useState } from 'react';

export interface LogEntry {
  id: number;
  time: string;       // HH:MM:SS
  label: string;
  severity: 'problem' | 'change' | 'info';
  detail: string;
  timestamp: number;
}

const SEVERITY_MAP: Record<string, 'problem' | 'change' | 'info'> = {
  'ad:paused': 'problem',
  'price:stale': 'problem',
  'ad:spread-inversion': 'problem',
  'ad:repriced': 'change',
  'reprice:cycle': 'change',
  'price:spread-alert': 'change',
  'price:low-depth': 'change',
  'ad:resumed': 'info',
  'ad:created': 'info',
  'order:released': 'info',
};

const LABEL_MAP: Record<string, string> = {
  'ad:repriced': 'REPRICE',
  'ad:paused': 'PAUSE',
  'ad:resumed': 'RESUME',
  'ad:created': 'AD NEW',
  'ad:spread-inversion': 'INVERSION',
  'reprice:cycle': 'CYCLE',
  'order:released': 'RELEASE',
  'price:stale': 'STALE',
  'price:spread-alert': 'SPREAD',
  'price:low-depth': 'DEPTH',
};

function formatDetail(event: string, payload: any): string {
  switch (event) {
    case 'ad:repriced':
      return `${payload.side} ${payload.oldPrice?.toFixed(3)} → ${payload.newPrice?.toFixed(3)}`;
    case 'ad:paused':
      return `${payload.side} — ${payload.reason}`;
    case 'ad:resumed':
      return payload.side;
    case 'ad:created':
      return `${payload.side} @ ${payload.price?.toFixed(3)}`;
    case 'ad:spread-inversion':
      return `buy ${payload.buyPrice?.toFixed(3)} / sell ${payload.sellPrice?.toFixed(3)}`;
    case 'reprice:cycle':
      return `${payload.action} — spread ${payload.spread?.toFixed(3)} — ${payload.reason || 'ok'}`;
    case 'order:released':
      return `${payload.side} ${payload.amount} USDT`;
    case 'price:stale':
      return `data stale for ${payload.staleDurationSeconds}s`;
    case 'price:spread-alert':
      return `${payload.platform} spread ${payload.spread?.toFixed(3)}`;
    case 'price:low-depth':
      return `${payload.totalAsk}/${payload.totalBid} USDT (min ${payload.minRequired})`;
    default:
      return JSON.stringify(payload);
  }
}

const MAX_ENTRIES = 100;

export function useActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    function handleOpsEvent(e: Event) {
      const { detail } = e as CustomEvent;
      const { event, payload } = detail;

      // Filter out reprice:cycle hold events
      if (event === 'reprice:cycle' && payload.action === 'hold') return;

      const label = LABEL_MAP[event];
      if (!label) return;

      const now = Date.now();
      const d = new Date(now);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

      const entry: LogEntry = {
        id: nextId.current++,
        time,
        label,
        severity: SEVERITY_MAP[event] ?? 'info',
        detail: formatDetail(event, payload),
        timestamp: now,
      };

      setLastEventAt(now);
      setEntries((prev) => {
        const next = [entry, ...prev];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });
    }

    window.addEventListener('ops:event', handleOpsEvent);
    return () => window.removeEventListener('ops:event', handleOpsEvent);
  }, []);

  return { entries, lastEventAt };
}
