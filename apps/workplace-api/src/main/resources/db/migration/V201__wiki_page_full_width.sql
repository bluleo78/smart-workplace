-- WP-793 노트 페이지 「전체 폭」 설정 — 본문을 읽기 폭(768px) 대신 화면 폭 전체로 보이게 한다.
-- 페이지에 저장돼 그 페이지를 여는 모든 사람(공유 링크 포함)에게 같다. 본문 버전 기록(리비전)에는 남기지 않는 보기 설정이다.
-- 기본 false(읽기 폭) — 기존 페이지는 모두 지금처럼 보이므로 백필 불필요. 상수 DEFAULT 라 PG 11+ 에서 테이블을 다시 쓰지 않는다.
-- 추가만 하는 컬럼이라 구·신 버전이 섞여 돌아도 안전하다(expand).
ALTER TABLE wiki_page ADD COLUMN full_width boolean NOT NULL DEFAULT false;
