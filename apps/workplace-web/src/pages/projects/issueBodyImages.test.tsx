// 이슈 본문 이미지(WP-199) — 페이지 테스트(WP-980).
// 이미지 버튼 업로드 → 본문 끝 마크다운, 지워진 이미지(404) 대체 문구, 복원된 초안의 「업로드 중」 토큰 저장 안내는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-body-images.spec.ts 에서 옮겼다.
// 붙여넣기·드롭(@input), 인증 blob 이미지 실제 디코딩·미리보기(@platform), 미리보기를 닫는 키·클릭이 편집으로 번지지 않음(@input)은 E2E 에 남는다.
// 화면 테스트(WP-1002) — 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(App·인증 부팅·앱 셸 없이). 속성 레일·본문·활동이 상세 재조회로 이어져 화면 단위로 둔다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { afterEach, describe, expect, test } from 'vitest'

import { issueBodyDraftKey } from '@/lib/issueBodyDraft'
import { DETAIL_PATH, detailRefOf, KEY } from '@/test/kits/projects/issueDetailRef'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'

const IMG_URL = `/api/v1/projects/${KEY}/issue-images/77`

/** 본문을 정해 상세를 연다. */
function openDetail(body: string, handlers: RequestHandler[] = [], members: ReturnType<typeof createMember>[] = []) {
  const ref = detailRefOf({ summary: createIssue({ id: 1, number: 1, title: '본문 이미지 대상' }), body })
  return renderIssueDetailScreen(DETAIL_PATH, { handlers: [...handlers, ...issueDetailHandlers({ detail: () => ref.current, members })] })
}

afterEach(() => window.localStorage.clear())

describe('이슈 본문 이미지 — 편집 (WP-199)', () => {
  test('편집 진입 후 이미지 버튼은 업로드한 이미지 마크다운을 본문 끝에 덧붙인다', async () => {
    const uploads: string[] = []
    const { user } = openDetail('기존 본문', [
      http.post(`/api/v1/projects/${KEY}/issue-images`, async ({ request }) => {
        // jsdom File 은 undici 로 넘어가며 이름을 잃어(filename="blob") 파일 필드가 실렸는지만 본다.
        uploads.push((await request.text()).match(/name="file"/)?.[0] ?? '')
        return HttpResponse.json({ fileId: 77, url: IMG_URL, name: 'bug.png', mimeType: 'image/png', size: 70 }, { status: 201 })
      }),
    ])
    await user.click(await screen.findByRole('button', { name: '본문 편집' }, { timeout: SCREEN_LOAD_TIMEOUT }))
    await user.upload(screen.getByTestId('issue-body-image-input'), new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByTestId('issue-body-textarea')).toHaveValue(`기존 본문\n![bug.png](${IMG_URL})\n`))
    expect(uploads).toEqual(['name="file"'])
  })

  test('복원된 초안에 업로드 중 토큰이 남아 있으면 저장하지 않고 안내 토스트를 띄운다', async () => {
    window.localStorage.setItem(issueBodyDraftKey({ userId: 1, tenantId: null }, KEY, 1), '남은 글\n![업로드 중… #1]()')
    const patches: unknown[] = []
    const { user } = openDetail('기존 본문', [
      http.patch(`/api/v1/projects/${KEY}/issues/1`, async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json({})
      }),
    ])
    await user.click(await screen.findByRole('button', { name: '본문 편집' }, { timeout: SCREEN_LOAD_TIMEOUT }))
    await user.click(await screen.findByRole('button', { name: '불러오기' }))
    await user.click(screen.getByTestId('issue-body-save'))
    expect(await screen.findByText('업로드가 끝나지 않은 이미지가 있습니다', { exact: false })).toBeInTheDocument()
    expect(patches).toEqual([])
  })
})

describe('이슈 본문 이미지 — 표시 (WP-199)', () => {
  test('지워졌거나 수거된 이미지(404)는 대체 문구를 보여준다', async () => {
    openDetail(`![gone.png](${IMG_URL})`, [http.get(IMG_URL, () => HttpResponse.json({}, { status: 404 }))])
    expect(await screen.findByText('이미지를 불러올 수 없음', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
  })
})

// 이슈 설명의 멘션(WP-1134) — AI 가 MCP·API 로 쓴 <@id> 가 코멘트와 같은 「@이름」 칩으로 보인다. 코드 안 토큰은 글자 그대로.
describe('이슈 본문 멘션 (WP-1134)', () => {
  test('본문의 <@id> 는 멤버 이름 칩(AI 는 AI 색)이고, 코드 안 토큰은 글자 그대로다', async () => {
    openDetail('담당 <@2> 와 <@99> 확인, 코드 `<@2>`', [], [
      createMember({ userId: 2, name: '김개발', kind: 'HUMAN' }),
      createMember({ userId: 99, name: 'AI 비서', kind: 'AGENT' }),
    ])
    const human = await screen.findByTestId('issue-body-mention-chip-2', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    expect(human).toHaveTextContent('@김개발')
    expect(human).toHaveClass('bg-muted', 'whitespace-nowrap')
    expect(screen.getByTestId('issue-body-mention-chip-99')).toHaveClass('bg-ai-accent-subtle', 'text-ai-accent')
    // 칩은 코드 밖 두 개뿐 — 코드 안 토큰은 원문 그대로 남는다.
    expect(screen.getAllByTestId(/^issue-body-mention-chip-/)).toHaveLength(2)
    const body = screen.getByRole('button', { name: '본문 편집' })
    expect(body.querySelector('code')?.textContent).toBe('<@2>')
    expect(body).not.toHaveTextContent('담당 <@2>')
  })
})
