// WP-1786 임시보관 딥링크 — 메일 보내기 실패 알림이 보낸 /mail?draftId=N 을 받아 그 임시보관을 쓰기 창으로 열고 주소에서 키를 뗀다.
// 쓰기 창 열기(useOpenMailDraft)는 가로채 무엇을 여는지만 본다 — 여는 규칙 자체는 mailDrafts.test.tsx 가 지킨다.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openDraft = vi.fn()
vi.mock('@/hooks/queries/useMailDrafts', () => ({ useOpenMailDraft: () => openDraft }))

const { MailDraftDeepLink } = await import('./MailDraftDeepLink')

/** 지금 주소를 그린다 — 테스트가 읽는다. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

/** 그려진 지금 주소. */
const current = () => screen.getByTestId('loc').textContent

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <MailDraftDeepLink />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  openDraft.mockReset()
})

describe('MailDraftDeepLink', () => {
  it('메일 화면의 ?draftId=N → 그 임시보관을 한 번 열고, 주소에서 draftId 만 뗀다', async () => {
    renderAt('/mail/1?folder=drafts&draftId=42')
    await waitFor(() => expect(current()).toBe('/mail/1?folder=drafts'))
    expect(openDraft).toHaveBeenCalledTimes(1)
    expect(openDraft).toHaveBeenCalledWith(42)
  })

  it('/mail?draftId=N(계정 없는 주소)도 받는다', async () => {
    renderAt('/mail?draftId=7')
    await waitFor(() => expect(current()).toBe('/mail'))
    expect(openDraft).toHaveBeenCalledWith(7)
  })

  it('메일 화면이 아니거나 값이 이상하면 열지 않고 주소도 그대로 둔다', async () => {
    renderAt('/projects?draftId=7')
    await waitFor(() => expect(current()).toBe('/projects?draftId=7'))
    cleanup()
    renderAt('/mail?draftId=abc')
    await waitFor(() => expect(current()).toBe('/mail?draftId=abc'))
    expect(openDraft).not.toHaveBeenCalled()
  })
})
