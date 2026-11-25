import { type ComponentType, lazy, useState } from 'react'

/**
 * 미리 받아 둘 수 있는 lazy 컴포넌트를 만든다 (WP-2080).
 *
 * 왜: React.lazy 는 모듈이 이미 받아져 있어도 첫 렌더에 한 번 중단(suspend)하고,
 * React 19 는 fallback 이 커밋된 뒤 드러내기를 300ms 늦춘다. 관리 화면은 인증과 나란히
 * 청크를 미리 받는데도 이 지연 때문에 페이지 API 요청이 늦게 나갔다.
 * 로더가 받은 모듈의 컴포넌트를 기억해 두었다가, 첫 렌더에 기억한 것이 있으면
 * lazy 를 거치지 않고 바로 그린다.
 *
 * 내보내기 이름은 모듈 타입의 키로 받아(K extends keyof M) 이름이 바뀌면 컴파일이 깨지고,
 * 돌려주는 컴포넌트 타입도 그 내보내기(M[K]) 그대로라 props 검사가 React.lazy 와 같다.
 *
 * @param load 동적 import 함수
 * @param exportName 쓸 내보내기 이름 (기본 'default')
 * @returns [컴포넌트, 미리 받기용 로더] — 로더는 load 를 그대로 부르고 결과 컴포넌트를 기억한다
 */
export function preloadableLazy<M, K extends keyof M & string = 'default' & keyof M & string>(
  load: () => Promise<M>,
  exportName: K = 'default' as K,
): readonly [M[K], () => Promise<M>] {
  // 받은 모듈의 컴포넌트. 첫 렌더 시점에 읽어 상태로 고정한다.
  let loaded: ComponentType<object> | undefined

  // 모듈에서 내보내기를 골라 기억한다. 없으면 「Element type is invalid」 대신 이름을 담은 오류로 오류 경계에 보낸다.
  const pick = (mod: M) => {
    const picked = mod[exportName] as ComponentType<object> | undefined
    if (!picked) throw new Error(`preloadableLazy: 모듈에 '${exportName}' 내보내기가 없습니다`)
    loaded = picked
    return picked
  }

  const loadAndKeep = () =>
    load().then((mod) => {
      pick(mod)
      return mod
    })

  const Lazy = lazy(() => load().then((mod) => ({ default: pick(mod) })))

  function Preloadable(props: object) {
    // 첫 렌더의 선택을 고정 — 렌더 중간에 모듈이 도착해도 자식을 다시 마운트하지 않는다.
    const [Picked] = useState<ComponentType<object>>(() => loaded ?? Lazy)
    return <Picked {...props} />
  }
  // DevTools·오류 스택에서 어느 화면인지 보이게 한다.
  Preloadable.displayName = `Preloadable(${exportName})`

  return [Preloadable as M[K], loadAndKeep] as const
}
