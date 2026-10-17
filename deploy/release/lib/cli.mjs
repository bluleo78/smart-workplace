// 릴리스 CLI(build-images · seed-baseline · release)가 함께 쓰는 작은 도구 (WP-440).
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serializeManifest } from './manifest-store.mjs';

/**
 * 이 모듈이 진입점(직접 실행)인지 판정한다 — 테스트가 main 만 import 할 때는 CLI 를 돌리지 않으려고 쓴다.
 * realpathSync: 심볼릭 링크로 실행하면 argv[1] 은 링크 경로인데 import.meta.url 은 실제 경로라, 그냥 비교하면 main 이 조용히 안 돈다.
 */
export function isMainModule(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(realpathSync(process.argv[1])).href;
}

/** 밀리초 없는 UTC ISO8601 (`2026-10-17T01:02:03Z`). */
export const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** 기본 출력 경로 — 저장소 루트의 `<name>`(루트 .gitignore 가 무시). 실행 위치(cwd)와 무관하게 같은 곳에 쓰려고 루트 기준으로 못 박는다. */
export const defaultOutPath = (repoRoot, name) => join(repoRoot, name);

/** 매니페스트의 기본 출력 경로 — 저장소 루트의 `release-manifest.json`. */
export const defaultManifestPath = (repoRoot) => defaultOutPath(repoRoot, 'release-manifest.json');

/**
 * `baseDir` 아래에 `<prefix>XXXXXX` 임시 디렉터리를 만들어 `fn(dir)` 에 넘기고, 끝나면(성공·실패 모두) 지운다.
 * fn 이 동기면 동기로 끝내고(호출자가 동기 함수로 남을 수 있게) 결과를 그대로 돌려주며, Promise(thenable)를 돌려주면 그것이 끝난 뒤 지운다.
 * baseDir 를 받는 이유: 테스트가 임시 디렉터리 위치를 바꿔 끼워 「끝에 비었는가」를 확인한다.
 */
export function withTempDir(baseDir, prefix, fn) {
  const dir = mkdtempSync(join(baseDir, prefix));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = fn(dir);
  } catch (err) {
    cleanup();
    throw err;
  }
  if (typeof result?.then === 'function') return Promise.resolve(result).finally(cleanup);
  cleanup();
  return result;
}

/**
 * `fn()` 의 실패를 `when` 일 때만 경고(`경고: <what> (<사유>)`)로 삼키고 `fallback` 을 돌려준다. `when` 이 아니면 그대로 던진다.
 * 「확인 못 해도 막지 않는 경우(dry-run 등)」를 CLI 마다 같은 모양으로 쓰려는 것. fn 은 동기·비동기 모두 된다.
 */
export async function tolerate({ when, log, what }, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    if (!when) throw err;
    log(`경고: ${what} (${err.message})`);
    return fallback;
  }
}

/** 매니페스트를 `out` 에 쓰고 `<title> → <out>` 제목 줄과 앱별 요약 표(`id · action · digest 앞부분 · 사유`)를 log 로 낸다. */
export function writeManifestReport({ manifest, out, log, title }) {
  writeFileSync(out, serializeManifest(manifest));
  log(`\n${title} → ${out}`);
  for (const [id, img] of Object.entries(manifest.images)) {
    log(`  ${id.padEnd(9)} ${img.action.padEnd(6)} ${img.digest.slice(0, 19)}  ${img.reasons.join(', ')}`);
  }
}

/** 두 CLI 의 공통 꼬리: 매니페스트를 쓰고 표를 낸 뒤, `upload` 요청이면 dry-run 이 아닐 때만 `uploadFn(version, manifest)` 로 올린다. */
export async function finishManifest({ manifest, out, upload, dryRun, uploadFn, log, title }) {
  writeManifestReport({ manifest, out, log, title });
  if (upload && !dryRun) {
    await uploadFn(manifest.version, manifest);
    log('매니페스트 업로드 완료');
  } else if (upload) {
    log('[dry-run] 매니페스트 업로드는 건너뛴다');
  }
}
