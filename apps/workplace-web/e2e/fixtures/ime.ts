// IME(한글) 키 입력 재현 도우미 — Playwright 로는 실제 IME 조합을 만들 수 없어, 브라우저가 보내는 이벤트 순서를 그대로 디스패치한다.
import type { Locator } from '@playwright/test';

/**
 * macOS Chrome 한글 IME 에서 마지막 글자를 조합하던 중 Enter 를 누른 순간의 이벤트 순서(WP-331):
 * 조합 Enter keydown(isComposing, 229) → compositionend → 조합 아닌 Enter keydown(13, "꼬리 Enter").
 * 앱은 둘 다 Enter 동작(저장·이동)으로 보면 안 된다. 왕복 지연이 무시 창을 넘지 않게 한 번의 evaluate 로 보낸다.
 */
export async function pressMacChromeImeEnter(field: Locator, composed: string): Promise<void> {
  await field.evaluate((el, data) => {
    const enter = (init: KeyboardEventInit & { keyCode: number }) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    enter({ isComposing: true, keyCode: 229 });
    el.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
    enter({ keyCode: 13 });
  }, composed);
}

/**
 * 조합을 끝내며 진짜 Enter 를 한 번만 보내는 순서 — 모바일 키보드(compositionend → Enter 13),
 * Safari(compositionend → 조합 Enter 229 → 사용자가 다시 누른 Enter 13). 마지막 Enter 는 동작(저장·이동)해야 한다.
 */
export async function pressEnterAfterComposition(field: Locator, composed: string, opts: { safari?: boolean } = {}): Promise<void> {
  await field.evaluate(
    (el, { data, safari }) => {
      const enter = (init: KeyboardEventInit & { keyCode: number }) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
      el.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
      if (safari) enter({ keyCode: 229 });
      enter({ keyCode: 13 });
    },
    { data: composed, safari: opts.safari ?? false },
  );
}

/**
 * macOS Chrome 에서 노트 본문·채팅 같은 ProseMirror 편집기에 마지막 글자를 조합하다 Enter 를 친 순간(WP-333):
 * 브라우저가 마지막 조합 글자를 다시 쓰며 확정하고(DOM 변경) → compositionend → 조합 아닌 Enter keydown(13) 을 **한 태스크 안에서** 보낸다.
 * 그래서 Enter 를 처리할 때 그 DOM 변경이 아직 편집기 문서에 반영되지 않았다. 실제 조합은 CDP 로 만들고(composing),
 * 조합을 끝내는 compositionend 와 같은 태스크에서 마지막 글자를 committed 로 다시 쓴 뒤(아직 읽히지 않은 DOM 변경) Enter keydown 을 보낸다.
 * CDP 확정만으로는 사이에 마이크로태스크가 돌아 변경이 먼저 반영돼 버리므로 마지막 글자 다시 쓰기를 직접 한다. 실제 macOS 입력기는 아니다.
 */
export async function commitImeThenEnterInSameTask(
  field: Locator,
  { composing, committed }: { composing: string; committed: string },
): Promise<void> {
  const page = field.page();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: composing, selectionStart: composing.length, selectionEnd: composing.length });
    // 편집기의 compositionend 처리 뒤(문서 버블 단계)에 같은 태스크로 — 마이크로태스크가 끼어들 틈이 없다.
    await field.evaluate((el, last) => {
      el.dataset.imeRewrite = 'pending';
      document.addEventListener(
        'compositionend',
        () => {
          const sel = getSelection();
          const node = sel?.anchorNode;
          // 다시 쓸 글자 노드가 없으면 재현이 안 된 채 Enter 만 보내 테스트가 거짓 통과한다 — 표시를 남겨 아래에서 실패시킨다.
          if (!(node instanceof Text)) {
            el.dataset.imeRewrite = 'no-text-node';
            return;
          }
          node.replaceData(node.length - last.length, last.length, last);
          // 다시 쓰기는 커서를 글자 앞으로 당긴다(DOM Range 규칙) — 실제 확정처럼 커서는 확정 글자 뒤에 둔다.
          sel?.collapse(node, node.length);
          el.dataset.imeRewrite = 'done';
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        },
        { once: true },
      );
    }, committed);
    await cdp.send('Input.insertText', { text: composing });
  } finally {
    await cdp.detach();
  }
  const rewrite = await field.getAttribute('data-ime-rewrite');
  if (rewrite !== 'done') throw new Error(`IME 확정 재현 실패: ${rewrite}`);
}
