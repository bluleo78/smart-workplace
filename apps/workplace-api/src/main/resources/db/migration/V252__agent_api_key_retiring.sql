-- V252__agent_api_key_retiring.sql
-- WP-1263: Works 자동 발급(managed) 키가 「정리 유예에 들었다」는 것을 칸으로 남긴다.
--   retiring_at : 끄기·위치 이동·삭제·「내부 · 기본」 전환·교체 확인으로 정리 유예(만료 = 지금 + 5분)로 줄인 시각. NULL 이면 지금 쓰는 키다.
-- 지금까지는 「만료가 지금 + 5분 안이면 유예 중」으로 시각을 견줘 짐작했다(ManagedKeyChain#live) — 이제는 이 칸이 NULL 인 키만 지금 쓰는 키로 본다.
-- 칸 추가만이라 옛 버전 코드(이 칸을 모름)와 함께 돌아도 된다(롤링 배포 호환).
ALTER TABLE agent_api_key ADD COLUMN retiring_at TIMESTAMPTZ;

-- 배포 시점에 이미 유예로 줄어 있던 키도 같은 뜻으로 보이게 채운다 — 회수되지 않은 managed 키 중 만료가 5분 안에 오는 키(옛 판정과 같은 기준).
UPDATE agent_api_key
   SET retiring_at = now()
 WHERE managed
   AND revoked_at IS NULL
   AND expires_at IS NOT NULL
   AND expires_at <= now() + interval '5 minutes';
