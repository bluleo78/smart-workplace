// 홈 챗 도크 위젯(#460) — 채널·연락처·드라이브 위젯 화면 테스트(WP-971, WP-995).
// AI 응답의 widgets 지시(params)를 받은 위젯이 자기 조회(API·쿼리 파라미터) 결과를 목록·상세·빈 상태·안내로 그리는 판정은
// 브라우저 없이 되므로 e2e/pages/home-widget-channels·home-widget-contacts·home-widget-drive.spec.ts 에서 옮겼다.
// 챗 도크 → 스트림 → 위젯 배선은 e2e/pages/home-widget-progressive.spec.ts 의 @wiring 이 지킨다.
// 위젯은 params 만 받아 스스로 조회하므로 도크·스트림 없이 위젯 컴포넌트만 renderScreen 으로 띄운다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import ChannelsWidget from '@/components/home/widgets/ChannelsWidget'
import ContactsWidget from '@/components/home/widgets/ContactsWidget'
import ContactWidget from '@/components/home/widgets/ContactWidget'
import DriveWidget from '@/components/home/widgets/DriveWidget'
import { renderScreen } from '@/test/renderScreen'
import type { DriveItemList, DriveSpace } from '@/types/drive'

import { external, externalDetail, member, page } from '../../../e2e/factories/contacts.factory'
import { createChannel } from '../../../e2e/factories/messaging.factory'

const API = '/api/v1'

/** 드라이브 공간 — 유형·이름만 바꿔 쓴다. */
function space(id: number, name: string, type: DriveSpace['type']): DriveSpace {
  return { id, name, type, ownerId: 1, role: 'VIEWER', archived: false, createdAt: '2024-01-01T00:00:00Z' }
}

// ── 채널 목록 위젯 ─────────────────────────────────────────────────────────

test('채널 목록 위젯 — 내 채널·DM 을 행으로 그리고 DM 행은 /chat/dms/:id 로 딥링크한다', async () => {
  renderScreen(<ChannelsWidget params={{}} />, {
    handlers: [
      http.get(`${API}/messaging/channels`, () =>
        HttpResponse.json([
          createChannel({ id: 1, name: 'general' }),
          createChannel({ id: 2, name: 'engineering' }),
          createChannel({ id: 3, name: '홍길동, 나', kind: 'DM' }),
        ]),
      ),
    ],
  })
  const items = await screen.findByTestId('channels-items')
  expect(items).toHaveTextContent('general')
  expect(items).toHaveTextContent('engineering')
  // DM 은 채널(/chat/channels/:id)이 아니라 DM 주소로 가야 한다.
  expect(within(items).getByRole('link', { name: /채널 열기: 홍길동/ })).toHaveAttribute('href', '/chat/dms/3')
  expect(within(items).getByRole('link', { name: /채널 열기: general/ })).toHaveAttribute('href', '/chat/channels/1')
})

test('채널 목록 위젯 — 채널이 없으면 빈 상태를 보인다', async () => {
  renderScreen(<ChannelsWidget params={{}} />, { handlers: [http.get(`${API}/messaging/channels`, () => HttpResponse.json([]))] })
  expect(await screen.findByTestId('channels-empty')).toHaveTextContent('채널이 없어요')
})

// ── 연락처 목록·상세 위젯 ──────────────────────────────────────────────────

test('연락처 위젯 — 구성원·외부 연락처를 이름·이메일·조직과 함께 그린다', async () => {
  renderScreen(<ContactsWidget params={{}} />, {
    handlers: [
      http.get(`${API}/contacts`, () =>
        HttpResponse.json(
          page([
            member({ id: 1, name: '김멤버', email: 'kim@example.com', organization: null, title: '팀장' }),
            external({ id: 100, name: '박외부', email: 'park@corp.com', organization: 'Corp', title: null }),
          ]),
        ),
      ),
    ],
  })
  const items = await screen.findByTestId('contacts-items')
  for (const text of ['김멤버', '박외부', 'kim@example.com', 'Corp']) expect(items).toHaveTextContent(text)
})

test('연락처 위젯 — 지시의 search·org 필터를 조회 쿼리(search·organization)로 보낸다', async () => {
  const urls: URL[] = []
  renderScreen(<ContactsWidget params={{ search: '박', org: 'Corp' }} />, {
    handlers: [
      http.get(`${API}/contacts`, ({ request }) => {
        urls.push(new URL(request.url))
        return HttpResponse.json(page([external({ id: 100, name: '박외부', organization: 'Corp' })]))
      }),
    ],
  })
  await screen.findByTestId('contacts-items')
  const params = urls.at(-1)!.searchParams
  expect(params.get('search')).toBe('박')
  expect(params.get('organization')).toBe('Corp')
})

test('연락처 위젯 — 결과가 없으면 빈 상태를 보인다', async () => {
  renderScreen(<ContactsWidget params={{}} />, { handlers: [http.get(`${API}/contacts`, () => HttpResponse.json(page([])))] })
  expect(await screen.findByTestId('contacts-empty')).toHaveTextContent('연락처가 없어요')
})

test('연락처 상세 위젯 — externalId 의 외부 연락처 상세(이메일·전화·조직·직함)를 그린다', async () => {
  renderScreen(<ContactWidget params={{ externalId: 100 }} />, {
    handlers: [
      http.get(`${API}/contacts/external/100`, () =>
        HttpResponse.json(
          externalDetail({ id: 100, name: '박외부', email: 'park@corp.com', phone: '010-1234-5678', organization: 'Corp', title: '이사', notes: '중요 거래처' }),
        ),
      ),
    ],
  })
  const detail = await screen.findByTestId('contact-detail')
  for (const text of ['박외부', 'park@corp.com', '010-1234-5678', 'Corp', '이사']) expect(detail).toHaveTextContent(text)
})

test('연락처 상세 위젯 — 개명 전 contactId 지시(#840)도 같은 상세를 그린다', async () => {
  renderScreen(<ContactWidget params={{ contactId: 101 }} />, {
    handlers: [http.get(`${API}/contacts/external/101`, () => HttpResponse.json(externalDetail({ id: 101, name: '구외부' })))],
  })
  expect(await screen.findByTestId('contact-detail')).toHaveTextContent('구외부')
})

test('연락처 상세 위젯 — externalId 가 없으면 조회 없이 안내 메시지를 보인다', async () => {
  // 핸들러를 주지 않는다 — 조회가 나가면 처리 안 된 요청으로 테스트가 실패한다.
  renderScreen(<ContactWidget params={{}} />)
  expect(await screen.findByTestId('contact-error')).toHaveTextContent('연락처 ID가 없습니다')
})

// ── 드라이브 위젯 ──────────────────────────────────────────────────────────

test('드라이브 위젯 — spaceId 가 없으면 공간 목록을 한국어 유형(개인·팀)과 함께 그린다 (WP-522)', async () => {
  renderScreen(<DriveWidget params={{}} />, {
    handlers: [http.get(`${API}/drive/spaces`, () => HttpResponse.json([space(1, '개인 드라이브', 'PERSONAL'), space(2, '팀 드라이브', 'TEAM')]))],
  })
  const items = await screen.findByTestId('drive-items')
  const rows = within(items).getAllByRole('listitem')
  expect(rows[0]).toHaveTextContent(/개인 드라이브\s*개인$/)
  expect(rows[1]).toHaveTextContent(/팀 드라이브\s*팀$/)
  // 영문 enum 이 그대로 새지 않는다.
  expect(items).not.toHaveTextContent('PERSONAL')
})

test('드라이브 위젯 — spaceId 를 주면 그 공간의 폴더·파일을 그린다', async () => {
  const list: DriveItemList = {
    folders: [{ id: 10, parentId: null, name: '기획 문서', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
    files: [
      {
        id: 20, folderId: null, fileId: 100, name: '회의록.pdf', mimeType: 'application/pdf', sizeBytes: 1024, category: 'DOCUMENT',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', versionCount: 1, available: true,
      },
    ],
  }
  renderScreen(<DriveWidget params={{ spaceId: 3 }} />, {
    handlers: [
      http.get(`${API}/drive/spaces`, () => HttpResponse.json([])),
      http.get(`${API}/drive/spaces/3/items`, () => HttpResponse.json(list)),
    ],
  })
  const items = await screen.findByTestId('drive-items')
  // 폴더가 먼저, 파일이 그다음.
  expect(items.textContent!.indexOf('기획 문서')).toBeLessThan(items.textContent!.indexOf('회의록.pdf'))
  expect(items).toHaveTextContent('회의록.pdf')
})

test('드라이브 위젯 — 공간이 0건이면 빈 상태를 보인다', async () => {
  renderScreen(<DriveWidget params={{}} />, { handlers: [http.get(`${API}/drive/spaces`, () => HttpResponse.json([]))] })
  expect(await screen.findByTestId('drive-empty')).toHaveTextContent('드라이브가 없어요')
})
