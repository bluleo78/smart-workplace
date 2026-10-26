// AI 비서 챗 도크 위젯(#460·#465) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 위젯 지시(type·params) → 레지스트리 → 위젯 자체 조회 → 목록·상세·빈 상태·오류·파라미터 누락 안내는 브라우저 없이 판정되므로
// e2e/pages/home-widget-{calendar,issue-detail,projects,wiki}.spec.ts 에서 옮겼다.
// compose SSE → 챗 도크 → 위젯 배선은 home-widget-calendar.spec.ts 의 @wiring 1건이 지킨다.
// 챗 도크와 같은 경로(getChatWidget(type) → lazy 위젯)로 위젯 하나만 renderScreen 으로 띄운다 — 타입 키 매핑도 함께 지킨다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Suspense } from 'react'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'

import { calendarEvent } from '../../../../e2e/factories/calendar.factory'
import { createIssue, createIssueDetail } from '../../../../e2e/factories/issue.factory'
import { createMember, createProject } from '../../../../e2e/factories/project.factory'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../../e2e/factories/wiki.factory'
import { getChatWidget } from './chatWidgetRegistry'

/** 챗 도크(AIChatPanel)처럼 type 으로 위젯을 찾아 params 를 넘겨 그린다. */
function renderChatWidget(type: string, params: Record<string, unknown>, handlers: RequestHandler[] = []) {
  const Widget = getChatWidget(type)
  if (!Widget) throw new Error(`미등록 위젯: ${type}`)
  return renderScreen(
    <Suspense fallback={null}>
      <Widget params={params} />
    </Suspense>,
    { handlers },
  )
}

const pageOf = <T,>(items: T[]) => ({ content: items, page: 0, size: 20, totalElements: items.length, totalPages: 1 })

// ── 캘린더 ──

test('calendar 위젯 — date-only params 를 ISO 범위로 바꿔 조회하고 일정 목록을 그린다', async () => {
  const urls: URL[] = []
  renderChatWidget('calendar', { from: '2026-06-22', to: '2026-06-22' }, [
    http.get('/api/v1/calendar/events', ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json([
        calendarEvent({ id: 1, title: '팀 미팅', startsAt: '2026-06-22T02:00:00Z', endsAt: '2026-06-22T03:00:00Z' }),
        calendarEvent({ id: 2, title: '점심 약속', startsAt: '2026-06-22T04:00:00Z', endsAt: '2026-06-22T05:00:00Z' }),
      ])
    }),
  ])
  const items = await screen.findByTestId('calendar-items', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(items).toHaveTextContent('팀 미팅')
  expect(items).toHaveTextContent('점심 약속')
  // 처리: 하루짜리 date-only 범위도 from≠to 인 ISO datetime 으로 실린다(정규화 규칙 자체는 calendarRange.test.ts).
  const sp = urls.at(-1)!.searchParams
  expect(sp.get('from')).toMatch(/^2026-06-2\dT/)
  expect(sp.get('from')).not.toBe(sp.get('to'))
})

test('calendar 위젯 — 일정이 없으면 빈 상태를 보인다', async () => {
  renderChatWidget('calendar', {}, [http.get('/api/v1/calendar/events', () => HttpResponse.json([]))])
  expect(await screen.findByTestId('calendar-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('일정이 없어요')
})

test('event 위젯 — 단일 일정의 제목·장소·설명을 그린다', async () => {
  renderChatWidget('event', { eventId: 5 }, [
    http.get('/api/v1/calendar/events/5', () =>
      HttpResponse.json(
        calendarEvent({
          id: 5,
          title: '기획 발표',
          location: '3층 회의실',
          description: '분기 기획 발표 자료 리뷰',
          startsAt: '2026-06-22T06:00:00Z',
          endsAt: '2026-06-22T07:00:00Z',
        }),
      ),
    ),
  ])
  const detail = await screen.findByTestId('event-detail', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(detail).toHaveTextContent('기획 발표')
  expect(detail).toHaveTextContent('3층 회의실')
  expect(detail).toHaveTextContent('분기 기획 발표 자료 리뷰')
})

// ── 이슈 상세 ──

test('issue_detail 위젯 — 우선순위를 원시 enum 이 아니라 한글 라벨로 보인다(WP-886)', async () => {
  renderChatWidget('issue_detail', { number: 1, projectKey: 'WP' }, [
    http.get('/api/v1/projects/WP/issues/1', () =>
      HttpResponse.json(createIssueDetail({ summary: createIssue({ priority: 'HIGHEST' }) })),
    ),
  ])
  const detail = await screen.findByTestId('issuedetail', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(detail).toHaveTextContent('매우 높음')
  expect(detail).not.toHaveTextContent('HIGHEST')
})

test('issue_detail 위젯 — 조회가 실패하면 무한 스켈레톤이 아니라 재시도 가능한 오류를 보인다(#465)', async () => {
  renderChatWidget('issue_detail', { number: 9, projectKey: 'WP' }, [
    http.get('/api/v1/projects/WP/issues/9', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
  ])
  const error = await screen.findByTestId('issuedetail-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(error).toBeInTheDocument()
  expect(screen.queryByTestId('issuedetail')).not.toBeInTheDocument()
})

// ── 프로젝트 ──

test('projects 위젯 — 프로젝트 이름과 키를 목록으로 그린다', async () => {
  renderChatWidget('projects', {}, [
    http.get('/api/v1/projects', () =>
      HttpResponse.json(
        pageOf([createProject({ id: 1, key: 'ALPHA', name: '알파 프로젝트' }), createProject({ id: 2, key: 'BETA', name: '베타 프로젝트' })]),
      ),
    ),
  ])
  const items = await screen.findByTestId('projects-items', {}, { timeout: PAGE_LOAD_TIMEOUT })
  for (const text of ['알파 프로젝트', '베타 프로젝트', 'ALPHA', 'BETA']) expect(items).toHaveTextContent(text)
})

test('projects 위젯 — 결과가 없으면 빈 상태를 보인다', async () => {
  renderChatWidget('projects', {}, [http.get('/api/v1/projects', () => HttpResponse.json(pageOf([])))])
  expect(await screen.findByTestId('projects-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('프로젝트가 없어요')
})

test('project 위젯 — 프로젝트 상세(이름·설명)와 멤버를 그린다', async () => {
  renderChatWidget('project', { projectKey: 'ALPHA' }, [
    http.get('/api/v1/projects/ALPHA', () =>
      HttpResponse.json(createProject({ id: 1, key: 'ALPHA', name: '알파 프로젝트', description: '알파 팀 메인 프로젝트' })),
    ),
    http.get('/api/v1/projects/ALPHA/members', () =>
      HttpResponse.json([
        createMember({ userId: 1, username: 'kim', name: '김멤버', role: 'OWNER' }),
        createMember({ userId: 2, username: 'park', name: '박개발', role: 'MEMBER' }),
      ]),
    ),
  ])
  const detail = await screen.findByTestId('project-detail', {}, { timeout: PAGE_LOAD_TIMEOUT })
  for (const text of ['알파 프로젝트', '알파 팀 메인 프로젝트']) expect(detail).toHaveTextContent(text)
  // 멤버는 별도 조회라 늦게 올 수 있다.
  await waitFor(() => {
    expect(detail).toHaveTextContent('김멤버')
    expect(detail).toHaveTextContent('박개발')
  })
})

test('project 위젯 — projectKey 가 없으면 조회 없이 안내를 보인다', async () => {
  // 핸들러 없음 — 조회가 나가면 미처리 요청으로 테스트가 실패한다.
  renderChatWidget('project', {})
  expect(await screen.findByTestId('project-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('프로젝트 키가 없습니다')
})

// ── 노트(위키) ──

test('wiki 위젯 — spaceId 가 없으면 스페이스 목록을 그린다', async () => {
  renderChatWidget('wiki', {}, [
    http.get('/api/v1/wiki/spaces', () =>
      HttpResponse.json([wikiSpace({ id: 1, name: '팀 위키' }), wikiSpace({ id: 2, name: '개인 노트', type: 'PERSONAL' })]),
    ),
  ])
  const items = await screen.findByTestId('wiki-items', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(items).toHaveTextContent('팀 위키')
  expect(items).toHaveTextContent('개인 노트')
})

test('wiki 위젯 — spaceId 가 있으면 그 스페이스의 페이지 목록을 그린다', async () => {
  renderChatWidget('wiki', { spaceId: 1 }, [
    // 스페이스 이름 표시용으로 목록도 함께 부른다.
    http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: 1, name: '팀 위키' })])),
    http.get('/api/v1/wiki/spaces/1/pages', () =>
      HttpResponse.json([wikiPageSummary({ id: 101, title: '온보딩 가이드' }), wikiPageSummary({ id: 102, title: '개발 환경 설정' })]),
    ),
  ])
  const items = await screen.findByTestId('wiki-items', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(items).toHaveTextContent('온보딩 가이드')
  expect(items).toHaveTextContent('개발 환경 설정')
})

test('wiki 위젯 — 스페이스가 없으면 빈 상태를 보인다', async () => {
  renderChatWidget('wiki', {}, [http.get('/api/v1/wiki/spaces', () => HttpResponse.json([]))])
  expect(await screen.findByTestId('wiki-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('노트가 없어요')
})

test('wiki_page 위젯 — 페이지 제목과 본문을 그린다', async () => {
  renderChatWidget('wiki_page', { pageId: 101 }, [
    http.get('/api/v1/wiki/pages/101', () =>
      HttpResponse.json(wikiPageDetail({ id: 101, title: '온보딩 가이드', body: '# 온보딩\n신규 입사자를 위한 안내 문서입니다.' })),
    ),
  ])
  const detail = await screen.findByTestId('wiki_page-detail', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(detail).toHaveTextContent('온보딩 가이드')
  await waitFor(() => expect(detail).toHaveTextContent('신규 입사자를 위한 안내'))
})

test('wiki_page 위젯 — pageId 가 없으면 조회 없이 안내를 보인다', async () => {
  renderChatWidget('wiki_page', {})
  expect(await screen.findByTestId('wiki_page-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('페이지 ID가 없습니다')
})
