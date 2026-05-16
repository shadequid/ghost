/** Bus message types. */

export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  timestamp: number;
  media: string[];
  metadata: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media: string[];
  metadata: Record<string, unknown>;
}
