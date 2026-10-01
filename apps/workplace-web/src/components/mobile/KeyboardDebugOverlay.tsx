// [임시 진단용 — WP-154] iOS 실기기에서 키보드가 열릴 때의 뷰포트 값을 화면에 띄운다.
// Playwright 는 실제 iOS 키보드를 재현하지 못해, 홈 화면 앱(standalone)에서 innerHeight·visualViewport·스크롤이
// 어떻게 바뀌는지 직접 봐야 원인(키보드 감지 실패 vs 보이는 영역 밀림)을 가를 수 있다. 원인 확정 후 삭제한다.
// 켜기: 앱 안에서 ?kbdebug=1 링크를 연다(홈 화면 앱은 주소창이 없고 Safari 와 저장소가 분리돼 있어 앱 저장소에 기억시킨다). 끄기: ?kbdebug=0.
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'kbdebug'

/** URL 의 kbdebug 파라미터를 저장소에 반영하고, 현재 켜져 있는지 돌려준다. 저장소 접근 실패(사파리 개인 모드 등)는 꺼짐으로 본다. */
function readFlag(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get(STORAGE_KEY)
    if (param === '0') localStorage.removeItem(STORAGE_KEY)
    else if (param !== null) localStorage.setItem(STORAGE_KEY, '1')
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 지금 포커스된 요소를 짧게 — 키보드 판정의 '편집 요소 포커스' 조건을 눈으로 확인한다. */
function describeFocus(): string {
  const el = document.activeElement
  if (!el || el === document.body) return 'none'
  if (el instanceof HTMLElement && el.isContentEditable) return 'editable'
  return el instanceof HTMLInputElement ? `input:${el.type}` : el.tagName.toLowerCase()
}

/** 한 시점의 뷰포트 측정값을 한 줄씩 만든다. */
function snapshot(): string[] {
  const vv = window.visualViewport
  const root = document.documentElement
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return [
    `innerH ${window.innerHeight} · clientH ${root.clientHeight} · screenH ${window.screen.height}`,
    vv ? `vvH ${Math.round(vv.height)} · offTop ${Math.round(vv.offsetTop)} · scale ${vv.scale.toFixed(2)}` : 'visualViewport 없음',
    `scrollY ${Math.round(window.scrollY)} · bodyScroll ${Math.round(document.body.scrollTop)}`,
    `focus ${describeFocus()} · kb=${root.hasAttribute('data-keyboard-open')} · --vvh ${root.style.getPropertyValue('--vvh') || '-'}`,
    `standalone ${standalone}`,
  ]
}

/** 진단 오버레이 — 플래그가 켜졌을 때만 화면 위쪽에 측정값을 실시간으로 띄운다(터치는 통과). */
export function KeyboardDebugOverlay() {
  const [enabled] = useState(readFlag)
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!enabled) return
    // 이벤트마다 즉시 + 다음 프레임에 한 번 더 — useVisualViewport 가 같은 이벤트에서 :root 를 갱신한 뒤의 값도 담는다.
    const update = () => {
      setLines(snapshot())
      requestAnimationFrame(() => setLines(snapshot()))
    }
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    // iOS 는 키보드 애니메이션 중 이벤트가 빠질 수 있어 주기적으로도 갱신한다(진단용이라 비용 무시).
    const timer = window.setInterval(update, 500)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
      window.clearInterval(timer)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <pre
      data-testid="kb-debug-overlay"
      aria-hidden
      className="pointer-events-none fixed left-1 top-[calc(env(safe-area-inset-top)+4px)] z-[9999] whitespace-pre rounded bg-black/75 px-2 py-1 font-mono text-[10px] leading-tight text-white"
    >
      {lines.join('\n')}
    </pre>
  )
}
