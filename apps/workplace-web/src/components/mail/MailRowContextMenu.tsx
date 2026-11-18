// WP-1730 메일 목록 행 우클릭 메뉴(데스크톱) — 메일 동작 + 링크 항목을 메뉴 하나로 연다.
// 위 칸은 상세 머리 단추와 같은 이름·순서(답장 · 전체답장 · 전달 | 읽음 전환 · 보관 · 옮기기 ▸ · 분류 바꾸기 ▸ · 삭제),
// 휴지통 보기에서는 보관·옮기기·분류·삭제 대신 되살리기 · 완전히 삭제. 아래 칸은 줄 링크 메뉴(RowLinkMenu)의 링크 항목 그대로.
// 어떤 동작을 보일지는 호출부가 넘긴 MailMoveActions.avail(목록 hover·상세와 같은 판정)과 분류 바꾸기 핸들러 유무로만 정한다.
import { Archive, ArchiveRestore, FolderInput, Forward, Mail, MailOpen, Reply, ReplyAll, Tag, Trash2 } from 'lucide-react'

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/overlay/dropdown-menu'
import { RowLinkMenu } from '@/components/share/RowLinkMenu'
import type { RowLinkMenuAnchor } from '@/components/share/rowLinkMenuAnchor'
import { type MailMoveActions, toggleReadLabel } from '@/lib/mailMoveActions'
import type { ShareTarget } from '@/lib/shareTarget'
import { type EmailMessageSummary, toCategoryState } from '@/types/mailMessage'

import { MailCategoryItems } from './MailCategoryMenu'
import { MAIL_MOVE_MENU_CONTENT_CLASS, MailMoveTargetItems } from './MailMoveMenu'
import { usePermanentDeleteItem } from './usePermanentDeleteItem'

/** 하위 메뉴가 화면 끝에 붙어 잘리지 않게 두는 여백(px). */
const SUB_COLLISION_PADDING = 8

/** 행 우클릭 메뉴가 부르는 메일 동작 — 목록 화면이 행마다 만든다(메뉴를 열 때만 쓰인다). */
export interface MailRowMenuHandlers {
  /** 링크 항목의 대상(이 메일의 앱 링크). 묶음 자체가 메뉴를 열 때만 만들어지므로 값으로 둔다. */
  linkTarget: ShareTarget
  /** 읽음 전환 — 행 hover ✉ 단추와 같은 동작(열린 상세는 그대로 둔다). */
  onToggleRead: () => void
  /** 답장·전체답장·전달 — 상세를 받아 작성 창을 연다(안 읽은 메일은 읽음 처리, 실패는 토스트). */
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  /** 분류 바꾸기 — 이 보기에서 분류를 바꿀 수 없으면(보낸편지함·서버 메일함·AI 분류 꺼짐) null. onPick(null) 은 AI 분류로 되돌리기. */
  onChangeCategory: ((category: string | null) => void) | null
}

/**
 * 메일 행 우클릭 메뉴 — 연 동안만 그린다(닫으면 onClose 로 부른 쪽이 내린다). 앵커·닫기·포커스 처리는 RowLinkMenu 를 그대로 쓴다.
 * id·제목·읽음·분류는 행 요약(m)에서 바로 읽는다 — 부른 쪽이 따로 풀어 넘기지 않게.
 * moveActions 가 null(보낸편지함·임시보관함)이면 이동 항목 없이 답장류·읽음 전환·(분류)·링크만 둔다.
 */
export function MailRowContextMenu({
  m,
  anchor,
  onClose,
  moveActions,
  handlers,
}: {
  /** 메뉴를 연 행의 메일 요약. */
  m: EmailMessageSummary
  anchor: RowLinkMenuAnchor
  onClose: () => void
  moveActions: MailMoveActions | null
  handlers: MailRowMenuHandlers
}) {
  return (
    <RowLinkMenu target={handlers.linkTarget} anchor={anchor} onClose={onClose} testId={`mail-row-menu-${m.id}`}>
      <DropdownMenuItem data-testid="mail-row-menu-reply" onSelect={handlers.onReply}>
        <Reply aria-hidden /> 답장
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="mail-row-menu-reply-all" onSelect={handlers.onReplyAll}>
        <ReplyAll aria-hidden /> 전체답장
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="mail-row-menu-forward" onSelect={handlers.onForward}>
        <Forward aria-hidden /> 전달
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {/* 읽음 전환 — 행 hover ✉ 단추·길게 누르기 시트와 같은 글자. 열린 상세는 그대로 둔다. */}
      <DropdownMenuItem data-testid="mail-row-menu-toggle-read" onSelect={handlers.onToggleRead}>
        {m.seen ? <Mail aria-hidden /> : <MailOpen aria-hidden />}
        {toggleReadLabel(m.seen)}
      </DropdownMenuItem>
      {/* 보관·옮기기 — 이동 묶음이 있을 때만(보낸편지함·임시보관함은 null). 항목별 노출은 avail 로 정한다. */}
      {moveActions?.avail.archive && (
        <DropdownMenuItem data-testid="mail-row-menu-archive" onSelect={moveActions.onArchive}>
          <Archive aria-hidden /> 보관
        </DropdownMenuItem>
      )}
      {moveActions?.avail.move && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="mail-row-menu-move">
            <FolderInput aria-hidden /> 옮기기
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            data-testid="mail-row-menu-move-sub"
            collisionPadding={SUB_COLLISION_PADDING}
            // 긴 메일함 트리도 화면 안에서 스크롤 — 옮기기 드롭다운(MailMoveMenu)과 같은 높이 제한.
            className={MAIL_MOVE_MENU_CONTENT_CLASS}
          >
            <MailMoveTargetItems targets={moveActions.targets} onPick={moveActions.onMove} testIdPrefix="mail-row-menu-move-target" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {/* WP-1341 분류 바꾸기 — 「옮기기」 뒤(상세 머리와 같은 자리). 나에게만 적용된다. 이동 묶음과 따로 정한다(임시보관함은 이동 없이 분류만 있을 수 있다). */}
      {handlers.onChangeCategory && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="mail-row-menu-category">
            <Tag aria-hidden /> 분류 바꾸기
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-testid="mail-row-menu-category-sub" collisionPadding={SUB_COLLISION_PADDING} className="w-56">
            <MailCategoryItems current={toCategoryState(m)} onPick={handlers.onChangeCategory} testIdPrefix="mail-row-menu-category" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {/* 삭제 · (WP-1681 휴지통 보기) 되살리기 · 완전히 삭제 — 역시 이동 묶음이 있을 때만. */}
      {moveActions?.avail.trash && (
        <DropdownMenuItem data-testid="mail-row-menu-trash" variant="destructive" onSelect={moveActions.onTrash}>
          <Trash2 aria-hidden /> 삭제
        </DropdownMenuItem>
      )}
      {moveActions?.avail.restore && (
        <DropdownMenuItem data-testid="mail-row-menu-restore" onSelect={moveActions.onRestore}>
          <ArchiveRestore aria-hidden /> 되살리기
        </DropdownMenuItem>
      )}
      {moveActions?.permanentDelete && <PermanentDeleteItem subject={m.subject} permanentDelete={moveActions.permanentDelete} />}
    </RowLinkMenu>
  )
}

/**
 * WP-1682 완전히 삭제 — 기존 확인 창을 연다. 메뉴가 닫힌 다음 틱에 열어 메뉴가 돌려주는 초점·포인터 잠금과 부딪치지 않게 한다.
 * 미지원 서버면 끄고 항목 안 둘째 줄에 짧은 이유 글을 둔다(꺼진 메뉴 항목에는 툴팁이 뜨지 않는다).
 * 이유 글을 항목 밖(메뉴의 직접 자식)에 두면 role="menu" 에 메뉴 항목이 아닌 자식이 생겨(aria-required-children) 항목 안에 둔다.
 * 따로 둔 까닭: 꺼짐·아이콘·이유 글을 휴대폰 ⋯ 메뉴와 같은 훅(usePermanentDeleteItem)으로 정하는데, 훅은 조건 없이 불려야 한다.
 * 이름은 「완전히 삭제」로 두고(이유 글은 aria-hidden) 이유는 aria-describedby 로 설명에만 싣는다 — 숨긴 요소도 참조로는 읽힌다.
 */
function PermanentDeleteItem({
  subject,
  permanentDelete: pd,
}: {
  subject: string | null
  permanentDelete: NonNullable<MailMoveActions['permanentDelete']>
}) {
  const item = usePermanentDeleteItem(pd.state, pd.pending)
  return (
    <DropdownMenuItem
      data-testid="mail-row-menu-permanent-delete"
      variant="destructive"
      disabled={item.disabled}
      // 꺼졌을 때 항목 전체를 흐리면(공통 data-[disabled]:opacity-50) 이유 글의 실제 대비가 2.1:1 로 떨어져 읽기 어렵다.
      // 그래서 이 항목만 전체 흐림을 풀고, 아이콘·「완전히 삭제」 이름만 흐려 꺼짐을 보이고 이유 글은 본래 대비로 둔다.
      className="data-[disabled]:opacity-100 data-[disabled]:*:[svg]:opacity-50"
      aria-describedby={item.reason ? item.reasonId : undefined}
      onSelect={() => {
        setTimeout(() => pd.onRequest(subject), 0)
      }}
    >
      {item.icon}
      <span className="flex min-w-0 flex-col">
        <span data-testid="mail-row-menu-permanent-delete-label" className={item.disabled ? 'opacity-50' : undefined}>
          완전히 삭제
        </span>
        {item.reason && (
          <span id={item.reasonId} aria-hidden data-testid="mail-row-menu-permanent-delete-unsupported" className="text-xs text-muted-foreground">
            {item.reason}
          </span>
        )}
      </span>
    </DropdownMenuItem>
  )
}
