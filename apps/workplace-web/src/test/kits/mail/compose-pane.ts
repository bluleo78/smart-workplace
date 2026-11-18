// 읽기 창 작성(WP-1743) 테스트 도우미 — 「읽기 창으로」/접기 테스트 여러 파일이 같이 쓰는 원문 2통·답장 열기·호스트 위치 선택자.
// 화면은 testkit-b4 renderMail 로 띄우고, 메일 목록은 renderMail 의 messages 옵션으로, 상세만 여기 핸들러로 준다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { renderMail } from '@/test/kits/mail/testkit-b4'

import { detail, summary } from '../../../../e2e/factories/mail.factory'

/** 원문 2통(5·6) 목록 — 왼쪽 목록에서 다른 행을 고르는 시나리오에 쓴다. renderMail 의 messages 로 넘긴다. */
export const paneMessages = [
  summary({ id: 5, subject: '첫 번째 메일', fromAddress: 'alice@example.com', fromName: 'Alice' }),
  summary({ id: 6, subject: '두 번째 메일', fromAddress: 'bob@example.com', fromName: 'Bob' }),
]

/** 원문 2통(5·6)의 상세 조회 — 목록 행을 누르면 읽기 자리에 뜬다. */
export function paneDetailHandlers() {
  return [
    http.get('/api/v1/mail/messages/5', () =>
      HttpResponse.json(
        detail({ id: 5, subject: '첫 번째 메일', fromAddress: 'alice@example.com', fromName: 'Alice', bodyText: '첫 원문', attachments: [] }),
      ),
    ),
    http.get('/api/v1/mail/messages/6', () =>
      HttpResponse.json(
        detail({ id: 6, subject: '두 번째 메일', fromAddress: 'bob@example.com', fromName: 'Bob', bodyText: '두 번째 원문', attachments: [] }),
      ),
    ),
  ]
}

/** 원문(5)을 연 뒤 답장으로 작성창을 띄우고 본문 한 줄을 쓴다. */
export async function openReplyWithBody(view: ReturnType<typeof renderMail>, text: string) {
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await screen.findByTestId('mail-reply')
  await view.user.click(screen.getByTestId('mail-reply'))
  await screen.findByTestId('mail-composer-body')
  await view.user.click(screen.getByTestId('mail-composer-body'))
  await view.user.keyboard(text)
}

/** 읽기 자리 슬롯 — 메일 화면 밖이면 null. */
export const paneSlotEl = () => document.querySelector('[data-testid="mail-compose-pane-slot"]')
/** 작성창 호스트 — 주차 칸(우측 하단)·슬롯(읽기 창) 사이를 오가는 노드. */
export const composeHostEl = () => document.querySelector('[data-compose-host]')
/** 작성창이 지금 읽기 창(슬롯 안)에 있는가. */
export const composeInPane = () => composeHostEl()?.closest('[data-testid="mail-compose-pane-slot"]') != null
