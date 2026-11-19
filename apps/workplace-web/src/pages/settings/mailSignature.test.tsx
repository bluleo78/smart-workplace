// 설정 › 메일 계정 「서명」 카드(WP-1517) 화면 테스트 — 불러오기·로딩·실패, 스위치 기본값, 저장 payload·응답 반영,
// 비우기, 가져오지 못한 이미지 알림, 저장 실패 문구, 서명 이미지의 인증 요청 그리기를 본다.
// 붙여넣은 서명 「원본 그대로」 모드(WP-1726) — 모드 전환·미리 보기·payload pasted·클래스 서식 인라인·편집기로 바꾸기·다시 붙여넣기.
// 실제 브라우저 붙여넣기와 화면 배선은 e2e/pages/mail/mail-signature.spec.ts(@input·@wiring)가 본다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
    expect(puts[0].body).toEqual({ html: '<p>홍길동</p>', autoNew: true, autoReply: true, pasted: false })
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
    expect(puts[1].body).toEqual({ html: '', autoNew: false, autoReply: true, pasted: false })
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
    expect(puts[0].body).toEqual({ html: '', autoNew: true, autoReply: false, pasted: false })
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

/** 붙여넣기 이벤트를 보낸다 — jsdom 에는 DataTransfer 가 없어 getData 만 흉내 낸다. */
function paste(el: HTMLElement, data: { html?: string; text?: string }) {
  const types = [data.html != null ? 'text/html' : null, data.text != null ? 'text/plain' : null].filter(Boolean) as string[]
  const clipboardData = {
    getData: (type: string) => (type === 'text/html' ? (data.html ?? '') : type === 'text/plain' ? (data.text ?? '') : ''),
    types,
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(el, { clipboardData })
  })
}

/** Outlook 데스크톱 서명 복사본 모양 — 껍데기·클래스 규칙(MsoNormal)·표·링크. */
const OUTLOOK_PASTE =
  '<html><head><style><!--p.MsoNormal{font-family:"Malgun Gothic";font-size:10pt;color:#222}--></style></head><body>' +
  '<!--StartFragment--><table><tbody><tr><td><p class="MsoNormal">홍길동</p>' +
  '<p class="MsoNormal"><a href="https://example.com" style="color:black;text-decoration:none">example</a></p>' +
  '</td></tr></tbody></table><!--EndFragment--></body></html>'

const PREVIEW_LABEL = '붙여넣은 서명 · 원본 그대로'
const previewFrame = () => within(screen.getByTestId('mail-signature-pasted')).getByTitle('서명') as HTMLIFrameElement

describe('붙여넣은 서명 「원본 그대로」', () => {
  test('표·클래스 서식이 든 서명을 붙여 넣으면 미리 보기로 바뀌고 pasted:true 와 인라인 서식으로 저장한다', async () => {
    const { user, puts } = openCard()
    paste(await screen.findByTestId('mail-signature-editor'), { html: OUTLOOK_PASTE, text: '홍길동\nexample' })

    expect(await screen.findByText(PREVIEW_LABEL)).toBeInTheDocument()
    expect(screen.queryByTestId('mail-signature-editor')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 붙여넣기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '편집기로 바꾸기' })).toBeInTheDocument()
    // 미리 보기는 격리 iframe — 서명 HTML 이 문서에 그대로 실린다.
    expect(previewFrame().getAttribute('srcdoc')).toContain('홍길동')
    expect(previewFrame()).toHaveClass('bg-white')

    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    const body = puts[0].body
    expect(body.pasted).toBe(true)
    expect(body.html).toContain('<table>')
    // 클래스 규칙이 인라인으로 옮겨지고, <style>·껍데기·주석은 남지 않는다.
    expect(body.html).toMatch(/<p class="MsoNormal" style="font-family:&quot;Malgun Gothic&quot;;font-size:10pt;color:#222">홍길동<\/p>/)
    expect(body.html).not.toMatch(/<style|<html|<!--/)
    // 링크의 원본 인라인 색이 클래스 규칙보다 앞서 남는다.
    expect(body.html).toContain('color:black;text-decoration:none')
    expect(await screen.findByText('서명을 저장했어요')).toBeInTheDocument()
    // 저장 응답의 서명으로 미리 보기를 다시 그리고, 저장은 다시 꺼진다.
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(screen.getByText(PREVIEW_LABEL)).toBeInTheDocument()
  })

  test('불러온 pasted 서명은 편집기 대신 미리 보기로 열린다', async () => {
    openCard({ saved: createMailSignature({ html: '<table><tbody><tr><td>홍길동</td></tr></tbody></table>', pasted: true }) })
    expect(await screen.findByText(PREVIEW_LABEL)).toBeInTheDocument()
    expect(screen.queryByTestId('mail-signature-editor')).not.toBeInTheDocument()
    expect(previewFrame().getAttribute('srcdoc')).toContain('<td>홍길동</td>')
    // 카드보다 넓은 표 서명은 잘리지 않고 가로로 스크롤된다(세로는 내용에 맞춘다). 스크롤은 body(창)가 아니라 내용을 감싼 칸이 맡는다 —
    // body 가 스크롤하면 가로 스크롤 막대가 창 안쪽을 차지해 높이 보고에 들지 않고 표 마지막 줄이 막대에 가린다.
    const frameDoc = new DOMParser().parseFromString(previewFrame().getAttribute('srcdoc') ?? '', 'text/html')
    const scroller = frameDoc.querySelector('[data-mail-signature-scroll]') as HTMLElement
    expect(scroller.style.overflowX).toBe('auto')
    expect(scroller.querySelector('td')?.textContent).toBe('홍길동')
    expect(previewFrame().getAttribute('srcdoc')).not.toContain('body{overflow-x:auto')
    expect(saveButton()).toBeDisabled()
  })

  test('편집기로 바꾸기는 확인을 받고, 그 HTML 로 편집기를 열어 pasted:false 로 저장한다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<p style="color:#1F4E79">홍길동</p>', pasted: true }) })
    await screen.findByText(PREVIEW_LABEL)
    await user.click(screen.getByRole('button', { name: '편집기로 바꾸기' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('편집기로 바꾸면 일부 서식이 빠질 수 있어요')).toBeInTheDocument()
    // 취소하면 그대로다.
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.getByText(PREVIEW_LABEL)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '편집기로 바꾸기' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '바꾸기' }))
    expect(await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
    // 모드가 바뀐 것만으로도 저장할 것이 있다.
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body.pasted).toBe(false)
    expect(puts[0].body.html).toContain('홍길동')
  })

  test('비우기는 빈 편집기로 돌아가고 pasted:false 로 저장한다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<table><tbody><tr><td>홍길동</td></tr></tbody></table>', pasted: true }) })
    await screen.findByText(PREVIEW_LABEL)
    await user.click(screen.getByRole('button', { name: '비우기' }))
    await screen.findByTestId('mail-signature-editor')
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body).toEqual({ html: '', autoNew: true, autoReply: false, pasted: false })
  })

  test('다시 붙여넣기는 붙여 넣을 칸을 열고, 붙인 서명으로 미리 보기를 바꾼다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<table><tbody><tr><td>옛 서명</td></tr></tbody></table>', pasted: true }) })
    await screen.findByText(PREVIEW_LABEL)
    await user.click(screen.getByRole('button', { name: '다시 붙여넣기' }))
    const zone = screen.getByRole('textbox', { name: '여기에 서명을 붙여 넣으세요' })
    paste(zone, { html: '<table><tbody><tr><td style="color:#1F4E79">새 서명</td></tr></tbody></table>' })
    await waitFor(() => expect(previewFrame().getAttribute('srcdoc')).toContain('새 서명'))
    expect(screen.queryByRole('textbox', { name: '여기에 서명을 붙여 넣으세요' })).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body).toMatchObject({ pasted: true })
    expect(puts[0].body.html).toContain('새 서명')
  })

  test('다시 붙여넣기에 서식 없는 글을 붙이면 편집기로 넘어가 그 글을 넣는다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<table><tbody><tr><td>옛 서명</td></tr></tbody></table>', pasted: true }) })
    await screen.findByText(PREVIEW_LABEL)
    await user.click(screen.getByRole('button', { name: '다시 붙여넣기' }))
    paste(screen.getByRole('textbox', { name: '여기에 서명을 붙여 넣으세요' }), { text: '홍길동\n개발팀' })
    const ed = await screen.findByTestId('mail-signature-editor')
    expect(await within(ed).findByText('홍길동')).toBeInTheDocument()
    expect(within(ed).getByText('개발팀')).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
  })

  test('굵게·링크만 든 서명을 붙여 넣으면 편집기 그대로다', async () => {
    const { user, puts } = openCard()
    const ed = await screen.findByTestId('mail-signature-editor')
    paste(ed, { html: '<p><strong>홍길동</strong> <a href="https://example.com">example</a></p>', text: '홍길동 example' })
    expect(await within(editor()).findByText('홍길동')).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body.pasted).toBe(false)
    expect(puts[0].body.html).toContain('<strong>홍길동</strong>')
  })
})

describe('붙여넣은 서명 — 코드 리뷰 반영', () => {
  test('글이 있는 편집기 중간에 서식 있는 조각을 붙이면 미리 보기로 바꾸지 않고 편집기에 넣는다', async () => {
    const { user, puts } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    const ed = await screen.findByTestId('mail-signature-editor')
    await within(ed).findByText('홍길동')
    // 웹 페이지에서 전화번호를 복사하면 크롬이 <span style> 을 붙인다 — 이미 쓴 서명을 지우면 안 된다.
    paste(ed, { html: '<span style="color:#333">010-1234-5678</span>', text: '010-1234-5678' })
    expect(await within(editor()).findByText(/010-1234-5678/)).toBeInTheDocument()
    expect(within(editor()).getByText(/홍길동/)).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].body.pasted).toBe(false)
  })

  test('글이 있어도 전체를 고른 뒤 서식 있는 서명을 붙이면 통째로 바꾸는 것이라 미리 보기로 바뀐다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    const ed = await screen.findByTestId('mail-signature-editor')
    await within(ed).findByText('홍길동')
    await user.click(ed)
    await user.keyboard('{Control>}a{/Control}')
    paste(ed, { html: '<table><tbody><tr><td>새 서명</td></tr></tbody></table>', text: '새 서명' })
    expect(await screen.findByText(PREVIEW_LABEL)).toBeInTheDocument()
    expect(previewFrame().getAttribute('srcdoc')).toContain('새 서명')
  })

  test('빈 서명에 서식 있는 서명을 붙였다가 비우면 서버 값과 같아 저장이 꺼진다', async () => {
    const { user } = openCard()
    paste(await screen.findByTestId('mail-signature-editor'), { html: '<table><tbody><tr><td>홍길동</td></tr></tbody></table>' })
    await screen.findByText(PREVIEW_LABEL)
    expect(saveButton()).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '비우기' }))
    await screen.findByTestId('mail-signature-editor')
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  test('편집기 서명을 그대로 붙여넣은 서명으로 갔다가 같은 내용으로 편집기로 돌아오면 저장이 꺼진다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    const ed = await screen.findByTestId('mail-signature-editor')
    await within(ed).findByText('홍길동')
    await user.click(ed)
    await user.keyboard('{Control>}a{/Control}')
    paste(ed, { html: '<p style="padding:4px">홍길동</p>' })
    await screen.findByText(PREVIEW_LABEL)
    // 다시 붙여넣기 칸에 서명과 같은 글을 붙이면 편집기로 돌아온다 — 서버 값과 같으므로 바뀐 것이 없다.
    await user.click(screen.getByRole('button', { name: '다시 붙여넣기' }))
    paste(screen.getByRole('textbox', { name: '여기에 서명을 붙여 넣으세요' }), { html: '<p>홍길동</p>', text: '홍길동' })
    await within(await screen.findByTestId('mail-signature-editor')).findByText('홍길동')
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  test('서명 편집기에서 복사한 서명(복사 표지)을 전체 골라 되붙이면 색 글자·표가 있어도 편집기에 남는다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<p>홍길동</p>' }) })
    const ed = await screen.findByTestId('mail-signature-editor')
    await within(ed).findByText('홍길동')
    await user.click(ed)
    await user.keyboard('{Control>}a{/Control}')
    paste(ed, {
      html: '<p data-wp-signature-copy="" data-pm-slice="1 1 []"><span style="color:#1F4E79">새 서명</span></p><table><tbody><tr><td>개발팀</td></tr></tbody></table>',
      text: '새 서명',
    })
    expect(await within(editor()).findByText('새 서명')).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
  })

  test('빈 서명에 글자 서식 style 만 든 웹 글을 붙이면 편집기에 남는다', async () => {
    openCard()
    const ed = await screen.findByTestId('mail-signature-editor')
    paste(ed, { html: '<span style="color: rgb(34, 34, 34); font-family: Arial;">010-1234-5678</span>', text: '010-1234-5678' })
    expect(await within(editor()).findByText(/010-1234-5678/)).toBeInTheDocument()
    expect(screen.queryByText(PREVIEW_LABEL)).not.toBeInTheDocument()
  })

  test('붙여넣기 칸은 글자 입력은 막고 Shift+Insert·Ctrl+V·Tab 은 통과시킨다', async () => {
    const { user } = openCard({ saved: createMailSignature({ html: '<table><tbody><tr><td>옛 서명</td></tr></tbody></table>', pasted: true }) })
    await screen.findByText(PREVIEW_LABEL)
    await user.click(screen.getByRole('button', { name: '다시 붙여넣기' }))
    const zone = screen.getByRole('textbox', { name: '여기에 서명을 붙여 넣으세요' })
    // fireEvent 는 preventDefault 되면 false 를 돌려준다.
    expect(fireEvent.keyDown(zone, { key: 'a' })).toBe(false)
    expect(fireEvent.keyDown(zone, { key: 'Insert', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(zone, { key: 'v', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(zone, { key: 'Tab' })).toBe(true)
  })
})
