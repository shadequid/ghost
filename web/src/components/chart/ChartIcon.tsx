import chartIconUrl from "@/assets/chart-icon-v2.png";

interface ChartIconProps {
  size?: number;
}

export function ChartIcon({ size = 18 }: ChartIconProps) {
  return (
    <img
      src={chartIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
