// 우선순위 아이콘(Linear식 막대) — 팀·개인 리스트/보드·필터 옵션·행 메뉴 공통.
// 5단계(WP-886): 높음·보통·낮음은 막대 3개를 높이로 채우고(높음만 강조색), 매우 낮음은 막대를 모두 비우며,
// 매우 높음은 같은 자리(12×12, 막대와 같은 폭)에 빨간 「!」 사각형을 둬 긴급 건이 한눈에 띄되 행 높이·정렬이 흔들리지 않게 한다.
import { ISSUE_PRIORITY_LABEL } from '@/lib/issueGrouping';
import { cn } from '@/lib/utils';
import type { IssuePriority } from '@/types/issue';

// 채운 막대 수 — 매우 낮음은 0(모두 빈 막대), 매우 높음은 막대 대신 사각형이라 쓰지 않는다.
const FILLED: Record<Exclude<IssuePriority, 'HIGHEST'>, number> = { LOWEST: 0, LOW: 1, MID: 2, HIGH: 3 };

export function IssuePriorityBars({ priority }: { priority: IssuePriority }) {
  const label = ISSUE_PRIORITY_LABEL[priority];
  if (priority === 'HIGHEST') {
    return (
      <span
        role="img"
        className="flex size-[12px] shrink-0 items-center justify-center rounded-[3px] bg-destructive text-[9px] font-bold leading-none text-destructive-foreground"
        title={`우선순위: ${label}`}
        aria-label={`우선순위 ${label}`}
      >
        {/* 느낌표는 CSS 가상 요소로만 그린다 — 글자로 두면 필터·시트 옵션 텍스트가 「!매우 높음」 이 되고 복사에도 섞인다. 읽기는 바깥 aria-label 이 맡는다. */}
        <span aria-hidden="true" className="before:content-['!']" />
      </span>
    );
  }
  const filled = FILLED[priority];
  return (
    <span
      role="img"
      className="flex shrink-0 items-end gap-[1.5px]"
      title={`우선순위: ${label}`}
      aria-label={`우선순위 ${label}`}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-[1px]',
            i === 1 && 'h-[4px]',
            i === 2 && 'h-[7px]',
            i === 3 && 'h-[10px]',
            i <= filled
              ? priority === 'HIGH'
                ? 'bg-destructive'
                : 'bg-muted-foreground/50'
              : 'bg-muted-foreground/20',
          )}
        />
      ))}
    </span>
  );
}
