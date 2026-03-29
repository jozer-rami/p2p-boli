import type { WebSocket } from 'ws';
import type { EventBus, EventMap } from '../event-bus.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('api-ws');

const FORWARDED_EVENTS: (keyof EventMap)[] = [
  'order:new',
  'order:payment-claimed',
  'order:released',
  'order:cancelled',
  'price:updated',
  'ad:created',
  'ad:repriced',
  'emergency:triggered',
  'emergency:resolved',
];

export class WebSocketBroadcaster {
  private clients: Set<WebSocket> = new Set();

  constructor(bus: EventBus) {
    for (const event of FORWARDED_EVENTS) {
      bus.on(event, (payload) => {
        this.broadcast(event, payload);
      });
    }
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    log.info({ clients: this.clients.size }, 'WS client connected');

    if (typeof ws.on === 'function') {
      ws.on('close', () => {
        this.clients.delete(ws);
        log.info({ clients: this.clients.size }, 'WS client disconnected');
      });
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: string, payload: unknown): void {
    const message = JSON.stringify({ event, payload });
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      } else {
        this.clients.delete(client);
      }
    }
  }
}
