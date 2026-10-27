// 모바일 헤더·내비게이션(U1, WP-121) — 페이지 테스트(WP-981).
// ⋯ 메뉴 항목 구성(권한·보관), 메뉴에서 연 삭제·생성의 요청 payload 와 이동, 탭바 활성 폴백·고정(저장된 탭 설정에 따른 조건부 렌더),
// 탭 루트 제목은 브라우저 없이 판정되므로 e2e/pages/mobile/headers-nav.spec.ts 에서 옮겼다.
// 병합 헤더 높이·제목 폭·글꼴·가로 넘침(@layout), ⋯ 메뉴 바깥 누르기/Esc 닫기(@input), 히스토리에 기대는 ‹ 복귀(@platform)는 E2E 에 남는다.
// 탭바를 보는 판정(「탭바·탭 루트」의 탭 활성·고정)만 앱 셸이 필요해 renderPage 로 띄우고, 나머지(⋯ 메뉴·뒤로가기 바·연락처 ＋·작업 루트 제목)는
// 그 화면 또는 모듈 레이아웃만 renderScreen 으로 띄운다 — 이동은 도착 화면을 그리지 않고 주소만 본다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { ContactModuleLayout } from '@/components/contacts/ContactModuleLayout'
import { DriveModuleLayout } from '@/components/drive/DriveModuleLayout'
import { IssueModuleLayout } from '@/components/issue/IssueModuleLayout'
import { chatHandlers } from '@/test/kits/mobile/chatHistory'
import { renderMobileModule, renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { external, externalDetail, member, page as contactPage } from '../../../e2e/factories/contacts.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createChannel } from '../../../e2e/factories/messaging.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import ChannelPage from '../chat/ChannelPage'
import { ContactsPage } from '../contacts/ContactsPage'
import { DriveAttachmentsView } from '../drive/DriveAttachmentsView'
import IssueDetailPage from '../projects/IssueDetailPage'

mockViewport()

const KEY = 'WP'
const NUM = 2

describe('⋯ 메뉴', () => {
  test('이슈 상세: ⋯ → 삭제 → 확인 → DELETE 후 프로젝트로 이동', async () => {
    const deletes: string[] = []
    const base = `/api/v1/projects/${KEY}/issues/${NUM}`
    const { user, location } = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, {
      path: `/projects/${KEY}/issues/${NUM}`,
      handlers: [
        http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
        http.get(base, () =>
          HttpResponse.json(createIssueDetail({ summary: createIssue({ id: NUM, number: NUM, title: '하단 탭바 도입 검토' }), body: '본문', comments: [], history: [] })),
        ),
        http.delete(base, ({ request }) => {
          deletes.push(new URL(request.url).pathname)
          return new HttpResponse(null, { status: 204 })
        }),
        ...['watchers', 'labels', 'attachments', 'children'].map((sub) => http.get(`${base}/${sub}`, () => HttpResponse.json([]))),
        http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      ],
    })
    await user.click(await screen.findByTestId('mobile-header-more'))
    // 삭제(파괴적)·구독은 인라인이 아니라 ⋯ 메뉴 안에 있다.
    const menu = await screen.findByTestId('mobile-header-more-menu')
    expect(within(menu).getByTestId('watch-toggle')).toBeInTheDocument()
    await user.click(within(menu).getByTestId('issue-delete'))
    // 메뉴는 닫히고, 메뉴 항목이 연 다이얼로그는 살아 있다.
    const dialog = await screen.findByRole('alertdialog')
    // 메뉴 패널은 DOM 에 남고 class 로만 숨으므로(jsdom 은 CSS 를 모름) 여는 버튼의 펼침 상태로 닫힘을 본다.
    expect(screen.getByTestId('mobile-header-more')).toHaveAttribute('aria-expanded', 'false')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deletes).toEqual([base]))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
  })

  // WP-843: 보관된 채널은 이름을 바꿀 수 없다 — ⋯ 메뉴에도 「이름 변경」 없이 「보관 해제」만 남는다.
  test('보관된 채널(OWNER): ⋯ 메뉴에 이름 변경이 없고 보관 해제만 있다', async () => {
    const { user } = renderMobileRoute('/chat/channels/:id', <ChannelPage />, {
      path: '/chat/channels/1',
      handlers: [
        ...chatHandlers({ channels: [createChannel({ id: 1, name: '보관됨', archived: true, role: 'OWNER', member: true })] }),
        http.get('/api/v1/messaging/channels/1/messages', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
        http.get('/api/v1/messaging/channels/1/members', () => HttpResponse.json([])),
      ],
    })
    await user.click(await screen.findByTestId('mobile-header-more'))
    const menu = await screen.findByTestId('mobile-header-more-menu')
    expect(within(menu).getByTestId('channel-unarchive-action')).toBeInTheDocument()
    expect(within(menu).queryByTestId('channel-rename-action')).not.toBeInTheDocument()
  })
})

describe('헤더 없는 상세·연락처', () => {
  test('헤더가 없는 상세 화면(드라이브 첨부 모아보기)은 뒤로가기 바(‹·✦)를 하나 둔다', async () => {
    renderMobileModule(<DriveModuleLayout />, [['/drive/attachments', <DriveAttachmentsView />]], {
      path: '/drive/attachments',
      handlers: [http.get('/api/v1/drive/attachments', () => HttpResponse.json({ items: [], nextCursor: null }))],
    })
    expect(await screen.findByTestId('mobile-back-ai')).toBeInTheDocument()
    expect(screen.getAllByTestId('mobile-back')).toHaveLength(1)
  })

  test('연락처: 새 외부 연락처는 ⋯ 없이 ＋ 하나 — 입력 → POST payload → 다이얼로그 닫힘 → 목록 반영', async () => {
    const creates: unknown[] = []
    const { user } = renderMobileModule(<ContactModuleLayout />, [['/contacts', <ContactsPage />]], {
      path: '/contacts',
      handlers: [
        http.get('/api/v1/contacts', () =>
          HttpResponse.json(contactPage(creates.length ? [member(), external({ id: 200, name: '신규연락처' })] : [member()])),
        ),
        http.post('/api/v1/contacts/external', async ({ request }) => {
          creates.push(await request.json())
          return HttpResponse.json(externalDetail({ id: 200, name: '신규연락처' }), { status: 201 })
        }),
      ],
    })
    await user.click(await screen.findByTestId('contact-create'))
    expect(screen.queryByTestId('mobile-header-more')).not.toBeInTheDocument()
    await screen.findByTestId('external-contact-dialog')
    await user.type(screen.getByTestId('c-name'), '신규연락처')
    await user.type(screen.getByTestId('c-email'), 'new@corp.com')
    await user.click(screen.getByTestId('c-save'))
    await waitFor(() => expect(creates).toEqual([expect.objectContaining({ name: '신규연락처', email: 'new@corp.com' })]))
    await waitFor(() => expect(screen.queryByTestId('external-contact-dialog')).not.toBeInTheDocument())
    expect(await screen.findByTestId('contact-row-EXTERNAL-200')).toBeInTheDocument()
  })
})

describe('탭바·탭 루트', () => {
  test('탭바 활성 폴백: 고정하지 않은 노트에선 앱 탭이 활성', async () => {
    renderPage('/wiki', { handlers: [http.get('/api/v1/wiki/spaces', () => HttpResponse.json([]))] })
    expect(await screen.findByTestId('mobile-tab-apps', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveAttribute('aria-current', 'page')
  })

  test('노트를 고정하면 노트 탭이 활성 — WP-877 이전 3칸 형식도 읽고 뒤 2칸(캘린더·드라이브)을 기본 앱으로 채운다', async () => {
    window.localStorage.setItem('mobile-tabs', JSON.stringify(['home', 'chat', 'wiki']))
    renderPage('/wiki', { handlers: [http.get('/api/v1/wiki/spaces', () => HttpResponse.json([]))] })
    expect(await screen.findByTestId('mobile-tab-wiki', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mobile-tab-drive')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-tab-apps')).not.toHaveAttribute('aria-current', 'page')
  })

  test('알림을 탭바에 고정하면 탭 루트 — 큰 제목 헤더(모두 읽음 포함)와 탭바, ‹ 없음', async () => {
    window.localStorage.setItem('mobile-tabs', JSON.stringify(['home', 'notifications', 'mail']))
    // 알림 화면의 푸시 안내가 부르는 설정 — 푸시를 쓰지 않는 서버로 둔다.
    renderPage('/notifications', { handlers: [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))] })
    expect(await screen.findByTestId('mobile-tab-notifications', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mobile-tabbar')).toBeInTheDocument()
    const header = screen.getByTestId('mobile-list-header')
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('알림')
    expect(within(header).getByTestId('inbox-mark-all')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-back')).not.toBeInTheDocument()
  })

  test('작업 탭 루트 제목은 탭 라벨과 같은 "작업"', async () => {
    // 작업 루트 목록·큰 제목은 탭바가 아니라 작업 모듈 레이아웃이 그린다.
    renderMobileModule(<IssueModuleLayout />, [['/tasks', <></>]], { path: '/tasks' })
    const header = await screen.findByTestId('mobile-list-header')
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('작업')
  })
})
