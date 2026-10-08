// Page.Body props 타입 회귀 — padded=false 에 scrollRef 를 넘기면 타입 오류여야 한다(조용히 무시되던 버그 방지).
// 실제 검증은 `pnpm typecheck`(tsc -b) 가 아래 @ts-expect-error 줄을 컴파일하며 수행한다 — 오류가 사라지면
// "Unused '@ts-expect-error' directive" 로 typecheck 가 실패한다. vitest 실행은 형식상 통과만 확인.
import type { Ref } from 'react'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { PageBodyProps } from './Page'

const ref = null as unknown as Ref<HTMLDivElement>

// 허용: padded(기본) + scrollRef, padded=false + className.
const paddedWithRef: PageBodyProps = { children: null, scrollRef: ref }
const selfLayout: PageBodyProps = { children: null, padded: false, className: 'flex-col' }

// @ts-expect-error — padded=false 는 스크롤을 화면이 소유하므로 scrollRef 를 받지 않는다.
const selfLayoutWithRef: PageBodyProps = { children: null, padded: false, scrollRef: ref }

// 허용: 기본 스크롤 본문의 여백만 비우기(inset=false). 금지: padded=false 는 여백 자체가 화면 소유라 inset 을 받지 않는다.
const scrollNoInset: PageBodyProps = { children: null, inset: false, scrollRef: ref }
// @ts-expect-error — padded=false 에 inset 은 의미가 없다.
const selfLayoutWithInset: PageBodyProps = { children: null, padded: false, inset: false }

describe('PageBodyProps', () => {
  it('padded=false 와 scrollRef 를 함께 받지 않는다(타입 수준 — typecheck 가 검증)', () => {
    expectTypeOf<Extract<PageBodyProps, { padded: false }>['scrollRef']>().toEqualTypeOf<undefined>()
    expect([paddedWithRef, selfLayout, selfLayoutWithRef, scrollNoInset, selfLayoutWithInset]).toHaveLength(5)
  })
})
