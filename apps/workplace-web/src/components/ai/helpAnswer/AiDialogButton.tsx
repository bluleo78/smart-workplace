// AI 답의 「창 열기」 단추(WP-1511) — 화면이 미리 정한 허용 목록(aiDialogTargets) 안의 대화상자만 연다.
// 단추 글은 AI 가 쓴 링크 글이 아니라 목록의 라벨(`<라벨> 창 열기`)이다 — AI 가 단추 문구로 사용자를 속이지 못하게.
// 누른 결과가 missing(지금 화면에 그 창이 없음)이면 단추 아래에 이유를 보인다.
import { useContext, useState } from 'react'

import { Button } from '@/components/ui/button'
import { aiDialogButtonText,type AiDialogTargetId } from '@/lib/aiDialogTargets'

import { HelpAnswerContext } from './helpAnswerContext'

/** 창 열기 단추 + 열 수 없을 때의 안내. 글줄 안(p) 에 들어가도 유효하도록 span 으로만 감싼다. */
export function AiDialogButton({ id }: { id: AiDialogTargetId }) {
  const actions = useContext(HelpAnswerContext)?.actions
  const [missing, setMissing] = useState(false)
  if (!actions) return null
  return (
    <span className="block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setMissing(actions.openDialog(id) === 'missing')}
      >
        {aiDialogButtonText(id)}
      </Button>
      {missing && (
        <span role="status" className="mt-1 block text-xs text-muted-foreground">
          이 화면에서는 열 수 없어요
        </span>
      )}
    </span>
  )
}
