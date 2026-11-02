// 본문에서 설정 가이드를 여는 통로(WP-1281) — SettingsPage 가 값을 넣고, 본문의 「가이드 열기」 단추가 꺼내 쓴다.
// 가이드가 없는 화면이면 null 이라 단추를 그리지 않는다.
import { createContext, useContext } from 'react'

export const OpenSettingsGuideContext = createContext<((sectionId?: string) => void) | null>(null)

/** 이 화면의 설정 가이드를 여는 함수 — sectionId 를 주면 그 섹션 도움말로 연다. 가이드가 없으면 null. */
export function useOpenSettingsGuide(): ((sectionId?: string) => void) | null {
  return useContext(OpenSettingsGuideContext)
}
