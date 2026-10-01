// [임시 진단·실기기 검증용 — WP-154] URL 파라미터로 켜고 끄는 기기별 플래그.
// 홈 화면 앱은 주소창이 없고 Safari 와 저장소가 분리돼 있어, 앱 안에서 ?<key>=1 링크를 열면 앱 저장소에 기억시킨다(?<key>=0 으로 끔).

/** URL 의 플래그 파라미터를 저장소에 반영하고 현재 켜져 있는지 돌려준다. 저장소 접근 실패(개인 모드 등)는 꺼짐. */
export function readUrlFlag(key: string): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get(key)
    if (param === '0') localStorage.removeItem(key)
    else if (param !== null) localStorage.setItem(key, '1')
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
