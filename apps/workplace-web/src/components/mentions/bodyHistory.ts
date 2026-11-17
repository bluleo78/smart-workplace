// 본문 모드 RichInput 실행 취소(WP-1656) — 이슈 본문 편집칸이 Textarea 에서 편집기로 바뀌어도 Ctrl/Cmd+Z 되돌리기를 잃지 않게 한다.
// 코멘트·채팅 입력창은 실행 취소 기록이 없는 지금 그대로 두고 본문 모드에만 더한다. 새 의존성 없이 @tiptap/pm/history 를 쓴다.
import { Extension } from '@tiptap/core'
import { history, redo, undo } from '@tiptap/pm/history'

/** 실행 취소 기록 + 단축키(Mod-z 되돌리기, Mod-Shift-z·Mod-y 다시 하기). */
export const BodyHistory = Extension.create({
  name: 'bodyHistory',

  addProseMirrorPlugins() {
    return [history()]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch),
      'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch),
      'Mod-y': () => redo(this.editor.state, this.editor.view.dispatch),
    }
  },
})
