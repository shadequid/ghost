import { memo } from 'react';
import type { ActionCardData, ActionCardStatus } from '@/lib/action-card-types';
import { ActionCardSingleStep } from './ActionCard.SingleStep';

interface ActionCardProps {
  data: ActionCardData;
  status: ActionCardStatus;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
}

export const ActionCard = memo(function ActionCard(props: ActionCardProps) {
  return (
    <ActionCardSingleStep
      data={props.data}
      status={props.status}
      onApprove={props.onApprove}
      onReject={props.onReject}
    />
  );
});
