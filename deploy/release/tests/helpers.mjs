// release 테스트 공용 도구 (WP-440) — 가짜 git·docker exec 와 기준 매니페스트. 실제 git·docker·네트워크는 쓰지 않는다.
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABANDONED_FILE } from '../lib/build.mjs';
import { loadCatalog, workspaceDeps } from '../lib/catalog.mjs';

export const REPO = fileURLToPath(new URL('../../..', import.meta.url));
export const catalog = loadCatalog(REPO);
/** 워크스페이스 의존 — 한 번만 읽어 모든 테스트가 같이 쓴다(package.json 을 되풀이해 읽지 않는다). */
export const deps = workspaceDeps(REPO);
/** 임시 폴더를 만든다(정리는 호출한 테스트가 한다). */
export const makeTmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
export const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
export const NOW = new Date('2026-10-17T01:02:03.456Z');
export const repoOf = (id) => catalog.images.find((i) => i.id === id).repository;
/** 이미지(저장소 + 구분자)별로 결정적인 가짜 digest. */
export const fakeDigest = (seed) => `sha256:${createHash('sha256').update(seed).digest('hex')}`;

/** 모든 앱을 담은 기준(0.8.0) 매니페스트. */
export function baseManifest() {
  const images = {};
  for (const { id, repository, buildArgs } of catalog.images) {
    images[id] = { repository, digest: fakeDigest(`base:${id}`), action: 'build', reasons: [], builtVersion: '0.8.0', builtCommit: '1'.repeat(40), buildArgs: buildArgs ?? {} };
  }
  return { schemaVersion: 1, version: '0.8.0', commit: '1'.repeat(40), baseVersion: null, createdAt: '2026-10-01T00:00:00Z', images };
}

/**
 * 호출을 기록하는 가짜 exec. git 질의에는 정해 둔 답을, docker 에는 그럴듯한 답을 준다.
 * - build: --metadata-file 에 가짜 digest 를 써 준다(failBuildAt 번째 build 는 throw).
 * - git diff: `diff` 의 경로들을 -z 형식(NUL 구분, 끝에도 NUL)으로 돌려준다. `-c core.quotePath=false` 가 빠지면 실제 git 처럼 한글 경로를 이스케이프해 돌려준다.
 * - rev-parse v<버전>^{commit}: tagCommits(태그 → 커밋, null 이면 태그 없음)에서 답한다. 기본은 자기 태그(v0.9.0)=HEAD, 기준 태그(v0.8.0)=기준 매니페스트의 커밋.
 * - imagetools create: 태그 → digest 를 기억하고, inspect 는 그 digest 를 돌려준다(inspectOverride 로 어긋나게 할 수 있다).
 */
export function makeExec(o = {}) {
  const { dirty = false, sha = SHA, shallow = false, merged = ['v0.8.0'], allTags = merged, diff = [], failBuildAt = 0, inspectOverride = {}, tagCommits = {}, abandoned = null } = o;
  const tagMap = { 'v0.9.0': sha, 'v0.8.0': '1'.repeat(40), ...tagCommits };
  const calls = [];
  const tags = new Map();
  let builds = 0;
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const line = args.join(' ');
    if (cmd === 'git') {
      if (line === 'status --porcelain') return { stdout: dirty ? ' M file\n' : '' };
      if (line === 'rev-parse HEAD') return { stdout: `${sha}\n` };
      if (line === 'rev-parse --is-shallow-repository') return { stdout: `${shallow}\n` };
      if (line === 'tag --merged HEAD --list v*') return { stdout: merged.join('\n') };
      if (line === 'tag --list v*') return { stdout: allTags.join('\n') };
      const a = answerAbandoned(line, abandoned);
      if (a) return a;
      const rev = /^rev-parse (v\d+\.\d+\.\d+)\^\{commit\}$/.exec(line);
      if (rev) {
        if (!tagMap[rev[1]]) throw new Error(`fatal: ambiguous argument '${rev[1]}^{commit}'`);
        return { stdout: `${tagMap[rev[1]]}\n` };
      }
      if (args.includes('diff')) {
        const quoted = args.includes('core.quotePath=false') ? diff : diff.map((f) => (/[^\x00-\x7f]/.test(f) ? `"${f}"` : f));
        return { stdout: quoted.map((f) => `${f}\0`).join('') };
      }
      throw new Error(`예상 못한 git 호출: ${line}`);
    }
    if (line.startsWith('buildx build')) {
      builds += 1;
      if (builds === failBuildAt) throw new Error('빌드 실패');
      const tag = args[args.indexOf('-t') + 1];
      writeFileSync(args[args.indexOf('--metadata-file') + 1], JSON.stringify({ 'containerimage.digest': fakeDigest(`new:${tag.split(':')[0]}`) }));
      return { stdout: '' };
    }
    if (line.startsWith('buildx imagetools create')) {
      tags.set(args[args.indexOf('-t') + 1], args[args.length - 1].split('@')[1]);
      return { stdout: '' };
    }
    if (line.startsWith('buildx imagetools inspect')) {
      const ref = args[3];
      const digest = inspectOverride[ref] ?? tags.get(ref);
      // 실제 레지스트리처럼 없는 태그는 not found 로 실패한다(이미 게시 여부 확인이 이걸로 판정한다).
      if (!digest) throw new Error(`ERROR: ${ref}: not found`);
      return { stdout: JSON.stringify({ digest }) };
    }
    throw new Error(`예상 못한 호출: ${cmd} ${line}`);
  };
  exec.calls = calls;
  exec.docker = () => calls.filter((c) => c.cmd === 'docker').map((c) => c.args.join(' '));
  return exec;
}
export const buildCalls = (exec) => exec.calls.filter((c) => c.cmd === 'docker' && c.args[1] === 'build');
export const createCalls = (exec) => exec.calls.filter((c) => c.cmd === 'docker' && c.args[1] === 'imagetools' && c.args[2] === 'create');

/**
 * 가짜 exec 가 버린 릴리스 목록(WP-454) 질의에 답한다 — abandoned 가 null 이면 그 ref 에 파일이 없다(ls-tree 빈 출력).
 * 목록 질의가 아니면 undefined 를 돌려 호출자가 다른 분기로 넘어가게 한다.
 */
export function answerAbandoned(line, abandoned) {
  if (line.startsWith('ls-tree --name-only ') && line.endsWith(` -- ${ABANDONED_FILE}`)) return { stdout: abandoned === null ? '' : `${ABANDONED_FILE}\n` };
  if (line.startsWith('show ') && line.endsWith(`:${ABANDONED_FILE}`)) return { stdout: JSON.stringify({ versions: abandoned }) };
  return undefined;
}
