// 종료로 바꾼 직후 숨겨지는 이슈 안내 토스트(WP-606) — 단건(드래그·행 메뉴)과 일괄 상태 변경이 같이 쓴다.
// 이슈 응답에는 사이클이 없어, 바꾼 이슈의 사이클을 조회해 숨겨지는지 판단한다(조회 실패한 이슈는 판단에서 뺀다).
import { toast } from 'sonner';

import { listIssueCycles } from '../../api/cycles';
import {
  CLOSED_HIDDEN_NOTE,
  CLOSED_ISSUE_STATUSES,
  type ClosedHidingNotice,
  hiddenAfterClose,
} from '../../lib/closedHiding';

type ToastLevel = 'success' | 'warning' | 'error';

/**
 * 상태 변경 결과 토스트 — 숨김 안내가 필요하면 안내 문구와 「모두 보기」를 붙인다.
 * 사이클 조회를 기다리는 동안 상태 변경의 재조회를 막지 않도록 호출부는 결과를 기다리지 않는다.
 */
export async function toastStatusChange(
  projectKey: string,
  numbers: number[],
  status: string,
  notice: ClosedHidingNotice | undefined,
  level: ToastLevel,
  message: string,
): Promise<void> {
  if (notice && CLOSED_ISSUE_STATUSES.has(status) && numbers.length > 0) {
    const cycles = await Promise.all(numbers.map((n) => listIssueCycles(projectKey, n).catch(() => null)));
    if (cycles.some((c) => c != null && hiddenAfterClose(c, notice.visibleCycleStatuses))) {
      toast[level](`${message} — ${CLOSED_HIDDEN_NOTE}`, {
        action: { label: '모두 보기', onClick: notice.onShowAll },
      });
      return;
    }
  }
  toast[level](message);
}
