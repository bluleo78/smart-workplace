// WP-1743 읽기 창 자리에서 바로 쓰기 — 「읽기 창으로」/「우측 하단으로」 전환을 판정하는 페이지 테스트.
// 포털 없이 useLayoutEffect + appendChild 로 호스트 DOM 을 슬롯(읽기 자리)과 주차 칸 사이로 옮기므로,
// 테스트는 (1) 전후에 같은 편집기 노드(contenteditable)가 살아 있는가, (2) 호스트가 어디에 붙어 있는가,
// (3) 뒤 화면이 잠기지 않는가(대화상자·inert 없음) 를 나란히 본다.
// 화면은 testkit-b4 renderMail — 메일 모듈 + 작성 도크가 같이 뜬다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { forgetMailComposePopout } from '@/lib/mailComposeChannel'
import { composeHostEl as hostEl, openReplyWithBody, paneDetailHandlers, paneMessages, paneSlotEl as slotEl } from '@/test/kits/mail/compose-pane'
import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { MailDraftSaveRequest } from '@/types/mailDraft'

// window.open 스텁(새 창 전환 테스트)이 다음 테스트로 새지 않게 되돌린다.
afterEach(() => {
  vi.restoreAllMocks()
})

/** 원문 2통(5·6)이 있는 메일함 — 왼쪽 목록에서 다른 행을 고르는 시나리오에 쓴다. */
function withMessages(extra: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = []) {
  return renderMail('/mail/1', { messages: paneMessages, handlers: [...extra, ...paneDetailHandlers()] })
}

test('「읽기 창으로」 를 누르면 읽기 자리에서 쓰던 본문과 편집기가 그대로다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '읽기 창으로 옮겨도 남는 본문')
  const before = document.querySelectorAll('[contenteditable="true"]')
  expect(before).toHaveLength(1)

  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))

  // 호스트가 읽기 자리 슬롯 안으로 옮겨 붙었다(디폴트 주차 칸 아님).
  const slot = slotEl()
  const host = hostEl()
  expect(slot).not.toBeNull()
  expect(host).not.toBeNull()
  expect(slot!.contains(host!)).toBe(true)
  // 재마운트가 아니라 같은 노드 — 전후에 contenteditable 이 하나이고 그 노드가 같다.
  const after = document.querySelectorAll('[contenteditable="true"]')
  expect(after).toHaveLength(1)
  expect(after[0]).toBe(before[0])
  expect(before[0]).toHaveTextContent('읽기 창으로 옮겨도 남는 본문')
  // 첨부·AI 단추 영역도 슬롯 안(읽기 자리)에 있다 — 호스트 전체가 함께 움직인다.
  expect(slot!.contains(screen.getByTestId('mail-compose-attach'))).toBe(true)
  expect(slot!.contains(screen.getByTestId('mail-review-tab'))).toBe(true)
})

test('읽기 창에서는 뒤를 잠그지 않아 왼쪽 목록을 누를 수 있다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '뒤를 잠그지 않은 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  expect(hostEl()!.closest('[data-testid="mail-compose-pane-slot"]')).not.toBeNull()
  // 대화상자도 뒤 화면 inert 도 없다 — 페이지 일부라 뒤를 잠그지 않는다.
  // (페이지 영역 inert 판정 — 브레드크럼의 고정 aria-hidden·inert 복제본 같은 무관 요소는 빼고,
  //  작성창이 inert 로 만드는 대상([data-ai-page-root] 직접 자식)이 잠겼는지만 본다.)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.querySelector('[data-ai-page-root] > [inert]')).toBeNull()

  // 왼쪽 목록의 다른 행을 누른다 — 선택이 바뀌고 작성창은 접힌다.
  const host = hostEl()!
  await view.user.click(await screen.findByTestId('mail-row-6'))
  await waitFor(() => expect(view.location()).toContain('messageId=6'))
  expect(host.parentElement).toHaveAttribute('data-compose-parking')
  // 바뀐 선택의 메일 상세가 다시 그 자리를 채운다.
  expect(await screen.findByRole('heading', { level: 2, name: '두 번째 메일' })).toBeInTheDocument()
})

test('「우측 하단으로」 를 누르면 우측 하단으로 되돌아오고 본문이 남는다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '우측 하단으로 되돌려도 남는 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  await view.user.click(screen.getByRole('button', { name: '우측 하단으로' }))

  // 주차 칸으로 되돌아왔다(우측 하단 도크).
  const host = hostEl()!
  expect(host.parentElement).toHaveAttribute('data-compose-parking')
  // 쓰던 본문은 그대로다(최소화로 숨었을 뿐 편집기·글은 남는다).
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('우측 하단으로 되돌려도 남는 본문')
  // 읽기 자리에는 메일 상세가 다시 보인다.
  expect(await screen.findByRole('heading', { level: 2, name: '첫 번째 메일' })).toBeInTheDocument()
})

test('읽기 창에서 「새 창으로 열기」 를 누르면 임시저장 뒤 새 창으로 옮기고 읽기 자리에 작성창이 남지 않는다', async () => {
  // 실제 창이 없는 jsdom — 주소 설정·닫기만 보는 가짜 창(mailComposePopout.test.tsx 와 같은 방식).
  const win = { location: { href: '' }, close: vi.fn(), closed: false, focus: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 101, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = withMessages([post.handler])
  // 원문(5)을 열어 둔 채 새 메일을 쓴다 — 새 창으로 옮긴 뒤 읽기 자리에 그 상세가 돌아오는지 본다.
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await screen.findByRole('heading', { level: 2, name: '첫 번째 메일' })
  await view.user.click(screen.getByTestId('mail-compose-new'))
  await view.user.click(await screen.findByRole('button', { name: '읽기 창으로' }))
  expect(slotEl()!.contains(hostEl()!)).toBe(true)
  expect(screen.queryByRole('heading', { level: 2, name: '첫 번째 메일' })).toBeNull()

  // 읽기 창에서도 같은 ↗ 단추가 기존 팝아웃 흐름(클릭에서 빈 창 열기 → 강제 임시저장 → 주소 지정)을 그대로 탄다.
  await view.user.click(screen.getByRole('button', { name: '새 창으로 열기' }))
  expect(open).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(win.location.href).toMatch(/^\/mail\/compose\?draftId=101&/))
  forgetMailComposePopout(101)
  expect(post.calls).toHaveLength(1)
  expect(post.calls[0].body).toMatchObject({ accountId: 1, mode: 'new' })

  // 작성창은 닫히고 읽기 자리(슬롯)에는 아무것도 남지 않는다 — 편집기도 사라졌다.
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  // 호스트 div 는 늘 있는 빈 껍데기(display: contents)라, 그 안에 작성창 내용이 하나도 없는지를 본다.
  expect(hostEl()!.childElementCount).toBe(0)
  expect(slotEl()!.querySelector('[data-testid^="mail-compose"]')).toBeNull()
  expect(document.querySelector('[contenteditable="true"]')).toBeNull()
  // 읽기 자리에는 열어 둔 메일 상세가 다시 보인다 — 빈 읽기 자리가 남지 않는다.
  expect(await screen.findByRole('heading', { level: 2, name: '첫 번째 메일' })).toBeInTheDocument()
  expect(win.close).not.toHaveBeenCalled()
})

test('우측 하단에서 붙인 첨부는 읽기 창으로 옮겼다 되돌려도 그대로 남는다', async () => {
  const upload = http.post('/api/v1/mail/compose-attachments', () =>
    HttpResponse.json({ id: 501, name: '보고서.pdf', size: 15, mimeType: 'application/pdf', expiresAt: '2026-10-21T10:00:00Z' }, { status: 201 }),
  )
  const view = withMessages([upload])
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  await view.user.upload(
    screen.getByTestId('mail-compose-file-input') as HTMLInputElement,
    new File(['PDF-CONTENT-123'], '보고서.pdf', { type: 'application/pdf' }),
  )
  // 칩 요소(data-status 가 있는 것만) — 업로드가 끝나 완료 칩이 된다.
  const chips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="mail-compose-attachment-"][data-status]'))
  await waitFor(() => expect(chips().map((c) => c.getAttribute('data-status'))).toEqual(['done']))
  const chip = chips()[0]
  expect(chip).toHaveTextContent('보고서.pdf')

  // 읽기 창으로 — 칩이 같은 노드 그대로 읽기 자리 안에 있다(다시 만들지 않았다).
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  expect(slotEl()!.contains(hostEl()!)).toBe(true)
  expect(chips()).toHaveLength(1)
  expect(chips()[0]).toBe(chip)
  expect(slotEl()!.contains(chip)).toBe(true)
  expect(chip).toHaveAttribute('data-status', 'done')

  // 우측 하단으로 — 주차 칸으로 돌아와도 같은 칩이 완료 상태로 남는다.
  await view.user.click(screen.getByRole('button', { name: '우측 하단으로' }))
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  expect(chips()).toHaveLength(1)
  expect(chips()[0]).toBe(chip)
  expect(chip).toHaveAttribute('data-status', 'done')
  expect(chip).toHaveTextContent('보고서.pdf')
  expect(screen.getByTestId('mail-compose-attachments-total')).toHaveTextContent('첨부 1개')
})

test('읽기 창 패널은 끌어다 놓기 겹침의 위치 기준(relative)이 된다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '겹침 기준 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  // MailComposeDropOverlay(absolute inset-0)가 패널을 채우려면 패널이 위치 기준이어야 한다.
  expect(screen.getByTestId('mail-compose-dock')).toHaveClass('relative')
})

test('본문에 포커스를 둔 채 읽기 창으로 옮기면 포커스가 본문 편집기에 남는다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '포커스가 남는 본문')
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
  expect(editor.contains(document.activeElement)).toBe(true)

  // 단축키처럼 포커스를 옮기지 않는 경로를 흉내 낸다 — fireEvent 는 단추로 포커스를 옮기지 않는다.
  fireEvent.click(screen.getByRole('button', { name: '읽기 창으로' }))
  await waitFor(() => expect(slotEl()!.contains(hostEl()!)).toBe(true))
  expect(editor.contains(document.activeElement)).toBe(true)
})

test('읽기 창과 우측 하단을 오가도 메일 상세는 다시 만들지 않고 같은 노드가 남는다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '상세 유지 본문')
  const heading = screen.getByRole('heading', { level: 2, name: '첫 번째 메일' })

  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  // 읽기 창 작성 중엔 상세가 보이지 않는다(감춰졌을 뿐).
  expect(screen.queryByRole('heading', { level: 2, name: '첫 번째 메일' })).toBeNull()

  await view.user.click(screen.getByRole('button', { name: '우측 하단으로' }))
  const after = await screen.findByRole('heading', { level: 2, name: '첫 번째 메일' })
  expect(after).toBe(heading)
})

test('읽기 창 작성 중 선택이 풀리기만 하면(뒤로 가기) 접지 않는다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '선택 해제에도 남는 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  expect(slotEl()!.contains(hostEl()!)).toBe(true)

  // 브라우저 뒤로 — 메일 선택(messageId)이 풀려 selectedId 가 null 이 된다. 다른 메일을 고른 것이 아니다.
  act(() => window.history.back())
  await waitFor(() => expect(view.location()).not.toContain('messageId='))
  // 작성창은 읽기 자리에 그대로 있다.
  expect(slotEl()!.contains(hostEl()!)).toBe(true)
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('선택 해제에도 남는 본문')
})

test('읽기 창과 우측 하단을 오가도 본문 스크롤 위치가 남는다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '스크롤이 남는 본문')
  // 작성창 본문 영역(받는사람~첨부를 담는 스크롤 칸).
  const scroller = () => screen.getByTestId('mail-compose-dock').querySelector<HTMLElement>('.overflow-y-auto')!
  // 브라우저처럼 노드를 옮길 때 하위 스크롤을 0 으로 잃게 하는 appendChild 대역(happy-dom 은 잃지 않는다 — NodeSlot.test 와 같은 방식).
  const realAppendChild = Node.prototype.appendChild
  Node.prototype.appendChild = function <T extends Node>(this: Node, child: T): T {
    if (child instanceof Element) child.querySelectorAll('*').forEach((el) => { el.scrollTop = 0 })
    return realAppendChild.call(this, child) as T
  }
  try {
    scroller().scrollTop = 240
    await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
    expect(slotEl()!.contains(hostEl()!)).toBe(true)
    expect(scroller().scrollTop).toBe(240)

    await view.user.click(screen.getByRole('button', { name: '우측 하단으로' }))
    expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
    expect(scroller().scrollTop).toBe(240)
  } finally {
    Node.prototype.appendChild = realAppendChild
  }
})
