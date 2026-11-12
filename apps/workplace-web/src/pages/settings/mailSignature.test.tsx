// 설정 › 메일 계정 「서명」 카드(WP-1517) 화면 테스트 — 불러오기·로딩·실패, 스위치 기본값, 저장 payload·응답 반영,
// 비우기, 가져오지 못한 이미지 알림, 저장 실패 문구, 서명 이미지의 인증 요청 그리기를 본다.
// 실제 붙여넣기(Outlook 서식 보존)와 화면 배선은 e2e/pages/mail/mail-signature.spec.ts(@input·@wiring)가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { record } from '@/test/kits/mail/testkit-b4'
import { renderScreen } from '@/test/renderScreen'
import type { MailSignature, UpdateMailSignatureRequest } from '@/types/mailSignature'

import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'
import { MailSignatureCard } from './MailSignatureCard'

const API = '/api/v1'
const GUIDE =
  'Outlook 서명을 쓰려면 Outlook 의 설정 › 메일 › 서명에서 서명을 모두 선택해 복사(Ctrl+C)한 뒤 아래에 붙여 넣으세요. 글꼴·색·로고 이미지·링크가 그대로 들어옵니다.'

type Opts = {
  saved?: MailSignature
  /** PUT 응답 — 기본은 받은 값을 그대로 저장한 것처럼 돌려준다. */
  reply?: (body: UpdateMailSignatureRequest) => Response | Promise<Response>
}

/** 카드를 띄운다 — PUT 요청은 puts 에 쌓인다. */
function openCard({ saved = createMailSignature(), reply }: Opts = {}) {
  const put = record<UpdateMailSignatureRequest>('put', `${API}/mail/signature`, ({ body }) =>
    reply ? reply(body) : HttpResponse.json(createMailSignature({ ...body, updatedAt: '2026-11-12T00:00:00Z' })),
  )
  const view = renderScreen(<MailSignatureCard />, {
    path: '/settings/mail',
    handlers: [http.get(`${API}/mail/signature`, () => HttpResponse.json(saved)), put.handler],
  })
  return { ...view, puts: put.calls }
}

const editor = () => screen.getByTestId('mail-signature-editor')
const saveButton = () => screen.getByRole('button', { name: '저장' })

describe('서명 카드', () => {
  test('안내문과 스위치 기본값이 보인다', async () => {
    openCard()
    expect(await screen.findByRole('heading', { name: '서명' })).toBeInTheDocument()
    await screen.findByTestId('mail-signature-editor')
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === GUIDE)).toBeInTheDocument()
    // 굵게는 「설정 › 메일 › 서명」 한 군데.
    expect(screen.getByText('설정 › 메일 › 서명').tagName).toBe('STRONG')
    expect(screen.getByText('서명을 자동으로 넣을 메일')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '새 메일' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '답장·전달' })).not.toBeChecked()
    // 빈 서명이면 비울 것도, 저장할 것도 없다.
    expect(screen.getByRole('button', { name: '비우기' })).toBeDisabled()
    expect(saveButton()).toBeDisabled()
  })

  test('불러오는 동안은 스켈레톤, 실패하면 다시 시도로 불러온다', async () => {
    let fail = true
    const view = renderScreen(<MailSignatureCard />, {
      handlers: [
        http.get(`${API}/mail/signature`, async () => {
          await delay(50)
          return fail
            ? HttpResponse.json({ message: 'server error' }, { status: 500 })
            : HttpResponse.json(createMailSignature({ html: '<p>홍길동</p>' }))
        }),
      ],
    })
    expect(screen.getByTestId('mail-signature-loading')).toBeInTheDocument()
    expect(await screen.findByText('서명을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByTestId('mail-signature-editor')).not.toBeInTheDocument()
    fail = false
    await view.user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
  })

  test('저장된 서명이 편집기에 보이고 저장은 꺼져 있다', async () => {
    openCard({ saved: createMailSignature({ html: '<p>홍길동</p>', autoNew: false, autoReply: true }) })
    expect(await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '새 메일' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: '답장·전달' })).toBeChecked()
    expect(screen.getByRole('button', { name: '비우기' })).toBeEnabled()
    expect(saveButton()).toBeDisabled()
  })

  test('스위치를 바꾸고 저장하면 payload 에 실리고, 저장 뒤 다시 꺼진다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '답장·전달' }))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body).toEqual({ html: '<p>홍길동</p>', autoNew: true, autoReply: true })
    expect(await screen.findByText('서명을 저장했어요')).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(screen.getByRole('switch', { name: '답장·전달' })).toBeChecked()
  })

  test('스위치를 되돌리면 바뀐 것이 없어 저장이 다시 꺼진다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    expect(saveButton()).toBeEnabled()
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    expect(saveButton()).toBeDisabled()
  })

  test('저장 응답의 정리된 서명으로 편집기를 갈아 끼운다', async () => {
    const { user } = openCard({
      saved: createMailSignature({ html: '<p>홍길동</p>' }),
      reply: (body) => HttpResponse.json(createMailSignature({ ...body, html: '<p>홍길동 (정리됨)</p>' })),
    })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    await user.click(saveButton())
    expect(await within(editor()).findByText('홍길동 (정리됨)')).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  test('저장하는 동안 고친 내용은 응답으로 덮지 않고 바뀜으로 남긴다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user, puts } = openCard({
      saved: createMailSignature({ html: '<p>홍길동</p>' }),
      reply: async (body) => {
        await gate
        return HttpResponse.json(createMailSignature({ ...body, html: '<p>홍길동 (정리됨)</p>' }))
      },
    })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    // 응답이 오기 전에 편집기를 비우고 「답장·전달」도 켠다.
    await user.click(screen.getByRole('button', { name: '비우기' }))
    await waitFor(() => expect(within(editor()).queryByText('홍길동')).not.toBeInTheDocument())
    await user.click(screen.getByRole('switch', { name: '답장·전달' }))
    release()
    expect(await screen.findByText('서명을 저장했어요')).toBeInTheDocument()
    // 정리된 서버 값으로 갈아 끼우지 않는다 — 비운 편집기와 켠 스위치가 그대로이고, 저장할 것이 남아 있다.
    expect(within(editor()).queryByText('홍길동 (정리됨)')).not.toBeInTheDocument()
    expect(within(editor()).queryByText('홍길동')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '답장·전달' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '새 메일' })).not.toBeChecked()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1].body).toEqual({ html: '', autoNew: false, autoReply: true })
  })

  test('비우기는 편집기만 비우고, 저장해야 빈 서명으로 반영된다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('button', { name: '비우기' }))
    await waitFor(() => expect(within(editor()).queryByText('홍길동')).not.toBeInTheDocument())
    expect(puts).toHaveLength(0)
    expect(screen.getByRole('button', { name: '비우기' })).toBeDisabled()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    // 편집기의 빈 문서(<p></p>)는 서버의 「서명 없음」과 같은 '' 로 보낸다.
    expect(puts[0].body).toEqual({ html: '', autoNew: true, autoReply: false })
  })

  test('가져오지 못한 이미지는 개수를 알린다', async () => {
    const { user } = openCard({
      saved: createMailSignature({ html: '<p>홍길동</p>' }),
      reply: (body) => HttpResponse.json(createMailSignature({ ...body, droppedImageCount: 2 })),
    })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    await user.click(saveButton())
    expect(await screen.findByText('이미지 2개를 가져오지 못해 뺐어요')).toBeInTheDocument()
    expect(screen.getByText('서명은 저장했어요. 이미지를 복사해 서명 칸에 직접 붙여 넣으세요')).toBeInTheDocument()
    expect(screen.queryByText('서명을 저장했어요')).not.toBeInTheDocument()
  })

  test('저장 실패는 서버 문구로 알리고 다시 저장할 수 있다', async () => {
    const { user } = openCard({
      saved: createMailSignature({ html: '<p>홍길동</p>' }),
      reply: () => HttpResponse.json({ status: 400, message: '서명이 너무 길어요' }, { status: 400 }),
    })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    await user.click(saveButton())
    expect(await screen.findByText('서명이 너무 길어요')).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  test('서명 이미지 경로는 인증 요청으로 받아 그린다', async () => {
    const image = record('get', `${API}/mail/signature/images/:id`, () =>
      HttpResponse.arrayBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, { headers: { 'Content-Type': 'image/png' } }),
    )
    renderScreen(<MailSignatureCard />, {
      handlers: [
        http.get(`${API}/mail/signature`, () =>
          HttpResponse.json(createMailSignature({ html: '<p>홍길동<img src="/api/v1/mail/signature/images/7" width="120"></p>' })),
        ),
        image.handler,
      ],
    })
    const node = await within(await screen.findByTestId('mail-signature-editor')).findByTestId('signature-image')
    await waitFor(() => expect(image.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/mail/signature/images/7']))
    // 인증 경로를 그대로 <img src> 로 쓰지 않는다 — 받은 바이트의 objectURL 로 그린다.
    // alt 가 비어 있어 img 역할이 아니다(장식) — 요소로 찾는다.
    await waitFor(() => expect(node.querySelector('img')).not.toBeNull())
    const img = node.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toMatch(/^blob:/)
    expect(img).toHaveAttribute('width', '120')
  })

  test('열 수 없는 이미지 주소는 「불러올 수 없음」으로 보이고 저장에는 그대로 실린다', async () => {
    const { user, puts } = openCard({
      saved: createMailSignature({ html: '<p>홍길동<img src="file:///C:/sig/image001.png"></p>' }),
    })
    const node = await within(await screen.findByTestId('mail-signature-editor')).findByTestId('signature-image')
    expect(within(node).getByText('불러올 수 없음')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '새 메일' }))
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    // 서버가 빼고 droppedImageCount 로 알려 주도록 편집기는 버리지 않는다.
    expect(puts[0].body.html).toContain('src="file:///C:/sig/image001.png"')
  })
})
