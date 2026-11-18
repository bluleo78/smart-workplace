// WP-962 보관·옮기기·삭제 노출 판정과 「옮기기」 메뉴 구성 단위 테스트.
import { describe, expect, it } from 'vitest'

import type { MailServerFolder } from '@/types/mailFolder'

import { isInboxView, mailMoveAvailability, mailMoveTargets, mailMoveToastMessage, mailRowMoveScope } from './mailMoveActions'

const f = (o: Partial<MailServerFolder> & { id: number }): MailServerFolder => ({
  displayName: `메일함${o.id}`, parentId: null, role: 'USER', selectable: true, unreadCount: 0, totalCount: 0,
  syncedSince: null, folderSyncedAt: null, permanentDeleteUnsupported: false, ...o,
})

// 보관(1) · 프로젝트(2) ⊃ 2026(3) · 묶음(4, 메일 못 담음) ⊃ 거래처(5)
const folders = [
  f({ id: 1, role: 'ARCHIVE', displayName: 'Archive' }),
  f({ id: 2, displayName: '프로젝트' }),
  f({ id: 3, displayName: '2026', parentId: 2 }),
  f({ id: 4, displayName: '묶음', selectable: false }),
  f({ id: 5, displayName: '거래처', parentId: 4 }),
  // WP-1681 휴지통 — 옮기기 메뉴에는 나오지 않는다.
  f({ id: 9, role: 'TRASH', displayName: 'Trash' }),
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

  it('휴지통은 어느 보기에서도 옮길 곳이 아니다(WP-1681)', () => {
    expect(keys({ kind: 'work', folderId: null })).not.toContain('folder-9')
    expect(keys({ kind: 'folder', folderId: 1 })).not.toContain('folder-9')
  })

  it('메일함 목록 전·보관 없는 계정', () => {
    expect(keys({ kind: 'work', folderId: null }, [])).toEqual([])
    expect(mailMoveTargets({ kind: 'folder', folderId: 9 }, undefined).map((t) => t.key)).toEqual(['inbox'])
  })
})

describe('mailMoveAvailability', () => {
  it('받은편지함: 보관·옮기기·삭제', () => {
    expect(mailMoveAvailability({ kind: 'work', folderId: null }, folders)).toEqual({ archive: true, move: true, trash: true, restore: false })
  })
  it('보관 보기: 보관 숨김', () => {
    expect(mailMoveAvailability({ kind: 'folder', folderId: 1 }, folders)).toEqual({ archive: false, move: true, trash: true, restore: false })
  })
  it('휴지통 보기: 되살리기만(WP-1681)', () => {
    expect(mailMoveAvailability({ kind: 'folder', folderId: 9 }, folders)).toEqual({ archive: false, move: false, trash: false, restore: true })
  })
  it('보관 메일함이 없으면 보관 숨김, 고를 메일함이 없으면 옮기기 숨김', () => {
    expect(mailMoveAvailability({ kind: 'all', folderId: null }, [])).toEqual({ archive: false, move: false, trash: true, restore: false })
    expect(mailMoveAvailability({ kind: 'all', folderId: null }, [f({ id: 4, selectable: false })]).move).toBe(false)
  })
  it('보낸편지함·임시보관함: 아무것도 없음', () => {
    expect(mailMoveAvailability({ kind: 'sent', folderId: null }, folders)).toEqual({ archive: false, move: false, trash: false, restore: false })
    expect(mailMoveAvailability({ kind: 'drafts', folderId: null }, folders)).toEqual({ archive: false, move: false, trash: false, restore: false })
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
    // WP-1681 되살리기 — 원래 메일함(없으면 받은편지함)으로 돌아간다.
    expect(mailMoveToastMessage({ kind: 'RESTORE' }, folders)).toBe('되살렸습니다')
    expect(mailMoveToastMessage({ kind: 'RESTORE' }, folders, 2)).toBe('2통을 되살렸습니다')
  })
})

describe('isInboxView', () => {
  it('받은편지함 계열만', () => {
    expect(['work', 'all', 'category', 'needsReply', 'folder', 'sent', 'drafts'].map((k) => isInboxView(k as never))).toEqual([
      true, true, true, true, false, false, false,
    ])
  })
})

describe('mailRowMoveScope (WP-1742 별표 보기의 메일별 판정 — 이름이 아니라 메일함 id·역할)', () => {
  const flagged = { kind: 'flagged', folderId: null } as const
  type Row = { folderId?: number | null; folderRole?: string | null } | null
  const scopeOf = (row: Row, fs = folders) => mailRowMoveScope(flagged, fs, row)
  const rowKeys = (row: Row) => {
    const scope = scopeOf(row)
    return scope ? mailMoveTargets(scope, folders).map((t) => t.key) : []
  }
  const rowAvail = (row: Row) => {
    const scope = scopeOf(row)
    return scope ? mailMoveAvailability(scope, folders) : null
  }

  it('받은편지함(INBOX) 메일 — 받은편지함으로 옮기기가 없다', () => {
    expect(scopeOf({ folderId: 100, folderRole: 'INBOX' })).toEqual({ kind: 'all', folderId: null })
    expect(rowKeys({ folderId: 100, folderRole: 'INBOX' })).not.toContain('inbox')
    expect(rowAvail({ folderId: 100, folderRole: 'INBOX' })).toMatchObject({ archive: true, trash: true })
  })
  it('보관(ARCHIVE) 메일 — 보관이 없고 받은편지함으로는 옮길 수 있다', () => {
    const row = { folderId: 1, folderRole: 'ARCHIVE' }
    expect(scopeOf(row)).toEqual({ kind: 'folder', folderId: 1 })
    expect(rowKeys(row)).toContain('inbox')
    expect(rowKeys(row)).not.toContain('archive')
    expect(rowAvail(row)?.archive).toBe(false)
  })
  it('내 메일함(USER) 메일 — 그 메일함만 빠진다(이름이 같은 메일함이 있어도 id 로 고른다)', () => {
    const row = { folderId: 2, folderRole: 'USER' }
    expect(rowKeys(row)).not.toContain('folder-2')
    expect(rowKeys(row)).toContain('folder-3')
    expect(scopeOf(row, [...folders, f({ id: 7, displayName: '프로젝트' })])).toEqual({ kind: 'folder', folderId: 2 })
  })
  it('보낸(SENT) 메일 — 앱 발송 기록(folderId 없음)이든 서버 보낸편지함이든 옮기기·보관·삭제가 없다', () => {
    expect(rowAvail({ folderId: null, folderRole: 'SENT' })).toEqual({ archive: false, move: false, trash: false, restore: false })
    expect(rowAvail({ folderId: 77, folderRole: 'SENT' })).toEqual({ archive: false, move: false, trash: false, restore: false })
  })
  it('행·메일함을 모르면 null — 호출 측이 옮기기·보관·삭제를 숨긴다(별표 보기 전체 범위로 떨어지지 않는다)', () => {
    expect(scopeOf(null)).toBeNull()
    expect(scopeOf(undefined as unknown as Row)).toBeNull()
    expect(scopeOf({ folderId: null, folderRole: null })).toBeNull()
    // 메일함 목록에 없는 id·메일함 목록을 아직 못 받음
    expect(scopeOf({ folderId: 42, folderRole: 'USER' })).toBeNull()
    expect(mailRowMoveScope(flagged, undefined, { folderId: 2, folderRole: 'USER' })).toBeNull()
  })
  it('별표 보기가 아니면 보기 그대로', () => {
    const work = { kind: 'work', folderId: null } as const
    expect(mailRowMoveScope(work, folders, { folderId: 1, folderRole: 'ARCHIVE' })).toBe(work)
    expect(mailRowMoveScope(work, folders, null)).toBe(work)
  })
})
