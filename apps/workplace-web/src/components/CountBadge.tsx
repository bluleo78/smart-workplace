import { cn } from '@/lib/utils';

/**
 * 알림/미읽음 개수 배지 (공용).
 * 무엇을: 1자리는 원형(h=min-w), 2~3자리는 자연스러운 알약으로 확장, 99 초과는 "99+" 로 캡.
 * 색: destructive 토큰(빨강) + destructive-foreground(흰 숫자). 0 이하면 렌더하지 않는다.
 * 왜: 인박스·채팅 등 여러 곳의 카운트 배지를 한 컴포넌트로 통일(색/대비/숫자범위 일관).
 */
export function CountBadge({
  count,
  className,
  'data-testid': testId,
}: {
  count: number;
  className?: string;
  'data-testid'?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-none text-destructive-foreground',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
