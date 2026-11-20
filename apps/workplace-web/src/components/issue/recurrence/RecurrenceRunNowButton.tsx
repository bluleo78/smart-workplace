// 「지금 실행」 버튼(WP-1313) — 실행 일정이 있는 이슈에서 다음 회차를 기다리지 않고 한 번 실행한다. 다음 실행 시각·실패 횟수는 그대로이고,
// 결과는 이 작업의 채팅에 「테스트 실행」 표시로 남는다. 되돌릴 수 없는 쓰기(메일 보내기 등)는 실행 전에 채팅에서 묻는다.
// 데스크톱 「AI 에게 맡기기」 칸(TaskRecurrenceField)과 모바일 편집 시트가 함께 쓴다. 남의 개인 비서 일정·읽기 전용 이슈·실행 중이면 잠그고
// 이유를 툴팁으로 보인다(판정은 lib/issueRecurrence 의 runNowState). WP-1809: 실행 중에는 ▷ 대신 도는 Loader2 로 진행 중임을 보인다.
import { Loader2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { useRunIssueRecurrenceNow } from '@/hooks/queries/useIssueRecurrence';
import { runNowState } from '@/lib/issueRecurrence';
import type { IssueRecurrence } from '@/types/issueRecurrence';

export function RecurrenceRunNowButton({
  projectKey,
  number,
  recurrence,
  locked = false,
  className,
}: {
  projectKey: string;
  number: number;
  /** 지금 실행 일정 — 없으면 그리지 않는다. */
  recurrence: IssueRecurrence | null | undefined;
  /** 이슈를 고칠 수 없는 사람(팀 이슈 읽기 전용)이면 잠근다. */
  locked?: boolean;
  /** 바깥 줄에서의 자리(예: ml-auto) — 늘 이유 툴팁 감싸개에 단다(WP-1852). */
  className?: string;
}) {
  const run = useRunIssueRecurrenceNow(projectKey, number);
  const state = runNowState(recurrence, locked, run.isPending);
  if (!state.visible) return null;
  // WP-1809: 실행 중이면 ▷ 대신 도는 표시 — 아이콘 하나만 바꿔 그린다(크기는 xs 변형이 정한다).
  const Icon = state.running ? Loader2 : Play;
  const button = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={state.disabled}
      onClick={() => run.mutate()}
      data-testid="task-recurrence-run-now"
    >
      <Icon
        className={state.running ? 'animate-spin motion-reduce:animate-none' : undefined}
        aria-hidden
        data-testid="task-recurrence-run-now-icon"
        data-state={state.running ? 'running' : 'idle'}
      />
      {state.running ? '실행 중…' : '지금 실행'}
    </Button>
  );
  // 막힌 버튼은 포인터를 받지 않아 툴팁을 못 띄우므로 이유 툴팁 감싸개로 — 키보드 포커스에도 이유가 보인다.
  // WP-1852: 감싸개를 늘 두고(이유가 없으면 이름·툴팁 없는 빈 껍데기) 자리(className)도 늘 감싸개에 단다 —
  //   실행 중으로 바뀔 때 버튼이 다시 만들어져 키보드 초점이 body 로 떨어지던 문제를 막는다.
  return (
    <DisabledReasonTooltip
      reason={state.reason}
      className={className}
      data-testid="task-recurrence-run-now-reason"
    >
      {button}
    </DisabledReasonTooltip>
  );
}
