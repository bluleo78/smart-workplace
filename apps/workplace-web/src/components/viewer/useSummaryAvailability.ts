import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import type { ViewerItem } from './types'

/**
 * ✨ 노출 판정 — 드라이브 파일·링크만, AI 꺼짐·요약 API 403/404(링크 열람자에게 드라이브 권한 없음)이면 숨긴다.
 * 요약 쿼리는 패널 열림과 무관하게 돌려 403 을 미리 알아야 버튼을 숨길 수 있다(캐시 공유라 패널이 같은 쿼리를 재사용).
 */
export function useSummaryAvailability(item: ViewerItem): 'none' | 'hidden' | 'show' {
  const aiAvailable = useAiAvailable()
  const q = useDriveFileSummary(item.summaryDriveFileId ?? 0)
  if (item.summaryDriveFileId == null) return 'none'
  if (!aiAvailable) return 'hidden'
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status
  return status === 403 || status === 404 ? 'hidden' : 'show'
}
