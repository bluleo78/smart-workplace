// 채널 이름 변경 모달. 현재 이름을 기본값으로. 성공 시 닫힘(상세 무효화로 헤더 갱신).
import { useEffect, useState } from 'react'

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
import { useRenameChannel } from '@/hooks/queries/useChannelMutations'
import { extractApiError } from '@/lib/api-error'

export function RenameChannelModal({
  channelId,
  currentName,
  open,
  onOpenChange,
}: {
  channelId: number
  currentName: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState(currentName)
  // 이름 중복(409) 인라인 에러 — 컨테이너류 이름 하드 차단 정책(#688/#696/#803).
  const [nameError, setNameError] = useState<string | null>(null)
  const rename = useRenameChannel(channelId)

  // 모달 열릴 때 현재 이름으로 초기화 + 이전 에러 초기화.
  useEffect(() => {
    if (open) {
      setName(currentName)
      setNameError(null)
    }
  }, [open, currentName])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setNameError(null)
    try {
      await rename.mutateAsync(trimmed)
      onOpenChange(false)
    } catch (err) {
      setNameError(extractApiError(err, '채널 이름 변경에 실패했습니다.'))
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
      <DialogContent data-testid="rename-channel-modal">
        <DialogHeader>
          <DialogTitle>채널 이름 변경</DialogTitle>
          <DialogDescription className="sr-only">채널 이름 변경</DialogDescription>
        </DialogHeader>
        <Input
          data-testid="rename-channel-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setNameError(null)
          }}
          maxLength={80}
          aria-invalid={!!nameError}
        />
        {nameError && (
          <p className="text-sm text-destructive" data-testid="rename-channel-name-error">
            {nameError}
          </p>
        )}
        <DialogFooter>
          <Button
            data-testid="rename-channel-submit"
            disabled={!name.trim() || rename.isPending}
            onClick={() => void submit()}
          >
            {rename.isPending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
