// 이슈 「관계」 그룹(WP-887·WP-852) — 화면 테스트(WP-980, WP-1002 에서 이슈 상세 화면만 띄우게 바꿈).
// 관계 추가 창(찾기 쿼리·POST payload·말 방향·차단 거름·409 오류·Enter 1회), 줄 제거 DELETE, 읽기 전용, 외부 링크(키 자동·POST/PUT/DELETE·검증),
// 반대쪽 이슈 상세의 말(「결과임」 등)은 상태 있는 모킹 서버 응답 → 화면 반영이라 브라우저 없이 판정되므로
// e2e/pages/projects/issue-relations.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다). 저장소는 E2E 와 같은 IssueRelationServer 다.
// 차단 저장 경로는 dependencies.spec 이 맡는다.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { IssueRelationServer, relationHandlers } from '@/test/kits/projects/relations'
import type { ScreenUser } from '@/test/renderScreen'
import type { IssueLookupItem } from '@/types/issue'

import { makeTaskType } from '../../../e2e/factories/issueType.factory'

const KEY = 'WP'
const REL = `/api/v1/projects/${KEY}/issues/1/relations`
const EXT = `/api/v1/projects/${KEY}/issues/1/external-links`
const JIRA = 'https://iacloud.atlassian.net/browse/CL-1867'

const lookupItem = (projectKey: string, number: number, title: string): IssueLookupItem => ({ projectKey, number, title, status: 'TODO', type: makeTaskType() })

/** 서버를 깔고 이슈 WP-1·WP-2·WPV-28 을 만든다. */
function setup() {
  const server = new IssueRelationServer()
  server.addIssue('WP-1', '결제 모듈')
  server.addIssue('WP-2', '환불 처리')
  server.addIssue('WPV-28', '다른 프로젝트 이슈')
  return { server, requests: recordRequests() }
}

type User = ScreenUser

/** 이슈 상세를 열고 「관계」 그룹을 펼친다(기본 접힘, 펼침 상태는 저장소에 남을 수 있다). */
async function openIssue(server: IssueRelationServer, number = 1, key = KEY) {
  const view = renderIssueDetailScreen(`/projects/${key}/issues/${number}`, { handlers: relationHandlers(server) })
  const group = await screen.findByTestId('property-group-relations')
  const trigger = within(group).getByRole('button', { name: /^관계(\s*\d+)?$/ })
  if (trigger.getAttribute('aria-expanded') !== 'true') await view.user.click(trigger)
  await screen.findByTestId('issue-relations-section')
  return view
}

/** 반대쪽 이슈 상세로 다시 연다(앞 화면은 내린다). */
async function reopen(server: IssueRelationServer, number: number) {
  cleanup()
  return openIssue(server, number)
}

/** 관계 추가 창을 열고 「이 이슈는…」 선택지(typeId:side)를 고른다. */
async function openDialog(user: User, option: string) {
  await user.click(screen.getByTestId('issue-relation-add'))
  expect(await screen.findByTestId('issue-relation-dialog')).toBeInTheDocument()
  await chooseType(user, option)
}
async function chooseType(user: User, option: string) {
  await user.click(screen.getByTestId('issue-relation-type-select'))
  await user.click(await screen.findByTestId(`issue-relation-option-${option}`))
}

/** 이슈 찾기 입력 — 디바운스(250ms) 뒤 찾기 요청이 그 값으로 나갈 때까지 기다린다. */
async function search(requests: ReturnType<typeof recordRequests>, q: string) {
  fireEvent.change(screen.getByTestId('issue-relation-search'), { target: { value: q } })
  await waitFor(() => expect(requests.last('GET', '/api/v1/issues/lookup')?.search.get('q')).toBe(q))
}

describe('이슈 관계', () => {
  test('같은 프로젝트 「관련」 추가 → 찾기 쿼리(q·from)·자기 제외 → POST payload → 양쪽 상세에 「관련」', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 1, '결제 모듈'), lookupItem(KEY, 2, '환불 처리')]
    const { user } = await openIssue(server)
    expect(screen.getByTestId('issue-relations-section')).toHaveTextContent(/^없음$/)
    await openDialog(user, '2:source')
    // 번호만 쳐도 그대로 묻고 현재 프로젝트를 from 으로 싣는다. 자기 자신(#1)은 목록에서 빠진다.
    await search(requests, '2')
    expect(requests.last('GET', '/api/v1/issues/lookup')!.search.get('from')).toBe(KEY)
    await user.click(await screen.findByTestId('issue-relation-result-WP-2'))
    expect(screen.queryByTestId('issue-relation-result-WP-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent('#2 환불 처리')
    await user.click(screen.getByTestId('issue-relation-submit'))

    await waitFor(() => expect(requests.bodies('POST', REL)).toEqual([{ typeId: 2, side: 'source', target: { projectKey: KEY, number: 2 } }]))
    expect(await screen.findByText('관계를 추가했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('issue-relation-dialog')).not.toBeInTheDocument())
    const group = await screen.findByTestId('issue-relation-group-2-source')
    await waitFor(() => expect(group).toHaveTextContent('환불 처리'))
    expect(within(group).getByTestId('issue-relation-row-100')).toHaveTextContent('#2')

    await reopen(server, 2)
    expect(await screen.findByTestId('issue-relation-group-2-source')).toHaveTextContent('결제 모듈')
    expect(screen.getByTestId('issue-relation-group-heading-2-source')).toHaveTextContent(/^관련$/)
  })

  test('「원인임」 추가 → 「#2」 도 그대로 묻고, 활동 타임라인에 「관계 추가」, 상대 상세엔 「결과임」', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')]
    const { user } = await openIssue(server)
    await openDialog(user, '5:source')
    await search(requests, '#2')
    await user.click(await screen.findByTestId('issue-relation-result-WP-2'))
    await user.click(screen.getByTestId('issue-relation-submit'))
    await waitFor(() => expect(requests.bodies('POST', REL)).toEqual([{ typeId: 5, side: 'source', target: { projectKey: KEY, number: 2 } }]))
    expect(await screen.findByTestId('issue-relation-group-heading-5-source')).toHaveTextContent(/^원인임$/)
    await waitFor(() => expect(screen.getByTestId('issue-relation-group-5-source')).toHaveTextContent('환불 처리'))
    await user.click(screen.getByRole('tab', { name: /이력/ }))
    const timeline = await screen.findByTestId('issue-activity-timeline')
    await waitFor(() => expect(timeline).toHaveTextContent('관계 추가'))
    expect(timeline).toHaveTextContent('원인임 「환불 처리」(#2)')

    await reopen(server, 2)
    expect(await screen.findByTestId('issue-relation-group-heading-5-target')).toHaveTextContent(/^결과임$/)
    expect(screen.getByTestId('issue-relation-group-5-target')).toHaveTextContent('결제 모듈')
  })

  test('B 쪽 말(「결과임」)로 추가하면 side=target 으로 저장되고 상대에겐 「원인임」', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')]
    const { user } = await openIssue(server)
    await openDialog(user, '5:target')
    await search(requests, '2')
    await user.click(await screen.findByTestId('issue-relation-result-WP-2'))
    await user.click(screen.getByTestId('issue-relation-submit'))
    await waitFor(() => expect(requests.bodies('POST', REL)).toEqual([{ typeId: 5, side: 'target', target: { projectKey: KEY, number: 2 } }]))
    await waitFor(() => expect(screen.getByTestId('issue-relation-group-5-target')).toHaveTextContent('환불 처리'))
    await reopen(server, 2)
    expect(await screen.findByTestId('issue-relation-group-5-source')).toHaveTextContent('결제 모듈')
  })

  test('다른 프로젝트 이슈를 키로 찾아 추가 → 「WPV-28」 표시, 링크로 그 이슈 상세로 간다', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem('WPV', 28, '다른 프로젝트 이슈')]
    const { user, location } = await openIssue(server)
    await openDialog(user, '2:source')
    await search(requests, 'WPV-28')
    await user.click(await screen.findByTestId('issue-relation-result-WPV-28'))
    expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent('WPV-28')
    await user.click(screen.getByTestId('issue-relation-submit'))
    await waitFor(() => expect(requests.bodies('POST', REL)).toEqual([{ typeId: 2, side: 'source', target: { projectKey: 'WPV', number: 28 } }]))
    const row = await within(await screen.findByTestId('issue-relation-group-2-source')).findByTestId('issue-relation-row-100')
    expect(row).toHaveTextContent('WPV-28')
    const link = within(row).getByRole('link', { name: /다른 프로젝트 이슈/ })
    expect(link).toHaveAttribute('href', '/projects/WPV/issues/28')
    await user.click(link)
    await waitFor(() => expect(location()).toBe('/projects/WPV/issues/28'))
    await waitFor(() => expect(screen.getByTestId('issue-title-heading')).toHaveTextContent('다른 프로젝트 이슈'))
  })

  test('이미 있는 관계(409) → 오류 토스트, 창과 고른 이슈는 그대로, 저장되지 않는다', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')]
    server.failNextRelationPost = { status: 409, code: 'ISSUE_RELATION_EXISTS', message: '이미 같은 관계가 있습니다' }
    const { user } = await openIssue(server)
    await openDialog(user, '2:source')
    await search(requests, '2')
    await user.click(await screen.findByTestId('issue-relation-result-WP-2'))
    await user.click(screen.getByTestId('issue-relation-submit'))
    expect(await screen.findByText('이미 같은 관계가 있습니다')).toBeInTheDocument()
    expect(requests.count('POST', REL)).toBe(1)
    expect(screen.getByTestId('issue-relation-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent('#2 환불 처리')
    expect(screen.getByTestId('issue-relation-submit')).toBeEnabled()
    expect(server.relations).toHaveLength(0)
  })

  test('줄 제거 → DELETE 경로 + 토스트 + 양쪽 상세에서 사라짐', async () => {
    const { server, requests } = setup()
    // 서버에 미리 걸려 있는 관계 — 화면을 거치지 않고 시드한다.
    server.relations.push({ id: 7, typeId: 2, source: { projectKey: KEY, number: 1 }, target: { projectKey: KEY, number: 2 } })
    const { user } = await openIssue(server)
    expect(await screen.findByTestId('issue-relation-row-7')).toHaveTextContent('환불 처리')
    await user.click(screen.getByTestId('issue-relation-remove-7'))
    await waitFor(() => expect(requests.count('DELETE', `${REL}/7`)).toBe(1))
    expect(await screen.findByText('관계를 제거했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('issue-relation-row-7')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-relations-section')).toHaveTextContent(/^없음$/)
    await reopen(server, 2)
    expect(screen.getByTestId('issue-relations-section')).toHaveTextContent(/^없음$/)
  })

  test('편집 권한이 없으면 「＋ 관계 추가」·제거 버튼이 없고 관계는 읽기만 된다', async () => {
    const { server } = setup()
    server.viewerCanEditWorkflow = false
    server.relations.push({ id: 7, typeId: 2, source: { projectKey: KEY, number: 1 }, target: { projectKey: KEY, number: 2 } })
    await openIssue(server)
    expect(await screen.findByTestId('issue-relation-row-7')).toHaveTextContent('환불 처리')
    expect(screen.queryByTestId('issue-relation-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-relation-remove-7')).not.toBeInTheDocument()
  })
})

describe('외부 링크', () => {
  test('Jira 주소를 붙이면 키가 채워지고 「에픽에 속함」으로 추가 → 새 탭 링크, 수정(주소 잠김) PUT, 제거 DELETE', async () => {
    const { server, requests } = setup()
    const { user } = await openIssue(server)
    // 에픽에 속함은 외부 전용이라 이슈 탭엔 없다 — 외부 링크 탭으로 바꾼 뒤 고른다.
    await user.click(screen.getByTestId('issue-relation-add'))
    await user.click(await screen.findByTestId('issue-relation-tab-external'))
    await chooseType(user, '6:source')
    fireEvent.change(screen.getByTestId('issue-relation-url'), { target: { value: JIRA } })
    await waitFor(() => expect(screen.getByTestId('issue-relation-key')).toHaveValue('CL-1867'))
    fireEvent.change(screen.getByTestId('issue-relation-title'), { target: { value: 'v1.7.0 버그 픽스 및 이슈 대응' } })
    await user.click(screen.getByTestId('issue-relation-submit'))
    await waitFor(() =>
      expect(requests.bodies('POST', EXT)).toEqual([{ typeId: 6, side: 'source', url: JIRA, key: 'CL-1867', title: 'v1.7.0 버그 픽스 및 이슈 대응' }]),
    )
    expect(await screen.findByText('외부 링크를 추가했습니다')).toBeInTheDocument()
    const id = server.externals[0].id
    const row = await screen.findByTestId(`issue-external-link-row-${id}`)
    expect(row).toHaveTextContent('에픽에 속함')
    expect(row).toHaveTextContent('CL-1867')
    const open = screen.getByTestId(`issue-external-link-open-${id}`)
    expect(open).toHaveAttribute('href', JIRA)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open.getAttribute('rel')).toMatch(/noopener/)

    // 수정 — 주소는 잠기고 제목만 바꾼다. 처음 선택지가 서버가 준 쪽이라 그 쪽을 그대로 보낸다.
    await user.click(screen.getByTestId(`issue-external-link-edit-${id}`))
    expect(await screen.findByTestId('issue-relation-url')).toBeDisabled()
    fireEvent.change(screen.getByTestId('issue-relation-title'), { target: { value: 'v1.7.1 대응' } })
    await user.click(screen.getByTestId('issue-relation-submit'))
    await waitFor(() => expect(requests.bodies('PUT', `${EXT}/${id}`)).toEqual([{ typeId: 6, side: 'source', key: 'CL-1867', title: 'v1.7.1 대응' }]))
    await waitFor(() => expect(screen.getByTestId(`issue-external-link-row-${id}`)).toHaveTextContent('v1.7.1 대응'))

    await user.click(screen.getByTestId(`issue-external-link-remove-${id}`))
    await waitFor(() => expect(requests.count('DELETE', `${EXT}/${id}`)).toBe(1))
    await waitFor(() => expect(screen.queryByTestId(`issue-external-link-row-${id}`)).not.toBeInTheDocument())
  })

  test('주소·제목이 비거나 주소가 http(s) 가 아니면 보내지 않고 오류 문구를 보인다', async () => {
    const { server, requests } = setup()
    const { user } = await openIssue(server)
    await user.click(screen.getByTestId('issue-relation-add'))
    await user.click(await screen.findByTestId('issue-relation-tab-external'))
    await user.click(screen.getByTestId('issue-relation-submit'))
    expect(await screen.findByText('주소를 입력해 주세요')).toBeInTheDocument()
    expect(screen.getByText('제목을 입력해 주세요')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('issue-relation-url'), { target: { value: 'ftp://example.com/x' } })
    expect(await screen.findByText('http:// 또는 https:// 로 시작하는 주소를 입력해 주세요')).toBeInTheDocument()
    expect(requests.count('POST', EXT)).toBe(0)
    expect(screen.getByTestId('issue-relation-dialog')).toBeInTheDocument()
  })
  test('제목이 보이지 않는 글자(제로폭 공백·한글 채움)뿐이면 공백처럼 막는다 (WP-1107)', async () => {
    const { server, requests } = setup()
    const { user } = await openIssue(server)
    await user.click(screen.getByTestId('issue-relation-add'))
    await user.click(await screen.findByTestId('issue-relation-tab-external'))
    fireEvent.change(screen.getByTestId('issue-relation-url'), { target: { value: 'https://docs.example.com/spec' } })
    fireEvent.change(screen.getByTestId('issue-relation-title'), { target: { value: '\u200B\u3164\u2800' } })
    await user.click(screen.getByTestId('issue-relation-submit'))
    expect(await screen.findByText('제목을 입력해 주세요')).toBeInTheDocument()
    expect(requests.count('POST', EXT)).toBe(0)
  })
})

describe('관계 추가 창 — 차단·Enter', () => {
  test('「차단 중」은 같은 프로젝트만 — 다른 프로젝트 결과는 응답에 있어도 숨기고, 「관련」으로 바꾸면 보인다', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 3, '같은 프로젝트'), lookupItem('WPV', 9, '다른 프로젝트')]
    const { user } = await openIssue(server)
    await openDialog(user, '1:source')
    expect(screen.getByTestId('issue-relation-results')).toHaveTextContent('차단은 이 프로젝트 이슈와만 걸 수 있어요.')
    await search(requests, 'WP')
    expect(await screen.findByTestId('issue-relation-result-WP-3')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-relation-result-WPV-9')).not.toBeInTheDocument()
    await chooseType(user, '2:source')
    expect(await screen.findByTestId('issue-relation-result-WPV-9')).toBeInTheDocument()
  })

  test('「관련」으로 다른 프로젝트 이슈를 고른 뒤 「차단 중」으로 바꾸면 고른 이슈가 풀린다', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 3, '같은 프로젝트'), lookupItem('WPV', 9, '다른 프로젝트')]
    const { user } = await openIssue(server)
    await openDialog(user, '2:source')
    await search(requests, 'WP')
    await user.click(await screen.findByTestId('issue-relation-result-WPV-9'))
    expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent('WPV-9')
    expect(screen.getByTestId('issue-relation-submit')).toBeEnabled()
    await chooseType(user, '1:source')
    await waitFor(() => expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent(/^목록에서 이슈를 하나 고르세요\.$/))
    expect(screen.getByTestId('issue-relation-submit')).toBeDisabled()
    await user.click(screen.getByTestId('issue-relation-result-WP-3'))
    expect(screen.getByTestId('issue-relation-submit')).toBeEnabled()
  })

  test('찾기 입력에서 Enter → 고른 이슈가 없으면 보내지 않고, 있으면 한 번만 추가한다 (WP-852)', async () => {
    const { server, requests } = setup()
    server.lookupItems = [lookupItem(KEY, 2, '환불 처리')]
    const { user } = await openIssue(server)
    await openDialog(user, '2:source')
    await search(requests, '2')
    const input = screen.getByTestId('issue-relation-search')
    expect(await screen.findByTestId('issue-relation-result-WP-2')).toBeInTheDocument()
    // 고르기 전 Enter — 요청 없음, 창 유지.
    await user.type(input, '{Enter}')
    expect(screen.getByTestId('issue-relation-dialog')).toBeInTheDocument()
    expect(requests.count('POST', REL)).toBe(0)
    await user.click(screen.getByTestId('issue-relation-result-WP-2'))
    await user.type(input, '{Enter}')
    await waitFor(() => expect(requests.bodies('POST', REL)).toEqual([{ typeId: 2, side: 'source', target: { projectKey: KEY, number: 2 } }]))
    await waitFor(() => expect(screen.queryByTestId('issue-relation-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('issue-relation-group-2-source')).toHaveTextContent('환불 처리'))
    // 새 줄이 그려진 뒤에도 요청은 한 번뿐이다.
    expect(requests.count('POST', REL)).toBe(1)
  })
})
