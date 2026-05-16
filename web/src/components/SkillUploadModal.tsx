import { useState, useRef } from 'react';
import { TerminalModal } from './TerminalModal';

interface UploadResult {
  ok: boolean;
  skill?: unknown;
  errors?: string[];
  conflict?: boolean;
}

interface SkillUploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

export function SkillUploadModal({ onClose, onUploaded }: SkillUploadModalProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File, overwrite = false) => {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (overwrite) formData.append('overwrite', 'true');

      const res = await fetch('/skills/upload', {
        method: 'POST',
        body: formData,
      });
      const result: UploadResult = await res.json();

      if (result.ok) {
        onClose();
        onUploaded();
      } else if (result.conflict) {
        const skillName = result.errors?.[0]?.match(/"(.+?)"/)?.[1] ?? 'unknown';
        if (confirm(`Skill "${skillName}" already exists. Overwrite?`)) {
          await handleUpload(file, true);
        }
      } else {
        setUploadError(result.errors?.join(', ') ?? 'Upload failed');
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  // Border tint: active when hovering OR during a DnD drag-over. Hover is
  // handled by Tailwind; drag-enter/drag-leave toggle state since CSS can't
  // key off DragEvent phases reliably.
  const dropZoneBorder = dragActive
    ? 'border-[rgba(59,247,191,0.4)]'
    : 'border-[var(--color-border-default)] hover:border-[rgba(59,247,191,0.4)] focus-visible:border-[rgba(59,247,191,0.4)]';

  return (
    <TerminalModal open title="Upload Skill" onClose={() => { onClose(); setUploadError(null); }} width={600}>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={() => setDragActive(true)}
        onDragLeave={() => setDragActive(false)}
        className={`border-2 border-dashed rounded-[4px] p-8 text-center cursor-pointer transition-[border-color] duration-fast ease-out ${dropZoneBorder}`}
      >
        <div className="text-[24px] text-[var(--color-text-secondary)] mb-3">&#x2191;</div>
        <p className="text-body-sm text-[var(--color-text-secondary)]">Drag &amp; drop a skill file, or click to browse</p>
        <p className="text-caption text-[var(--color-text-secondary)] mt-2">Accepts .md (single SKILL.md) or .skill/.zip (skill archive)</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.skill,.zip"
        onChange={onFileSelect}
        className="hidden"
      />

      {uploading && (
        <div className="mt-4 flex items-center gap-2">
          <div
            data-spinning
            className="w-2 h-2 rounded-full border-2 border-[var(--color-brand-default)] border-t-transparent"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
          <span className="text-body-sm text-[var(--color-text-secondary)]">Uploading…</span>
        </div>
      )}

      {uploadError && (
        <div className="mt-4 p-3 bg-[var(--color-error-subtle)] border border-[rgba(239,68,68,0.4)] rounded-[4px] text-[var(--color-error-text)] text-body-sm">
          {uploadError}
        </div>
      )}
    </TerminalModal>
  );
}
