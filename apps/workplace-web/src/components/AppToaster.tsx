import { Toaster } from '@/components/ui/sonner'

/**
 * 앱 전용 토스트 영역 — 공용 shadcn 래퍼(ui/sonner, CLI 생성물이라 손대지 않음) 위에 이 앱의 위치·여백·접근성 이름을 얹는다.
 *
 * - 위치: top-right — 메일 컴포즈 도크 등 화면 하단에 고정되는 UI와 겹쳐 액션 버튼을 가리는 것을 방지 (#692)
 * - bottom 오프셋은 모바일 복귀 토스트(wikiAwayToast — 06 §D 예외)만 쓴다: 홈 인디케이터(safe-area)나 열린 키보드(--kb-inset,
 *   useVisualViewport) 중 큰 쪽 위로 띄운다. 기본값 16px(≤600px)·24px(그 위)에 더한다. top·좌우는 sonner 기본값 그대로.
 * - 접근성 이름: 토스트 컨테이너 section 이 스크린리더 랜드마크 목록에 sonner 기본값 영어 「Notifications」로 보이던 것을
 *   한국어 「알림 토스트」로 바꾼다(WP-1428). 인박스 「알림」과 구분되도록 「토스트」를 붙였다.
 *   sonner 는 이 이름 뒤에 단축키 표기(기본 「alt+T」 — 누르면 토스트 영역으로 포커스가 간다)를 늘 덧붙인다.
 *   props 로 뺄 방법이 없고 실제로 동작하는 단축키라 안내로도 쓸모가 있어 그대로 둔다.
 */
export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      mobileOffset={{ bottom: 'calc(16px + max(env(safe-area-inset-bottom, 0px), var(--kb-inset, 0px)))' }}
      offset={{ bottom: 'calc(24px + max(env(safe-area-inset-bottom, 0px), var(--kb-inset, 0px)))' }}
      containerAriaLabel="알림 토스트"
    />
  )
}
