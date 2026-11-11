// 매뉴얼 도움말 묶음 만들기(WP-1504): 사용자 매뉴얼을 절 단위 묶음(manual-index.json·manual/<chapter>.json·manual-vars.json)과
// 도움말 그림 PNG 로 출력 폴더에 쓴다. 웹 빌드는 Vite 플러그인이 같은 lib(buildHelpBundle)를 직접 부르고, 이 명령은
// 사람이 산출물을 눈으로 보거나 서버 이미지 빌드(MCP)가 같은 배치를 만들 때 쓴다.
// 사용: node docs/manual/scripts/help-bundle.mjs [--out <dir>]  (기본 dist/manual/help, 저장소 루트 기준)
// 시작 전에 출력 폴더를 비운다. 내용 문제(problems)는 `[종류] 파일:줄 메시지` 로 찍고 하나라도 있으면 exit 1
// (그래도 산출물은 쓴다 — 생성은 관대·판정은 엄격). 사용법 오류(모르는 인자, 저장소 루트·그 위나 저장소 안 dist/ 밖을 가리키는 --out)는 exit 2.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { BOOKS, ROOT } from './lib/books.mjs';
import { buildBookHelpBundle, writeHelpBundle } from './lib/help-bundle.mjs';

// 명령줄에서 --out 값을 읽는다. 모르는 인자는 사용법 오류로 멈춘다(오타로 엉뚱한 곳에 쓰지 않게).
function parseArgs(argv) {
  let out = 'dist/manual/help';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = argv[++i];
    else {
      console.error(`알 수 없는 인자: ${argv[i]} (사용: node docs/manual/scripts/help-bundle.mjs [--out <dir>])`);
      process.exit(2);
    }
  }
  const resolved = path.resolve(ROOT, out);
  // 출력 폴더는 시작 전에 통째로 지운다 — 저장소 루트나 그 위 폴더를 적으면 저장소가 날아가므로 사용법 오류로 막는다.
  const rel = path.relative(resolved, ROOT);
  if (rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel))) {
    console.error(`--out 은 저장소 루트이거나 그 위 폴더일 수 없습니다(시작 전에 지우므로): ${resolved}`);
    process.exit(2);
  }
  // 저장소 안이면 dist/ 아래(dist 자체 포함)만 받는다 — `--out docs/manual` 처럼 원본 폴더를 적으면 시작 전 지우기에 원고가 날아가므로.
  // 저장소 밖 경로(임시 폴더·서버 이미지 빌드 자리)는 사용자가 고른 자리라 그대로 받는다.
  const inRepo = path.relative(ROOT, resolved);
  const outsideRepo = inRepo.split(path.sep)[0] === '..' || path.isAbsolute(inRepo);
  if (!outsideRepo && inRepo.split(path.sep)[0] !== 'dist') {
    console.error(`--out 은 저장소 안이면 dist/ 아래여야 합니다(시작 전에 지우므로): ${resolved}`);
    process.exit(2);
  }
  return { out: resolved };
}

const { out } = parseArgs(process.argv.slice(2));
// 묶음은 사용자 책만(운영자 앱 도움말은 범위 밖 — 설계 2절). 그림 PNG 는 미리 만들어 커밋한 폴더에서 복사한다.
// 그림 폴더·그림 있음 판정·문제 줄 서식은 웹 vite 플러그인과 같은 buildBookHelpBundle 이 정한다.
const { bundle, figuresDir, problemLines } = await buildBookHelpBundle(BOOKS.user);

await rm(out, { recursive: true, force: true });
await writeHelpBundle(bundle, out, { figuresDir });

// 형식 검증 오류(생성기 버그 안전망 — 내용 문제가 아니라 코드 문제지만 그래도 exit 1)와 내용 문제를 그 순서로 찍는다.
for (const line of problemLines) console.log(line);

const sections = bundle.index.reduce((n, c) => n + c.sections.length, 0);
console.log(
  `도움말 묶음: 장 ${bundle.index.length} · 절 ${sections} · 그림 ${bundle.figures.length} · 문제 ${bundle.problems.length} → ${path.relative(ROOT, out) || '.'}`,
);
process.exit(problemLines.length ? 1 : 0);
