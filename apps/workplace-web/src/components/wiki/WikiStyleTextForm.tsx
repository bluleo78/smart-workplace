import { type KeyboardEvent, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/** 적용 결과 — 정리기를 거친 뒤 칸에 다시 보여 줄 글자와, 뺀 것이 있으면 그 안내. */
export interface StyleTextApplyResult {
  text: string
  note: string | null
}

/**
 * CSS 직접 고치기 칸(WP-1304) — 상자 꾸미기 창의 「CSS 로 직접 고치기」와 페이지 스타일 고치기 창이 같은 모양으로 쓴다.
 * - 「적용」: onApply 가 정리기를 거쳐 저장하고 결과를 돌려준다. 정리기가 뺀 것이 없으면 onDone 으로 닫고,
 *   뺀 것이 있으면 칸을 정리된 글자로 바꾸고 안내(「쓸 수 없는 값 n개를 뺐습니다」)를 띄운 채 남는다 — 무엇이 빠졌는지 보게.
 * - 「취소」·Esc: 바꾸지 않고 onCancel. ⌘/Ctrl+Enter 는 적용.
 * - 적용이 실패하면(상자가 사라짐 등) onApply 가 null 을 돌려주고 칸은 그대로다.
 */
export function WikiStyleTextForm({
  initial,
  label,
  testId,
  rows = 6,
  onApply,
  onCancel,
  onDone,
}: {
  initial: string
  label: string
  testId: string
  rows?: number
  onApply: (text: string) => StyleTextApplyResult | null
  onCancel: () => void
  onDone: () => void
}) {
  const [text, setText] = useState(initial)
  const [note, setNote] = useState<string | null>(null)
  const id = useId()

  const apply = () => {
    const result = onApply(text)
    if (!result) return
    if (!result.note) {
      onDone()
      return
    }
    setText(result.text)
    setNote(result.note)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // 바깥(편집기·대화상자)의 Esc 처리로 번지지 않게 여기서 끝낸다 — 칸만 닫는다.
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      apply()
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Textarea
        id={id}
        autoFocus
        rows={rows}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setNote(null)
        }}
        onKeyDown={onKeyDown}
        className="min-h-0 font-mono text-xs"
        data-testid={`${testId}-input`}
      />
      {note && (
        <p role="status" className="text-xs text-muted-foreground" data-testid={`${testId}-note`}>
          {note}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid={`${testId}-cancel`}>
          취소
        </Button>
        <Button type="button" size="sm" onClick={apply} data-testid={`${testId}-apply`}>
          적용
        </Button>
      </div>
    </div>
  )
}
