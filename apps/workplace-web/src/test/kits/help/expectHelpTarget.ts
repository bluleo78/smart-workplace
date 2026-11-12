// 도움말 문맥 단언(WP-1507, 테스트 전용) — 화면 칸·대화상자가 어느 도움말 절로 이어지는지 본다.
// 도움말 문맥 고르기(helpContext, WP-1506)는 포커스·클릭·열린 대화상자에서 가장 가까운 [data-help] 조상의 값을 절 id 로 쓴다.
// 그래서 칸 자체가 아니라 「가장 가까운 data-help」를 단언해야 사용자가 그 칸을 만졌을 때 패널이 여는 절과 같은 값을 본다.
import { expect } from 'vitest'

/** el 에서 가장 가까운 [data-help](자기 자신 포함)가 id 인지 단언한다. */
export function expectHelpTarget(el: Element, id: string): void {
  expect(el.closest('[data-help]')).toHaveAttribute('data-help', id)
}
