import { ChevronDown, Copy, Info, Link2, RefreshCw, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { BusySwitch } from '@/components/BusySwitch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleApiError } from '@/lib/api-error'
import { formatDateOnly, formatMonthDayClock } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'

import { useWikiPageShare, useWikiShareEvents, useWikiShareMutations } from '../../hooks/queries/useWikiShare'
import type { WikiPageShare, WikiPageShareRequest, WikiShareAudience, WikiSharePermission } from '../../types/wiki'
import { WIKI_SHARE_MESSAGE_MAX } from '../../types/wiki'
import {
  copyShareLink,
  DEFAULT_SHARE,
  expiryAfterDays,
  PUBLIC_DEFAULT_EXPIRY_DAYS,
  type ShareWidening,
  shareWidening,
  wikiShareUrl,
} from './wikiShare'

/** 확인을 받는 동작 — 넓히는 변경(외부·범위·편집)과, 이미 연 사람을 끊는 재발급·해제. */
type Pending =
  | { kind: ShareWidening; next: WikiPageShareRequest }
  | { kind: 'regenerate' | 'revoke' }
  | { kind: 'includePublic'; targetPageId: number }

/** 확인 창 문구 — 무엇이 바뀌고 누가 영향을 받는지 한 문장으로. */
const CONFIRM_COPY: Record<Pending['kind'], { title: string; body: string; action: string; destructive?: boolean }> = {
  public: {
    title: '외부에 공개할까요?',
    body: '링크가 있는 사람은 로그인 없이 이 페이지를 볼 수 있게 됩니다(보기만). 본문 속 내부 링크와 사람 이름은 가려지고, 검색엔진에는 노출되지 않습니다.',
    action: '외부 공개',
  },
  audience: {
    title: '워크스페이스 전체로 넓힐까요?',
    body: '링크를 받은 워크스페이스 멤버라면 누구나 이 페이지를 열 수 있게 됩니다.',
    action: '넓히기',
  },
  permission: {
    title: '편집을 허용할까요?',
    body: '링크로 들어온 사람이 이 페이지 본문을 고칠 수 있게 됩니다. 고친 내용은 버전 기록에 남습니다.',
    action: '편집 허용',
  },
  regenerate: {
    title: '링크를 다시 만들까요?',
    body: '지금 링크는 바로 막히고, 그 링크로 보고 있던 사람도 화면이 닫힙니다. 계속 보여 줄 사람에게는 새 링크를 다시 보내야 합니다.',
    action: '다시 만들기',
  },
  revoke: {
    title: '공유를 해제할까요?',
    body: '링크가 바로 막히고, 그 링크로 보고 있던 사람도 화면이 닫힙니다. 스페이스 멤버는 그대로 볼 수 있습니다.',
    action: '해제',
    destructive: true,
  },
  // 외부 공개 공유에서 제외를 풀면 그 하위가 로그인 없이 열린다(WP-987) — 외부 공개와 같은 무게로 확인을 받는다.
  includePublic: {
    title: '외부 공개에 다시 포함할까요?',
    body: '제외를 풀면 이 페이지와 하위를 링크가 있는 사람이 로그인 없이 볼 수 있게 됩니다(보기만).',
    action: '포함',
  },
}

/** 상위 공유를 받는 페이지가 자기 공유를 해제할 때의 문구(WP-987) — 막히는 것은 이 페이지의 링크뿐이고, 상위 링크로는 다시 열린다. */
const REVOKE_INHERITED_BODY =
  '이 페이지의 링크가 바로 막히고, 그 링크로 보고 있던 사람도 화면이 닫힙니다. 이 페이지와 하위는 다시 상위 공유의 설정대로 열립니다.'

/** 상속받은 공유의 범위 한 줄(WP-987) — 「열 수 있는 사람」 선택지와 같은 말. */
const AUDIENCE_SUMMARY: Record<WikiShareAudience, string> = {
  WORKSPACE: '워크스페이스 멤버 누구나',
  PEOPLE: '지정한 사람만',
  PUBLIC: '링크가 있는 누구나(외부)',
}

/** 만료 선택지 — 지금 값(정해진 날짜)은 「YYYY-MM-DD까지」로 따로 보인다. */
const EXPIRY_CHOICES = [
  { value: 'none', label: '만료 없음' },
  { value: '7', label: '7일 뒤' },
  { value: '30', label: '30일 뒤' },
  { value: '90', label: '90일 뒤' },
] as const

/** 지금 설정을 요청 모양으로 — 바꿀 필드만 덮어써 PUT 한다. */
function toRequest(share: WikiPageShare): WikiPageShareRequest {
  return {
    audience: share.audience,
    permission: share.permission,
    includeChildren: share.includeChildren,
    userIds: share.people.map((p) => p.userId),
    expiresAt: share.expiresAt,
  }
}

/**
 * 노트 페이지 공유 창(WP-579) — 스페이스 멤버가 아닌 사람에게 이 페이지를 링크로 보여 준다.
 * 바꾼 설정은 바로 적용된다(저장 버튼 없음). 더 많은 사람에게 열리는 변경과, 이미 연 사람을 끊는 재발급·해제는 확인을 받는다.
 */
export function WikiShareDialog({
  open,
  onOpenChange,
  pageId,
  spaceId,
  pageTitle,
  childCount,
  onOpenPage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageId: number
  spaceId: number
  pageTitle: string
  /** 지금 이 페이지 아래에 있는 페이지 수 — 「하위 페이지 포함」 옆에 보인다. */
  childCount: number
  /** 상위 공유 페이지로 가기(이 페이지가 상위 공유에 포함됐을 때). */
  onOpenPage: (pageId: number) => void
}) {
  const stateQuery = useWikiPageShare(pageId, open)
  const state = stateQuery.data
  const share = state?.share ?? null
  const { save, regenerate, revoke, decide, exclusion } = useWikiShareMutations(pageId, spaceId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const events = useWikiShareEvents(pageId, open && historyOpen)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 지정한 사람에 추가할 때 보낼 알림 — 기본 켬, 메시지는 선택.
  const [notify, setNotify] = useState(true)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const busy = save.isPending || regenerate.isPending || revoke.isPending

  /** 상위 공유 제외 켜기·풀기(WP-987) — targetPageId 는 이 페이지(하위 창) 또는 제외를 풀 하위(상위 창). */
  const setExcluded = (targetPageId: number, excluded: boolean) =>
    exclusion.mutate(
      { targetPageId, excluded },
      { onError: (e) => handleApiError(e, excluded ? '상위 공유에서 제외하지 못했습니다' : '제외를 풀지 못했습니다') },
    )

  /** 제외 풀기 — 풀면 외부 공개 공유에 들어가는 경우에만 확인부터(parentAudience = 그 하위를 다시 덮을 공유의 범위). */
  const liftExclusion = (targetPageId: number, parentAudience: WikiShareAudience | undefined) => {
    if (parentAudience === 'PUBLIC') setPending({ kind: 'includePublic', targetPageId })
    else setExcluded(targetPageId, false)
  }

  const apply = (next: WikiPageShareRequest) =>
    save.mutate(next, { onError: (e) => handleApiError(e, '공유 설정을 바꾸지 못했습니다') })

  /** 접근 요청 승인·거절 — 실패하면 알린다(이미 처리됐거나 권한이 바뀐 경우). */
  const decideRequest = (requestId: number, approve: boolean) =>
    decide.mutate(
      { requestId, approve },
      { onError: (e) => handleApiError(e, approve ? '접근 요청을 승인하지 못했습니다' : '접근 요청을 거절하지 못했습니다') },
    )

  /** 설정 한 가지 바꾸기 — 넓히는 변경이면 확인부터. */
  const change = (patch: Partial<WikiPageShareRequest>) => {
    if (!share) return
    const prev = toRequest(share)
    const next = { ...prev, ...patch }
    const widening = shareWidening(prev, next)
    if (widening) setPending({ kind: widening, next })
    else apply(next)
  }

  /** 열 수 있는 사람 바꾸기 — 외부로 가면 보기만·이 페이지만·30일 만료로 맞춘다(무기한·하위 포함은 직접 다시 고른다). */
  const changeAudience = (audience: WikiShareAudience) =>
    change(
      audience === 'PUBLIC'
        ? { audience, permission: 'VIEW', includeChildren: false, expiresAt: expiryAfterDays(PUBLIC_DEFAULT_EXPIRY_DAYS) }
        : { audience },
    )

  /** 사람 추가 — 알림을 켜 두었으면 메시지와 함께 보낸다. */
  const addPerson = (userId: number) => {
    if (!share) return
    change({
      userIds: [...share.people.map((p) => p.userId), userId],
      notify: notify ? { message: message.trim() || null } : undefined,
    })
  }

  const confirm = () => {
    const p = pending
    setPending(null)
    if (!p) return
    if (p.kind === 'regenerate') {
      regenerate.mutate(undefined, {
        onSuccess: () => toast.success('새 링크를 만들었습니다. 이전 링크는 이제 열리지 않습니다'),
        onError: (e) => handleApiError(e, '링크를 다시 만들지 못했습니다'),
      })
    } else if (p.kind === 'revoke') {
      revoke.mutate(undefined, {
        onSuccess: () => toast.success('공유를 해제했습니다'),
        onError: (e) => handleApiError(e, '공유를 해제하지 못했습니다'),
      })
    } else if (p.kind === 'includePublic') {
      setExcluded(p.targetPageId, false)
    } else if ('next' in p) {
      apply(p.next)
    }
  }

  const onCopy = async () => {
    if (share) await copyShareLink(share.token)
  }

  const isPublic = share?.audience === 'PUBLIC'
  const inherited = state?.inheritedFrom ?? null
  const revokeCopy =
    inherited && !state?.excludedFromParent ? { ...CONFIRM_COPY.revoke, body: REVOKE_INHERITED_BODY } : CONFIRM_COPY.revoke
  const copy = pending ? (pending.kind === 'revoke' ? revokeCopy : CONFIRM_COPY[pending.kind]) : null
  const excluded = state?.excludedPages ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="wiki-share-dialog">
          <DialogHeader>
            <DialogTitle>페이지 공유</DialogTitle>
            <DialogDescription className="truncate">{pageTitle || '제목 없음'}</DialogDescription>
          </DialogHeader>

          {/* 상위 페이지 공유(하위 포함)에서 받은 권한(WP-987) — 범위·권한, 이 페이지를 바로 여는 링크, 상위 공유에서 제외.
              이 페이지가 따로 공유를 켜면 그 설정이 상위보다 우선한다(아래 「링크로 공유」). */}
          {inherited && (
            <div className="space-y-2 rounded-md border px-3 py-2.5 text-xs" data-testid="wiki-share-inherited">
              <p className="font-medium text-foreground">상위 공유에서 받은 권한</p>
              <div className="flex items-start gap-2">
                <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-muted-foreground" data-testid="wiki-share-inherited-summary">
                  <span className="font-medium text-foreground">「{inherited.title}」</span> 공유 ·{' '}
                  {AUDIENCE_SUMMARY[inherited.audience]} · {inherited.permission === 'EDIT' ? '편집 가능' : '보기만'}
                </p>
              </div>
              {share || state?.excludedFromParent ? (
                <p className="text-muted-foreground" data-testid="wiki-share-inherited-overridden">
                  {share
                    ? '이 페이지는 따로 켠 공유를 따릅니다 — 상위 공유 링크로는 열리지 않습니다.'
                    : '상위 공유에서 제외되어 상위 공유 링크로는 이 페이지와 하위가 열리지 않습니다.'}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {!share && !state?.excludedFromParent && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void copyShareLink(inherited.token, pageId)}
                    data-testid="wiki-share-inherited-copy"
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                    이 페이지 링크 복사
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenPage(inherited.pageId)
                  }}
                >
                  그 페이지로
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <Checkbox
                  id="wiki-share-exclude"
                  data-testid="wiki-share-exclude"
                  checked={state?.excludedFromParent ?? false}
                  disabled={exclusion.isPending}
                  onCheckedChange={(v) => (v === true ? setExcluded(pageId, true) : liftExclusion(pageId, inherited.audience))}
                />
                <Label htmlFor="wiki-share-exclude" className="text-xs font-normal">
                  이 페이지와 하위는 상위 공유에서 제외
                </Label>
              </div>
            </div>
          )}

          {/* 접근 요청 — 지정한 사람이 아닌 멤버가 링크를 열고 요청했다. 승인하면 지정한 사람에 들어간다. */}
          {state && state.accessRequests.length > 0 && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="wiki-share-requests">
              <p className="text-xs font-medium">접근 요청 {state.accessRequests.length}건</p>
              <ul className="space-y-1.5">
                {state.accessRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {r.requester.name}
                      <span className="ml-2 text-xs text-muted-foreground">{formatMonthDayClock(r.requestedAt)}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        disabled={decide.isPending}
                        onClick={() => decideRequest(r.id, false)}
                      >
                        거절
                      </Button>
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={decide.isPending}
                        onClick={() => decideRequest(r.id, true)}
                      >
                        승인
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 공유 켜기·끄기 — 끄면(해제) 확인을 받는다. 켜면 기본값(워크스페이스 전체·보기)으로 링크가 생긴다. */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="wiki-share-switch" className="text-sm font-medium">
                링크로 공유
                {inherited && <span className="ml-1 font-normal text-muted-foreground">(이 페이지만 따로)</span>}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground" data-testid="wiki-share-switch-hint">
                {share
                  ? '스페이스 멤버가 아니어도 링크를 받은 사람은 이 페이지를 열 수 있습니다.'
                  : inherited
                    ? '켜면 이 페이지의 범위·권한이 상위 공유보다 우선합니다.'
                    : '지금은 스페이스 멤버만 이 페이지를 볼 수 있습니다.'}
              </p>
            </div>
            <BusySwitch
              id="wiki-share-switch"
              data-testid="wiki-share-switch"
              checked={share != null}
              disabled={stateQuery.isPending}
              busy={busy}
              onCheckedChange={(on) => (on ? apply(DEFAULT_SHARE) : setPending({ kind: 'revoke' }))}
            />
          </div>

          {share && state && (
            <div className="space-y-4">
              {/* 링크 주소 + 복사 — 가장 자주 하는 일이라 맨 위에 둔다. 아래 한 줄은 링크가 실제로 쓰이는지. */}
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={wikiShareUrl(share.token)}
                    aria-label="공유 링크"
                    data-testid="wiki-share-url"
                    className="flex-1 font-mono text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={onCopy} data-testid="wiki-share-copy">
                    <Link2 aria-hidden="true" />
                    링크 복사
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="wiki-share-usage">
                  {share.lastAccessedAt
                    ? `마지막으로 열림 ${formatMonthDayClock(share.lastAccessedAt)} · 모두 ${share.viewCount}회`
                    : '아직 아무도 열지 않았습니다'}
                </p>
              </div>

              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                <Label className="text-sm font-normal text-muted-foreground">열 수 있는 사람</Label>
                <Select
                  value={share.audience}
                  onValueChange={(v) => changeAudience(v as WikiShareAudience)}
                  disabled={busy}
                >
                  <SelectTrigger className="h-9" data-testid="wiki-share-audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WORKSPACE">워크스페이스 멤버 누구나</SelectItem>
                    <SelectItem value="PEOPLE">지정한 사람만</SelectItem>
                    {/* 관리자가 외부 공유를 막았으면 고를 수 없고 이유를 함께 보인다. */}
                    <SelectItem value="PUBLIC" disabled={!state.externalShareEnabled}>
                      링크가 있는 누구나(외부){!state.externalShareEnabled && ' — 관리자가 막아 둠'}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Label className="text-sm font-normal text-muted-foreground">권한</Label>
                <Select
                  value={share.permission}
                  onValueChange={(v) => change({ permission: v as WikiSharePermission })}
                  // 외부는 보기만 — 고를 것이 없다.
                  disabled={busy || isPublic}
                >
                  <SelectTrigger className="h-9" data-testid="wiki-share-permission">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEW">보기만</SelectItem>
                    <SelectItem value="EDIT">편집 가능</SelectItem>
                  </SelectContent>
                </Select>
                <Label className="text-sm font-normal text-muted-foreground">만료</Label>
                <Select
                  value={share.expiresAt ? 'current' : 'none'}
                  onValueChange={(v) => {
                    if (v === 'current') return
                    change({ expiresAt: v === 'none' ? null : expiryAfterDays(Number(v)) })
                  }}
                  disabled={busy}
                >
                  <SelectTrigger className="h-9" data-testid="wiki-share-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {share.expiresAt && <SelectItem value="current">{formatDateOnly(share.expiresAt)}까지</SelectItem>}
                    {EXPIRY_CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 지정한 사람 — 고른 사람만 링크를 열 수 있다. 비어 있으면 아무도 못 연다는 것을 분명히 한다. */}
              {share.audience === 'PEOPLE' && (
                <div className="space-y-2 rounded-md border p-3" data-testid="wiki-share-people">
                  {share.people.length === 0 ? (
                    <p className="text-xs text-muted-foreground">아직 지정한 사람이 없어 아무도 링크를 열 수 없습니다.</p>
                  ) : (
                    <ul className="space-y-1">
                      {share.people.map((p) => (
                        <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium"
                            >
                              {p.name.slice(0, 1)}
                            </span>
                            <span className="truncate">{p.name}</span>
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={`${p.name} 빼기`}
                            disabled={busy}
                            onClick={() => change({ userIds: share.people.filter((x) => x.userId !== p.userId).map((x) => x.userId) })}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <MemberSearchPopover
                      open={pickerOpen}
                      onOpenChange={setPickerOpen}
                      existingMemberIds={new Set(share.people.map((p) => p.userId))}
                      onSelect={(u) => addPerson(u.id)}
                      trigger={
                        <Button variant="outline" size="sm" disabled={busy} data-testid="wiki-share-add-person">
                          <UserPlus aria-hidden="true" />
                          사람 추가
                        </Button>
                      }
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={notify}
                        onCheckedChange={(v) => setNotify(v === true)}
                        data-testid="wiki-share-notify"
                      />
                      추가한 사람에게 알림 보내기
                    </label>
                  </div>
                  {notify && (
                    <Input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="알림에 함께 보낼 메시지(선택)"
                      maxLength={WIKI_SHARE_MESSAGE_MAX}
                      aria-label="알림 메시지"
                      className="h-8 text-xs"
                      data-testid="wiki-share-message"
                    />
                  )}
                </div>
              )}

              {/* 하위 페이지 포함 — 지금 위치 기준이라 나중에 옮겨 넣은 페이지도 함께 보인다. */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="wiki-share-children"
                  data-testid="wiki-share-children"
                  checked={share.includeChildren}
                  disabled={busy}
                  onCheckedChange={(v) => change({ includeChildren: v === true })}
                  className="mt-0.5"
                />
                <div>
                  <Label htmlFor="wiki-share-children" className="text-sm font-normal">
                    하위 페이지도 함께 공유
                    {childCount > 0 &&
                      ` (지금 ${childCount}개${share.includeChildren && excluded.length > 0 ? `, 제외 ${excluded.length}개` : ''})`}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    이 페이지 아래로 옮겨 넣은 페이지도 함께 보이고, 밖으로 옮긴 페이지는 더 이상 보이지 않습니다.
                  </p>
                  {/* 하위 창에서 「상위 공유에서 제외」한 페이지 — 여기서 바로 풀 수 있다(WP-987). */}
                  {share.includeChildren && excluded.length > 0 && (
                    <ul className="mt-1.5 space-y-1" data-testid="wiki-share-excluded">
                      {excluded.map((p) => (
                        <li key={p.pageId} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">제외: {p.title || '제목 없음'}</span>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto shrink-0 p-0 text-xs"
                            disabled={exclusion.isPending}
                            onClick={() => liftExclusion(p.pageId, share?.audience)}
                            data-testid={`wiki-share-excluded-lift-${p.pageId}`}
                          >
                            제외 풀기
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* 본문 속 다른 자원 링크는 받는 사람 권한대로 가려진다는 안내 — 외부는 무엇이 가려지는지 더 분명히. */}
              <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {isPublic
                  ? '로그인 없이 열리며 검색엔진에는 노출되지 않습니다. 본문 속 내부 링크·멘션·사람 이름은 「접근 권한 없음」으로 가려집니다.'
                  : '본문 속 다른 페이지·이슈·드라이브 링크는 받는 사람이 볼 수 없으면 「접근 권한 없음」으로 가려집니다.'}
              </p>

              {/* 공유 기록 — 펼칠 때 받는다. */}
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  data-testid="wiki-share-history-toggle"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', !historyOpen && '-rotate-90')} aria-hidden="true" />
                  공유 기록
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs" data-testid="wiki-share-history">
                    {events.isPending && <li className="text-muted-foreground">불러오는 중…</li>}
                    {events.isError && <li className="text-destructive">기록을 불러오지 못했습니다.</li>}
                    {events.data?.map((e) => (
                      <li key={e.id} className="flex gap-2">
                        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatMonthDayClock(e.at)}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium">{e.actor.name}</span>님이 {e.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            {share ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy}
                onClick={() => setPending({ kind: 'regenerate' })}
                data-testid="wiki-share-regenerate"
              >
                <RefreshCw aria-hidden="true" />
                링크 다시 만들기
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              완료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pending != null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent data-testid="wiki-share-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant={copy?.destructive ? 'destructive' : 'default'} onClick={confirm}>
              {copy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
