// 「새 작업 안 받음」 표시(WP-1514) — 에이전트 상세 「실행」 묶음과 목록 「상태」 칸이 함께 쓴다.

import { StatusBadge } from '@/components/ui/status-badge';

/** 「새 작업 받기」를 끈 AI — 하던 일은 마치지만 새 이슈를 가져가지 않으니 옆 상태 알약과 같은 상태 톤(경고)으로 알린다. */
export function NewWorkPausedBadge({ 'data-testid': testId }: { 'data-testid'?: string }) {
  return (
    <StatusBadge type="warning" data-testid={testId}>
      새 작업 안 받음
    </StatusBadge>
  );
}
