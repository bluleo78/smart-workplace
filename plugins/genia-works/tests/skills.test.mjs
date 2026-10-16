// 플러그인 스킬 형식 테스트(WP-419) — skills/<이름>/SKILL.md 앞머리의 name 이 폴더 이름과 같고 description 이 있어야 /genia-works:<이름> 으로 불린다.
// 스킬이 부르는 도구·인자가 실제 도구 정의에 있는지는 packages/mcp-tools-shared 의 plugin-skills.test.ts 가 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const skillsDir = new URL('../skills/', import.meta.url);

test('스킬 폴더마다 SKILL.md 의 name 이 폴더 이름과 같고 description 이 있다', () => {
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.includes('work-on'));
  assert.ok(dirs.includes('work-loop'));
  for (const dir of dirs) {
    const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(new URL(`${dir}/SKILL.md`, skillsDir), 'utf8'))?.[1] ?? '';
    assert.equal(/^name: ["']?([^"'\r\n]+)["']?\r?$/m.exec(head)?.[1], dir);
    assert.match(head, /^description: \S/m, `${dir}: description 이 없다`);
  }
});

// WP-376 work-loop — 순서가 바뀌면 사고가 나는 지점을 문구 위치로 고정한다.
// 없는 문구는 indexOf 가 -1 이라 비교가 거짓으로 통과하므로, 먼저 있는지부터 본다.
const workLoop = (file) => readFileSync(new URL(`work-loop/${file}`, skillsDir), 'utf8');
const body = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
function assertBefore(text, first, second) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  assert.ok(a > -1, `「${first}」 가 없다`);
  assert.ok(b > -1, `「${second}」 가 없다`);
  assert.ok(a < b, `「${first}」 가 「${second}」 보다 먼저 나와야 한다`);
}

test('work-loop SKILL.md 는 신원 확인(get_member)이 후보 고르기(list_issues)보다 먼저 나온다', () => {
  // 내 토큰 세션이면 이슈를 건드리기 전에 멈춰야 한다 — 후보를 먼저 고르면 사람 이름으로 보고가 남는다.
  assertBefore(body(workLoop('SKILL.md')), '`get_member(', '`list_issues(');
});

test('process-issue.md 에서 「브랜치 라이브 검증」이 「main 머지」보다 먼저 나온다', () => {
  // 검증에 실패한 변경이 main 에 들어가 배포 전 일괄 push 로 나가면 안 된다.
  assertBefore(workLoop('process-issue.md'), '\n### 8. 브랜치 라이브 검증\n', '\n### 9. main 머지\n');
});

test('SKILL.md 의 후보 표에 PAUSED 행이 「고르지 않는다」로 있다', () => {
  // 사람이 멈춘 작업을 AI 가 다시 집어 들면 안 된다.
  assert.match(workLoop('SKILL.md'), /^\|[^\n]*PAUSED[^\n]*\|[^\n]*고르지 않는다[^\n]*\|\s*$/m);
});
