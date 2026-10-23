import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { LoadErrorState } from '@/components/LoadErrorState'

import { useDriveSpaces } from '../../hooks/queries/useDriveSpaces'

/**
 * /drive 진입 시 개인 공간(없으면 첫 공간)으로 리다이렉트.
 * 공간 목록은 사이드바와 같은 쿼리(캐시 공유)로 읽는다. 첫 조회가 실패하면 빈 본문 대신
 * 「공간 목록을 불러오지 못했습니다」+다시 시도를 보인다 — 공간 없는 새 사용자 화면과 구분(WP-865).
 */
export function DriveIndexRedirect() {
  const navigate = useNavigate()
  const spacesQuery = useDriveSpaces({ refetchOnMount: 'always' })
  // 캐시가 있어도 이 진입에서 새로 받은 목록으로만 고른다 — 그 사이 지워졌거나 나간 공간으로 보내지 않게(예전엔 매번 새로 조회).
  // 그래서 캐시가 신선해도 마운트마다 다시 받는다(refetchOnMount: 'always') — 안 받으면 isFetchedAfterMount 가 영영 false 다.
  const spaces = spacesQuery.isFetchedAfterMount ? spacesQuery.data : undefined
  // 진입당 한 번만 보낸다 — 이 화면에서 팀 공간을 만들면 사이드바가 목록을 다시 받는데, 그때 다시 개인 공간으로
  // 보내면 새 공간으로 가는 이동과 겨룬다(예전처럼 마운트 때 한 번만).
  const redirected = useRef(false)
  useEffect(() => {
    if (redirected.current) return
    const personal = spaces?.find((s) => s.type === 'PERSONAL') ?? spaces?.[0]
    if (!personal) return
    redirected.current = true
    navigate(`/drive/spaces/${personal.id}`, { replace: true })
  }, [spaces, navigate])
  if (spacesQuery.isLoadingError) {
    return (
      <LoadErrorState
        title="드라이브를 불러오지 못했습니다"
        queries={[spacesQuery]}
        className="flex-1"
        testId="drive-index-error"
      />
    )
  }
  return null
}
