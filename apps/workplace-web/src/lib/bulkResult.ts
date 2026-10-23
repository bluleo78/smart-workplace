// 이슈 일괄 작업 결과 토스트 문구(WP-412) — useBulkIssueActions 의 reportBulkResult 판단을 순수 함수로 뺐다.
// 실패가 있으면 rejection 사유에서 백엔드 에러 메시지를 추출해 함께 보여준다(#710) —
// 그렇지 않으면 "N건 실패"만 뜨고 정확히 왜 막혔는지(예: EPIC 미완료 자식) 사용자가 알 수 없다.
import { extractApiError } from './api-error';

/** 토스트 종류 + 문구. 전부 성공=success, 전부 실패=error, 부분 실패=warning. */
export interface BulkResultToast {
  level: 'success' | 'error' | 'warning';
  message: string;
}

/** 일괄 작업 문구 쌍 — done 은 「삭제했습니다」 같은 완료 문구, fail 은 「삭제하지 못했습니다」 같은 실패 문구(WP-608). */
export interface BulkLabels {
  done: string;
  fail: string;
}

/**
 * allSettled 결과로 결과 토스트를 정한다.
 * 실패 문구를 따로 받는 이유(WP-608): 완료 문구에 「실패」를 덧붙이면 「삭제했습니다 실패 (2건)」처럼
 * 성공·실패가 한 문장에 섞여, 하나도 처리되지 않았는데 처리된 것처럼 읽혔다.
 */
export function bulkResultToast(
  results: PromiseSettledResult<unknown>[],
  labels: BulkLabels,
  /** 결과와 같은 순서의 이슈 키 — 부분 실패 때 어느 이슈가 실패했는지 문구에 싣는다(WP-851). */
  keys?: string[],
): BulkResultToast {
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  const failed = rejected.length;
  const succeeded = results.length - failed;
  if (failed === 0) return { level: 'success', message: `${succeeded}개 ${labels.done}` };
  // 실패 사유 중 첫 번째를 대표 메시지로 노출. 여러 건이 서로 다른 이유로 실패해도
  // 사용자가 "왜 막혔는지" 최소 하나의 구체적 원인을 바로 알 수 있게 한다. 사유를 못 꺼내면 붙이지 않는다.
  const reason = extractApiError(rejected[0].reason, '');
  const why = reason ? `: ${reason}` : '';
  if (succeeded === 0) {
    const scope = failed === 1 ? '' : `${failed}건 모두 `;
    return { level: 'error', message: `${scope}${labels.fail}${why}` };
  }
  const which = keys ? `(${failedKeysLabel(failedOf(keys, results))})` : '';
  return { level: 'warning', message: `${succeeded}개 ${labels.done}. ${failed}건${which}은 ${labels.fail}${why}` };
}

/** allSettled 결과에서 실패한 항목만 고른다 — 결과는 입력과 같은 순서다(WP-851: 실패한 이슈만 선택에 남긴다). */
export function failedOf<T>(items: T[], results: PromiseSettledResult<unknown>[]): T[] {
  return items.filter((_, i) => results[i]?.status === 'rejected');
}

// 실패 키는 5개까지 보이고 나머지는 「외 N건」 — 수십 건이 실패해도 토스트가 한 화면을 넘지 않게 한다.
const MAX_FAILED_KEYS = 5;
function failedKeysLabel(keys: string[]): string {
  const shown = keys.slice(0, MAX_FAILED_KEYS).join(', ');
  return keys.length > MAX_FAILED_KEYS ? `${shown} 외 ${keys.length - MAX_FAILED_KEYS}건` : shown;
}
