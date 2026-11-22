// matches 와 change 를 따로 조종하는 가짜 matchMedia — 「matches 는 바뀌었는데 change 는 아직」인 틈을 만든다(WP-1966).
// 왜 viewport.ts 와 따로인가: mockResizableViewport 는 폭 변경과 change 를 한 번에 처리해 그 틈을 만들 수 없다.

/** 가짜 matchMedia 를 설치하고 조종 함수를 돌려준다. MQL 이 만들어지기 전의 쿼리도 matches 를 바꿀 수 있다. */
export function installFakeMatchMedia(initial: Record<string, boolean> = {}) {
  const state = new Map<string, { matches: boolean; listeners: Set<() => void> }>()
  const entryOf = (query: string) => {
    let entry = state.get(query)
    if (!entry) {
      entry = { matches: initial[query] ?? false, listeners: new Set() }
      state.set(query, entry)
    }
    return entry
  }
  window.matchMedia = ((query: string) => {
    const entry = entryOf(query)
    return {
      media: query,
      get matches() {
        return entry.matches
      },
      addEventListener: (_: string, l: () => void) => entry.listeners.add(l),
      removeEventListener: (_: string, l: () => void) => entry.listeners.delete(l),
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia

  return {
    /** matches 만 바꾼다 — change 는 아직 안 나간 틈. */
    setMatches: (query: string, v: boolean) => {
      entryOf(query).matches = v
    },
    /** change 이벤트를 발사한다(act 는 부르는 쪽이 감싼다). */
    fire: (query: string) => entryOf(query).listeners.forEach((l) => l()),
    /** 모든 쿼리를 false 로 되돌리고 change 를 보낸다 — 테스트 시작 상태 정리. */
    reset: () => {
      for (const entry of state.values()) {
        entry.matches = false
        entry.listeners.forEach((l) => l())
      }
    },
  }
}
