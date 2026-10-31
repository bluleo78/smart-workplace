// 노트 헤더 ⋯ 메뉴의 「전체 폭」 항목(WP-793) — 누구에게·어느 화면에서 보이는지와 상태 표시. 실제 폭 변화·저장 배선은 E2E(wiki-full-width.spec).
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { SyncStatus } from '../../lib/collab/collabStatus'
import { closeSendToChat, sendToChatTarget } from '../../lib/sendToChat'
import type { ShareTarget } from '../../lib/shareTarget'
import { WikiPageHeader } from './WikiPageHeader'

// 휴대폰 헤더는 레이아웃 상세 바 컨텍스트가 있어야 그려진다 — 데스크톱 헤더만 본다(휴대폰 숨김은 같은 조건식의 !isMobile).
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

function renderHeader(
  props: {
    fullWidth?: boolean
    onFullWidthChange?: (next: boolean) => void
    fullWidthSaving?: boolean
    syncStatus?: SyncStatus
    onShare?: () => void
    shareTarget?: ShareTarget
  } = {},
) {
  return renderWithProviders(
    <WikiPageHeader
      crumbs={[{ id: 1, title: '2026-10-22' }]}
      syncStatus={props.syncStatus ?? 'live'}
      aiState="ready"
      aiBusy={false}
      aiAttributed={false}
      pagePath={(id: number) => `/wiki/spaces/1/pages/${id}`}
      onAiAction={() => {}}
      onDelete={() => {}}
      canDelete
      onViewSource={() => {}}
      fullWidth={props.fullWidth}
      onFullWidthChange={props.onFullWidthChange}
      fullWidthSaving={props.fullWidthSaving}
      onShare={props.onShare}
      shareTarget={props.shareTarget}
    />,
  )
}

const openMenu = () => userEvent.click(screen.getByRole('button', { name: '페이지 메뉴' }))

describe('WikiPageHeader 「전체 폭」 항목', () => {
  it('편집할 수 있으면 메뉴 맨 위에 체크형 항목으로 보이고, 누르면 반대 값을 넘기며 메뉴는 열린 채다', async () => {
    const onChange = vi.fn()
    renderHeader({ fullWidth: false, onFullWidthChange: onChange })
    await openMenu()
    // 메뉴의 첫 항목 — 보기 설정이라 소스·기록·삭제보다 위.
    expect(screen.getByRole('menu').querySelector('[role^="menuitem"]')).toHaveAttribute('data-testid', 'wiki-menu-full-width')
    const item = screen.getByRole('menuitemcheckbox', { name: '전체 폭' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(item)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('menuitemcheckbox', { name: '전체 폭' })).toBeInTheDocument()
  })

  it('켜져 있으면 aria-checked=true, 누르면 false 를 넘긴다', async () => {
    const onChange = vi.fn()
    renderHeader({ fullWidth: true, onFullWidthChange: onChange })
    await openMenu()
    const item = screen.getByRole('menuitemcheckbox', { name: '전체 폭' })
    expect(item).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(item)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('저장 중엔 잠겨 눌러도 다시 보내지 않는다(연타로 요청이 겹치지 않게)', async () => {
    const onChange = vi.fn()
    renderHeader({ onFullWidthChange: onChange, fullWidthSaving: true })
    await openMenu()
    const item = screen.getByRole('menuitemcheckbox', { name: '전체 폭' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(item)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('편집할 수 없으면(onFullWidthChange 없음) 항목이 없다', async () => {
    renderHeader({ fullWidth: true })
    await openMenu()
    expect(screen.getByTestId('wiki-menu-source')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-menu-full-width')).toBeNull()
  })

  it.each(['deleted', 'forbidden', 'signed-out', 'outdated'] as const)('종단 상태(%s)엔 항목이 없다 — 저장이 실패할 뿐이다', async (status) => {
    renderHeader({ onFullWidthChange: vi.fn(), syncStatus: status })
    await openMenu()
    expect(screen.queryByTestId('wiki-menu-full-width')).toBeNull()
  })
})

describe('WikiPageHeader 링크 복사(WP-1234)', () => {
  const target: ShareTarget = { kind: 'page', url: 'http://localhost:3000/wiki/open/1', title: '2026-10-22' }

  it('🔗 는 노트 링크를 바로 복사하고, 「공유」(외부 공유)는 다른 아이콘(Share2)이다', async () => {
    const user = userEvent.setup()
    renderHeader({ shareTarget: target, onShare: () => {} })
    expect(screen.getByTestId('wiki-share-button').querySelector('svg')).toHaveClass('lucide-share-2')
    await user.click(screen.getByRole('button', { name: /^링크 복사 / }))
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/wiki/open/1')
  })

  it('일반 브라우저에선 ⋯ 에 「브라우저에서 열기」가 없다(이미 주소창이 있다)', async () => {
    renderHeader({ shareTarget: target })
    await openMenu()
    expect(screen.getByTestId('wiki-menu-source')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-open-in-browser')).not.toBeInTheDocument()
  })

  it('⋯ 에는 늘 「채팅·이슈로 보내기…」가 있고 누르면 이 노트로 보내기 창을 연다(WP-1235)', async () => {
    const user = userEvent.setup()
    renderHeader({ shareTarget: target })
    await openMenu()
    await user.click(screen.getByTestId('menu-send-to-chat'))
    await waitFor(() => expect(sendToChatTarget()).toBe(target))
    act(() => closeSendToChat())
  })
})
