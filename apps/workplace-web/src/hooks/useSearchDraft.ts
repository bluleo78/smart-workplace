import { useEffect, useEffectEvent, useRef, useState } from 'react'

/**
 * URL 검색어(?q)에 묶인 검색창의 입력 draft — 연락처·메일·이슈 목록 필터가 함께 쓴다(WP-1003).
 *
 * - 타이핑은 draft 에 바로 반영하고, URL 은 delay(기본 300ms) debounce 뒤에만 쓴다. q 가 URL 에 직접 묶이면
 *   키 입력마다 라우터 이동을 거쳐 값이 되돌아오며 한글 IME 조합이 끊기고(WP-974) 목록 API 도 매번 다시 부른다(#814).
 * - 바깥(뒤로 가기·앱 레일·초기화 등)에서 q 가 바뀌면 draft 를 맞춘다.
 * - 단, 이 훅이 쓴 q 가 되돌아온 것(내 쓰기의 메아리)은 한 번 건너뛴다(WP-999) — URL 을 쓴 순간부터 다시 렌더되기까지
 *   더 친 글자가 있으면, 되돌아온 옛 q 로 draft 를 덮어 그 글자가 지워졌다.
 * - URL 을 어떻게 쓸지(함께 지울 키·replace 여부)는 화면마다 달라 write 로 받는다. debounce 가 끝난 순간의 최신 write 를 부른다 —
 *   예약할 때의 write 는 그 사이 바뀐 다른 URL 키(열린 상세·필터)를 옛 값으로 되돌릴 수 있다.
 *
 * @param value 지금 URL 의 검색어(없으면 '')
 * @param write 검색어를 URL 에 쓴다 — 화면이 정한 방식으로(보통 history replace)
 * @param delay debounce 간격(ms)
 * @returns draft(입력값)·setDraft(타이핑 — debounce 뒤 write)·commit(바로 write — 「취소」로 비울 때 등)
 */
export function useSearchDraft(value: string, write: (next: string) => void, delay = 300) {
  const [draft, setDraft] = useState(value)
  // 이 훅이 마지막으로 URL 에 쓴 q — 그 값이 value 로 되돌아올 때는 draft 를 덮지 않는다.
  const writtenRef = useRef<string | null>(null)

  useEffect(() => {
    // 내 쓰기의 메아리는 한 번만 건너뛴다(그 뒤 바깥에서 같은 값으로 바뀌면 다시 맞춘다).
    const isEcho = writtenRef.current === value
    writtenRef.current = null
    // 바깥에서 q 가 바뀌면 draft 를 맞춘다(외부 소스 URL → 로컬 draft 동기화).
    if (!isEcho) setDraft(value)
  }, [value])

  // URL 에 쓴다. q 가 실제로 바뀔 때만 메아리를 기다린다 — 안 바뀌면 value 가 그대로라 기록이 소비되지 않고 남는다.
  const send = (next: string) => {
    if (next !== value) writtenRef.current = next
    write(next)
  }

  // debounce 가 끝난 순간의 최신 렌더 값으로 판정·쓰기 — 이미 URL 과 같으면 쓰지 않는다(화면의 write 가 다른 키를 건드리지 않게).
  const flush = useEffectEvent((next: string) => {
    if (next !== value) send(next)
  })
  useEffect(() => {
    const t = setTimeout(() => flush(draft), delay)
    return () => clearTimeout(t)
  }, [draft, delay])

  // 바로 쓰기 — debounce 를 기다리지 않고 draft 와 URL 을 함께 바꾼다. write 는 q 가 같아도 부른다(화면이 함께 지우는 키가 있을 수 있다).
  const commit = (next: string) => {
    setDraft(next)
    send(next)
  }

  return { draft, setDraft, commit }
}
