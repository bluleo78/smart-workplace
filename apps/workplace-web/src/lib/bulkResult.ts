// 이슈 일괄 작업 결과 토스트 문구(WP-412) — useBulkIssueActions 의 reportBulkResult 판단을 순수 함수로 뺐다.
// 실패가 있으면 rejection 사유에서 백엔드 에러 메시지를 추출해 함께 보여준다(#710) —
// 그렇지 않으면 "N건 실패"만 뜨고 정확히 왜 막혔는지(예: EPIC 미완료 자식) 사용자가 알 수 없다.
import { extractApiError } from './api-error';

/** 토스트 종류 + 문구. 전부 성공=success, 전부 실패=error, 부분 실패=warning. */
export interface BulkResultToast {
  level: 'success' | 'error' | 'warning';
  message: string;
}

/** allSettled 결과로 결과 토스트를 정한다. successLabel 은 "상태를 변경했습니다" 같은 완료 문구. */
export function bulkResultToast(results: PromiseSettledResult<unknown>[], successLabel: string): BulkResultToast {
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  const failed = rejected.length;
  const succeeded = results.length - failed;
  if (failed === 0) return { level: 'success', message: `${succeeded}개 ${successLabel}` };
  // 실패 사유 중 첫 번째를 대표 메시지로 노출. 여러 건이 서로 다른 이유로 실패해도
  // 사용자가 "왜 막혔는지" 최소 하나의 구체적 원인을 바로 알 수 있게 한다.
  const firstReason = extractApiError(rejected[0].reason, `${successLabel} 실패`);
  if (succeeded === 0) return { level: 'error', message: `${successLabel} 실패 (${failed}건): ${firstReason}` };
  return { level: 'warning', message: `${succeeded}개 ${successLabel}, ${failed}건 실패: ${firstReason}` };
}
