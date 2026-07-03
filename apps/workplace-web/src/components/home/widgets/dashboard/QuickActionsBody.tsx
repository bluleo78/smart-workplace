// 대시보드 그리드 위젯 어댑터 — QuickActions(새 이슈·메일 작성·새 대화 버튼 행)를 registry Component
// 시그니처에 맞춰 감싼다. count/previewData 무시(이 위젯은 순수 버튼 행이라 데이터가 없음).
import { QuickActions } from '../../QuickActions'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function QuickActionsBody(_props: { count?: number; previewData?: unknown }) {
  return <QuickActions />
}
