-- WP-417: 전역 비활성(user.is_active=false) 사람 계정을 "소속 워크스페이스 전부에서 멤버십 정지"로 옮긴다. 이제 「활성 상태」 토글은 멤버십만
-- 바꾸므로, 전역으로 꺼진 사람은 관리자가 다시 켤 수 없었다. 접근 범위는 그대로(어느 워크스페이스도 선택 불가)이고 각 관리자가 자기 것만 다시 켠다.
-- 대상: kind='HUMAN' 이고 멤버십이 1개 이상(AGENT 는 V163 고아 정리 대상이라 제외, 멤버십 없는 비활성 계정은 퇴사·보안 차단일 수 있어 그대로).
-- 플랫폼 운영자도 포함 — 전역 false 를 쓰는 곳은 테넌트 토글과 V163(AGENT)뿐이라, 꺼진 운영자는 워크스페이스 관리자가 끈 경우(=WP-417 결함)다.
-- 순서: 멤버십 정지 → 전역 켜기. 멱등(재실행 시 대상 0건). "user"·membership 은 RLS 비대상 전역 테이블.
-- 감사: audit_log 는 테넌트 RLS 라 NULL 테넌트 행은 아무도 못 보고 워크스페이스별 행은 테스트 역할로 검증할 수 없어, 대상 id 를 NOTICE 로 남긴다.
-- 테스트(GlobalInactiveToSuspendMigrationTest)가 마커 사이 블록을 그대로 다시 실행해 검증한다.

-- @wp417-migrate-begin
DO $$
DECLARE
  v_ids BIGINT[];
BEGIN
  UPDATE membership m
     SET status = 'SUSPENDED'
    FROM "user" u
   WHERE u.id = m.user_id
     AND u.kind = 'HUMAN'
     AND u.is_active = false
     AND m.status <> 'SUSPENDED';

  WITH activated AS (
    UPDATE "user" u
       SET is_active = true,
           updated_at = now()
     WHERE u.kind = 'HUMAN'
       AND u.is_active = false
       AND EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id)
    RETURNING u.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::BIGINT[]) INTO v_ids FROM activated;

  RAISE NOTICE 'WP-417 V181: 전역 비활성 → 멤버십 정지 이관 user id(%건): %', cardinality(v_ids), v_ids;
END $$;
-- @wp417-migrate-end
