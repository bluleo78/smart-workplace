#!/usr/bin/env node
// 릴리스 준비 CLI (WP-444) — 스킬 /release prepare 가 부른다(.claude/skills/release/SKILL.md).
//   node deploy/release/prepare.mjs plan [--to <ref, 기본 HEAD>] [--base <ref> --base-version <x.y.z>]
//     기준 릴리스 이후 커밋을 모아 버전 자리를 제안하고, 노트 초안에 쓸 이슈 키를 JSON 으로 stdout 에 낸다.
//     기준은 --to 의 조상 중 가장 높은 vX.Y.Z 태그(핫픽스 브랜치면 그 브랜치의 조상). 태그가 없으면(첫 전환 전) --base/--base-version 으로 준다.
//   node deploy/release/prepare.mjs check-note <releases/x.y.z.md> [--base-version <x.y.z>]
//     노트 파일 형식을 검사한다(앱 「새 소식」이 읽는 형식). --base-version 이 있으면 버전이 그보다 높은지도 본다.
// 종료 코드: 0 = 성공, 1 = 실패(사유는 stderr `오류: …`). 노트 문장은 이 CLI 가 아니라 스킬(Claude 세션)이 이슈 본문을 읽고 쓴다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultExec, findBase } from './lib/build.mjs';
import { isMainModule } from './lib/cli.mjs';
import { LOG_FORMAT, bumpOf, checkNote, nextVersion, parseCommits, summarize } from './lib/prepare.mjs';
import { compareVersions, isVersionTag, parseVersion } from './lib/semver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 기준 지점·버전을 정한다 — 명시(--base/--base-version)가 우선, 없으면 --to 의 조상 태그 중 가장 높은 것(--to 자신에 붙은 태그는 뺀다). */
function resolveBase({ git, exec, repoRoot, to, base, baseVersion }) {
  if (base || baseVersion) {
    if (!base || !baseVersion) throw new Error('--base 와 --base-version 은 함께 준다');
    if (!parseVersion(baseVersion)) throw new Error(`잘못된 --base-version: ${baseVersion} (x.y.z)`);
    return { baseRef: base, baseVersion };
  }
  const own = git('tag', '--points-at', to, '--list', 'v*').split('\n').map((t) => t.trim());
  const { baseTag } = findBase({ exec, repoRoot, ref: to, exclude: own, allowNoBase: true });
  if (baseTag === null) throw new Error(`${to} 의 조상에 릴리스 태그(vX.Y.Z)가 없다 — 첫 전환 전이면 --base <커밋> --base-version 0.8.0`);
  return { baseRef: baseTag, baseVersion: baseTag.slice(1) };
}

/** plan — 기준 이후 커밋을 해석해 제안을 돌려준다. */
export function plan({ to = 'HEAD', base, baseVersion, exec = defaultExec, repoRoot = REPO_ROOT, log = () => {} }) {
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout;
  const resolved = resolveBase({ git, exec, repoRoot, to, base, baseVersion });
  const toSha = git('rev-parse', '--verify', `${to}^{commit}`).trim();
  const baseSha = git('rev-parse', '--verify', `${resolved.baseRef}^{commit}`).trim();
  // 머지 커밋은 빼고 실제 변경 커밋만 — 스쿼시 커밋 제목에 이슈 키가 붙어 있다.
  const commits = parseCommits(git('log', '--no-merges', `--format=${LOG_FORMAT}`, `${baseSha}..${toSha}`));
  // 핫픽스 브랜치는 patch 만 — 기능 커밋을 cherry-pick 해도 main 의 다음 minor 와 겹치지 않게.
  // to 가 HEAD 여도 브랜치 이름으로 판정한다(SHA·태그면 이름이 없어 핫픽스로 보지 않는다).
  const hotfix = /^(origin\/)?hotfix\//.test(git('rev-parse', '--abbrev-ref', to).trim());
  const bump = hotfix && commits.length > 0 ? 'patch' : bumpOf(commits);
  let suggestedVersion = bump === null ? null : nextVersion(resolved.baseVersion, bump);
  // 제안 버전의 태그가 이미 있으면 제안하지 않는다 — to 가 그 태그를 품지 않은 것(뒤처진 로컬 main·핫픽스 라인)이라 사람이 정한다.
  let conflict = null;
  if (suggestedVersion !== null && git('tag', '--list', `v${suggestedVersion}`).trim() !== '') {
    conflict = `v${suggestedVersion} 태그가 이미 있는데 ${to} 에 포함되지 않는다 — git fetch 로 최신 main 인지 확인하고, 맞으면 버전을 직접 정한다`;
    suggestedVersion = null;
  }
  log(`기준 ${resolved.baseRef}(${resolved.baseVersion}) 이후 커밋 ${commits.length}개${hotfix ? '(핫픽스 — patch 만)' : ''} — 제안 ${suggestedVersion ?? '없음'}`);
  if (conflict) log(`⚠ ${conflict}`);
  return {
    base: resolved.baseRef,
    baseVersion: resolved.baseVersion,
    to: toSha,
    // 노트 frontmatter range 에 그대로 쓴다(기준 태그가 없을 때는 커밋 12자).
    range: `${isVersionTag(resolved.baseRef) ? resolved.baseRef : baseSha.slice(0, 12)}..${toSha.slice(0, 12)}`,
    bump,
    suggestedVersion,
    conflict,
    ...summarize(commits),
  };
}

/** check-note — 문제가 있으면 모두 담아 throw. web 은 저장소 루트 releases/*.md 만 번들하므로 그 위치인지도 본다. */
export function checkNoteFile(file, { baseVersion, repoRoot = REPO_ROOT } = {}) {
  const problems = checkNote(basename(file), readFileSync(file, 'utf8'));
  if (dirname(file) !== join(repoRoot, 'releases')) problems.push(`노트는 저장소 루트 releases/ 에 둔다(web 이 그곳만 번들한다): ${file}`);
  const version = basename(file).replace(/\.md$/, '');
  if (baseVersion && parseVersion(version) && compareVersions(version, baseVersion) <= 0) problems.push(`${version} 은 기준 ${baseVersion} 보다 높아야 한다`);
  if (problems.length > 0) throw new Error(`${file}:\n- ${problems.join('\n- ')}`);
}

/** CLI 본체. */
export async function main(argv, { exec = defaultExec, repoRoot = REPO_ROOT, stdout = (s) => process.stdout.write(s), log = console.error } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { to: { type: 'string' }, base: { type: 'string' }, 'base-version': { type: 'string' } },
  });
  const [command, ...rest] = positionals;
  if (command === 'plan') {
    if (rest.length > 0) throw new Error(`plan 은 위치 인자를 받지 않는다: ${rest.join(' ')}`);
    const result = plan({ to: values.to, base: values.base, baseVersion: values['base-version'], exec, repoRoot, log });
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (command === 'check-note') {
    if (rest.length !== 1) throw new Error('check-note 는 노트 파일 하나를 받는다: check-note releases/<x.y.z>.md');
    checkNoteFile(resolve(rest[0]), { baseVersion: values['base-version'], repoRoot });
    log(`${rest[0]} 형식 통과`);
    return null;
  }
  throw new Error('사용법: prepare.mjs plan [--to <ref>] [--base <ref> --base-version x.y.z] | check-note <파일> [--base-version x.y.z]');
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
