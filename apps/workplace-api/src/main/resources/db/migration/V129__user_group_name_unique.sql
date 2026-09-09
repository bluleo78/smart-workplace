-- 연락처 조직 그룹 — 동일 부모 내 이름 중복 방지 (#803).
-- 결정(#688/#696/#803 일괄, 2026-09-08): "컨테이너"류(채널/팀 스페이스/조직 그룹)는
-- 이름이 곧 식별자 역할을 하므로 동일 범위 내 중복을 하드 차단한다.
-- 서비스 계층 검증(UserGroupService)만으로는 동시 요청 레이스를 못 막으므로 DB 유니크 인덱스로 보강.
--
-- 범위는 visibility 별로 다르다:
--   SHARED   : (tenant_id, parent_id, lower(name)) — 조직도는 테넌트 전역 공용 트리.
--   PERSONAL : (tenant_id, owner_id, parent_id, lower(name)) — 개인 그룹은 소유자별 트리라
--              서로 다른 소유자의 최상위(parent_id NULL) 그룹은 형제가 아니다.
-- parent_id 는 NULL 이 여러 개 있어도 서로 다른 값으로 취급되어 유니크 제약이 무력화되므로
-- COALESCE(parent_id, 0) 로 표현식 인덱스를 만든다(id 는 1부터 시작하는 BIGSERIAL 이라 0 과 충돌 없음).

-- 인덱스 생성 전 기존 중복 데이터(탐색적 테스트로 생성된 동일 이름 그룹 등) 선정리 —
-- 유니크 인덱스 생성 자체가 실패하지 않도록, 가장 오래된(id 최소) 행만 원래 이름을 유지하고
-- 나머지는 구분 접미사를 붙여 값을 갈라놓는다(삭제 아님 — 데이터 보존).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, COALESCE(parent_id, 0), lower(name)
    ORDER BY id
  ) AS rn
  FROM user_group
  WHERE visibility = 'SHARED'
)
UPDATE user_group ug
SET name = ug.name || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE ug.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, owner_id, COALESCE(parent_id, 0), lower(name)
    ORDER BY id
  ) AS rn
  FROM user_group
  WHERE visibility = 'PERSONAL'
)
UPDATE user_group ug
SET name = ug.name || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE ug.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX uq_user_group_shared_sibling_name
  ON user_group (tenant_id, COALESCE(parent_id, 0), lower(name))
  WHERE visibility = 'SHARED';

CREATE UNIQUE INDEX uq_user_group_personal_sibling_name
  ON user_group (tenant_id, owner_id, COALESCE(parent_id, 0), lower(name))
  WHERE visibility = 'PERSONAL';
