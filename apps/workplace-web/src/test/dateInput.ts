// 덜 넣은 날짜(<input type="date"> 의 validity.badInput) 흉내 도우미(WP-1644) — jsdom 은 날짜를 덜 칠 수 없어 validity 를 덮는다.
// 실제 브라우저처럼 값은 건드리지 않는다(덜 넣은 날짜는 실제로도 값이 '' 로 올라온다). 판정은 lib/dateInput.
import { expect } from 'vitest'

/** 입력 요소가 「덜 넣은 날짜」(또는 아님)라고 답하게 validity 를 덮는다. */
export function setBadInput(input: HTMLElement, badInput: boolean) {
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput, valid: !badInput } })
}

/**
 * 요청이 나갔다면 기록될 만큼 잠깐(50ms) 기다린 뒤 아직 없음을 본다 — 「보내지 않음」은 기다릴 조건이 없어 고정 대기가 불가피하다.
 * 안내가 뜨기를 이미 기다린 뒤라도, 막는 검사가 비동기(폼 검사)면 요청이 그 뒤에 나갈 수 있어 한 틱 더 둔다.
 */
export async function expectNoRequest(requests: unknown[]) {
  await new Promise((r) => setTimeout(r, 50))
  expect(requests).toHaveLength(0)
}
