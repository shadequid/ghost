import { useEffect, useRef } from 'react';
import type { SlashCommand } from './SlashMenu-commands';

export interface SlashMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: string) => void;
}

export function SlashMenu({ commands, selectedIndex, onSelect }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={
        'absolute bottom-full left-0 right-0 mb-1.5 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] ' +
        'rounded-[4px] overflow-y-auto max-h-60 z-10 ' +
        'shadow-[0_-4px_16px_rgba(0,0,0,0.3)]'
      }
    >
      {commands.map((c, i) => {
        const selected = i === selectedIndex;
        return (
          <div
            key={c.cmd}
            className={
              'flex items-center gap-3 px-3.5 py-2 cursor-pointer ' +
              'transition-colors duration-fast ease-out ' +
              (selected
                ? 'bg-[var(--color-brand-subtle)] text-white'
                : 'bg-transparent text-[var(--color-text-secondary)]')
            }
            onMouseDown={(e) => { e.preventDefault(); onSelect(c.cmd); }}
          >
            <span className="text-body-sm-medium text-[var(--color-brand-default)]">{c.cmd}</span>
            <span className="text-caption text-[var(--color-text-secondary)]">{c.desc}</span>
          </div>
        );
      })}
    </div>
  );
}
