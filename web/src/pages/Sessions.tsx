import { useState, useEffect, useCallback } from 'react';
import {
  MessagesSquare,
  Eye,
  Trash2,
  X,
  RefreshCw,
} from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';

interface SessionEntry {
  key: string;
  messageCount: number;
  updatedAt?: string;
}

interface PreviewItem {
  role: string;
  text: string;
}

interface SessionPreview {
  key: string;
  status: string;
  items: PreviewItem[];
}

export default function Sessions() {
  const { request, connected } = useGateway();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [preview, setPreview] = useState<SessionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchSessions = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    request<{ sessions: SessionEntry[]; total: number }>('sessions.list', { limit: 100 })
      .then((res) => {
        setSessions(res.sessions);
        setTotal(res.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load sessions'),
      )
      .finally(() => setLoading(false));
  }, [connected, request]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handlePreview = async (key: string) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await request<{ previews: SessionPreview[] }>('sessions.preview', {
        keys: [key],
      });
      if (res.previews.length > 0) {
        setPreview(res.previews[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await request('sessions.delete', { sessionId: key });
      setSessions((prev) => prev.filter((s) => s.key !== key));
      setTotal((prev) => prev - 1);
      if (preview?.key === key) setPreview(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setConfirmDelete(null);
    }
  };

  if (error && sessions.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-[4px] bg-red-900/30 border border-red-700 p-4 text-red-300">
          Failed to load sessions: {error}
        </div>
      </div>
    );
  }

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
          <MessagesSquare className="h-5 w-5 text-blue-400" />
          <h2 className="text-body-sm-medium text-white">
            Sessions ({total})
          </h2>
        </div>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-2 text-gray-300 hover:text-white border border-gray-700 text-caption px-3 py-2 rounded-[4px] hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-[4px] bg-red-900/30 border border-red-700 p-3 text-caption text-red-300">
          {error}
        </div>
      )}

      {/* Preview Modal */}
      {(preview || previewLoading) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-[2px] p-6 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body-lg-semibold text-white">
                Session Preview
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : preview ? (
              <div className="space-y-3">
                <div className="text-caption text-gray-400">
                  Key: <span className="text-gray-200">{preview.key}</span>
                </div>
                <div className="text-caption text-gray-400">
                  Status: <span className="text-gray-200">{preview.status}</span>
                </div>
                {preview.items.length === 0 ? (
                  <p className="text-caption text-gray-500">No messages in this session.</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {preview.items.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-[4px] p-3 ${
                          item.role === 'user'
                            ? 'bg-blue-900/30 border border-blue-800'
                            : 'bg-gray-800 border border-gray-700'
                        }`}
                      >
                        <span className="text-footnote text-gray-400 uppercase">
                          {item.role}
                        </span>
                        <p className="text-caption text-gray-200 mt-1 whitespace-pre-wrap break-words">
                          {item.text || '(empty)'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Sessions Table */}
      {sessions.length === 0 ? (
        <div className="bg-gray-900 rounded-[2px] border border-gray-800 p-8 text-center">
          <MessagesSquare className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No sessions found.</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-[2px] border border-gray-800 overflow-x-auto">
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Session Key
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Messages
                </th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.key}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-3 text-white text-footnote">
                    {session.key}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {session.messageCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handlePreview(session.key)}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {confirmDelete === session.key ? (
                        <div className="flex items-center gap-2">
                          <span className="text-footnote text-red-400">Delete?</span>
                          <button
                            onClick={() => handleDelete(session.key)}
                            className="text-red-400 hover:text-red-300 text-footnote"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-gray-400 hover:text-white text-footnote"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(session.key)}
                          className="text-gray-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
