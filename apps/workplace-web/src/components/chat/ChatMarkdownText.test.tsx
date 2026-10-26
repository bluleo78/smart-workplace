import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LinkedText } from '@/components/LinkedText';
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';
import type { MentionUser } from '@/components/mentions/types';

import { ChatMarkdownText, type RenderMention } from './ChatMarkdownText';

// 사람 메시지 렌더(WP-101). 서식 없는 예전 평문은 서식 도입 전 렌더(멘션 칩 + LinkedText)와 DOM 이 같아야 한다.
const mentions: MentionUser[] = [{ id: 7, name: '김철수', kind: 'HUMAN' }];
const chip: RenderMention = (m, key) => (
  <span key={key} data-testid={`chip-${m.id}`}>
    @{m.name}
  </span>
);

function renderNew(body: string) {
  return render(
    <div>
      <ChatMarkdownText body={body} mentions={mentions} renderMention={chip} linkTestId="chat-link" />
    </div>,
  ).container.firstElementChild as HTMLElement;
}

/** 서식 도입 전 렌더 — MessageRow 의 예전 코드와 같다. */
function renderOld(body: string) {
  return render(
    <div>
      {parseMessageSegments(body, mentions).map((seg, i) =>
        seg.type === 'text' ? <LinkedText key={i} text={seg.value} linkTestId="chat-link" /> : chip(seg, String(i)),
      )}
    </div>,
  ).container.firstElementChild as HTMLElement;
}

describe('ChatMarkdownText — 예전 평문은 그대로', () => {
  it.each([
    ['여러 줄', '첫 줄\n둘째 줄\n셋째 줄'],
    ['빈 줄', '위\n\n\n아래'],
    ['앞 빈 줄', '\n\n본문'],
    ['들여쓰기 4칸(코드 아님)', '목록:\n    들여쓴 줄\n  두 칸'],
    ['첫 줄 들여쓰기', '  두 칸 들여'],
    ['밑줄 문자', 'snake_case __init__ _private_ a_b'],
    ['곱셈', '2*3 = 6, 2*3*4 = 24'],
    ['해시', '#해시 # 제목 아님'],
    ['인용·구분선', '> 인용 아님\n---\n***\n==='],
    ['HTML 은 글자', '<b>굵게 아님</b> <script>x</script> <br>'],
    ['이미지·표', '![대체](https://a.com/x.png)\n| a | b |\n|---|---|'],
    ['이스케이프·참조', '\\*별\\* &amp; &lt;u&gt; a\\\nb'],
    ['홑 물결', '~5~ 정도'],
    ['URL 의 _ * ()', 'https://a.com/a_b_c 와 https://a.com/*x* 와 https://en.wikipedia.org/wiki/Foo_(bar) 끝'],
    ['URL 꺾쇠·www', '<https://a.com> www.b.com/x_y'],
    ['URL 뒤 한글', 'https://a.com/doc에서 확인'],
    ['멘션', '<@7> 님, <@99> 확인 부탁'],
    ['날짜 줄', '2024. 10. 25. 회의\n10. 25. 회의'],
    ['대시 한 줄', '-\n1.'],
    ['언더스코어 강조처럼 보이는 것', '__굵게 아님__ _기울임 아님_'],
    ['물결 줄', '~~~ 그럼 내일 봬요\n~~~\n다음 줄'],
    ['닫히지 않은 펜스', '```\n코드인 척\n끝'],
  ])('%s', (_name, body) => {
    expect(renderNew(body).innerHTML).toBe(renderOld(body).innerHTML);
  });
});

describe('ChatMarkdownText — 서식', () => {
  it('굵게·기울임·밑줄·취소선·코드', () => {
    const el = renderNew('**굵게** *기울임* <u>밑줄</u> ~~취소~~ `a_b`');
    expect(el.querySelector('strong')?.textContent).toBe('굵게');
    expect(el.querySelector('em')?.textContent).toBe('기울임');
    expect(el.querySelector('u')?.textContent).toBe('밑줄');
    expect(el.querySelector('del')?.textContent).toBe('취소');
    expect(el.querySelector('code')?.textContent).toBe('a_b');
    expect(el.textContent).toBe('굵게 기울임 밑줄 취소 a_b');
  });

  it('문장부호로 끝난 굵게 뒤 한글 조사', () => {
    const el = renderNew('**(중요)**는 **"a"**가 가**(b)**');
    expect(Array.from(el.querySelectorAll('strong'), (s) => s.textContent)).toEqual(['(중요)', '"a"', '(b)']);
  });

  it('목록 — 글은 그대로, 항목은 li', () => {
    const el = renderNew('할 일\n- 하나\n- 둘\n1. 첫째\n2. 둘째');
    expect(Array.from(el.querySelectorAll('ul > li'), (li) => li.textContent)).toEqual(['하나', '둘']);
    expect(Array.from(el.querySelectorAll('ol > li'), (li) => li.textContent)).toEqual(['첫째', '둘째']);
    expect(el.textContent).toBe('할 일하나둘첫째둘째');
  });

  it('펜스 코드 블록 — 안의 서식·멘션·URL 은 글자', () => {
    const el = renderNew('```\n**x** <@7> https://a.com\n  y\n```');
    expect(el.querySelector('pre code')?.textContent).toBe('**x** <@7> https://a.com\n  y');
    expect(el.querySelector('a')).toBeNull();
  });

  it('링크 — [글](주소) 는 새 탭, javascript: 는 글만', () => {
    const el = renderNew('[문서](https://a.com/x_y) [위험](javascript:alert(1))');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://a.com/x_y');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(el.textContent).toBe('문서 위험');
  });

  // WP-874: 평문 URL 은 새 탭 링크 — 끝의 짝 없는 `)` 와 `.` 은 문장부호로 보고 링크에서 뺀다(이슈 챗·팀 채팅 공용, E2E 이슈 챗 링크에서 옮김).
  it('평문 URL 자동 링크 — 끝 문장부호는 링크 밖', () => {
    const el = renderNew('참고: https://example.com/spec?id=7). 끝');
    const link = el.querySelector('[data-testid="chat-link"]');
    expect(link?.textContent).toBe('https://example.com/spec?id=7');
    expect(link?.getAttribute('href')).toBe('https://example.com/spec?id=7');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(el.textContent).toBe('참고: https://example.com/spec?id=7). 끝');
  });

  it('굵게 안 URL·멘션', () => {
    const el = renderNew('**https://a.com/x** **<@7>**');
    expect(el.querySelector('strong a')?.getAttribute('href')).toBe('https://a.com/x');
    expect(el.querySelector('strong [data-testid="chip-7"]')).not.toBeNull();
  });

  it('겹친 서식 바로 뒤·앞에 한글', () => {
    const el = renderNew('**<u>굵게</u>**을 ~~**굵**~~뒤 **<@7>**님 글**<u>x</u>** [**a**](https://u.com)뒤');
    expect(Array.from(el.querySelectorAll('strong'), (s) => s.textContent)).toEqual(['굵게', '굵', '@김철수', 'x', 'a']);
    expect(el.querySelectorAll('strong u')).toHaveLength(2);
    expect(el.querySelector('del strong')?.textContent).toBe('굵');
    expect(el.querySelector('strong [data-testid="chip-7"]')).not.toBeNull();
    expect(el.querySelector('a strong')?.textContent).toBe('a');
    expect(el.textContent).toBe('굵게을 굵뒤 @김철수님 글x a뒤');
  });

  it('부모가 다른 <u> 짝은 글자', () => {
    expect(renderNew('**<u>a**</u>').textContent).toBe('<u>a</u>');
  });

  it('짝 없는 <u> 는 글자', () => {
    expect(renderNew('<u>열기만').textContent).toBe('<u>열기만');
  });
});
