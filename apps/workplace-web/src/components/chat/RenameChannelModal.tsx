// 채널 이름 변경 모달. 현재 이름을 기본값으로. 성공 시 닫힘(상세 무효화로 헤더 갱신).
// mode='unarchive' 면 같은 이름의 공개 채널 때문에 거절된 보관 해제를 새 이름으로 다시 한다(WP-1084) — 이름 바꾸기와 해제를 한 요청으로.
import { useEffect, useRef, useState } from 'react'

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
import { useRenameChannel, useUnarchiveChannel } from '@/hooks/queries/useChannelMutations'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
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
  // 지금 이름 그대로면 보내지 않는다(두 모드 공통, WP-1615).
  // - 보관 해제: 지금 이름이 겹쳐 거절된 것이라 서버처럼 NFC·대소문자를 무시하고 같으면 막는다.
  // - 이름 변경: 열자마자 Enter 로 아무것도 안 바뀐 PATCH(이름 변경 이벤트 발행)가 가지 않게 막되,
  //   대소문자만 바꾸는 변경(general → General)은 서버가 받아 주므로 대소문자는 구분해 비교한다.
  const sameName = (a: string) => {
    const n = a.trim().normalize('NFC')
    return isUnarchive ? n.toLowerCase() : n
  }
  const unchanged = sameName(name) === sameName(currentName ?? '')
  // 「저장」 단추의 활성 조건과 Enter 저장의 허용 조건을 한 곳에 둔다 — Enter 가 빈 이름·같은 이름·처리 중 막기를 우회하지 않게(WP-1615).
  const canSubmit = !!name.trim() && !unchanged && !pending
  // 요청 진행 중 표시 — pending 은 다음 렌더에야 바뀌므로, 같은 틱에 두 번 제출(Enter 자동 반복·Enter 뒤 클릭)되면
  // 둘 다 canSubmit 을 통과한다. ref 는 즉시 바뀌어 두 번째 제출을 막는다.
  const inFlight = useRef(false)
  // 한 줄 입력칸 Enter 공용 처리(WP-331) — 한글 조합 Enter(Safari keyCode 229 포함)와 macOS Chrome 꼬리 Enter 는 저장으로 보지 않는다.
  const enterKey = useSingleLineEnter()

  // 모달 열릴 때 현재 이름으로 초기화 + 이전 에러 초기화.
  useEffect(() => {
    if (open) {
      setName(currentName ?? '')
      setNameError(null)
    }
  }, [open, currentName])

  const submit = async () => {
    // Enter 로 저장할 때도 단추와 같은 조건을 지킨다 — 처리 중 Enter 연타·Enter 뒤 클릭으로 요청이 두 번 가지 않게 맨 앞에서 막는다.
    if (!canSubmit || inFlight.current) return
    inFlight.current = true
    const trimmed = name.trim()
    setNameError(null)
    try {
      if (isUnarchive) await unarchive.mutateAsync(trimmed)
      else await rename.mutateAsync(trimmed)
      onOpenChange(false)
    } catch (err) {
      setNameError(extractApiError(err, isUnarchive ? '채널 보관 해제에 실패했습니다.' : '채널 이름 변경에 실패했습니다.'))
    } finally {
      inFlight.current = false
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
        {/* 채널 만들기 창과 같은 「보이는 라벨 + 입력칸」 배치로, 이슈가 정한 문구 「채널 이름」 을 입력칸에 이어
            접근성 트리에서 이름 있는 입력칸이 되게 한다(두 모드 공통, WP-1615). */}
        <div className="space-y-1.5">
          <Label htmlFor="rename-channel-name">채널 이름</Label>
          <Input
            id="rename-channel-name"
            data-testid="rename-channel-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            // Enter 로도 저장한다(WP-1615) — 한글 조합을 확정하는 Enter 는 저장으로 이어지지 않게 공용 훅이 거른다.
            onCompositionEnd={enterKey.onCompositionEnd}
            onKeyDown={(e) => enterKey.handleEnter(e, () => void submit())}
            maxLength={80}
            aria-invalid={!!nameError}
            // 오류 문구가 있을 때만 잇는다 — 없는 id 를 가리키지 않게.
            aria-describedby={nameError ? 'rename-channel-name-error' : undefined}
          />
          <FormError id="rename-channel-name-error" data-testid="rename-channel-name-error">
            {nameError}
          </FormError>
        </div>
        <DialogFooter>
          <Button data-testid="rename-channel-submit" disabled={!canSubmit} onClick={() => void submit()}>
            {isUnarchive ? (pending ? '해제 중…' : '보관 해제') : pending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
