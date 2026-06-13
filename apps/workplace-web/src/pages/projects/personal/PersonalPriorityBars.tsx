// 우선순위 막대 아이콘(Linear식) — HIGH 만 강조색(빨강), MID/LOW 는 옅게. 높이로 단계 구분.
import { cn } from '@/lib/utils';
import type { IssuePriority } from '@/types/issue';

const FILLED: Record<IssuePriority, number> = { LOW: 1, MID: 2, HIGH: 3 };
const LABEL: Record<IssuePriority, string> = { LOW: '낮음', MID: '보통', HIGH: '높음' };

export function PersonalPriorityBars({ priority }: { priority: IssuePriority }) {
  const filled = FILLED[priority];
  return (
    <span className="flex shrink-0 items-end gap-[1.5px]" title={`우선순위: ${LABEL[priority]}`} aria-label={`우선순위 ${LABEL[priority]}`}>
      {[1, 2, 3].map((i) => (
        <span key={i}
          className={cn('w-[3px] rounded-[1px]',
            i === 1 && 'h-[4px]', i === 2 && 'h-[7px]', i === 3 && 'h-[10px]',
            i <= filled ? (priority === 'HIGH' ? 'bg-destructive' : 'bg-muted-foreground/50') : 'bg-muted-foreground/20')} />
      ))}
    </span>
  );
}
