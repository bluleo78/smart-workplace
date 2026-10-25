// WP-962 보관·옮기기·삭제 노출 판정과 「옮기기」 메뉴 구성 단위 테스트.
import { describe, expect, it } from 'vitest'

import type { MailServerFolder } from '@/types/mailFolder'

import { isInboxView, mailMoveAvailability, mailMoveTargets, mailMoveToastMessage } from './mailMoveActions'

const f = (o: Partial<MailServerFolder> & { id: number }): MailServerFolder => ({
  displayName: `메일함${o.id}`, parentId: null, role: 'USER', selectable: true, unreadCount: 0, totalCount: 0,
  syncedSince: null, folderSyncedAt: null, ...o,
})

// 보관(1) · 프로젝트(2) ⊃ 2026(3) · 묶음(4, 메일 못 담음) ⊃ 거래처(5)
const folders = [
  f({ id: 1, role: 'ARCHIVE', displayName: 'Archive' }),
  f({ id: 2, displayName: '프로젝트' }),
  f({ id: 3, displayName: '2026', parentId: 2 }),
  f({ id: 4, displayName: '묶음', selectable: false }),
  f({ id: 5, displayName: '거래처', parentId: 4 }),
]

const keys = (view: Parameters<typeof mailMoveTargets>[0], fs = folders) => mailMoveTargets(view, fs).map((t) => t.key)

describe('mailMoveTargets', () => {
  it('받은편지함 계열 보기엔 받은편지함이 없고 보관·내 메일함 트리(깊이 포함)가 온다', () => {
    for (const kind of ['work', 'all', 'category', 'needsReply'] as const) {
      expect(keys({ kind, folderId: null })).toEqual(['archive', 'folder-4', 'folder-5', 'folder-2', 'folder-3'])
    }
    const t = mailMoveTargets({ kind: 'work', folderId: null }, folders)
    expect(t.find((x) => x.key === 'folder-3')).toMatchObject({ depth: 1, target: { kind: 'FOLDER', folderId: 3 } })
    expect(t.find((x) => x.key === 'archive')).toMatchObject({ label: '보관', target: { kind: 'ARCHIVE' }, section: 'base' })
    // 메일을 담지 못하는 묶음은 이름만(고를 수 없음)
    expect(t.find((x) => x.key === 'folder-4')?.selectable).toBe(false)
  })

  it('보관 보기엔 보관이 없고 받은편지함이 맨 앞', () => {
    expect(keys({ kind: 'folder', folderId: 1 })).toEqual(['inbox', 'folder-4', 'folder-5', 'folder-2', 'folder-3'])
  })

  it('내 메일함 보기엔 그 메일함만 빠지고 하위는 남는다', () => {
    expect(keys({ kind: 'folder', folderId: 2 })).toEqual(['inbox', 'archive', 'folder-4', 'folder-5', 'folder-3'])
  })

  it('보낸편지함·임시보관함은 옮길 곳이 없다', () => {
    expect(keys({ kind: 'sent', folderId: null })).toEqual([])
    expect(keys({ kind: 'drafts', folderId: null })).toEqual([])
  })

  it('메일함 목록 전·보관 없는 계정', () => {
    expect(keys({ kind: 'work', folderId: null }, [])).toEqual([])
    expect(mailMoveTargets({ kind: 'folder', folderId: 9 }, undefined).map((t) => t.key)).toEqual(['inbox'])
  })
})

describe('mailMoveAvailability', () => {
  it('받은편지함: 보관·옮기기·삭제', () => {
    expect(mailMoveAvailability({ kind: 'work', folderId: null }, folders)).toEqual({ archive: true, move: true, trash: true })
  })
  it('보관 보기: 보관 숨김', () => {
    expect(mailMoveAvailability({ kind: 'folder', folderId: 1 }, folders)).toEqual({ archive: false, move: true, trash: true })
  })
  it('보관 메일함이 없으면 보관 숨김, 고를 메일함이 없으면 옮기기 숨김', () => {
    expect(mailMoveAvailability({ kind: 'all', folderId: null }, [])).toEqual({ archive: false, move: false, trash: true })
    expect(mailMoveAvailability({ kind: 'all', folderId: null }, [f({ id: 4, selectable: false })]).move).toBe(false)
  })
  it('보낸편지함·임시보관함: 아무것도 없음', () => {
    expect(mailMoveAvailability({ kind: 'sent', folderId: null }, folders)).toEqual({ archive: false, move: false, trash: false })
    expect(mailMoveAvailability({ kind: 'drafts', folderId: null }, folders)).toEqual({ archive: false, move: false, trash: false })
  })
})

describe('mailMoveToastMessage', () => {
  it('대상별 문구', () => {
    expect(mailMoveToastMessage({ kind: 'ARCHIVE' }, folders)).toBe('보관했습니다')
    expect(mailMoveToastMessage({ kind: 'TRASH' }, folders)).toBe('삭제했습니다')
    expect(mailMoveToastMessage({ kind: 'INBOX' }, folders)).toBe('받은편지함으로 옮겼습니다')
    expect(mailMoveToastMessage({ kind: 'FOLDER', folderId: 2 }, folders)).toBe("'프로젝트' 메일함으로 옮겼습니다")
    expect(mailMoveToastMessage({ kind: 'FOLDER', folderId: 1 }, folders)).toBe('보관했습니다')
    expect(mailMoveToastMessage({ kind: 'TRASH' }, folders, 3)).toBe('3통을 삭제했습니다')
  })
})

describe('isInboxView', () => {
  it('받은편지함 계열만', () => {
    expect(['work', 'all', 'category', 'needsReply', 'folder', 'sent', 'drafts'].map((k) => isInboxView(k as never))).toEqual([
      true, true, true, true, false, false, false,
    ])
  })
})
