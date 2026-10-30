// 모바일 메일 상세(WP-400) — 첫 화면에서 본문이 보이도록 메타 정보를 접고, 자주 쓰는 액션은 하단 고정 바로 뺀다.
// 데스크톱 상세(MailInboxPage 의 MessageDetailPanel 본래 마크업)는 그대로 두고, 휴대폰 폭에서만 이 배치를 쓴다.
//  - 상단바: ‹ · 제목(본문 위 큰 제목이 스크롤로 사라지면 페이드인) · ⋯(안 읽음·AI 이슈·원본 배경) · ✦
//  - 스크롤 영역: AI 요약(접힘) → 큰 제목 → 보낸사람 → 수신자 한 줄 요약(탭하면 펼침) → 첨부 → 일정 초대 카드(WP-986) → 본문
//  - 하단 고정 바: 답장 · 전체답장 · 전달 · AI 답장
import { ChevronDown, Forward, Loader2, Mail, Reply, ReplyAll, Sparkles } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'
import { AI_CONTENT_CONTAINER_CLASS } from '@/components/ai/aiMarker'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { MobileHeaderMore } from '@/components/mobile/MobileHeaderMore'
import {
  type MailRecipient,
  parseAddressList,
  recipientFullLabel,
  summarizeRecipients,
} from '@/lib/mailRecipients'
import { mailSubjectText } from '@/lib/mailSubject'
import { cn } from '@/lib/utils'

import type { EmailMessageDetail } from '../../types/mailMessage'

/**
 * 모바일 상세 상단바 — ‹ · 제목 · ⋯ · ✦. 로딩·오류 화면도 같은 바를 써서 뒤로 가기가 늘 있다.
 * 「안 읽음」은 ⋯ 메뉴 첫 항목이다. 메뉴 항목이 그것 하나뿐이면(AI 꺼짐 + 원본 배경 토글 없음) MobileHeaderMore 가
 * ⋯ 없이 헤더 글자 버튼으로 바로 둔다(U3-R7) — 예전 모바일 헤더와 같은 모양이 된다.
 */
export function MailMobileDetailBar({
  title,
  titleShown = true,
  onBack,
  onMarkUnread,
  menuItems,
  share,
}: {
  title?: string
  /** 제목을 보일지 — 본문 위 큰 제목이 화면에 있는 동안은 같은 글자를 두 번 보이지 않게 숨긴다(투명 + 보조기술에서도 숨김, 큰 제목이 대신 읽힌다). */
  titleShown?: boolean
  onBack: () => void
  onMarkUnread?: () => void
  /** 「안 읽음」 뒤에 붙는 메뉴 항목(AI 이슈 만들기·원본 배경 토글). */
  menuItems?: ReactNode
  /** ⬆︎ 공유(WP-1234) — 상세를 받은 뒤에만(로딩·오류 바에는 없다). ⋯ 앞에 둔다. */
  share?: ReactNode
}) {
  return (
    <MobileDetailBar
      data-testid="mail-back"
      title={title}
      titleVisible={titleShown}
      onBack={onBack}
      trailing={
        <>
          {share}
          {onMarkUnread && (
            <MobileHeaderMore label="메일 메뉴">
              <button type="button" data-testid="mobile-mark-unread" onClick={onMarkUnread}>
                <Mail className="h-4 w-4" aria-hidden /> 안 읽음
              </button>
              {menuItems}
            </MobileHeaderMore>
          )}
        </>
      }
    />
  )
}

/** 수신자 줄 — 받는사람/참조/숨은참조 묶음 하나(펼친 목록의 한 행). */
function RecipientGroup({ label, people }: { label: string; people: MailRecipient[] }) {
  if (people.length === 0) return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <ul className="flex flex-col gap-0.5">
          {people.map((p, i) => (
            // 같은 주소가 두 번 들어올 수 있어 순번을 키에 섞는다.
            <li key={`${p.address}-${i}`} className="break-all">
              {recipientFullLabel(p)}
            </li>
          ))}
        </ul>
      </dd>
    </>
  )
}

/**
 * 수신자 한 줄 요약 「받는사람 홍길동 외 2명 · 참조 7명」 — 탭하면 전체 목록을 펼치고 다시 탭하면 접는다.
 * 받는사람·참조가 수십 명인 메일도 첫 화면을 차지하지 않게 한다.
 */
function MailMobileRecipients({ detail }: { detail: EmailMessageDetail }) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(
    () => ({
      to: parseAddressList(detail.toAddresses),
      cc: parseAddressList(detail.ccAddresses),
      bcc: parseAddressList(detail.bccAddresses),
    }),
    [detail.toAddresses, detail.ccAddresses, detail.bccAddresses],
  )
  const line = summarizeRecipients(groups.to, groups.cc, groups.bcc)
  if (!line) return null
  return (
    <div className="mt-0.5">
      {/* 글자 줄은 작지만 탭 영역은 44px — 음수 세로 마진으로 줄 간격은 그대로 둔다(AiContent 요약 줄과 같은 방식). */}
      <button
        type="button"
        data-testid="mail-recipients-toggle"
        aria-expanded={open}
        aria-controls="mail-recipients-full"
        onClick={() => setOpen((o) => !o)}
        className="-my-3 flex min-h-11 w-full min-w-0 items-center gap-1 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="min-w-0 truncate">{line}</span>
        <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <dl
          id="mail-recipients-full"
          data-testid="mail-recipients-full"
          className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs"
        >
          <RecipientGroup label="받는사람" people={groups.to} />
          <RecipientGroup label="참조" people={groups.cc} />
          <RecipientGroup label="숨은참조" people={groups.bcc} />
        </dl>
      )}
    </div>
  )
}

/** 하단 고정 바 버튼 — 아이콘 위 작은 라벨, 폭을 4등분하고 높이 48px(터치 44px 이상). */
const actionClass =
  'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] leading-none text-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 [&_svg]:h-5 [&_svg]:w-5'

/**
 * 하단 고정 액션 바 — 답장·전체답장·전달·AI 답장.
 * 스크롤 영역 아래 흐름 안에 두어(fixed 아님) 본문 끝이 바에 가리지 않는다. 상세에서는 하단 탭바가 숨고(WP-125)
 * 셸이 홈 인디케이터 여백(safe-area-inset-bottom)을 직접 주므로 바에는 여백을 더하지 않는다.
 */
function MailMobileActionBar({
  onReply,
  onReplyAll,
  onForward,
  aiReply,
}: {
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  /** AI 답장 초안 — 비서가 있고 AI 사용 계정일 때만. */
  aiReply?: { onClick: () => void; pending: boolean }
}) {
  return (
    <div
      data-testid="mail-mobile-action-bar"
      aria-label="메일 작업"
      className="flex shrink-0 items-stretch gap-1 border-t bg-background px-2 py-1"
    >
      <button type="button" data-testid="mail-reply" onClick={onReply} className={actionClass}>
        <Reply aria-hidden /> 답장
      </button>
      <button type="button" data-testid="mail-reply-all" onClick={onReplyAll} className={actionClass}>
        <ReplyAll aria-hidden /> 전체답장
      </button>
      <button type="button" data-testid="mail-forward" onClick={onForward} className={actionClass}>
        <Forward aria-hidden /> 전달
      </button>
      {aiReply && (
        // AI 기능은 아이콘+색으로 구분(디자인 시스템 §7.2) — 다른 버튼과 같은 모양에 ai-accent 색만 다르다.
        <button
          type="button"
          data-testid="mail-ai-reply-draft"
          disabled={aiReply.pending}
          onClick={aiReply.onClick}
          className={cn(actionClass, 'text-ai-accent')}
        >
          {aiReply.pending ? <Loader2 aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
          {aiReply.pending ? '작성 중…' : 'AI 답장'}
        </button>
      )}
    </div>
  )
}

/**
 * 스크롤 영역 안의 대상이 위로 스크롤돼 화면 밖으로 나갔는가 — 상단바 제목 페이드인 판정.
 * 아래로 벗어난 경우(아직 닿지 않음)는 나간 것으로 보지 않는다.
 */
function useScrolledPast(root: HTMLElement | null, target: HTMLElement | null): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    if (!root || !target) return
    const io = new IntersectionObserver(
      ([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)),
      { root },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [root, target])
  return past
}

/**
 * 모바일 메일 상세 본체 — 상단바 + 스크롤 영역 + 하단 액션 바.
 * 요약·첨부·본문은 상태를 가진 MessageDetailPanel 이 만들어 넘긴다(데스크톱과 같은 훅·캐시를 공유).
 * 메일이 바뀌면 호출부가 key 로 새로 그려 스크롤·펼침·제목 표시가 앞 메일에서 이어지지 않는다.
 */
export function MailMobileDetail({
  detail,
  share,
  onBack,
  onMarkUnread,
  menuItems,
  summary,
  linkedIssue,
  attachments,
  invite,
  body,
  onReply,
  onReplyAll,
  onForward,
  aiReply,
}: {
  detail: EmailMessageDetail
  /** 상단바 ⬆︎ 공유(WP-1234). */
  share?: ReactNode
  onBack: () => void
  onMarkUnread: () => void
  menuItems?: ReactNode
  summary?: ReactNode
  linkedIssue?: ReactNode
  attachments?: ReactNode
  /** WP-986 일정 초대 카드 — 머리 영역과 본문 사이에 둔다(초대 메일일 때만). */
  invite?: ReactNode
  body: ReactNode
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  aiReply?: { onClick: () => void; pending: boolean }
}) {
  // 콜백 ref 를 state 로 받아 IntersectionObserver 를 요소가 붙은 뒤에 건다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [titleEl, setTitleEl] = useState<HTMLHeadingElement | null>(null)
  const titleShown = useScrolledPast(scrollEl, titleEl)
  const subject = mailSubjectText(detail.subject)
  return (
    <>
      <MailMobileDetailBar
        title={subject}
        titleShown={titleShown}
        onBack={onBack}
        onMarkUnread={onMarkUnread}
        menuItems={menuItems}
        share={share}
      />
      <div data-testid="mail-detail" className="flex min-h-0 flex-1 flex-col">
        {/* container-type:size — HTML 본문 iframe 이 스크롤 영역 높이(100cqh)만큼 차지하게 한다. 머리 영역이 위로 스크롤돼 사라지면
            본문이 화면을 채운다(iframe 은 스크립트를 막아 내용 높이를 잴 수 없다).
            알려진 한계(WP-400, 받아들임): 본문이 iframe 보다 긴 HTML 메일은 본문 위를 스와이프하면 iframe 안쪽이 먼저 스크롤된다.
            그래서 iframe 끝에 닿거나 머리 영역을 직접 밀기 전까지 머리가 접히지 않고 상단바 제목도 나타나지 않는다.
            내용 높이를 알려면 iframe 이 postMessage 로 높이를 보내야 하는데, 그러려면 sandbox 에 allow-scripts 를 켜야 해서
            메일 HTML 스크립트 차단 원칙(#486)을 지키려고 켜지 않았다. */}
        <div
          ref={setScrollEl}
          data-testid="mail-detail-scroll"
          className="min-h-0 flex-1 overflow-y-auto [container-type:size]"
        >
          <div className="border-b px-4 py-3">
            {summary && <div className="mb-3">{summary}</div>}
            <h2 ref={setTitleEl} className="text-lg font-semibold leading-snug">
              {subject}
            </h2>
            {linkedIssue}
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {detail.fromName ? `${detail.fromName} <${detail.fromAddress}>` : detail.fromAddress}
            </div>
            <MailMobileRecipients detail={detail} />
            {attachments}
          </div>
          {invite && <div className="px-4 pt-3">{invite}</div>}
          <div className="px-4 py-2">{body}</div>
        </div>
        <MailMobileActionBar onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} aiReply={aiReply} />
      </div>
    </>
  )
}

/** 요약이 생략된 메일(SKIPPED)의 「AI 요약 보기」 — 접힌 요약 카드와 같은 높이·모양의 한 줄 버튼. */
export function MailMobileSummaryButton({ onClick }: { onClick: () => void }) {
  return (
    <div className={AI_CONTENT_CONTAINER_CLASS}>
      <button
        type="button"
        data-testid="mail-ai-summary-generate"
        onClick={onClick}
        className="flex w-full items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:-my-3.5 pointer-coarse:min-h-11"
      >
        <AiLabel>AI 요약 보기</AiLabel>
      </button>
    </div>
  )
}
