// src/lib/unsavedInput.ts
// 저장 안 한 입력이 있는지 묻는 곳을 한데 모은다(WP-664). 다른 창이 새 버전을 적용했을 때 이 창을 자동 새로고침해도 되는지 판단한다.
// 백그라운드 탭은 사용자 활성화가 없으면 beforeunload 확인창이 생략되므로, 확인창에만 맡기면 입력이 날아갈 수 있다.
// 입력 화면(useUnsavedChangesWarning)·노트 동기화(collabSession)처럼 판단 기준이 제각각이라 각자 확인 함수를 등록한다 —
// 노트 동기화는 노트 화면과 함께 지연 로드되므로, 앱 루트가 직접 import 하지 않고 등록을 받는다.

const sources = new Set<() => boolean>()

/** 저장 안 한 입력 확인 함수를 등록하고 해제 함수를 돌려준다. */
export function registerUnsavedInputSource(check: () => boolean): () => void {
  sources.add(check)
  return () => {
    sources.delete(check)
  }
}

/** 지금 이 창에 저장 안 한 입력이 있는지 */
export function hasUnsavedInput(): boolean {
  for (const check of sources) if (check()) return true
  return false
}
