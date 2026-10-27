// 이슈 상세의 수정 버전·영향 버전 줄(WP-888) — 페이지 테스트(WP-971).
// 피커로 붙이기 → PUT 본문(보낸 종류만), 400 오류 → 토스트, 보관 버전의 피커 노출 규칙은 브라우저 없이 판정되므로
// e2e/pages/issue-versions.spec.ts 에서 옮겼다. 화면 배선(버전 목록·상세)과 화면을 넘는 흐름(필터 → URL, 타임라인 → 상세)은 E2E 에 남는다.
// 이슈 상세 화면 전체 대신 속성 레일과 같은 배선(상세 조회의 붙은 버전 → 두 줄)만 renderScreen 으로 띄운다(WP-1002) —
// PUT 뒤 상세 재조회가 칩으로 다시 내려오는 것까지 MSW 로 지난다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { IssueVersionsField } from '@/components/versions/IssueVersionsField'
import { useIssue } from '@/hooks/queries/useIssue'
import { BASE, KEY, versionApi, type VersionApiOptions } from '@/test/msw/versionHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createVersion, toVersionSummary } from '../../../e2e/factories/version.factory'

const V1 = createVersion({ id: 1, name: '1.0.0' })
const V2 = createVersion({ id: 2, name: '1.1.0' })

/** 속성 레일(IssuePropertyRail)과 같은 배선 — 이슈 상세 조회의 붙은 버전을 수정·영향 버전 줄에 넘긴다. */
function VersionRows() {
  const { data } = useIssue(KEY, 1)
  if (!data) return null
  return (
    <>
      <IssueVersionsField projectKey={KEY} issueNumber={1} kind="fix" current={data.summary.fixVersions ?? []} />
      <IssueVersionsField projectKey={KEY} issueNumber={1} kind="affects" current={data.summary.affectsVersions ?? []} />
    </>
  )
}

const renderRows = (handlers: RequestHandler[]) => renderScreen(<VersionRows />, { path: `/projects/${KEY}/issues/1`, handlers })

/** 이슈 상세를 열고 수정 버전 줄이 뜰 때까지 기다린다. extra 는 PUT 등 이 테스트의 응답. */
async function openIssue(opts: VersionApiOptions, extra: RequestHandler[] = []) {
  const api = versionApi(opts)
  const view = renderRows([...extra, ...api.handlers])
  await screen.findByTestId('issue-fix-versions-field')
  return { ...view, api }
}

describe('이슈 상세 — 버전 피커', () => {
  test('수정 버전을 하나 더 고르고 닫으면 PUT 본문이 fixVersionIds 만 담고(한 번) 칩이 늘어난다', async () => {
    const puts: unknown[] = []
    // 서버 상태 — PUT 뒤 상세 재조회가 붙은 칩을 돌려준다.
    let attached = [toVersionSummary(V1)]
    const api = versionApi({ versions: [V1, V2], issue: { fixVersions: attached, affectsVersions: [] } })
    const view = renderRows([
      http.put(`${BASE}/issues/1/versions`, async ({ request }) => {
        const body = (await request.json()) as { fixVersionIds: number[] }
        puts.push(body)
        attached = [V1, V2].filter((v) => body.fixVersionIds.includes(v.id)).map(toVersionSummary)
        api.issue.fixVersions = attached
        return HttpResponse.json({ fixVersions: attached, affectsVersions: [] })
      }),
      ...api.handlers,
    ])
    await screen.findByTestId('issue-fix-versions-field')
    expect(screen.getByTestId('issue-fix-versions')).toHaveTextContent('1.0.0')
    expect(screen.getByTestId('issue-affects-versions-field')).toBeInTheDocument()

    await view.user.click(screen.getByTestId('fix-version-picker-trigger'))
    const picker = await screen.findByTestId('fix-version-picker')
    expect(within(within(picker).getByTestId('fix-version-option-1')).getByRole('checkbox')).toBeChecked()
    await view.user.click(within(within(picker).getByTestId('fix-version-option-2')).getByRole('checkbox'))
    // 닫을 때 한 번만 저장한다 — 고르는 동안에는 요청이 없다.
    expect(puts).toEqual([])
    await view.user.keyboard('{Escape}')

    // 보낸 종류(수정 버전)만 담긴다 — 영향 버전 줄을 덮어쓰지 않는다.
    await waitFor(() => expect(puts).toEqual([{ fixVersionIds: [1, 2] }]))
    expect(await screen.findByText('버전을 저장했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('issue-fix-versions')).toHaveTextContent('1.1.0'))
    expect(screen.getByTestId('issue-fix-versions')).toHaveTextContent('1.0.0')
  })

  test('버전 API 가 400 이면 서버 메시지가 토스트로 보인다', async () => {
    const { user } = await openIssue({ versions: [V1], issue: { fixVersions: [], affectsVersions: [] } }, [
      http.put(`${BASE}/issues/1/versions`, () =>
        HttpResponse.json(
          { status: 400, message: '보관된 버전은 새로 붙일 수 없습니다', errors: { code: 'VERSION_ARCHIVED' } },
          { status: 400 },
        ),
      ),
    ])
    await user.click(screen.getByTestId('fix-version-picker-trigger'))
    await user.click(within(await screen.findByTestId('fix-version-option-1')).getByRole('checkbox'))
    await user.keyboard('{Escape}')

    expect(await screen.findByText('보관된 버전은 새로 붙일 수 없습니다')).toBeInTheDocument()
  })

  test('보관된 버전은 피커에 없고, 이 이슈에 이미 붙은 보관 버전만 「보관됨」으로 체크된 채 남는다', async () => {
    const attachedArchived = createVersion({ id: 2, name: '옛 버전', status: 'ARCHIVED' })
    const otherArchived = createVersion({ id: 3, name: '폐기 버전', status: 'ARCHIVED' })
    const { user } = await openIssue({
      versions: [V1, attachedArchived, otherArchived],
      issue: { fixVersions: [toVersionSummary(attachedArchived)], affectsVersions: [] },
    })
    await user.click(screen.getByTestId('fix-version-picker-trigger'))
    const picker = await screen.findByTestId('fix-version-picker')
    // 선택지 순서 — 보관 안 된 것 먼저, 붙은 보관 버전은 맨 뒤. 안 붙은 보관 버전은 없다.
    const ids = within(picker)
      .getAllByTestId(/^fix-version-option-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(ids).toEqual(['fix-version-option-1', 'fix-version-option-2'])
    expect(within(picker).getByTestId('fix-version-option-2')).toHaveTextContent('보관됨')
    expect(within(within(picker).getByTestId('fix-version-option-2')).getByRole('checkbox')).toBeChecked()
    expect(within(within(picker).getByTestId('fix-version-option-1')).getByRole('checkbox')).not.toBeChecked()
  })
})
