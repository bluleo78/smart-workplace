// 모바일 UI/UX 보정 U2(WP-121) — 페이지 테스트(WP-971, WP-981).
// 📌 배지 → 교체 메뉴 → 탭바 고정, 탭 편집의 꽉 참 안내·＋/저장 비활성·저장 뒤 탭바·‹ 복귀는
// 조건부 렌더·주소라 브라우저 없이 판정되므로 e2e/pages/mobile/uiux-u2.spec.ts 에서 옮겼다.
// 상세 화면 ✦ AI 시트(탭바 없음 + ×)는 moduleLayout.test.tsx 가 지킨다.
// 길게 누르기·스크림 겹침·계산 스타일·44px 크기·키보드 탐색(@input·@layout·@platform)과
// 🔔 알림 푸시 화면을 앱 목록에서 열고 ‹(브라우저 히스토리)로 돌아오는 흐름(@flow)은 E2E 에 남는다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderMobile } from '@/test/kits/mobile/shell'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

// iPhone 13(390px)·터치 — 7칸 탭바(사용자 5칸).
mockViewport()

describe('앱 목록 📌 배지', () => {
  // 배지는 길게 누르기와 같은 메뉴를 연다 — 고정 앱이라 「교체」가 있고, 배지 탭은 앱으로 이동하지 않는다.
  test('📌 → 교체 메뉴(스크림) → 작업으로 교체하면 토스트와 탭바에 작업 칸', async () => {
    const { user, location } = renderMobile('/apps')
    await user.click(await screen.findByTestId('apps-pinned-chat', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('apps-menu')).toBeInTheDocument()
    expect(screen.getByTestId('apps-scrim')).toBeInTheDocument()
    expect(location()).toBe('/apps')
    await user.click(screen.getByTestId('apps-swap'))
    await user.click(await screen.findByTestId('apps-swap-to-tasks'))
    expect(await screen.findByText('작업을 탭바에 고정했어요')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-tab-tasks')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tab-chat')).not.toBeInTheDocument()
  })
})

describe('탭바 순서 편집', () => {
  // 탭 편집은 ‹·제목·[저장] 헤더의 푸시 화면(탭바 없음). 칸이 다 차면 이유를 먼저 보이고 ＋ 를 막는다.
  // 하나 빼면 안내가 사라지고 저장은 칸이 덜 차 비활성, 다시 채우면 저장해 탭바에 반영하고 앱 목록으로 간다.
  test('꽉 참 안내·＋ 비활성 → 빼기(안내 사라짐·저장 비활성) → 노트 추가 → 저장 → /apps 탭바에 노트', async () => {
    const { user, location } = renderMobile('/apps')
    await user.click(await screen.findByTestId('apps-edit-tabs', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    await waitFor(() => expect(location()).toBe('/apps/tabs'))
    const header = await screen.findByTestId('tab-edit-header')
    expect(header).toContainElement(screen.getByTestId('tab-edit-save'))
    expect(screen.getByTestId('mobile-back-title')).toHaveTextContent('탭바 순서 편집')
    expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('tab-edit-full-hint')).toHaveTextContent('탭바가 꽉 찼어요 — 하나를 빼면 추가할 수 있어요')
    expect(screen.getByTestId('tab-edit-add-tasks')).toBeDisabled()

    await user.click(screen.getByTestId('tab-edit-remove-2'))
    expect(screen.queryByTestId('tab-edit-full-hint')).not.toBeInTheDocument()
    expect(screen.getByTestId('tab-edit-save')).toBeDisabled()
    await user.click(screen.getByTestId('tab-edit-add-wiki'))
    expect(screen.getByTestId('tab-edit-full-hint')).toBeInTheDocument()
    await user.click(screen.getByTestId('tab-edit-save'))
    await waitFor(() => expect(location()).toBe('/apps'))
    expect(await screen.findByTestId('mobile-tab-wiki')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tab-mail')).not.toBeInTheDocument()
  })

  // 딥링크로 탭 편집에 들어와도 ‹ 는 앱 목록으로 간다(앱 밖으로 나가지 않는다).
  test('딥링크 /apps/tabs 의 ‹ 는 /apps', async () => {
    const { location } = renderMobile('/apps/tabs')
    fireEvent.click(await screen.findByTestId('mobile-back', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    await waitFor(() => expect(location()).toBe('/apps'))
  })
})
