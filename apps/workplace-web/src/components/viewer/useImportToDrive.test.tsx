// @vitest-environment jsdom
// useImportToDrive(WP-1526) — 저장 창에서 쓸 수 있는 공간 고르기·마지막 저장 위치 기억.
// 작은 하네스 컴포넌트가 훅을 부르고 MSW 가 공간·폴더 경로·저장 API 를 준다. localStorage 는 setup.ts 가 테스트마다 비운다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, test } from 'vitest'

import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { DriveSpace } from '@/types/drive'

import { createSpace, personalSpace } from '../../../e2e/factories/drive.factory'
import type { DriveImportTarget } from './types'
import { useImportToDrive } from './useImportToDrive'

// Radix Select 는 jsdom 에 없는 포인터 캡처·scrollIntoView 를 부른다 — 빈 구현으로 채운다.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

const PERSONAL = personalSpace({ id: 1 })
const TEAM = createSpace({ id: 5, type: 'TEAM', name: '마케팅팀', role: 'EDITOR' })
const VIEWER_TEAM = createSpace({ id: 6, type: 'TEAM', name: '보기전용팀', role: 'VIEWER' })
const CHANNEL = createSpace({ id: 7, type: 'CHANNEL', name: '채널공간', role: 'EDITOR' })
const SPACES: DriveSpace[] = [PERSONAL, TEAM, VIEWER_TEAM, CHANNEL]

const FILE_TARGET: DriveImportTarget = { kind: 'file', fileId: 77 }
const MAIL_TARGET: DriveImportTarget = { kind: 'mail', mailAttachmentId: 88 }

/** 훅을 부르는 하네스 — 버튼 둘로 대상을 바꿔 begin 한다. */
function Harness() {
  const importer = useImportToDrive()
  return (
    <div>
      <button type="button" onClick={() => importer.begin(FILE_TARGET, { name: '보고서.pdf', mimeType: 'application/pdf' })}>file</button>
      <button type="button" onClick={() => importer.begin(MAIL_TARGET, { name: '보고서.pdf', mimeType: 'application/pdf' })}>mail</button>
      {importer.picker}
    </div>
  )
}

type Posts = { url: string; body: unknown }[]

/** 하네스를 띄운다 — spaces 는 함수로 받아 테스트 중에 바꿀 수 있다(보관 처리 등). */
function setup({ spaces = () => SPACES, path }: { spaces?: () => DriveSpace[]; path?: (id: number) => Response | null } = {}) {
  const posts: Posts = []
  const view = renderScreen(<Harness />, {
    handlers: [
      http.get('/api/v1/drive/spaces', () => HttpResponse.json(spaces())),
      http.get('/api/v1/drive/spaces/:sid/items', () => HttpResponse.json({ folders: [], files: [] })),
      http.get('/api/v1/drive/folders/:id/path', ({ params }) => {
        const custom = path?.(Number(params.id))
        return custom ?? HttpResponse.json([{ id: Number(params.id), name: '기억폴더' }])
      }),
      http.post('/api/v1/drive/spaces/:sid/import-attachment', async ({ request }) => {
        posts.push({ url: new URL(request.url).pathname, body: await request.json() })
        return HttpResponse.json({})
      }),
      http.post('/api/v1/drive/spaces/:sid/folders/:fid/import-attachment', async ({ request }) => {
        posts.push({ url: new URL(request.url).pathname, body: await request.json() })
        return HttpResponse.json({})
      }),
      http.post('/api/v1/mail/attachments/:id/save-to-drive', async ({ request }) => {
        posts.push({ url: new URL(request.url).pathname, body: await request.json() })
        return HttpResponse.json({})
      }),
    ],
  })
  return { ...view, posts }
}

/** 저장 창이 열려 있는 상태에서 ▾ 로 공간을 고른다. */
async function pickSpace(user: ReturnType<typeof setup>['user'], name: string) {
  await user.click(screen.getByTestId('folder-picker-space-select'))
  await user.click(await screen.findByRole('option', { name }))
}

describe('useImportToDrive 저장 위치', () => {
  test('처음엔 내 드라이브 루트로 열리고 채널·보기 전용 공간은 ▾ 목록에 없다', async () => {
    const { user } = setup()
    await user.click(screen.getByText('file'))
    const dialog = await screen.findByTestId('folder-picker')
    expect(within(dialog).getByTestId('folder-picker-space-root')).toHaveTextContent('내 드라이브')
    expect(within(dialog).getByTestId('folder-picker-file')).toHaveTextContent('보고서.pdf')
    await user.click(screen.getByTestId('folder-picker-space-select'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['내 드라이브', '마케팅팀'])
  })

  test('팀 공간을 골라 저장하면 그 공간 id 로 import-attachment 를 부른다', async () => {
    const { user, posts } = setup()
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    await pickSpace(user, '마케팅팀')
    await user.click(screen.getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].url).toBe('/api/v1/drive/spaces/5/import-attachment')
  })

  test('저장 창에서 새 폴더를 만들고 「여기에 저장」 하면 만든 폴더 id 로 가져온다 (WP-1527)', async () => {
    const { user, posts } = setup()
    server.use(
      http.post('/api/v1/drive/spaces/:sid/folders', () => HttpResponse.json({ id: 55, name: '새로 만든 폴더', parentId: null })),
    )
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    await user.click(screen.getByTestId('folder-picker-new'))
    await user.type(screen.getByTestId('folder-picker-new-input'), '새로 만든 폴더{Enter}')
    await waitFor(() => expect(screen.getByTestId('folder-picker-location')).toHaveTextContent('새로 만든 폴더'))
    await user.click(screen.getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].url).toBe('/api/v1/drive/spaces/1/folders/55/import-attachment')
  })

  test('메일 대상이면 save-to-drive 본문에 팀 공간 id 와 folderId null 을 보낸다', async () => {
    const { user, posts } = setup()
    await user.click(screen.getByText('mail'))
    await screen.findByTestId('folder-picker')
    await pickSpace(user, '마케팅팀')
    await user.click(screen.getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].url).toBe('/api/v1/mail/attachments/88/save-to-drive')
    expect(posts[0].body).toEqual({ spaceId: 5, folderId: null })
  })

  test('저장 뒤 다시 열면 그 팀 공간 루트로 열린다', async () => {
    const { user, posts } = setup()
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    await pickSpace(user, '마케팅팀')
    await user.click(screen.getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())

    await user.click(screen.getByText('file'))
    expect(await screen.findByTestId('folder-picker-space-root')).toHaveTextContent('마케팅팀')
  })

  test('기억한 폴더가 있으면 경로 API 의 이름으로 그 폴더 안에서 열린다', async () => {
    localStorage.setItem('drive-save-location:1:1', JSON.stringify({ spaceId: 5, folderId: 42 }))
    const { user } = setup()
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe('마케팅팀›기억폴더')
  })

  test('기억한 폴더 경로 조회가 404 면 내 드라이브 루트로 열린다', async () => {
    localStorage.setItem('drive-save-location:1:1', JSON.stringify({ spaceId: 5, folderId: 42 }))
    const { user } = setup({ path: () => new HttpResponse(null, { status: 404 }) })
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe('내드라이브')    // 폴더가 없다는 것이 확인됐으니 기억한 위치를 지운다.
    expect(localStorage.getItem('drive-save-location:1:1')).toBeNull()
  })

  test('기억한 폴더 경로 조회가 5xx 면 이번만 내 드라이브 루트로 열고 기억한 위치는 남긴다', async () => {
    const saved = JSON.stringify({ spaceId: 5, folderId: 42 })
    localStorage.setItem('drive-save-location:1:1', saved)
    const { user } = setup({ path: () => new HttpResponse(null, { status: 500 }) })
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe('내드라이브')
    expect(localStorage.getItem('drive-save-location:1:1')).toBe(saved)
  })

  test('기억한 폴더 경로의 마지막 id 가 기억한 folderId 와 다르면 내 드라이브 루트로 열린다', async () => {
    localStorage.setItem('drive-save-location:1:1', JSON.stringify({ spaceId: 5, folderId: 42 }))
    const { user } = setup({ path: () => HttpResponse.json([{ id: 99, name: '다른폴더' }]) })
    await user.click(screen.getByText('file'))
    await screen.findByTestId('folder-picker')
    expect(screen.getByTestId('folder-picker-location').textContent?.replace(/\s/g, '')).toBe('내드라이브')
    expect(localStorage.getItem('drive-save-location:1:1')).toBeNull()
  })

  test('기억한 공간이 보관 처리되면 내 드라이브 루트로 열린다', async () => {
    localStorage.setItem('drive-save-location:1:1', JSON.stringify({ spaceId: 5, folderId: null }))
    const { user } = setup({ spaces: () => [PERSONAL, { ...TEAM, archived: true }] })
    await user.click(screen.getByText('file'))
    expect(await screen.findByTestId('folder-picker-space-root')).toHaveTextContent('내 드라이브')
  })
})
