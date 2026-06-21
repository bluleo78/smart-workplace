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

import { driveApi } from '../../api/drive'
import type { DriveSpace } from '../../types/drive'

/** 좌측 2차 사이드바 — 내 드라이브 + 팀 공간 목록, 팀 공간 생성. */
export function DriveSidebar() {
  const [spaces, setSpaces] = useState<DriveSpace[]>([])
  const navigate = useNavigate()
  // 팀 공간 생성 다이얼로그 — window.prompt 대체 (#148).
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')

  async function reload() {
    const { data } = await driveApi.listSpaces()
    setSpaces(data)
  }
  useEffect(() => {
    void reload()
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
        <nav className="mt-2 space-y-1">
          {spaces.map((s) => (
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
