// 공개 채널 탐색 모달 — q 검색 + 결과 목록. 비멤버엔 "참여". 비공개는 서버 미반환.
import { Hash } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDiscoverChannels } from '@/hooks/queries/useDiscoverChannels'
import { useJoinChannel } from '@/hooks/queries/useJoinChannel'
import { useDebounceValue } from '@/hooks/useDebounceValue'

export function ChannelBrowser({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const debounced = useDebounceValue(query, 300)
  // 모달 열린 동안에만 검색 호출.
  const { data: channels, isLoading } = useDiscoverChannels(debounced, open)
  const join = useJoinChannel()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channel-browser">
        <DialogHeader>
          <DialogTitle>채널 탐색</DialogTitle>
          <DialogDescription className="sr-only">채널 탐색</DialogDescription>
        </DialogHeader>
        <Input
          data-testid="channel-browser-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="채널 이름으로 검색"
          aria-label="채널 검색"
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {isLoading && <div className="px-1 text-sm text-muted-foreground">불러오는 중…</div>}
          {channels?.length === 0 && (
            <div className="px-1 py-4 text-sm text-muted-foreground">공개 채널이 없어요.</div>
          )}
          {channels?.map((c) => (
            <div
              key={c.id}
              data-testid={`channel-browser-row-${c.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
            >
              <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.memberCount}명</span>
              {c.member ? (
                <span className="text-xs text-muted-foreground">참여 중</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`channel-browser-join-${c.id}`}
                  disabled={join.isPending}
                  onClick={() => join.mutate(c.id)}
                >
                  참여
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
