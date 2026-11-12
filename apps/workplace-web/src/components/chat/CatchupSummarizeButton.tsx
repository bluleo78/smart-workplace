import { AiLabel } from '@/components/ai/AiLabel'
import { Button } from '@/components/ui/button'

// 「놓친 대화 요약」 버튼 — 채널·DM 페이지 공용. 미읽음 1~4건일 때 자동 카드 대신 눌러서 요약을 받는다.
// 디자인 시스템 §7.2 의 AI 실행 버튼 규칙대로 outline 버튼 + AiLabel(AiIcon + 텍스트)로 그린다.
// 예전의 indigo 하드코딩 색과 글자 ✨ 는 AI 표식이 두 겹으로 보이게 해서 제거했다.
export function CatchupSummarizeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" data-testid="catchup-summarize-btn" onClick={onClick}>
      <AiLabel>놓친 대화 요약</AiLabel>
    </Button>
  )
}
