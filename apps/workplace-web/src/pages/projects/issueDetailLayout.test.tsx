// 이슈 상세 레이아웃(#343·WP-272·WP-944·#798·#823) — 페이지 테스트(WP-980).
// 속성 그룹 접힘·배지, 보고자 표시·바꾸기(PUT·넘기기 확인), 첨부 스트립·드라이브 공간 1회 조회, 브레드크럼 이동,
// 본문 컨테이너 클래스, 본문 편집 beforeunload 경고는 브라우저 없이 판정되므로 e2e/pages/projects/issue-detail-layout.spec.ts 에서 옮겼다.
// 그 spec 에는 탭 배선(@wiring)·탭 전환 뒤 초안 유지(@input)·채팅 드로워 Esc 닫기(브라우저 history, @platform)·폭별 배치(@layout)가 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import type { IssueDetailResponse } from '@/types/issue'
import type { LabelSummary } from '@/types/label'

import { createAttachment } from '../../../e2e/factories/attachment.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'

const KEY = 'PROJ'
const BASE = `/api/v1/projects/${KEY}/issues/1`

/** 요약·상세 필드를 덮어쓴 상세 응답. */
function detailWith(summary: Parameters<typeof createIssue>[0] = {}, rest: Partial<IssueDetailResponse> = {}) {
  return createIssueDetail({ summary: createIssue({ projectKey: KEY, ...summary }), ...rest })
}

describe('속성 레일 3그룹', () => {
  test('분류·관계 그룹은 기본 접힘이고 개수 배지를 보이며, 헤더를 누르면 펼친다', async () => {
    const labels: LabelSummary[] = [{ id: 1, name: 'bug', colorToken: 'RED' }]
    const { user } = await openIssueDetail({ key: KEY, detail: detailWith({ labels }) })
    expect(screen.getByTestId('property-group-status-people')).toBeInTheDocument()
    expect(screen.getByTestId('issue-status-select')).toBeInTheDocument()
    const classGroup = screen.getByTestId('property-group-classification')
    expect(screen.queryByTestId('issue-labels')).not.toBeInTheDocument()
    expect(within(classGroup).getByTestId('property-group-badge')).toHaveTextContent('1')
    await user.click(within(classGroup).getByRole('button', { name: /분류/ }))
    expect(await screen.findByTestId('issue-labels')).toBeInTheDocument()
  })
})

describe('보고자 (WP-272·WP-944)', () => {
  test('상태·담당 그룹 담당자 아래에 읽기 전용 보고자 이름과 생성일이 보인다', async () => {
    await openIssueDetail({
      key: KEY,
      detail: detailWith({ createdAt: '2026-10-03T12:00:00Z' }, { reporter: { id: 5, username: 'kim', name: '김보고', kind: 'HUMAN' } }),
    })
    const group = screen.getByTestId('property-group-status-people')
    const reporter = within(group).getByTestId('issue-reporter')
    expect(reporter).toHaveTextContent('김보고')
    expect(within(reporter).getByTestId('issue-reporter-created')).toHaveTextContent('· 10월 3일 생성')
    expect(within(reporter).queryByRole('button')).not.toBeInTheDocument()
    // 담당자 필드 뒤(문서 순서)에 놓인다 — 실제 세로 좌표는 같은 순서의 블록 배치라 DOM 순서로 지킨다.
    const assignee = within(group).getByTestId('assignee-picker-trigger')
    expect(assignee.compareDocumentPosition(reporter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('보고자를 바꿀 수 있으면 활성 사람 구성원(AI·비활성·지금 보고자 제외)을 골라 PUT 으로 바꾼다', async () => {
    const puts: unknown[] = []
    const { user } = await openIssueDetail({
      key: KEY,
      detail: detailWith({}, { reporter: { id: 5, username: 'kim', name: '김보고', kind: 'HUMAN' }, viewerCanChangeReporter: true }),
      members: [
        createMember({ userId: 5, username: 'kim', name: '김보고', kind: 'HUMAN' }),
        createMember({ userId: 7, username: 'lee', name: '이새보고', kind: 'HUMAN' }),
        createMember({ userId: 9, username: 'bot', name: '이슈 에이전트', kind: 'AGENT' }),
        createMember({ userId: 8, username: 'off', name: '정지된분', kind: 'HUMAN', active: false }),
      ],
      handlers: [
        http.put(`${BASE}/reporter`, async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json({ id: 7, username: 'lee', name: '이새보고', kind: 'HUMAN' })
        }),
      ],
    })
    await user.click(screen.getByTestId('reporter-picker-trigger'))
    const picker = await screen.findByTestId('reporter-picker')
    expect(within(picker).getByTestId('reporter-option-7')).toBeInTheDocument()
    expect(within(picker).queryByTestId('reporter-option-9')).not.toBeInTheDocument()
    expect(within(picker).queryByTestId('reporter-option-8')).not.toBeInTheDocument()
    expect(within(picker).queryByTestId('reporter-option-5')).not.toBeInTheDocument()
    await user.click(within(picker).getByTestId('reporter-option-7'))
    await waitFor(() => expect(puts).toEqual([{ userId: 7 }]))
    expect(await screen.findByText('보고자를 바꿨습니다')).toBeInTheDocument()
    // 다른 사람이 바꿀 때는 넘기기 확인창이 없다.
    expect(screen.queryByTestId('reporter-handover-confirm')).not.toBeInTheDocument()
  })

  test('지금 보고자가 스스로 넘기면 확인창을 거친다 — 취소하면 바꾸지 않는다', async () => {
    const puts: unknown[] = []
    const { user } = await openIssueDetail({
      key: KEY,
      // 로그인 사용자(id 1)가 보고자다.
      detail: detailWith({}, { reporter: { id: 1, username: 'testuser', name: '테스트', kind: 'HUMAN' }, viewerCanChangeReporter: true }),
      members: [
        createMember({ userId: 1, username: 'testuser', name: '테스트', kind: 'HUMAN' }),
        createMember({ userId: 7, username: 'lee', name: '이새보고', kind: 'HUMAN' }),
      ],
      handlers: [
        http.put(`${BASE}/reporter`, async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json({ id: 7, username: 'lee', name: '이새보고', kind: 'HUMAN' })
        }),
      ],
    })
    await user.click(screen.getByTestId('reporter-picker-trigger'))
    await user.click(await screen.findByTestId('reporter-option-7'))
    const confirm = await screen.findByTestId('reporter-handover-confirm')
    expect(confirm).toHaveTextContent('보고자를 이새보고님에게 넘길까요?')
    await user.click(within(confirm).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('reporter-handover-confirm')).not.toBeInTheDocument())
    expect(puts).toEqual([])

    await user.click(screen.getByTestId('reporter-picker-trigger'))
    await user.click(await screen.findByTestId('reporter-option-7'))
    await user.click(await screen.findByTestId('reporter-handover-confirm-ok'))
    await waitFor(() => expect(puts).toEqual([{ userId: 7 }]))
  })

  test('AI(AGENT)가 만든 이슈는 보고자 아바타에 에이전트 표식이 붙는다', async () => {
    await openIssueDetail({ key: KEY, detail: detailWith({}, { reporter: { id: 9, username: 'issue-agent', name: '이슈 에이전트', kind: 'AGENT' } }) })
    const reporter = screen.getByTestId('issue-reporter')
    expect(reporter).toHaveTextContent('이슈 에이전트')
    expect(within(reporter).getByLabelText('이슈 에이전트 (에이전트)')).toBeInTheDocument()
  })

  test('보고자 정보를 찾지 못하면 「알 수 없음」으로 표시한다', async () => {
    await openIssueDetail({ key: KEY, detail: detailWith({}, { reporter: null }) })
    expect(screen.getByTestId('issue-reporter')).toHaveTextContent('알 수 없음')
  })

  // 롤링 배포 중 구 API 응답 — reporter 키 자체가 없으면 「알 수 없음」으로 오해하게 하지 않는다.
  test('구버전 서버라 reporter 필드가 없으면 보고자 행을 숨긴다', async () => {
    const detail = detailWith()
    delete detail.reporter
    await openIssueDetail({ key: KEY, detail })
    expect(screen.getByTestId('issue-status-select')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-reporter')).not.toBeInTheDocument()
    expect(screen.getByTestId('property-group-status-people')).not.toHaveTextContent('보고자')
  })
})

describe('첨부 스트립 (#343·#798)', () => {
  // 채팅 컴포저(useAttachmentDraft)와 첨부 스트립이 함께 마운트돼도 공용 useDriveSpaces 로 한 번만 조회한다.
  test('드라이브 스페이스 조회가 중복 호출되지 않는다 (#798)', async () => {
    const requests = recordRequests()
    const { user } = await openIssueDetail({ key: KEY, detail: detailWith({ attachmentCount: 0 }) })
    expect(await screen.findByTestId('issue-attachment-strip')).toBeInTheDocument()
    // 채팅 컴포저는 드로워 안에서 늦게 마운트된다 — 연 뒤에 그 중복 호출을 본다.
    await user.click(screen.getByTestId('issue-chat-open'))
    expect(await screen.findByTestId('chat-composer-input')).toBeInTheDocument()
    await waitFor(() => expect(requests.count('GET', '/api/v1/drive/spaces')).toBe(1))
    // 늦게 붙는 중복 호출이 없는지 잠시 더 본다(부재 확인 — 컴포저 마운트 직후 효과까지 흘려보낸다).
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(requests.count('GET', '/api/v1/drive/spaces')).toBe(1)
  })

  test('첨부는 본문 아래 스트립으로 보이고 속성 레일엔 없다', async () => {
    await openIssueDetail({
      key: KEY,
      detail: detailWith({ attachmentCount: 2 }),
      attachments: [
        createAttachment({ fileId: 1, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 1234, attachedById: 9 }),
        createAttachment({ fileId: 2, originalName: 'shot.png', mimeType: 'image/png', sizeBytes: 5678, attachedById: 9 }),
      ],
    })
    const strip = screen.getByTestId('issue-attachment-strip')
    expect(await within(strip).findByText('spec.pdf')).toBeInTheDocument()
    expect(within(screen.getByTestId('property-rail')).queryByText('첨부')).not.toBeInTheDocument()
  })

  test('첨부가 0개인 스트립은 「첨부가 없습니다」 대신 드롭존만 보인다', async () => {
    await openIssueDetail({ key: KEY, detail: detailWith({ attachmentCount: 0 }) })
    const strip = screen.getByTestId('issue-attachment-strip')
    const dropzone = await within(strip).findByTestId('attachment-dropzone')
    expect(dropzone).toHaveTextContent('파일을 드롭하거나 클릭해 첨부')
    expect(within(strip).queryByText('첨부가 없습니다')).not.toBeInTheDocument()
  })
})

describe('헤더·본문', () => {
  // 이슈 상세 → 목록 복귀 경로 부재 회귀 방지.
  test('브레드크럼 프로젝트 링크 클릭 → 프로젝트 홈으로 이동', async () => {
    const { user, location } = await openIssueDetail({ key: KEY, detail: detailWith() })
    const nav = screen.getByRole('navigation', { name: '이슈 경로' })
    await user.click(within(nav).getByRole('link', { name: 'Workplace' }))
    // 이동은 전환(transition)으로 일어나 프로젝트 화면 모듈을 처음 불러오는 동안 주소가 그대로다 — 첫 화면 대기만큼 기다린다.
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`), { timeout: PAGE_LOAD_TIMEOUT })
  })

  // Tailwind `container` 는 브레이크포인트별 max-width 를 강제한다 — 본문 조상 어디에도 없어야 전체폭을 쓴다.
  test('본문 컨테이너는 중앙정렬 max-width(container) 없이 전체폭을 쓴다', async () => {
    await openIssueDetail({ key: KEY, detail: detailWith() })
    let node = screen.getByTestId('issue-title-heading').parentElement
    while (node) {
      expect(node.classList.contains('container')).toBe(false)
      node = node.parentElement
    }
  })

  // 켜짐 조건·리스너 등록은 issueDraft.test.ts·useUnsavedChangesWarning.test.tsx — 여기선 본문 편집 → 경고 → 취소 → 해제 배선.
  test('본문 편집 중엔 beforeunload 경고가 켜지고, 취소하면 해제된다 (#823)', async () => {
    const dispatchBeforeUnload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    const { user } = await openIssueDetail({ key: KEY, detail: detailWith() })
    await user.click(screen.getByRole('button', { name: '본문 편집' }))
    const textarea = await screen.findByTestId('issue-body-textarea')
    await user.clear(textarea)
    await user.paste('취소될 변경사항')
    await waitFor(() => expect(dispatchBeforeUnload()).toBe(true))
    await user.click(screen.getByTestId('issue-body-cancel'))
    await waitFor(() => expect(dispatchBeforeUnload()).toBe(false))
  })
})
