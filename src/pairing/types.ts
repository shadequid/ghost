export interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

export interface PairingStoreShape {
  version: 1;
  requests: PairingRequest[];
}

export interface AllowFromStoreShape {
  version: 1;
  allowFrom: string[];
}
