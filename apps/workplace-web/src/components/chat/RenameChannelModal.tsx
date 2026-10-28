// 채널 이름 변경 모달. 현재 이름을 기본값으로. 성공 시 닫힘(상세 무효화로 헤더 갱신).
// mode='unarchive' 면 같은 이름의 공개 채널 때문에 거절된 보관 해제를 새 이름으로 다시 한다(WP-1084) — 이름 바꾸기와 해제를 한 요청으로.
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
import { useRenameChannel, useUnarchiveChannel } from '@/hooks/queries/useChannelMutations'
import { extractApiError } from '@/lib/api-error'

export function RenameChannelModal({
  channelId,
  currentName,
  mode = 'rename',
  open,
  onOpenChange,
}: {
  channelId: number
  /** DM 상세는 name 이 null 이다 — 채널 화면으로 잘못 들어와도 렌더 중 깨지지 않게 빈 이름으로 다룬다(WP-1083). */
  currentName: string | null
  /** rename = 이름 변경, unarchive = 새 이름으로 보관 해제(WP-1084). */
  mode?: 'rename' | 'unarchive'
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState(currentName ?? '')
  // 이름 중복(409) 인라인 에러 — 컨테이너류 이름 하드 차단 정책(#688/#696/#803).
  const [nameError, setNameError] = useState<string | null>(null)
  const rename = useRenameChannel(channelId)
  const unarchive = useUnarchiveChannel(channelId)
  const isUnarchive = mode === 'unarchive'
  const pending = isUnarchive ? unarchive.isPending : rename.isPending
  // 보관 해제는 지금 이름이 겹쳐 거절된 것이라 같은 이름(서버처럼 NFC·대소문자 무시)으로는 다시 보내지 않는다.
  const sameName = (a: string) => a.trim().normalize('NFC').toLowerCase()
  const unchanged = isUnarchive && sameName(name) === sameName(currentName ?? '')

  // 모달 열릴 때 현재 이름으로 초기화 + 이전 에러 초기화.
  useEffect(() => {
    if (open) {
      setName(currentName ?? '')
      setNameError(null)
    }
  }, [open, currentName])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setNameError(null)
    try {
      if (isUnarchive) await unarchive.mutateAsync(trimmed)
      else await rename.mutateAsync(trimmed)
      onOpenChange(false)
    } catch (err) {
      setNameError(extractApiError(err, isUnarchive ? '채널 보관 해제에 실패했습니다.' : '채널 이름 변경에 실패했습니다.'))
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
          <DialogTitle>{isUnarchive ? '새 이름으로 보관 해제' : '채널 이름 변경'}</DialogTitle>
          {isUnarchive ? (
            <DialogDescription data-testid="rename-channel-unarchive-hint">
              같은 이름의 채널이 있어 「{currentName}」 이름으로는 보관을 해제할 수 없어요. 새 이름을 정하면 그 이름으로 바꾸며 해제해요.
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">채널 이름 변경</DialogDescription>
          )}
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
            disabled={!name.trim() || unchanged || pending}
            onClick={() => void submit()}
          >
            {isUnarchive ? (pending ? '해제 중…' : '보관 해제') : pending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
