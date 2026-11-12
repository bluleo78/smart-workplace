import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import { useAuth } from '../../hooks/useAuth'
import type { DrivePlaybackTarget } from './types'

/**
 * 재생 주소를 다시 쓰는 시간(1시간) — 서버 수명(4시간)보다 짧게 둬, 뷰어를 닫았다 다시 열어도 남은 수명이 넉넉한 주소만 쓴다.
 * 그 안에 다시 열면 발급(=열람 감사)을 반복하지 않는다.
 */
const PLAYBACK_URL_STALE_MS = 60 * 60 * 1000

/**
 * 드라이브 영상·오디오 봉인 재생 주소(WP-1532). target 이 null 이면 발급하지 않는다(대상 아님·쓸 수 없는 항목).
 *
 * - 키에 사용자·워크스페이스·현재 버전을 넣는다 — 다른 사람·다른 워크스페이스로 바꿔 들어오거나 새 버전이 오르면(목록 재조회로 versionFileId 가 바뀜)
 *   캐시된 이전 주소(서버에서 404)를 쓰지 않는다.
 * - 키 뿌리를 드라이브 공용 접두어('drive')와 다르게 둔다 — 드라이브 목록 무효화에 휩쓸려 다시 받으면 주소가 바뀌어 플레이어가 처음부터 다시 연다.
 * - 창 포커스·재연결 재조회도 끈다(같은 이유). StrictMode·리마운트의 중복 요청은 쿼리가 하나로 묶어 감사가 두 번 쌓이지 않는다.
 * - 실패는 재시도하지 않고 바로 오류 화면([다시 시도])으로 — 404(권한·휴지통)를 몇 번씩 다시 부르지 않게.
 * - reissue: 재생 중 미디어 오류(주소 만료·새 버전 등)일 때 호출부가 한 번만 새 주소를 받는다.
 */
export function useDrivePlaybackUrl(target: DrivePlaybackTarget | null) {
  const { user, activeTenant } = useAuth()
  const q = useQuery({
    queryKey: ['drive-playback-url', user?.id ?? null, activeTenant?.tenantId ?? null, target?.driveFileId, target?.versionFileId],
    queryFn: () => driveApi.issuePlaybackUrl((target as DrivePlaybackTarget).driveFileId),
    enabled: target != null,
    staleTime: PLAYBACK_URL_STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  return {
    url: target != null ? (q.data?.url ?? null) : null,
    error: target != null && q.isError,
    retry: () => void q.refetch(),
    reissue: () => void q.refetch(),
  }
}
