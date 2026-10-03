import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { toSearch } from '@/lib/historyParam'

/**
 * 드라이브 폴더 탐색 상태의 출처.
 * - 'url'     : 풀페이지. folderId 를 URL 쿼리로 보관(브라우저 뒤로가기 지원).
 * - { key }   : 오버레이(채널 파일 드로워) 안. 지정 쿼리 키(기본 folderId 와 다른 키)로 보관하고 폴더 진입을 push 해
 *               시스템 뒤로가기 한 번에 상위 폴더로 간다. 이전 router state 를 spread 해 드로워 열림 마크(historyParam:files)를
 *               이어받는다 — 그래야 ✕ 가 하위 폴더가 몇 단이든 한 번에 연 시점 직전으로 닫는다(WP-207).
 */
export type FolderNavMode = 'url' | { key: string }

export function useFolderNavigation(mode: FolderNavMode): {
  folderId: number | null
  openFolder: (id: number) => void
  goRoot: () => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  if (mode === 'url') {
    const p = searchParams.get('folderId')
    return {
      folderId: p == null ? null : Number(p),
      openFolder: (id: number) => setSearchParams({ folderId: String(id) }),
      goRoot: () => setSearchParams({}),
    }
  }
  const raw = searchParams.get(mode.key)
  const current = raw == null ? null : Number(raw)
  const go = (id: number | null) => {
    if (id === current) return // 같은 폴더 재진입으로 항목이 쌓이지 않게
    const next = new URLSearchParams(location.search)
    if (id == null) next.delete(mode.key)
    else next.set(mode.key, String(id))
    // state spread — 드로워 열림 마크를 하위 항목이 이어받아 ✕ 가 한 번에 닫힌다.
    navigate({ pathname: location.pathname, search: toSearch(next), hash: location.hash }, { state: location.state })
  }
  return { folderId: current, openFolder: (id: number) => go(id), goRoot: () => go(null) }
}
