// 메인 AI 채팅 멀티 세션(WP-190) — 대화를 옮겨도 생성이 이어지고, 목록·헤더·칩·입력창이 대화별 상태를 보여 준다.
import { expectStays } from '../fixtures/wait'
import { ask, msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A, TITLE_B, TITLE_C } from '../fixtures/ai-live-chat'
import { expect, test } from '../fixtures/auth.fixture'
import { trackRequests } from '../fixtures/requests'

test('A 답변 중 새 대화 B 를 물어도 A 는 끊기지 않고, 돌아가면 이어서 끝까지 보인다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  const panel = page.getByTestId('chat-panel')

  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '첫 문단입니다. ' })
  await expect(panel).toContainText('첫 문단입니다.')

  await page.getByTestId('chat-new-session').click()
  await expect(panel).not.toContainText(TITLE_A)
  await ask(page, live, TITLE_B)
  expect(live.starts.lastBody()).toMatchObject({ sessionId: null, query: TITLE_B })

  // 보이지 않는 A 에 델타가 도착한다.
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '둘째 문단입니다.' })
  // 부재 확인은 직후 단언으로는 실패할 수 없으므로(아직 렌더 전일 수 있다) 일정 시간 지켜본다.
  await expectStays(page, async () => (await panel.textContent())?.includes('둘째 문단입니다.') ?? false, false)

  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(panel).toContainText('첫 문단입니다. 둘째 문단입니다.')
  await expect(page.getByTestId('chat-stop')).toBeVisible() // A 는 아직 생성 중

  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(page.getByTestId('chat-stop')).toHaveCount(0)
  await expect(panel).toContainText('첫 문단입니다. 둘째 문단입니다.')
  await expectStays(page, live.cancels.count, 0) // 전환은 취소하지 않는다
  await expect(page.getByTestId('session-switch-guard')).toHaveCount(0)
})

test('■ 정지는 그 대화만 멈추고 취소 요청 1회, 다른 대화의 생성은 계속된다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  const panel = page.getByTestId('chat-panel')
  await ask(page, live, TITLE_A)
  await page.getByTestId('chat-new-session').click()
  await ask(page, live, TITLE_B)
  await live.push('delta', { correlationId: 'corr-b', sessionId: 's-b', text: 'B 부분 답변' })
  await page.getByTestId('chat-stop').click()
  await live.cancels.waitFor(1)
  expect(live.cancels.lastUrl()?.pathname).toBe(`/api/v1/ai/chat/${live.cid('corr-b')}`)

  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: 'A 는 계속' })
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(panel).toContainText('A 는 계속')
  await expectStays(page, live.cancels.count, 1)
})

test('패널을 닫으면 칩이 다른 대화의 생성·새 답변까지 모아 보여 준다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  const chip = page.getByTestId('chat-launcher')
  await ask(page, live, TITLE_A)
  await page.getByTestId('chat-new-session').click()
  await ask(page, live, TITLE_B)
  await live.push('done', { correlationId: 'corr-b', sessionId: 's-b', widgets: null }) // 보고 있던 B 는 끝
  await expect(chip).toHaveAttribute('data-ai-activity', 'idle') // 열려 있으면 idle
  await page.getByTestId('ai-panel-close').click()
  await expect(chip).toHaveAttribute('data-ai-activity', 'pending') // A 가 아직 생성 중
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(chip).toHaveAttribute('data-ai-activity', 'done')
  await expect(chip).toHaveAttribute('aria-label', 'AI 어시스턴트, 새 답변')
  // 다시 열었다 닫아도 A 는 아직 안 봤으므로 "새 답변" 유지 — A 를 열어야 풀린다.
  await chip.click()
  await page.getByTestId('ai-panel-close').click()
  await expect(chip).toHaveAttribute('data-ai-activity', 'done')
})

test('대화 목록 둘째 줄: 답변 생성 중 → 새 답변 → 열면 상대시간 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await page.getByTestId('chat-new-session').click()
  await ask(page, live, TITLE_B)
  await live.push('done', { correlationId: 'corr-b', sessionId: 's-b', widgets: null })

  await page.getByTestId('chat-session-switcher').click()
  const itemA = sessionItem(page, TITLE_A)
  const itemB = sessionItem(page, TITLE_B)
  await expect(itemA.getByTestId('chat-session-status')).toHaveText('답변 생성 중…')
  await expect(itemB.getByTestId('chat-session-status')).toHaveCount(0) // 보고 있던 B 는 새 답변 아님
  await expect(itemB).toContainText('1분 전')

  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(itemA.getByTestId('chat-session-status')).toHaveText('새 답변')
  await expect(itemA).toHaveAttribute('data-status', 'unseen')
  await expect(itemA.locator('.font-semibold')).toHaveText(TITLE_A)

  await itemA.getByTestId('chat-session-select').click()
  await page.getByTestId('chat-session-switcher').click()
  await expect(itemA.getByTestId('chat-session-status')).toHaveCount(0)
  await expect(itemA).toHaveAttribute('data-status', 'idle')
})

test('다른 대화가 답변 중·새 답변이면 헤더 대화 목록 버튼에 점과 접근 이름 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  const switcher = page.getByTestId('chat-session-switcher')
  await ask(page, live, TITLE_A)
  await expect(switcher.getByTestId('chat-session-switcher-dot')).toHaveCount(0) // 현재 대화 자신은 제외
  await page.getByTestId('chat-new-session').click()
  await expect(switcher.getByTestId('chat-session-switcher-dot')).toBeVisible()
  await expect(switcher).toHaveAttribute('aria-label', /다른 대화 답변 중$/)
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(switcher).toHaveAttribute('aria-label', /다른 대화에 새 답변$/)
  await switcher.click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(switcher.getByTestId('chat-session-switcher-dot')).toHaveCount(0)
})

test('생성 중인 대화 삭제는 중단 안내 후 취소 → 삭제 순으로 요청 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 2)])
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await page.getByTestId('chat-new-session').click()
  const deletes = trackRequests(page, 'DELETE', () => true)

  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-delete').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('삭제하면 진행 중인 답변도 중단돼요')
  await dialog.getByRole('button', { name: '삭제' }).click()
  await deletes.waitFor(2)
  expect(deletes.urls().map((u) => u.pathname)).toEqual([`/api/v1/ai/chat/${live.cid('corr-a')}`, '/api/v1/home/sessions/s-a'])
})

test('3개가 답변 중이면 4번째 대화는 안내와 함께 전송이 막히고, 하나가 끝나면 풀린다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.queueStart({ correlationId: 'corr-c', sessionId: 's-c' })
  live.setSessions([summary('s-c', TITLE_C, 1), summary('s-b', TITLE_B, 2), summary('s-a', TITLE_A, 3)])
  await openChatPanel(page)
  for (const t of [TITLE_A, TITLE_B, TITLE_C]) {
    await ask(page, live, t)
    await page.getByTestId('chat-new-session').click()
  }
  const notice = page.getByTestId('chat-limit-notice')
  const send = page.getByTestId('chat-panel').getByRole('button', { name: '보내기' })
  await expect(notice).toContainText('다른 대화 3개가 답변 중이에요. 하나가 끝나면 보낼 수 있어요.')
  await page.getByTestId('chat-input').fill('넷째 질문입니다')
  await expect(send).toBeDisabled()
  await page.getByTestId('chat-input').press('Enter')
  await expectStays(page, live.starts.count, 3)
  await expect(page.getByTestId('chat-input')).toHaveValue('넷째 질문입니다') // 입력은 가능·유지

  await notice.getByRole('button', { name: '대화 목록 보기' }).click()
  await expect(sessionItem(page, TITLE_A)).toBeVisible()
  await page.keyboard.press('Escape')

  await live.push('done', { correlationId: 'corr-c', sessionId: 's-c', widgets: null })
  await expect(notice).toHaveCount(0)
  await expect(send).toBeEnabled()
})

test('서버가 429 로 거절하면 상한 안내가 뜨고 질문은 입력창에 남는다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ status: 429 })
  await openChatPanel(page)
  // 다른 탭에서 3개가 돌고 있다 — 재동기화가 알려 준다.
  live.setActive([
    { sessionId: 's-x', correlationId: 'c-x', startedAt: '2026-10-05T00:00:00Z' },
    { sessionId: 's-y', correlationId: 'c-y', startedAt: '2026-10-05T00:00:00Z' },
    { sessionId: 's-z', correlationId: 'c-z', startedAt: '2026-10-05T00:00:00Z' },
  ])
  await ask(page, live, '보고서 요약해 줘')
  await expect(page.getByTestId('chat-limit-notice')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue('보고서 요약해 줘')
  await expect(page.getByTestId('chat-turn')).toHaveCount(0) // 낙관적 턴은 걷혔다
})

test('서버가 409 로 거절하면 "아직 답변 중" 토스트 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ status: 409 })
  live.setSessions([summary('s-a', TITLE_A, 2)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-panel')).toContainText('요약본입니다')
  await ask(page, live, '조금 더 짧게')
  await expect(page.getByText('이 대화는 아직 답변 중이에요')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue('조금 더 짧게')
})

test('■ 정지 → 부분 답변 아래 "중단됨", 새로고침 뒤 다시 열어도 유지 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '매출은 전 분기 대비' })
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-interrupted')).toHaveText('중단됨')
  // 서버 종결 전엔 같은 대화 전송을 막는다(R12).
  await page.getByTestId('chat-input').fill('이어서')
  await expect(page.getByTestId('chat-panel').getByRole('button', { name: '보내기' })).toBeDisabled()
  await live.push('cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' })
  await expect(page.getByTestId('chat-panel').getByRole('button', { name: '보내기' })).toBeEnabled()
  await expect(page.getByTestId('chat-interrupted')).toHaveCount(1)

  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '매출은 전 분기 대비', 'STOPPED')])
  await page.reload()
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-interrupted')).toHaveText('중단됨')
})

// 서버 시간 초과는 사용자 정지와 구분해 라이브에선 "시간 초과로 중단됨"(저장된 STOPPED 를 다시 열면 "중단됨" — 위 테스트).
test('오류·서버 타임아웃으로 끝난 답변은 "오류로 중단됨"/"시간 초과로 중단됨" (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '반쯤' })
  await live.push('error', { correlationId: 'corr-a', sessionId: 's-a', message: 'AI 구성 요청에 실패했어요.' })
  await expect(page.getByTestId('chat-interrupted')).toHaveText('오류로 중단됨')
  await page.getByTestId('chat-new-session').click()
  await ask(page, live, TITLE_B)
  await live.push('delta', { correlationId: 'corr-b', sessionId: 's-b', text: '오래 걸리는' })
  await live.push('cancelled', { correlationId: 'corr-b', sessionId: 's-b', reason: 'timeout' })
  await expect(page.getByTestId('chat-interrupted')).toHaveText('시간 초과로 중단됨')
  await expect(page.getByTestId('chat-stop')).toHaveCount(0)
})

test('새로고침 뒤 서버 생성 중 목록으로 상태를 복원하고, 끝나면 다시 읽어 보여 준다 (WP-190)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '2026-10-05T00:00:00Z' }])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A)])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await expect(sessionItem(page, TITLE_A).getByTestId('chat-session-status')).toHaveText('답변 생성 중…')
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-pending')).toBeVisible() // 자리표시
  await expect(page.getByTestId('chat-stop')).toBeVisible()

  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '중간 조각' }) // 이어보기 범위 밖 — 버린다
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '완성된 요약입니다')])
  live.setActive([])
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(page.getByTestId('chat-panel')).toContainText('완성된 요약입니다')
  await expect(page.getByTestId('chat-panel')).not.toContainText('중간 조각')
  await expect(page.getByTestId('chat-pending')).toHaveCount(0)
})

test('열어 둔 대화가 다른 창에서 답변을 시작하면 이유를 안내하고, 그 질문과 "답변 중" 을 이어받는다 (WP-266)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  await openChatPanel(page)
  const panel = page.getByTestId('chat-panel')
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(panel).toContainText('요약본입니다')

  // 다른 창이 같은 대화에 질문했다 — 이 창은 이벤트로 처음 안다. 이력 재조회가 끝나기 전엔 안내로 이유를 보인다.
  const release = live.holdMessages('s-a')
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다'), msg(3, 'USER', '다른 창에서 보낸 질문')])
  await live.push('delta', { correlationId: 'corr-o', sessionId: 's-a', text: '다른 창 답변' })
  const notice = page.getByTestId('chat-busy-elsewhere')
  await expect(notice).toHaveText('이 대화는 다른 창에서 답변 중이에요. 끝나면 보낼 수 있어요.')
  await page.getByTestId('chat-input').fill('나도 물어볼게')
  const send = panel.getByRole('button', { name: '보내기' })
  await expect(send).toBeDisabled()
  await expect(send).toHaveAttribute('aria-describedby', 'chat-busy-notice')

  release()
  await expect(panel).toContainText('다른 창에서 보낸 질문')
  await expect(page.getByTestId('chat-pending')).toBeVisible()
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  await expect(notice).toHaveCount(0)
  await expect(panel).not.toContainText('다른 창 답변') // 자리표시 — 중간 조각은 붙이지 않는다

  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다'),
    msg(3, 'USER', '다른 창에서 보낸 질문'), msg(4, 'ASSISTANT', '다른 창의 완성된 답변'),
  ])
  await live.push('done', { correlationId: 'corr-o', sessionId: 's-a', widgets: null })
  await expect(panel).toContainText('다른 창의 완성된 답변')
  await expect(page.getByTestId('chat-pending')).toHaveCount(0)
  await expect(send).toBeEnabled()
  await expect(page.getByTestId('chat-input')).toHaveValue('나도 물어볼게') // 입력은 막지 않았다
})

test('답변 중 SSE 가 다시 이어지면 받은 부분을 두고 안내하다가, 끝나면 전체 답변으로 바꾼다 (WP-265)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await openChatPanel(page)
  const panel = page.getByTestId('chat-panel')
  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '첫 문단입니다.' })
  await expect(panel).toContainText('첫 문단입니다.')

  live.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '2026-10-05T00:00:00Z' }]) // 재동기화 — 아직 생성 중
  await live.reconnect()
  const note = page.getByTestId('chat-reconnected')
  await expect(note).toHaveText('연결이 다시 이어졌어요 · 답변이 끝나면 전체를 불러와요')
  await expect(panel).toContainText('첫 문단입니다.') // 받은 부분은 지우지 않는다
  await expect(page.getByTestId('chat-stop')).toBeVisible()

  // 끊긴 사이 조각이 빠졌을 수 있어 이어 붙이지 않는다.
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: ' 이어진 조각' })
  await expectStays(page, async () => (await panel.textContent())?.includes('이어진 조각') ?? false, false)

  live.setActive([])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '첫 문단입니다. 끊긴 사이 조각까지 온전한 답변')])
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(panel).toContainText('첫 문단입니다. 끊긴 사이 조각까지 온전한 답변')
  await expect(note).toHaveCount(0)
  await expect(page.getByTestId('chat-stop')).toHaveCount(0)
})

test('대화를 열고 이력을 읽는 동안은 보내기를 막고, 이력이 오면 그 뒤에 이어 보낸다 (WP-268)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  await openChatPanel(page)
  const panel = page.getByTestId('chat-panel')
  const release = live.holdMessages('s-a')
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await page.getByTestId('chat-input').fill(TITLE_A)
  const send = panel.getByRole('button', { name: '보내기' })
  await expect(send).toBeDisabled()
  await page.getByTestId('chat-input').press('Enter') // Enter 도 같은 판정
  await expectStays(page, live.starts.count, 0)

  release()
  await expect(panel).toContainText('요약본입니다')
  await expect(send).toBeEnabled()
  await ask(page, live, TITLE_A) // 같은 질문을 다시 보내도 지난 쌍이 숨지 않는다
  await expect(panel.getByTestId('chat-user-bubble')).toHaveCount(2)
  await expect(panel).toContainText('요약본입니다')
  expect(live.starts.lastBody()).toMatchObject({ sessionId: 's-a', query: TITLE_A, correlationId: live.cid('corr-a') })
})

test('이력 복원의 확인 카드 조회가 응답하지 않아도 시간 제한 뒤 보내기 잠금이 풀린다 (WP-268)', async ({ authenticatedPage: page }) => {
  test.slow() // 복원 요청 시간 제한(10초)을 실제로 기다린다 — 브라우저 XHR 타임아웃이라 page.clock 으로 당길 수 없다.
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  // 확인 카드 조회만 영영 응답하지 않는다(요청은 받되 fulfill 하지 않음).
  await page.route((u) => u.pathname === '/api/v1/home/sessions/s-a/proposals', () => {})
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await page.getByTestId('chat-input').fill('이어서 물어볼게')
  const send = page.getByTestId('chat-panel').getByRole('button', { name: '보내기' })
  await expect(send).toBeDisabled()
  await expect(send).toBeEnabled({ timeout: 20_000 })
})
