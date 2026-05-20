import type { WizardGeneric, WizardRowTone } from '@/lib/wizard-card-types';

function toneClass(tone: WizardRowTone | undefined): string {
  switch (tone) {
    case 'risk':
      return 'text-[var(--color-error-text)]';
    case 'reward':
      return 'text-[var(--color-success-text)]';
    case 'muted':
      return 'text-text-tertiary';
    default:
      return 'text-text-primary';
  }
}

interface Props {
  data: WizardGeneric;
}

export function WizardCardGeneric({ data }: Props) {
  return (
    <>
      {data.groups.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-1.5">
          {g.label && (
            <div className="text-caption text-text-tertiary uppercase tracking-wide">
              {g.label}
            </div>
          )}
          {g.rows.map((r, ri) => (
            <div key={ri} className="flex justify-between text-body-sm">
              <span className="text-text-tertiary">{r.label}</span>
              <span className={toneClass(r.tone)}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
