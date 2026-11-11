// manual:check 도움말 검사(help-check)·화면 소스 data-help 수집(help-screen) 테스트(WP-1504 Task 4).
// 검사 표지마다 실패 예시를 하나 이상 두고, 표기가 모두 올바른 픽스처는 오류가 없어야 한다(계획 Task 4 표).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { helpErrors } from './lib/help-check.mjs';
import { DATA_HELP_PATTERNS, extractDataHelp, collectDataHelp } from './lib/help-screen.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { BOOKS } from './lib/books.mjs';

// 장 픽스처(loadChapters 결과와 같은 모양, raw 없음 → 줄 번호는 본문 기준). lines 는 본문 줄 배열.
const mk = (number, slug, lines) => ({
  file: `${String(number).padStart(2, '0')}-${slug}.md`,
  number,
  meta: { slug, title: slug, audience: ['member'], routes: [] },
  body: lines.join('\n'),
});

const errs = (chapters, opts) => helpErrors(chapters, opts).errors;
// 오류 줄 가운데 표지·위치로 시작하는 것이 있는지 본다(메시지 뒷부분은 자유).
const hasErr = (errors, label, at) => errors.some((e) => e.startsWith(`[${label}] ${at}`));

const FENCE = '```';

// 표기를 고루 쓴 올바른 픽스처 — 어떤 검사에도 걸리지 않아야 한다.
const good = [
  mk(1, 'a', [
    '# 알파 {help=a label=알파}',
    '',
    '첫머리. 아이디는 {agent.username} 이고 `{app.origin}/x` 를 연다. 셸 `${HOME}` 과 JSON `{"k":1}`, 탈출 \\{agent.username}.',
    '',
    '## 화면 {help=a.view label=화면}',
    '',
    '{if app.customMcpServer}',
    '- 주소 {app.mcpEndpoint}',
    '{/if}',
    '',
    '한 줄 {if app.customMcpServer}조건{/if} 끝.',
    '',
    '[베타](02-b.md#b.one) [같은 장](#그냥-절) [장](02-b.md) [첫머리](#a)',
    '',
    `${FENCE}json`,
    '{"a": {"b": 1}}',
    'echo ${agent.username} {app.origin}',
    FENCE,
    '',
    '### 세부 {help=a.view.detail label=세부}',
    '',
    '세부 글.',
    '',
    '## 그냥 절',
    '',
    '![그림](shots/user/s1.png){marks=one}',
  ]),
  mk(2, 'b', ['# 베타', '', '## 하나 {help=b.one label=하나}', '', '글.']),
];

test('helpErrors: 표기가 모두 올바르면 오류·정보 없음', () => {
  const r = helpErrors(good, { screen: { ids: [{ id: 'a.view', file: 'x.tsx', line: 3 }], dynamic: 0 }, figureState: { missing: [], stale: [] } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.info, []);
});

test('[도움말 id 중복] 두 위치를 모두 보인다', () => {
  const e = errs([mk(1, 'a', ['# A', '', '## A {help=x}']), mk(2, 'b', ['# B', '', '## B {help=x}'])]);
  assert.ok(hasErr(e, '도움말 id 중복', '02-b.md:3'), e.join('\n'));
  assert.ok(e.find((l) => l.startsWith('[도움말 id 중복]')).includes('01-a.md:3'));
});

test('[도움말 표시 오류] 대문자·빈 마디·속성 오타·빈 label', () => {
  const e = errs([mk(1, 'a', ['# A', '## A {help=Agent}', '## B {help=a..b}', '## C {help=a lable=b}', '## D {help=a label=}'])]);
  for (const n of [2, 3, 4, 5]) assert.ok(hasErr(e, '도움말 표시 오류', `01-a.md:${n}`), `${n}\n${e.join('\n')}`);
});

test('[도움말 표시 위치] 본문 줄·제목 가운데의 표시', () => {
  const e = errs([mk(1, 'a', ['# A', '', '설명 {help=a}', '', '## 제목 {help=b} 뒤에 글'])]);
  assert.ok(hasErr(e, '도움말 표시 위치', '01-a.md:3'), e.join('\n'));
  assert.ok(hasErr(e, '도움말 표시 위치', '01-a.md:5'), e.join('\n'));
});

test('[도움말 층 어긋남] 형제 절에 하위 id, 하위 절에 남의 id', () => {
  const e = errs([
    mk(1, 'a', ['# A', '', '## R {help=agent.run}', '', '## Q {help=agent.run.repo}', '', '### S {help=other}']),
  ]);
  assert.ok(hasErr(e, '도움말 층 어긋남', '01-a.md:5'), e.join('\n'));
  assert.ok(hasErr(e, '도움말 층 어긋남', '01-a.md:7'), e.join('\n'));
  assert.ok(!hasErr(e, '도움말 층 어긋남', '01-a.md:3'));
});

test('[절 링크 없음] 없는 절·없는 id·다른 장 id', () => {
  const a = mk(1, 'a', ['# A', '', '## 절 {help=a}']);
  const b = mk(2, 'b', ['# B', '', '[x](02-b.md#없는-절)', '[x](#nope.id)', '[x](02-b.md#a)']);
  const e = errs([a, b]);
  for (const n of [3, 4, 5]) assert.ok(hasErr(e, '절 링크 없음', `02-b.md:${n}`), `${n}\n${e.join('\n')}`);
});

test('[자리표시 없음] 산문의 목록 밖 이름은 오류, 코드(인라인·펜스) 안은 JSX·템플릿 글자라 오류 아님', () => {
  const e = errs([mk(1, 'a', ['# A', '', '값 {agent.name}', '코드 `{props.title}`', FENCE, 'x {item.name}', FENCE])]);
  assert.ok(hasErr(e, '자리표시 없음', '01-a.md:3'), e.join('\n'));
  for (const n of [4, 6]) assert.ok(!e.some((x) => x.includes(`01-a.md:${n}`)), `${n}\n${e.join('\n')}`);
});

test('[자리표시 위치] 제목·그림 지시문 alt 안의 자리표시', () => {
  const e = errs([mk(1, 'a', ['# A', '', '## {agent.username} 설정', '', '![{agent.username} 화면](shots/user/s1.png){marks=one}'])]);
  assert.ok(hasErr(e, '자리표시 위치', '01-a.md:3'), e.join('\n'));
  assert.ok(hasErr(e, '자리표시 위치', '01-a.md:5'), e.join('\n'));
  // 그림 지시문의 속성 중괄호({marks=…})는 표기가 아니다
  assert.ok(!hasErr(e, '알 수 없는 표기', '01-a.md:5'), e.join('\n'));
});

test('[알 수 없는 표기] 산문의 {foo}·이름 없는 {if}', () => {
  const e = errs([mk(1, 'a', ['# A', '', '값 {foo}', '조건 {if}글'])]);
  assert.ok(hasErr(e, '알 수 없는 표기', '01-a.md:3'), e.join('\n'));
  assert.ok(hasErr(e, '알 수 없는 표기', '01-a.md:4'), e.join('\n'));
});

test('HTML 주석 안의 중괄호는 표기가 아니다(한 줄·여러 줄), 닫히지 않은 <!-- 와 코드 안 <!-- 는 주석이 아니다', () => {
  const ok = errs([mk(1, 'a', ['# A', '', '글 <!-- {foo} {if nope} {help=x} --> 끝', '', '<!--', '{if app.customMcpServer}', '{foo}', '-->', ''])]);
  assert.deepEqual(ok, []);
  const e = errs([mk(1, 'a', ['# A', '', '글 <!-- {foo}', '', '`<!--` {bar} -->'])]);
  assert.ok(hasErr(e, '알 수 없는 표기', '01-a.md:3'), e.join('\n'));
  assert.ok(hasErr(e, '알 수 없는 표기', '01-a.md:5'), e.join('\n'));
});

test('[조건 블록] 닫히지 않음·짝 없는 닫기·중첩·펜스 안·제목 넘김·목록에 없는 조건', () => {
  const cases = [
    ['닫히지 않음', ['# A', '', '## S', '{if app.customMcpServer}', '글'], 4],
    ['짝 없는 닫기', ['# A', '', '글', '{/if}'], 4],
    ['중첩', ['# A', '', '{if app.customMcpServer}', '{if app.customMcpServer}', '{/if}', '{/if}'], 4],
    ['펜스 안', ['# A', '', FENCE, '{if app.customMcpServer}', FENCE], 4],
    ['제목 넘김', ['# A', '', '{if app.customMcpServer}', '## 다음', '{/if}'], 5],
    ['목록에 없는 조건', ['# A', '', '{if app.other}글{/if}'], 3],
  ];
  for (const [name, lines, n] of cases) {
    const e = errs([mk(1, 'a', lines)]);
    assert.ok(hasErr(e, '조건 블록', `01-a.md:${n}`), `${name}\n${e.join('\n')}`);
  }
});

test('[예약 slug] `_` 로 시작하는 제목', () => {
  const e = errs([mk(1, 'a', ['# A', '', '## _숨김'])]);
  assert.ok(hasErr(e, '예약 slug', '01-a.md:3'), e.join('\n'));
});

test('[data-help 형식]·[data-help 짝 없음]·[data-help 동적]', () => {
  const screen = {
    ids: [
      { id: 'Agent Run', file: 'apps/x.tsx', line: 5 },
      { id: 'agent.run', file: 'apps/y.tsx', line: 7 },
      { id: 'b.one', file: 'apps/z.tsx', line: 9 },
    ],
    dynamic: 2,
  };
  const r = helpErrors(good, { screen });
  assert.ok(r.errors.includes('[data-help 형식] Agent Run (apps/x.tsx:5)'), r.errors.join('\n'));
  assert.ok(r.errors.includes('[data-help 짝 없음] agent.run (apps/y.tsx:7)'), r.errors.join('\n'));
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.info, ['[data-help 동적] 2곳 — 정적 검사 밖']);
});

test('[도움말 그림 없음]·[도움말 그림 오래됨] 은 그림 지시문 위치로', () => {
  const ch = mk(1, 'a', ['# A', '', '![g](shots/user/s1.png){marks=one}', '', '![h](shots/user/s2.png)']);
  const e = errs([ch], { figureState: { missing: ['s1'], stale: ['s2'] } });
  assert.ok(hasErr(e, '도움말 그림 없음', '01-a.md:3 s1'), e.join('\n'));
  assert.ok(hasErr(e, '도움말 그림 오래됨', '01-a.md:5 s2'), e.join('\n'));
  // figureState 를 주지 않으면(운영자 책) 그림 검사는 하지 않는다
  assert.deepEqual(errs([ch]), []);
});

test('프론트매터를 포함한 raw 가 있으면 파일 기준 줄 번호', () => {
  const ch = { ...mk(1, 'a', ['# A', '', '값 {foo}']), raw: '---\nslug: a\n---\n# A\n\n값 {foo}' };
  assert.ok(hasErr(errs([ch]), '알 수 없는 표기', '01-a.md:6'));
});

test('실제 매뉴얼(두 책)은 도움말 표기 오류가 없다', async () => {
  for (const book of [BOOKS.user, BOOKS.operator]) {
    const e = errs(await loadChapters(book));
    assert.deepEqual(e, [], `${book.key}\n${e.join('\n')}`);
  }
});

test('extractDataHelp: 네 가지 정적 꼴과 동적 꼴', () => {
  const src = [
    '<div data-help="agent.run">',
    "<A data-help={'agent.run.repo'} />",
    '<B data-help={"b.one"} />',
    '<C data-help={`c.two`} />',
    '<D data-help={id} />',
    '<E data-help={`a.${x}`} />',
  ].join('\n');
  const r = extractDataHelp(src);
  assert.deepEqual(r.ids, [
    { id: 'agent.run', line: 1 },
    { id: 'agent.run.repo', line: 2 },
    { id: 'b.one', line: 3 },
    { id: 'c.two', line: 4 },
  ]);
  assert.equal(r.dynamic, 2);
  assert.ok(DATA_HELP_PATTERNS.includes('data-help'));
  assert.deepEqual(extractDataHelp('const x = 1;'), { ids: [], dynamic: 0 });
});

test('extractDataHelp: 같은 줄 여러 개·빈 줄 건너뜀·CRLF 도 줄 번호가 맞다(한 번 훑으며 센다)', () => {
  const src = ['<A data-help="a.one" /><B data-help="a.two" />', '', '', "<C\r", "  data-help={'a.three'}", ''].join('\n');
  assert.deepEqual(extractDataHelp(src).ids, [
    { id: 'a.one', line: 1 },
    { id: 'a.two', line: 1 },
    { id: 'a.three', line: 5 },
  ]);
});

test('extractDataHelp: JSX 홑따옴표 값·`=` 둘레 공백도 정적 꼴', () => {
  const src = [
    "<A data-help='agent.run' />",
    '<B data-help = "b.one" />',
    "<C data-help ={ 'c.two' } />",
    '<D data-help= {`d.three`} />',
    '<E data-help = {id} />',
  ].join('\n');
  const r = extractDataHelp(src);
  assert.deepEqual(r.ids, [
    { id: 'agent.run', line: 1 },
    { id: 'b.one', line: 2 },
    { id: 'c.two', line: 3 },
    { id: 'd.three', line: 4 },
  ]);
  assert.equal(r.dynamic, 1);
});

test('collectDataHelp: .ts·.tsx 만, 테스트 파일 제외, 파일은 base 기준 상대', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'help-screen-'));
  t.after(() => rm(dir, { recursive: true, force: true })); // 임시 폴더를 남기지 않는다
  const src = path.join(dir, 'src');
  await mkdir(path.join(src, 'pages', '__tests__'), { recursive: true });
  await writeFile(path.join(src, 'pages', 'A.tsx'), 'x\n<div data-help="a.b" />');
  await writeFile(path.join(src, 'pages', 'A.test.tsx'), '<div data-help="t.t" />');
  await writeFile(path.join(src, 'pages', '__tests__', 'B.tsx'), '<div data-help="t.u" />');
  await writeFile(path.join(src, 'c.ts'), 'h({ "data-help": 1 }); <i data-help={v} />');
  await writeFile(path.join(src, 'd.css'), '[data-help="css.x"] {}');
  const r = await collectDataHelp(src, { base: dir });
  assert.deepEqual(r.ids, [{ id: 'a.b', file: 'src/pages/A.tsx', line: 2 }]);
  assert.equal(r.dynamic, 1);
});
