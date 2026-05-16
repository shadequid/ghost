import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Save,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';

export default function Memory() {
  const { request, connected } = useGateway();
  const [memory, setMemory] = useState('');
  const [history, setHistory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchMemory = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    request<{ memory: string; history: string }>('memory.get')
      .then((res) => {
        setMemory(res.memory);
        setHistory(res.history);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load memory'),
      )
      .finally(() => setLoading(false));
  }, [connected, request]);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

  // Auto-dismiss success after 4 seconds
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await request('memory.write', { content: memory });
      setSuccess('Memory saved successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save memory');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear all long-term memory?')) return;
    try {
      await request('memory.clear');
      setMemory('');
      setSuccess('Memory cleared.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to clear memory');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-400" />
          <h2 className="text-body-sm-medium text-white">Memory</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchMemory}
            className="flex items-center gap-2 text-gray-300 hover:text-white border border-gray-700 text-caption px-3 py-2 rounded-[4px] hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 border border-red-700/50 text-caption px-3 py-2 rounded-[4px] hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-caption px-4 py-2 rounded-[4px] transition-colors disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Success / Error */}
      {success && (
        <div className="rounded-[4px] bg-green-900/30 border border-green-700 p-3 text-caption text-green-300">
          {success}
        </div>
      )}
      {error && (
        <div className="rounded-[4px] bg-red-900/30 border border-red-700 p-3 text-caption text-red-300">
          {error}
        </div>
      )}

      {/* Long-Term Memory Editor */}
      <div className="bg-gray-900 rounded-[2px] border border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-800/50">
          <span className="text-footnote text-gray-400 uppercase tracking-wider">
            Long-Term Memory
          </span>
          <span className="text-footnote text-gray-500">
            {memory.split('\n').length} lines
          </span>
        </div>
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[300px] bg-gray-950 text-gray-200 text-caption p-4 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset [tab-size:4]"
          placeholder="No long-term memory stored yet…"
        />
      </div>

      {/* History (read-only) */}
      {history && (
        <div className="bg-gray-900 rounded-[2px] border border-gray-800 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-800/50">
            <span className="text-footnote text-gray-400 uppercase tracking-wider">
              History (read-only)
            </span>
          </div>
          <pre className="text-footnote text-gray-300 p-4 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {history}
          </pre>
        </div>
      )}
    </div>
  );
}
