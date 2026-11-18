// @vitest-environment jsdom
// 지난 원문 자르기 순수 함수 테스트(WP-1747). 원문은 buildQuote 가 우리 감싸기로 싼 모양이고,
// 그 안의 지난 원문 표시(Gmail·Outlook·Apple·우리 앱·옛 머리·Original Message 줄)에서 자르는지 본다.
// splitOlderQuotes 가 DOMParser 를 쓰므로 jsdom 환경이 필요하다.
import { describe, expect, it } from 'vitest';

import { splitOlderQuotes } from './mailQuoteSplit';

/** buildQuote 와 같은 우리 감싸기 — 구분선·머리·원문이 모두 이 안에 있다. */
function wrap(inner: string): string {
  return `<div class="wp_quote gmail_quote"><hr><div><b>보낸 사람:</b> a</div><br>${inner}</div>`;
}

/** 실제 Gmail 단계 하나 — div.gmail_quote 안에 머리(gmail_attr)와 blockquote.gmail_quote 가 함께 있다. */
function gmailLevel(attr: string, body: string): string {
  return (
    '<div class="gmail_quote gmail_quote_container">' +
    `<div dir="ltr" class="gmail_attr">${attr}<br></div>` +
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
    body +
    '</blockquote></div>'
  );
}

describe('splitOlderQuotes', () => {
  it('Gmail 3통 스레드는 단계마다 한 통으로 세어 지난 원문 2통이다', () => {
    const third = '<div dir="ltr">셋째 메일 본문</div>';
    const second =
      '<div dir="ltr">둘째 메일 본문</div><br>' +
      gmailLevel('2026년 11월 16일 (월) 오전 9:00, 김철수 &lt;kim@example.com&gt;님이 작성:', third);
    const first =
      '<div dir="ltr">첫째 메일 본문</div><br>' +
      gmailLevel('2026년 11월 17일 (화) 오전 10:00, 이영희 &lt;lee@example.com&gt;님이 작성:', second);
    const result = splitOlderQuotes(wrap(first));

    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.recent).toContain('첫째 메일 본문');
    expect(result!.recent).toContain('보낸 사람');
    expect(result!.recent).not.toContain('gmail_attr');
    expect(result!.recent).not.toContain('님이 작성');
    expect(result!.recent).not.toContain('둘째 메일 본문');
    expect(result!.older).toContain('둘째 메일 본문');
    expect(result!.older).toContain('셋째 메일 본문');
    expect(result!.older).not.toContain('첫째 메일 본문');
  });

  it('Outlook 웹은 divRplyFwdMsg 마다 한 통이고 바로 앞 원문 끝에 구분선을 남기지 않는다', () => {
    const inner =
      '<p>본문</p><hr><div id="divRplyFwdMsg">머리</div><div>둘째</div>' +
      '<hr><div id="divRplyFwdMsg">머리</div><div>셋째</div>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(2);
    expect(result!.recent).toContain('본문');
    expect(result!.recent.trim()).not.toMatch(/<hr[^>]*>\s*$/);
    expect(result!.recent.trim()).not.toMatch(/<br[^>]*>\s*(<\/div>)*\s*$/);
    expect(result!.older).toContain('둘째');
    expect(result!.older).toContain('셋째');
  });

  it('Apple Mail 은 겹친 blockquote type=cite 마다 한 통이다', () => {
    const inner =
      '<p>본문</p><blockquote type="cite"><p>둘째</p><blockquote type="cite"><p>셋째</p></blockquote></blockquote>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(2);
    expect(result!.recent).toContain('본문');
    expect(result!.recent).not.toContain('둘째');
  });

  it('우리 앱 감싸기가 겹치면 안쪽 감싸기부터 지난 원문이다', () => {
    const inner = `<p>본문</p>${wrap('<p>둘째</p>')}`;
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('본문');
    expect(result!.recent).toContain('보낸 사람');
    expect(result!.recent).not.toContain('둘째');
    expect(result!.older).toContain('둘째');
  });

  it('-----Original Message----- 줄부터 지난 원문이다', () => {
    const inner = '<p>본문</p><p>-----Original Message-----</p><p>From: x</p><p>둘째</p>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.older).toContain('Original Message');
    expect(result!.older).toContain('둘째');
    expect(result!.recent).not.toContain('Original Message');
  });

  it('원본 메시지 줄도 지난 원문 표시다', () => {
    const inner = '<p>본문</p><div>----- 원본 메시지 -----</div><p>둘째</p>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.older).toContain('원본 메시지');
    expect(result!.recent).not.toContain('원본 메시지');
  });

  it('겹친 표시 사이에 글자가 없으면 한 통으로 센다(가장 가까운 표시 조상 규칙)', () => {
    // 바깥 div 와 안쪽 div 가 모두 Original Message 줄로 판정된다 — 같은 한 통이다
    const inner = '<p>본문</p><div><div>-----Original Message-----</div></div><p>둘째</p>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
  });

  it('옛 우리 머리(「… 님이 작성:」으로 시작하는 blockquote)부터 지난 원문이다', () => {
    const inner = '<p>본문</p><blockquote>홍길동 님이 작성:<br/><p>둘째</p></blockquote>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('본문');
    expect(result!.older).toContain('둘째');
  });

  it('글 중간에 「님이 작성:」이 있는 blockquote 는 표시가 아니다', () => {
    const inner = '<p>본문</p><blockquote>인용한 글<br>홍길동 님이 작성:</blockquote>';

    expect(splitOlderQuotes(wrap(inner))).toBeNull();
  });

  it('표·font 안 깊은 표시에서 잘라도 바로 앞 원문의 감싸기 서식이 남는다', () => {
    const inner =
      '<table><tbody><tr><td><font face="Arial"><p>본문</p>' +
      '<div class="gmail_quote"><p>둘째</p></div></font></td></tr></tbody></table>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('<font face="Arial"');
    expect(result!.recent).toContain('본문');
    expect(result!.recent).not.toContain('둘째');
    expect(result!.older).toContain('둘째');
    expect(result!.older).not.toContain('본문');
  });

  it('지난 원문이 없으면 null — 우리 감싸기 자체에서 자르지 않는다', () => {
    expect(splitOlderQuotes(wrap('<p>본문만</p>'))).toBeNull();
  });

  it('감싸기 없는 원문(옛 임시 저장)도 첫 표시에서 자른다', () => {
    const result = splitOlderQuotes('<p>본문</p><div class="gmail_quote">둘째</div>');

    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('본문');
    expect(result!.recent).not.toContain('둘째');
    expect(result!.older).toContain('둘째');
  });

  it('빈 문자열이면 null', () => {
    expect(splitOlderQuotes('')).toBeNull();
  });

  // ── 리뷰 반영 ──────────────────────────────────────────────

  it('인용 아래에 쓴 답(바닥 답장)이 있으면 자르지 않는다 — 답을 지난 원문으로 숨기지 않는다', () => {
    const inner = '<blockquote type="cite">old</blockquote><p>My actual answer</p>';

    expect(splitOlderQuotes(wrap(inner))).toBeNull();
  });

  it('머리만 있는 표시(Outlook divRplyFwdMsg)는 뒤에 글이 있어도 그대로 자른다', () => {
    const inner = '<p>본문</p><div id="divRplyFwdMsg">머리</div><div>둘째</div>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.older).toContain('둘째');
  });

  it('pre 안 한 글자 덩어리의 Original Message 줄에서 줄 단위로 자른다', () => {
    const inner = '<pre>본문\n-----Original Message-----\nFrom: x\n둘째</pre>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('본문');
    expect(result!.recent).not.toContain('Original Message');
    expect(result!.older).toContain('Original Message');
    expect(result!.older).toContain('둘째');
    expect(result!.older).not.toContain('본문');
  });

  it('br 로 이어진 div 안의 Original Message 줄도 표시다', () => {
    const inner = '<p>본문</p><div>-----Original Message-----<br>From: x<br>둘째</div>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.recent).not.toContain('Original Message');
    expect(result!.older).toContain('둘째');
  });

  it('Thunderbird 인용 머리(moz-cite-prefix)는 지난 원문 쪽으로 옮긴다', () => {
    const inner =
      '<p>본문</p><div class="moz-cite-prefix">On 1/2 Kim wrote:<br></div>' +
      '<blockquote type="cite"><p>둘째</p></blockquote>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.count).toBe(1);
    expect(result!.recent).toContain('본문');
    expect(result!.recent).not.toContain('wrote:');
    expect(result!.older).toContain('wrote:');
    expect(result!.older).toContain('둘째');
  });

  it('「… 님이 작성:」 한 줄 블록도 인용 머리로 보고 지난 원문 쪽으로 옮긴다', () => {
    const inner =
      '<p>본문</p><div>2026년 11월 17일, 김철수 님이 작성:</div><blockquote type="cite"><p>둘째</p></blockquote>';
    const result = splitOlderQuotes(wrap(inner));

    expect(result!.recent).not.toContain('님이 작성');
    expect(result!.older).toContain('님이 작성');
  });
});
