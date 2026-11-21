// 채널 생성 모달 — 이름 입력 + 공개/비공개 토글. 성공 시 새 채널로 라우팅.
import { useRef, useState } from 'react'
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
import { FormError } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateChannel } from '@/hooks/queries/useChannelMutations'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
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
  // 이름 칸 Enter 로 만들기(WP-1614) — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 만들기로 보지 않는다(WP-331 공용 훅).
  const enterKey = useSingleLineEnter()
  // 요청이 나가 있는 동안 true — create.isPending 은 다시 그려진 뒤에야 바뀌어, 같은 틱에 들어온 Enter 두 번을 막지 못한다.
  const inFlightRef = useRef(false)
  // 「만들기」 단추 활성과 Enter 제출이 같은 조건을 쓰도록 한 곳에서 정한다.
  const canSubmit = name.trim() !== '' && !create.isPending

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || inFlightRef.current) return
    inFlightRef.current = true
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
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // 닫으면 입력을 비운다 — 다시 열었을 때 남은 이름이 Enter 한 번에 만들어지지 않게(대화상자 공통 규칙 #178).
        if (!v) {
          setNameError(null)
          setName('')
          setIsPrivate(false)
        }
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
              onCompositionEnd={enterKey.onCompositionEnd}
              onKeyDown={(e) => enterKey.handleEnter(e, () => void submit())}
              placeholder="예: 마케팅"
              maxLength={80}
              aria-invalid={!!nameError}
            />
            <FormError data-testid="create-channel-name-error">{nameError}</FormError>
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
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {create.isPending ? '생성 중…' : '만들기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
