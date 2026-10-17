#!/usr/bin/env node
// 릴리스 이미지 빌드 CLI (WP-440).
//   node deploy/release/build-images.mjs --version 0.9.0 [--base-manifest <file>] [--allow-no-base] [--dry-run] [--force] [--upload] [--out <file>]
// 기준 릴리스(findBase)와 그 매니페스트(--base-manifest 파일 또는 GitLab 패키지, 둘 다 validateBaseManifest 로 검증)를 main 에서 한 번 정해 runRelease 에 넘긴다.
// 결과는 --out(기본 <저장소 루트>/release-manifest.json)에 쓰고 앱별 판정 표는 stderr 로 낸다.
//   --upload  결과 매니페스트를 GitLab 패키지에 올린다(dry-run 에서는 올리지 않는다).  --force  이미 게시된 같은 버전을 다시 빌드한다.
// 필요 환경: CI_API_V4_URL · CI_PROJECT_ID + CI_JOB_TOKEN 또는 GITLAB_TOKEN (기준 매니페스트·게시 여부 확인·업로드. dry-run 은 확인 실패 시 경고만).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkAlreadyPublished, defaultExec, findBase, findVersionTags, runRelease, validateBaseManifest } from './lib/build.mjs';
import { loadCatalog, workspaceDeps } from './lib/catalog.mjs';
import { defaultManifestPath, finishManifest, isMainModule, tolerate } from './lib/cli.mjs';
import { downloadManifest, uploadManifest } from './lib/manifest-store.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 기준 매니페스트를 구해 검증한다(없어도 되는 경우는 null). 엉뚱한 릴리스·깨진 매니페스트로 승계하면 다른 버전의 이미지를 태그하게 되므로
 * 다운로드본과 파일 모두 같은 검증을 한다. 기준 태그가 있는데 매니페스트가 없으면 allowNoBase 가 아닌 한 throw,
 * dry-run 은 받기 자체가 실패해도(토큰 없음 등) 「기준 없음」으로 보고 끝까지 미리 보여 준다(전부 build).
 */
async function resolveBaseManifest({ baseFile, baseTag, baseVersion, allowNoBase, dryRun, download, exec, repoRoot, log }) {
  if (baseFile && baseVersion === null) {
    throw new Error('--base-manifest 를 줬는데 기준 릴리스 태그가 없다. 파일이 어느 릴리스의 것인지 확인할 수 없어 쓰지 않는다');
  }
  if (baseVersion === null) return null;
  // fallback undefined = dry-run 에서 받기 실패, null = 패키지에 매니페스트 없음(둘을 구분해야 한다).
  const manifest = baseFile
    ? JSON.parse(readFileSync(baseFile, 'utf8'))
    : await tolerate({ when: dryRun, log, what: `기준 릴리스 ${baseVersion} 의 매니페스트를 받지 못해 기준 없이 미리 본다 — 전부 build 로 나온다` }, () => download(baseVersion), undefined);
  if (manifest === undefined) return null;
  if (manifest === null) {
    if (!allowNoBase) throw new Error(`기준 릴리스 ${baseTag} 의 매니페스트를 찾지 못했다. 의도한 것이면 --allow-no-base (전부 새로 빌드)`);
    return null;
  }
  validateBaseManifest({ manifest, baseVersion, exec, repoRoot, source: baseFile ?? `GitLab 패키지 ${baseVersion}` });
  return manifest;
}

/**
 * CLI 본체. 외부 의존(exec·다운로드·업로드·시각·로그)을 주입받아 테스트가 git·docker·네트워크 없이 흐름을 검증한다.
 * 실패하면 throw 한다(진입점이 메시지를 찍고 종료 코드 1 로 끝낸다).
 */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, download = downloadManifest, upload = uploadManifest, now = new Date(), log = console.error } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      'base-manifest': { type: 'string' },
      'allow-no-base': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      upload: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    strict: true,
  });
  const version = values.version;
  const allowNoBase = values['allow-no-base'];
  const dryRun = values['dry-run'];

  // 기준 릴리스는 git 만으로 정해지므로 dry-run 이어도 실제 exec 를 쓴다. 한 번 정한 기준을 runRelease 에 그대로 넘긴다.
  const base = findBase({ exec, repoRoot, version, allowNoBase });
  const catalog = loadCatalog(repoRoot);
  const deps = workspaceDeps(repoRoot);

  // 이미 게시된 릴리스를 덮어쓰지 않는다. dry-run 은 확인 못 해도 막지 않고 알리기만 한다.
  // 매니페스트가 없어도 이전 실행이 태그만 붙이고 멈췄을 수 있어 레지스트리 `:<버전>` 태그도 본다.
  const published = await tolerate({ when: dryRun, log, what: `릴리스 ${version} 의 게시 여부를 확인하지 못했다` }, () => download(version), null);
  const taggedIds = published !== null
    ? []
    : await tolerate({ when: dryRun, log, what: `레지스트리의 :${version} 태그를 확인하지 못했다` }, () => findVersionTags({ exec, repoRoot, catalog, version }), []);
  checkAlreadyPublished({ existing: published, taggedIds, version, force: values.force, dryRun, action: '빌드', warn: log });

  const baseManifest = await resolveBaseManifest({ baseFile: values['base-manifest'], ...base, allowNoBase, dryRun, download, exec, repoRoot, log });
  const manifest = runRelease({ repoRoot, version, exec, now, base, baseManifest, catalog, deps, dryRun, log });

  const out = values.out ?? defaultManifestPath(repoRoot);
  await finishManifest({ manifest, out, upload: values.upload, dryRun, uploadFn: upload, log, title: `릴리스 ${manifest.version} (기준 ${manifest.baseVersion ?? '없음'})` });
  return manifest;
}

// 테스트가 main 만 import 할 때는 실행하지 않는다.
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
