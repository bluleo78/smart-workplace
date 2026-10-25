// 채팅 서식 입력(WP-101) — RichInput 의 formatting 이 켜진 입력창(팀 채팅·이슈 채팅 작성/수정)만 쓰는 TipTap 확장 묶음.
// StarterKit 대신 낱개로 넣는다 — 제목·인용·구분선(# · > · ---)은 채팅 서식이 아니라 그 입력 규칙이 켜지면 안 된다.
// 단축키(⌘/Ctrl+B·I·U·⇧S·E 등)와 마크다운 입력 규칙(**굵게** *기울임* `코드` ``` - 1.)은 서식 도구 줄을 닫아 둬도 동작한다.
// 입력 규칙은 TipTap 이 한글 조합 중(view.composing)엔 돌리지 않는다.
import { Extension, textblockTypeInputRule, wrappingInputRule } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import BulletList from '@tiptap/extension-bullet-list';
import Code from '@tiptap/extension-code';
import CodeBlock, { backtickInputRegex } from '@tiptap/extension-code-block';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Strike from '@tiptap/extension-strike';
import Underline from '@tiptap/extension-underline';

/**
 * Shift+Enter 를 문맥에 맞게 — 코드 블록 안은 줄바꿈(빈 줄 둘 뒤면 블록 밖으로), 목록 안은 새 항목, 그 밖은 새 문단.
 * HardBreak 의 Shift+Enter 는 코드 블록에서 블록을 빠져나가 버려(exitCode) 우선순위를 높여 먼저 처리한다.
 * Enter(전송)는 RichInput 의 editorProps.handleKeyDown 이 키맵보다 먼저 가져간다. 터치 셸의 Enter 는 전송이 아니라 아래로 떨어져
 * 목록·코드 블록의 기본 Enter(새 항목·줄바꿈, 코드 블록은 빈 줄 둘 뒤 탈출)가 처리한다.
 */
const ChatFormatKeymap = Extension.create({
  name: 'chatFormatKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          const { $from, empty } = editor.state.selection;
          const atEnd = empty && $from.parentOffset === $from.parent.content.size;
          if (atEnd && $from.parent.textContent.endsWith('\n\n')) {
            // 끝에서 빈 줄 둘 + Shift+Enter → 그 빈 줄을 지우고 블록 밖 새 문단으로(코드 블록 Enter 3번 탈출과 같은 관례).
            return editor
              .chain()
              .command(({ tr }) => {
                tr.delete($from.pos - 2, $from.pos);
                return true;
              })
              .exitCode()
              .run();
          }
          return editor.commands.newlineInCode();
        }
        if (editor.isActive('listItem')) return editor.commands.splitListItem('listItem');
        // 그 밖은 줄바꿈(hardBreak) 대신 문단 나누기 — 저장 본문은 같은 '\n' 이지만, 다음 줄에서 목록·코드 블록을 켜면
        // 앞 줄까지 함께 목록이 되지 않고 그 줄만 바뀐다.
        return editor.commands.splitBlock();
      },
    };
  },
});

/** 코드 블록 — 입력 규칙은 ``` 만. `~~~` 펜스는 쓰지 않는다(한국어 채팅의 물결 `~~~ 좋아요` 가 코드 블록이 되지 않게 — 파서도 같은 규칙). */
const ChatCodeBlock = CodeBlock.extend({
  addInputRules() {
    return [textblockTypeInputRule({ find: backtickInputRegex, type: this.type })];
  },
});

/** 번호 목록 — 입력 규칙은 1~3자리 번호만(`2026. 10. 30.` 같은 날짜가 목록이 되지 않게 — 파서·서버 미리보기와 같은 기준). */
const ChatOrderedList = OrderedList.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^(\d{1,3})\.\s$/,
        type: this.type,
        getAttributes: (match) => ({ start: +match[1] }),
        joinPredicate: (match, node) => node.childCount + node.attrs.start === +match[1],
      }),
    ];
  },
});

/** formatting 입력창에 더하는 확장. 링크는 자동 링크를 끈다 — 친 URL 은 글자 그대로 저장되고 화면은 채팅 링크 규칙으로 링크를 건다. */
export const chatFormattingExtensions = [
  Bold,
  Italic,
  Strike,
  Underline,
  Code,
  ChatCodeBlock.configure({ HTMLAttributes: { class: 'chat-code-block' } }),
  BulletList,
  ChatOrderedList,
  ListItem,
  Link.configure({ autolink: false, openOnClick: false, linkOnPaste: true }),
  ChatFormatKeymap,
];

/** 채팅 본문 상한 초과 안내 — 서식 기호까지 센 저장 본문 기준(서버 상한 4000자와 같은 기준). */
export const chatOverLimitMessage = (count: number): string =>
  `메시지는 서식 기호를 포함해 4000자 이하여야 합니다 (현재 ${count}자)`;
