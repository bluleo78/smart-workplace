-- V204: 프로젝트별 이슈 상태(WP-807).
-- 이슈 상태를 고정 4값(issue.status)에서 프로젝트가 정의하는 상태 목록(project_status)으로 넓힌다.
-- issue.status 는 상태의 범주(TODO/IN_PROGRESS/DONE/CANCELED)로 남고, issue.status_id 가 실제 상태를 가리킨다.
-- 복합 FK (status_id, project_id, status) → project_status(id, project_id, category) 가 "같은 프로젝트의 상태" 와
-- "범주 일치" 를 DB 수준에서 함께 보장한다.
--
-- 함수·트리거:
--   (a) project_status_default_id() : 범주 기본 상태(가장 앞 position) id 조회 — (c) 가 쓴다.
--   (b) trg_project_seed_statuses    : 새 프로젝트에 기본 4상태를 시드한다. 영구 — 애플리케이션은 상태를 따로 시드하지 않으므로
--                                      이 트리거가 유일한 시드 경로다(구 파드·직접 INSERT 포함). 지우지 않는다.
--   (c) trg_issue_status_id_sync     : 구 코드가 status 만 쓰고 status_id 를 모를 때 범주 기본 상태로 맞춘다.
--                                      롤링 배포 중 status_id 를 모르는 구 파드와 새 파드가 함께 쓰기 때문에 둔 임시 호환 장치로,
--                                      후속 이슈에서 지울 것은 (c) 뿐이다.

-- ============================================================
-- 1) project_status 테이블·인덱스·RLS
-- ============================================================
CREATE TABLE project_status (
    id          BIGSERIAL   PRIMARY KEY,
    tenant_id   BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                            REFERENCES tenant(id),
    project_id  BIGINT      NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        VARCHAR(30) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
    category    VARCHAR(16) NOT NULL CHECK (category IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED')),
    position    INT         NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- issue 복합 FK 의 참조 대상. id 만으로도 유일하지만 FK 가 (id, project_id, category) 를 함께 가리키려면 필요하다.
    CONSTRAINT uq_project_status_id_project_category UNIQUE (id, project_id, category)
);

-- 이름은 프로젝트 안에서 대소문자·앞뒤 공백 무시 유일.
CREATE UNIQUE INDEX uq_project_status_name ON project_status (project_id, lower(btrim(name)));
-- 보드 컬럼·범주 기본 상태 조회(범주별 position 순).
CREATE INDEX idx_project_status_project ON project_status (project_id, category, position);
CREATE INDEX idx_project_status_tenant ON project_status (tenant_id);

-- V48 과 같은 NULLIF fail-closed 테넌트 격리. FORCE 는 아래 시드·백필 뒤(3 끝)에 건다.
ALTER TABLE project_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_status_tenant_isolation ON project_status
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) 기존 모든 프로젝트에 기본 4상태 시드
-- ============================================================
INSERT INTO project_status (tenant_id, project_id, name, category, position)
SELECT p.tenant_id, p.id, v.name, v.category, v.pos
  FROM project p
 CROSS JOIN (VALUES ('할 일', 'TODO', 0),
                    ('진행 중', 'IN_PROGRESS', 1),
                    ('완료', 'DONE', 2),
                    ('취소', 'CANCELED', 3)) AS v(name, category, pos);

-- ============================================================
-- 3) issue.status_id 추가·백필·NOT NULL·복합 FK
-- ============================================================
-- issue 에는 걸린 트리거가 없으므로(작성 시점 확인) 백필 UPDATE 는 단일 문으로 둔다.
-- 시드 직후라 프로젝트·범주당 상태가 정확히 하나여서 (project_id, status) 로 대응 상태가 하나로 정해진다.
ALTER TABLE issue ADD COLUMN status_id BIGINT;

UPDATE issue i
   SET status_id = ps.id
  FROM project_status ps
 WHERE ps.project_id = i.project_id
   AND ps.category = i.status;

ALTER TABLE issue ALTER COLUMN status_id SET NOT NULL;

-- ON UPDATE CASCADE: 상태의 범주를 바꾸면(WP-811) 그 상태를 쓰는 이슈의 status(범주)가 따라간다.
-- ON DELETE RESTRICT: 이슈가 쓰는 상태는 지울 수 없다(이동 후 삭제는 애플리케이션 몫).
ALTER TABLE issue
  ADD CONSTRAINT fk_issue_status_category
  FOREIGN KEY (status_id, project_id, status)
  REFERENCES project_status (id, project_id, category)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- 보드 상태 컬럼(프로젝트 + 상태 id, 최근 수정 순 키셋)용 — 범주 인덱스 idx_issue_project_status_updated(V5)와 같은 모양.
-- 앞머리 (project_id, status_id) 가 상태 삭제 시 복합 FK(ON DELETE RESTRICT) 참조 검사도 받친다.
CREATE INDEX idx_issue_project_status_id_updated ON issue (project_id, status_id, updated_at DESC);

-- V182·V183·V185·V197 처럼 소유자에게도 RLS 를 강제한다. GUC 없이 쓰는 위 시드·백필 뒤에 둔다
-- (Flyway 소유자 롤은 BYPASSRLS 라 순서와 상관없이 통과하지만, 데이터 쓰기 뒤에 두어 그 전제에 기대지 않는다).
-- 런타임 쓰기(트리거 시드 포함)는 app.tenant_id GUC 아래에서 NEW.tenant_id 로 쓰므로 정책을 통과한다.
ALTER TABLE project_status FORCE ROW LEVEL SECURITY;

-- ============================================================
-- 4) 함수·트리거
-- ============================================================
-- (a) 범주 기본 상태 = 그 범주에서 position 이 가장 앞인 상태(동률이면 id 순).
CREATE FUNCTION project_status_default_id(p_project_id BIGINT, p_category TEXT)
RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT ps.id
    FROM project_status ps
   WHERE ps.project_id = p_project_id
     AND ps.category = p_category
   ORDER BY ps.position, ps.id
   LIMIT 1
$$;

-- (b) 새 프로젝트에 기본 4상태 시드(영구 — 유일한 시드 경로). 구 파드·직접 INSERT 경로 모두에서 상태 없는 프로젝트가 생기지 않게 한다.
--     tenant_id 는 GUC 기본값이 아닌 프로젝트의 값을 그대로 쓴다.
CREATE FUNCTION project_seed_statuses()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_status (tenant_id, project_id, name, category, position)
  VALUES (NEW.tenant_id, NEW.id, '할 일', 'TODO', 0),
         (NEW.tenant_id, NEW.id, '진행 중', 'IN_PROGRESS', 1),
         (NEW.tenant_id, NEW.id, '완료', 'DONE', 2),
         (NEW.tenant_id, NEW.id, '취소', 'CANCELED', 3);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_project_seed_statuses
  AFTER INSERT ON project
  FOR EACH ROW EXECUTE FUNCTION project_seed_statuses();

-- (c) status ↔ status_id 동기화(구 파드 호환 — 후속 이슈에서 제거).
--     - status_id 없이 INSERT/UPDATE: 범주 기본 상태로 채운다(구 코드의 INSERT).
--     - UPDATE 에서 status_id 는 그대로인데 참조 상태의 "현재" 범주·프로젝트가 NEW 와 다를 때만 범주 기본 상태로 바꾼다
--       (구 코드가 status 나 project_id 만 바꾼 경우).
--     - 상태 범주 변경의 ON UPDATE CASCADE 는 참조 행이 이미 새 범주라 조건에 걸리지 않아 status_id 가 유지된다.
--     - status_id 를 직접 바꾼 경우는 손대지 않는다 — 어긋나면 복합 FK 가 거절한다.
CREATE FUNCTION issue_status_id_sync()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_id IS NULL THEN
    NEW.status_id := project_status_default_id(NEW.project_id, NEW.status);
  ELSIF TG_OP = 'UPDATE' AND NEW.status_id = OLD.status_id
        AND NOT EXISTS (SELECT 1 FROM project_status ps
                         WHERE ps.id = NEW.status_id AND ps.project_id = NEW.project_id
                           AND ps.category = NEW.status) THEN
    NEW.status_id := project_status_default_id(NEW.project_id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_issue_status_id_sync
  BEFORE INSERT OR UPDATE OF status, status_id, project_id ON issue
  FOR EACH ROW EXECUTE FUNCTION issue_status_id_sync();
