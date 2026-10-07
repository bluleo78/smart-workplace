import { useMemo, useState } from 'react'

import type { ViewerItem } from './types'
import { resolveBundle } from './viewerItems'

/**
 * 뷰어 호출부(드라이브·첨부 모아보기·이슈 첨부) 공통 묶음 상태(WP-277).
 * - 현재 키(URL ?preview)를 목록에서 찾고, 목록에서 빠지면(재조회·필터 변경·다른 곳에서 삭제) 마지막으로 본 원본(스냅숏) 1건으로 유지한다.
 *   왜: 열린 뷰어가 목록 재조회로 다른 파일로 바뀌거나 사라지고 낡은 ?preview 만 URL 에 남는 일을 막는다.
 * - 목록 조회가 끝났는데(ready — 실패 포함) 목록에도 스냅숏에도 없으면 missing — 호출부가 ViewerNotFound 로 안내한다.
 * - 넘김(onIndexChange)은 현재 묶음 범위 안에서만 URL 을 바꾼다.
 * 지금 열린 원본(T)은 current 로 내보내 호출부가 화면 컨텍스트(AI) 등에 재사용한다.
 *
 * @param toItem 원본 → ViewerItem. 렌더마다 새 함수면 목록 변환 memo 가 깨지므로 모듈 함수나 useCallback 으로 넘긴다.
 * @param openKey 묶음 키 → URL 반영(드라이브는 `drive:{id}` 를 숫자 id 로 바꿔 쓴다).
 */
export function useViewerBundle<T>({
  list,
  toItem,
  currentKey,
  ready,
  openKey,
}: {
  list: T[]
  toItem: (t: T) => ViewerItem
  currentKey: string | null
  ready: boolean
  openKey: (key: string) => void
}) {
  const [snapshot, setSnapshot] = useState<T | null>(null)
  const items = useMemo(() => list.map(toItem), [list, toItem])
  const listIndex = currentKey == null ? -1 : items.findIndex((i) => i.key === currentKey)
  // 목록에서 찾은 현재 원본을 스냅숏으로 기억한다(렌더 중 갱신 — 같은 원본이면 다시 set 하지 않아 수렴한다).
  // 클릭 외 경로(다른 인스턴스·딥링크·넘김)로 연 파일도 이후 목록에서 빠지면 그대로 유지된다.
  const hit = listIndex >= 0 ? list[listIndex] : null
  if (hit != null && hit !== snapshot) setSnapshot(hit)
  const snapItem = useMemo(() => (snapshot != null ? toItem(snapshot) : null), [snapshot, toItem])
  const bundle = resolveBundle(items, currentKey, snapItem)
  // 묶음 항목과 같은 순서의 원본 — 목록 묶음이면 목록, 스냅숏 묶음이면 [스냅숏].
  const sources: T[] = listIndex >= 0 ? list : bundle && snapshot != null ? [snapshot] : []

  /** 목록에서 클릭해 연다 — 목록이 placeholder 등으로 잠시 비어도 바로 보이도록 스냅숏을 먼저 둔다. */
  const open = (t: T) => {
    setSnapshot(t)
    openKey(toItem(t).key)
  }
  /** 뷰어 넘김 — 목록이 줄어 범위를 벗어난 요청은 무시한다. */
  const onIndexChange = (i: number) => {
    const t = sources[i]
    if (t === undefined) return
    setSnapshot(t)
    openKey(toItem(t).key)
  }
  return {
    bundle,
    /** 지금 열린 원본(목록 → 스냅숏 순으로 해석) — 호출부가 같은 조회를 반복하지 않고 화면 컨텍스트(AI) 등에 쓴다. */
    current: bundle ? (sources[bundle.index] ?? null) : null,
    missing: currentKey != null && bundle == null && ready,
    open,
    onIndexChange,
  }
}
