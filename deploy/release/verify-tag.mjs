#!/usr/bin/env node
// 릴리스 태그 검증 CLI (WP-442) — GitLab 태그 파이프라인의 첫 잡.
//   node deploy/release/verify-tag.mjs --tag v0.9.0 [--env-out release.env]
// 태그가 릴리스로 내보낼 수 있는 커밋인지 확인하고, 뒤 잡이 쓸 값(VERSION·BASE_TAG·BASE_VERSION)을 dotenv 로 남긴다.
// - 형식: vX.Y.Z
// - 위치: 태그 커밋이 origin/main 또는 origin/hotfix/* 에 포함(설계 §5.1) — 리뷰를 거치지 않은 브랜치 커밋을 내보내지 않게.
// - 노트: 태그 커밋에 releases/<버전>.md 가 있어야 한다(앱 「새 소식」이 이 파일을 번들에 넣는다).
// - 기준: 태그 커밋의 조상 중 가장 높은 vX.Y.Z(findBase). 없으면 실패(첫 릴리스 v0.9.0 의 기준은 v0.8.0). 태그 버전은 기준보다 높아야 한다.
// 원격 브랜치는 호출 전에 받아 둬야 한다(CI 는 main·hotfix/* 를 refs/remotes/origin 으로 fetch). 종료 코드 0 = 통과, 1 = 실패(stderr `오류: …`).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultExec, findBase } from './lib/build.mjs';
import { isMainModule } from './lib/cli.mjs';
import { compareVersions, isVersionTag } from './lib/semver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 태그 커밋을 포함할 수 있는 원격 브랜치 — 그 밖의 브랜치(기능 브랜치 등)에만 있는 커밋은 릴리스하지 않는다. */
export const isReleaseBranch = (ref) => ref === 'origin/main' || ref.startsWith('origin/hotfix/');

/**
 * 태그를 검증하고 `{ version, commit, baseTag, baseVersion }` 를 돌려준다. 실패하면 사유를 담아 throw.
 * exec 를 주입받아 테스트가 git 없이 흐름을 확인한다.
 */
export function verifyTag({ tag, exec, repoRoot }) {
  if (!isVersionTag(tag)) throw new Error(`릴리스 태그 형식이 아니다: ${JSON.stringify(tag)} (vX.Y.Z)`);
  const version = tag.slice(1);
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout.trim();
  const commit = git('rev-parse', `${tag}^{commit}`);

  const branches = git('branch', '-r', '--contains', commit, '--format=%(refname:short)').split('\n').filter(Boolean);
  if (!branches.some(isReleaseBranch)) {
    throw new Error(`${tag} 커밋(${commit.slice(0, 12)})이 origin/main 이나 origin/hotfix/* 에 없다 — 머지된 커밋에만 릴리스 태그를 붙인다 (포함 브랜치: ${branches.join(', ') || '없음'})`);
  }

  try {
    git('cat-file', '-e', `${commit}:releases/${version}.md`);
  } catch {
    throw new Error(`${tag} 커밋에 releases/${version}.md 가 없다 — 릴리스 노트를 태그 전에 커밋한다(사용자에게 보이는 변경이 없으면 frontmatter hidden: true)`);
  }

  // 기준은 태그 커밋에서 찾는다(HEAD 가 아니라). 태그 자신이 늘 있어 findBase 의 「태그 미수신」 판정은 맞지 않으므로 allowNoBase 로 받고 사유는 여기서 말한다.
  const { baseTag, baseVersion } = findBase({ exec, repoRoot, version, ref: commit, allowNoBase: true });
  if (baseTag === null) throw new Error(`${tag} 의 조상에 기준 릴리스 태그(vX.Y.Z)가 없다 — 기준 릴리스(v0.8.0)를 먼저 태그·시드한다`);
  // 조상에 같거나 더 높은 버전이 있으면 순서가 뒤집힌 태그다 — 그대로 내보내면 낮은 버전 번호가 더 새 코드를 담는다.
  if (compareVersions(version, baseVersion) <= 0) throw new Error(`${tag} 가 기준 릴리스 ${baseTag} 보다 높지 않다 — 조상에 이미 ${baseTag} 가 있으니 그보다 높은 버전을 붙인다`);
  return { version, commit, baseTag, baseVersion };
}

/** CLI 본체 — 결과를 dotenv(`KEY=값` 줄)로 쓰고 사람용 요약은 log(stderr)로 낸다. */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, log = console.error } = {}) {
  const { values } = parseArgs({ args: argv, options: { tag: { type: 'string' }, 'env-out': { type: 'string' } }, strict: true });
  if (!values.tag) throw new Error('--tag 가 필요하다 (예: --tag v0.9.0)');
  const r = verifyTag({ tag: values.tag, exec, repoRoot });
  const env = `VERSION=${r.version}\nBASE_TAG=${r.baseTag}\nBASE_VERSION=${r.baseVersion}\n`;
  if (values['env-out']) writeFileSync(values['env-out'], env);
  log(`릴리스 ${values.tag} 검증 통과 — 커밋 ${r.commit.slice(0, 12)}, 기준 ${r.baseTag}`);
  return r;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
