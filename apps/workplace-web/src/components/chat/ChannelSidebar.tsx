// 채널 사이드바 — 내 채널만 노출. 상단 "+ 채널"(생성), "탐색"(브라우저) 액션. 비공개엔 자물쇠.
import { Hash, Lock, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { cn } from '@/lib/utils'

import { ChannelBrowser } from './ChannelBrowser'
import { CreateChannelModal } from './CreateChannelModal'

export function ChannelSidebar() {
  const { id } = useParams()
  const activeId = id ? Number(id) : undefined
  const { data: channels, isLoading } = useMyChannels()
  const [createOpen, setCreateOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar p-2" data-testid="channel-sidebar">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-xs font-semibold text-muted-foreground">채널</span>
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
      {isLoading && <div className="px-2 text-sm text-muted-foreground">불러오는 중…</div>}
      <nav className="space-y-1">
        {channels?.map((c) => (
          <Link
            key={c.id}
            to={`/chat/channels/${c.id}`}
            data-testid={`channel-link-${c.id}`}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              activeId === c.id
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
          </Link>
        ))}
      </nav>
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
      <ChannelBrowser open={browseOpen} onOpenChange={setBrowseOpen} />
    </aside>
  )
}
