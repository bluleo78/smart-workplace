// 이슈 본문 이미지(WP-199) — 페이지 테스트(WP-980).
// 이미지 버튼 업로드 → 편집칸 끝 이미지 → 저장 본문 마크다운, 지워진 이미지(404) 대체 문구, 복원된 초안의 「업로드 중」 토큰 저장 안내는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-body-images.spec.ts 에서 옮겼다.
// WP-1656: 편집칸(본문 모드 RichInput) 안 이미지 — 기존 본문의 이미지가 편집칸 안 그림으로 열리고, 업로드 중엔 저장·단축키·Esc 가 막힌다.
// 붙여넣기·드롭(@input), 인증 blob 이미지 실제 디코딩·미리보기(@platform), 미리보기를 닫는 키·클릭이 편집으로 번지지 않음(@input)은 E2E 에 남는다.
// 화면 테스트(WP-1002) — 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(App·인증 부팅·앱 셸 없이). 속성 레일·본문·활동이 상세 재조회로 이어져 화면 단위로 둔다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
const UPLOAD_API = `/api/v1/projects/${KEY}/issue-images`
const PATCH_API = `/api/v1/projects/${KEY}/issues/1`
/** 1x1 PNG 앞부분 — 인증 이미지 응답 본문(blob 으로 받아 objectURL 이 된다). */
const PNG_BYTES = new Uint8Array([137, 80, 78, 71])
const pngFile = () => new File([PNG_BYTES], 'bug.png', { type: 'image/png' })
/** 업로드 응답 — 이 프로젝트 이미지 경로. */
const uploaded = () => HttpResponse.json({ fileId: 77, url: IMG_URL, name: 'bug.png', mimeType: 'image/png', size: 70 }, { status: 201 })
/** 인증 이미지 조회 — 편집칸 안 이미지가 blob 으로 받는다. */
const imageGet = http.get(IMG_URL, () => new HttpResponse(PNG_BYTES, { headers: { 'Content-Type': 'image/png' } }))
/** 「일어나지 않음」 확인용 짧은 대기. */
const settle = (ms = 300) => act(() => new Promise((r) => setTimeout(r, ms)))

/** 본문을 정해 상세를 연다. */
function openDetail(body: string, handlers: RequestHandler[] = [], members: ReturnType<typeof createMember>[] = []) {
  const ref = detailRefOf({ summary: createIssue({ id: 1, number: 1, title: '본문 이미지 대상' }), body })
  return renderIssueDetailScreen(DETAIL_PATH, { handlers: [...handlers, ...issueDetailHandlers({ detail: () => ref.current, members })] })
}

afterEach(() => window.localStorage.clear())

describe('이슈 본문 이미지 — 편집 (WP-199)', () => {
  test('편집 진입 후 이미지 버튼은 업로드한 이미지를 편집칸 끝에 그림으로 넣고, 저장하면 본문 끝에 마크다운이 붙는다', async () => {
    const uploads: string[] = []
    const patches: unknown[] = []
    const { user } = openDetail('기존 본문', [
      http.post(UPLOAD_API, async ({ request }) => {
        // jsdom File 은 undici 로 넘어가며 이름을 잃어(filename="blob") 파일 필드가 실렸는지만 본다.
        uploads.push((await request.text()).match(/name="file"/)?.[0] ?? '')
        return uploaded()
      }),
      imageGet,
      http.patch(PATCH_API, async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json(createIssue({ id: 1, number: 1 }))
      }),
    ])
    await user.click(await screen.findByRole('button', { name: '본문 편집' }, { timeout: SCREEN_LOAD_TIMEOUT }))
    await user.upload(screen.getByTestId('issue-body-image-input'), pngFile())
    const editor = screen.getByTestId('issue-body-textarea')
    // 편집칸 안 그림 — 업로드가 끝나면 자리표시가 실제 이미지(<img>)가 된다.
    await waitFor(() => expect(editor.querySelector('[data-testid="rich-image"] img')).not.toBeNull())
    expect(uploads).toEqual(['name="file"'])
    await user.click(screen.getByTestId('issue-body-save'))
    await waitFor(() => expect(patches).toEqual([{ body: `기존 본문\n![bug.png](${IMG_URL})\n` }]))
  })

  // WP-1656 ③: 저장된 본문의 이 프로젝트 이미지는 편집칸을 열어도 글자가 아니라 그림(보기 화면과 같은 크기 클래스)이다.
  test('이미지가 든 기존 본문을 열면 편집칸 안에 그 이미지가 그림으로 보인다', async () => {
    const { user } = openDetail(`재현 화면\n![bug.png](${IMG_URL})\n끝`, [imageGet])
    await user.click(await screen.findByRole('button', { name: '본문 편집' }, { timeout: SCREEN_LOAD_TIMEOUT }))
    const editor = await screen.findByTestId('issue-body-textarea')
    const img = await waitFor(() => {
      const found = editor.querySelector<HTMLImageElement>('[data-testid="rich-image"] img')
      if (!found) throw new Error('편집칸 안 이미지가 아직 없다')
      return found
    })
    expect(img).toHaveAttribute('alt', 'bug.png')
    expect(img).toHaveClass('max-h-[480px]', 'max-w-full')
    expect(editor).not.toHaveTextContent('![bug.png]')
  })

  // WP-1656 ④: 업로드 중(응답을 붙잡아 둠)에는 저장 버튼·취소 버튼이 비활성이고, Ctrl+Enter 는 저장하지 않으며 Esc 는 편집을 닫지 않는다.
  test('업로드 중에는 저장·취소가 비활성이고 Ctrl+Enter·Esc 가 무시되며, 끝나면 저장된다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const patches: unknown[] = []
    const { user } = openDetail('기존 본문', [
      http.post(UPLOAD_API, async () => {
        await gate
        return uploaded()
      }),
      imageGet,
      http.patch(PATCH_API, async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json(createIssue({ id: 1, number: 1 }))
      }),
    ])
    await user.click(await screen.findByRole('button', { name: '본문 편집' }, { timeout: SCREEN_LOAD_TIMEOUT }))
    await user.upload(screen.getByTestId('issue-body-image-input'), pngFile())
    const editor = screen.getByTestId('issue-body-textarea')
    expect(await screen.findByText('업로드 중…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('issue-body-save')).toBeDisabled())
    expect(screen.getByTestId('issue-body-cancel')).toBeDisabled()
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Escape' })
    await settle()
    expect(patches).toEqual([])
    expect(screen.getByTestId('issue-body-textarea')).toBeInTheDocument()

    release()
    await waitFor(() => expect(screen.getByTestId('issue-body-save')).toBeEnabled())
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(patches).toEqual([{ body: `기존 본문\n![bug.png](${IMG_URL})\n` }]))
  })

  test('복원된 초안에 업로드 중 토큰이 남아 있으면 저장하지 않고 안내 토스트를 띄운다', async () => {
    // 옛 Textarea 가 남긴 자리표시 토큰(WP-199) — 편집칸에는 글자로 열린다.
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
