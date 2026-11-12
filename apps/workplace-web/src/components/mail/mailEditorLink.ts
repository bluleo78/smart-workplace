// 메일 편집기 링크 걸기(WP-1517) — 작성창(MailComposer)과 서명 편집기(MailSignatureEditor)의 링크 대화상자가 같은 규칙을 쓴다.
// 컴포넌트 파일(MailComposer.tsx)은 Fast Refresh 규칙상 컴포넌트만 내보내므로 함수는 여기 둔다.
import { PasteRule } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import type { Fragment, MarkType } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

/**
 * 링크 대화상자 확인 — 빈 주소면 커서 자리 링크를 풀고, 아니면 선택 영역(커서가 링크 안이면 그 링크 전체)에 건다.
 * 주소 앞뒤 공백은 뺀다.
 */
export function applyLink(editor: Editor, url: string): void {
  const href = url.trim();
  if (href === '') {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}

/** 조각(붙여 넣은 내용) 안에 이미 링크 mark 가 걸린 글자가 있는가. */
function sliceHasLink(content: Fragment, type: MarkType): boolean {
  let found = false;
  content.descendants((node) => {
    if (found) return false;
    if (node.marks.some((m) => m.type === type)) found = true;
    return !found;
  });
  return found;
}

/**
 * 메일 편집기 링크(WP-1517) — 작성창·서명 편집기가 함께 쓰는 Tiptap Link.
 *
 * 왜 기본 Link 를 그대로 쓰지 않나: Tiptap Link 는 붙여넣기에서 두 가지로 기존 <a> 의 href 를 덮는다.
 *  1) 붙여넣기 규칙(addPasteRules) — 붙여 넣은 글자에서 주소처럼 보이는 낱말(「example.com」)을 찾아 linkify 가 만든 href
 *     (`http://example.com`)로 링크 mark 를 다시 건다. 같은 mark 라 원래 `https://example.com/sig` 가 사라진다.
 *  2) linkOnPaste 처리기 — 선택 영역이 있을 때 붙여 넣은 글 전체가 주소 하나처럼 보이면, 붙여 넣기를 막고 선택한 글자에
 *     그 linkify 주소를 건다. 링크가 든 서명을 통째로 붙여 넣어도 내용이 들어가지 않고 옛 글자에 엉뚱한 링크가 걸린다.
 * Outlook 서명은 「www.company.com」 글자에 더 긴 https 주소를 거는 일이 흔해 둘 다 실제로 걸린다.
 * 그래서 이미 링크가 걸린 글자는 건드리지 않게 하고, 링크 없는 주소 글자의 자동 링크(입력·붙여넣기)는 그대로 둔다.
 */
export const MailLink = Link.extend({
  addPasteRules() {
    const type = this.type;
    // 이미 링크 mark 가 있는 범위(붙여 넣은 <a>)는 건너뛴다 — 링크 없는 주소 글자만 자동 링크.
    // 건너뛸 때 null 이 아니라 undefined 를 돌려준다: null 은 「규칙 실패」라 같은 붙여넣기의 다른 자동 링크까지 버려진다.
    return (this.parent?.() ?? []).map(
      (rule) =>
        new PasteRule({
          find: rule.find,
          handler: (props) => {
            if (props.state.doc.rangeHasMark(props.range.from, props.range.to, type)) return;
            return rule.handler(props);
          },
        }),
    );
  },
  addProseMirrorPlugins() {
    const type = this.type;
    // 기본 linkOnPaste 처리기(키 handlePasteLink)는 붙여 넣은 내용에 링크가 없을 때만 부른다 — 링크가 든 내용은 그대로 붙여 넣는다.
    return (this.parent?.() ?? []).map((plugin) => {
      const original = plugin.props.handlePaste;
      if (!original || !(plugin as unknown as { key: string }).key.startsWith('handlePasteLink')) return plugin;
      return new Plugin({
        ...plugin.spec,
        props: {
          ...plugin.spec.props,
          handlePaste(view, event, slice) {
            if (sliceHasLink(slice.content, type)) return false;
            return original.call(this, view, event, slice);
          },
        },
      });
    });
  },
}).configure({ openOnClick: false, autolink: true });
