// 선택·켜짐 표시 단언 공용 헬퍼(WP-368) — 클래스 존재뿐 아니라 계산된 배경색이 실제로 달라지는지(보이는가)까지 본다.
// 여러 spec 에 복붙되던 getComputedStyle 람다·선택/비선택 블록·토글 정규식을 한 곳에 둔다.
import { expect, type Locator } from '@playwright/test'

/** 요소들의 계산된 배경색(rgb/oklch 문자열)을 한 번에 읽는다. */
export async function computedBgs(...locators: Locator[]): Promise<string[]> {
  return Promise.all(locators.map((l) => l.evaluate((el) => getComputedStyle(el).backgroundColor)))
}

/** `::before`(선택 막대)의 계산 스타일 — 폭·content·위치(left·top·bottom px)·모서리·배경(색·이미지)·그림자, 그리고 호스트 요소의 position·높이. */
export async function selectionBarStyle(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el, '::before')
    return {
      width: s.width,
      content: s.content,
      position: s.position,
      left: s.left,
      top: parseFloat(s.top),
      bottom: parseFloat(s.bottom),
      radius: s.borderRadius,
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      boxShadow: s.boxShadow,
      hostPosition: getComputedStyle(el).position,
      hostHeight: el.getBoundingClientRect().height,
    }
  })
}

/**
 * 선택 행 단언 — selected 는 선택 클래스(cls)·막대(selection-bar)를 갖고, other 는 없다. 계산된 배경은 서로 다르고 selected 는 투명이 아니다.
 * bar=false: 막대를 쓰지 않는 선택(메일 목록 등)은 selection-bar 가 없음을 확인한다.
 * cls: 기본 bg-selected. 다중 선택처럼 다른 배경을 쓰는 곳은 정규식을 넘긴다.
 */
export async function expectSelectedRow(
  selected: Locator,
  other: Locator,
  { bar = true, cls = /bg-selected/ }: { bar?: boolean; cls?: RegExp } = {},
) {
  await expect(selected).toHaveClass(cls)
  await expect(other).not.toHaveClass(cls)
  if (bar) {
    await expect(selected).toHaveClass(/selection-bar/)
    await expect(other).not.toHaveClass(/selection-bar/)
  } else {
    await expect(selected).not.toHaveClass(/selection-bar/)
  }
  const [selectedBg, otherBg] = await computedBgs(selected, other)
  expect(selectedBg, '선택 행 배경이 비선택 행과 달라야 한다').not.toBe(otherBg)
  expect(selectedBg, '선택 행 배경이 투명이면 안 된다').not.toBe('rgba(0, 0, 0, 0)')
}

// 클래스 문자열 안에서 `dark:`·`hover:` 같은 변형 접두가 붙은 토큰은 제외하고 맨 토큰만 본다.
const bare = (token: string) => new RegExp(`(?<![:\\w-])${token}`)

/**
 * 켜짐 모양만 단언(aria 없이) — on 이면 TOGGLE_ON(text-primary·border-primary/50·bg-primary/10), off 면 켜짐 표시 없음.
 * aria-pressed 가 없는 켜짐 표시(항상 켜진 기간 트리거, 저장 뷰 칩 등)에 쓴다.
 * textOnly: 테두리 상자 없는 글자만 토글(TOGGLE_ON_TEXT_CLASS)이면 text-primary 만 본다.
 */
export async function expectToggleLook(locator: Locator, on: boolean, { textOnly = false }: { textOnly?: boolean } = {}) {
  const tokens = textOnly ? ['text-primary'] : ['text-primary', 'border-primary\\/50', 'bg-primary\\/10']
  for (const t of tokens) {
    if (on) await expect(locator).toHaveClass(bare(t))
    else await expect(locator).not.toHaveClass(bare(t))
  }
}

/** 토글(aria-pressed) 단언 — aria-pressed 값과 켜짐 모양(expectToggleLook)을 함께 본다. */
export async function expectToggle(locator: Locator, on: boolean, opts: { textOnly?: boolean } = {}) {
  await expect(locator).toHaveAttribute('aria-pressed', String(on))
  await expectToggleLook(locator, on, opts)
}
