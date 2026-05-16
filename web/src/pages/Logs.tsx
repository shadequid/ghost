import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Pause,
  Play,
  ArrowDown,
  Filter,
} from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';
import type { EventFrame } from '@/lib/gateway';

function formatTimestamp(): string {
  return new Date().toLocaleTimeString();
}

function eventTypeBadgeColor(type: string): string {
  switch (type.toLowerCase()) {
    case 'chat.error':
      return 'bg-red-900/50 text-red-400 border-red-700/50';
    case 'chat.tool_call':
    case 'chat.tool_result':
      return 'bg-purple-900/50 text-purple-400 border-purple-700/50';
    case 'chat.delta':
    case 'chat.done':
      return 'bg-blue-900/50 text-blue-400 border-blue-700/50';
    case 'client.connected':
    case 'client.disconnected':
      return 'bg-green-900/50 text-green-400 border-green-700/50';
    case 'cron.executed':
      return 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50';
    default:
      return 'bg-gray-800 text-gray-400 border-gray-700';
  }
}

interface LogEntry {
  id: string;
  event: string;
  payload: unknown;
  seq: number;
  time: string;
}

export default function Logs() {
  const { connected, subscribe } = useGateway();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const entryIdRef = useRef(0);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const unsubscribe = subscribe((evt: EventFrame) => {
      if (pausedRef.current) return;
      entryIdRef.current += 1;
      const entry: LogEntry = {
        id: `log-${entryIdRef.current}`,
        event: evt.event,
        payload: evt.payload,
        seq: evt.seq,
        time: formatTimestamp(),
      };
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });

    return unsubscribe;
  }, [subscribe]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const jumpToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    setAutoScroll(true);
  };

  const allTypes = Array.from(new Set(entries.map((e) => e.event))).sort();

  const toggleTypeFilter = (type: string) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const filteredEntries =
    typeFilters.size === 0
      ? entries
      : entries.filter((e) => typeFilters.has(e.event));

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-blue-400" />
          <h2 className="text-body-sm-medium text-white">Live Events</h2>
          <div className="flex items-center gap-2 ml-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-footnote text-gray-500">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <span className="text-footnote text-gray-500 ml-2">
            {filteredEntries.length} events
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused(!paused)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-caption transition-colors ${
              paused
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white'
            }`}
          >
            {paused ? (
              <>
                <Play className="h-3.5 w-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause
              </>
            )}
          </button>

          {!autoScroll && (
            <button
              onClick={jumpToBottom}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-caption bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Jump to bottom
            </button>
          )}
        </div>
      </div>

      {/* Event type filters */}
      {allTypes.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-800 bg-gray-900/80 overflow-x-auto">
          <Filter className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <span className="text-footnote text-gray-500 flex-shrink-0">Filter:</span>
          {allTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-1.5 cursor-pointer flex-shrink-0"
            >
              <input
                type="checkbox"
                checked={typeFilters.has(type)}
                onChange={() => toggleTypeFilter(type)}
                className="rounded bg-gray-800 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 h-3.5 w-3.5"
              />
              <span className="text-footnote text-gray-400">{type}</span>
            </label>
          ))}
          {typeFilters.size > 0 && (
            <button
              onClick={() => setTypeFilters(new Set())}
              className="text-footnote text-blue-400 hover:text-blue-300 flex-shrink-0 ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Log entries */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Activity className="h-10 w-10 text-gray-600 mb-3" />
            <p className="text-caption">
              {paused
                ? 'Event streaming is paused.'
                : 'Waiting for events…'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const detail = entry.payload
              ? JSON.stringify(entry.payload)
              : '(no payload)';

            return (
              <div
                key={entry.id}
                className="bg-gray-900 border border-gray-800 rounded-[4px] p-3 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-footnote text-gray-500 whitespace-nowrap mt-0.5">
                    {entry.time}
                  </span>
                  <span className="text-footnote text-gray-600 mt-0.5">
                    #{entry.seq}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-footnote border flex-shrink-0 ${eventTypeBadgeColor(
                      entry.event,
                    )}`}
                  >
                    {entry.event}
                  </span>
                  <p className="text-caption text-gray-300 break-all min-w-0">
                    {typeof detail === 'string' ? detail : JSON.stringify(detail)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
