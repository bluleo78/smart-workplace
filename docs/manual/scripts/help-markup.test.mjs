// 도움말 표기(제목 끝 `{help=…}` 표시·`{agent.username}` 같은 자리표시·`{if …}…{/if}` 조건 블록) 해석과
// PDF 변환(applyHelpMarkupForPdf) 테스트. 표기 규칙은 docs/superpowers/specs/help-panel-design.md 9·14절, 계획 WP-1504 Task 1.
import { test } from 'node:test';
import { marked } from 'marked';
import assert from 'node:assert/strict';
import {
  HELP_ID_RE,
  parseHeading,
  braceTokens,
  splitProseLines,
  applyHelpMarkupForPdf,
} from './lib/help-markup.mjs';
import { PLACEHOLDERS, CONDITIONS, placeholderLabel } from './lib/help-vars.mjs';

const TAG = '<span class="cond-tag">(기본 주소가 아닌 서버만)</span>';

test('help-vars: 자리표시·조건 목록과 PDF 표시 이름', () => {
  assert.equal(PLACEHOLDERS['agent.username'].display, 'AI 아이디');
  assert.equal(PLACEHOLDERS['app.mcpEndpoint'].display, 'MCP 주소');
  assert.equal(PLACEHOLDERS['app.origin'].display, '앱 주소');
  assert.equal(CONDITIONS['app.customMcpServer'].tag, '(기본 주소가 아닌 서버만)');
  assert.equal(placeholderLabel('agent.username'), '<AI 아이디>');
  assert.equal(placeholderLabel('agent.nope'), '<agent.nope>');
});

test('HELP_ID_RE: 소문자·숫자·하이픈 마디를 점으로 잇는다', () => {
  for (const ok of ['agent', 'agent.run.repo', 'mail-2.x']) assert.match(ok, HELP_ID_RE);
  for (const bad of ['Agent', 'a..b', 'a_b', '', '.a', 'a.']) assert.doesNotMatch(bad, HELP_ID_RE);
});

test('parseHeading: 표시가 있는 제목', () => {
  assert.deepEqual(parseHeading('### 저장소 토큰을 연결한다 {help=agent.run.repo label=저장소 연결}'), {
    level: 3,
    title: '저장소 토큰을 연결한다',
    id: 'agent.run.repo',
    label: '저장소 연결',
  });
  assert.deepEqual(parseHeading('## 실행 {help=agent.run}'), { level: 2, title: '실행', id: 'agent.run', label: null });
});

test('parseHeading: 표시가 없는 제목과 본문 줄', () => {
  assert.deepEqual(parseHeading('# AI 에이전트 관리'), { level: 1, title: 'AI 에이전트 관리', id: null, label: null });
  assert.equal(parseHeading('본문 줄 {help=a}'), null);
  assert.equal(parseHeading('#해시태그'), null);
});

test('parseHeading: 잘못된 표시는 error 를 채운다', () => {
  for (const line of ['## A {help=Agent.Run}', '## A {help=a..b}', '## A {help=a lable=b}', '## A {help=a label=}', '## A {help=}']) {
    const h = parseHeading(line);
    assert.ok(h.error, line);
    assert.equal(h.id, null, line);
    assert.equal(h.title, 'A', line);
  }
});

test('braceTokens: 산문 토큰 종류와 순서', () => {
  const toks = braceTokens('값 {agent.username} 와 {if app.customMcpServer}x{/if}');
  assert.deepEqual(
    toks.map((t) => [t.kind, t.name]),
    [
      ['placeholder', 'agent.username'],
      ['if', 'app.customMcpServer'],
      ['endif', undefined],
    ],
  );
  assert.equal(toks[0].index, 2);
  assert.equal(toks[0].raw, '{agent.username}');
  assert.equal(braceTokens('{foo}')[0].kind, 'unknown');
  assert.equal(braceTokens('{if}')[0].kind, 'unknown');
  assert.equal(braceTokens('## A {help=a}')[0].kind, 'help');
});

test('braceTokens: 코드 안에서는 자리표시 꼴만, $·\\ 바로 뒤는 아니다', () => {
  assert.deepEqual(braceTokens('echo ${agent.username} {"a":1}', { inCode: true }), []);
  assert.deepEqual(braceTokens('{foo} {if app.customMcpServer}', { inCode: true }), []);
  const [t] = braceTokens('{app.origin}', { inCode: true });
  assert.equal(t.kind, 'placeholder');
  assert.equal(t.name, 'app.origin');
  assert.deepEqual(braceTokens('\\{agent.username}'), []);
});

test('braceTokens: 코드 안에서는 목록(PLACEHOLDERS)에 있는 이름만 자리표시다 — JSX·템플릿 글자는 그대로', () => {
  assert.deepEqual(braceTokens('<h1>{props.title}</h1> {item.name}', { inCode: true }), []);
  const [t] = braceTokens('{props.title} {agent.username}', { inCode: true });
  assert.equal(t.name, 'agent.username');
  // 산문에서는 목록 밖 이름도 자리표시 꼴로 돌려준다(검사가 [자리표시 없음] 으로 막는다)
  assert.equal(braceTokens('{props.title}')[0].kind, 'placeholder');
});

test('applyHelpMarkupForPdf: 코드 안 목록 밖 {이름.이름} 은 글자 그대로(인라인·펜스)', () => {
  assert.equal(applyHelpMarkupForPdf('JSX `<h1>{props.title}</h1>` 예'), 'JSX `<h1>{props.title}</h1>` 예');
  const fence = '```jsx\nreturn <p>{item.name} {agent.username}</p>\n```';
  assert.equal(applyHelpMarkupForPdf(fence), '```jsx\nreturn <p>{item.name} <AI 아이디></p>\n```');
});

test('splitProseLines: 한 줄의 인라인 코드는 백틱 개수 짝으로 나눈다', () => {
  const one = (line) => splitProseLines([line])[0];
  assert.deepEqual(one('a `b` c'), [
    { text: 'a ', code: false, comment: false },
    { text: '`b`', code: true, comment: false },
    { text: ' c', code: false, comment: false },
  ]);
  assert.deepEqual(one('x ``a ` b`` y'), [
    { text: 'x ', code: false, comment: false },
    { text: '``a ` b``', code: true, comment: false },
    { text: ' y', code: false, comment: false },
  ]);
  // 짝 없는 백틱은 글자 그대로
  assert.deepEqual(one('a ` b'), [{ text: 'a ` b', code: false, comment: false }]);
});

test('applyHelpMarkupForPdf: 표기가 없으면 같은 문자열을 그대로', () => {
  const body = '## 제목\n\n본문 `{"a":1}` 과 ${HOME}\n\n```\n{"x": {"y": 1}}\n```\n';
  assert.equal(applyHelpMarkupForPdf(body), body);
});

test('applyHelpMarkupForPdf: 제목 끝 표시를 지운다', () => {
  assert.equal(applyHelpMarkupForPdf('## 제목 {help=a}\n본문'), '## 제목\n본문');
  assert.equal(applyHelpMarkupForPdf('# 장 {help=agents label=에이전트}\n본문'), '# 장\n본문');
  // 잘못된 표시는 지우지 않는다(검사가 막는다)
  assert.equal(applyHelpMarkupForPdf('## 제목 {help=A}\n'), '## 제목 {help=A}\n');
  // 펜스 안 제목 꼴은 건드리지 않는다
  const fenced = '```\n## 제목 {help=a}\n```\n';
  assert.equal(applyHelpMarkupForPdf(fenced), fenced);
});

test('applyHelpMarkupForPdf: 자리표시를 표시 이름으로(산문·인라인 코드·펜스)', () => {
  assert.equal(applyHelpMarkupForPdf('아이디는 {agent.username} 이다'), '아이디는 &lt;AI 아이디&gt; 이다');
  assert.equal(applyHelpMarkupForPdf('명령 `{agent.username}` 입력'), '명령 `<AI 아이디>` 입력');
  assert.equal(
    applyHelpMarkupForPdf('```\ncurl {app.origin}/claude/marketplace.json\n```'),
    '```\ncurl <앱 주소>/claude/marketplace.json\n```',
  );
  // 코드 안 ${…}·JSON 은 그대로
  assert.equal(applyHelpMarkupForPdf('`${agent.username} {"a":1}` {app.origin}'), '`${agent.username} {"a":1}` &lt;앱 주소&gt;');
});

test('applyHelpMarkupForPdf: 한 줄 조건 블록 → 꼬리표', () => {
  assert.equal(
    applyHelpMarkupForPdf('앞 {if app.customMcpServer}서버 주소를 넣는다{/if} 뒤'),
    `앞 ${TAG} 서버 주소를 넣는다 뒤`,
  );
});

test('applyHelpMarkupForPdf: 줄 단위 조건 블록 → 꼬리표 줄 + 빈 줄', () => {
  const body = ['1. 첫 단계', '   {if app.customMcpServer}', '   추가 단계', '   {/if}', '2. 둘째 단계'].join('\n');
  assert.equal(
    applyHelpMarkupForPdf(body),
    // 닫는 줄 뒤가 목록 항목이고 앞이 목록 문맥이면 닫는 줄을 지운다(빈 줄로 남겨도 이 경우 marked HTML 은 같다 — 이미 느슨한 목록).
    ['1. 첫 단계', '', `   ${TAG}`, '', '   추가 단계', '2. 둘째 단계'].join('\n'),
  );
});

test('applyHelpMarkupForPdf: 번호 목록 사이의 들여쓰지 않은 줄 단위 조건 블록은 목록을 끊지 않는다(<ol> 하나)', () => {
  const body = ['1. 첫 단계', '{if app.customMcpServer}', '2. 추가 단계', '{/if}', '3. 셋째 단계'].join('\n');
  const out = applyHelpMarkupForPdf(body);
  // 꼬리표는 블록의 첫 항목 앞에 붙고, 여닫는 줄은 사라진다(빈 줄이 생기면 목록이 느슨해지거나 끊긴다).
  assert.equal(out, ['1. 첫 단계', `2. ${TAG} 추가 단계`, '3. 셋째 단계'].join('\n'));
  const html = marked.parse(out);
  assert.equal(html.match(/<ol/g).length, 1, html);
  assert.equal(html.match(/<li>/g).length, 3, html);
});

test('applyHelpMarkupForPdf: 문단 뒤 줄 단위 조건 블록이 목록으로 시작하면 빈 줄로 문단과 떼고 꼬리표는 첫 항목에', () => {
  const body = ['문단', '{if app.customMcpServer}', '1. 단계', '{/if}', '', '뒤 문단'].join('\n');
  const out = applyHelpMarkupForPdf(body);
  assert.equal(out, ['문단', '', `1. ${TAG} 단계`, '', '', '뒤 문단'].join('\n'));
  assert.match(marked.parse(out), /<p>문단<\/p>\s*<ol>\s*<li><span class="cond-tag">/);
});

test('applyHelpMarkupForPdf: 닫히지 않은 조건 블록은 줄 번호와 함께 던진다', () => {
  assert.throws(() => applyHelpMarkupForPdf('본문\n\n{if app.customMcpServer}\n글\n'), /3번째 줄/);
  assert.throws(() => applyHelpMarkupForPdf('앞 {if app.customMcpServer} 글'), /1번째 줄/);
});

test('applyHelpMarkupForPdf: CRLF 줄도 제목 표시를 지우고 줄 끝을 지킨다', () => {
  assert.equal(applyHelpMarkupForPdf('## 제목 {help=a}\r\n본문\r\n'), '## 제목\r\n본문\r\n');
});

test('applyHelpMarkupForPdf: CRLF 줄 단위 조건 블록도 꼬리표 줄로, 줄 끝 CR 을 지킨다', () => {
  const tag = '<span class="cond-tag">(기본 주소가 아닌 서버만)</span>';
  const out = applyHelpMarkupForPdf('a\r\n{if app.customMcpServer}\r\nb\r\n{/if}\r\nc');
  assert.equal(out, `a\r\n\r\n${tag}\r\n\r\nb\r\n\r\nc`);
  // 블록이 목록 항목으로 시작하면 꼬리표는 항목 글 앞에 — 그 줄의 CR 도 지킨다.
  assert.equal(applyHelpMarkupForPdf('a\r\n{if app.customMcpServer}\r\n- b\r\n{/if}\r\nc'), `a\r\n\r\n- ${tag} b\r\n\r\nc`);
});

test('applyHelpMarkupForPdf: 산문의 \\{agent.username} 은 탈출이라 그대로 둔다', () => {
  const body = '값은 \\{agent.username} 입니다';
  assert.equal(applyHelpMarkupForPdf(body), body);
});

test('splitProseLines: 인라인 코드·HTML 주석 조각을 나누고 펜스 줄은 null', () => {
  const lines = ['a <!-- {x} --> b `c` d', '```', '<!-- 펜스 -->', '```', '`<!--` 는 코드', '<!-- 여러', '{if app.customMcpServer}', '줄 --> 끝'];
  assert.deepEqual(splitProseLines(lines), [
    [
      { text: 'a ', code: false, comment: false },
      { text: '<!-- {x} -->', code: false, comment: true },
      { text: ' b ', code: false, comment: false },
      { text: '`c`', code: true, comment: false },
      { text: ' d', code: false, comment: false },
    ],
    null,
    null,
    null,
    [
      { text: '`<!--`', code: true, comment: false },
      { text: ' 는 코드', code: false, comment: false },
    ],
    [{ text: '<!-- 여러', code: false, comment: true }],
    [{ text: '{if app.customMcpServer}', code: false, comment: true }],
    [
      { text: '줄 -->', code: false, comment: true },
      { text: ' 끝', code: false, comment: false },
    ],
  ]);
  // 닫는 `-->` 가 끝까지 없으면 주석이 아니라 글자 그대로(검사가 그 뒤 표기를 놓치지 않게)
  assert.deepEqual(splitProseLines(['a <!-- {x}', 'b']), [
    [{ text: 'a <!-- {x}', code: false, comment: false }],
    [{ text: 'b', code: false, comment: false }],
  ]);
  // 줄 가운데 <!-- (인라인 HTML)는 빈 줄을 넘어 닫히지 않는다 — 문단이 끝나므로 글자 그대로
  assert.deepEqual(splitProseLines(['a <!-- {x}', '', '-->']), [
    [{ text: 'a <!-- {x}', code: false, comment: false }],
    [],
    [{ text: '-->', code: false, comment: false }],
  ]);
  // 줄 가운데 <!-- 라도 같은 문단 다음 줄에서 닫히면 주석
  assert.deepEqual(splitProseLines(['a <!-- {x}', 'y --> b']), [
    [
      { text: 'a ', code: false, comment: false },
      { text: '<!-- {x}', code: false, comment: true },
    ],
    [
      { text: 'y -->', code: false, comment: true },
      { text: ' b', code: false, comment: false },
    ],
  ]);
  // 주석 안의 백틱은 코드가 아니다
  assert.deepEqual(splitProseLines(['<!-- `a --> b`']), [
    [
      { text: '<!-- `a -->', code: false, comment: true },
      { text: ' b`', code: false, comment: false },
    ],
  ]);
});

test('applyHelpMarkupForPdf: HTML 주석 안의 표기는 바꾸지 않는다(한 줄·여러 줄)', () => {
  const one = '앞 <!-- {agent.username} {if app.customMcpServer} {foo} --> 뒤';
  assert.equal(applyHelpMarkupForPdf(one), one);
  const multi = ['글', '<!--', '{if app.customMcpServer}', '{agent.username}', '-->', '끝'].join('\n');
  assert.equal(applyHelpMarkupForPdf(multi), multi);
  // 주석 밖 표기는 그대로 바꾼다
  assert.equal(applyHelpMarkupForPdf('<!-- {agent.username} --> {agent.username}'), '<!-- {agent.username} --> &lt;AI 아이디&gt;');
});
