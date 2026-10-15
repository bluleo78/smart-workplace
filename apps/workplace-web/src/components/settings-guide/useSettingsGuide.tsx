// 설정 가이드 상태·조립 훅 — 열로 둘지 버튼(시트)으로 둘지 정하고, 헤더 버튼·열·시트 요소를 만들어 돌려준다(WP-399).
// SettingsPage 는 돌려받은 요소를 제자리에 꽂기만 한다.
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
import { usePersistentToggle } from '@/hooks/usePersistentToggle'

import { SettingsGuideAside, SettingsGuideButton, SettingsGuideDesktopSheet, SettingsGuideMobileSheet } from './SettingsGuideControls'
import type { SettingsGuide } from './types'

/**
 * 열을 둘 최소 본문 폭(스크롤 요소 offsetWidth, 스크롤바 포함) = 폼 1024 + 간격 32 + 열 280.
 * 폼의 max-w-5xl 은 border-box 라 좌우 여백 px-4 가 1024 안에 이미 들어 있고, 열 280 도 오른쪽 여백 pr-4 를 포함한다.
 */
export const SETTINGS_GUIDE_MIN_BODY_WIDTH = 1336
/** 접힘 상태는 화면별이 아니라 기기 전역 1개로 기억한다(usePersistentToggle — '1' 접힘 / '0' 펼침). */
const COLLAPSED_KEY = 'settings-guide:collapsed'

/**
 * 본문 스크롤 요소가 열을 둘 만큼 넓은지 — 판정 기준은 뷰포트가 아니라 본문 폭.
 * 왜: 레일 펼침·AI 옆 패널·모듈 사이드바 폭이 화면마다 달라 뷰포트로는 남는 공간을 알 수 없다.
 * 헤더 버튼은 본문 밖이라 CSS container query 로 못 맞추므로 JS 로 한 값을 만들어 열·버튼을 함께 토글한다.
 * offsetWidth(스크롤바 포함)를 잰다 — clientWidth 는 스크롤바 유무로 바뀌어 「열 생김 → 본문 길어져 스크롤바 생김 → 폭 줄어
 * 열 빠짐 → 스크롤바 사라짐」으로 진동한다. 대가로 클래식 스크롤바 환경에선 열이 있을 때 폼이 최대 약 15px 좁아질 수 있다
 * (본문이 flex-1 min-w-0 이라 넘치지 않는다).
 * scrollEl 이 없으면(마운트 전·가이드 없는 화면) 재지 않고 false.
 */
function useWideBody(scrollEl: HTMLElement | null): boolean {
  const [wide, setWide] = useState(false)
  // useLayoutEffect: 그리기 전에 재야 넓은 화면 진입 때 버튼이 한 프레임 보였다가 열로 바뀌지 않는다.
  useLayoutEffect(() => {
    if (!scrollEl) return
    const measure = () => setWide(scrollEl.offsetWidth >= SETTINGS_GUIDE_MIN_BODY_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl])
  return wide
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
}

/**
 * 상태 3가지: 열(wide·펼침·데스크톱) / 데스크톱 버튼 → 본문 영역 안 오른쪽 비모달 시트 / 모바일 버튼 → 하단 시트.
 * guide 가 없으면 null — 이때 scrollEl 을 재지 않아 ResizeObserver 도 달지 않는다.
 */
export function useSettingsGuide(guide: SettingsGuide | undefined, scrollEl: HTMLElement | null): SettingsGuideUi | null {
  const wide = useWideBody(guide ? scrollEl : null)
  const [collapsed, , setCollapsed] = usePersistentToggle(COLLAPSED_KEY, false)
  const isMobile = useIsMobile()
  const showAside = guide != null && !isMobile && wide && !collapsed
  const [sheetOpen, setSheetOpen] = useState(false)
  // 시트를 연 채 열 상태가 되면(창을 넓힘 등) 시트를 닫는다 — 같은 내용이 두 번 보이지 않게.
  // 렌더 중 상태 조정(React 공식 패턴) — 다시 좁아져도 시트가 저절로 다시 열리지 않는다.
  if (showAside && sheetOpen) setSheetOpen(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const sheetId = useId()
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
    aside: showAside ? <SettingsGuideAside guide={guide} onHide={() => setCollapsed(true)} /> : null,
    desktopSheet: isMobile ? null : (
      <SettingsGuideDesktopSheet guide={guide} open={sheetOpen} id={sheetId} onClose={closeSheet} returnFocusRef={buttonRef} />
    ),
    mobileSheet: isMobile ? <SettingsGuideMobileSheet guide={guide} open={sheetOpen} onClose={closeSheet} /> : null,
  }
}
