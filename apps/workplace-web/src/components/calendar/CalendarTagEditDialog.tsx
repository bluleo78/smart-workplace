// 태그 만들기/이름·색 바꾸기 다이얼로그 (WP-714, 시안 ③ 사이드바 「＋」·⋮ 「이름·색 바꾸기」).
// 캘린더 편집 다이얼로그(CalendarEditDialog)와 같은 이름 + 팔레트 스와치 구성이다.
// 만들 때 색을 따로 고르지 않으면 이름에서 정한 색(pickTagColor)을 따라가 — 피커의 인라인 만들기와 같은 색이 나온다.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PALETTE_KEYS, resolvePalette } from '@/lib/calendarPalette'
import { pickTagColor } from '@/lib/calendarTag'
import type { CalendarTag, CalendarTagRequest } from '@/types/calendar'

interface CalendarTagEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 새 태그 만들기, 값 = 이름·색 바꾸기 */
  tag: CalendarTag | null
  onSubmit: (body: CalendarTagRequest) => void
  isPending?: boolean
}

/** 태그 이름 입력 + 팔레트 스와치. */
export function CalendarTagEditDialog({ open, onOpenChange, tag, onSubmit, isPending }: CalendarTagEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="calendar-tag-edit-dialog">
        {/* 내용은 열 때마다 새로 마운트돼(닫히면 DialogContent 가 내려간다) 입력값이 수정 대상·빈 값으로 초기화된다 — effect 로 맞추지 않는다 */}
        <TagEditForm tag={tag} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} isPending={isPending} />
      </DialogContent>
    </Dialog>
  )
}

/** 다이얼로그 본문 — 이름·색 상태는 마운트 때 수정 대상에서 시작한다. */
function TagEditForm({
  tag,
  onCancel,
  onSubmit,
  isPending,
}: {
  tag: CalendarTag | null
  onCancel: () => void
  onSubmit: (body: CalendarTagRequest) => void
  isPending?: boolean
}) {
  const [name, setName] = useState(tag?.name ?? '')
  // 사용자가 스와치를 직접 골랐는지 — 만들기 모드에서 안 골랐으면 이름에서 정한 색을 따라간다
  const [pickedColor, setPickedColor] = useState<string | null>(tag?.color ?? null)

  const trimmed = name.trim()
  const color = pickedColor ?? (trimmed ? pickTagColor(trimmed) : 'blue')
  const isEditing = tag != null
  // Outlook 범주에서 온 태그는 이름을 못 바꾼다 — 동기화가 범주 이름으로 태그를 찾아, 앱에서 바꾸면 다음 동기화에 태그가 둘로 갈라진다.
  // 이름 칸은 잠그고 원래 이름을 그대로 보내 색만 바꾼다(서버는 같은 이름이면 이름 검사를 건너뛴다).
  const nameLocked = tag?.fromOutlook ?? false

  const submit = () => {
    if (!trimmed || isPending) return
    // 잠긴 이름은 손대지 않은 원래 값(앞뒤 공백 포함)을 그대로 — 서버가 「이름 그대로」로 보고 색만 바꾼다
    onSubmit({ name: nameLocked && tag ? tag.name : trimmed, color })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? '태그 이름·색 바꾸기' : '새 태그'}</DialogTitle>
        <DialogDescription className="sr-only">태그 이름과 색을 정합니다.</DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="calendar-tag-edit-name">이름</Label>
          <Input
            id="calendar-tag-edit-name"
            data-testid="calendar-tag-edit-name"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            placeholder="태그 이름"
            disabled={nameLocked}
            aria-describedby={nameLocked ? 'calendar-tag-edit-name-hint' : undefined}
            autoFocus={!nameLocked}
          />
          {nameLocked && (
            <p
              id="calendar-tag-edit-name-hint"
              data-testid="calendar-tag-edit-name-hint"
              className="text-xs text-muted-foreground"
            >
              Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>색상</Label>
          <div className="flex flex-wrap gap-2">
            {PALETTE_KEYS.map((k) => {
              const entry = resolvePalette(k)
              return (
                <button
                  key={k}
                  type="button"
                  data-testid={`calendar-tag-color-${k}`}
                  aria-label={entry.label}
                  aria-pressed={color === k}
                  onClick={() => setPickedColor(k)}
                  className={`size-7 rounded-full ${entry.dotClass} ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${color === k ? 'ring-2 ring-ring ring-offset-2' : ''}`}
                />
              )
            })}
          </div>
        </div>
        {/* Enter 제출용 — 보이지 않는 submit. 실제 버튼은 푸터에 있다 */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>

      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={onCancel}>
          취소
        </Button>
        <Button data-testid="calendar-tag-edit-submit" onClick={submit} disabled={isPending || !trimmed}>
          {isEditing ? '저장' : '만들기'}
        </Button>
      </DialogFooter>
    </>
  )
}
