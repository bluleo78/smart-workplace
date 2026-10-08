// 모바일 하단 액션 바(⬇ 저장 · ⤴ 공유 · ☁ 드라이브 · ✨ 요약)와 저장·공유 방식 판정 순수 로직(WP-278, 스펙 §4.2·§5.4·§8.1).
// 칸 위치는 4칸 고정 — 없는 기능은 빈칸으로 두어 넘겨도 다른 버튼이 움직이지 않게 한다(판정 R12).

export type SlotId = 'save' | 'share' | 'drive' | 'summary'
export type SlotState = 'enabled' | 'disabled' | 'empty'
export interface ActionSlot {
  id: SlotId
  state: SlotState
}
/**
 * 공유 상태 — ready(누르면 공유)·loading(blob 받는 중)·unavailable(파일 공유는 되는 브라우저지만 이 항목은 불가)·
 * none(브라우저가 파일 공유 자체를 못 함 — 칸을 비운다, 스펙 §4.2 "없는 기능은 칸을 비움").
 */
export type ShareState = 'ready' | 'loading' | 'unavailable' | 'none'

/**
 * ⤴ 공유 상태. Web Share 는 사용자 제스처 직후에만 호출할 수 있어(await 뒤 호출 시 NotAllowedError)
 * blob 이 이미 메모리에 있을 때만 활성화한다(스펙 §5.4).
 * fetches = 이 항목이 지금 미리보기 blob 을 받는(받을) 상태인가 — 미지원 형식·10MB 동의 대기·오류면 거짓이라 "받는 중"이 끝나지 않는 일이 없다.
 */
export function resolveShareState(i: { supported: boolean; fetches: boolean; blobReady: boolean; canShareFile: boolean }): ShareState {
  // supported = 플랫폼이 파일 공유를 지원하는가(시험 파일로 판정) — 아니면 영영 누를 수 없는 버튼 대신 빈칸.
  if (!i.supported) return 'none'
  if (i.blobReady) return i.canShareFile ? 'ready' : 'unavailable'
  return i.fetches ? 'loading' : 'unavailable'
}

/** 하단 4칸 상태 — 순서 save·share·drive·summary 고정. */
export function actionSlots(i: {
  unavailable: boolean
  share: ShareState
  importable: 'none' | 'ready' | 'disabled'
  summary: boolean
}): ActionSlot[] {
  return [
    { id: 'save', state: i.unavailable ? 'empty' : 'enabled' },
    { id: 'share', state: i.unavailable || i.share === 'none' ? 'empty' : i.share === 'ready' ? 'enabled' : 'disabled' },
    { id: 'drive', state: i.importable === 'none' ? 'empty' : i.importable === 'ready' ? 'enabled' : 'disabled' },
    { id: 'summary', state: i.summary ? 'enabled' : 'empty' },
  ]
}

/**
 * ⬇ 저장 방식. iOS 홈 화면 앱(standalone)은 a[download] 가 불안정해 공유 시트("파일에 저장")로 대체한다(스펙 §5.4).
 * 공유 시트도 blob 이 메모리에 있어야 제스처 직후 호출할 수 있으므로, 없으면 기존 다운로드로 둔다.
 * shareable = 메모리 blob 으로 만든 File 이 있고 canShare 가 받아 준다(둘 중 하나라도 아니면 거짓).
 */
export function resolveSaveMethod(i: { iosStandalone: boolean; shareable: boolean }): 'share' | 'download' {
  return i.iosStandalone && i.shareable ? 'share' : 'download'
}
