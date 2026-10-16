// 플러그인 스킬 형식 테스트(WP-419) — skills/<이름>/SKILL.md 앞머리의 name 이 폴더 이름과 같고 description 이 있어야 /genia-works:<이름> 으로 불린다.
// 스킬이 부르는 도구·인자가 실제 도구 정의에 있는지는 packages/mcp-tools-shared 의 plugin-skills.test.ts 가 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const skillsDir = new URL('../skills/', import.meta.url);

test('스킬 폴더마다 SKILL.md 의 name 이 폴더 이름과 같고 description 이 있다', () => {
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.includes('work-on'));
  for (const dir of dirs) {
    const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(new URL(`${dir}/SKILL.md`, skillsDir), 'utf8'))?.[1] ?? '';
    assert.equal(/^name: ["']?([^"'\r\n]+)["']?\r?$/m.exec(head)?.[1], dir);
    assert.match(head, /^description: \S/m, `${dir}: description 이 없다`);
  }
});
