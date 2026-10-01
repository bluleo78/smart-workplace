// [임시 진단용 — WP-154] iOS 실기기에서 키보드가 열릴 때의 뷰포트 값을 화면에 띄운다.
// Playwright 는 실제 iOS 키보드를 재현하지 못해, 홈 화면 앱(standalone)에서 innerHeight·visualViewport·스크롤이
// 어떻게 바뀌는지 직접 봐야 원인(키보드 감지 실패 vs 보이는 영역 밀림)을 가를 수 있다. 원인 확정 후 삭제한다.
// 켜기: 앱 안에서 ?kbdebug=1 링크를 연다(홈 화면 앱은 주소창이 없고 Safari 와 저장소가 분리돼 있어 앱 저장소에 기억시킨다). 끄기: ?kbdebug=0.
import { useEffect, useState } from 'react'

import { readUrlFlag } from '@/lib/mobile/debugFlags'

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
    `standalone ${standalone} · kbfix ${readUrlFlag('kbfix')}`,
  ]
}

/** 키보드가 열린 동안의 한 시점 — 상자가 화면 밖으로 밀려 실시간 값을 못 읽으므로, 기록해 두었다가 닫힌 뒤 보여준다. */
function record(event: string, t0: number): string {
  const vv = window.visualViewport
  const shell = document.querySelector('[data-testid="mobile-shell"]')?.getBoundingClientRect()
  const scroller = document.scrollingElement
  return [
    `+${Math.round(performance.now() - t0)}ms ${event}`,
    `iH${window.innerHeight} vvH${Math.round(vv?.height ?? -1)} off${Math.round(vv?.offsetTop ?? -1)} pT${Math.round(vv?.pageTop ?? -1)}`,
    `sY${Math.round(window.scrollY)} se${Math.round(scroller?.scrollTop ?? -1)}/${scroller?.scrollHeight ?? -1} b${Math.round(document.body.scrollTop)}`,
    `shell y${Math.round(shell?.top ?? -1)} h${Math.round(shell?.height ?? -1)} kb=${document.documentElement.hasAttribute('data-keyboard-open')} --vv-top ${document.documentElement.style.getPropertyValue('--vv-top') || '-'}`,
    // 문서·body 의 실제 위치 — offsetTop 이 0 이어도 화면이 밀렸다면 여기서 음수로 드러난다.
    `docTop${Math.round(document.documentElement.getBoundingClientRect().top)} bodyTop${Math.round(document.body.getBoundingClientRect().top)}`,
  ].join(' ')
}

// 키보드 기록을 남겨 둘 개수 — 포커스 직후 이동 과정을 보기에 충분하고 상자가 화면을 덮지 않을 정도.
const MAX_RECORDS = 8

/** 진단 오버레이 — 플래그가 켜졌을 때만 화면 위쪽에 측정값을 실시간으로 띄운다(터치는 통과). */
export function KeyboardDebugOverlay() {
  const [enabled] = useState(() => readUrlFlag('kbdebug'))
  const [lines, setLines] = useState<string[]>([])
  // 마지막 편집 포커스 동안의 기록 — 포커스가 새로 들어오면 비우고 다시 쌓는다.
  const [records, setRecords] = useState<string[]>([])

  useEffect(() => {
    if (!enabled) return
    let t0 = performance.now()
    let recording = false
    const log = (event: string) => {
      if (!recording) return
      const line = record(event, t0)
      setRecords((prev) => (prev.length >= MAX_RECORDS ? [...prev.slice(0, MAX_RECORDS - 1), line] : [...prev, line]))
    }
    // 이벤트마다 즉시 + 다음 프레임에 한 번 더 — useVisualViewport 가 같은 이벤트에서 :root 를 갱신한 뒤의 값도 담는다.
    const update = (e?: Event) => {
      setLines(snapshot())
      requestAnimationFrame(() => setLines(snapshot()))
      if (e) log(e.type + (e.currentTarget === window.visualViewport ? '(vv)' : ''))
    }
    const onFocusIn = (e: Event) => {
      // 편집 요소에 포커스가 들어오면 새 기록 시작 — 포커스 직후와 키보드 애니메이션 중간 시점도 타이머로 잡는다.
      const target = e.target
      const editable = target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      if (editable) {
        t0 = performance.now()
        recording = true
        setRecords([])
        log('focusin')
        for (const ms of [100, 300, 600, 1000]) window.setTimeout(() => log(`t${ms}`), ms)
      }
      update()
    }
    const onFocusOut = () => {
      log('focusout')
      recording = false
      update()
    }
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    // iOS 는 키보드 애니메이션 중 이벤트가 빠질 수 있어 주기적으로도 갱신한다(진단용이라 비용 무시).
    const timer = window.setInterval(() => update(), 500)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      window.clearInterval(timer)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <pre
      data-testid="kb-debug-overlay"
      aria-hidden
      className="pointer-events-none fixed left-1 top-[calc(env(safe-area-inset-top)+4px)] z-[9999] max-w-[calc(100vw-8px)] whitespace-pre-wrap break-all rounded bg-black/75 px-2 py-1 font-mono text-[10px] leading-tight text-white"
    >
      {lines.join('\n')}
      {records.length > 0 && `\n── 마지막 입력 포커스 기록 ──\n${records.join('\n')}`}
    </pre>
  )
}
