import { useState, useEffect } from 'react';
import {
  Cpu,
  Clock,
  Globe,
  Database,
  Activity,
  Radio,
} from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';

interface StatusData {
  version?: string;
  provider: string | null;
  model: string | null;
  uptime_seconds: number;
  memory_backend: string;
  paired: boolean;
  channels: Record<string, boolean>;
  clients: number;
  showToolCalls?: boolean;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function healthColor(active: boolean): string {
  return active ? 'bg-green-500' : 'bg-gray-500';
}

export default function Dashboard() {
  const { request, connected } = useGateway();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;

    request<StatusData>('status')
      .then(setStatus)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load status'),
      );
  }, [connected, request]);

  if (!connected && !status) {
    return (
      <div className="p-6">
        <div className="rounded-[4px] bg-yellow-900/30 border border-yellow-700 p-4 text-yellow-300">
          Connecting to Ghost gateway…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-[4px] bg-red-900/30 border border-red-700 p-4 text-red-300">
          Failed to load dashboard: {error}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Status Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-600/20 rounded-[4px]">
              <Cpu className="h-5 w-5 text-blue-400" />
            </div>
            <span className="text-caption text-gray-400">Provider / Model</span>
          </div>
          <p className="text-body-lg-semibold text-white truncate">
            {status.provider ?? 'Unknown'}
          </p>
          <p className="text-caption text-gray-400 truncate">{status.model ?? 'Not set'}</p>
        </div>

        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-600/20 rounded-[4px]">
              <Clock className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-caption text-gray-400">Uptime</span>
          </div>
          <p className="text-body-lg-semibold text-white">
            {formatUptime(status.uptime_seconds)}
          </p>
          <p className="text-caption text-gray-400">Since last restart</p>
        </div>

        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-600/20 rounded-[4px]">
              <Globe className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-caption text-gray-400">Connected Clients</span>
          </div>
          <p className="text-body-lg-semibold text-white">
            {status.clients}
          </p>
          <p className="text-caption text-gray-400">
            Version: {status.version ?? 'unknown'}
          </p>
        </div>

        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-orange-600/20 rounded-[4px]">
              <Database className="h-5 w-5 text-orange-400" />
            </div>
            <span className="text-caption text-gray-400">Memory Backend</span>
          </div>
          <p className="text-body-lg-semibold text-white capitalize">
            {status.memory_backend}
          </p>
          <p className="text-caption text-gray-400">
            Paired: {status.paired ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Channels */}
        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-5 w-5 text-blue-400" />
            <h2 className="text-body-sm-medium text-white">Active Channels</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(status.channels).length === 0 ? (
              <p className="text-caption text-gray-500">No channels configured</p>
            ) : (
              Object.entries(status.channels).map(([name, active]) => (
                <div
                  key={name}
                  className="flex items-center justify-between py-2 px-3 rounded-[4px] bg-gray-800/50"
                >
                  <span className="text-caption text-white capitalize">{name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${healthColor(active)}`}
                    />
                    <span className="text-footnote text-gray-400">
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Connection Status */}
        <div className="bg-gray-900 rounded-[2px] p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-blue-400" />
            <h2 className="text-body-sm-medium text-white">Connection</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 px-3 rounded-[4px] bg-gray-800/50">
              <span className="text-caption text-gray-400">WebSocket</span>
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-footnote text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-[4px] bg-gray-800/50">
              <span className="text-caption text-gray-400">Protocol</span>
              <span className="text-footnote text-gray-300">WS req/res</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
