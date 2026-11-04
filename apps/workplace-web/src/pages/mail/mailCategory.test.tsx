// 메일 분류 직접 바꾸기(WP-1341) — 데스크톱 화면 테스트.
// 상세 동작 줄의 「분류」 메뉴(현재 분류 ✓·AI 분류로 되돌리기), 보낸편지함·서버 메일함 보기에서 숨김,
// PUT 본문·바꾼 직후 토스트와 되돌리기, 학습(learn) 결과 토스트와 [기억 취소](CREATE → 지우기 · UPDATE → 이전 문장),
// 목록 배지의 사람 아이콘(직접 바꾼 분류만)을 본다. 브라우저 없이 판정되므로 vitest 로 둔다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」).
// 휴대폰 시트는 뷰포트가 달라 mailCategoryMobile.test.tsx 에 둔다(한 파일 한 뷰포트).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { EmailMessageDetail, EmailMessageSummary } from '@/types/mailMessage'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

const LIST = '/api/v1/mail/accounts/1/messages'
const PUT_CATEGORY = '/api/v1/mail/messages/10/category'
const LEARN = '/api/v1/mail/messages/10/category/learn'

type CategoryBody = { category: string | null }
type LearnBody = { fromCategory: string | null; toCategory: string }

/** 메일 10 한 통을 목록·상세로 준다. 상세의 분류(유효 분류·직접 바꿈)는 테스트마다 다르다. */
function mailHandlers(det: Partial<EmailMessageDetail>, row: Partial<EmailMessageSummary> = {}) {
  return [
    http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, aiCategory: det.aiCategory ?? null, ...row })])),
    http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, ...det }))),
  ]
}

/** PUT 분류 — 응답은 바꾼 값(되돌리면 원래 AI 분류 '업무'), learnable 은 인자로. */
function putCategory(learnable = false) {
  return record<CategoryBody>('put', PUT_CATEGORY, ({ body }) =>
    HttpResponse.json({
      aiCategory: body.category ?? '업무',
      categoryByMe: body.category != null,
      learnable: learnable && body.category != null,
    }),
  )
}

/** 상세 동작 줄의 분류 메뉴를 연다. */
async function openCategoryMenu(user: ReturnType<typeof renderMail>['user']) {
  await user.click(await screen.findByTestId('mail-category'))
  return screen.findByTestId('mail-category-menu')
}

test('shows category menu with current category checked in detail actions', async () => {
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [
      ...mailHandlers({ aiCategory: '업무', categoryByMe: false }),
      // 옮길 메일함이 있어야 「옮기기」가 보인다.
      http.get('/api/v1/mail/accounts/1/folders', () =>
        HttpResponse.json([mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE' }), mailServerFolder({ id: 5, displayName: '프로젝트' })]),
      ),
    ],
  })
  const trigger = await screen.findByTestId('mail-category')
  expect(trigger).toHaveTextContent('분류: 업무')
  await screen.findByTestId('mail-move')
  // 「옮기기」 뒤에 둔다.
  expect(screen.getByTestId('mail-move').compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const menu = await openCategoryMenu(user)
  expect(within(menu).getByText('분류 바꾸기 · 나에게만 적용')).toBeInTheDocument()
  const items = within(menu).getAllByRole('menuitemcheckbox')
  expect(items.map((i) => i.textContent)).toEqual(['업무', '개인', '알림', '프로모션', '뉴스레터'])
  expect(items[0]).toHaveAttribute('aria-checked', 'true')
  expect(items.slice(1).every((i) => i.getAttribute('aria-checked') === 'false')).toBe(true)
})

test('shows 「분류」 when the mail has no category', async () => {
  renderMail('/mail/1?messageId=10', { handlers: mailHandlers({ aiCategory: null, categoryByMe: false }) })
  const trigger = await screen.findByTestId('mail-category')
  expect(trigger.textContent?.trim()).toBe('분류')
})

test('hides category menu in sent folder and server-folder view', async () => {
  const sent = renderMail('/mail/1?folder=sent&messageId=10', { handlers: mailHandlers({ aiCategory: '업무' }) })
  expect(await screen.findByTestId('mail-detail')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-category')).not.toBeInTheDocument()
  sent.unmount()

  renderMail('/mail/1?box=5&messageId=10', {
    handlers: [
      ...mailHandlers({ aiCategory: '업무' }),
      http.get('/api/v1/mail/accounts/1/folders', () => HttpResponse.json([mailServerFolder({ id: 5, displayName: '프로젝트' })])),
      http.post('/api/v1/mail/accounts/1/folders/5/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  expect(await screen.findByTestId('mail-detail')).toBeInTheDocument()
  // 옮기기는 보이는 보기 — 분류만 없다.
  expect(screen.getByTestId('mail-move')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-category')).not.toBeInTheDocument()
})

test('calls setMailCategory and shows change toast with undo', async () => {
  const put = putCategory(false)
  const learn = record<LearnBody>('post', LEARN)
  const det = record('get', '/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, aiCategory: '업무', categoryByMe: false })))
  const lists = record('get', LIST, () => HttpResponse.json([summary({ id: 10, seen: true, aiCategory: '업무' })]))
  const { user } = renderMail('/mail/1?messageId=10', { handlers: [put.handler, learn.handler, det.handler, lists.handler] })
  const menu = await openCategoryMenu(user)
  const detailsBefore = det.calls.length
  const listsBefore = lists.calls.length
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' }))
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ category: '프로모션' })
  // 받침 없는 말에는 「로」, 받침 있는 말에는 「으로」 — 프로모션 → 「프로모션으로」.
  expect(await screen.findByText('분류를 프로모션으로 바꿨어요')).toBeInTheDocument()
  // 목록은 다시 받고(분류 보기에서 빠지게), 상세는 다시 받지 않고 PUT 응답으로 메뉴 글자를 바로 바꾼다(WP-1346).
  await waitFor(() => expect(lists.calls.length).toBeGreaterThan(listsBefore))
  expect(screen.getByTestId('mail-category')).toHaveTextContent('분류: 프로모션')
  expect(det.calls.length).toBe(detailsBefore)
  // learnable=false 면 학습을 부르지 않는다.
  expect(learn.calls).toHaveLength(0)
  // 되돌리기 — 직접 분류가 없던 메일이라 null(AI 분류)로 다시 저장한다.
  await user.click(screen.getByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ category: null })
})

test('undo restores previous user category', async () => {
  const put = putCategory(false)
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, ...mailHandlers({ aiCategory: '개인', categoryByMe: true }, { categoryByMe: true })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '뉴스레터' }))
  expect(await screen.findByText('분류를 뉴스레터로 바꿨어요')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ category: '개인' })
})

test('shows memory toast and cancels created memory via delete', async () => {
  const put = putCategory(true)
  const content = '원티드(wantedlab.com) 채용 소식 메일은 업무가 아니라 프로모션으로 분류'
  const learn = record<LearnBody>('post', LEARN, () =>
    HttpResponse.json({ action: 'CREATE', memoryId: 7, content, previousContent: null }),
  )
  const del = record('delete', '/api/v1/users/me/ai-memories/7', () =>
    HttpResponse.json({ id: 7, kind: 'PREFERENCE', content, scope: 'MAIL', expiresOn: null, expired: false }),
  )
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, learn.handler, del.handler, ...mailHandlers({ aiCategory: '업무', categoryByMe: false })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' }))
  await waitFor(() => expect(learn.calls).toHaveLength(1))
  // 바꾸기 전 유효 분류 → 바꾼 분류.
  expect(learn.last().body).toEqual({ fromCategory: '업무', toCategory: '프로모션' })
  expect(await screen.findByText(`AI 비서가 기억했어요: ${content}`)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '기억 취소' }))
  await waitFor(() => expect(del.calls).toHaveLength(1))
})

test('cancel restores previous content when memory was updated', async () => {
  const put = putCategory(true)
  const learn = record<LearnBody>('post', LEARN, () =>
    HttpResponse.json({ action: 'UPDATE', memoryId: 3, content: '원티드 메일은 프로모션으로 분류', previousContent: '원티드 메일은 뉴스레터로 분류' }),
  )
  const patch = record<{ content: string }>('patch', '/api/v1/users/me/ai-memories/3', () =>
    HttpResponse.json({ id: 3, kind: 'PREFERENCE', content: '원티드 메일은 뉴스레터로 분류', scope: 'MAIL', expiresOn: null, expired: false }),
  )
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, learn.handler, patch.handler, ...mailHandlers({ aiCategory: '뉴스레터', categoryByMe: false })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' }))
  expect(await screen.findByText('AI 비서가 기억했어요: 원티드 메일은 프로모션으로 분류')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '기억 취소' }))
  await waitFor(() => expect(patch.calls).toHaveLength(1))
  expect(patch.last().body).toEqual({ content: '원티드 메일은 뉴스레터로 분류' })
})

test('shows no memory toast when learn says NONE or returns 204', async () => {
  const put = putCategory(true)
  let n = 0
  const learn = record<LearnBody>('post', LEARN, () => {
    n += 1
    return n === 1
      ? HttpResponse.json({ action: 'NONE', memoryId: null, content: null, previousContent: null })
      : new HttpResponse(null, { status: 204 })
  })
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, learn.handler, ...mailHandlers({ aiCategory: '업무', categoryByMe: false })],
  })
  let menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '알림' }))
  await waitFor(() => expect(learn.calls).toHaveLength(1))
  menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '개인' }))
  await waitFor(() => expect(learn.calls).toHaveLength(2))
  expect(await screen.findByText('분류를 개인으로 바꿨어요')).toBeInTheDocument()
  expect(screen.queryByText(/AI 비서가 기억했어요/)).not.toBeInTheDocument()
})

test('shows revert item only when categoryByMe', async () => {
  const put = putCategory(false)
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, ...mailHandlers({ aiCategory: '프로모션', categoryByMe: true }, { categoryByMe: true })],
  })
  const menu = await openCategoryMenu(user)
  expect(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' })).toHaveAttribute('aria-checked', 'true')
  await user.click(within(menu).getByRole('menuitem', { name: 'AI 분류로 되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ category: null })
})

test('hides revert item when the category is not set by me', async () => {
  const { user } = renderMail('/mail/1?messageId=10', { handlers: mailHandlers({ aiCategory: '프로모션', categoryByMe: false }) })
  const menu = await openCategoryMenu(user)
  expect(within(menu).queryByText('AI 분류로 되돌리기')).not.toBeInTheDocument()
})

test('shows person icon on list badge only when categoryByMe', async () => {
  renderMail('/mail/1', {
    handlers: [
      http.get(LIST, () =>
        HttpResponse.json([
          // 기본 보기(업무)에서는 WP-1348 로 「업무」 배지를 줄마다 붙이지 않으므로 다른 분류로 확인한다.
          summary({ id: 10, aiCategory: '프로모션', categoryByMe: true }),
          summary({ id: 11, aiCategory: '뉴스레터', categoryByMe: false }),
        ]),
      ),
    ],
  })
  const mine = await screen.findByTestId('mail-badge-category-10')
  expect(mine).toHaveAttribute('title', '내가 정한 분류')
  expect(within(mine).getByTestId('mail-badge-by-me-10')).toBeInTheDocument()
  expect(mine).toHaveTextContent('프로모션')
  const ai = screen.getByTestId('mail-badge-category-11')
  expect(ai).not.toHaveAttribute('title')
  expect(within(ai).queryByTestId('mail-badge-by-me-11')).not.toBeInTheDocument()
})

test('picking the current category is a no-op (no PUT, no toast)', async () => {
  const put = putCategory(true)
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, ...mailHandlers({ aiCategory: '업무', categoryByMe: false })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '업무' }))
  // 메뉴는 닫히지만 저장·알림은 없다.
  await waitFor(() => expect(screen.queryByTestId('mail-category-menu')).not.toBeInTheDocument())
  expect(put.calls).toHaveLength(0)
  expect(screen.queryByText(/분류를 .* 바꿨어요/)).not.toBeInTheDocument()
})

test('undo after learning also deletes the created memory and dismisses the memory toast', async () => {
  const put = putCategory(true)
  const content = '원티드 채용 소식 메일은 프로모션으로 분류'
  const learn = record<LearnBody>('post', LEARN, () =>
    HttpResponse.json({ action: 'CREATE', memoryId: 7, content, previousContent: null }),
  )
  const del = record('delete', '/api/v1/users/me/ai-memories/7', () =>
    HttpResponse.json({ id: 7, kind: 'PREFERENCE', content, scope: 'MAIL', expiresOn: null, expired: false }),
  )
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, learn.handler, del.handler, ...mailHandlers({ aiCategory: '업무', categoryByMe: false })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' }))
  expect(await screen.findByText(`AI 비서가 기억했어요: ${content}`)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ category: null })
  await waitFor(() => expect(del.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByText(`AI 비서가 기억했어요: ${content}`)).not.toBeInTheDocument())
})

test('undo while learning is in flight reverts the late memory silently', async () => {
  const put = putCategory(true)
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const learn = record<LearnBody>('post', LEARN, async () => {
    await gate
    return HttpResponse.json({
      action: 'UPDATE',
      memoryId: 3,
      content: '원티드 메일은 프로모션으로 분류',
      previousContent: '원티드 메일은 뉴스레터로 분류',
    })
  })
  const patch = record<{ content: string }>('patch', '/api/v1/users/me/ai-memories/3', () =>
    HttpResponse.json({ id: 3, kind: 'PREFERENCE', content: '원티드 메일은 뉴스레터로 분류', scope: 'MAIL', expiresOn: null, expired: false }),
  )
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [put.handler, learn.handler, patch.handler, ...mailHandlers({ aiCategory: '뉴스레터', categoryByMe: false })],
  })
  const menu = await openCategoryMenu(user)
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '프로모션' }))
  await waitFor(() => expect(learn.calls).toHaveLength(1))
  // 학습 응답이 오기 전에 되돌린다.
  await user.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(2))
  release()
  // 늦게 온 학습 결과는 알림 없이 이전 문장으로 되돌린다.
  await waitFor(() => expect(patch.calls).toHaveLength(1))
  expect(patch.last().body).toEqual({ content: '원티드 메일은 뉴스레터로 분류' })
  expect(screen.queryByText(/AI 비서가 기억했어요/)).not.toBeInTheDocument()
})
