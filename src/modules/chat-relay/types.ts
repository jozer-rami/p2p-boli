export interface MonitoredChat {
  orderId: string;
  side: 'buy' | 'sell';
  counterpartyName: string;
  lastSeenMessageTime: number;
}

export interface ChatMessage {
  content: string;
  contentType: string;   // '1' = text, '2' = image
  sendTime: number;
  fromUserId: string;
}
