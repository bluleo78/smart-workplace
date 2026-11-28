// 상단 오른쪽 액션 폭과 칩 반폭 보정을 칩 포털에 CSS 변수로 넘기는 훅(WP-1415).
// 왜: 칩은 body 에 portal 된 fixed 요소라 헤더 우측 액션의 폭·칩 자신의 폭을 CSS 로 알 수 없다.
// 액션이 칩을 침범할 만큼 넓으면 TopCenterSlot 의 3 번째 min() 항이 칩을 왼쪽으로 밀어 겹침을 막는다.
// 3 항의 오프셋은 칩 반폭에 맞게 바뀐다 — 동그라미(32px)면 128px, 일반 칩(140px)이면 182px.
// (오프셋 = 128 + (칩폭-32)/2: 128px 는 동그라미 반폭 16 + 간격 8 + 검색 32 + 간격 8 + 「?」 32 + 간격 16 + 여백 16 — WP-1505 에서 「?」 자리 40px 를 더했다.)
import { useLayoutEffect, useRef, useState } from 'react'

import { useActiveDensityHeader, useHeaderDensity } from './HeaderDensityContext'

/** 헤더 우측 액션 표식(Page.Header 의 data-ai-actions). */
const ACTIONS_SELECTOR = '[data-ai-actions]'
/** 상단 가운데 틀 표식(TopCenterSlot 의 data-ai-chip — 폭이 칩 폭과 같다, 검색은 absolute). */
const CHIP_SELECTOR = '[data-ai-chip]'

/** 칩과 액션의 현재 폭(읽기만 — 쓰기와 섞으면 쓰기 뒤 읽기가 강제 레이아웃을 또 부른다, WP-2078). */
function readGeometry(chip: HTMLElement, actions: HTMLElement | null) {
  return {
    actionsWidth: actions?.getBoundingClientRect().width ?? 0,
    chipWidth: chip.getBoundingClientRect().width,
  }
}

/** 읽어 둔 폭을 위치 CSS 변수로 쓴다(쓰기만) — 같은 배치에서 정지선을 계산한다. */
function writeGeometry(chip: HTMLElement, { actionsWidth, chipWidth }: { actionsWidth: number; chipWidth: number }) {
  chip.style.setProperty('--ai-actions-width', `${actionsWidth}px`)
  chip.style.setProperty('--ai-chip-offset', `${128 + Math.max(0, (chipWidth - 32) / 2)}px`)
}

/**
 * [data-ai-actions] 의 폭을 --ai-actions-width 로, [data-ai-chip] 의 폭을 --ai-chip-offset 로 복사한다.
 * 액션이 없으면(모바일·헤더 없는 화면) 0px — 3 번째 항이 100%-오프셋 가 돼 기본 중앙보다 항상 크므로 영향 없음.
 * 액션은 칩보다 늦게 마운트될 수 있어(페이지 헤더가 포털 이후 렌더) MutationObserver 로 등장까지 기다린다.
 * 재측정: 액션 크기·칩 크기(동그라미↔일반 전환)·창 resize·액션 등장/사라짐.
 *
 * 타이밍(WP-2078): 앱 셸 첫 커밋 안에서는 레이아웃을 읽지 않는다(첫 커밋의 13~20% 가 강제 레이아웃이었다).
 *  - 첫 값은 ResizeObserver 의 첫 알림이 넣는다 — 브라우저 자기 레이아웃 뒤·페인트 전이라 첫 프레임에 이미 맞는다.
 *    새로 observe 한 요소는 그 요소에 대한 첫 알림이 오므로 늦게 나타난 칩·액션도 같은 경로로 맞춘다.
 *  - 그 칩에 대한 첫 적용만 위치 전환을 끄고 다음 rAF 에 되돌린다(강제 읽기로 확정하지 않는다).
 *  - 마운트 뒤 밀도(folded·circle)·헤더가 바뀐 커밋은 레이아웃 효과에서 동기로 갱신한다 — 동그라미→알약 첫 프레임에
 *    옛 오프셋이 쓰여 검색이 액션에 겹치던 회귀(WP-1415)를 막는다.
 *  - 단 칩이 아직 첫 적용 전일 때의 헤더 등록(null -> 요소) 커밋만 건너뛴다 — 이 커밋은 부팅 중 연쇄 커밋이라 읽으면
 *    강제 레이아웃이 옮겨 올 뿐이고, 관찰자의 첫 알림이 곧 값을 넣는다. 칩을 이미 맞춘 뒤(콜드 로드에서 페이지 청크가
 *    늦게 와 헤더가 나중에 등록) 오는 헤더는 동기 경로로 맞춘다 — 건너뛰면 전환이 켜진 채 칩이 200ms 미끄러진다.
 */
export function useAiActionsWidth() {
  const header = useActiveDensityHeader()
  const { folded, circle } = useHeaderDensity()
  // 직전 커밋의 헤더·밀도(null 이면 첫 마운트 커밋). 첫 마운트는 건너뛰고 — 강제 레이아웃 없이 ResizeObserver 첫 알림이
  // 값을 넣는다 — 헤더가 null -> 요소로만 바뀐 등록 커밋을 가려내는 데도 쓴다.
  // (StrictMode 의 개발 빌드는 효과를 두 번 돌려 refs 가 남은 두 번째 실행에서 강제 레이아웃이 나는 것이 정상이다 — 운영은 영향 없음.)
  const prev = useRef<{ header: HTMLElement | null; folded: boolean; circle: boolean } | null>(null)
  // 첫 적용(전환 끄기)을 이미 거친 칩. 칩이 바뀌면(포털 재생성) 다시 첫 적용으로 본다. 한 번만 만든다.
  const [applied] = useState(() => new WeakSet<HTMLElement>())
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = { header, folded, circle }
    if (!before) return
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)
    // 칩이 없으면 쓸 곳이 없다 — 칩이 생기면 관찰자 효과가 observe 하고 첫 알림이 값을 넣는다.
    if (!chip) return
    // 헤더 등록 커밋(null -> 요소, 밀도 그대로)은 칩이 아직 첫 적용 전일 때만 건너뛴다(이유는 위 독블록 참고).
    // 칩을 이미 맞춘 뒤의 늦은 헤더·밀도 변경·헤더 교체는 아래 동기 경로.
    if (before.header === null && header !== null && before.folded === folded && before.circle === circle
        && !applied.has(chip)) return
    const actions = header?.querySelector<HTMLElement>(ACTIONS_SELECTOR) ?? null
    // 밀도 단계의 폭 변경은 위치 보정과 한 페인트에 반영한다. ResizeObserver까지 기다리면
    // 동그라미→알약의 첫 프레임이 옛 오프셋을 써 검색이 액션에 54px 겹친다.
    // 읽기를 먼저 모은 뒤 전환을 끄고 쓴다 — 끄기를 먼저 쓰면 읽기에서 스타일·레이아웃이 한 번 더 강제된다.
    const geometry = readGeometry(chip, actions)
    const transition = chip.style.transitionProperty
    chip.style.transitionProperty = 'none'
    writeGeometry(chip, geometry)
    applied.add(chip)
    // 새 정지선을 전환 없이 확정한 뒤 일반 레일/패널 이동의 위치 전환을 복원한다.
    // 이 동기 경로의 강제 flush 는 1회 남는다(설계 — WP-1415, 첫 프레임 겹침 방지).
    chip.getBoundingClientRect()
    chip.style.transitionProperty = transition
  }, [header, folded, circle, applied])
  // 관찰자 등록도 레이아웃 효과로 — 첫 페인트 전에 observe 해야 첫 알림이 첫 프레임 안에 온다.
  useLayoutEffect(() => {
    let actions: HTMLElement | null = null
    let chip: HTMLElement | null = null
    // 첫 적용이 끈 전환을 되돌리는 함수(대기 중일 때만 있음)와 그 rAF id.
    let restore: (() => void) | null = null
    let raf = 0
    const flushRestore = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      restore?.()
      restore = null
    }
    const update = () => {
      if (!chip) return
      const target = chip
      // RO 시점에는 레이아웃이 깨끗해 두 요소를 한 번에 읽어도 강제 레이아웃이 아니다 — entry.borderBoxSize 는 알림 온 요소만
      // 줘서 다른 쪽 폭을 따로 캐시해야 하므로 getBoundingClientRect 로 함께 읽는다.
      // 읽기를 먼저 — 아래 전환 끄기(쓰기) 뒤에 읽으면 스타일·레이아웃이 한 번 더 강제된다.
      const geometry = readGeometry(target, actions)
      if (!applied.has(target)) {
        // 그 칩의 첫 적용: 새 값으로 위치가 전환을 타고 따라가지 않게 끄고, 다음 프레임에 되돌린다.
        applied.add(target)
        flushRestore()
        const transition = target.style.transitionProperty
        target.style.transitionProperty = 'none'
        restore = () => { target.style.transitionProperty = transition }
        raf = requestAnimationFrame(flushRestore)
      }
      writeGeometry(target, geometry)
    }
    const ro = new ResizeObserver(update)
    // 헤더와 포털이 각기 늦게 나타나도 두 요소를 함께 다시 연결한다.
    const attach = () => {
      const nextActions = header?.querySelector<HTMLElement>(ACTIONS_SELECTOR) ?? null
      const nextChip = document.querySelector<HTMLElement>(CHIP_SELECTOR)
      if (actions !== nextActions || chip !== nextChip) {
        ro.disconnect()
        actions = nextActions
        chip = nextChip
        if (actions) ro.observe(actions)
        if (chip) ro.observe(chip)
        // 새로 observe 한 요소는 ResizeObserver 가 첫 알림을 준다 — 즉시 읽지 않는다(커밋 안 강제 레이아웃 방지).
      }
    }
    attach()
    const bodyObserver = new MutationObserver(attach)
    bodyObserver.observe(document.body, { childList: true })
    const headerObserver = new MutationObserver(attach)
    if (header) headerObserver.observe(header, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      bodyObserver.disconnect()
      headerObserver.disconnect()
      window.removeEventListener('resize', update)
      // 대기 중인 rAF 를 취소하되 끈 전환은 되돌려 둔다.
      flushRestore()
    }
  }, [header, applied])
}
