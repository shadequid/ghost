import { useState, useEffect } from 'react';
import { useGateway } from '@/hooks/useGateway';

interface ToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export default function Tools() {
  const { request, connected } = useGateway();
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [search, setSearch] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;

    request<{ tools: ToolSpec[] }>('tools.list')
      .then((res) => setTools(res.tools))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load tools'),
      )
      .finally(() => setLoading(false));
  }, [connected, request]);

  const filtered = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()),
  );

  if (error) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[var(--color-surface-canvas)] h-full overflow-y-auto box-border">
        <div className="p-4 bg-[rgba(255,85,85,0.06)] border border-[rgba(255,85,85,0.3)] rounded-[4px] text-[#ff5555] text-body-sm">
          Failed to load tools: {error}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[#00ff88] text-body-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 bg-[var(--color-surface-canvas)] h-full overflow-y-auto box-border">
      {/* Search */}
      <div className="relative max-w-[400px] flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-body-sm text-[#3a4a5a] pointer-events-none">&#x2315;</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools…"
          className="w-full bg-surface-canvas border border-[var(--color-border-default)] focus:border-[rgba(0,255,136,0.4)] rounded-[4px] pl-8 pr-3.5 py-2.5 text-body-sm text-[var(--color-text-primary)] outline-none transition-colors duration-fast ease-out box-border"
        />
      </div>

      {/* Tools Grid */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-label-lg text-[#00ff88]">&#x2692;</span>
          <span className="text-body-sm-medium text-[var(--color-text-primary)]">
            Agent Tools ({filtered.length})
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-body-sm text-[#3a4a5a]">No tools match your search.</p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
            {filtered.map((tool) => {
              const isExpanded = expandedTool === tool.name;
              return (
                <div
                  key={tool.name}
                  className="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] overflow-hidden"
                >
                  {/* Clickable header */}
                  <button
                    type="button"
                    className="block p-4 cursor-pointer bg-transparent border-0 w-full text-left hover:bg-white/[0.02] focus-visible:bg-white/[0.02] transition-colors duration-fast ease-out"
                    onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                    aria-expanded={isExpanded}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-body-sm text-[#00ff88] flex-shrink-0 mt-0.5">&#x25C8;</span>
                        <span className="text-body-lg-semibold text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                          {tool.name}
                        </span>
                      </span>
                      <span className="text-label-lg text-[#3a4a5a] flex-shrink-0 mt-0.5 transition-colors duration-fast ease-out">
                        {isExpanded ? '\u25BE' : '\u25B8'}
                      </span>
                    </span>
                    <span
                      className={
                        isExpanded
                          ? 'block text-body-sm text-[var(--color-text-secondary)] mt-2.5'
                          : 'block text-body-sm text-[var(--color-text-secondary)] mt-2.5 overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]'
                      }
                    >
                      {tool.description}
                    </span>
                  </button>

                  {/* Expanded parameter schema */}
                  {isExpanded && tool.parameters != null && (
                    <div className="border-t border-[var(--color-border-default)] p-4">
                      <p className="text-caption text-[#3a4a5a] tracking-[0.5px] uppercase mb-2">
                        Parameter Schema
                      </p>
                      <pre className="text-caption text-[var(--color-text-primary)] bg-surface-canvas rounded-[4px] p-3 overflow-x-auto max-h-64 overflow-y-auto m-0 border border-[var(--color-border-default)]">
                        {JSON.stringify(tool.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
