#!/usr/bin/env node
// 버린 릴리스 기록(deploy/release/abandoned-releases.json)의 형식을 push 하는 커밋 시점으로 검사한다 (WP-1349).
// 이 파일만 바뀐 push 는 전체 회귀를 생략하므로, 형식 오류가 태그 검증(verify-tag)·prepare 까지 숨어 가지 않게 여기서 막는다.
// 릴리스 도구가 쓰는 abandonedReleases() 를 그대로 호출한다. 사용: node check-abandoned-releases.mjs <커밋 sha> (현재 디렉터리 = 저장소)
import { abandonedReleases, defaultExec } from '../../deploy/release/lib/build.mjs';

try {
  abandonedReleases({ exec: defaultExec, repoRoot: process.cwd(), ref: process.argv[2] });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
