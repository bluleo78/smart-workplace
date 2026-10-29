import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, Copy, Info, Link2, RefreshCw, UserPlus, X } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
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

import { useWikiPageShare, useWikiShareEvents, useWikiShareMutations } from '../../hooks/queries/useWikiShare'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import { useAuth } from '../../hooks/useAuth'
import type {
  WikiPageShare,
  WikiPageShareRequest,
  WikiPageShareState,
  WikiShareAudience,
  WikiSharePermission,
} from '../../types/wiki'
import { WIKI_SHARE_MESSAGE_MAX } from '../../types/wiki'
import { GroupMembers } from '../members/GroupMembers'
import type { GroupOption } from '../members/groupOptions'
import { PeopleAndDepartmentPicker } from '../members/PeopleAndDepartmentPicker'
import { addGroupMembers, fetchPersonalGroupMemberIds, groupExpansionMessage } from '../members/personalGroups'
import {
  copyShareLink,
  DEFAULT_SHARE,
  expiryAfterDays,
  isShareExpired,
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

/** 공유 스위치 아래 한 줄 — 지금 이 페이지가 링크로 열리는지. 만료된 자기 공유는 상속을 멈추지 않아(WP-1043) 상위 공유가 덮으면 그 링크로는 열린다(WP-1086). */
function switchHint({
  live,
  expired,
  inherited,
  inheritedOpen,
}: {
  live: boolean
  expired: boolean
  inherited: boolean
  inheritedOpen: boolean
}): string {
  if (expired && inheritedOpen)
    return '이 페이지의 링크는 만료됐습니다. 상위 페이지 공유 링크로는 계속 열 수 있습니다. 만료를 바꾸면 다시 열립니다.'
  if (expired) return '링크가 만료되어 지금은 아무도 열 수 없습니다. 만료를 바꾸면 다시 열립니다.'
  if (live) return '스페이스 멤버가 아니어도 링크를 받은 사람은 이 페이지를 열 수 있습니다.'
  if (inherited) return '켜면 이 페이지의 범위·권한이 상위 공유보다 우선합니다.'
  return '지금은 스페이스 멤버만 이 페이지를 볼 수 있습니다.'
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
    // 지정한 부서도 늘 함께 보낸다(WP-1023) — 덮어쓰는 PUT 이라 다른 설정을 바꿀 때 부서가 그대로 남게.
    groupIds: share.groups.map((g) => g.groupId),
    expiresAt: share.expiresAt,
  }
}

/** 목록 끝에 id 하나 더하기 — 이미 있으면 그대로(같은 대상을 잇달아 두 번 골라도 한 번만 들어간다). */
function addUnique(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids : [...ids, id]
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
  // 만료된 공유(WP-1086) — 설정은 남아 고칠 수 있지만 링크는 열리지 않는다. 그래서 링크 복사를 막고 만료를 알린다(만료를 미루면 다시 열린다).
  const expired = share != null && isShareExpired(share.expiresAt)
  // 지금 링크가 열리는 자기 공유 — 만료된 자기 공유는 상위 공유(하위 포함)를 덮지 않는다(WP-1043). 상위 공유 상자·안내는 이 값으로 가른다.
  const liveShare = share != null && !expired
  const { save, regenerate, revoke, decide, exclusion } = useWikiShareMutations(pageId, spaceId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const events = useWikiShareEvents(pageId, open && historyOpen)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 구성원을 펼쳐 본 부서(WP-1048) — 부서 행의 ▾.
  const [openGroupIds, setOpenGroupIds] = useState<Set<number>>(() => new Set())
  const toggleGroupMembers = (groupId: number) =>
    setOpenGroupIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(groupId)) next.add(groupId)
      return next
    })
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

  const qc = useQueryClient()
  const { user } = useAuth()
  // 이 창의 공유 바꾸기 차례(WP-1023) — 마지막으로 올린 바꾸기가 끝나면 풀리는 약속. 저장은 덮어쓰는 PUT 이라, 앞 저장이 끝나기 전에 다음
  // 추가(부서 A 뒤 부서 B 등)가 그때 화면의 공유로 요청을 만들면 앞에서 더한 대상이 지워진다. 그래서 모든 바꾸기를 여기에 하나씩 잇는다. 이벤트 처리에서만 읽고 쓴다.
  const settledSaves = useRef<Promise<void>>(Promise.resolve())

  /**
   * 바꾸기 하나를 차례에 올린다 — 부르는 순간(동기로) 지금까지의 차례 뒤에 이어 두므로, 앞 바꾸기를 기다리는 사이 새로 시작된 바꾸기도 빠짐없이 이 뒤에
   * 선다. step 이 실패해도 다음 차례는 이어진다(오류는 step 안에서 알린다).
   */
  const inTurn = (step: () => Promise<void> | void) => {
    settledSaves.current = settledSaves.current.then(step).catch(() => undefined)
  }

  /** 차례가 온 때의 최신 공유 — 앞 저장의 응답이 캐시에 반영된 값(화면의 share 는 다시 그리기 전이면 옛 값일 수 있다). */
  const latestShare = () => qc.getQueryData<WikiPageShareState>(wikiKeys.share(pageId))?.share ?? null

  /**
   * 설정 저장(차례 안에서 부른다) — 끝날 때까지 기다리고, 실패하면 알린다. onSuccess 는 저장된 뒤 할 일(안내 등). mutate 의 호출별 콜백은
   * 다음 호출이 오거나 화면이 사라지면 불리지 않을 수 있어, 차례가 멈추지 않게 mutateAsync 로 끝을 기다린다.
   */
  const saveNow = async (next: WikiPageShareRequest, onSuccess?: () => void) => {
    try {
      await save.mutateAsync(next)
      onSuccess?.()
    } catch (e) {
      handleApiError(e, '공유 설정을 바꾸지 못했습니다')
    }
  }

  /** 설정 그대로 저장 — 확인을 받은 변경·공유 켜기. 앞 바꾸기가 끝난 뒤 보낸다. */
  const apply = (next: WikiPageShareRequest) => inTurn(() => saveNow(next))

  /** 접근 요청 승인·거절 — 실패하면 알린다(이미 처리됐거나 권한이 바뀐 경우). */
  const decideRequest = (requestId: number, approve: boolean) =>
    decide.mutate(
      { requestId, approve },
      { onError: (e) => handleApiError(e, approve ? '접근 요청을 승인하지 못했습니다' : '접근 요청을 거절하지 못했습니다') },
    )

  /**
   * 설정 한 가지 바꾸기 — 차례가 오면 그때의 최신 공유에 이 바꾸기만 얹어 요청을 만든다(앞 저장에서 더한 사람·부서가 남게). patch 를 함수로 주면
   * 최신 공유를 받아 바꿀 값을 정한다(사람·부서 더하기·빼기). 넓히는 변경이면 확인부터. 그 사이 공유가 해제됐으면 하지 않는다.
   */
  const change = (patch: Partial<WikiPageShareRequest> | ((latest: WikiPageShare) => Partial<WikiPageShareRequest>)) =>
    inTurn(async () => {
      const latest = latestShare()
      if (!latest) return
      const prev = toRequest(latest)
      const next = { ...prev, ...(typeof patch === 'function' ? patch(latest) : patch) }
      const widening = shareWidening(prev, next)
      if (widening) setPending({ kind: widening, next })
      else await saveNow(next)
    })

  /** 열 수 있는 사람 바꾸기 — 외부로 가면 보기만·이 페이지만·30일 만료로 맞춘다(무기한·하위 포함은 직접 다시 고른다). */
  const changeAudience = (audience: WikiShareAudience) =>
    change(
      audience === 'PUBLIC'
        ? { audience, permission: 'VIEW', includeChildren: false, expiresAt: expiryAfterDays(PUBLIC_DEFAULT_EXPIRY_DAYS) }
        : { audience },
    )

  /** 추가할 때 함께 보낼 알림 — 알림을 켜 두었으면 메시지(선택)와 함께, 끄면 싣지 않는다. */
  const notifyPayload = () => (notify ? { message: message.trim() || null } : undefined)

  /** 사람 추가 — 알림을 켜 두었으면 메시지와 함께 보낸다. 차례가 온 때의 사람 목록에 더한다(이미 있으면 그대로). */
  const addPerson = (userId: number) => {
    const notifyWith = notifyPayload()
    change((latest) => ({ userIds: addUnique(latest.people.map((p) => p.userId), userId), notify: notifyWith }))
  }

  /** 조직도 부서 추가(WP-1023) — 부서 행으로 저장한다. 그 부서와 하위 부서의 구성원은 열 때마다 다시 판정돼 나중에 들어온 사람도 열 수 있다. */
  const addDepartment = (group: GroupOption) => {
    const notifyWith = notifyPayload()
    change((latest) => ({ groupIds: addUnique(latest.groups.map((g) => g.groupId), group.id), notify: notifyWith }))
  }

  /**
   * 내 그룹 추가(WP-1023) — 그룹을 대상으로 남기지 않고 그룹과 하위 그룹의 지금 사람 구성원을 지정한 사람으로 펼쳐 더한다(이미 있는 사람은 빼고,
   * 공유하는 나와 공유를 만든 사람은 이미 열 수 있어 더하지도 세지도 않는다). 구성원은 그룹마다 상세에서 받는다(서버가 이 워크스페이스의 활성 사람만 준다 —
   * 외부 연락처는 사람이 아니라 뺀다). 구성원을 받은 뒤 차례에 올려, 앞 바꾸기가 끝난 때의 최신 공유에 더한다. 더할 사람이 없으면 저장하지 않고 알린다.
   */
  const addPersonalGroup = async (group: GroupOption) => {
    if (!share) return
    const notifyWith = notifyPayload()
    let memberIds: number[]
    try {
      memberIds = await fetchPersonalGroupMemberIds(group)
    } catch (e) {
      handleApiError(e, '그룹 구성원을 불러오지 못했습니다')
      return
    }
    inTurn(async () => {
      const latest = latestShare()
      // 받는 사이 공유가 해제됐거나 지정한 사람 공유가 아니게 됐으면 더할 곳이 없다.
      if (!latest || latest.audience !== 'PEOPLE') return
      const { userIds, added, skipped } = addGroupMembers(
        latest.people.map((p) => p.userId),
        memberIds,
        [user?.id, latest.createdBy.userId].filter((id): id is number => id != null),
      )
      const text = groupExpansionMessage(group.name, added, skipped)
      if (added === 0) {
        toast.info(text)
        return
      }
      // 사람 추가는 넓히는 변경이 아니라(직접 고른 사람) 확인 없이 저장하고, 저장된 뒤에 몇 명을 더했는지 알린다.
      await saveNow({ ...toRequest(latest), userIds, notify: notifyWith }, () => toast.success(text))
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
        {/* 자식에 min-w-0 — DialogContent 는 grid 라 자식이 min-width: auto(내용 폭)로 열을 넓힌다. 띄어쓰기 없는 긴 이름(제목·부서·사람·요청자)
            한 줄이 창 전체를 옆으로 늘려 스위치·버튼이 창 밖으로 밀리지 않게(WP-1068). 폭 상한은 sm 이상에서만 — 휴대폰은 기본 좌우 여백을 남긴다. */}
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg [&>*]:min-w-0" data-testid="wiki-share-dialog">
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
              {liveShare || state?.excludedFromParent ? (
                <p className="text-muted-foreground" data-testid="wiki-share-inherited-overridden">
                  {liveShare
                    ? '이 페이지는 따로 켠 공유를 따릅니다 — 상위 공유 링크로는 열리지 않습니다.'
                    : '상위 공유에서 제외되어 상위 공유 링크로는 이 페이지와 하위가 열리지 않습니다.'}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {!liveShare && !state?.excludedFromParent && (
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
              <p
                className={cn('mt-0.5 text-xs', expired ? 'text-destructive' : 'text-muted-foreground')}
                data-testid="wiki-share-switch-hint"
              >
                {switchHint({ live: liveShare, expired, inheritedOpen: inherited != null && !state?.excludedFromParent, inherited: inherited != null })}
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
                    // 만료된 링크는 열리지 않는다는 것을 주소에도 보인다(지워진 주소처럼 흐리게).
                    className={cn('flex-1 font-mono text-xs', expired && 'text-muted-foreground line-through')}
                    onFocus={(e) => e.target.select()}
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={onCopy} disabled={expired} data-testid="wiki-share-copy">
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
                    {share.expiresAt && (
                      <SelectItem value="current">
                        {expired ? `만료됨 (${formatDateOnly(share.expiresAt)})` : `${formatDateOnly(share.expiresAt)}까지`}
                      </SelectItem>
                    )}
                    {EXPIRY_CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 지정한 사람·부서 — 고른 사람과 고른 부서(하위 부서 포함)의 구성원만 링크를 열 수 있다. 비어 있으면 아무도 못 연다는 것을 분명히 한다. */}
              {share.audience === 'PEOPLE' && (
                <div className="space-y-2 rounded-md border p-3" data-testid="wiki-share-people">
                  {share.people.length === 0 && share.groups.length === 0 ? (
                    <p className="text-xs text-muted-foreground">아직 지정한 사람·부서가 없어 아무도 링크를 열 수 없습니다.</p>
                  ) : (
                    <ul className="space-y-1">
                      {/* 지정한 조직도 부서(WP-1023) — 한 줄로 이름과 지금 열 수 있는 사람 수(하위 부서 포함). 구성원이 바뀌면 열 수 있는 사람도 바뀐다. */}
                      {/* ▾ 로 지금 열 수 있는 구성원(하위 부서 포함)을 펼쳐 본다(WP-1048) — 펼칠 때만 받는다. */}
                      {share.groups.map((g) => {
                        const membersOpen = openGroupIds.has(g.groupId)
                        return (
                          <li key={`g${g.groupId}`} className="text-sm" data-testid={`wiki-share-group-${g.groupId}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                                >
                                  <Building2 className="size-3.5" />
                                </span>
                                {/* flex 항목은 min-w-0 이 있어야 내용 폭보다 줄어 말줄임된다 — 띄어쓰기 없는 긴 이름이 줄을 늘리지 않게(WP-1068). */}
                                <span className="min-w-0 truncate">
                                  {g.name} · {g.memberCount}명
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 shrink-0 text-muted-foreground"
                                  aria-label={`${g.name} 구성원 ${membersOpen ? '접기' : '보기'}`}
                                  aria-expanded={membersOpen}
                                  onClick={() => toggleGroupMembers(g.groupId)}
                                  data-testid={`wiki-share-group-toggle-${g.groupId}`}
                                >
                                  <ChevronDown className={cn('transition-transform', !membersOpen && '-rotate-90')} aria-hidden="true" />
                                </Button>
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-muted-foreground"
                                aria-label={`${g.name} 빼기`}
                                disabled={busy}
                                onClick={() => {
                                  // 뺀 부서의 펼침도 지운다 — 다시 더했을 때 펼친 채로 나와 구성원을 바로 받지 않게.
                                  if (membersOpen) toggleGroupMembers(g.groupId)
                                  change((latest) => ({
                                    groupIds: latest.groups.filter((x) => x.groupId !== g.groupId).map((x) => x.groupId),
                                  }))
                                }}
                              >
                                <X aria-hidden="true" />
                              </Button>
                            </div>
                            {membersOpen && <GroupMembers groupId={g.groupId} testId={`wiki-share-group-members-${g.groupId}`} inset="share-row" />}
                          </li>
                        )
                      })}
                      {share.people.map((p) => (
                        <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium"
                            >
                              {p.name.slice(0, 1)}
                            </span>
                            <span className={cn('min-w-0 truncate', p.active === false && 'text-muted-foreground')}>{p.name}</span>
                            {/* 정지·비활성 계정은 지정이 남아 있어도 열지 못해 「비활성」으로 구분한다(WP-1063, 표시는 WP-723 채널 구성원과 같음). */}
                            {p.active === false && (
                              <Badge
                                variant="outline"
                                className="shrink-0"
                                title="정지되었거나 비활성인 계정이라 이 페이지를 열 수 없습니다"
                                data-testid={`wiki-share-person-inactive-${p.userId}`}
                              >
                                비활성
                              </Badge>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground"
                            aria-label={`${p.name} 빼기`}
                            disabled={busy}
                            onClick={() =>
                              change((latest) => ({
                                userIds: latest.people.filter((x) => x.userId !== p.userId).map((x) => x.userId),
                              }))
                            }
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {/* 사람·조직도 부서·내 그룹을 한 검색에서 고른다(WP-1023). */}
                    <PeopleAndDepartmentPicker
                      open={pickerOpen}
                      onOpenChange={setPickerOpen}
                      existingUserIds={new Set(share.people.map((p) => p.userId))}
                      existingGroupIds={new Set(share.groups.map((g) => g.groupId))}
                      excludeUserIds={new Set([user?.id, share.createdBy.userId].filter((id): id is number => id != null))}
                      onSelectPerson={addPerson}
                      onSelectDepartment={addDepartment}
                      onSelectPersonalGroup={(g) => void addPersonalGroup(g)}
                      trigger={
                        <Button variant="outline" size="sm" disabled={busy} data-testid="wiki-share-add-person">
                          <UserPlus aria-hidden="true" />
                          사람·팀 추가
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
