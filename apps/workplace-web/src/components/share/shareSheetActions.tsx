// 모바일 공유 시트 항목(WP-1234) — 화면별 분기 없이 대상 필드 유무로만 정한다. ShareSheetButton 이 쓰고 테스트가 직접 본다.
import { Globe, Hash, Link, MessageSquareShare, Send } from 'lucide-react'

import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { openSendToChat } from '@/lib/sendToChat'
import type { ShareTarget } from '@/lib/shareTarget'

import { canSendToOtherApp, copyShareKey, copyShareLink, sendToOtherApp } from './shareActions'

/** 대상에 맞는 공유 시트 항목 — 화면별 분기 없이 대상 필드 유무로만 정한다. */
export function shareSheetActions(target: ShareTarget): MobileSheetAction[] {
  return [
    { key: 'copy-link', label: '링크 복사', icon: <Link />, onSelect: () => void copyShareLink(target) },
    // 앱 안으로 보내기(WP-1235) — 늘 둘째. 보내기 화면(Radix 대화상자)은 외부 공유 창과 같은 이유로 시트가 닫힌 다음 틱에 열린다(openSendToChat 이 미룬다).
    {
      key: 'send-to-chat',
      label: '채팅·이슈로 보내기',
      description: '앱 안 채널·DM·이슈 댓글',
      icon: <MessageSquareShare />,
      onSelect: () => openSendToChat(target),
    },
    // 시트를 닫은 뒤 같은 클릭 안에서 동기 호출한다(MobileActionSheet 가 닫기 → 실행을 한 틱에 한다) — iOS 는 활성화 밖 호출을 막는다.
    ...(canSendToOtherApp()
      ? [{ key: 'send', label: '다른 앱으로 보내기', icon: <Send />, onSelect: () => sendToOtherApp(target) }]
      : []),
    ...(target.key ? [{ key: 'copy-key', label: '키 복사', icon: <Hash />, onSelect: () => void copyShareKey(target) }] : []),
    // 외부 공유 창(Radix 대화상자)은 시트가 닫힌 다음 틱에 연다 — 같은 틱에 열면 닫히는 시트 오버레이의 초점 복귀·pointer-events 정리와 부딪친다.
    // 「다른 앱으로 보내기」와 달리 사용자 활성화가 필요 없어 미뤄도 된다. 호출부마다 미루지 않게 여기 한 곳에서 한다.
    ...(target.onExternalShare
      ? [{ key: 'external-share', label: '외부 공유 링크…', icon: <Globe />, onSelect: () => void setTimeout(target.onExternalShare!, 0) }]
      : []),
  ]
}
