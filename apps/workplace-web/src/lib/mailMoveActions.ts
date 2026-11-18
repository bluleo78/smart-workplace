// WP-962 메일 보관·옮기기·삭제(+ WP-1681 휴지통 되살리기) — 보기별로 어떤 작업을 보일지, 「옮기기」 메뉴에 어떤 메일함을 둘지 정하는 순수 판정.
// 목록 행 hover 버튼·상세 툴바·모바일 길게 누르기 시트·모바일 상세 ⋯ 메뉴가 모두 같은 판정을 쓴다(화면마다 규칙이 갈리지 않게).
import type { MailMoveTarget, MailServerFolder } from '@/types/mailFolder'

import { ARCHIVE_LABEL, buildMailFolderTree, visibleFolderRows } from './mailFolders'
import type { TrashButtonState } from './mailTrashActions'
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

/** 지금 보는 메일함이 주어진 역할(보관·휴지통)인가(WP-1681 — 보관·휴지통 판정을 한 함수로 합쳤다). */
function viewingRole(
  view: Pick<MailView, 'kind' | 'folderId'>,
  folders: readonly MailServerFolder[] | undefined,
  role: MailServerFolder['role'],
): boolean {
  return view.kind === 'folder' && folders?.find((f) => f.id === view.folderId)?.role === role
}

/** WP-1742 별표 목록 행의 원래 메일함 — 서버가 채운 id·역할(EmailMessageSummary.folderId·folderRole). 표시 이름(folderName)은 쓰지 않는다. */
export interface MailRowFolder {
  folderId?: number | null
  folderRole?: string | null
}

/**
 * WP-1742 별표 모아 보기의 한 메일에 대한 작업 판정 범위 — 별표 보기는 여러 메일함의 메일이 섞여 보기 하나로는 「지금 메일함」을 알 수 없다.
 * 메일의 원래 메일함(목록 행 folderRole·folderId)을 그 메일함 보기로 바꿔 기존 판정(mailMoveTargets·mailMoveAvailability)에 넘긴다 —
 * 받은편지함(INBOX) 메일엔 「받은편지함으로 옮기기」가, 보관 메일엔 「보관」이 빠지고, 보낸(SENT) 메일은 옮길 수 없다(서버가 거절한다).
 * 그 밖은 folderId 가 내 메일함 목록에 있으면 그 메일함 보기. 표시 이름으로 맞추지 않는다(이름이 겹치거나 바뀌어도 틀리지 않게).
 * 별표 보기인데 행·메일함을 모르면(행 스냅샷 없음·메일함 목록 전·목록에 없는 id) null — 호출 측은 옮기기·보관·삭제를 모두 숨긴다
 * (보수적으로: 모르는 메일에 받은편지함으로 옮기기·삭제를 보이면 보낸 메일·같은 메일함으로 옮기기 같은 틀린 작업이 열린다).
 * 별표 보기가 아니면 보기를 그대로 돌려준다.
 */
export function mailRowMoveScope(
  view: Pick<MailView, 'kind' | 'folderId'>,
  folders: readonly MailServerFolder[] | undefined,
  row: MailRowFolder | null | undefined,
): Pick<MailView, 'kind' | 'folderId'> | null {
  if (view.kind !== 'flagged') return view
  if (row?.folderRole === 'INBOX') return { kind: 'all', folderId: null }
  if (row?.folderRole === 'SENT') return { kind: 'sent', folderId: null }
  const id = row?.folderId
  return id != null && folders?.some((f) => f.id === id) ? { kind: 'folder', folderId: id } : null
}

/**
 * 「옮기기」 메뉴 — 받은편지함 · 보관 · 내 메일함 트리(모두 펼침). 지금 보는 메일함은 뺀다:
 * 받은편지함 계열 보기에선 받은편지함, 보관 보기에선 보관, 내 메일함 보기에선 그 메일함(하위는 남긴다).
 * 보낸편지함·임시보관함은 옮길 수 없어 빈 목록. 메일함 목록을 아직 못 받았으면 받은편지함만.
 * 휴지통은 넣지 않는다(WP-1681) — 휴지통으로 보내는 것은 「삭제」가 맡는다(buildMailFolderTree 가 트리에서 뺀다).
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
  if (archive && !viewingRole(view, folders, 'ARCHIVE')) {
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

/**
 * 보기에서 보일 작업 — 보관(보관 메일함이 있고 보관 보기가 아닐 때)·옮기기(고를 곳이 있을 때)·삭제. 보낸편지함·임시보관함은 없음.
 * 휴지통 보기(WP-1681)는 되살리기만 — 휴지통 메일을 다른 곳으로 옮기거나 다시 삭제하는 길은 두지 않고 원래 메일함으로 돌린다.
 */
export interface MailMoveAvailability {
  archive: boolean
  move: boolean
  trash: boolean
  restore: boolean
}

export function mailMoveAvailability(
  view: Pick<MailView, 'kind' | 'folderId'>,
  folders: readonly MailServerFolder[] | undefined,
): MailMoveAvailability {
  if (view.kind === 'sent' || view.kind === 'drafts') return { archive: false, move: false, trash: false, restore: false }
  if (viewingRole(view, folders, 'TRASH')) return { archive: false, move: false, trash: false, restore: true }
  const hasArchive = (folders ?? []).some((f) => f.role === 'ARCHIVE')
  return {
    archive: hasArchive && !viewingRole(view, folders, 'ARCHIVE'),
    move: mailMoveTargets(view, folders).some((t) => t.selectable),
    trash: true,
    restore: false,
  }
}

/** 실행 취소 토스트 문구 — 「보관했습니다」·「삭제했습니다」·「되살렸습니다」·「받은편지함으로 옮겼습니다」·「'이름' 메일함으로 옮겼습니다」. 여러 통이면 앞에 통 수. */
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
    case 'RESTORE':
      // WP-1681 — 메일마다 돌아가는 곳(원래 메일함·받은편지함)이 달라 이름을 붙이지 않는다.
      return `${prefix}되살렸습니다`
    case 'INBOX':
      return `${prefix}받은편지함으로 옮겼습니다`
    case 'FOLDER': {
      const f = folders?.find((x) => x.id === target.folderId)
      if (f?.role === 'ARCHIVE') return `${prefix}보관했습니다`
      return f ? `${prefix}'${f.displayName}' 메일함으로 옮겼습니다` : `${prefix}메일함으로 옮겼습니다`
    }
  }
}

/** WP-962 한 메일에 대한 보관·옮기기·삭제(+ WP-1681 휴지통 보기의 되살리기) — 목록 행(hover·우클릭 메뉴)·상세가 같은 묶음을 받는다. */
export interface MailMoveActions {
  avail: MailMoveAvailability
  targets: readonly MailMoveTargetOption[]
  onArchive: () => void
  onTrash: () => void
  onMove: (target: MailMoveTarget) => void
  /** WP-1681 원래 메일함(모르면 받은편지함)으로 되살리기 — 휴지통 보기에서만 보인다(avail.restore). */
  onRestore: () => void
  /**
   * WP-1682 휴지통 메일 「완전히 삭제」 — 휴지통 보기(avail.restore)에서만 채운다. 상세 작업 줄·휴대폰 ⋯ 메뉴·목록 행 우클릭 메뉴(WP-1730)가
   * 쓰고, 목록 행 hover·길게 누르기 시트에는 두지 않는다. onRequest 는 확인 창을 연다(제목은 확인 창 본문에 쓴다).
   */
  permanentDelete?: { state: TrashButtonState; pending: boolean; onRequest: (subject: string | null) => void }
}

/**
 * 읽음 전환 항목의 글자 — 읽은 메일이면 「안 읽음으로 표시」, 아니면 「읽음으로 표시」.
 * 행 hover ✉ 단추·행 우클릭 메뉴·길게 누르기 시트가 같은 글자를 쓰게 한 곳에서 정한다.
 */
export function toggleReadLabel(seen: boolean): string {
  return seen ? '안 읽음으로 표시' : '읽음으로 표시'
}
