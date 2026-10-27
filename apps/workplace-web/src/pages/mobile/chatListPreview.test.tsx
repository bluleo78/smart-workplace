// 모바일 채팅 목록 미리보기(WP-135) — 페이지 테스트(WP-971).
// 셀프 DM(참여자가 나뿐) 미리보기 접두 「나: 」는 API 응답이 문구로 바뀌는 것이라 브라우저 없이 판정되므로
// e2e/pages/mobile/chat-list-preview.spec.ts 에서 옮겼다. 굵기·정렬·말줄임(@layout)은 E2E 에 남는다.
// 목록은 채팅 모듈 레이아웃이 모바일 루트에서 그리므로 레이아웃과 채널 목록 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { ChatModuleLayout } from '@/components/chat/ChatModuleLayout'
import { renderMobileScreen } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createChannel, createDm, createDmParticipant, createLastMessage } from '../../../e2e/factories/messaging.factory'
import ChannelListPage from '../chat/ChannelListPage'

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

const ME = 1 // renderScreen 기본 로그인 사용자 id(testAuthValue)

// 나뿐인 DM 은 상대가 없으므로 접두를 빼지 않고 「나: 」를 붙인다 — 1:1 상대 규칙(접두 없음)으로 잘못 가면 실패.
test('셀프 DM 미리보기는 마지막 메시지를 「나: 」로 보인다', async () => {
  const handlers = [
    http.get('/api/v1/messaging/channels', () => HttpResponse.json([createChannel({ id: 1, name: '모바일-개편' })])),
    http.get('/api/v1/messaging/dms', () =>
      HttpResponse.json([
        createDm({
          id: 20,
          participants: [createDmParticipant({ userId: ME, name: '나' })],
          lastMessage: createLastMessage({ authorId: ME, preview: '메모: 우유 사기' }),
        }),
      ]),
    ),
  ]
  renderMobileScreen(
    <Routes>
      <Route element={<ChatModuleLayout />}>
        <Route path="/chat" element={<ChannelListPage />} />
      </Route>
    </Routes>,
    { path: '/chat', handlers },
  )
  const list = await screen.findByTestId('mobile-module-list')
  expect(await within(list).findByTestId('conv-preview-self')).toHaveTextContent(/^나: 메모: 우유 사기$/)
})
