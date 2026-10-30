#!/usr/bin/env node
/**
 * 매뉴얼 화면 촬영.
 *
 *   MANUAL_BOOK=user MANUAL_WEB=http://localhost:6273 MANUAL_API=http://localhost:6160 MANUAL_PASS=... pnpm manual:shots
 *   MANUAL_SHOTS_ONLY=home,issue-list ...   # 일부만 다시 찍기 (boxes.json 은 샷 단위로 합쳐진다)
 *
 * 환경변수: MANUAL_BOOK(기본 user) · MANUAL_WEB · MANUAL_API · MANUAL_PASS(로그 출력 금지) · MANUAL_SHOTS_ONLY(쉼표 id).
 * MANUAL_WEB·MANUAL_API·MANUAL_PASS 는 기본값이 없다 — 촬영할 장면이 있는데 하나라도 비면 이름만 알리고 exit 1.
 * (기본값을 두면 공유 개발 웹과 격리 API 처럼 서로 다른 스택을 섞어 찍을 수 있어서다.)
 * 종료 코드: 0 성공·장면 없음, 1 촬영 실패·환경변수 누락, 2 사용법 오류(알 수 없는 책·장면이 없는 id).
 * 전제: 시드가 끝난 격리 스택. 운영·공유 DB 를 찍지 않는다.
 *
 * 결정적으로 찍는다: 촬영 컨텍스트(newShotContext)가 모든 문서에서 토스트를 숨기고 애니메이션·전환을 0초로 만들며, rec.shoot 이 입력 커서를 숨긴다.
 * 그 밖에 촬영 중 스스로 바뀌는 UI(유휴 자동 복귀, 회전하는 캐러셀, 상대 시간 표기)는
 * 장면이 끄거나 고정한다(smart-dcim 교훈). 장면별 실패는 모아서 끝에 보고하고 하나라도 실패면 exit 1.
 * 실패한 장면이 기록하던 좌표와 임시 그림은 버린다(rec.begin/commit/discard) — boxes.json·PNG 에는 끝까지 성공한 장면만 반영된다.
 * Playwright 는 장면이 있을 때만 불러온다 — 장면 0개면 브라우저 없이 정상 종료한다.
 */
import { resolveBooks } from './lib/books.mjs';
import { runCapture } from './lib/run-scenes.mjs';

const [book] = resolveBooks(process.env.MANUAL_BOOK); // 생략하면 user
const { scenes } = await import(`./scenes/${book.key}.mjs`);
process.exit(await runCapture({ label: book.key, scenes, capture: book.capture, recorder: { book: book.key } }));
