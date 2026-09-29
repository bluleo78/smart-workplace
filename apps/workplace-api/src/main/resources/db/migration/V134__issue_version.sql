-- #611 이슈 낙관적 동시성: PATCH 로 바뀌는 필드(제목·본문·상태·우선순위·일정·마일스톤)가 바뀔 때마다 1씩 오른다.
-- 유형·부모·담당자·라벨은 별도 API 라 PATCH 가 덮어쓰지 않으므로 올리지 않는다(올리면 편집 중 거짓 409).
-- 클라이언트가 마지막으로 읽은 version 을 PATCH 에 실어 보내면, 그 사이 다른 편집이 있었을 때 409 로 알린다(wiki_page.version 과 같은 방식).
-- 기존 행은 DEFAULT 1 로 채워진다 — 비어 있는 테이블 락 없이 추가되는 NOT NULL DEFAULT 상수 컬럼.
ALTER TABLE issue ADD COLUMN version INT NOT NULL DEFAULT 1;
