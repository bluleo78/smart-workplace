// 지금 보는 대상(WP-1234) — 상세 화면이 등록하고 ⇧⌘,(링크 복사)·⌘.(키 복사) 단축키가 읽는다. React 밖 순수 TS 라 vitest(node)로 검증한다.
// AI 화면 맥락 스토어(aiScreenContext/store)와 따로 둔다 — 그쪽은 URL 을 만들 정보가 다르고(드라이브 공간·폴더, 메일 계정이 없다)
// AI 를 쓸 수 없는 워크스페이스에선 등록되지 않기 때문이다.
import { isMacLike } from './platform'

/** 링크를 딸 수 있는 대상 종류. */
export type ShareTargetKind = 'issue' | 'page' | 'file' | 'folder' | 'event' | 'mail'

/** 지금 보는 대상 — 링크·이름·(이슈면) 키·(노트·드라이브면) 기존 외부 공유 창 열기. */
export interface ShareTarget {
  kind: ShareTargetKind
  /** 절대 URL(appUrl 로 만든다). */
  url: string
  /** 대상 이름 — 공유 시트 제목·「다른 앱으로 보내기」 제목. */
  title: string
  /** 이슈 키(WP-12) — 있으면 「키 복사」·⌘. 가 동작한다. */
  key?: string
  /** 노트·드라이브의 기존 외부 공유 창 열기 — 있으면 공유 시트에 「외부 공유 링크…」가 생긴다. */
  onExternalShare?: () => void
}

/**
 * 등록 층 — 'page' 는 상세 화면(이슈·노트·폴더·메일), 'overlay' 는 그 위에 뜨는 뷰어·대화상자(첨부 뷰어·일정 창).
 * 열린 overlay 가 있으면 page 보다 늘 이긴다 — React 는 자식 effect 를 부모보다 먼저 돌리므로
 * 페이지 안에서 연 뷰어가 페이지보다 먼저 등록될 수 있어, 등록 순서만으로는 위에 떠 있는 쪽을 알 수 없기 때문이다.
 */
export type ShareTargetLayer = 'page' | 'overlay'

export interface ShareTargetStore {
  set(token: symbol, target: ShareTarget | null, layer?: ShareTargetLayer): void
  release(token: symbol): void
  get(): ShareTarget | null
}

/** 등록자 한 명의 자리 — 값이 null 이어도(로딩 중 등) 자리는 지켜 순서를 잃지 않는다. */
interface ShareTargetEntry {
  layer: ShareTargetLayer
  target: ShareTarget | null
}

/**
 * 등록자(토큰)별 대상을 삽입 순서 Map 으로 든다. 현재 대상 = 가장 나중에 등록한 overlay(값이 있는 것), 없으면 가장 나중에 등록한 page.
 * 같은 토큰의 갱신(null ↔ 값 포함)은 자리를 지킨 채 값만 바꾼다 — 목록 화면이 다시 그려지거나 잠깐 null 이 되어도 위에 열린 화면을 앞지르지 않게.
 * 자리는 release(언마운트) 때만 뺀다. 값은 비교 없이 늘 바꾼다(onExternalShare 같은 함수가 낡지 않게). 구독자는 없다 — 단축키가 누를 때 get() 으로 읽는다.
 */
export function createShareTargetStore(): ShareTargetStore {
  const entries = new Map<symbol, ShareTargetEntry>()
  return {
    set(token, target, layer = 'page') {
      // 기존 키에 Map.set 하면 삽입 순서가 그대로다 — 자리를 지킨다.
      entries.set(token, { layer, target })
    },
    release(token) {
      entries.delete(token)
    },
    get() {
      let page: ShareTarget | null = null
      let overlay: ShareTarget | null = null
      for (const { layer, target } of entries.values()) {
        if (!target) continue
        if (layer === 'overlay') overlay = target
        else page = target
      }
      return overlay ?? page
    },
  }
}

/** 앱 전역 대상 스토어 — 상세 화면(useRegisterShareTarget)과 단축키(useShareHotkeys)가 함께 쓴다. */
export const shareTargetStore = createShareTargetStore()

/** 단축키가 할 일 — 링크 복사(⇧⌘,) 또는 키 복사(⌘.). */
export type ShareHotkey = 'link' | 'key'

type HotkeyEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/**
 * 키 이벤트를 단축키로 읽는다. macOS·iOS 는 ⌘(metaKey)만, Windows·Linux 는 Ctrl 만 본다 — 둘 다 받으면 Windows 의 Win+. (이모지 패널)까지 가로챈다.
 * 쉼표는 e.code('Comma')로 본다 — Shift 를 누르면 e.key 가 '<' 가 되는 자판 배열이 있다. 마침표도 같은 이유로 'Period'.
 * Alt 가 섞이면 다른 단축키다(⌥ 조합은 macOS 에서 다른 글자를 만든다).
 */
export function matchShareHotkey(e: HotkeyEvent, macLike: boolean = isMacLike()): ShareHotkey | null {
  // 플랫폼의 주 수식 키만 받는다(macLike 는 테스트에서 넣어 본다). 반대쪽 수식 키가 섞여도 다른 단축키로 본다.
  const mod = macLike ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey) return null
  if (e.code === 'Comma' && e.shiftKey) return 'link'
  if (e.code === 'Period' && !e.shiftKey) return 'key'
  return null
}

/**
 * 단축키 표기 — macOS·iOS 는 ⇧⌘, / ⌘., 그 밖은 Ctrl+Shift+, / Ctrl+. 툴팁·aria-label·메뉴 오른쪽 글자에 쓴다.
 * 플랫폼 판정은 matchShareHotkey 와 같은 isMacLike 한 곳에서 한다(표기와 실제 키가 어긋나지 않게). macLike 는 테스트에서 넣어 본다.
 */
export function shareShortcutLabels(macLike: boolean = isMacLike()): Record<ShareHotkey, string> {
  return macLike ? { link: '⇧⌘,', key: '⌘.' } : { link: 'Ctrl+Shift+,', key: 'Ctrl+.' }
}
