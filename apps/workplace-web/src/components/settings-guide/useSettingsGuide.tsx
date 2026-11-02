// 설정 가이드 상태·조립 훅 — 열로 둘지 버튼(시트)으로 둘지 정하고, 헤더 버튼·열·시트 요소를 만들어 돌려준다(WP-399).
// SettingsPage 는 돌려받은 요소를 제자리에 꽂기만 한다.
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
import { usePersistentToggle } from '@/hooks/usePersistentToggle'

import { pickActiveSection } from './activeSection'
import { SettingsGuideAside, SettingsGuideButton, SettingsGuideDesktopSheet, SettingsGuideMobileSheet } from './SettingsGuideControls'
import type { SettingsGuide } from './types'

/**
 * 열을 둘 최소 본문 폭(스크롤 요소 offsetWidth, 스크롤바 포함) = 폼 1024 + 간격 32 + 열 280.
 * 폼의 max-w-5xl 은 border-box 라 좌우 여백 px-4 가 1024 안에 이미 들어 있고, 열 280 도 오른쪽 여백 pr-4 를 포함한다.
 */
export const SETTINGS_GUIDE_MIN_BODY_WIDTH = 1336
/** 열 폭 — 남는 폭(본문 폭 − 폼 1024 − 간격 32)에 따라 최소 280 ~ 최대 360px(WP-1281). 넓은 화면에서 가이드 문장이 너무 잘게 꺾이지 않게. */
const ASIDE_MIN_WIDTH = 280
const ASIDE_MAX_WIDTH = 360
/** 접힘 상태는 화면별이 아니라 기기 전역 1개로 기억한다(usePersistentToggle — '1' 접힘 / '0' 펼침). */
const COLLAPSED_KEY = 'settings-guide:collapsed'

/**
 * 본문 스크롤 요소가 열을 둘 만큼 넓은지 — 판정 기준은 뷰포트가 아니라 본문 폭.
 * 왜: 레일 펼침·AI 옆 패널·모듈 사이드바 폭이 화면마다 달라 뷰포트로는 남는 공간을 알 수 없다.
 * 헤더 버튼은 본문 밖이라 CSS container query 로 못 맞추므로 JS 로 한 값을 만들어 열·버튼을 함께 토글한다.
 * offsetWidth(스크롤바 포함)를 잰다 — clientWidth 는 스크롤바 유무로 바뀌어 「열 생김 → 본문 길어져 스크롤바 생김 → 폭 줄어
 * 열 빠짐 → 스크롤바 사라짐」으로 진동한다. 대가로 클래식 스크롤바 환경에선 열이 있을 때 폼이 최대 약 15px 좁아질 수 있다
 * (본문이 flex-1 min-w-0 이라 넘치지 않는다).
 * scrollEl 이 없으면(마운트 전·가이드 없는 화면) 재지 않고 wide=false.
 *
 * WP-414: 같은 관찰에서 본문 스크롤 영역의 보이는 높이(clientHeight)도 함께 잰다 — 열이 그보다 길면(「AI에게 묻기」 버튼만큼 길어짐) sticky 라도
 * 열 끝이 화면 밖에 남으므로, 열 최대 높이를 이 값으로 묶고 열 안에서 따로 스크롤하게 한다. 높이는 CSS 만으로 못 얻는다 — 열의 부모는 본문 내용
 * 높이로 자라는 행이라 max-h-full 이 스크롤 영역 높이가 되지 않는다. 높이는 열이 나올 수 있을 때(trackHeight·wide)만 갱신한다 —
 * 모바일·시트 모드에서 본문 높이 변화(키보드·주소창 등)마다 페이지 전체가 다시 그려지지 않게.
 */
function useBodyBox(
  scrollEl: HTMLElement | null,
  trackHeight: boolean,
): { wide: boolean; height: number | undefined; asideWidth: number } {
  const [wide, setWide] = useState(false)
  // 열 폭은 잘라 둔 값으로 둔다 — 본문 폭 그대로 두면 창을 끄는 동안 값이 매번 달라져 SettingsPage 가 프레임마다 다시 그려진다.
  const [asideWidth, setAsideWidth] = useState(ASIDE_MIN_WIDTH)
  const [height, setHeight] = useState<number | undefined>(undefined)
  // useLayoutEffect: 그리기 전에 재야 넓은 화면 진입 때 버튼이 한 프레임 보였다가 열로 바뀌지 않는다.
  useLayoutEffect(() => {
    if (!scrollEl) return
    const measure = () => {
      const isWide = scrollEl.offsetWidth >= SETTINGS_GUIDE_MIN_BODY_WIDTH
      setWide(isWide)
      setAsideWidth(clampAsideWidth(scrollEl.offsetWidth))
      if (trackHeight && isWide) setHeight(scrollEl.clientHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl, trackHeight])
  return { wide, height, asideWidth }
}

/** 남는 폭(본문 폭 − 폼·간격)에 맞춘 열 폭 — ASIDE_MIN_WIDTH ~ ASIDE_MAX_WIDTH. */
function clampAsideWidth(bodyWidth: number): number {
  return Math.max(ASIDE_MIN_WIDTH, Math.min(ASIDE_MAX_WIDTH, bodyWidth - (SETTINGS_GUIDE_MIN_BODY_WIDTH - ASIDE_MIN_WIDTH)))
}

/**
 * 본문에서 지금 보고 있는 섹션(WP-1281) — 가이드 섹션 id 와 같은 id 를 가진 본문 요소의 위치를 스크롤마다(rAF 로 한 번) 재고
 * pickActiveSection 으로 고른다. ids 가 비면 재지 않는다. ids 는 문자열 하나로 받아 렌더마다 새 배열이어도 다시 달지 않는다.
 */
function useActiveSection(scrollEl: HTMLElement | null, idsKey: string): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!scrollEl || idsKey === '') return
    const ids = idsKey.split('|')
    let frame = 0
    const measure = () => {
      frame = 0
      const top = scrollEl.getBoundingClientRect().top
      const positions = ids.flatMap((id) => {
        const el = document.getElementById(id)
        return el && scrollEl.contains(el) ? [{ id, top: el.getBoundingClientRect().top - top }] : []
      })
      const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2
      setActive(pickActiveSection(positions, scrollEl.clientHeight, atBottom))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    // 섹션 높이가 바뀌어도(데이터 로드·펼침) 다시 잰다.
    const ro = new ResizeObserver(schedule)
    ro.observe(scrollEl)
    if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild)
    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollEl, idsKey])
  return active
}

export interface SettingsGuideUi {
  /** 데스크톱 헤더 actions 앞에 둘 버튼 — 열이 보이면 null. */
  desktopButton: ReactNode
  /** 모바일 헤더 ⋯ 밖 인라인 버튼(mobilePrimaryAction). 데스크톱이면 null. */
  mobileButton: ReactNode
  /** Page.Body aside 슬롯 — 열이 없으면 null(슬롯은 유지해 본문이 리마운트되지 않게). */
  aside: ReactNode
  /** 데스크톱 시트 — 본문 영역 relative 상자 안에 둔다. */
  desktopSheet: ReactNode
  /** 모바일 하단 시트(Portal). */
  mobileSheet: ReactNode
  /**
   * 본문의 「가이드 열기」 단추용(WP-1281) — 열이 보이면 그대로, 접어 둔 열이면 다시 펴고, 아니면 시트를 연다.
   * sectionId 를 주면 스크롤 위치와 관계없이 그 섹션 도움말로 연다(단추가 놓인 섹션). 본문을 다시 스크롤하면 그때부터 다시 따라간다.
   */
  open: (sectionId?: string) => void
}

/**
 * 상태 3가지: 열(wide·펼침·데스크톱) / 데스크톱 버튼 → 본문 영역 안 오른쪽 비모달 시트 / 모바일 버튼 → 하단 시트.
 * guide 가 없으면 null — 이때 scrollEl 을 재지 않아 ResizeObserver 도 달지 않는다.
 */
export function useSettingsGuide(
  guide: SettingsGuide | undefined,
  scrollEl: HTMLElement | null,
  /** 오른쪽 열을 둘 수 있는지 — 목록형(전체 폭) 화면은 옆에 남는 폭이 없어 늘 버튼 → 시트로만 연다(WP-1281). */
  allowAside = true,
): SettingsGuideUi | null {
  const [collapsed, , setCollapsed] = usePersistentToggle(COLLAPSED_KEY, false)
  const isMobile = useIsMobile()
  // 열 후보(데스크톱·펼침)일 때만 높이를 잰다 — 열이 실제로 나오는지(wide)는 같은 측정에서 함께 판정한다.
  // 열을 둘 수 없는 화면은 재지 않는다 — wide 가 늘 거짓이라 버튼 → 시트로만 열린다.
  const { wide, height: bodyHeight, asideWidth } = useBodyBox(guide && allowAside ? scrollEl : null, !isMobile && !collapsed)
  const showAside = guide != null && !isMobile && wide && !collapsed
  const [sheetOpen, setSheetOpen] = useState(false)
  // 시트를 연 채 열 상태가 되면(창을 넓힘 등) 시트를 닫는다 — 같은 내용이 두 번 보이지 않게.
  // 렌더 중 상태 조정(React 공식 패턴) — 다시 좁아져도 시트가 저절로 다시 열리지 않는다.
  if (showAside && sheetOpen) setSheetOpen(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const sheetId = useId()
  // 섹션별 가이드면 본문의 지금 섹션을 따라간다(WP-1281).
  const scrolledSection = useActiveSection(scrollEl, (guide?.sections ?? []).map((g) => g.id).join('|'))
  // 「가이드 열기」가 고른 섹션 — 본문 스크롤로 지금 섹션이 바뀌면 풀린다(렌더 중 상태 조정).
  const [pinned, setPinned] = useState<{ id: string; from: string | null } | null>(null)
  if (pinned && pinned.from !== scrolledSection) setPinned(null)
  const activeSection = pinned?.id ?? scrolledSection
  if (!guide) return null

  // 넓은데 접어 둔 상태면 버튼은 시트 대신 열을 다시 편다.
  const reopensAside = !isMobile && wide && collapsed
  const closeSheet = () => setSheetOpen(false)
  const button = (
    <SettingsGuideButton
      ref={buttonRef}
      mobile={isMobile}
      // 시트 열림 그대로 — 열을 펴는 상태에선 시트가 열려 있을 때만 true 이고, 그건 실제로 시트가 보이는 상태다.
      expanded={sheetOpen}
      // 가리키는 시트가 DOM 에 있을 때만(데스크톱 시트가 열려 있을 때) 연결한다.
      controls={!isMobile && sheetOpen ? sheetId : undefined}
      onClick={() => (reopensAside ? setCollapsed(false) : setSheetOpen((o) => !o))}
    />
  )
  return {
    desktopButton: !isMobile && !showAside ? button : null,
    mobileButton: isMobile ? button : null,
    aside: showAside ? <SettingsGuideAside guide={guide} activeSection={activeSection} maxHeight={bodyHeight} width={asideWidth} onHide={() => setCollapsed(true)} /> : null,
    desktopSheet: isMobile ? null : (
      <SettingsGuideDesktopSheet guide={guide} activeSection={activeSection} open={sheetOpen} id={sheetId} onClose={closeSheet} returnFocusRef={buttonRef} />
    ),
    mobileSheet: isMobile ? <SettingsGuideMobileSheet guide={guide} activeSection={activeSection} open={sheetOpen} onClose={closeSheet} /> : null,
    open: (sectionId) => {
      if (sectionId) setPinned({ id: sectionId, from: scrolledSection })
      if (showAside) return
      if (reopensAside) setCollapsed(false)
      else setSheetOpen(true)
    },
  }
}
