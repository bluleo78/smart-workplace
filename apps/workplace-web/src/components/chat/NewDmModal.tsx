// 새 DM 모달 — 참여자 1~7명(본인 제외) 선택 후 시작. find-or-create → 응답 DM 으로 라우팅.
import { X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { UserResponse } from '@/types/auth'

interface NewDmModalProps {
  open: boolean
  onOpenChange: (next: boolean) => void
}

const MAX_TARGETS = 7 // 본인 포함 8명

export function NewDmModal({ open, onOpenChange }: NewDmModalProps) {
  const navigate = useNavigate()
  const createDm = useCreateDm()
  const [selected, setSelected] = useState<UserResponse[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedIds = new Set(selected.map((u) => u.id))

  // 후보 선택 — 중복·정원 초과면 무시, 아니면 칩으로 누적.
  const handleSelect = (user: UserResponse) => {
    if (selectedIds.has(user.id) || selected.length >= MAX_TARGETS) return
    setSelected((prev) => [...prev, user])
  }

  const remove = (id: number) => setSelected((prev) => prev.filter((u) => u.id !== id))

  const reset = () => {
    setSelected([])
    setPickerOpen(false)
  }

  // find-or-create 후 응답 DM 으로 이동.
  const start = async () => {
    if (selected.length === 0) return
    const dm = await createDm.mutateAsync(selected.map((u) => u.id))
    reset()
    onOpenChange(false)
    navigate(`/chat/dms/${dm.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent data-testid="new-dm-modal">
        <DialogHeader>
          <DialogTitle>새 메시지</DialogTitle>
        </DialogHeader>

        {/* 선택된 참여자 칩 */}
        <div className="flex flex-wrap gap-1" data-testid="new-dm-chips">
          {selected.map((u) => (
            <span
              key={u.id}
              data-testid={`new-dm-chip-${u.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-sm"
            >
              {u.name}
              <button
                type="button"
                aria-label={`${u.name} 제거`}
                onClick={() => remove(u.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <MemberSearchPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingMemberIds={selectedIds}
          onSelect={handleSelect}
          trigger={
            <Button
              type="button"
              variant="outline"
              data-testid="new-dm-add-btn"
              disabled={selected.length >= MAX_TARGETS}
              onClick={() => setPickerOpen(true)}
            >
              참여자 추가
            </Button>
          }
        />
        {selected.length >= MAX_TARGETS && (
          <p className="text-xs text-muted-foreground">최대 {MAX_TARGETS}명까지 선택할 수 있어요.</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            data-testid="new-dm-start-btn"
            disabled={selected.length === 0 || createDm.isPending}
            onClick={() => void start()}
          >
            시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
