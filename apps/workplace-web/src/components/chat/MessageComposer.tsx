// 메시지 작성기 — Enter 전송(Shift+Enter 줄바꿈).
import { useState } from 'react'

import { Textarea } from '@/components/ui/textarea'

export function MessageComposer({ onSend }: { onSend: (body: string) => void }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const body = value.trim()
    if (!body) return
    onSend(body)
    setValue('')
  }

  return (
    <div className="border-t p-3">
      <Textarea
        data-testid="message-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="메시지를 입력하세요"
        rows={2}
      />
    </div>
  )
}
