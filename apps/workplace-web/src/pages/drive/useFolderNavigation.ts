import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * 드라이브 폴더 탐색 상태의 출처를 모드로 선택한다.
 * - 'url'  : 풀페이지. folderId 를 URL 쿼리로 보관(브라우저 뒤로가기 지원).
 * - 'state': 드로워. 내부 useState 로 보관해 상위 페이지 URL 을 오염시키지 않는다.
 * 두 하위 훅(useSearchParams/useState)은 항상 호출되며(규칙 준수), 반환값만 모드로 분기한다.
 */
export function useFolderNavigation(mode: 'url' | 'state'): {
  folderId: number | null
  openFolder: (id: number) => void
  goRoot: () => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const [stateFolderId, setStateFolderId] = useState<number | null>(null)

  if (mode === 'url') {
    const p = searchParams.get('folderId')
    return {
      folderId: p == null ? null : Number(p),
      openFolder: (id: number) => setSearchParams({ folderId: String(id) }),
      goRoot: () => setSearchParams({}),
    }
  }
  return {
    folderId: stateFolderId,
    openFolder: (id: number) => setStateFolderId(id),
    goRoot: () => setStateFolderId(null),
  }
}
