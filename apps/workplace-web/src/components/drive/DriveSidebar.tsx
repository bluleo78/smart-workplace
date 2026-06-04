import { HardDrive, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'

import { driveApi } from '../../api/drive'
import type { DriveSpace } from '../../types/drive'

/** 좌측 2차 사이드바 — 내 드라이브 + 팀 공간 목록, 팀 공간 생성. */
export function DriveSidebar() {
  const [spaces, setSpaces] = useState<DriveSpace[]>([])
  const navigate = useNavigate()

  async function reload() {
    const { data } = await driveApi.listSpaces()
    setSpaces(data)
  }
  useEffect(() => {
    void reload()
  }, [])

  async function onCreate() {
    const name = window.prompt('새 팀 공간 이름')
    if (!name) return
    const { data } = await driveApi.createSpace(name)
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
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            공간
          </span>
          <button
            type="button"
            aria-label="팀 공간 만들기"
            onClick={onCreate}
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
              className={({ isActive }) =>
                `flex items-center gap-2 truncate rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`
              }
            >
              {s.type === 'PERSONAL' ? '내 드라이브' : s.name}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  )
}
