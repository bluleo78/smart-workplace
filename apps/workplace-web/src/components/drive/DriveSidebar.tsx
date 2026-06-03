import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

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
      className="flex w-60 shrink-0 flex-col border-r border-border p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">드라이브</span>
        <button
          type="button"
          onClick={onCreate}
          className="rounded px-2 py-0.5 text-sm text-primary hover:bg-accent"
        >
          + 공간
        </button>
      </div>
      <nav className="flex flex-col gap-0.5">
        {spaces.map((s) => (
          <NavLink
            key={s.id}
            to={`/drive/spaces/${s.id}`}
            className={({ isActive }) =>
              `truncate rounded px-2 py-1.5 text-sm ${
                isActive ? 'bg-accent font-medium' : 'hover:bg-accent/50'
              }`
            }
          >
            {s.type === 'PERSONAL' ? '내 드라이브' : s.name}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
