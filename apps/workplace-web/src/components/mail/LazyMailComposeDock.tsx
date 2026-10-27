// 메일 작성 도크를 처음 작성을 열 때 불러온다(WP-970).
// 도크는 작성 중인 메일이 없으면 아무것도 그리지 않는데도, 정적 import 라 리치텍스트 편집기(tiptap·ProseMirror)가
// 메인 번들에 실려 모든 화면의 첫 부팅이 이를 내려받고 해석했다. 여기서는 처음 작성이 열릴 때 모듈을 불러온다.
// 한 번 그린 뒤에는 계속 마운트해 둔다 — 도크 본체는 닫혀도 언마운트되지 않는 것(null 렌더)을 전제로
// 닫을 때의 임시저장·첨부 정리를 하므로, 처음 연 뒤의 동작은 예전과 같다.
import { lazy, Suspense, useState } from 'react'

import { useMailCompose } from '@/components/mail/MailComposeContext'

const MailComposeDock = lazy(() => import('@/components/mail/MailComposeDock').then((m) => ({ default: m.MailComposeDock })))

export function LazyMailComposeDock() {
  const { draft } = useMailCompose()
  // 처음 작성이 열린 렌더에서 켜고 다시 끄지 않는다(렌더 중 상태 조정 — 같은 렌더에서 바로 반영된다).
  const [opened, setOpened] = useState(false)
  if (draft && !opened) setOpened(true)
  if (!opened && !draft) return null
  return (
    <Suspense fallback={null}>
      <MailComposeDock />
    </Suspense>
  )
}
