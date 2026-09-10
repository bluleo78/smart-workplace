-- 채팅 채널 — 동일 테넌트 내 활성(비아카이브) 채널 이름 중복 방지 (#688).
-- 결정(#688/#696/#803 일괄, 2026-09-08): "컨테이너"류(채널/팀 스페이스/조직 그룹)는
-- 이름이 곧 식별자 역할을 하므로 동일 범위 내 중복을 하드 차단한다.
-- 서비스 계층 검증(ChannelService)만으로는 동시 요청 레이스를 못 막으므로 DB 유니크 인덱스로 보강한다.
-- 범위는 테넌트 전역 + kind='CHANNEL'(DM 은 name 이 NULL 이라 무관) + archived_at IS NULL
-- (보관된 채널은 사이드바에서 사라지므로 새 채널이 그 이름을 다시 쓸 수 있어야 한다).

-- 인덱스 생성 전 기존 중복 데이터(탐색적 테스트로 생성된 동일 이름 채널 등) 선정리 —
-- 유니크 인덱스 생성 자체가 실패하지 않도록, 가장 오래된(id 최소) 행만 원래 이름을 유지하고
-- 나머지는 구분 접미사를 붙여 값을 갈라놓는다(삭제 아님 — 데이터 보존).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, lower(name)
    ORDER BY id
  ) AS rn
  FROM channel
  WHERE kind = 'CHANNEL' AND archived_at IS NULL
)
UPDATE channel c
SET name = c.name || ' (중복-' || r.rn || ')'
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX uq_channel_active_name
  ON channel (tenant_id, lower(name))
  WHERE kind = 'CHANNEL' AND archived_at IS NULL;
