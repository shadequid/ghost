import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { SkillUploadModal } from '@/components/SkillUploadModal';
import { SkillCard, type SkillInfo } from './skills/SkillCard';

export default function Skills() {
  const { request, connected } = useGateway();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const loadSkills = useCallback(() => {
    if (!connected) return;
    request<{ skills: SkillInfo[] }>('skills.list')
      .then((res) => { setSkills(res.skills); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load skills'))
      .finally(() => setLoading(false));
  }, [connected, request]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleToggle = async (name: string, enabled: boolean) => {
    // Optimistic update
    setSkills((prev) => prev.map((sk) => sk.name === name ? { ...sk, enabled } : sk));
    try {
      await request('skills.toggle', { name, enabled });
    } catch {
      // Revert on failure
      setSkills((prev) => prev.map((sk) => sk.name === name ? { ...sk, enabled: !enabled } : sk));
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const result = await request<{ ok: boolean; error?: string }>('skills.delete', { name });
      if (result.ok) {
        setSkills((prev) => prev.filter((sk) => sk.name !== name));
      } else {
        setError(result.error ?? 'Failed to delete skill');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    }
    setDeleteConfirm(null);
  };

  const filtered = skills.filter(
    (sk) =>
      sk.name.toLowerCase().includes(search.toLowerCase()) ||
      sk.description.toLowerCase().includes(search.toLowerCase()),
  );

  if (error && skills.length === 0) {
    return (
      <div className="p-6 flex flex-col gap-6 bg-[var(--color-surface-canvas)] h-full overflow-y-auto box-border">
        <div className="p-4 bg-[rgba(255,85,85,0.06)] border border-[rgba(255,85,85,0.3)] rounded-[4px] text-[#ff5555] text-body-sm">
          Failed to load skills: {error}
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
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-[400px] flex-1">
          <label htmlFor="skills-search-input" className="sr-only">Search skills</label>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-body-sm text-[var(--color-text-secondary)] pointer-events-none">&#x2315;</span>
          <input
            id="skills-search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
            spellCheck={false}
            className="w-full bg-surface-canvas border border-[var(--color-border-default)] focus:border-[rgba(0,255,136,0.4)] rounded-[4px] pl-8 pr-3.5 py-2.5 text-body-sm text-[var(--color-text-primary)] outline-none transition-colors duration-fast ease-out box-border"
          />
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-[rgba(0,255,136,0.1)] hover:bg-[rgba(0,255,136,0.18)] focus-visible:bg-[rgba(0,255,136,0.18)] border border-[rgba(0,255,136,0.3)] hover:border-[rgba(0,255,136,0.5)] focus-visible:border-[rgba(0,255,136,0.5)] rounded-[4px] px-5 py-2.5 text-[#00ff88] text-body-sm-medium cursor-pointer transition-colors duration-fast ease-out"
        >
          {'+'} Upload Skill
        </button>
      </div>

      {/* Skills Grid */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-label-lg text-[#00ff88]">&#x29C8;</span>
          <span className="text-body-sm-medium text-[var(--color-text-primary)]">
            Skills ({filtered.length})
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-body-sm text-[var(--color-text-secondary)]">No skills match your search.</p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                isExpanded={expandedSkill === skill.name}
                onToggleExpanded={() =>
                  setExpandedSkill(expandedSkill === skill.name ? null : skill.name)
                }
                onToggleEnabled={(enabled) => handleToggle(skill.name, enabled)}
                deleteConfirm={deleteConfirm === skill.name}
                onRequestDelete={() => setDeleteConfirm(skill.name)}
                onCancelDelete={() => setDeleteConfirm(null)}
                onConfirmDelete={() => handleDelete(skill.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <SkillUploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={loadSkills}
        />
      )}
    </div>
  );
}
