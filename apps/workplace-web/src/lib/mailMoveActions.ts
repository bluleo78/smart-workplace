// WP-962 메일 보관·옮기기·삭제 — 보기별로 어떤 작업을 보일지, 「옮기기」 메뉴에 어떤 메일함을 둘지 정하는 순수 판정.
// 목록 행 hover 버튼·상세 툴바·모바일 길게 누르기 시트·모바일 상세 ⋯ 메뉴가 모두 같은 판정을 쓴다(화면마다 규칙이 갈리지 않게).
import type { MailMoveTarget, MailServerFolder } from '@/types/mailFolder'

import { ARCHIVE_LABEL, buildMailFolderTree, visibleFolderRows } from './mailFolders'
import type { MailView } from './mailView'

/** 받은편지함 계열 보기(업무·전체·분류·회신필요) — 모두 서버 받은편지함 메일을 보여 준다. */
export function isInboxView(kind: MailView['kind']): boolean {
  return kind === 'work' || kind === 'all' || kind === 'category' || kind === 'needsReply'
}

/** 「옮기기」 메뉴 한 줄. */
export interface MailMoveTargetOption {
  /** React key·testid 접미사(inbox·archive·folder-<id>). */
  key: string
  label: string
  target: MailMoveTarget
  /** 내 메일함 트리 깊이(받은편지함·보관은 0). */
  depth: number
  /** false 면 메일을 담지 못하는 묶음 메일함 — 하위를 보여 주려고 이름만 두고 고를 수 없다. */
  selectable: boolean
  /** 메뉴 구획 — 기본 메일함(받은편지함·보관) / 내 메일함 트리. */
  section: 'base' | 'user'
}

/** 지금 보는 메일함이 보관인가. */
function viewingArchive(view: Pick<MailView, 'kind' | 'folderId'>, folders: readonly MailServerFolder[] | undefined): boolean {
  return view.kind === 'folder' && folders?.find((f) => f.id === view.folderId)?.role === 'ARCHIVE'
}

/**
 * 「옮기기」 메뉴 — 받은편지함 · 보관 · 내 메일함 트리(모두 펼침). 지금 보는 메일함은 뺀다:
 * 받은편지함 계열 보기에선 받은편지함, 보관 보기에선 보관, 내 메일함 보기에선 그 메일함(하위는 남긴다).
 * 보낸편지함·임시보관함은 옮길 수 없어 빈 목록. 메일함 목록을 아직 못 받았으면 받은편지함만.
 */
export function mailMoveTargets(
  view: Pick<MailView, 'kind' | 'folderId'>,
  folders: readonly MailServerFolder[] | undefined,
): MailMoveTargetOption[] {
  if (view.kind === 'sent' || view.kind === 'drafts') return []
  const out: MailMoveTargetOption[] = []
  if (!isInboxView(view.kind)) {
    out.push({ key: 'inbox', label: '받은편지함', target: { kind: 'INBOX' }, depth: 0, selectable: true, section: 'base' })
  }
  const { archive, tree } = buildMailFolderTree(folders ?? [])
  if (archive && !viewingArchive(view, folders)) {
    out.push({ key: 'archive', label: ARCHIVE_LABEL, target: { kind: 'ARCHIVE' }, depth: 0, selectable: true, section: 'base' })
  }
  for (const row of visibleFolderRows(tree, new Set())) {
    if (view.kind === 'folder' && row.folder.id === view.folderId) continue
    out.push({
      key: `folder-${row.folder.id}`,
      label: row.folder.displayName,
      target: { kind: 'FOLDER', folderId: row.folder.id },
      depth: row.depth,
      selectable: row.folder.selectable,
      section: 'user',
    })
  }
  return out
}

/** 보기에서 보일 작업 — 보관(보관 메일함이 있고 보관 보기가 아닐 때)·옮기기(고를 곳이 있을 때)·삭제. 보낸편지함·임시보관함은 없음. */
export interface MailMoveAvailability {
  archive: boolean
  move: boolean
  trash: boolean
}

export function mailMoveAvailability(
  view: Pick<MailView, 'kind' | 'folderId'>,
  folders: readonly MailServerFolder[] | undefined,
): MailMoveAvailability {
  if (view.kind === 'sent' || view.kind === 'drafts') return { archive: false, move: false, trash: false }
  const hasArchive = (folders ?? []).some((f) => f.role === 'ARCHIVE')
  return {
    archive: hasArchive && !viewingArchive(view, folders),
    move: mailMoveTargets(view, folders).some((t) => t.selectable),
    trash: true,
  }
}

/** 실행 취소 토스트 문구 — 「보관했습니다」·「삭제했습니다」·「받은편지함으로 옮겼습니다」·「'이름' 메일함으로 옮겼습니다」. 여러 통이면 앞에 통 수. */
export function mailMoveToastMessage(
  target: MailMoveTarget,
  folders: readonly MailServerFolder[] | undefined,
  count = 1,
): string {
  const prefix = count > 1 ? `${count}통을 ` : ''
  switch (target.kind) {
    case 'ARCHIVE':
      return `${prefix}보관했습니다`
    case 'TRASH':
      return `${prefix}삭제했습니다`
    case 'INBOX':
      return `${prefix}받은편지함으로 옮겼습니다`
    case 'FOLDER': {
      const f = folders?.find((x) => x.id === target.folderId)
      if (f?.role === 'ARCHIVE') return `${prefix}보관했습니다`
      return f ? `${prefix}'${f.displayName}' 메일함으로 옮겼습니다` : `${prefix}메일함으로 옮겼습니다`
    }
  }
}
