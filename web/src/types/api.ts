// Types used by pages that talk to the WS gateway.
// These mirror what the backend method handlers return.

export interface StatusResponse {
  version?: string;
  provider: string | null;
  model: string | null;
  uptime_seconds: number;
  memory_backend: string;
  paired: boolean;
  channels: Record<string, boolean>;
  clients: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CronJob {
  id: string;
  name: string | null;
  command: string;
  schedule: string;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  enabled: boolean;
}

export interface SessionEntry {
  key: string;
  messageCount: number;
  updatedAt?: string;
}

export interface SessionPreviewItem {
  role: string;
  text: string;
}

export interface SessionPreview {
  key: string;
  status: string;
  items: SessionPreviewItem[];
}
