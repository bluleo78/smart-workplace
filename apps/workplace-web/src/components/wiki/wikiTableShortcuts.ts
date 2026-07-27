// 표 행·열 삽입 단축키. Table 확장의 기본 키맵(Tab/Shift-Tab/Backspace)은 그대로 두고 추가만 한다.
//
// Mod(=macOS 의 Cmd)를 쓰지 않는 이유: Cmd-Alt-←/→ 는 Chrome·Safari 의 탭 전환이라 웹에서
// 가로챌 수 없다. Confluence 도 같은 이유로 Ctrl-Alt-화살표를 쓴다.
//
// 역할 게이트: 스펙 §5 는 뷰어 권한에서 툴바·우클릭 메뉴뿐 아니라 단축키도 비활성을 요구한다.
// wikiSlashSuggestion.ts 의 createWikiSlashExtension 과 같은 패턴으로 canEditRef 를 팩토리
// 인자로 주입한다 — useEditor 를 재생성하지 않고도 최신 권한을 매 키 입력마다 읽기 위함이다.
import { Extension } from '@tiptap/core'

import {
  isTableCommandEnabled,
  readTableSnapshot,
  type WikiTableCommandKey,
} from './wikiTableCommands'

const BINDINGS: Record<string, WikiTableCommandKey> = {
  'Ctrl-Alt-ArrowUp': 'addRowBefore',
  'Ctrl-Alt-ArrowDown': 'addRowAfter',
  'Ctrl-Alt-ArrowLeft': 'addColumnBefore',
  'Ctrl-Alt-ArrowRight': 'addColumnAfter',
}

export interface WikiTableShortcutsContext {
  // OWNER|EDITOR 일 때만 true. false 면 4개 키 전부 false 를 반환해 기본 동작을 방해하지 않는다.
  canEditRef: { current: boolean }
}

export function createWikiTableShortcuts(ctx: WikiTableShortcutsContext): Extension {
  return Extension.create({
    name: 'wikiTableShortcuts',
    addKeyboardShortcuts() {
      return Object.fromEntries(
        Object.entries(BINDINGS).map(([combo, key]) => [
          combo,
          () => {
            if (!ctx.canEditRef.current) return false
            // 표 밖이면 false 를 반환해 브라우저·다른 확장의 기본 동작을 방해하지 않는다.
            if (!isTableCommandEnabled(key, readTableSnapshot(this.editor))) return false
            return this.editor.chain().focus()[key]().run()
          },
        ]),
      )
    },
  })
}
