-- Wiki/Drive TEAM 공간 — 동일 테넌트 내 이름 중복 방지 (#696).
-- 결정(#688/#696/#803 일괄, 2026-09-08): "컨테이너"류(채널/팀 스페이스/조직 그룹)는
-- 이름이 곧 식별자 역할을 하므로 동일 범위 내 중복을 하드 차단한다.
-- 서비스 계층 검증(WikiSpaceService/DriveSpaceService)만으로는 동시 요청 레이스를 못 막으므로
-- DB 유니크 인덱스로 보강한다. 범위는 테넌트 전역 + TEAM 타입(PERSONAL/CHANNEL 은 별도 유니크 이미 존재).

-- 인덱스 생성 전 기존 중복 데이터(탐색적 테스트로 생성된 동일 이름 공간 등) 선정리 —
-- 유니크 인덱스 생성 자체가 실패하지 않도록, 가장 오래된(id 최소) 행만 원래 이름을 유지하고
-- 나머지는 구분 접미사를 붙여 값을 갈라놓는다(삭제 아님 — 데이터 보존).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, lower(name)
    ORDER BY id
  ) AS rn
  FROM wiki_space
  WHERE type = 'TEAM'
)
UPDATE wiki_space ws
SET name = ws.name || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE ws.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, lower(name)
    ORDER BY id
  ) AS rn
  FROM drive_space
  WHERE type = 'TEAM'
)
UPDATE drive_space ds
SET name = ds.name || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE ds.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX uq_wiki_space_team_name
  ON wiki_space (tenant_id, lower(name))
  WHERE type = 'TEAM';

CREATE UNIQUE INDEX uq_drive_space_team_name
  ON drive_space (tenant_id, lower(name))
  WHERE type = 'TEAM';
