// 전역 QueryClient 재시도 정책(WP-412) — main.tsx 의 인라인 retry 를 순수 함수로 뺐다(main 은 렌더 부수효과라 테스트에서 import 불가).
import { isAxiosError } from 'axios'

/**
 * 쿼리 재시도 여부 — 4xx 클라이언트 오류(404·403·422 등)는 재시도해도 결과가 같으므로 즉시 실패시켜
 * 오류 표시 지연(기본 backoff ~1초)을 없앤다. 5xx·네트워크 오류만 1회 재시도.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined
  if (status !== undefined && status < 500) return false
  return failureCount < 1
}
