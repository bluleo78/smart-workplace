// 「지금 실행」 버튼(WP-1313) — 실행 일정이 있는 이슈에서 다음 회차를 기다리지 않고 한 번 실행한다. 다음 실행 시각·실패 횟수는 그대로이고,
// 결과는 이 작업의 채팅에 「테스트 실행」 표시로 남는다. 되돌릴 수 없는 쓰기(메일 보내기 등)는 실행 전에 채팅에서 묻는다.
// 데스크톱 「AI 에게 맡기기」 칸(TaskRecurrenceField)과 모바일 편집 시트가 함께 쓴다. 남의 개인 비서 일정·읽기 전용 이슈·실행 중이면 잠그고
// 이유를 툴팁으로 보인다(판정은 lib/issueRecurrence 의 runNowState).
import { Play } from 'lucide-react';

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
}: {
  projectKey: string;
  number: number;
  /** 지금 실행 일정 — 없으면 그리지 않는다. */
  recurrence: IssueRecurrence | null | undefined;
  /** 이슈를 고칠 수 없는 사람(팀 이슈 읽기 전용)이면 잠근다. */
  locked?: boolean;
}) {
  const run = useRunIssueRecurrenceNow(projectKey, number);
  const state = runNowState(recurrence, locked, run.isPending);
  if (!state.visible) return null;
  const button = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={state.disabled}
      onClick={() => run.mutate()}
      data-testid="task-recurrence-run-now"
    >
      <Play className="h-3.5 w-3.5" aria-hidden />
      {state.running ? '실행 중…' : '지금 실행'}
    </Button>
  );
  // 막힌 버튼은 포인터를 받지 않아 툴팁을 못 띄우므로 이유 툴팁 감싸개로 — 키보드 포커스에도 이유가 보인다.
  return state.reason ? (
    <DisabledReasonTooltip reason={state.reason} aria-label={state.reason} data-testid="task-recurrence-run-now-reason">
      {button}
    </DisabledReasonTooltip>
  ) : (
    button
  );
}
