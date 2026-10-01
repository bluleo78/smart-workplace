-- V142: user_dashboard 기기별 분리(WP-142) — 모바일·데스크톱 홈 레이아웃을 따로 저장·편집한다.
-- 기존 행은 DEFAULT 로 DESKTOP 이 되어 데이터 변화 없음(기존 클라이언트는 device 를 몰라도 데스크톱 행만 읽고 쓴다).
-- 고유키 이름(user_dashboard_uq)은 유지해 jOOQ Keys 상수명이 바뀌지 않게 한다. RLS 정책은 tenant_id 기준이라 그대로.

ALTER TABLE user_dashboard
  ADD COLUMN device VARCHAR(16) NOT NULL DEFAULT 'DESKTOP';

-- 값 집합은 DashboardDevice enum 이름과 일치해야 한다(그 외 값은 앱 버그 → DB 에서 차단).
ALTER TABLE user_dashboard
  ADD CONSTRAINT user_dashboard_device_chk CHECK (device IN ('DESKTOP', 'MOBILE'));

-- 계정당 1행 → 계정·기기당 1행. upsert 충돌 대상도 (tenant_id, user_id, device) 로 바뀐다.
ALTER TABLE user_dashboard DROP CONSTRAINT user_dashboard_uq;
ALTER TABLE user_dashboard
  ADD CONSTRAINT user_dashboard_uq UNIQUE (tenant_id, user_id, device);
