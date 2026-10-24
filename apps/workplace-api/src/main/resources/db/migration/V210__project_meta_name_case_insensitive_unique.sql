-- 프로젝트 메타 이름 — 대소문자만 다른 이름도 중복으로 막는다(WP-911).
-- 라벨·마일스톤·사용자 정의 필드·저장된 뷰는 UNIQUE(project_id, name) 이라 「DupL」「dupl」 이 둘 다 만들어져 목록·선택기에
-- 같은 이름이 둘로 보였다. 채널(V131)·조직 그룹(V129)·캘린더 태그(V197)처럼 lower(name) 유니크 인덱스로 바꾼다.
-- 서비스는 원래대로 DuplicateKeyException 을 409 로 바꾸므로 코드 변경 없이 같은 문구로 거절된다.

-- 인덱스 생성 전 기존 대소문자 중복을 선정리(V131 과 같은 방식) — 가장 오래된(id 최소) 행만 원래 이름을 유지하고 나머지는
-- 구분 접미사를 붙인다(삭제 아님 — 이슈에 붙은 라벨·마일스톤·값을 그대로 보존). 열 길이(라벨·필드 40, 뷰 60, 마일스톤 100)를
-- 넘지 않게 원래 이름 앞부분을 잘라 접미사 자리를 만든다.

-- 1) 라벨 (VARCHAR(40))
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, lower(name) ORDER BY id) AS rn FROM label
)
UPDATE label t
SET name = left(t.name, 40 - length(' (중복-' || r.rn || ')')) || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

ALTER TABLE label DROP CONSTRAINT label_project_id_name_key;
CREATE UNIQUE INDEX uq_label_project_lower_name ON label (project_id, lower(name));

-- 2) 마일스톤 (VARCHAR(100))
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, lower(name) ORDER BY id) AS rn FROM milestone
)
UPDATE milestone t
SET name = left(t.name, 100 - length(' (중복-' || r.rn || ')')) || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

ALTER TABLE milestone DROP CONSTRAINT milestone_project_id_name_key;
CREATE UNIQUE INDEX uq_milestone_project_lower_name ON milestone (project_id, lower(name));

-- 3) 사용자 정의 필드 (VARCHAR(40))
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, lower(name) ORDER BY id) AS rn FROM issue_field_def
)
UPDATE issue_field_def t
SET name = left(t.name, 40 - length(' (중복-' || r.rn || ')')) || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

ALTER TABLE issue_field_def DROP CONSTRAINT issue_field_def_project_id_name_key;
CREATE UNIQUE INDEX uq_issue_field_def_project_lower_name ON issue_field_def (project_id, lower(name));

-- 4) 저장된 뷰 — 사람마다 따로라 (project_id, owner_id) 범위 (VARCHAR(60))
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, owner_id, lower(name) ORDER BY id) AS rn FROM saved_view
)
UPDATE saved_view t
SET name = left(t.name, 60 - length(' (중복-' || r.rn || ')')) || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

ALTER TABLE saved_view DROP CONSTRAINT uq_saved_view_owner_name;
CREATE UNIQUE INDEX uq_saved_view_owner_lower_name ON saved_view (project_id, owner_id, lower(name));
