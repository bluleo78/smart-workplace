// 확인 창 ①의 현황 문구(WP-2018 리뷰 후속) — 「차단됨」·「시작 실패」·보통 셋이 서로 다른 문장으로 나가는지 고정한다.
// 페이지 테스트는 키가 있는 가만 잡으니, 키가 없는 가와 차단됨×시작 실패 겹침은 여기서 직접 검증한다.
import { describe, expect, test } from 'vitest'

import { confirmSituation } from './confirmSituation'

describe('confirmSituation', () => {
  test('보통(작업 중)은 처리 중 문장이다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: false, blocked: false, issueKey: 'WP-1' })).toBe(
      '개발자가 WP-1 을 처리하고 있어요.',
    )
  })

  test('보통인데 이슈 키가 없어도 문장이 깨지지 않는다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: false, blocked: false, issueKey: null })).toBe(
      '개발자가 이슈를 처리하고 있어요.',
    )
  })

  test('시작 실패는 처리 중 문장과 나뉜다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: true, blocked: false, issueKey: 'WP-1' })).toBe(
      // 주어 자리라 목적격(을/를)이 아니라 주제격(은/는) — 「WP-1 을 아직 하던 일이에요」 는 문법이 깨진다(WP-2018 리뷰).
      '개발자가 시작에 실패했지만 WP-1 은 아직 하던 일이에요.',
    )
  })

  test('시작 실패의 조사는 키 끝 음절 받침으로 고른다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: true, blocked: false, issueKey: 'WP-1234' })).toBe(
      '개발자가 시작에 실패했지만 WP-1234 는 아직 하던 일이에요.',
    )
  })

  test('시작 실패인데 이슈 키가 없어도 문장이 깨지지 않는다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: true, blocked: false, issueKey: null })).toBe(
      '개발자가 시작에 실패했지만 하던 일이 남아 있어요.',
    )
  })

  // 차단됨은 전치사(에서)를 쓰므로 목적격 조사(을/를)를 붙이면 「WP-1 을 에서」 가 된다 — 붙이지 않는지 고정한다.
  test('차단됨은 사람의 답 대기 문장으로 나뉜다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: false, blocked: true, issueKey: 'WP-1' })).toBe(
      '개발자가 WP-1 에서 사람의 답을 기다리고 있어요.',
    )
  })

  test('차단됨인데 이슈 키가 없어도 문장이 깨지지 않는다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: false, blocked: true, issueKey: null })).toBe(
      '개발자가 사람의 답을 기다리고 있어요.',
    )
  })

  test('차단됨에 시작 실패가 겹치면 두 사실을 모두 말한다', () => {
    expect(confirmSituation({ name: '개발자', failedOn: true, blocked: true, issueKey: 'WP-1' })).toBe(
      '시작에 실패한 뒤에도 개발자가 WP-1 에서 사람의 답을 기다리고 있어요.',
    )
  })
})