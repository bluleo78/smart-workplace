// 채널 생성 모달 — 이름 입력 + 공개/비공개 토글. 성공 시 새 채널로 라우팅.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateChannel } from '@/hooks/queries/useChannelMutations'
import { extractApiError } from '@/lib/api-error'
import type { ChannelVisibility } from '@/types/messaging'

export function CreateChannelModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  // 이름 중복(409) 인라인 에러 — 컨테이너류 이름 하드 차단 정책(#688/#696/#803).
  const [nameError, setNameError] = useState<string | null>(null)
  const create = useCreateChannel()
  const navigate = useNavigate()

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setNameError(null)
    const visibility: ChannelVisibility = isPrivate ? 'PRIVATE' : 'PUBLIC'
    try {
      const channel = await create.mutateAsync({ name: trimmed, visibility })
      onOpenChange(false)
      setName('')
      setIsPrivate(false)
      navigate(`/chat/channels/${channel.id}`)
    } catch (err) {
      setNameError(extractApiError(err, '채널 생성에 실패했습니다.'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setNameError(null)
        onOpenChange(v)
      }}
    >
      <DialogContent data-testid="create-channel-modal">
        <DialogHeader>
          <DialogTitle>채널 만들기</DialogTitle>
          <DialogDescription className="sr-only">채널 만들기</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="create-channel-name">이름</Label>
            <Input
              id="create-channel-name"
              data-testid="create-channel-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              placeholder="예: 마케팅"
              maxLength={80}
              aria-invalid={!!nameError}
            />
            {nameError && (
              <p className="text-sm text-destructive" data-testid="create-channel-name-error">
                {nameError}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="create-channel-visibility-private">비공개 채널</Label>
            <Switch
              id="create-channel-visibility-private"
              data-testid="create-channel-visibility-private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            비공개 채널은 탐색에 노출되지 않고 초대로만 참여할 수 있어요.
          </p>
        </div>
        <DialogFooter>
          <Button
            data-testid="create-channel-submit"
            disabled={!name.trim() || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? '생성 중…' : '만들기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
