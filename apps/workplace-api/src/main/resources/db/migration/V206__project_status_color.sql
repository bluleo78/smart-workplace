-- V206: 프로젝트 상태 색(WP-809) + 알림의 상태 이름 칸(WP-704 2차 — 후속 태스크가 쓴다).
--
-- 1) project_status.color — 라벨 color_token 과 같은 12색 토큰. DB CHECK 는 두지 않는다(라벨과 같이 검증은 ColorToken.validate).
--    DEFAULT 'GRAY' 는 롤링 배포 중 color 를 모르는 구 파드의 INSERT 가 깨지지 않게 남긴다(구 파드가 만든 상태는 GRAY — 허용).
-- 2) 기존 행 백필 — 범주 기본 색(TODO·CANCELED→GRAY, IN_PROGRESS→BLUE, DONE→GREEN). StatusDefaultColors 와 같은 매핑.
--    GUC 없이 도는 테넌트 무관 단일 UPDATE 다. project_status 는 FORCE RLS 지만 Flyway 소유자 롤은 BYPASSRLS 라 통과한다(V204 와 같은 전제).
-- 3) 새 프로젝트 시드 트리거 함수가 4상태에 범주 기본 색을 함께 넣게 바꾼다(트리거 자체는 그대로).
-- 4) notification.status_name — 상태 변경 알림에 상태 이름을 싣기 위한 nullable 칸(expand-safe, 한 마이그레이션으로 묶는다).

-- 1)
ALTER TABLE project_status ADD COLUMN color VARCHAR(16) NOT NULL DEFAULT 'GRAY';

-- 2)
UPDATE project_status
   SET color = CASE category
                 WHEN 'IN_PROGRESS' THEN 'BLUE'
                 WHEN 'DONE' THEN 'GREEN'
                 ELSE 'GRAY'
               END
 -- 나머지 범주(TODO·CANCELED)는 컬럼 기본값이 이미 GRAY 라 바뀌는 행만 쓴다.
 WHERE category IN ('IN_PROGRESS', 'DONE');

-- 3)
CREATE OR REPLACE FUNCTION project_seed_statuses()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_status (tenant_id, project_id, name, category, position, color)
  VALUES (NEW.tenant_id, NEW.id, '할 일', 'TODO', 0, 'GRAY'),
         (NEW.tenant_id, NEW.id, '진행 중', 'IN_PROGRESS', 1, 'BLUE'),
         (NEW.tenant_id, NEW.id, '완료', 'DONE', 2, 'GREEN'),
         (NEW.tenant_id, NEW.id, '취소', 'CANCELED', 3, 'GRAY');
  RETURN NULL;
END;
$$;

-- 4)
ALTER TABLE notification ADD COLUMN status_name VARCHAR(30);
