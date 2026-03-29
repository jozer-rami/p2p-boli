import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface WsEvent {
  event: string;
  payload: any;
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotification(title: string, body: string, onClick?: () => void) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body });
    if (onClick) n.onclick = () => { window.focus(); onClick(); };
  }
}

function playPing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    requestNotificationPermission();

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg: WsEvent = JSON.parse(e.data);

          if (msg.event.startsWith('order:')) {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('price:')) {
            queryClient.invalidateQueries({ queryKey: ['prices'] });
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }
          if (msg.event.startsWith('ad:') || msg.event.startsWith('emergency:')) {
            queryClient.invalidateQueries({ queryKey: ['status'] });
          }

          if (msg.event === 'order:payment-claimed') {
            const p = msg.payload;
            playPing();
            sendBrowserNotification(
              'Payment Received',
              `${p.amount} USDT — check your bank and release`,
              () => { window.location.href = `/order/${p.orderId}`; },
            );
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, [queryClient]);

  return { connected };
}
