// 이슈 상세(데스크톱 개인 작업·팀 이슈)의 「AI 에게 맡기기」 속성(WP-989, WP-1314) — 요약 버튼(「내 AI 비서 · ↻ 매주 월·수 08:30」/「안 함」)
// + 상태 줄(다음 실행·멈춤), 누르면 편집기 팝오버. 일정 조회는 이 칸이 있을 때만 한다.
// WP-1313: 일정이 있으면 상태 줄 옆에 「지금 실행」 — 다음 회차를 기다리지 않고 한 번 실행한다(결과는 채팅에 「테스트 실행」으로).
import { Bot } from 'lucide-react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { useIssueRecurrence } from '@/hooks/queries/useIssueRecurrence';
import { aiHandoffLabel } from '@/lib/issueRecurrence';

import { RecurrenceRunNowButton } from './RecurrenceRunNowButton';
import { TaskRecurrenceEditor, TaskRecurrenceStatus } from './TaskRecurrenceEditor';

export function TaskRecurrenceField({
  projectKey,
  number,
  disabled = false,
}: {
  projectKey: string;
  number: number;
  /** 이슈를 고칠 수 없는 사람(팀 이슈 읽기 전용)이면 잠근다. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = useIssueRecurrence(projectKey, number);
  const r = q.data ?? null;
  const text = aiHandoffLabel(r);
  // 조회 실패 — 「반복 안 함」으로 보이면 없는 줄 알고 새로 만들어 덮어쓸 수 있다. 실패를 알리고 다시 시도만 둔다(편집 막음).
  if (q.isError) {
    return (
      <div className="flex items-center gap-2 text-sm" role="alert" data-testid="task-recurrence-error-state">
        <span className="text-destructive">실행 일정을 불러오지 못했어요</span>
        <Button variant="outline" size="xs" disabled={q.isFetching} onClick={() => void q.refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`AI 에게 맡기기: ${text}`}
            data-testid="task-recurrence-trigger"
            // 조회 전에는 폼 초기값을 모르니 잠근다(실패하면 다시 열어 새로 만들 수 있게 풀어 둔다).
            disabled={q.isLoading || disabled}
            className={r ? undefined : 'text-muted-foreground'}
          >
            <Bot className="h-4 w-4" aria-hidden />
            {text}
          </Button>
        </PopoverTrigger>
        {/* 「몇 시간마다」(WP-1373)를 고르면 간격·시간대·요일이 펼쳐져 키가 커진다 — 화면 높이를 넘으면 위가 잘려
            담당 AI·칩 줄이 안 보였다. Radix 가 주는 남은 높이 안에서 스크롤한다. */}
        <PopoverContent
          align="start"
          className="max-h-(--radix-popover-content-available-height) w-80 overflow-y-auto"
          data-testid="task-recurrence-popover"
        >
          {/* 열 때마다 지금 값으로 폼을 새로 시작한다(PopoverContent 는 닫히면 언마운트). */}
          <TaskRecurrenceEditor projectKey={projectKey} number={number} recurrence={r} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {r ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TaskRecurrenceStatus recurrence={r} />
          <RecurrenceRunNowButton projectKey={projectKey} number={number} recurrence={r} locked={disabled} />
        </div>
      ) : null}
    </div>
  );
}
