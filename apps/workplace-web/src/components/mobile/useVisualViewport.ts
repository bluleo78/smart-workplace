// 가상 키보드 대응 — iOS 는 키보드가 올라와도 레이아웃 뷰포트(100dvh)를 줄이지 않고, 포커스된 입력창이 보이도록
// 페이지 전체를 위로 민다(pan). 그 결과 상단 헤더가 화면 밖으로 밀리고 본문이 상태바 아래로 들어간다.
// 표준(interactive-widget=resizes-content·VirtualKeyboard API)은 Chromium 전용이라 iOS 에선 visualViewport 로 맞춘다
// (Android Chrome 은 index.html 의 interactive-widget 으로 레이아웃 뷰포트가 직접 줄어 여기 판정에 걸리지 않는다).
// 키보드 상태는 :root 에만 공개한다 — 셸 높이·하단 여백(MobileShell)과 셸 밖(portal) 다이얼로그·시트·메일 도크(index.css 등)가
// 모두 CSS 로 같은 값을 읽으므로 React 상태·리렌더가 필요 없다.
import { useEffect } from 'react'

// 레이아웃 뷰포트보다 이만큼 이상 작아지면 키보드가 열린 것으로 본다(주소창 높이 변화 정도는 무시).
const KEYBOARD_THRESHOLD_PX = 150
// 키보드를 띄우지 않는 input 유형 — 포커스돼 있어도 키보드 열림 근거가 아니다.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'])

/** 키보드를 띄우는 편집 요소에 포커스가 있는가 — 키보드 없이 보이는 영역만 줄어드는 경우를 거른다. */
function isEditableFocused(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type)
}

/**
 * 키보드 열림 판정. 핀치 줌도 visualViewport.height 를 줄이므로 배율이 1 일 때만 본다 —
 * 줌 상태를 키보드로 오인하면 셸이 줄고 패닝마다 scrollTo(0,0) 로 튕긴다.
 */
function detectKeyboard(vv: VisualViewport): boolean {
  if (Math.abs(vv.scale - 1) > 0.01) return false
  return window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX && isEditableFocused()
}

/** :root 에 쓰는 키보드 값 — 키보드가 닫히면 전부 지워 기존 레이아웃(var 폴백)에 영향을 주지 않는다. */
const ROOT_VARS = ['--vvh', '--vv-top', '--kb-inset'] as const

/**
 * :root 에 data-keyboard-open + --vvh(보이는 높이)·--vv-top(보이는 영역 위 오프셋)·--kb-inset(보이는 영역 아래 가려진 높이)을 공개한다.
 * scroll·resize 는 프레임마다 올 수 있고 :root 변수 변경은 문서 전체 스타일 재계산을 부르므로, 값이 바뀐 것만 쓴다.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    // 마지막으로 쓴 값 — 같은 값 재기록(스타일 무효화)을 건너뛴다. null = 닫힘(아무것도 안 씀).
    let published: string[] | null = null

    const clear = () => {
      if (!published) return
      root.removeAttribute('data-keyboard-open')
      for (const name of ROOT_VARS) root.style.removeProperty(name)
      published = null
    }

    const sync = () => {
      if (!detectKeyboard(vv)) return clear()
      // iOS 가 입력창을 보이려고 문서를 밀어 올린 것을 되돌린다 — 셸이 보이는 높이에 맞춰지므로 밀 필요가 없다.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
      const next = [vv.height, vv.offsetTop, Math.max(0, window.innerHeight - vv.height - vv.offsetTop)].map((v) => `${v}px`)
      if (!published) root.setAttribute('data-keyboard-open', 'true')
      ROOT_VARS.forEach((name, i) => {
        if (published?.[i] !== next[i]) root.style.setProperty(name, next[i])
      })
      published = next
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      clear()
    }
  }, [])
}
