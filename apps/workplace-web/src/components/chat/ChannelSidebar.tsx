// 채널 목록 사이드바. 공개 채널 전체 노출, 미참여 채널은 "참여" 버튼.
import { Hash } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useChannels } from '@/hooks/queries/useChannels'
import { useJoinChannel } from '@/hooks/queries/useJoinChannel'
import { cn } from '@/lib/utils'

export function ChannelSidebar() {
  const { id } = useParams()
  const activeId = id ? Number(id) : undefined
  const { data: channels, isLoading } = useChannels()
  const join = useJoinChannel()

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar p-2" data-testid="channel-sidebar">
      <div className="px-2 py-2 text-xs font-semibold text-muted-foreground">채널</div>
      {isLoading && <div className="px-2 text-sm text-muted-foreground">불러오는 중…</div>}
      <nav className="space-y-1">
        {channels?.map((c) => (
          <div key={c.id} className="flex items-center gap-1">
            <Link
              to={`/chat/channels/${c.id}`}
              data-testid={`channel-link-${c.id}`}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                activeId === c.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Hash className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.name}</span>
            </Link>
            {!c.member && (
              <Button
                size="sm"
                variant="ghost"
                data-testid={`channel-join-${c.id}`}
                disabled={join.isPending}
                onClick={() => join.mutate(c.id)}
              >
                참여
              </Button>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
