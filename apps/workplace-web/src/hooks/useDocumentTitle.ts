// 브라우저 탭 제목(document.title) — 주소 기본값 + 항목을 연 화면의 덮어쓰기(WP-814).
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { formatDocumentTitle, routeTitleParts, type TitlePart } from '@/lib/documentTitle'

// 항목 화면이 등록한 제목들(등록 순). 마지막 것이 이긴다 — 상세가 목록 위에 겹쳐 열려도 상세 제목이 보인다.
const overrides: { id: number; title: string }[] = []
// 주소만으로 정한 기본 제목 — 등록한 덮어쓰기가 없을 때 쓴다.
let routeTitle = formatDocumentTitle([])
let nextId = 0

function apply() {
  document.title = overrides.at(-1)?.title ?? routeTitle
}

/**
 * 주소가 바뀔 때마다 기본 탭 제목(화면 이름)을 맞춘다 — 라우터 안에 한 번만 둔다(App).
 * 항목 화면의 덮어쓰기는 부모·자식 효과 순서와 상관없이 이 값보다 앞선다(별도 목록이라).
 */
export function useRouteDocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    routeTitle = formatDocumentTitle(routeTitleParts(pathname))
    apply()
  }, [pathname])
}

/**
 * 이 화면이 열려 있는 동안 탭 제목을 「{조각들} · Gen:iA Works」로 둔다. 닫히면(언마운트) 주소 기본값으로 돌아간다.
 * 조각이 아직 없으면(로딩 중) 주소 기본값을 그대로 둔다 — 「Gen:iA Works」만 잠깐 보이지 않게.
 */
export function useDocumentTitle(parts: readonly TitlePart[]) {
  const ready = parts.some((p) => typeof p === 'string' && p.trim().length > 0)
  const title = ready ? formatDocumentTitle(parts) : null
  useEffect(() => {
    if (title == null) return
    const id = ++nextId
    overrides.push({ id, title })
    apply()
    return () => {
      const i = overrides.findIndex((o) => o.id === id)
      if (i >= 0) overrides.splice(i, 1)
      apply()
    }
  }, [title])
}
