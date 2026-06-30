import { HardDrive, MoreHorizontal, Paperclip, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { partitionSpaces } from '@/lib/driveSpaces'
import { formatFileSize } from '@/lib/formatters'

import { driveApi } from '../../api/drive'
import type { DriveQuota, DriveSpace } from '../../types/drive'

/** 좌측 2차 사이드바 — 내 드라이브 + 팀 공간 목록, 팀 공간 생성. */
export function DriveSidebar() {
  const [spaces, setSpaces] = useState<DriveSpace[]>([])
  const navigate = useNavigate()
  // 팀 공간 생성 다이얼로그 — window.prompt 대체 (#148).
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  // 드라이브 쿼터 — 사이드바 하단 사용량 바 (#81).
  const [quota, setQuota] = useState<DriveQuota | null>(null)
  // TEAM 공간 이름 변경/삭제 대상 — kebab 메뉴에서 설정(제어형 다이얼로그).
  const [renameTarget, setRenameTarget] = useState<DriveSpace | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveSpace | null>(null)

  async function reload() {
    const { data } = await driveApi.listSpaces()
    setSpaces(data)
  }
  useEffect(() => {
    void reload()
  }, [])

  useEffect(() => {
    void driveApi.getQuota().then(({ data }) => setQuota(data))
  }, [])


  /** 팀 공간 생성 — 다이얼로그 확인 시 호출. */
  async function submitCreate() {
    const trimmed = spaceName.trim()
    if (!trimmed) return
    setSpaceDialogOpen(false)
    setSpaceName('')
    const { data } = await driveApi.createSpace(trimmed)
    await reload()
    navigate(`/drive/spaces/${data.id}`)
  }

  /** 이름 변경 확정 — RenameDialog onConfirm. */
  async function submitRename(name: string) {
    if (!renameTarget) return
    await driveApi.renameSpace(renameTarget.id, name)
    setRenameTarget(null)
    await reload()
  }

  /** 삭제 확정 — 내용물 통째 영구삭제. 보고 있던 공간이면 드라이브 홈으로 이동. */
  async function submitDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    await driveApi.deleteSpace(id)
    await reload()
    navigate('/drive')
  }

  // 채널 연동 space(type==='CHANNEL')는 드라이브 사이드바에 노출하지 않는다.
  // 파일의 집은 대화 컨텍스트(채널) — 채널 "파일" 드로워가 진입점이고, 풀페이지는
  // 드로워의 "전체에서 열기" 딥링크로 도달한다. 전역 드라이브에 채널 수만큼 평면
  // 나열하면 "두 개의 집" 문제가 재발하므로 primary(개인·팀)만 렌더한다.
  const { primary } = partitionSpaces(spaces)

  return (
    <aside
      data-testid="drive-sidebar"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "드라이브" 앱임을 명시 */}
      <div className={sidebarTitleClass}>
        <HardDrive className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        드라이브
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 공간 섹션 헤더 — 팀 공간 생성 액션을 섹션 헤더에 배치(표준 사이드바 패턴) */}
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            공간
          </span>
          <button
            type="button"
            aria-label="팀 공간 만들기"
            onClick={() => setSpaceDialogOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <nav className="mt-2 space-y-1" data-testid="drive-space-list">
          {primary.map((s) => (
            <div key={s.id} className="group/space relative flex items-center">
              <NavLink
                to={`/drive/spaces/${s.id}`}
                className={({ isActive }) => sidebarLinkClass({ isActive }) + ' flex-1 pr-7'}
              >
                {s.type === 'PERSONAL' ? '내 드라이브' : s.name}
              </NavLink>
              {/* TEAM 공간 + OWNER 만 이름 변경/삭제 메뉴 노출(개인·채널 공간 제외) */}
              {s.type === 'TEAM' && s.role === 'OWNER' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${s.name} 메뉴`}
                      data-testid={`drive-space-menu-${s.id}`}
                      className="absolute right-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/space:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid={`drive-space-rename-${s.id}`}
                      onSelect={() => setRenameTarget(s)}
                    >
                      이름 변경
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid={`drive-space-delete-${s.id}`}
                      onSelect={() => setDeleteTarget(s)}
                    >
                      삭제
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* 첨부 모아보기 — 사용량 바 바로 위 하단 그룹(스크롤 영역 밖 고정). 공간 목록과 구분선으로
          분리(평소 잘 안 보는 보조 뷰라 공간 아래 배치, #80 IA). */}
      <div className="border-t p-3">
        <NavLink
          to="/drive/attachments"
          data-testid="drive-nav-attachments"
          className={({ isActive }) => sidebarLinkClass({ isActive })}
        >
          <Paperclip className="h-4 w-4 shrink-0" />
          첨부 모아보기
        </NavLink>
      </div>

      {/* 사용량 바 — 사이드바 하단 고정(#81) */}
      {quota && (
        <div className="border-t p-3" data-testid="drive-usage-bar">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>사용량</span>
            <span data-testid="drive-usage-text">
              {formatFileSize(quota.usedBytes)} / {formatFileSize(quota.quotaBytes)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, (quota.usedBytes / Math.max(1, quota.quotaBytes)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 팀 공간 이름 입력 다이얼로그 — window.prompt 대체 (#148) */}
      <Dialog
        open={spaceDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSpaceDialogOpen(false)
            setSpaceName('')
          }
        }}
      >
        <DialogContent data-testid="space-name-dialog">
          <DialogHeader>
            <DialogTitle>새 팀 공간</DialogTitle>
            <DialogDescription className="sr-only">새 팀 공간</DialogDescription>
          </DialogHeader>
          <Input
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitCreate()
            }}
            placeholder="공간 이름"
            autoFocus
            data-testid="space-name-input"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setSpaceDialogOpen(false); setSpaceName('') }}
            >
              취소
            </Button>
            <Button onClick={() => void submitCreate()} data-testid="space-name-confirm">
              만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TEAM 공간 이름 변경 — 제어형 RenameDialog */}
      <RenameDialog
        open={renameTarget != null}
        title="공간 이름 변경"
        initialValue={renameTarget?.name ?? ''}
        onConfirm={(name) => void submitRename(name)}
        onClose={() => setRenameTarget(null)}
      />

      {/* TEAM 공간 삭제 — 내용물 통째 영구삭제 경고 */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent data-testid="drive-space-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>공간 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; 공간과 모든 파일·폴더가 영구 삭제됩니다. 이 작업은
              되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="drive-space-delete-confirm"
              onClick={() => void submitDelete()}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
