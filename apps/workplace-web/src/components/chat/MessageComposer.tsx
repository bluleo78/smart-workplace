// 메시지 작성기 — Enter 전송(Shift+Enter 줄바꿈). 아카이브 채널이면 비활성 + 안내.
import { useState } from 'react'

import { Textarea } from '@/components/ui/textarea'

export function MessageComposer({
  onSend,
  disabled = false,
}: {
  onSend: (body: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')

  const submit = () => {
    const body = value.trim()
    if (!body) return
    onSend(body)
    setValue('')
  }

  return (
    <div className="border-t p-3">
      {disabled && (
        <p className="mb-2 text-sm text-muted-foreground">이 채널은 보관되었습니다</p>
      )}
      <Textarea
        data-testid="message-composer-input"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={disabled ? '보관된 채널입니다' : '메시지를 입력하세요'}
        rows={2}
      />
    </div>
  )
}
