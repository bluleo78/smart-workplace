// 태그 구독 주소 창 (WP-715, 시안 ④) — 태그를 붙인 일정을 iCal(.ics) 로 내보내는 비밀 주소를 만들고·복사하고·바꾸고·없앤다.
// WP-714(태그 화면)와 분리해 둔 파일이다 — 사이드바 ⋮ 「구독 주소…」가 이 창을 연다.
// 주소는 로그인 없이 열리므로(주소를 아는 사람은 누구나 볼 수 있음) 안내 문구와 재발급·폐기 확인을 분명히 둔다.
import { Copy } from 'lucide-react'
import { useRef, useState } from 'react'

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
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateTagFeed, useDeleteTagFeed, useTagFeed } from '@/hooks/queries/useCalendarTags'
import { copyToClipboard } from '@/lib/copyToClipboard'
import { formatDateMonthDay } from '@/lib/formatters'
import type { CalendarTag } from '@/types/calendar'

interface TagFeedDialogProps {
  /** 구독 주소를 다루는 태그 — null 이면 닫힘. hasFeed 는 목록 갱신에 따라 바뀌므로 호출부가 최신 태그를 넘긴다 */
  tag: CalendarTag | null
  onOpenChange: (open: boolean) => void
}

/** 확인이 필요한 파괴적 동작 — 새 주소로 바꾸기(이전 주소 무효) / 주소 없애기 */
type FeedConfirm = 'regenerate' | 'remove' | null

/** 태그 구독 주소 다이얼로그 — 주소가 있으면 주소·복사·재발급·폐기, 없으면 「구독 주소 만들기」. */
export function TagFeedDialog({ tag, onOpenChange }: TagFeedDialogProps) {
  const hasFeed = tag?.hasFeed ?? false
  const feed = useTagFeed(tag?.id, hasFeed)
  const createFeed = useCreateTagFeed()
  const deleteFeed = useDeleteTagFeed()
  const [confirm, setConfirm] = useState<FeedConfirm>(null)
  // 열 때 포커스를 둘 다이얼로그 요소
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <Dialog open={tag != null} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-lg"
          data-testid="calendar-tag-feed-dialog"
          // 열자마자 닫기(✕)·버튼에 포커스 테두리가 보이지 않게 다이얼로그 자체에 포커스를 둔다(일정 상세 보기와 같은 이유, WP-708)
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            contentRef.current?.focus()
          }}
          ref={contentRef}
        >
          <DialogHeader>
            <DialogTitle className="break-words">「{tag?.name}」 구독 주소</DialogTitle>
            <DialogDescription>
              {hasFeed
                ? '이 태그를 붙인 일정이 iCal(.ics) 형식으로 나갑니다. 주소를 아는 사람은 누구나 볼 수 있으니 필요한 곳에만 알려 주세요.'
                : '이 태그를 붙인 일정을 다른 시스템이 가져갈 수 있는 주소를 만듭니다. 설명은 나가지 않아요.'}
            </DialogDescription>
          </DialogHeader>

          {!hasFeed && (
            <div>
              <Button
                data-testid="calendar-tag-feed-create"
                disabled={createFeed.isPending}
                onClick={() => tag && createFeed.mutate(tag.id)}
              >
                구독 주소 만들기
              </Button>
            </div>
          )}

          {hasFeed && feed.isPending && <Skeleton className="h-9 w-full" data-testid="calendar-tag-feed-loading" />}

          {hasFeed && feed.isError && (
            <p className="text-sm text-destructive" role="alert">
              구독 주소를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.
            </p>
          )}

          {hasFeed && feed.data && (
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5">
                <label htmlFor="calendar-tag-feed-url" className="text-xs font-medium text-muted-foreground">
                  구독 주소
                </label>
                <div className="flex gap-2">
                  <Input
                    id="calendar-tag-feed-url"
                    data-testid="calendar-tag-feed-url"
                    readOnly
                    value={feed.data.url}
                    // 긴 주소는 잘려 보이지만 선택·복사는 전체가 된다. 눌러서 전체 선택
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 truncate font-mono text-xs text-ellipsis"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    data-testid="calendar-tag-feed-copy"
                    // 실패(권한·비보안 컨텍스트)하면 직접 선택해 복사하도록 안내한다
                    onClick={() =>
                      copyToClipboard(feed.data.url, {
                        success: '구독 주소를 복사했습니다',
                        failure: '복사에 실패했습니다. 주소를 직접 선택해 복사하세요.',
                      })
                    }
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                    복사
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  특정 주만: 주소 끝에 <code className="rounded bg-muted px-1 py-0.5 font-mono">?week=2026-W43</code> · 없으면 이번 주
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">나가는 항목</div>
                <p>제목 · 시간 · 장소 · 주최자와 참석자 이메일</p>
                <p className="text-xs text-muted-foreground" data-testid="calendar-tag-feed-count">
                  지금 이 태그를 붙인 일정 {feed.data.eventCount}개
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="calendar-tag-feed-regenerate"
                  disabled={createFeed.isPending}
                  onClick={() => setConfirm('regenerate')}
                >
                  새 주소로 바꾸기
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  data-testid="calendar-tag-feed-remove"
                  disabled={deleteFeed.isPending}
                  onClick={() => setConfirm('remove')}
                >
                  주소 없애기
                </Button>
                <span className="ml-auto text-xs text-muted-foreground" data-testid="calendar-tag-feed-created">
                  만든 날 {formatDateMonthDay(feed.data.createdAt)}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 새 주소로 바꾸기 확인 — 이전 주소가 바로 막힌다. 삭제가 아니라 공통 삭제 확인창 대신 따로 둔다 */}
      <AlertDialog open={confirm === 'regenerate'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid="calendar-tag-feed-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>새 주소로 바꾸기</AlertDialogTitle>
            <AlertDialogDescription>
              이전 주소는 바로 막혀요. 지금 가져가는 곳이 있으면 새 주소로 다시 설정해야 해요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="calendar-tag-feed-confirm-submit"
              onClick={() => tag && createFeed.mutate(tag.id)}
            >
              바꾸기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 주소 없애기 확인 — 구독이 끊긴다. 바꾸기 확인과 같은 testid(동시에 열리지 않는다) */}
      <DeleteConfirmDialog
        open={confirm === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        entityName="구독 주소"
        itemName={tag?.name ?? ''}
        description="지금 주소는 바로 막히고, 이 주소로 가져가던 곳은 더 받지 못해요. 나중에 다시 만들 수 있지만 주소는 새로 달라져요."
        onConfirm={() => tag && deleteFeed.mutate(tag.id)}
        contentTestId="calendar-tag-feed-confirm"
        confirmTestId="calendar-tag-feed-confirm-submit"
      />
    </>
  )
}
