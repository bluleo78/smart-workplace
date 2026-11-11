// 매뉴얼 도움말 묶음(manual-index.json·manual/<chapter>.json·manual-vars.json) 생성 테스트(WP-1504 Task 2).
// 형식은 docs/superpowers/specs/help-panel-design.md 14절 계약(필드 이름 고정, 추가만 허용)과 계획의 「내가 정한 것」 6~12·16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  headingSlug,
  splitSections,
  buildHelpBundle,
  validateBundle,
  writeHelpBundle,
  collectFigures,
  HELP_BUNDLE_FILES,
} from './lib/help-bundle.mjs';
import { sectionLinks } from './lib/markdown.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { BOOKS } from './lib/books.mjs';

// 장 픽스처(loadChapters 결과와 같은 모양). raw 를 주면 파일 기준 줄 번호를 계산한다.
const mk = (number, slug, title, body, { audience = ['member'], routes = [] } = {}) => ({
  file: `${String(number).padStart(2, '0')}-${slug}.md`,
  number,
  meta: { slug, title, audience, routes },
  body,
});

const chA = mk(
  1,
  'alpha',
  '알파 장',
  [
    '',
    '# 알파 장',
    '',
    '알파 첫머리 글. [베타 장](02-beta.md) 을 본다.',
    '',
    '## 화면을 본다 {help=a label=알파 화면}',
    '',
    '값은 {agent.username} 입니다.',
    '',
    '{if app.customMcpServer}',
    '- 기본 주소가 아닐 때만',
    '{/if}',
    '',
    '![알파 그림](shots/user/s1.png){marks=one,two,three}',
    '',
    '1. **첫** 단추를 누릅니다. 그러면 열립니다.',
    '2. `둘째` 항목입니다',
    '',
    '[베타 절](02-beta.md#베타-절) 과 [하위](#a.b) 와 [베타 절](02-beta.md#베타-절) 와 [자기](#a) 그리고 [코드](../../apps/x.ts).',
    '',
    '```md',
    '## 가짜 제목',
    '```',
    '',
    '### 세부 {help=a.b label=세부}',
    '',
    '세부 글.',
    '',
    '### 이름 없는 절',
    '',
    '#### 더 깊은 절 {help=a.b.c}',
    '',
    '깊은 글.',
    '',
    '## 같은 제목',
    '',
    '첫째.',
    '',
    '## 같은 제목',
    '',
    '둘째. ![작은 그림](shots/user/s1.png) 은 줄 전체가 아니라 그림 지시문이 아니다.',
    '',
  ].join('\n'),
);

const chB = mk(
  2,
  'beta',
  '베타 장',
  [
    '',
    '# 베타 장 {help=beta label=베타}',
    '',
    '베타 첫머리.',
    '',
    '## 베타 절',
    '',
    '[알파 화면](01-alpha.md#a) 과 [알파 장](01-alpha.md).',
    '',
    '![다시 쓴 그림](shots/user/s1.png){marks=one}',
    '',
  ].join('\n'),
  { audience: ['admin'], routes: ['/beta'] },
);

const byId = (bundle, id) => {
  for (const { json } of bundle.chapters) {
    const s = json.sections.find((x) => x.id === id);
    if (s) return s;
  }
  return undefined;
};

test('headingSlug: GitHub 규칙', () => {
  assert.equal(headingSlug('링크로 페이지를 공유한다'), '링크로-페이지를-공유한다');
  assert.equal(headingSlug('AI 와 함께 — 메일을 요약한다'), 'ai-와-함께--메일을-요약한다');
  assert.equal(headingSlug('**굵게** 와 `코드` 표시'), '굵게-와-코드-표시');
  assert.equal(headingSlug('「AI」 메뉴를 연다'), 'ai-메뉴를-연다');
});

test('sectionLinks: 장 링크·장 안 앵커를 꺼내고 그림은 뺀다', () => {
  const ls = sectionLinks('[a](02-b.md) [b](02-b.md#x-y) [c](#a.b) ![d](#no) [e](https://x.y)');
  assert.deepEqual(
    ls.map((l) => [l.text, l.file, l.anchor]),
    [
      ['a', '02-b.md', null],
      ['b', '02-b.md', 'x-y'],
      ['c', null, 'a.b'],
    ],
  );
});

test('splitSections: 첫머리 절·하위 절 제외·펜스 안 제목 무시·slug 중복', () => {
  const ss = splitSections(chA);
  assert.deepEqual(
    ss.map((s) => [s.level, s.title, s.id, s.slug]),
    [
      [1, '알파 장', null, '_intro'],
      [2, '화면을 본다', 'a', '화면을-본다'],
      [3, '세부', 'a.b', '세부'],
      [3, '이름 없는 절', null, '이름-없는-절'],
      [4, '더 깊은 절', 'a.b.c', '더-깊은-절'],
      [2, '같은 제목', null, '같은-제목'],
      [2, '같은 제목', null, '같은-제목-1'],
    ],
  );
  const a = ss[1];
  assert.ok(!a.body.join('\n').includes('세부 글'), '하위 절 본문은 빠진다');
  assert.ok(a.body.join('\n').includes('## 가짜 제목'), '펜스 안 제목은 본문에 남는다');
  assert.equal(a.body[0], '값은 {agent.username} 입니다.', '앞 빈 줄은 지운다');
  assert.notEqual(a.body[a.body.length - 1], '', '뒤 빈 줄은 지운다');
  assert.equal(a.line, 6);
});

test('splitSections: 파일 기준 줄 번호(프론트매터 포함)', () => {
  const raw = '---\nslug: alpha\ntitle: 알파 장\n---\n' + chA.body;
  const ss = splitSections({ ...chA, raw });
  assert.equal(ss[1].line, 10);
});

test('buildHelpBundle: 첫머리 절 id·title·label', () => {
  const b = buildHelpBundle([chA, chB]);
  const alpha = b.chapters[0].json;
  assert.equal(alpha.sections[0].id, 'alpha#_intro');
  assert.equal(alpha.sections[0].title, '알파 장');
  assert.equal(alpha.sections[0].label, '알파 장');
  assert.equal(alpha.sections[0].level, 1);
  const beta = b.chapters[1].json;
  assert.equal(beta.sections[0].id, 'beta');
  assert.equal(beta.sections[0].title, '베타 장');
  assert.equal(beta.sections[0].label, '베타');
});

test('buildHelpBundle: 장 머리 필드(chapter·number·title·routes·audience)', () => {
  const b = buildHelpBundle([chA, chB]);
  const beta = b.chapters[1];
  assert.equal(beta.chapter, 'beta');
  assert.deepEqual(
    { chapter: beta.json.chapter, number: beta.json.number, title: beta.json.title, routes: beta.json.routes, audience: beta.json.audience },
    { chapter: 'beta', number: 2, title: '베타 장', routes: ['/beta'], audience: ['admin'] },
  );
  assert.deepEqual(b.index.map((c) => c.chapter), ['alpha', 'beta']);
  assert.deepEqual(Object.keys(b.index[0].sections[0]).sort(), ['id', 'label', 'level', 'parent', 'title']);
});

test('buildHelpBundle: id 없는 절 id·label', () => {
  const b = buildHelpBundle([chA, chB]);
  const s = byId(b, 'alpha#같은-제목-1');
  assert.ok(s);
  assert.equal(s.label, '같은 제목');
  assert.equal(byId(b, 'a').label, '알파 화면');
});

test('buildHelpBundle: parent 는 가장 가까운 id 있는 위 절(id 없는 절은 건너뜀)', () => {
  const b = buildHelpBundle([chA, chB]);
  assert.equal(byId(b, 'a').parent, null);
  assert.equal(byId(b, 'a.b').parent, 'a');
  assert.equal(byId(b, 'alpha#이름-없는-절').parent, 'a');
  assert.equal(byId(b, 'a.b.c').parent, 'a', '사이의 id 없는 ### 는 건너뛴다');
  assert.equal(byId(b, 'beta#베타-절').parent, 'beta', '장 제목 줄에 id 가 있으면 첫머리 절이 parent');
});

test('buildHelpBundle: markdown 변환(자리표시·조건 유지, 그림·절 링크·저장소 링크)', () => {
  const b = buildHelpBundle([chA, chB]);
  const md = byId(b, 'a').markdown;
  assert.match(md, /값은 \{agent\.username\} 입니다\./);
  assert.match(md, /\{if app\.customMcpServer\}\n- 기본 주소가 아닐 때만\n\{\/if\}/);
  assert.match(md, /^!\[알파 그림\]\(figure:s1\)$/m);
  assert.match(md, /\[베타 절\]\(help:beta#베타-절\)/);
  assert.match(md, /\[하위\]\(help:a\.b\)/);
  assert.match(md, /그리고 코드\./);
  assert.ok(!md.includes('### 세부'), '제목 줄은 본문에 넣지 않는다');
  // 줄 전체가 아닌 그림 꼴 글자는 그림 지시문이 아니다(바꾸지 않음).
  assert.match(byId(b, 'alpha#같은-제목-1').markdown, /!\[작은 그림\]\(shots\/user\/s1\.png\)/);
});

test('buildHelpBundle: links — 순서·중복 제거·자기 제외·장 링크는 첫머리', () => {
  const b = buildHelpBundle([chA, chB]);
  assert.deepEqual(byId(b, 'a').links, ['beta#베타-절', 'a.b']);
  assert.deepEqual(byId(b, 'alpha#_intro').links, ['beta']);
  assert.deepEqual(byId(b, 'beta#베타-절').links, ['a', 'alpha#_intro']);
  assert.deepEqual(byId(b, 'a.b').links, []);
});

test('buildHelpBundle: figures — 표식 label 은 뒤 번호 목록 항목의 첫 문장, 짧으면 key', () => {
  const b = buildHelpBundle([chA, chB]);
  const [f] = byId(b, 'a').figures;
  assert.deepEqual(f, {
    id: 's1',
    src: 'figures/s1.png',
    alt: '알파 그림',
    marks: [
      { n: 1, label: '첫 단추를 누릅니다.', key: 'one' },
      { n: 2, label: '둘째 항목입니다', key: 'two' },
      { n: 3, label: 'three', key: 'three' },
    ],
  });
  // 같은 샷 두 번째 사용 → ~2
  const [g] = byId(b, 'beta#베타-절').figures;
  assert.equal(g.id, 's1~2');
  assert.equal(g.src, 'figures/s1~2.png');
  assert.deepEqual(byId(b, 'a.b').figures, []);
  assert.deepEqual(
    b.figures.map((x) => [x.id, x.shotId, x.src]),
    [
      ['s1', 's1', 'figures/s1.png'],
      ['s1~2', 's1', 'figures/s1~2.png'],
    ],
  );
  assert.deepEqual(b.problems, []);
});

test('buildHelpBundle: 표식 label 은 80자에서 자른다', () => {
  const long = '가'.repeat(100);
  const ch = mk(1, 'x', '엑스', `# 엑스\n\n![g](shots/user/g.png){marks=k}\n\n1. ${long}\n`);
  const b = buildHelpBundle([ch]);
  const label = b.chapters[0].json.sections[0].figures[0].marks[0].label;
  assert.ok(label.length <= 81, label);
  assert.ok(label.startsWith('가'.repeat(80)));
});

test('buildHelpBundle: 그림 PNG 가 없으면 그 그림만 빼고 figure-missing', () => {
  const b = buildHelpBundle([chA, chB], { figureAvailable: (id) => id !== 's1~2' });
  assert.deepEqual(byId(b, 'beta#베타-절').figures, []);
  assert.match(byId(b, 'beta#베타-절').markdown, /!\[다시 쓴 그림\]\(figure:s1~2\)/);
  assert.deepEqual(b.figures.map((x) => x.id), ['s1']);
  assert.equal(b.problems.length, 1);
  assert.equal(b.problems[0].kind, 'figure-missing');
  assert.equal(b.problems[0].file, '02-beta.md');
});

test('collectFigures: 책 전체 그림을 문서 순서로, 같은 샷 두 번째는 ~2', () => {
  assert.deepEqual(
    collectFigures([chA, chB]).map((f) => [f.id, f.file, f.fig.shotId]),
    [
      ['s1', '01-alpha.md', 's1'],
      ['s1~2', '02-beta.md', 's1'],
    ],
  );
});

test('buildHelpBundle: 같은 id 가 다른 장에 있으면 뒤의 것은 대체 id, 던지지 않는다', () => {
  const dup = mk(3, 'gamma', '감마 장', '# 감마 장\n\n## 감마 절 {help=a}\n\n글.\n');
  const b = buildHelpBundle([chA, chB, dup]);
  assert.equal(byId(b, 'a').title, '화면을 본다');
  assert.ok(byId(b, 'gamma#감마-절'));
  const p = b.problems.find((x) => x.kind === 'duplicate-id');
  assert.ok(p);
  assert.equal(p.file, '03-gamma.md');
  assert.match(p.message, /01-alpha\.md:6/);
  assert.deepEqual(validateBundle(b), []);
});

test('buildHelpBundle: 못 푼 링크는 글만 남기고 link-unresolved', () => {
  const ch = mk(1, 'x', '엑스', '# 엑스\n\n[없음](#없는-절) [장 없음](09-nope.md)\n');
  const b = buildHelpBundle([ch]);
  assert.equal(b.chapters[0].json.sections[0].markdown, '없음 장 없음');
  assert.deepEqual(b.problems.map((p) => p.kind), ['link-unresolved', 'link-unresolved']);
});

test('buildHelpBundle: 파일 없는 링크(#…)는 이 장 앵커가 먼저 — 같은 글자의 도움말 id 가 다른 장에 있어도', () => {
  const a = mk(1, 'p', '피', '# 피\n\n## 설정 {help=setup}\n\n글.\n');
  const b = mk(2, 'q', '큐', '# 큐\n\n[x](#setup)\n\n## setup\n\n글.\n');
  const bundle = buildHelpBundle([a, b]);
  assert.deepEqual(byId(bundle, 'q#_intro').links, ['q#setup']);
  // 이 장에 그 앵커가 없으면 책 전체 도움말 id 로 푼다(기존 동작)
  const c = mk(3, 'r', '알', '# 알\n\n[x](#setup)\n');
  assert.deepEqual(byId(buildHelpBundle([a, c]), 'r#_intro').links, ['setup']);
});

test('buildHelpBundle: 다른 장 파일을 적고 그 장에 없는 id 를 가리키면 못 푼 링크', () => {
  const ch = mk(3, 'z', '제트', '# 제트\n\n[x](02-beta.md#a)\n');
  const b = buildHelpBundle([chA, chB, ch]);
  assert.ok(b.problems.some((p) => p.kind === 'link-unresolved' && p.file === '03-z.md'));
});

test('buildHelpBundle: 인코딩된 한글 앵커도 푼다', () => {
  const ch = mk(3, 'z', '제트', `# 제트\n\n[x](02-beta.md#${encodeURIComponent('베타-절')})\n`);
  const b = buildHelpBundle([chA, chB, ch]);
  assert.deepEqual(byId(b, 'z#_intro').links, ['beta#베타-절']);
});

test('buildHelpBundle: 닫히지 않은 조건 블록·잘못된 도움말 표시는 problems 에, 원문 유지', () => {
  const ch = mk(1, 'x', '엑스', '# 엑스\n\n## 절 {help=Bad}\n\n{if app.customMcpServer}\n글\n\n## 다음\n\n{/if}\n');
  const b = buildHelpBundle([ch]);
  const kinds = b.problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['condition-block', 'condition-block', 'help-mark']);
  assert.ok(byId(b, 'x#절').markdown.includes('{if app.customMcpServer}'));
});

test('buildHelpBundle: HTML 주석 안의 조건 표기·링크는 세지도 바꾸지도 않는다', () => {
  const body = ['# 엑스', '', '<!-- {if app.customMcpServer} [없는 절](#없음) -->', '', '<!--', '{/if}', '-->', ''].join('\n');
  const b = buildHelpBundle([mk(1, 'x', '엑스', body)]);
  assert.deepEqual(b.problems, []);
  // 제목 줄은 절 markdown 에 들어가지 않는다 — 주석 두 덩어리가 글자 그대로 남는다
  assert.equal(b.chapters[0].json.sections[0].markdown, body.split('\n').slice(2).join('\n').trim());
});

test('validateBundle: 픽스처는 통과, 변조본은 오류', () => {
  const b = buildHelpBundle([chA, chB]);
  assert.deepEqual(validateBundle(b), []);
  const clone = () => JSON.parse(JSON.stringify({ index: b.index, chapters: b.chapters }));

  const noParent = clone();
  delete noParent.chapters[0].json.sections[1].parent;
  assert.ok(validateBundle(noParent).length > 0);

  const badLink = clone();
  badLink.chapters[0].json.sections[1].links.push('nope.id');
  assert.ok(validateBundle(badLink).some((e) => e.includes('nope.id')));

  const badIndex = clone();
  delete badIndex.index[1].routes;
  assert.ok(validateBundle(badIndex).length > 0);

  const badMark = clone();
  badMark.chapters[0].json.sections[1].figures[0].marks[0].n = '1';
  assert.ok(validateBundle(badMark).length > 0);

  const mismatch = clone();
  mismatch.index[0].sections.pop();
  assert.ok(validateBundle(mismatch).length > 0);
});

test('결정성: 같은 입력 두 번 → 같은 JSON', () => {
  const a = buildHelpBundle([chA, chB]);
  const b = buildHelpBundle([chA, chB]);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('writeHelpBundle: JSON 파일과 그림 PNG 를 정해진 자리에 쓴다', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'help-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true })); // 임시 폴더를 남기지 않는다
  const figuresDir = path.join(dir, 'src-figures');
  await mkdir(figuresDir);
  await writeFile(path.join(figuresDir, 's1.png'), 'PNG1');
  await writeFile(path.join(figuresDir, 's1~2.png'), 'PNG2');
  const out = path.join(dir, 'out');
  const b = buildHelpBundle([chA, chB]);
  await writeHelpBundle(b, out, { figuresDir });
  const index = JSON.parse(await readFile(path.join(out, HELP_BUNDLE_FILES.index), 'utf-8'));
  assert.deepEqual(index, b.index);
  const alpha = JSON.parse(await readFile(path.join(out, HELP_BUNDLE_FILES.chapterDir, 'alpha.json'), 'utf-8'));
  assert.deepEqual(alpha, b.chapters[0].json);
  const vars = JSON.parse(await readFile(path.join(out, HELP_BUNDLE_FILES.vars), 'utf-8'));
  assert.ok(vars.placeholders.some((p) => p.name === 'agent.username' && p.display === 'AI 아이디'));
  assert.ok(vars.conditions.some((c) => c.name === 'app.customMcpServer' && c.tag === '(기본 주소가 아닌 서버만)'));
  assert.deepEqual((await readdir(path.join(out, HELP_BUNDLE_FILES.figureDir))).sort(), ['s1.png', 's1~2.png']);
  assert.equal(await readFile(path.join(out, 'figures', 's1~2.png'), 'utf-8'), 'PNG2');
});

test('실제 사용자 책: 형식 통과·19장·절 id 유일', async () => {
  const chapters = await loadChapters(BOOKS.user);
  const b = buildHelpBundle(chapters, { figureAvailable: () => true });
  assert.deepEqual(validateBundle(b), []);
  assert.equal(b.index.length, 19);
  const ids = b.index.flatMap((c) => c.sections.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(b.problems, []);
});

test('CRLF 줄 나누기도 같은 절·본문', () => {
  const crlf = { ...chA, body: chA.body.replace(/\n/g, '\r\n') };
  assert.equal(JSON.stringify(buildHelpBundle([crlf, chB])), JSON.stringify(buildHelpBundle([chA, chB])));
});

test('buildHelpBundle: 형식이 틀린 그림 지시문은 figure-invalid, 원문 유지', () => {
  const ch = mk(1, 'x', '엑스', '# 엑스\n\n![그림](shots/user/s1.png){corp=a}\n');
  const b = buildHelpBundle([ch]);
  assert.deepEqual(b.problems.map((p) => [p.kind, p.line]), [['figure-invalid', 3]]);
  assert.equal(b.chapters[0].json.sections[0].markdown, '![그림](shots/user/s1.png){corp=a}');
  assert.deepEqual(b.figures, []);
});

test('buildHelpBundle: 코드 펜스 안의 그림 줄·조건 표기는 무시한다', () => {
  const body = ['# 엑스', '', '```md', '![그림](shots/user/s1.png){marks=one}', '{if app.customMcpServer}', '```', ''].join('\n');
  const b = buildHelpBundle([mk(1, 'x', '엑스', body)]);
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.figures, []);
  assert.deepEqual(b.chapters[0].json.sections[0].figures, []);
  assert.match(b.chapters[0].json.sections[0].markdown, /^```md\n!\[그림\]\(shots\/user\/s1\.png\)\{marks=one\}\n\{if app\.customMcpServer\}\n```$/);
});

test('buildHelpBundle: 짝 항목 글이 비면 표식 label 은 key', () => {
  const ch = mk(1, 'x', '엑스', '# 엑스\n\n![그림](shots/user/s1.png){marks=one,two}\n\n1. ``\n2. 둘째\n');
  const marks = buildHelpBundle([ch]).chapters[0].json.sections[0].figures[0].marks;
  assert.deepEqual(marks.map((m) => m.label), ['one', '둘째']);
});

test('buildHelpBundle: 번호 목록 사이·앞의 줄 단위 {if}·{/if} 는 표식 짝짓기를 끊지 않는다', () => {
  const body = [
    '# 엑스', '', '![그림](shots/user/s1.png){marks=one,two,three}', '',
    '{if app.customMcpServer}', '1. 첫째', '{/if}', '2. 둘째', '{if app.customMcpServer}', '3. 셋째', '{/if}', '',
  ].join('\n');
  const b = buildHelpBundle([mk(1, 'x', '엑스', body)]);
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.chapters[0].json.sections[0].figures[0].marks.map((m) => m.label), ['첫째', '둘째', '셋째']);
});

// CLI 를 임시 「가짜 저장소」(outer/repo/docs/manual/scripts)에 복사해 돌린다 — 안전장치가 깨져도 지워지는 것은 임시 폴더뿐이다.
// 테스트가 끝나면 임시 폴더를 지운다(t.after).
async function fakeRepo(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'help-cli-'));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const repo = path.join(outer, 'repo');
  const scripts = path.join(repo, 'docs', 'manual', 'scripts');
  await mkdir(scripts, { recursive: true });
  const here = path.dirname(fileURLToPath(import.meta.url));
  await cp(path.join(here, 'lib'), path.join(scripts, 'lib'), { recursive: true });
  await cp(path.join(here, 'help-bundle.mjs'), path.join(scripts, 'help-bundle.mjs'));
  await writeFile(path.join(repo, 'keep.txt'), 'keep');
  const run = (out) => spawnSync(process.execPath, [path.join(scripts, 'help-bundle.mjs'), '--out', out], { cwd: repo, encoding: 'utf-8' });
  return { outer, repo, scripts, run };
}

test('help-bundle CLI: --out 이 저장소 루트이거나 그 위면 사용법 오류(exit 2)로 아무것도 지우지 않는다', async (t) => {
  const { outer, repo, run } = await fakeRepo(t);
  for (const out of [repo, '.', outer, '..']) {
    const r = run(out);
    assert.equal(r.status, 2, `${out}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--out 은 저장소 루트이거나 그 위/);
    assert.ok(existsSync(path.join(repo, 'keep.txt')), out);
  }
  // 저장소 안의 dist/ 아래는 정상 출력 자리다(빈 책이라 장 0 — 문제 없음 exit 0).
  const ok = run('dist/help');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(existsSync(path.join(repo, 'dist', 'help', 'manual-index.json')));
});

test('help-bundle CLI: 저장소 안이면 dist/ 아래만 — docs/manual 같은 원본 폴더는 exit 2 로 지우지 않는다', async (t) => {
  const { outer, repo, scripts, run } = await fakeRepo(t);
  for (const out of ['docs/manual', 'docs', path.join(repo, 'docs', 'manual', 'scripts'), 'distx', 'dist/../docs']) {
    const r = run(out);
    assert.equal(r.status, 2, `${out}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--out 은 저장소 안이면 dist\/ 아래여야/);
    assert.ok(existsSync(path.join(scripts, 'help-bundle.mjs')), out);
  }
  // dist 자체와 저장소 밖 경로는 지금처럼 허용한다.
  assert.equal(run('dist').status, 0);
  const outside = path.join(outer, 'elsewhere');
  const r = run(outside);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(path.join(outside, 'manual-index.json')));
});
