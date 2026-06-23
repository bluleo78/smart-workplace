import { HardDrive, Paperclip, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { partitionSpaces } from '@/lib/driveSpaces'

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

  const GB = 1024 * 1024 * 1024
  function fmtGb(bytes: number) {
    return (bytes / GB).toFixed(1)
  }

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
        {/* 가상 뷰 — 이슈/메시지 첨부 크로스링크 (#80) */}
        <nav className="mb-3 space-y-1">
          <NavLink
            to="/drive/attachments"
            data-testid="drive-nav-attachments"
            className={({ isActive }) => sidebarLinkClass({ isActive })}
          >
            <Paperclip className="h-4 w-4 shrink-0" />
            이슈/메시지 첨부
          </NavLink>
        </nav>

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
            <NavLink
              key={s.id}
              to={`/drive/spaces/${s.id}`}
              className={({ isActive }) => sidebarLinkClass({ isActive })}
            >
              {s.type === 'PERSONAL' ? '내 드라이브' : s.name}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* 사용량 바 — 사이드바 하단 고정(#81) */}
      {quota && (
        <div className="border-t p-3" data-testid="drive-usage-bar">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>사용량</span>
            <span data-testid="drive-usage-text">
              {fmtGb(quota.usedBytes)} / {fmtGb(quota.quotaBytes)} GB
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
    </aside>
  )
}
