#!/usr/bin/env node
// 기준 릴리스(v0.8.0) 시드 CLI (WP-440).
// 왜: 릴리스 체계 이전에 운영에 떠 있는 ghcr 이미지를 새 체계의 첫 기준 릴리스로 승격한다(다음 릴리스가 digest 를 승계하려면 기준 매니페스트가 필요).
//     재빌드 없이 `imagetools create` 로 docker.io 의 `<repo>:<버전>` 태그만 원본 digest 에 붙인다(바이트 동일).
//
//   1) 입력 파일 — 줄마다 `<id> <저장소>@sha256:<64hex>` (태그 ref 는 거부). 운영 파드 imageID 에서 만든다. 앱 라벨 `db` 는 id `db`, 나머지는 라벨 = id.
//      converter 도 10-17(WP-437)부터 운영에 있으니 포함한다(9개). db 의 원본 저장소는 ghcr.io/bluleo78/smart-workplace/postgres.
//        kubectl --context iacloud-prod-public -n smart-workplace get pods \
//          -o jsonpath='{range .items[*]}{.metadata.labels.app}{" "}{.status.containerStatuses[0].imageID}{"\n"}{end}' \
//          | sed 's#docker-pullable://##' | sort -u > /tmp/baseline-images.txt
//   2) 시드 (docker.io 푸시 권한 필요 — 먼저 `docker login`; 먼저 --dry-run 권장)
//        node deploy/release/seed-baseline.mjs --version 0.8.0 --commit $(git rev-parse a5d66d059) --images /tmp/baseline-images.txt [--dry-run | --upload] [--force] [--out <file>]
// 필요 환경(--upload · 게시 여부 확인): CI_API_V4_URL · CI_PROJECT_ID + CI_JOB_TOKEN 또는 GITLAB_TOKEN.
// 그 버전이 이미 게시돼 있으면 --force 없이 거부한다. --upload 일 때 게시 여부를 확인하지 못하면 중단한다(로컬 시드·dry-run 은 경고 후 진행).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertVersion, checkAlreadyPublished, defaultExec, dryRunExec, imagetoolsCreateArgs, inspectDigest } from './lib/build.mjs';
import { loadCatalog } from './lib/catalog.mjs';
import { defaultManifestPath, finishManifest, isMainModule, isoSeconds, tolerate } from './lib/cli.mjs';
import { downloadManifest, uploadManifest } from './lib/manifest-store.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
/** 원본 ref 는 `<저장소>@sha256:<64hex>` 만 허용 — 태그 ref 는 가리키는 이미지가 바뀔 수 있어 "운영에서 돌던 것" 보증이 안 된다. */
const SOURCE_RE = /^[^\s@]+@(sha256:[0-9a-f]{64})$/;

/** 입력 파일 텍스트를 `Map<id, ref>` 로 읽는다(빈 줄·`#` 주석 무시). 줄 형식 오류·중복 id 는 throw — 추측해 시드하면 잘못된 이미지가 기준이 된다. */
export function parseSources(text) {
  const map = new Map();
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) throw new Error(`입력 ${i + 1}번째 줄: "<id> <ref>" 두 항목이어야 한다 (${parts.length}개): ${line}`);
    const [id, ref] = parts;
    if (map.has(id)) throw new Error(`입력 ${i + 1}번째 줄: id ${id} 가 중복이다`);
    map.set(id, ref);
  });
  return map;
}

/**
 * 원본 이미지들을 `<repo>:<version>` 으로 복사하고 기준 릴리스 매니페스트를 돌려준다.
 * 입력은 첫 create 전에 전부 검증한다(일부만 태그가 붙은 채 멈추지 않게). 복사 뒤 다시 읽은 digest 가 원본과 다르면 해당 id 를 담아 throw.
 * 카탈로그에 있어도 sources 에 없는 앱은 매니페스트에서 빠진다(다음 릴리스에서 new-app 으로 빌드). converter 는 10-17 부터 운영에 있으니 sources 에 넣는다.
 */
export function seedBaseline({ catalog, version, commit, sources, exec = defaultExec, now = new Date() }) {
  assertVersion(version);
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error(`commit 은 40자 hex 여야 한다: ${JSON.stringify(commit)}`);
  const byId = new Map(catalog.images.map((i) => [i.id, i]));
  const digests = new Map();
  for (const [id, ref] of sources) {
    if (!byId.has(id)) throw new Error(`카탈로그에 없는 이미지 id: ${id}`);
    const m = SOURCE_RE.exec(ref ?? '');
    if (!m) throw new Error(`${id}: 원본은 <저장소>@sha256:<64hex> digest ref 여야 한다 (${JSON.stringify(ref)})`);
    digests.set(id, m[1]);
  }

  // 카탈로그 순서대로 복사 → 검증. create 는 멱등이라 중간 실패 시 같은 입력으로 다시 실행하면 이어서 맞춰진다.
  const images = {};
  for (const { id, repository } of catalog.images) {
    if (!sources.has(id)) continue;
    const target = `${repository}:${version}`;
    // --prefer-index=false(imagetoolsCreateArgs): 원본 digest 를 index 로 감싸 바꾸지 않고 바이트 그대로 태그만 붙인다.
    exec('docker', imagetoolsCreateArgs(target, sources.get(id)));
    const actual = inspectDigest(exec, target);
    if (actual !== digests.get(id)) throw new Error(`${id}: ${target} 의 digest 가 원본과 다르다 (원본 ${digests.get(id)}, 실제 ${actual})`);
    // buildArgs: 기준 이미지는 옛 scripts/deploy.sh(v0.8.0 = a5d66d059 시점, 전환 뒤 삭제)가 카탈로그와 같은 인자(web 은 VITE_MCP_URL 빈 값)로 빌드했다 — 다음 릴리스가 인자 변경을 감지하는 기준이 된다.
    images[id] = { repository, digest: digests.get(id), action: 'carry', reasons: ['baseline'], builtVersion: version, builtCommit: commit, buildArgs: byId.get(id).buildArgs ?? {} };
  }
  return { schemaVersion: 1, version, commit, baseVersion: null, createdAt: isoSeconds(now), images };
}

/**
 * CLI 본체. 외부 의존(exec·다운로드·업로드·시각·로그)을 주입받아 테스트가 docker·네트워크 없이 흐름을 검증한다. 실패하면 throw(진입점이 종료 코드 1).
 * 첫 create 전에 그 버전이 이미 게시돼 있는지 본다 — 있으면 다른 digest 로 같은 `:<버전>` 태그를 덮어쓰게 되므로 --force 없이는 거부한다.
 */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, download = downloadManifest, upload = uploadManifest, now = new Date(), log = console.error } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      commit: { type: 'string' },
      images: { type: 'string' },
      upload: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (!values.version || !values.commit || !values.images) throw new Error('--version, --commit, --images 는 필수다');
  assertVersion(values.version);
  const dryRun = values['dry-run'];
  const sources = parseSources(readFileSync(values.images, 'utf8'));

  // 이미 게시된 기준 릴리스를 덮어쓰지 않는다. 게시 여부를 확인하지 못했을 때: --upload 하는 실제 실행은 모르는 채 덮어쓸 수 있어 중단하고,
  // 파일만 쓰는 로컬 시드나 dry-run 은 경고 후 진행한다.
  const existing = await tolerate({ when: dryRun || !values.upload, log, what: `릴리스 ${values.version} 의 게시 여부를 확인하지 못했다` }, () => download(values.version), null);
  checkAlreadyPublished({ existing, version: values.version, force: values.force, dryRun, action: '시드', warn: log });

  // dry-run 은 docker 명령만 출력하고(원본 digest 와 같다고 가정) 레지스트리·업로드에는 손대지 않는다.
  const run = dryRun ? dryRunExec(exec, log, writeFileSync) : exec;
  const manifest = seedBaseline({ catalog: loadCatalog(repoRoot), version: values.version, commit: values.commit, sources, exec: run, now });

  // 기본 출력은 저장소 루트의 release-manifest.json(루트 .gitignore 가 무시) — 실행 위치와 무관.
  const out = values.out ?? defaultManifestPath(repoRoot);
  await finishManifest({ manifest, out, upload: values.upload, dryRun, uploadFn: upload, log, title: `기준 릴리스 ${manifest.version}` });
  return manifest;
}

// 테스트가 seedBaseline·main 만 import 할 때는 실행하지 않는다.
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
