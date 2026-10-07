import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import type { ViewerItem } from './types'

/**
 * ✨ 노출 판정 — 드라이브 파일·링크만.
 * - 'none': 요약 대상이 아님(업로드 첨부 등).
 * - 'hidden': AI 꺼짐, 또는 요약 API 가 실패(403/404 = 링크 열람자에게 드라이브 권한 없음 등).
 * - 'loading': 아직 응답 전 — ✨·패널을 띄우지 않는다. 먼저 띄웠다가 403 으로 사라지는 깜빡임을 막기 위함.
 * - 'show': 요약 쿼리가 성공적으로 응답한 뒤에만(진행 중 상태 행이어도 응답 자체는 성공).
 * 요약 쿼리는 패널 열림과 무관하게 돌려 403 을 미리 알아야 버튼을 숨길 수 있다(캐시 공유라 패널이 같은 쿼리를 재사용).
 */
export function useSummaryAvailability(item: ViewerItem): 'none' | 'hidden' | 'loading' | 'show' {
  const aiAvailable = useAiAvailable()
  const q = useDriveFileSummary(item.summaryDriveFileId ?? 0)
  if (item.summaryDriveFileId == null) return 'none'
  if (!aiAvailable) return 'hidden'
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status
  // 권한 없음은 이미 받은 데이터가 있어도 숨긴다.
  if (status === 403 || status === 404) return 'hidden'
  // 한 번이라도 성공 응답을 받았으면 유지 — 폴링 중 일시 오류(5xx)로 패널이 사라지지 않게.
  if (q.data != null) return 'show'
  return q.isError ? 'hidden' : 'loading'
}
