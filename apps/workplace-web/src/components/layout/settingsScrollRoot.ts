// 설정 페이지 본문 스크롤 컨테이너 공유 (WP-182).
// 설정 목록(구성원·감사 로그)의 무한 스크롤 sentinel 이 IntersectionObserver root 로 이 요소를 써야
// 선행 로드 여유(rootMargin)가 동작한다 — 조상을 DOM 에서 추측해 고르지 않는다(useLoadMoreSentinel, WP-94).
import { createContext, useContext } from 'react'

export const SettingsScrollRootContext = createContext<Element | null>(null)

/** 감싼 SettingsPage 의 스크롤 요소(마운트 전·SettingsPage 밖이면 null → 뷰포트). */
export function useSettingsScrollRoot() {
  return useContext(SettingsScrollRootContext)
}
