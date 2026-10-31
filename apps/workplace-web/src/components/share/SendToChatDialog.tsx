// 「채팅·이슈로 보내기」 대화상자(WP-1235) — 지금 보는 대상의 앱 링크를 앱 안 채널·DM·이슈 댓글로 보낸다.
// 흐름: 채널·사람·이슈 검색과 최근 대상 → 받는 곳을 고르면 보낼 것의 카드 미리보기 + 함께 보낼 말(선택) → 보내기.
// 본문에 링크를 그대로 담아 보내므로 받는 쪽은 기존 앱 링크 카드(AppLinkCard)로 본다 — 새 메시지 종류를 만들지 않는다.
// 데스크톱은 가운데 대화상자, 휴대폰은 전체 화면(이슈 만들기 시트와 같은 모양: [취소 · 제목 · 보내기], 시스템 뒤로 가기로 닫힘).
import { useQueryClient } from '@tanstack/react-query'
import { Calendar, ChevronLeft, FileText, Folder, Hash, Mail, MessageSquare, SquareKanban, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { issueCommentsApi } from '@/api/issueComments'
import { messagingApi } from '@/api/messaging'
import { AppLinkCardPreview } from '@/components/chat/AppLinkCard'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchInput } from '@/components/ui/search-input'
import { Textarea } from '@/components/ui/textarea'
import { messagingKeys } from '@/hooks/queries/messagingKeys'
import { issueKeys } from '@/hooks/queries/useIssues'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useSendDestinationSearch } from '@/hooks/queries/useSendDestinationSearch'
import { useAuth } from '@/hooks/useAuth'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { useIsMobile } from '@/hooks/useIsMobile'
import { apiErrorStatus, handleApiError } from '@/lib/api-error'
import { currentAppHosts, parseAppLink } from '@/lib/appLinks'
import { issuePath } from '@/lib/appUrl'
import { mimeFromFilename } from '@/lib/mimeFromFilename'
import {
  buildSendBody,
  destinationKey,
  destinationLabel,
  forgetDestination,
  readRecentDestinations,
  rememberDestination,
  type SendDestination,
  validRecentDestinations,
} from '@/lib/sendToChat'
import type { ShareTarget, ShareTargetKind } from '@/lib/shareTarget'
import { cn } from '@/lib/utils'

import { SendToChatMobileFrame } from './mobile/SendToChatMobileFrame'

const TITLE = '채팅·이슈로 보내기'
const DESCRIPTION = '이 링크를 앱 안 채널·DM·이슈 댓글로 보냅니다. 받는 사람에게는 링크 카드로 보입니다.'
/** 함께 보낼 말 상한 — 메시지·댓글 본문 상한보다 넉넉히 작게(링크와 합쳐도 넘지 않게). */
const NOTE_MAX_LENGTH = 2000

/** 대상 종류의 화면 이름 — 미리보기 자리(카드를 못 받을 때)에 쓴다. */
const KIND_LABEL: Record<ShareTargetKind, string> = {
  issue: '이슈',
  page: '노트',
  file: '파일',
  folder: '폴더',
  event: '일정',
  mail: '메일',
  message: '메시지',
}

/** 받는 곳 종류 아이콘 — 채널 #, 사람, 이슈. */
function DestinationIcon({ d }: { d: SendDestination }) {
  const cls = 'h-4 w-4 shrink-0 text-muted-foreground'
  if (d.kind === 'channel') return <Hash className={cls} aria-hidden />
  if (d.kind === 'person') return <User className={cls} aria-hidden />
  return <SquareKanban className={cls} aria-hidden />
}

/**
 * 보낸 뒤 알림 문구 — 「#일반에 보냈어요」·「김민수에게 보냈어요」·「WP-12 댓글로 보냈어요」.
 * 받침에 따라 조사를 고르지 않아도 되도록 받는 곳 종류별 문장을 쓴다.
 */
function sentMessage(d: SendDestination): string {
  if (d.kind === 'channel') return `#${d.name} 채널에 보냈어요`
  if (d.kind === 'person') return `${d.name} 님에게 보냈어요`
  return `${d.projectKey}-${d.number} 댓글로 보냈어요`
}

/** 보낼 것의 미리보기 — 받는 쪽이 볼 앱 링크 카드. 카드 종류가 아닌 대상(폴더)·카드를 받는 동안은 대상 이름으로 그린다. */
function TargetPreview({ target }: { target: ShareTarget }) {
  const link = parseAppLink(target.url, currentAppHosts())
  const fallback = (
    <div data-testid="send-to-chat-preview" data-state="fallback" className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <TargetKindIcon kind={target.kind} title={target.title} />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">
          {KIND_LABEL[target.kind]}
          {target.key && <span className="ml-1.5 font-mono text-foreground">{target.key}</span>}
        </div>
        <div className="truncate font-semibold text-primary">{target.title}</div>
      </div>
    </div>
  )
  if (!link) return fallback
  return <AppLinkCardPreview link={link} testId="send-to-chat-preview" fallback={fallback} />
}

function TargetKindIcon({ kind, title }: { kind: ShareTargetKind; title: string }) {
  const cls = 'h-5 w-5 shrink-0 text-muted-foreground'
  if (kind === 'file') return <FileTypeIcon mimeType={mimeFromFilename(title) ?? 'application/octet-stream'} className="h-5 w-5" />
  if (kind === 'issue') return <SquareKanban className={cls} aria-hidden />
  if (kind === 'page') return <FileText className={cls} aria-hidden />
  if (kind === 'folder') return <Folder className={cls} aria-hidden />
  if (kind === 'event') return <Calendar className={cls} aria-hidden />
  if (kind === 'message') return <MessageSquare className={cls} aria-hidden />
  return <Mail className={cls} aria-hidden />
}

/** 후보 목록의 한 묶음(최근·채널·사람·이슈). 비었으면 그리지 않는다. */
function Section({ title, items, onPick, testId }: {
  title: string
  items: SendDestination[]
  onPick: (d: SendDestination) => void
  testId: string
}) {
  if (items.length === 0) return null
  return (
    <section data-testid={testId} aria-label={title} className="py-1">
      <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul>
        {items.map((d) => (
          <li key={destinationKey(d)}>
            <button
              type="button"
              data-testid={`send-to-chat-option-${destinationKey(d)}`}
              onClick={() => onPick(d)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:min-h-9"
            >
              <DestinationIcon d={d} />
              {d.kind === 'issue' ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{d.projectKey}-{d.number}</span>
                  <span className="truncate">{d.title}</span>
                </span>
              ) : (
                <span className="truncate">{d.name}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 받는 곳 고르기 — 검색칸 + 최근 대상·채널(검색어 없을 때) / 채널·사람·이슈(검색어 있을 때). */
function DestinationPicker({ recent, onPick }: { recent: SendDestination[]; onPick: (d: SendDestination) => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounceValue(query, 250)
  const results = useSendDestinationSearch(debounced)
  const hasQuery = debounced.trim().length > 0
  const first = hasQuery ? [...results.channels, ...results.people, ...results.issues][0] : (recent[0] ?? results.channels[0])
  const empty = hasQuery && !results.loading && results.channels.length + results.people.length + results.issues.length === 0
  // 지금 입력에 맞는 결과인가 — 디바운스가 아직 따라오지 않았거나(입력 ≠ 검색어) 사람·이슈·키 조회가 오는 중이면 아니다.
  // 그때의 맨 위 후보는 앞 검색어(또는 빈 검색어의 최근·채널) 것이라, Enter 로 고르면 엉뚱한 곳으로 간다.
  const settled = query.trim() === debounced.trim() && !(hasQuery && results.loading)
  // 결과가 따라오기 전에 누른 Enter 는 기억해 두었다가 결과가 맞춰지면 그때 맨 위 후보를 고른다. 입력을 바꾸면 버린다.
  // ref 로 둔다 — 결과가 맞춰질 때(settled 가 바뀌는 렌더) 이펙트가 읽기만 하면 되고, 기억 자체로 다시 그릴 필요는 없다.
  const pendingEnter = useRef(false)
  useEffect(() => {
    if (!pendingEnter.current || !settled) return
    pendingEnter.current = false
    if (first) onPick(first)
  }, [settled, first, onPick])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Enter 는 맨 위 후보를 고른다 — 키보드만으로 검색 → 고르기. 한글 조합 중 Enter 는 조합 확정이라 무시한다. */}
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          if (!settled) pendingEnter.current = true
          else if (first) onPick(first)
        }}
      >
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            pendingEnter.current = false
          }}
          placeholder="채널·사람·이슈 검색"
          inputTestId="send-to-chat-search"
          className="max-w-none"
        />
      </div>
      <div data-testid="send-to-chat-results" className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {!hasQuery && <Section title="최근" items={recent} onPick={onPick} testId="send-to-chat-recent" />}
        <Section title="채널" items={results.channels} onPick={onPick} testId="send-to-chat-channels" />
        <Section title="사람" items={results.people} onPick={onPick} testId="send-to-chat-people" />
        <Section title="이슈" items={results.issues} onPick={onPick} testId="send-to-chat-issues" />
        {hasQuery && results.loading && <p className="px-2 py-3 text-sm text-muted-foreground">찾는 중…</p>}
        {empty && <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="send-to-chat-empty">찾는 채널·사람·이슈가 없어요</p>}
      </div>
    </div>
  )
}

/** 고른 뒤 화면 — 받는 곳(바꾸기) · 보낼 것 미리보기 · 함께 보낼 말. */
function Compose({ target, destination, note, onNote, onChange, onSubmit }: {
  target: ShareTarget
  destination: SendDestination
  note: string
  onNote: (v: string) => void
  onChange: () => void
  onSubmit: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="send-to-chat-destination">
        <span className="shrink-0 text-muted-foreground">받는 곳</span>
        <DestinationIcon d={destination} />
        <span className="min-w-0 flex-1 truncate font-medium">{destinationLabel(destination)}</span>
        <Button type="button" variant="ghost" size="sm" className="-my-1 shrink-0" onClick={onChange} data-testid="send-to-chat-change">
          <ChevronLeft aria-hidden /> 바꾸기
        </Button>
      </div>
      <TargetPreview target={target} />
      <Textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        // ⌘Enter(Ctrl+Enter)로 보낸다 — Enter 는 줄바꿈(여러 줄 메모를 쓸 수 있게).
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSubmit()
          }
        }}
        aria-label="함께 보낼 말"
        placeholder="함께 보낼 말 (선택)"
        maxLength={NOTE_MAX_LENGTH}
        rows={3}
        data-testid="send-to-chat-note"
        autoFocus
      />
    </div>
  )
}

/**
 * 대화상자 본체 — 열 때마다 새로 마운트한다(호스트가 대상별 key 로 띄움). 받는 곳을 고르기 전에는 「보내기」가 막혀 있다.
 * 보내기에 실패하면 창과 쓴 말을 그대로 두고 오류만 알린다(다시 누르면 된다).
 */
export function SendToChatDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const isMobile = useIsMobile()
  const { user, activeTenant } = useAuth()
  const owner = user ? { userId: user.id, tenantId: activeTenant?.tenantId ?? null } : null
  const qc = useQueryClient()
  const navigate = useNavigate()
  // 최근 대상은 열 때 한 번 읽는다. 보내기에 실패해 빼면(forgetDestination) 이 목록에서도 뺀다.
  const [recent, setRecent] = useState(() => (owner ? readRecentDestinations(owner) : []))
  // 나갔거나 보관된 채널은 최근 대상에서 숨긴다 — 내 채널 목록(사이드바와 같은 캐시)에 맞춘다.
  const channelsQuery = useMyChannels()
  const shownRecent = validRecentDestinations(recent, channelsQuery.data)
  const [destination, setDestination] = useState<SendDestination | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  // 두 번 보내기 막기 — state 는 다음 렌더에야 보이므로, 같은 틱의 두 번째 클릭·⌘Enter 를 거르려고 ref 로도 바로 잠근다.
  const sendingRef = useRef(false)

  /** 고른 곳으로 링크(+함께 보낼 말)를 보낸다. 사람이면 DM 을 찾거나 만든 뒤 보낸다. 돌려주는 값은 「보기」로 갈 경로. */
  const deliver = async (d: SendDestination, body: string): Promise<string> => {
    if (d.kind === 'channel') {
      await messagingApi.createMessage(d.channelId, { body })
      // 채널 목록(사이드바 마지막 글·안 읽음)도 다시 받는다 — DM 길이 dms() 를 다시 받는 것과 같다.
      void qc.invalidateQueries({ queryKey: messagingKeys.channels() })
      void qc.invalidateQueries({ queryKey: messagingKeys.messages(d.channelId) })
      return `/chat/channels/${d.channelId}`
    }
    if (d.kind === 'person') {
      // 같은 상대와의 DM 이 있으면 서버가 그 DM 을 돌려준다(찾거나 만들기). 나를 고르면 개인 메모(나와의 DM)다.
      const dm = (await messagingApi.createDm([d.userId])).data
      await messagingApi.createMessage(dm.id, { body })
      void qc.invalidateQueries({ queryKey: messagingKeys.dms() })
      void qc.invalidateQueries({ queryKey: messagingKeys.messages(dm.id) })
      return `/chat/dms/${dm.id}`
    }
    await issueCommentsApi.create(d.issueId, { body })
    void qc.invalidateQueries({ queryKey: issueKeys.detail(d.projectKey, d.number) })
    return issuePath(d.projectKey, d.number)
  }

  const send = async () => {
    if (!destination || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const path = await deliver(destination, buildSendBody(target.url, note))
      if (owner) rememberDestination(owner, destination)
      // 호스트가 준 onClose 는 이 세션만 닫는다 — 보내는 사이 다른 대상으로 다시 열었으면 새 창은 그대로 둔다(알림은 띄운다).
      onClose()
      toast.success(sentMessage(destination), { action: { label: '보기', onClick: () => navigate(path) } })
    } catch (err) {
      handleApiError(err, '보내지 못했어요')
      // 권한 없음·없음·잘못된 요청 — 나간 채널·지운 이슈처럼 다시 보내도 안 될 곳이라 최근 대상에서 뺀다.
      const status = apiErrorStatus(err)
      if (status === 400 || status === 403 || status === 404) {
        const key = destinationKey(destination)
        if (owner) forgetDestination(owner, destination)
        setRecent((prev) => prev.filter((d) => destinationKey(d) !== key))
      }
      sendingRef.current = false
      setSending(false)
    }
  }

  const body = destination ? (
    <Compose
      target={target}
      destination={destination}
      note={note}
      onNote={setNote}
      onChange={() => setDestination(null)}
      onSubmit={() => void send()}
    />
  ) : (
    <DestinationPicker recent={shownRecent} onPick={setDestination} />
  )

  if (isMobile) {
    return (
      <SendToChatMobileFrame
        title={TITLE}
        onClose={onClose}
        // 받는 곳을 골랐거나 말을 썼으면 시스템 뒤로 가기에 버림 확인을 띄운다(이슈 만들기 시트와 같은 규칙).
        hasContent={destination != null || note.trim() !== ''}
        canSend={destination != null}
        sending={sending}
        onSend={() => void send()}
      >
        {body}
      </SendToChatMobileFrame>
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* z-[80] — 올려 띄운 뷰어·AI 시트(z-[60]) 안에서 불러도 그 위에 뜨게(휴대폰 전체 화면·AttachmentViewer 올림과 같은 층).
          딤은 ui/dialog 안에서 그려 여기서 못 바꾸므로 data-lifted-dialog 표식으로 index.css 가 함께 올린다. */}
      <DialogContent
        data-testid="send-to-chat-dialog"
        data-lifted-dialog
        className="z-[80] flex max-h-[min(640px,85vh)] flex-col gap-4 sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription className="break-keep">{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className={cn('flex min-h-0 flex-col', destination ? '' : 'h-80')}>{body}</div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="send-to-chat-cancel">
            취소
          </Button>
          <Button type="button" disabled={!destination || sending} onClick={() => void send()} data-testid="send-to-chat-submit">
            {sending ? '보내는 중…' : '보내기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
