export interface SkillInfo {
  name: string;
  description: string;
  source: 'builtin' | 'workspace';
  enabled: boolean;
  emoji?: string;
  always?: boolean;
  available: boolean;
  missing?: string[];
}

interface SkillCardProps {
  skill: SkillInfo;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  deleteConfirm: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/**
 * Single row in the Skills grid — header (emoji/name/source badge/chevron),
 * description, optional expanded metadata, and footer (enable toggle +
 * delete for workspace skills).
 */
export function SkillCard({
  skill,
  isExpanded,
  onToggleExpanded,
  onToggleEnabled,
  deleteConfirm,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: SkillCardProps) {
  return (
    <div className="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        className="block p-4 cursor-pointer bg-transparent border-0 w-full text-left hover:bg-white/[0.02] focus-visible:bg-white/[0.02] transition-colors duration-fast ease-out"
        onClick={onToggleExpanded}
        aria-expanded={isExpanded}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {skill.emoji ? (
              <span className="text-label-lg flex-shrink-0">{skill.emoji}</span>
            ) : (
              <span className="text-body-sm text-[#00ff88] flex-shrink-0 mt-0.5">&#x25C8;</span>
            )}
            <span className="text-body-lg-semibold text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
              {skill.name}
            </span>
          </span>
          <span className="flex items-center gap-2 flex-shrink-0">
            <span
              className={
                skill.source === 'builtin'
                  ? 'text-caption px-1.5 py-0.5 rounded bg-[rgba(127,143,158,0.15)] text-[var(--color-text-secondary)] flex-shrink-0'
                  : 'text-caption px-1.5 py-0.5 rounded bg-[rgba(0,255,136,0.1)] text-[#00ff88] flex-shrink-0'
              }
            >
              {skill.source === 'builtin' ? 'builtin' : 'user'}
            </span>
            <span className="text-label-lg text-[var(--color-text-secondary)] flex-shrink-0 mt-0.5 transition-colors duration-fast ease-out">
              {isExpanded ? '\u25BE' : '\u25B8'}
            </span>
          </span>
        </span>
        <span
          className={
            isExpanded
              ? 'block text-body-sm text-[var(--color-text-secondary)] mt-2.5'
              : 'block text-body-sm text-[var(--color-text-secondary)] mt-2.5 overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]'
          }
        >
          {skill.description}
        </span>
      </button>

      {/* Expanded metadata */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border-default)] p-4">
          <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)] leading-[1.8]">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">source</span>
            <span className={skill.source === 'builtin' ? 'text-[var(--color-text-primary)]' : 'text-[#00ff88]'}>
              {skill.source}
            </span>
          </div>
          <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)] leading-[1.8]">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">available</span>
            <span className={skill.available ? 'text-[#00ff88]' : 'text-[#febc2e]'}>
              {skill.available ? 'yes' : 'no'}
            </span>
          </div>
          {skill.always !== undefined && (
            <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)] leading-[1.8]">
              <span className="text-[var(--color-text-secondary)] min-w-[80px]">always-on</span>
              <span className={skill.always ? 'text-[#00ff88]' : 'text-[var(--color-text-primary)]'}>
                {skill.always ? 'yes' : 'no'}
              </span>
            </div>
          )}
          {!skill.available && skill.missing && skill.missing.length > 0 && (
            <div className="flex items-center gap-2 text-caption text-[var(--color-text-secondary)] leading-[1.8]">
              <span className="text-[var(--color-text-secondary)] min-w-[80px]">missing</span>
              <span className="text-[#febc2e]">{skill.missing.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Footer: toggle + delete */}
      <div className="border-t border-[var(--color-border-default)] px-4 py-2.5 flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={skill.enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
              aria-label={`${skill.enabled ? 'Disable' : 'Enable'} skill ${skill.name}`}
              className="absolute opacity-0 w-0 h-0"
            />
            <div
              className={
                skill.enabled
                  ? 'w-9 h-5 rounded-full relative transition-colors duration-fast ease-out bg-[rgba(0,255,136,0.3)]'
                  : 'w-9 h-5 rounded-full relative transition-colors duration-fast ease-out bg-border'
              }
            />
            <div
              className={
                skill.enabled
                  ? 'absolute top-0.5 w-4 h-4 rounded-full bg-[#00ff88] transition-[left] duration-fast ease-out left-[18px]'
                  : 'absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-secondary)] transition-[left] duration-fast ease-out left-0.5'
              }
            />
          </div>
          <span className="text-caption text-[var(--color-text-secondary)]">
            {skill.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>

        {skill.source === 'workspace' && (
          <>
            {deleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-caption text-[#ff5555]">Delete?</span>
                <button
                  onClick={onConfirmDelete}
                  className="bg-transparent border-0 text-[#ff5555] hover:text-[#ff8888] focus-visible:text-[#ff8888] text-caption cursor-pointer px-1 py-0.5 transition-colors duration-fast ease-out"
                >
                  Yes
                </button>
                <button
                  onClick={onCancelDelete}
                  className="bg-transparent border-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)] text-caption cursor-pointer px-1 py-0.5 transition-colors duration-fast ease-out"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={onRequestDelete}
                aria-label={`Delete skill ${skill.name}`}
                title={`Delete skill ${skill.name}`}
                className="bg-transparent border-0 text-[var(--color-text-secondary)] hover:text-[#ff5555] focus-visible:text-[#ff5555] text-label-lg cursor-pointer px-1 py-0.5 transition-colors duration-fast ease-out"
              >
                &#x2715;
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
