// 설정 › 메일 계정 「작성 방식」 카드(WP-1744) 화면 테스트 — 문구, 저장한 적 없을 때의 기본(우측 하단), 고르면 바로 PUT(payload),
// 저장 실패 시 이전 값으로 되돌림과 오류 토스트를 본다. 고른 값대로 작성창이 열리는 규칙은 pages/mail/mailComposeDefault.test.tsx 가 본다.
import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { record } from '@/test/kits/mail/testkit-b4'
import { renderScreen } from '@/test/renderScreen'
import type { MailUserSettings } from '@/types/mailSettings'

import { createMailSettings } from '../../../e2e/factories/mailSettings.factory'
import { MailComposeModeCard } from './MailComposeModeCard'

const API = '/api/v1'

type Opts = {
  saved?: MailUserSettings
  /** PUT 응답 — 기본은 받은 값을 그대로 저장한 것처럼 돌려준다. */
  reply?: (body: MailUserSettings) => Response | Promise<Response>
}

/** 카드를 띄운다 — PUT 요청 몸체는 puts 에 쌓인다. */
function openCard({ saved = createMailSettings(), reply }: Opts = {}) {
  const put = record<MailUserSettings>('put', `${API}/mail/settings`, ({ body }) =>
    reply ? reply(body) : HttpResponse.json(createMailSettings(body)),
  )
  const view = renderScreen(<MailComposeModeCard />, {
    path: '/settings/mail',
    handlers: [http.get(`${API}/mail/settings`, () => HttpResponse.json(saved)), put.handler],
  })
  return { ...view, puts: put.calls }
}

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) })

describe('작성 방식 카드', () => {
  test('제목·설명과 세 가지 방식의 문구가 보인다', async () => {
    openCard()
    expect(await screen.findByRole('heading', { name: '작성 방식' })).toBeInTheDocument()
    expect(screen.getByText('새 메일·답장·전달을 열 곳. 작성창 위 단추로 그때그때 바꿀 수 있어요.')).toBeInTheDocument()
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    expect(screen.getByText('읽기 창')).toBeInTheDocument()
    expect(screen.getByText('메일 화면 오른쪽에서 바로 작성')).toBeInTheDocument()
    expect(screen.getByText('우측 하단')).toBeInTheDocument()
    expect(screen.getByText('작은 창으로 띄우고 목록을 계속 보기')).toBeInTheDocument()
    expect(screen.getByText('새 창')).toBeInTheDocument()
    expect(screen.getByText('브라우저 새 창으로 열기')).toBeInTheDocument()
  })

  test('설정을_바꾼_적이_없으면_우측_하단이_골라져_있다', async () => {
    openCard()
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    expect(radio('우측 하단')).toBeChecked()
    expect(radio('읽기 창')).not.toBeChecked()
    expect(radio('새 창')).not.toBeChecked()
  })

  test('저장한 값(새 창)이 골라져 있다', async () => {
    openCard({ saved: createMailSettings({ composeMode: 'WINDOW' }) })
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    expect(radio('새 창')).toBeChecked()
    expect(radio('우측 하단')).not.toBeChecked()
  })

  test('읽기_창을_고르면_PUT_composeMode_PANE', async () => {
    const { user, puts } = openCard()
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    await user.click(radio('읽기 창'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body).toEqual({ composeMode: 'PANE' })
    // 고르는 즉시 골라진 것으로 보인다(낙관적 갱신).
    expect(radio('읽기 창')).toBeChecked()
    expect(radio('우측 하단')).not.toBeChecked()
  })

  test('저장에_실패하면_이전_값으로_돌아오고_오류_토스트', async () => {
    const { user, puts } = openCard({
      reply: async () => {
        await delay(30)
        // 서버 문구가 없는 500 — 훅의 기본 문구가 토스트로 보인다(서버 문구가 있으면 그 문구를 보인다).
        return HttpResponse.json({ status: 500 }, { status: 500 })
      },
    })
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    await user.click(radio('새 창'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body).toEqual({ composeMode: 'WINDOW' })
    expect(await screen.findByText('작성 방식을 저장하지 못했어요')).toBeInTheDocument()
    await waitFor(() => expect(radio('우측 하단')).toBeChecked())
    expect(radio('새 창')).not.toBeChecked()
  })

  // 빠르게 두 번 고르고 앞 요청만 실패 — 요청은 차례로 나가고(scope), 앞 요청의 실패 되돌림이 마지막 선택을 덮지 않는다.
  test('읽기_창(500)_뒤_바로_새_창(200)을_고르면_새_창이_남고_오류_토스트는_한_번', async () => {
    const { user, puts } = openCard({
      reply: async (body) => {
        if (body.composeMode === 'PANE') {
          // 앞 요청은 늦게 실패한다 — 차례로 보내지 않으면 뒤 요청의 성공이 먼저 와 되돌림이 마지막 선택을 덮는다.
          await delay(60)
          return HttpResponse.json({ status: 500 }, { status: 500 })
        }
        return HttpResponse.json(createMailSettings(body))
      },
    })
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    await user.click(radio('읽기 창'))
    await user.click(radio('새 창'))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts.map((p) => p.body.composeMode)).toEqual(['PANE', 'WINDOW'])
    expect(await screen.findByText('작성 방식을 저장하지 못했어요')).toBeInTheDocument()
    // 두 응답이 모두 처리된 뒤에도 마지막 선택(새 창)이 남는다.
    await delay(100)
    expect(radio('새 창')).toBeChecked()
    expect(radio('읽기 창')).not.toBeChecked()
    expect(screen.getAllByText('작성 방식을 저장하지 못했어요')).toHaveLength(1)
  })

  test('불러오지 못하면 다시 시도로 불러온다', async () => {
    let fail = true
    const view = renderScreen(<MailComposeModeCard />, {
      handlers: [
        http.get(`${API}/mail/settings`, () =>
          fail
            ? HttpResponse.json({ message: 'server error' }, { status: 500 })
            : HttpResponse.json(createMailSettings({ composeMode: 'PANE' })),
        ),
      ],
    })
    expect(await screen.findByText('작성 방식을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    fail = false
    await view.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByRole('radiogroup', { name: '작성 방식' })
    expect(radio('읽기 창')).toBeChecked()
  })
})
