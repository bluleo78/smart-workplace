// 채널 사이드바 — 내 채널만 노출. 상단 "+ 채널"(생성), "탐색"(브라우저) 액션. 비공개엔 자물쇠.
// 하단엔 DM 섹션(내 DM 목록 + 새 메시지 버튼).
import { Hash, Lock, MessageSquare, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAuth } from '@/hooks/useAuth'
import { dmDisplayName } from '@/lib/dm'
import { cn } from '@/lib/utils'

import { ChannelBrowser } from './ChannelBrowser'
import { CreateChannelModal } from './CreateChannelModal'
import { NewDmModal } from './NewDmModal'

export function ChannelSidebar() {
  const { id } = useParams()
  const activeId = id ? Number(id) : undefined
  // 채널·DM 라우트가 같은 :id param 을 공유 → 활성 하이라이트가 교차로 켜지지 않도록 경로로 분기.
  const location = useLocation()
  const isDmRoute = location.pathname.startsWith('/chat/dms/')
  const { data: channels, isLoading } = useMyChannels()
  const { data: dms } = useMyDms()
  const { user } = useAuth()
  const myId = user?.id ?? 0
  const [createOpen, setCreateOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [newDmOpen, setNewDmOpen] = useState(false)

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
      data-testid="channel-sidebar"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "대화" 앱임을 명시(Slack 모델) */}
      <div className={sidebarTitleClass}>
        <MessageSquare className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        대화
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 채널 섹션 헤더 — 탐색/생성 액션을 섹션 헤더에 배치(표준 사이드바 패턴) */}
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            채널
          </span>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              data-testid="channel-browse-btn"
              aria-label="채널 탐색"
              onClick={() => setBrowseOpen(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              data-testid="channel-create-btn"
              aria-label="채널 만들기"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {isLoading && <div className="px-3 text-sm text-muted-foreground">불러오는 중…</div>}
        <nav className="mt-2 space-y-1">
          {channels?.map((c) => (
            <Link
              key={c.id}
              to={`/chat/channels/${c.id}`}
              data-testid={`channel-link-${c.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                !isDmRoute && activeId === c.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {c.visibility === 'PRIVATE' ? (
                <Lock className="h-4 w-4 shrink-0" data-testid={`channel-lock-${c.id}`} />
              ) : (
                <Hash className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              {c.unreadCount > 0 && (
                <span
                  data-testid={`channel-unread-${c.id}`}
                  className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
                >
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* DM 섹션 헤더 — 내 DM 목록 + 새 메시지 버튼. */}
        <div className="mt-5 flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            다이렉트 메시지
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            data-testid="dm-new-btn"
            aria-label="새 메시지"
            onClick={() => setNewDmOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <nav className="mt-2 space-y-1" data-testid="dm-list">
          {dms?.map((dm) => (
            <Link
              key={dm.id}
              to={`/chat/dms/${dm.id}`}
              data-testid={`dm-link-${dm.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                isDmRoute && activeId === dm.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="truncate">{dmDisplayName(dm, myId)}</span>
              {dm.unreadCount > 0 && (
                <span
                  data-testid={`dm-unread-${dm.id}`}
                  className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
                >
                  {dm.unreadCount > 99 ? '99+' : dm.unreadCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>

      <NewDmModal open={newDmOpen} onOpenChange={setNewDmOpen} />
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
      <ChannelBrowser open={browseOpen} onOpenChange={setBrowseOpen} />
    </aside>
  )
}
