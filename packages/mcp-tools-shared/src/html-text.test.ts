import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-text.js';

describe('htmlToText (WP-353)', () => {
  it('태그를 걷어내고 블록 태그·br 은 줄바꿈으로 바꾼다', () => {
    expect(htmlToText('<p>안녕하세요</p><p>견적 보냅니다.<br>감사합니다</p>')).toBe('안녕하세요\n견적 보냅니다.\n감사합니다');
  });

  it('script·style·head·주석은 내용째 버린다(header 같은 비슷한 이름 태그는 살린다)', () => {
    const html = '<html><head><title>제목</title><style>p{color:red}</style></head><body><!-- 숨김 --><script>alert(1)</script><header>머리글</header><p>본문</p></body></html>';
    expect(htmlToText(html)).toBe('머리글\n본문');
  });

  it('엔티티를 풀고 알 수 없는 엔티티·범위 밖 코드포인트는 그대로 둔다', () => {
    expect(htmlToText('<p>A &amp; B &lt;c&gt; &quot;d&quot; &#65;&#x42; &nbsp;끝</p>')).toBe('A & B <c> "d" AB 끝');
    expect(htmlToText('<p>&unknownentity; &#99999999999;</p>')).toBe('&unknownentity; &#99999999999;');
  });

  it('이스케이프된 태그 문자열은 태그로 취급하지 않는다(엔티티는 태그 제거 뒤에 푼다)', () => {
    expect(htmlToText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe('<script>alert(1)</script>');
  });

  it('연속 공백은 한 칸, 연속 빈 줄은 한 줄로 접고 양끝을 다듬는다', () => {
    expect(htmlToText('  <div>가    나</div>\n\n\n\n<div>다</div>  ')).toBe('가 나\n\n다');
  });

  it('표·목록은 행·항목 단위로 줄이 나뉜다', () => {
    expect(htmlToText('<ul><li>하나</li><li>둘</li></ul>')).toBe('하나\n둘');
    expect(htmlToText('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>')).toBe('a b\nc');
  });

  it('빈 입력·태그만 있는 입력은 빈 문자열', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<div><br></div>')).toBe('');
  });

  it('닫히지 않은 태그가 있어도 던지지 않는다', () => {
    expect(htmlToText('<p>열림만 <b>굵게')).toBe('열림만 굵게');
    // 닫히지 않은 주석·스타일은 입력 끝까지 버린다(브라우저와 같다).
    expect(htmlToText('앞<!-- 닫히지 않음 뒤')).toBe('앞');
    expect(htmlToText('앞<style>p{} 뒤')).toBe('앞');
  });

  it('악의적으로 닫히지 않는 큰 입력도 입력 길이에 선형으로 끝난다(이벤트 루프를 붙잡지 않는다)', () => {
    const n = 100_000;
    const cases = ['<div>'.repeat(n) + '본문', '<!--'.repeat(n), '<style>'.repeat(n) + '본문', '<script>'.repeat(n), '<head>'.repeat(n), '<'.repeat(n), '<a'.repeat(n), '&'.repeat(n)];
    for (const html of cases) {
      const t0 = Date.now();
      htmlToText(html);
      expect(Date.now() - t0, html.slice(0, 12)).toBeLessThan(1000);
    }
  });
});
