// 드라이브 「공유받은 항목」(WP-1539) — 화면 컴포넌트 테스트(renderScreen).
// 목록(이름·공간·크기·공유한 사람·마지막으로 연 날), 열 수 없는 행(흐림·배지·둘째 줄·메뉴 비활성), 목록에서 빼기(DELETE → 다시 받기),
// 빈 화면, 열기(공유 정보 조회 → 미리보기 / 비밀번호면 공유 화면으로), 사이드바 입구와 개수를 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { DriveSidebar } from '@/components/drive/DriveSidebar'
import { renderScreen } from '@/test/renderScreen'
import type { SharedWithMeItem } from '@/types/drive'

import { DriveSharedWithMeView } from './DriveSharedWithMeView'

const openItem: SharedWithMeItem = {
  shareLinkId: 11,
  kind: 'FILE',
  name: '2026 하반기 사업계획.pptx',
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  sizeBytes: 4_404_019,
  spaceName: '경영지원',
  sharedBy: '김민수',
  lastOpenedAt: '2026-11-12T03:00:00Z',
  openable: true,
  hasPassword: false,
  token: 'sl_open',
}

const closedItem: SharedWithMeItem = {
  ...openItem,
  shareLinkId: 12,
  name: '10월 행사 사진.zip',
  sharedBy: '최유나',
  openable: false,
  token: null,
}

/** 목록 GET(현재 상태를 돌려준다)·DELETE(지운 id 를 모으고 목록에서 뺀다). */
function listHandlers(initial: SharedWithMeItem[]) {
  const state = { items: [...initial], deleted: [] as number[] }
  return {
    state,
    handlers: [
      http.get('/api/v1/drive/shared-with-me', () => HttpResponse.json(state.items)),
      http.delete('/api/v1/drive/shared-with-me/:id', ({ params }) => {
        const id = Number(params.id)
        state.deleted.push(id)
        state.items = state.items.filter((i) => i.shareLinkId !== id)
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  }
}

describe('공유받은 항목 화면', () => {
  test('행마다 이름·공간·크기·공유한 사람·마지막으로 연 날을 보인다', async () => {
    const { handlers } = listHandlers([openItem])
    renderScreen(<DriveSharedWithMeView />, { path: '/drive/shared', handlers })

    const row = await screen.findByTestId('drive-shared-row-11')
    expect(within(row).getByRole('button', { name: '2026 하반기 사업계획.pptx' })).toBeInTheDocument()
    expect(within(row).getByTestId('drive-shared-meta-11')).toHaveTextContent('경영지원 · 4.2 MB')
    expect(within(row).getAllByText('김민수').length).toBeGreaterThan(0)
    expect(row).toHaveAttribute('data-openable', 'true')
    expect(within(row).queryByText('열 수 없음')).not.toBeInTheDocument()
  })

  test('열 수 없는 행은 「열 수 없음」 배지와 안내 둘째 줄, 메뉴는 빼기만 된다', async () => {
    const { handlers } = listHandlers([closedItem])
    const { user } = renderScreen(<DriveSharedWithMeView />, { path: '/drive/shared', handlers })

    const row = await screen.findByTestId('drive-shared-row-12')
    expect(row).toHaveAttribute('data-openable', 'false')
    expect(within(row).getByTestId('drive-shared-closed-12')).toHaveTextContent('열 수 없음')
    expect(within(row).getByTestId('drive-shared-meta-12')).toHaveTextContent('링크가 폐기됐거나 만료됐습니다')
    // 이름은 눌러 열 수 있는 단추가 아니다
    expect(within(row).queryByRole('button', { name: '10월 행사 사진.zip' })).not.toBeInTheDocument()

    await user.click(within(row).getByTestId('drive-shared-menu-12'))
    expect(await screen.findByTestId('drive-shared-action-open')).toHaveAttribute('data-disabled')
    expect(screen.getByTestId('drive-shared-action-copy')).toHaveAttribute('data-disabled')
    expect(screen.getByTestId('drive-shared-action-remove')).not.toHaveAttribute('data-disabled')
  })

  test('링크는 살아 있지만 토큰을 되살리지 못한 행은 「링크를 열 수 없습니다」로 보인다', async () => {
    const { handlers } = listHandlers([{ ...openItem, shareLinkId: 14, token: null }])
    renderScreen(<DriveSharedWithMeView />, { path: '/drive/shared', handlers })

    const row = await screen.findByTestId('drive-shared-row-14')
    expect(row).toHaveAttribute('data-openable', 'false')
    expect(within(row).getByTestId('drive-shared-meta-14')).toHaveTextContent('링크를 열 수 없습니다')
    expect(within(row).getByTestId('drive-shared-meta-14')).not.toHaveTextContent('폐기')
  })

  test('목록에서 빼기는 DELETE 를 보내고 목록을 다시 받아 행이 사라진다', async () => {
    const { handlers, state } = listHandlers([openItem, closedItem])
    const { user } = renderScreen(<DriveSharedWithMeView />, { path: '/drive/shared', handlers })

    await user.click(await screen.findByTestId('drive-shared-menu-12'))
    await user.click(await screen.findByTestId('drive-shared-action-remove'))

    await waitFor(() => expect(screen.queryByTestId('drive-shared-row-12')).not.toBeInTheDocument())
    expect(state.deleted).toEqual([12])
    expect(screen.getByTestId('drive-shared-row-11')).toBeInTheDocument()
    expect(await screen.findByText('목록에서 뺐습니다')).toBeInTheDocument()
  })

  test('비었으면 빈 화면 안내를 보인다', async () => {
    const { handlers } = listHandlers([])
    renderScreen(<DriveSharedWithMeView />, { path: '/drive/shared', handlers })

    const empty = await screen.findByTestId('drive-shared-empty')
    expect(within(empty).getByText('공유받은 항목이 없습니다')).toBeInTheDocument()
    expect(within(empty).getByText('사내 공유 링크를 열면 여기에 모입니다.')).toBeInTheDocument()
  })

  test('열기는 링크로 공유 정보를 다시 묻고 미리보기를 띄운다 — 비밀번호 링크는 묻지 않고 공유 화면으로 넘긴다', async () => {
    const pwItem: SharedWithMeItem = { ...openItem, shareLinkId: 13, name: '비밀.pdf', hasPassword: true, token: 'sl_pw' }
    const infoCalls: string[] = []
    const { handlers } = listHandlers([openItem, pwItem])
    const { user, location } = renderScreen(<DriveSharedWithMeView />, {
      path: '/drive/shared',
      handlers: [
        ...handlers,
        http.get('/api/v1/public/drive/share/:token', ({ params }) => {
          infoCalls.push(String(params.token))
          if (params.token === 'sl_pw') return HttpResponse.json({ passwordRequired: true, loginRequired: false })
          return HttpResponse.json({
            passwordRequired: false,
            loginRequired: false,
            name: openItem.name,
            mimeType: openItem.mimeType,
            sizeBytes: openItem.sizeBytes,
            sharedBy: '김민수',
            loginAvailable: false,
            driveOpen: null,
          })
        }),
        http.get('/api/v1/public/drive/share/:token/preview', () => HttpResponse.json({ status: 'PENDING' }, { status: 202 })),
      ],
    })

    await user.click(await screen.findByRole('button', { name: '2026 하반기 사업계획.pptx' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(infoCalls).toEqual(['sl_open'])

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '비밀.pdf' }))
    await waitFor(() => expect(location()).toBe('/s/sl_pw'))
    // 비밀번호 링크는 정보를 묻지 않고 바로 넘긴다
    expect(infoCalls).toEqual(['sl_open'])
  })
})

describe('드라이브 사이드바 입구', () => {
  test('공간 목록 위에 「공유받은 항목」과 개수를 보이고 누르면 목록으로 간다', async () => {
    const { user, location } = renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: [
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json([])),
        http.get('/api/v1/drive/shared-with-me', () => HttpResponse.json([openItem, closedItem])),
      ],
    })

    const entry = await screen.findByTestId('drive-nav-shared')
    expect(entry).toHaveTextContent('공유받은 항목')
    expect(await within(entry).findByTestId('drive-nav-shared-count')).toHaveTextContent('2')
    // 「공간」 섹션보다 앞(DOM 순서)
    const spacesLabel = screen.getByText('공간')
    expect(entry.compareDocumentPosition(spacesLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(entry)
    await waitFor(() => expect(location()).toBe('/drive/shared'))
  })

  test('공유받은 항목이 없으면 개수를 보이지 않는다', async () => {
    renderScreen(<DriveSidebar />, {
      path: '/drive/spaces/1',
      handlers: [
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
        http.get('/api/v1/drive/spaces', () => HttpResponse.json([])),
        http.get('/api/v1/drive/shared-with-me', () => HttpResponse.json([])),
      ],
    })
    await screen.findByTestId('drive-nav-shared')
    await waitFor(() => expect(screen.queryByTestId('drive-nav-shared-count')).not.toBeInTheDocument())
  })
})
