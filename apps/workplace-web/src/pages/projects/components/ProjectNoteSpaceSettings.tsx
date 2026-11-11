// 프로젝트 설정의 「노트 공간」 영역(WP-1480) — 프로젝트 소유자에게만 보인다.
// 지금 이어진 노트 공간 이름(노트로 가는 링크)과 「기존 팀 공간 연결」: 내가 소유자인 연결 안 된 팀 공간을 고르고 → 경고 확인 → 연결.
// 연결하면 서버가 자동 공간의 「리포트」 페이지를 고른 공간으로 옮기고, 프로젝트 멤버가 아닌 사람을 그 공간에서 뺀다.
import { BookOpen } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { SettingsSection } from '@/components/layout/SettingsSection'
import { LoadErrorState } from '@/components/LoadErrorState'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useLinkWikiProjectSpace, useWikiProjectSpace } from '@/hooks/queries/useWikiProjectSpace'
import { useWikiSpaces } from '@/hooks/queries/useWikiSpaces'
import { handleApiError, isNotFoundError } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { linkableTeamSpaces } from '@/lib/wikiSpaceGroups'
import type { WikiSpace } from '@/types/wiki'

/** 연결 확인 창의 경고 — 되돌리기 어려운 변화(페이지 이동·멤버 제외·자동 공간 삭제)와, 연결 뒤 공간 이름이 프로젝트 이름을 따라간다는 점을 미리 알린다. */
export const LINK_WARNING =
  '리포트 페이지가 이 공간으로 옮겨지고, 프로젝트 멤버가 아닌 사람은 이 공간에서 빠집니다. 자동으로 만든 공간은 비어 있으면 지워집니다. 공간 이름이 앞으로 프로젝트 이름을 따라갑니다.'

export function ProjectNoteSpaceSettings({ projectKey }: { projectKey: string }) {
  const space = useWikiProjectSpace(projectKey)
  const link = useLinkWikiProjectSpace(projectKey)
  // 고르기 창 — 열릴 때만 공간 목록을 받는다(설정 화면을 열 때마다 노트 공간 목록을 부르지 않게).
  const [pickOpen, setPickOpen] = useState(false)
  const spaces = useWikiSpaces({ enabled: pickOpen })
  const candidates = linkableTeamSpaces(spaces.data ?? [])
  // 고른 공간 — 고르는 순간의 객체를 붙잡아 둔다. 후보 목록에서 다시 찾으면 확인 창이 떠 있는 동안 목록이 다시 받아져
  // 그 공간이 빠질 때(다른 사람이 먼저 연결 등) 제목이 「「」 공간…」 으로 비고 연결도 조용히 멈췄다.
  const [pickedSpace, setPickedSpace] = useState<WikiSpace | null>(null)
  // 경고 확인 창은 고른 공간을 들고 연다 — 고른 공간이 없으면 열 수 없으니 제목·연결이 null 을 볼 일이 없다.
  const [confirmSpace, setConfirmSpace] = useState<WikiSpace | null>(null)
  // 404(공간 없음)만 「없다」로 보이고, 그 밖의 실패는 다시 시도 안내 — 실패를 「없음」으로 보이면 이미 있는 공간 위에 연결을 덮어쓰게 된다.
  const notFound = space.isError && isNotFoundError(space.error)
  const loadFailed = space.isError && !notFound && !space.data

  const openPicker = () => {
    setPickedSpace(null)
    setPickOpen(true)
  }

  const onPick = (value: string) => {
    setPickedSpace(candidates.find((s) => String(s.id) === value) ?? null)
  }

  // 연결 요청 중에는 확인 창을 닫지 않는다(Esc·바깥 누름·취소) — 닫히면 결과 토스트만 남고 무엇이 연결됐는지 놓친다.
  const onConfirmOpenChange = (open: boolean) => {
    if (!open && !link.isPending) setConfirmSpace(null)
  }

  const onConfirm = async (target: WikiSpace) => {
    try {
      const linked = await link.mutateAsync(target.id)
      toast.success(`「${linked.name}」 공간을 이 프로젝트의 노트 공간으로 연결했어요`)
      setConfirmSpace(null)
      setPickOpen(false)
    } catch (e) {
      // 403·409 는 서버의 한국어 사유(소유자 아님·이미 연결됨 등)를 그대로 토스트로 보인다.
      handleApiError(e, '노트 공간을 연결하지 못했어요')
      setConfirmSpace(null)
    }
  }

  return (
    <SettingsSection
      title="노트 공간"
      description="이 프로젝트 멤버만 쓰는 노트 공간이에요. 공간 멤버는 프로젝트 멤버와 같아요."
      data-testid="project-note-space"
    >
      <div className="space-y-3">
        {space.isPending ? (
          <Skeleton data-testid="project-note-space-pending" className="h-5 w-48" />
        ) : space.data ? (
          <Link
            to={`/wiki/spaces/${space.data.id}`}
            data-testid="project-note-space-link"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            <BookOpen aria-hidden className="size-3.5 shrink-0" />
            {space.data.name}
          </Link>
        ) : loadFailed ? (
          // 404 가 아닌 실패(네트워크·5xx) — 지금 연결된 공간을 모르니 다시 시도만 보이고 연결 단추는 숨긴다.
          <LoadErrorState
            variant="inline"
            title="노트 공간을 불러오지 못했습니다"
            queries={[space]}
            testId="project-note-space-error"
          />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="project-note-space-empty">
            연결된 노트 공간이 없어요.
          </p>
        )}
        {!loadFailed && (
          <div>
            <Button size="sm" variant="outline" onClick={openPicker} data-testid="project-note-space-link-open">
              기존 팀 공간 연결
            </Button>
          </div>
        )}
      </div>

      {/* 고르기 창 — 내가 소유자인, 다른 프로젝트에 연결되지 않은 팀 공간만 후보(서버도 같은 조건으로 거절한다). */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent data-testid="project-note-space-picker">
          <DialogHeader>
            <DialogTitle>기존 팀 공간 연결</DialogTitle>
            <DialogDescription>내가 소유자인 팀 공간을 이 프로젝트의 노트 공간으로 바꿔요.</DialogDescription>
          </DialogHeader>
          {spaces.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="project-note-space-no-candidates">
              연결할 수 있는 팀 공간이 없어요. 내가 소유자이고 다른 프로젝트에 연결되지 않은 팀 공간만 고를 수 있어요.
            </p>
          ) : (
            <RadioGroup value={pickedSpace ? String(pickedSpace.id) : ''} onValueChange={onPick} className="max-h-72 gap-1 overflow-y-auto" aria-label="연결할 팀 공간">
              {candidates.map((s) => (
                <label
                  key={s.id}
                  htmlFor={`project-note-space-${s.id}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm pointer-coarse:min-h-11',
                    pickedSpace?.id === s.id && 'border-foreground',
                  )}
                >
                  <RadioGroupItem value={String(s.id)} id={`project-note-space-${s.id}`} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                </label>
              ))}
            </RadioGroup>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickOpen(false)}>
              취소
            </Button>
            <Button onClick={() => setConfirmSpace(pickedSpace)} disabled={!pickedSpace} data-testid="project-note-space-link-next">
              연결…
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 경고 확인 창 — 연결의 결과(페이지 이동·멤버 제외·자동 공간 삭제)를 알리고 한 번 더 묻는다. */}
      <AlertDialog open={confirmSpace !== null} onOpenChange={onConfirmOpenChange}>
        {confirmSpace && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>「{confirmSpace.name}」 공간을 연결할까요?</AlertDialogTitle>
              <AlertDialogDescription>{LINK_WARNING}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={link.isPending} data-testid="project-note-space-link-cancel">
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // 요청이 끝날 때까지 창을 열어 둔다 — 닫는 일은 onConfirm 이 결과를 보고 한다.
                  e.preventDefault()
                  void onConfirm(confirmSpace)
                }}
                disabled={link.isPending}
                data-testid="project-note-space-link-confirm"
              >
                연결
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </SettingsSection>
  )
}
