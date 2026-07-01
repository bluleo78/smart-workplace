import { useState } from 'react'

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

  // 빈 이름 가드 — 트림 후 비어 있으면 no-op.
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 닫힐 때 입력 초기화(다음 열림에 잔상 방지).
        if (!o) setName('')
        onOpenChange(o)
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
          placeholder="예: 제품팀 위키"
          autoFocus
          data-testid="wiki-space-create-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || pending}
            data-testid="wiki-space-create-confirm"
          >
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
