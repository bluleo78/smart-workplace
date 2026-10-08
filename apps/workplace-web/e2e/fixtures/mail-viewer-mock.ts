// 메일 첨부 뷰어 E2E 모킹(WP-280) — 데스크톱·모바일 spec 이 같은 메일·첨부 구성을 쓴다.
// 10번 메일: HTML 본문에 cid 인라인 이미지(5) 1개 + 일반 첨부 PDF(6)·텍스트(7).
// 인라인 이미지는 본문에 표시되므로 첨부 목록·뷰어 묶음에서 빠져야 한다(묶음 = 6·7, "n / 2").
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../factories/mail.factory'
import { mockApi } from './api-mock'
import { solidPng } from './png'
import { trackRequests } from './requests'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PDF = fs.readFileSync(path.join(HERE, 'sample-3p.pdf'))
const PNG = solidPng(8, 8)
/** 텍스트 첨부 본문 — 뷰어 본문에 그대로 보이는지 확인용. */
export const MEMO_TEXT = '회의 메모 본문입니다'

/** 첨부 id → 응답(형식·바이트). 7번은 Graph 경로처럼 파라미터가 붙은 형식을 메타에 둔다. */
const CONTENT: Record<number, { type: string; body: Buffer }> = {
  5: { type: 'image/png', body: PNG },
  6: { type: 'application/pdf', body: PDF },
  7: { type: 'text/plain; charset=utf-8', body: Buffer.from(MEMO_TEXT, 'utf-8') },
}

/**
 * 계정·목록·10번 상세·첨부 콘텐츠를 모킹하고, 첨부 콘텐츠 요청 tracker 를 돌려준다.
 * 콘텐츠 응답은 실제 서버처럼 Content-Disposition: attachment 로 준다(뷰어는 blob 으로 받으므로 무관해야 한다).
 */
export async function stubMailWithAttachments(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary(), summary({ id: 11, subject: '점심 메뉴', seen: true })])
  await mockApi(
    page,
    'GET',
    '/api/v1/mail/messages/10',
    detail({
      bodyText: null,
      bodyHtml: '<p>안내</p><img id="inline" src="cid:logo.png">',
      attachments: [
        { id: 5, filename: 'logo.png', contentType: 'image/png', sizeBytes: PNG.length, contentId: null },
        { id: 6, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: PDF.length, contentId: null },
        { id: 7, filename: 'memo.txt', contentType: 'Text/Plain; charset=utf-8', sizeBytes: 30, contentId: null },
      ],
    }),
  )
  await mockApi(page, 'GET', '/api/v1/mail/messages/11', detail({ id: 11, subject: '점심 메뉴', attachments: [] }))
  const contents = trackRequests(page, 'ANY', (url) => url.pathname.startsWith('/api/v1/mail/attachments/'))
  await page.route(
    (url) => /^\/api\/v1\/mail\/attachments\/\d+\/content$/.test(url.pathname),
    (route) => {
      const id = Number(route.request().url().match(/attachments\/(\d+)\//)![1])
      const c = CONTENT[id]
      if (!c) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"없음"}' })
      return route.fulfill({
        status: 200,
        headers: { 'content-type': c.type, 'content-disposition': `attachment; filename="file-${id}"` },
        body: c.body,
      })
    },
  )
  return contents
}
