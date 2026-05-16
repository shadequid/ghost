import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  X,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';

interface CronJob {
  id: string;
  name: string | null;
  command: string;
  schedule: string;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  enabled: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function Cron() {
  const { request, connected } = useGateway();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    request<{ jobs: CronJob[] }>('cron.list')
      .then((res) => setJobs(res.jobs))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load cron jobs'),
      )
      .finally(() => setLoading(false));
  }, [connected, request]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleAdd = async () => {
    if (!formSchedule.trim() || !formCommand.trim()) {
      setFormError('Schedule and command are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await request<{ job: CronJob }>('cron.add', {
        name: formName.trim() || undefined,
        schedule: formSchedule.trim(),
        command: formCommand.trim(),
      });
      setJobs((prev) => [...prev, res.job]);
      setShowForm(false);
      setFormName('');
      setFormSchedule('');
      setFormCommand('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to add job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await request('cron.remove', { jobId: id });
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      setConfirmDelete(null);
    }
  };

  const statusIcon = (status: string | null) => {
    if (!status) return null;
    switch (status.toLowerCase()) {
      case 'ok':
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'error':
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-400" />;
    }
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="rounded-[4px] bg-red-900/30 border border-red-700 p-4 text-red-300">
          {error}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-400" />
          <h2 className="text-body-sm-medium text-white">
            Scheduled Tasks ({jobs.length})
          </h2>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-caption px-4 py-2 rounded-[4px] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Job
        </button>
      </div>

      {/* Add Job Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-[2px] p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body-lg-semibold text-white">Add Cron Job</h3>
              <button
                onClick={() => {
                  setShowForm(false);
                  setFormError(null);
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-[4px] bg-red-900/30 border border-red-700 p-3 text-caption text-red-300">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-caption text-gray-300 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Daily cleanup"
                  className="w-full bg-gray-800 border border-gray-700 rounded-[4px] px-3 py-2 text-caption text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-caption text-gray-300 mb-1">
                  Schedule <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formSchedule}
                  onChange={(e) => setFormSchedule(e.target.value)}
                  placeholder="e.g. 0 0 * * * (cron expression)"
                  className="w-full bg-gray-800 border border-gray-700 rounded-[4px] px-3 py-2 text-caption text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-caption text-gray-300 mb-1">
                  Command <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="e.g. cleanup --older-than 7d"
                  className="w-full bg-gray-800 border border-gray-700 rounded-[4px] px-3 py-2 text-caption text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowForm(false);
                  setFormError(null);
                }}
                className="px-4 py-2 text-caption text-gray-300 hover:text-white border border-gray-700 rounded-[4px] hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={submitting}
                className="px-4 py-2 text-caption text-white bg-blue-600 hover:bg-blue-700 rounded-[4px] transition-colors disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Table */}
      {jobs.length === 0 ? (
        <div className="bg-gray-900 rounded-[2px] border border-gray-800 p-8 text-center">
          <Clock className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No scheduled tasks configured.</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-[2px] border border-gray-800 overflow-x-auto">
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  ID
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Command
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Schedule
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Next Run
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Last Status
                </th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">
                  Enabled
                </th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-3 text-gray-400 text-footnote">
                    {job.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-white font-medium">
                    {job.name ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-footnote max-w-[200px] truncate">
                    {job.command}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-footnote">
                    {job.schedule}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-footnote">
                    {formatDate(job.next_run)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {statusIcon(job.last_status)}
                      <span className="text-gray-300 text-footnote capitalize">
                        {job.last_status ?? '-'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-footnote ${
                        job.enabled
                          ? 'bg-green-900/40 text-green-400 border border-green-700/50'
                          : 'bg-gray-800 text-gray-500 border border-gray-700'
                      }`}
                    >
                      {job.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === job.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-footnote text-red-400">Delete?</span>
                        <button
                          onClick={() => handleDelete(job.id)}
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
                        onClick={() => setConfirmDelete(job.id)}
                        className="text-gray-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
