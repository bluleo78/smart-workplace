// @vitest-environment jsdom
// 인용문 언랩·조립 순수 함수 테스트. 저장된 원문은 완전 HTML 문서이므로
// <style> 누출 차단과 서식 보존을 동시에 단정한다(설계 §4.1).
// unwrapMailHtml 이 DOMParser(브라우저 API)를 쓰므로 이 파일만 jsdom 환경이 필요하다
// (vitest.config.ts 기본은 node — 위 docblock 예외 케이스에 해당).
import { describe, expect, it } from 'vitest';

import { buildQuote, unwrapMailHtml } from './mailQuote';

// EmailMessageDetail(src/types/mailMessage.ts) 실제 필드는 대부분 nullable 이다.
// toAddresses 는 배열이 아니라 이미 콤마로 합쳐진 단일 문자열이다.
const detail = {
  id: 1,
  threadId: 't1',
  messageId: null,
  bodyHtml: null as string | null,
  bodyText: null as string | null,
  fromAddress: 'jiwon.park@example.com',
  fromName: '박지원',
  toAddresses: 'me@example.com',
  ccAddresses: null,
  bccAddresses: null,
  subject: '4분기 인프라 예산 재검토 요청',
  sentAt: '2026-08-09T02:30:00Z',
  receivedAt: '2026-08-09T02:30:00Z',
  seen: true,
  attachments: [],
};

describe('unwrapMailHtml', () => {
  it('완전 문서를 body 내부 fragment 로 언랩한다', () => {
    const out = unwrapMailHtml(
      '<html><head><style>body{color:red}</style></head><body><p>본문</p></body></html>',
    );
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<html');
    expect(out).not.toContain('<head');
    expect(out).toContain('<p>본문</p>');
  });

  it('body 안에 놓인 style·script·link·base·meta·title 을 제거한다', () => {
    const out = unwrapMailHtml(
      '<body><style>p{color:red}</style><script>alert(1)</script>' +
        '<link rel="stylesheet" href="x.css"><base href="/x"><meta charset="utf-8">' +
        '<title>제목</title><p>본문</p></body>',
    );
    expect(out).toBe('<p>본문</p>');
  });

  it('표·이미지·인라인 style·bgcolor·font 를 보존한다', () => {
    const out = unwrapMailHtml(
      '<html><body><table><tr><td bgcolor="#eee" style="color:#00f">셀</td></tr></table>' +
        '<img src="https://example.com/a.png"><font color="red">서명</font></body></html>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('bgcolor="#eee"');
    expect(out).toContain('style="color:#00f"');
    expect(out).toContain('<img');
    expect(out).toContain('<font color="red">');
  });

  it('연접된 다중 문서의 본문을 모두 담는다', () => {
    const out = unwrapMailHtml(
      '<html><body><p>첫째</p></body></html><html><body><p>둘째</p></body></html>',
    );
    expect(out).toContain('첫째');
    expect(out).toContain('둘째');
  });

  it('빈 문자열·null 유사 입력에 빈 문자열을 반환한다', () => {
    expect(unwrapMailHtml('')).toBe('');
  });

  it('아웃바운드 하드닝 — on* 핸들러 속성을 제거한다', () => {
    const out = unwrapMailHtml('<body><p onmouseover="alert(1)">본문</p></body>');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('본문');
  });

  it('아웃바운드 하드닝 — javascript: href 를 제거한다(공백·대소문자 변형 포함)', () => {
    const out = unwrapMailHtml(
      '<body><a href=" JavaScript:alert(1) ">클릭</a><a href="https://example.com">정상</a></body>',
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('JavaScript:');
    expect(out).toContain('https://example.com');
  });

  it('아웃바운드 하드닝 — data:image/ src 는 보존하고 그 외 data: href 는 제거한다', () => {
    const out = unwrapMailHtml(
      '<body><img src="data:image/png;base64,AAA=">' +
        '<a href="data:text/html,<script>1</script>">링크</a></body>',
    );
    expect(out).toContain('data:image/png;base64,AAA=');
    expect(out).not.toContain('data:text/html');
  });

  it('아웃바운드 하드닝 — iframe/form/object/embed 를 제거한다', () => {
    const out = unwrapMailHtml(
      '<body><iframe src="https://evil.example"></iframe>' +
        '<form action="/x"><input></form><object></object><embed></embed><p>본문</p></body>',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<embed');
    expect(out).toContain('<p>본문</p>');
  });
});

describe('buildQuote — 답장', () => {
  it('blockquote 로 감싸고 작성자 헤더를 붙인다', () => {
    const q = buildQuote({ ...detail, bodyHtml: '<html><body><p>원문</p></body></html>' }, 'reply');
    expect(q.html.startsWith('<blockquote>')).toBe(true);
    expect(q.html).toContain('박지원 님이 작성:');
    expect(q.html).toContain('<p>원문</p>');
    expect(q.html).not.toContain('<html');
  });

  it('앞에 빈 p 를 붙이지 않는다 (에디터 밖이므로 불필요)', () => {
    const q = buildQuote({ ...detail, bodyHtml: '<p>원문</p>' }, 'reply');
    expect(q.html).not.toContain('<p></p>');
  });

  it('bodyHtml 이 없으면 bodyText 를 escape 해 pre 로 감싼다', () => {
    const q = buildQuote({ ...detail, bodyText: 'a < b & c' }, 'reply');
    expect(q.html).toContain('<pre>a &lt; b &amp; c</pre>');
  });

  it('text 는 각 줄에 > 접두를 붙인다', () => {
    const q = buildQuote({ ...detail, bodyText: '첫 줄\n둘째 줄' }, 'reply');
    expect(q.text).toContain('박지원 님이 작성:');
    expect(q.text).toContain('> 첫 줄');
    expect(q.text).toContain('> 둘째 줄');
  });

  it('bodyText 가 없으면 bodyHtml 에서 텍스트를 추출한다', () => {
    const q = buildQuote({ ...detail, bodyHtml: '<p>추출된 문장</p>' }, 'reply');
    expect(q.text).toContain('추출된 문장');
  });

  it('meta 에 발신자·제목·날짜 2종을 담는다', () => {
    const q = buildQuote({ ...detail, bodyHtml: '<p>x</p>' }, 'reply');
    expect(q.meta.from).toBe('박지원');
    expect(q.meta.subject).toBe('4분기 인프라 예산 재검토 요청');
    expect(q.meta.date).not.toBe('');
    // 칩용 짧은 표기는 시:분을 포함하지 않는다(칩 오버플로 방지).
    expect(q.meta.dateShort).not.toBe('');
    expect(q.meta.dateShort.length).toBeLessThan(q.meta.date.length);
  });

  it('fromName 이 없으면 fromAddress 를 표시명으로 쓴다', () => {
    const q = buildQuote({ ...detail, fromName: '', bodyHtml: '<p>x</p>' }, 'reply');
    expect(q.meta.from).toBe('jiwon.park@example.com');
  });

  it('text 추출 시 body 안 style 내용이 새지 않는다 (textContent 는 style 텍스트도 포함하므로 언랩 필수)', () => {
    const q = buildQuote(
      { ...detail, bodyHtml: '<html><body><style>p{color:red}</style><p>본문</p></body></html>' },
      'reply',
    );
    expect(q.text).not.toContain('p{color:red}');
    expect(q.text).toContain('본문');
  });

  it('text 추출 시 블록 요소 경계에 개행/탭 구분자를 넣는다 (textContent 는 구분자가 없어 한 줄로 붙는다)', () => {
    const q = buildQuote(
      {
        ...detail,
        bodyHtml: '<p>첫째</p><p>둘째</p><table><tr><td>A</td><td>B</td></tr></table>',
      },
      'reply',
    );
    const lines = q.text.split('\n');
    const firstIdx = lines.findIndex((l) => l.includes('첫째'));
    const secondIdx = lines.findIndex((l) => l.includes('둘째'));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    // A/B 는 같은 줄이라도 탭(혹은 공백) 구분자로 붙어 있으면 안 된다("AB" 로 붙지 않는다).
    expect(q.text).not.toContain('AB');
    expect(q.text).toMatch(/A[\t ]+B|A\n.*B/);
  });
});

describe('buildQuote — sentAt null', () => {
  it('date/dateShort 는 빈 문자열이다', () => {
    const q = buildQuote({ ...detail, sentAt: null, bodyHtml: '<p>x</p>' }, 'reply');
    expect(q.meta.date).toBe('');
    expect(q.meta.dateShort).toBe('');
  });

  it('전달 헤더에서 날짜 줄 자체를 생략한다', () => {
    const q = buildQuote({ ...detail, sentAt: null, bodyHtml: '<p>x</p>' }, 'forward');
    expect(q.html).not.toContain('날짜:');
    expect(q.text).not.toContain('날짜:');
  });
});

describe('buildQuote — 전달', () => {
  it('전달 헤더 블록을 쓰고 작성자 문구를 쓰지 않는다', () => {
    const q = buildQuote({ ...detail, bodyHtml: '<p>원문</p>' }, 'forward');
    expect(q.html).toContain('---------- 전달된 메일 ----------');
    expect(q.html).not.toContain('님이 작성:');
    expect(q.html).toContain('4분기 인프라 예산 재검토 요청');
  });

  it('text 에 > 접두를 쓰지 않는다', () => {
    const q = buildQuote({ ...detail, bodyText: '첫 줄' }, 'forward');
    expect(q.text).toContain('---------- 전달된 메일 ----------');
    expect(q.text).not.toContain('> 첫 줄');
    expect(q.text).toContain('첫 줄');
  });

  it('text 추출 시 body 안 style 내용이 새지 않는다', () => {
    const q = buildQuote(
      { ...detail, bodyHtml: '<html><body><style>p{color:red}</style><p>본문</p></body></html>' },
      'forward',
    );
    expect(q.text).not.toContain('p{color:red}');
    expect(q.text).toContain('본문');
  });
});
