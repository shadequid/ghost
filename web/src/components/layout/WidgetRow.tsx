import { type ReactNode } from 'react';
import { EmptyState } from '@/components/ui';

export interface WidgetDef {
  id: string;
  icon: string;
  iconColor: string;
  label: string;
  component?: () => ReactNode;
  emptyIcon?: () => ReactNode;
  emptyText?: string;
}

interface WidgetRowProps {
  widget: WidgetDef;
}

export function WidgetRow({ widget: w }: WidgetRowProps) {
  const EmptyIcon = w.emptyIcon;
  if (w.component) return <w.component />;
  return <EmptyState icon={EmptyIcon ? <EmptyIcon /> : undefined} text={w.emptyText ?? ''} />;
}
