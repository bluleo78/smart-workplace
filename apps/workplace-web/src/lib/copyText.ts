// 텍스트 복사 — 비동기 Clipboard API 를 먼저 쓰고, 없거나 거부되면 숨긴 textarea + execCommand('copy') 로 한 번 더 시도한다.
// 왜 대체 경로가 필요한가: navigator.clipboard 는 보안 컨텍스트(HTTPS·localhost)에서만 존재하고, 권한·포커스 문제로 거부되기도 한다.
// 사내망 http 배포나 일부 WebView 에서 아무 반응 없이 끝나지 않게, 성공 여부를 돌려줘 호출처가 실패를 안내하게 한다.

/** text 를 클립보드에 복사한다. 두 경로가 모두 실패하면 false. 예외는 던지지 않는다. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 거부(권한·포커스 없음) — 아래 대체 경로로 넘어간다.
  }
  return legacyCopy(text)
}

/** execCommand('copy') 대체 경로. 실패·미지원이면 false. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // 열린 대화상자(작업 시트) 안에 붙인다 — Radix 포커스 트랩은 바깥으로 간 포커스를 되돌려 선택·복사를 무산시킨다.
  const host = prevFocus?.closest('[role="dialog"]') ?? document.body
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '') // iOS 에서 가상 키보드가 뜨지 않게.
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  host.appendChild(ta)
  try {
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS Safari 는 select() 만으로 범위가 잡히지 않는다.
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
    prevFocus?.focus({ preventScroll: true })
  }
}
