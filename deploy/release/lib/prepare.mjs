// 릴리스 준비(/release prepare) 순수 함수 (WP-444) — 커밋 해석·버전 자리 제안·노트 파일 검사.
// git 은 건드리지 않는다(문자열만). CLI 는 deploy/release/prepare.mjs.
import { parseVersion } from './semver.mjs';

/** Conventional Commit 제목: `type(scope)!: 제목` — scope·`!` 는 선택. */
const SUBJECT_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:/;
/**
 * 이슈 키 — 제목과 본문의 `Refs:` 줄에서만(본문의 「선례 WP-96」·「후속 WP-434」 같은 언급은 이 릴리스의 변경이 아니다).
 * 체크리스트의 pickIssues(lib/checklist.mjs)는 운영자가 범위를 훑는 용도라 feat/fix 제목의 `(WP-n)` 만 본다 — 노트 초안은 그 밖의 종류도 읽어야 해서 따로 둔다.
 */
const ISSUE_KEY_RE = /\bWP-\d+\b/g;
const REFS_LINE_RE = /^Refs:.*$/gm;
/** 본문의 깨지는 변경 꼬리말(Conventional Commits). */
const BREAKING_RE = /^BREAKING[ -]CHANGE:/m;
/** 사용자에게 보이지 않는 종류 — 노트 초안에서 기본으로 뺀다(최종 판단은 이슈 본문을 읽고 사람이 한다). */
const INTERNAL_TYPES = new Set(['test', 'refactor', 'chore', 'ci', 'build', 'docs', 'style']);
/** 사용자 화면과 무관한 scope — scope 가 모두 이 중 하나면 feat/fix 여도 내부 변경으로 본다(배포·저장소 도구). */
const INTERNAL_SCOPES = new Set(['infra', 'repo']);

/** 내부 변경인가 — 종류가 내부이거나, scope 가 모두 내부 scope. 형식 밖 제목은 사람이 판단하도록 내부로 보지 않는다. */
function isInternal(type, scope) {
  if (type === null) return false;
  if (INTERNAL_TYPES.has(type)) return true;
  const scopes = scope.split(',').map((x) => x.trim()).filter(Boolean);
  return scopes.length > 0 && scopes.every((x) => INTERNAL_SCOPES.has(x));
}

/** 커밋 구분자: `git log --format=%H%x1f%s%x1f%b%x1e` 의 필드(US)·레코드(RS) 구분 문자. */
export const LOG_FORMAT = '%H%x1f%s%x1f%b%x1e';

/**
 * `git log --format=LOG_FORMAT` 출력을 커밋 목록으로 바꾼다(git log 순서 그대로 — 최신이 먼저).
 * 각 항목: `{ sha, subject, type, scope, breaking, keys, internal }`. 형식 밖 제목은 type null.
 */
export function parseCommits(raw) {
  return raw
    .split('\x1e')
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [sha, subject = '', body = ''] = rec.split('\x1f');
      const m = SUBJECT_RE.exec(subject);
      const type = m ? m[1] : null;
      const scope = m?.[2] ?? '';
      const keys = [...new Set(`${subject}\n${(body.match(REFS_LINE_RE) ?? []).join('\n')}`.match(ISSUE_KEY_RE) ?? [])].sort(byKey);
      return {
        sha: sha.trim(),
        subject,
        type,
        scope: scope || null,
        breaking: Boolean(m?.[3]) || BREAKING_RE.test(body),
        keys,
        internal: isInternal(type, scope),
      };
    });
}

/** WP 키를 번호 순으로 — WP-9 가 WP-10 앞. */
function byKey(a, b) {
  return Number(a.slice(3)) - Number(b.slice(3));
}

/**
 * 버전 자리: 깨지는 변경 → major, feat → minor, 그 밖 → patch. 커밋이 없으면 null(릴리스할 것 없음).
 * 내부 변경(테스트·리팩터·배포 도구 — 노트에서 빠지는 것)은 자리를 올리지 않는다(버전과 노트가 어긋나지 않게).
 */
export function bumpOf(commits) {
  if (commits.length === 0) return null;
  const visible = commits.filter((c) => !c.internal);
  if (visible.some((c) => c.breaking)) return 'major';
  if (visible.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

/** 기준 버전에 자리를 올린 다음 버전. 0.x 에서는 깨지는 변경도 minor 로 올린다(semver 1.0 이전 관례 — 1.0.0 은 사람이 정한다). */
export function nextVersion(baseVersion, bump) {
  const v = parseVersion(baseVersion);
  if (!v) throw new Error(`잘못된 기준 버전: ${JSON.stringify(baseVersion)}`);
  if (bump === 'major' && v.major === 0) return `0.${v.minor + 1}.0`;
  if (bump === 'major') return `${v.major + 1}.0.0`;
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (bump === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  throw new Error(`잘못된 자리: ${JSON.stringify(bump)}`);
}

/**
 * 노트 초안에 쓸 요약 — 이슈 키별로 커밋을 묶고, 내부 커밋만 있는 이슈는 internal 로 표시한다.
 * 키가 없는 커밋은 따로 모은다(사용자 체감 변경일 수 있어 버리지 않는다).
 */
export function summarize(commits) {
  const issues = new Map();
  const unkeyed = [];
  for (const c of commits) {
    if (c.keys.length === 0) {
      unkeyed.push({ sha: c.sha.slice(0, 12), subject: c.subject, internal: c.internal });
      continue;
    }
    for (const key of c.keys) {
      const entry = issues.get(key) ?? { key, subjects: [], internal: true };
      entry.subjects.push(c.subject);
      entry.internal &&= c.internal;
      issues.set(key, entry);
    }
  }
  return { issues: [...issues.values()].sort((a, b) => byKey(a.key, b.key)), unkeyed };
}

/** 노트 파일명의 semver(확장자 제외) — 앱의 parseReleaseNote 와 같은 규칙(x.y.z, 릴리스 태그는 프리릴리스 없음). */
const NOTE_NAME_RE = /^(\d+\.\d+\.\d+)\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 릴리스 노트 파일 검사 — 문제 목록을 돌려준다(빈 배열 = 통과).
 * 앱(apps/workplace-web/src/lib/releaseNotes.ts)은 형식이 틀린 노트를 조용히 빼거나 그대로 보여 주고,
 * pre-commit/pre-push 는 releases/ 를 비코드로 건너뛰므로 노트를 검사하는 곳은 여기뿐이다 — 앱 파서와 맞춰 둔다.
 * - 파일명 `<x.y.z>.md`, 맨 앞 `---` frontmatter(한 줄 `key: value`)
 * - version 은 파일명과 같고, date 는 YYYY-MM-DD, hidden 은 있으면 true/false, range 는 있으면 `<기준>..<커밋>`
 * - 본문이 비어 있지 않다(숨김 노트도 「사용자에게 보이는 변경 없음」 한 줄)
 */
export function checkNote(fileName, raw) {
  const problems = [];
  const name = NOTE_NAME_RE.exec(fileName);
  if (!name) problems.push(`파일명이 <x.y.z>.md 가 아니다: ${fileName}`);
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const fm = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (!fm) return [...problems, '맨 앞에 --- 로 감싼 frontmatter 가 없다'];

  const meta = {};
  for (const line of (fm[1] ?? '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  if (name && meta.version !== name[1]) problems.push(`frontmatter version(${meta.version ?? '없음'})이 파일명(${name[1]})과 다르다`);
  if (!DATE_RE.test(meta.date ?? '')) problems.push(`date 가 YYYY-MM-DD 가 아니다: ${meta.date ?? '없음'}`);
  if (meta.hidden !== undefined && meta.hidden !== 'true' && meta.hidden !== 'false') problems.push(`hidden 은 true 나 false: ${meta.hidden}`);
  if (meta.range !== undefined && !/^\S+\.\.\S+$/.test(meta.range)) problems.push(`range 는 <기준>..<커밋>: ${meta.range}`);
  if (text.slice(fm[0].length).trim() === '') problems.push('본문이 비었다(숨김 노트도 「사용자에게 보이는 변경 없음」 한 줄)');
  return problems;
}
