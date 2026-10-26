// 이슈 채팅 첨부(#446·WP-848) — 페이지 테스트(WP-980).
// 25MB 초과 파일 사전 거름과 드라이브 링크 선택 → driveFileIds 에 drive_file.id(PK) 전송은 브라우저 없이 판정되므로
// e2e/pages/projects/issue-chat-attachment.spec.ts 에서 옮겼다. 그 spec 에는 실제 파일 선택 → 업로드 → fileIds 전송 흐름(@input)이 남는다.
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueChatHandlers, openIssueDetail, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'

import { createChatMember, createChatThread } from '../../../e2e/factories/chat.factory'
import { createFile } from '../../../e2e/factories/drive.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const THREAD_ID = 100
const ME_ID = 1
const PERSONAL_SPACE_ID = 10

const thread = createChatThread({
  threadId: THREAD_ID,
  issueId: 1,
  members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
  recentMessages: [],
})

/** 개인 드라이브 공간 1개 — 컴포저의 드라이브 링크 항목이 켜진다. */
const personalSpace = {
  id: PERSONAL_SPACE_ID, type: 'PERSONAL', name: '개인 공간', ownerId: ME_ID, role: 'OWNER', archived: false, createdAt: '2026-01-01T00:00:00Z',
}

/** 이슈 상세를 열고 채팅 드로워를 연다. */
async function openChatDrawer(handlers: RequestHandler[] = []) {
  const view = await openIssueDetail({
    detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '첨부 테스트' }) }),
    driveSpaces: [personalSpace] as never,
    handlers: [...handlers, ...issueChatHandlers({ thread })],
  })
  await view.user.click(screen.getByTestId('issue-chat-open'))
  await screen.findByTestId('chat-section', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

describe('이슈 채팅 첨부', () => {
  // WP-848: 고를 때 바로 빼고 이름과 함께 알린다 — 서버 「유효하지 않은 첨부」까지 가지 않는다.
  test('25MB 를 넘는 파일은 업로드하지 않고 이름과 함께 알린다', async () => {
    const requests = recordRequests()
    const { user } = await openChatDrawer()
    const input = await screen.findByTestId<HTMLInputElement>('chat-composer-file-input')
    const huge = new File(['x'], 'huge.zip', { type: 'application/zip' })
    // 실제 25MB 버퍼 대신 size 만 한도 + 1 로 — 판정은 File.size 로만 한다.
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 + 1 })
    await user.upload(input, huge)

    expect(await screen.findByText('huge.zip는 25MB 한도를 초과합니다')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-composer-attachments')).not.toBeInTheDocument()
    // 늦게 나가는 업로드가 없는지 잠시 더 본다(부재 확인).
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(requests.count('POST', `/api/v1/chat/threads/${THREAD_ID}/attachments`)).toBe(0)
  })

  // #446: 피커가 넘기는 값은 drive_file.id(PK) 여야 한다 — blob fileId 를 넘기면 서버가 404.
  test('드라이브 링크로 고른 파일은 칩·전송 payload 모두 drive_file.id(PK) 를 쓴다', async () => {
    const DRIVE_PK = 300
    const BLOB_ID = 999
    const requests = recordRequests()
    const { user } = await openChatDrawer([
      http.get(`/api/v1/drive/spaces/${PERSONAL_SPACE_ID}/items`, () =>
        HttpResponse.json({ folders: [], files: [createFile({ id: DRIVE_PK, fileId: BLOB_ID, name: 'report.pdf' })] } as never),
      ),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/messages`, () =>
        HttpResponse.json({
          id: 2001, threadId: THREAD_ID, authorId: ME_ID, authorName: '테스트 사용자', authorKind: 'HUMAN', body: '',
          mentions: [], attachments: [], driveLinks: [], createdAt: '2026-01-01T00:00:00Z', editedAt: null, deleted: false,
        }, { status: 201 }),
      ),
    ])

    await user.click(screen.getByTestId('chat-composer-attach-button'))
    const driveLinkBtn = await screen.findByTestId('chat-composer-drive-link-btn')
    expect(driveLinkBtn).not.toHaveAttribute('data-disabled')
    await user.click(driveLinkBtn)
    await user.click(await screen.findByTestId(`file-picker-file-${DRIVE_PK}`))

    await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())
    expect(screen.getByTestId(`chat-composer-drive-chip-${DRIVE_PK}`)).toBeInTheDocument()

    await user.click(screen.getByTestId('chat-composer-submit'))
    await waitFor(() =>
      expect(requests.bodies('POST', `/api/v1/chat/threads/${THREAD_ID}/messages`)).toEqual([
        expect.objectContaining({ driveFileIds: [DRIVE_PK] }),
      ]),
    )
  })
})
