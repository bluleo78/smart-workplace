// @vitest-environment jsdom
// WP-1482 — 노트 「AI 지시」 상자(class wp-ai-instruction 을 단 wikiHtmlBox). 넣기·감싸기·전환·저장 왕복을 편집기 상태로 본다.
import {
  docToMarkdown,
  wikiSchemaExtensions,
} from "@smart-workplace/wiki-editor-schema";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import {
  AI_INSTRUCTION_CLASS,
  BOX_BASIC_STYLE,
  canWrapInBox,
  insertAiInstructionBox,
  insertBox,
  isAiInstructionBox,
  selectedBox,
  toggleSelectedBoxAiInstruction,
  WikiBox,
  wrapInBox,
  writeSelectedBoxStyle,
} from "./wikiBox";

let editor: Editor | null = null;
const extra: Editor[] = [];
afterEach(() => {
  editor?.destroy();
  editor = null;
  extra.splice(0).forEach((e) => e.destroy());
});

const open = (md: string) => {
  editor = new Editor({
    extensions: [...wikiSchemaExtensions(), WikiBox],
    content: md,
  });
  return editor;
};

/** 첫 노드(이름)의 앞 위치. */
const posOf = (ed: Editor, name: string) => {
  let at = -1;
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === name) at = pos;
    return at < 0;
  });
  return at;
};

/** 글자 text 가 시작하는 위치. */
const textAt = (ed: Editor, text: string) => {
  let at = -1;
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(text))
      at = pos + n.text!.indexOf(text);
  });
  return at;
};

const caret = (ed: Editor, pos: number) =>
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)),
  );
const selectBoxAt = (ed: Editor, pos: number) =>
  ed.view.dispatch(
    ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)),
  );
/** 슬래시 명령(Command)을 편집기 명령 경로로 실행한다 — 거래 확정은 tiptap 이 한다. */
const run = (ed: Editor, cmd: typeof insertAiInstructionBox) => ed.commands.command(cmd)

const BOX = (inner: string, attrs = 'class="card" style="color: red"') =>
  `<div ${attrs}>\n\n${inner}\n\n</div>`;
const firstBox = (ed: Editor) => ed.state.doc.child(0);
const toggle = (ed: Editor) =>
  toggleSelectedBoxAiInstruction(ed.state, ed.view.dispatch);

describe("insertAiInstructionBox — 빈 줄에 지시 상자를 넣는다", () => {
  it("빈 줄이 지시 상자로 바뀌고 커서가 상자 안에 있다", () => {
    const ed = open("");
    expect(run(ed, insertAiInstructionBox)).toBe(true);
    const box = firstBox(ed);
    expect(box.type.name).toBe("wikiHtmlBox");
    expect(box.attrs.className).toBe("wp-ai-instruction");
    expect(box.attrs.style).toBe(BOX_BASIC_STYLE);
    expect(ed.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(ed.state.selection.$from.node(-1)).toBe(box);
    expect(isAiInstructionBox(box)).toBe(true);
  });

  it("저장(마크다운) 왕복 뒤에도 지시 상자이고 안쪽 글자가 남는다", () => {
    const ed = open("");
    run(ed, insertAiInstructionBox);
    ed.view.dispatch(ed.state.tr.insertText("요약해 줘"));
    const md = docToMarkdown(ed.state.doc);
    expect(md).toContain('<div class="wp-ai-instruction" style="');
    const again = new Editor({
      extensions: [...wikiSchemaExtensions(), WikiBox],
      content: md,
    });
    extra.push(again);
    expect(isAiInstructionBox(again.state.doc.child(0))).toBe(true);
    expect(again.state.doc.child(0).textContent).toBe("요약해 줘");
  });
});

describe("wrapInBox(AI_INSTRUCTION_CLASS) — 고른 글을 지시 상자로 감싼다", () => {
  it("두 문단을 하나의 지시 상자로 감싸고 통째 선택한다", () => {
    const ed = open("A\n\nB");
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.create(
          ed.state.doc,
          textAt(ed, "A"),
          textAt(ed, "B") + 1,
        ),
      ),
    );
    expect(wrapInBox(ed.state, ed.view.dispatch, AI_INSTRUCTION_CLASS)).toBe(true);
    expect(ed.state.doc.childCount).toBe(1);
    const box = firstBox(ed);
    expect(isAiInstructionBox(box)).toBe(true);
    expect(box.childCount).toBe(2);
    expect(selectedBox(ed.state)?.node).toBe(box);
  });

  it("표 안처럼 감쌀 수 없는 자리에서는 false", () => {
    const ed = open("| a | b |\n| --- | --- |\n| c | d |");
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.create(
          ed.state.doc,
          textAt(ed, "c"),
          textAt(ed, "d") + 1,
        ),
      ),
    );
    expect(canWrapInBox(ed.state)).toBe(false);
    expect(wrapInBox(ed.state, ed.view.dispatch, AI_INSTRUCTION_CLASS)).toBe(false);
  });
});

describe("toggleSelectedBoxAiInstruction — 통째 선택한 상자의 지시 class 를 뒤집는다", () => {
  it("다른 class 토큰을 남기며 켜고 끈다", () => {
    const ed = open(BOX("A"));
    selectBoxAt(ed, 0);
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBe("card wp-ai-instruction");
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBe("card");
  });

  it("두 번 부르면 원래대로 돌아온다", () => {
    const ed = open(BOX("A"));
    selectBoxAt(ed, 0);
    const before = firstBox(ed).attrs.className;
    expect(toggle(ed)).toBe(true);
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBe(before);
  });

  it("일반 상자는 켰다 끄면 className 이 null 로 돌아오고 style 은 그대로다", () => {
    const ed = open("");
    run(ed, insertBox);
    selectBoxAt(ed, posOf(ed, "wikiHtmlBox"));
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBe(AI_INSTRUCTION_CLASS);
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBeNull();
    expect(firstBox(ed).attrs.style).toBe(BOX_BASIC_STYLE);
  });

  it("class 도 style 도 없는 상태가 되면 style 에 자리 지킴 선언이 들어간다", () => {
    const ed = open('<div class="wp-ai-instruction">\n\nA\n\n</div>');
    selectBoxAt(ed, posOf(ed, "wikiHtmlBox"));
    expect(toggle(ed)).toBe(true);
    expect(firstBox(ed).attrs.className).toBeNull();
    expect(firstBox(ed).attrs.style).toBe("display: block");
  });

  it("선택된 상자가 없으면 false", () => {
    const ed = open(BOX("A"));
    caret(ed, textAt(ed, "A"));
    expect(toggle(ed)).toBe(false);
  });

  it("꾸미기를 바꿔도 지시 class 는 남는다", () => {
    const ed = open("");
    run(ed, insertAiInstructionBox);
    selectBoxAt(ed, posOf(ed, "wikiHtmlBox"));
    writeSelectedBoxStyle(ed, () => "border: 2px solid red");
    expect(firstBox(ed).attrs.className).toBe("wp-ai-instruction");
  });
});
