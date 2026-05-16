import { type ReactNode } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import type { ChartDataResponse } from "@/lib/chartTypes";
import { LevelChartMini } from "./LevelChartMini";

interface LevelPopoverProps {
  data: ChartDataResponse;
  price: number;
  side?: "support" | "resistance";
  children: ReactNode;
}

export function LevelPopover({
  data,
  price,
  side,
  children,
}: LevelPopoverProps) {
  return (
    <HoverCard.Root openDelay={300} closeDelay={100}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="center"
          sideOffset={6}
          className="z-[9998] overflow-hidden rounded-[2px] border border-[rgba(121,121,121,0.15)] bg-[var(--color-surface-canvas)] shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        >
          <LevelChartMini data={data} price={price} side={side} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
