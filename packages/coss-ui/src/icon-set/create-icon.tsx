import type { LucideIcon } from "lucide-react";

export interface IconProps {
  size?: number;
  className?: string;
  onClick?: () => void;
}

export function createIcon(Icon: LucideIcon, testId: string) {
  return function WrappedIcon({ size = 16, className, onClick }: IconProps) {
    return <Icon size={size} className={className} onClick={onClick} data-testid={testId} />;
  };
}
