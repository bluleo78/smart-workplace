#!/usr/bin/env node
// 릴리스 태그 검증 CLI (WP-442) — GitLab 태그 파이프라인의 첫 잡.
//   node deploy/release/verify-tag.mjs --tag v0.9.0 [--env-out release.env]
// 태그가 릴리스로 내보낼 수 있는 커밋인지 확인하고, 뒤 잡이 쓸 값(VERSION·BASE_TAG·BASE_VERSION)을 dotenv 로 남긴다.
// - 형식: vX.Y.Z
// - 위치: 태그 커밋이 origin/main 또는 origin/hotfix/* 에 포함(설계 §5.1) — 리뷰를 거치지 않은 브랜치 커밋을 내보내지 않게.
// - 노트: 태그 커밋에 releases/<버전>.md 가 있어야 한다(앱 「새 소식」이 이 파일을 번들에 넣는다).
// - 플러그인: marketplace ref 태그(genia-works--v<버전>)가 설치 주소(marketplace `source.url`)에 있어야 한다(WP-2138) — 사람들이 설치하는 ref 이다.
// - 기준: 태그 커밋의 조상 중 가장 높은 vX.Y.Z(findBase — 버린 릴리스 abandoned-releases.json 은 뺀다). 없으면 실패(첫 릴리스 v0.9.0 의 기준은 v0.8.0). 태그 버전은 기준보다 높아야 한다.
// 원격 브랜치는 호출 전에 받아 둬야 한다(CI 는 main·hotfix/* 를 refs/remotes/origin 으로 fetch). 종료 코드 0 = 통과, 1 = 실패(stderr `오류: …`).
// 플러그인 ref 태그 확인(WP-2138)은 `git ls-remote` 로 설치 주소(marketplace `source.url`)에 직접 접속한다 — GitLab CI 의 `origin` 은 gitlab.iacloud.kr 이라 사람들이 설치하는 GitHub 와 다르고, 원격 브랜치 fetch 만으로도 부족하며 오프라인에서 돌면 네트워크 오류가 난다.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ABANDONED_FILE, abandonedReleases, defaultExec, findBase, MARKETPLACE_PATH, marketplaceGitSource } from './lib/build.mjs';
import { isMainModule } from './lib/cli.mjs';
import { compareVersions, isVersionTag } from './lib/semver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 태그 커밋을 포함할 수 있는 원격 브랜치 — 그 밖의 브랜치(기능 브랜치 등)에만 있는 커밋은 릴리스하지 않는다. */
export const isReleaseBranch = (ref) => ref === 'origin/main' || ref.startsWith('origin/hotfix/');

/**
 * 대상 커밋의 marketplace ref 태그가 설치 주소(`source.url`)에 있는지 — 없으면 릴리스를 멈춘다(WP-2138).
 * 사람들이 설치하는 버전은 marketplace ref 가 가리키는 태그라서, ref 를 올리지 않고 내보내면 설치가 깨진다.
 * 확인하는 원격은 marketplace 항목의 `source.url` 이다 — GitLab CI 에서 `origin` 은 gitlab.iacloud.kr 이라
 * 사람들이 설치하는 GitHub 와 주소가 다르고, origin 기준 확인은 WP-2138 사고(GitHub 에 없는 태그를 지나침)를 그대로 만든다.
 * `git ls-remote` 의 네트워크 오류는 그 메시지 그대로 흘려보낸다(「태그를 올리세요」로 바꾸지 않는다).
 * exec 를 주입받아 테스트가 git 없이 흐름을 확인한다.
 */
export function verifyPluginRefTag({ exec, repoRoot, commit }) {
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout;
  let text;
  try {
    text = git('show', `${commit}:${MARKETPLACE_PATH}`);
  } catch (err) {
    // 파일이 없거나 못 읽으면 — 원인을 한국어로 말한다(git 영문 메시지는 그대로 두지 않는다). 어떤 git 오류였는지도 함께 남긴다.
    throw new Error(`marketplace.json 을 태그 커밋(${commit.slice(0, 12)})에서 읽지 못했다 — ${MARKETPLACE_PATH} 를 태그 전에 커밋한다 (${err.message})`);
  }
  const { version, url } = marketplaceGitSource(text);
  if (!version) throw new Error('marketplace.json 의 genia-works ref 를 읽지 못했다 — ref 는 genia-works--v<버전> 이어야 한다');
  // url 을 못 읽으면 확인할 주소가 없는 것이다 — 경고로 넘기면 WP-2138 과 같은 사고가 반복되므로 멈춘다.
  if (!url) throw new Error(`marketplace.json 의 genia-works source.url 을 읽지 못했다 — 사람들이 설치하는 주소라 ${MARKETPLACE_PATH} 에 source.url 을 적는다`);
  const tag = `genia-works--v${version}`;
  if (git('ls-remote', '--tags', url, `refs/tags/${tag}`).trim() === '')
    throw new Error(`${tag} 태그가 설치 주소(${url}) 에 없다 — 먼저 \`git tag ${tag} <커밋>\` · \`git push ${url} ${tag}\` 로 태그를 올리세요`);
  return { tag, version, url };
}

/**
 * 태그를 검증하고 `{ version, commit, baseTag, baseVersion, pluginTag, pluginUrl }` 를 돌려준다. 실패하면 사유를 담아 throw.
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

  // 사람들이 설치하는 ref 태그가 설치 주소(marketplace `source.url`)에 이미 있는지(WP-2138) — 없으면 설치가 깨지므로 릴리스를 멈춘다.
  const { tag: pluginTag, url: pluginUrl } = verifyPluginRefTag({ exec, repoRoot, commit });

  // 버린 릴리스로 적힌 버전은 다시 내보내지 않는다 — 태그를 지우지 않고 버린 것이라 같은 이름이 두 커밋을 가리키게 된다(WP-454).
  const abandoned = abandonedReleases({ exec, repoRoot, ref: commit });
  if (Object.hasOwn(abandoned, version)) {
    throw new Error(`${tag} 는 ${ABANDONED_FILE} 에 버린 릴리스로 적혀 있다 — 다음 버전으로 태그한다`);
  }
  // 버린 버전의 노트가 남아 있으면 나가지 않은 버전이 「새 소식」에 보인다(web 은 releases/*.md 를 모두 번들한다).
  const leftover = Object.keys(abandoned).filter((v) => {
    try {
      git('cat-file', '-e', `${commit}:releases/${v}.md`);
      return true;
    } catch {
      return false;
    }
  });
  if (leftover.length > 0) throw new Error(`버린 릴리스의 노트가 남아 있다: ${leftover.map((v) => `releases/${v}.md`).join(', ')} — 다음 버전 노트로 옮긴다`);

  // 기준은 태그 커밋에서 찾는다(HEAD 가 아니라). 태그 자신이 늘 있어 findBase 의 「태그 미수신」 판정은 맞지 않으므로 allowNoBase 로 받고 사유는 여기서 말한다.
  const { baseTag, baseVersion } = findBase({ exec, repoRoot, version, ref: commit, allowNoBase: true, abandoned });
  if (baseTag === null) throw new Error(`${tag} 의 조상에 기준 릴리스 태그(vX.Y.Z)가 없다 — 기준 릴리스(v0.8.0)를 먼저 태그·시드한다`);
  // 조상에 같거나 더 높은 버전이 있으면 순서가 뒤집힌 태그다 — 그대로 내보내면 낮은 버전 번호가 더 새 코드를 담는다.
  if (compareVersions(version, baseVersion) <= 0) throw new Error(`${tag} 가 기준 릴리스 ${baseTag} 보다 높지 않다 — 조상에 이미 ${baseTag} 가 있으니 그보다 높은 버전을 붙인다`);
  return { version, commit, baseTag, baseVersion, pluginTag, pluginUrl };
}

/** CLI 본체 — 결과를 dotenv(`KEY=값` 줄)로 쓰고 사람용 요약은 log(stderr)로 낸다. */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, log = console.error } = {}) {
  const { values } = parseArgs({ args: argv, options: { tag: { type: 'string' }, 'env-out': { type: 'string' } }, strict: true });
  if (!values.tag) throw new Error('--tag 가 필요하다 (예: --tag v0.9.0)');
  const r = verifyTag({ tag: values.tag, exec, repoRoot });
  const env = `VERSION=${r.version}\nBASE_TAG=${r.baseTag}\nBASE_VERSION=${r.baseVersion}\n`;
  if (values['env-out']) writeFileSync(values['env-out'], env);
  log(`릴리스 ${values.tag} 검증 통과 — 커밋 ${r.commit.slice(0, 12)}, 기준 ${r.baseTag}, 플러그인 태그 ${r.pluginTag}(${r.pluginUrl}) 확인`);
  return r;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
