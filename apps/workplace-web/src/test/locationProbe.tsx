// 화면 테스트의 지금 주소 추적(WP-1061) — renderPage·renderScreen 이 함께 쓴다(둘이 같은 타이밍을 갖게 한 곳에 둔다).
import { type ReactNode, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * 주소가 바뀔 때마다 알린다 — 이동을 단언할 때 쓴다(location.pathname + search).
 * - useLayoutEffect 로 적는다: 레이아웃 효과는 새 화면을 DOM 에 반영한 같은 커밋 안에서 바로 돈다. 예전 useEffect(패시브 효과)는
 *   CI 부하에서 findBy* 가 새 화면을 찾은 뒤에도 아직 돌지 않아 location() 이 이동 전 주소를 돌려줬다(authPages '/login' ≠ '/').
 * - 화면보다 앞에 둔다(trackLocation 의 Tracked 가 맡는다): 효과는 형제 순서대로 돌아, 앞에 있어야 새 화면의 레이아웃·패시브 효과에서도 새 주소가 보인다.
 * - window.location 을 바로 읽지 않는 까닭: pushState 가 렌더보다 먼저라 반대로 「주소를 기다린 뒤 화면 단언」이 새 화면 전에 통과한다.
 */
function LocationProbe({ onChange }: { onChange: (location: string) => void }) {
  const loc = useLocation()
  useLayoutEffect(() => onChange(loc.pathname + loc.search), [loc, onChange])
  return null
}

/**
 * 시작 주소로 추적을 만든다 — Tracked 로 라우터 안의 화면을 감싸면 probe 가 늘 화면 앞에 그려지고(순서를 부르는 쪽에 맡기지 않는다),
 * location() 은 화면과 같은 커밋의 주소를 돌려준다.
 */
export function trackLocation(start: string) {
  let current = start
  const onChange = (location: string) => {
    current = location
  }
  function Tracked({ children }: { children: ReactNode }) {
    return (
      <>
        <LocationProbe onChange={onChange} />
        {children}
      </>
    )
  }
  return { Tracked, location: () => current }
}
