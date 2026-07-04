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
import { Input } from '@/components/ui/input'

interface WikiCreateSpaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // 이름 확정 시 호출 — 실제 생성/이동은 부모가 담당(트림된 이름 전달).
  onCreate: (name: string) => void
  // 생성 진행 중 — 중복 제출 방지.
  pending?: boolean
}

/**
 * 새 노트(위키) 팀 스페이스 생성 다이얼로그.
 * 백엔드는 이름만 받으므로 단일 이름 필드. 멤버는 생성 후 "멤버" 버튼으로 초대한다.
 */
export function WikiCreateSpaceDialog({ open, onOpenChange, onCreate, pending }: WikiCreateSpaceDialogProps) {
  const [name, setName] = useState('')
  // 동기적 in-flight 가드 — ref 는 즉시(리렌더 없이) 반영되므로 같은 이벤트 루프 틱
  // 내에 버튼이 두 번 클릭돼도(pending prop 이 아직 갱신되기 전) 두 번째 클릭을 차단한다.
  // 실제 중복 제출 방지는 이 ref 만으로 충분 — state(submitting)는 버튼의 시각적
  // disabled 표시(재시도 가능 시점 안내)를 위한 보조 용도.
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  // 부모의 mutation 이 끝나면(성공 또는 실패) 가드를 해제 — 실패 시 다이얼로그가
  // 유지되므로 재시도가 가능해야 한다. pending 은 부모 소유 상태이므로 여기선 그
  // "변화를 동기화"할 뿐 새로운 파생 값을 계산하지 않는다.
  useEffect(() => {
    if (!pending) {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [pending])

  // 빈 이름 가드 + 동기적 중복 제출 가드 — 트림 후 비어 있거나 이미 제출 중이면 no-op.
  const submit = () => {
    if (submittingRef.current) return
    const trimmed = name.trim()
    if (!trimmed) return
    submittingRef.current = true
    setSubmitting(true)
    onCreate(trimmed)
  }

  // 닫힐 때 입력 초기화(다음 열림에 잔상 방지) — Dialog의 onOpenChange와
  // "취소" 버튼 모두 이 헬퍼를 거치도록 통일해 리셋 누락을 방지한다.
  const close = () => {
    setName('')
    submittingRef.current = false
    setSubmitting(false)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close()
        else onOpenChange(o)
      }}
    >
      <DialogContent data-testid="wiki-space-create-dialog">
        <DialogHeader>
          <DialogTitle>새 노트 스페이스</DialogTitle>
          <DialogDescription>
            팀과 공유할 노트 스페이스를 만듭니다. 멤버는 생성 후 초대할 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="예: 제품팀 노트"
          autoFocus
          data-testid="wiki-space-create-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || pending || submitting}
            data-testid="wiki-space-create-confirm"
          >
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
