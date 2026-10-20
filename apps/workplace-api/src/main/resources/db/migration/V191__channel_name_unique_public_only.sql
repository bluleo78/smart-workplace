-- WP-590: 채널 이름 유일성 범위를 공개 채널로 좁힌다.
-- #688(V131) 은 테넌트 전체 활성 채널 이름을 유일하게 했는데, 그러면 비멤버가 비공개 채널 이름으로 채널을 만들거나 이름을 바꿀 때
-- 409 냐 201 이냐로 그 비공개 채널이 있다는 것(과 이름)이 드러난다.
-- 결정(WP-590 A, 2026-10-20): 공개 채널 이름은 테넌트 전체에서 유일(이 인덱스), 비공개 채널 이름은 만드는·바꾸는 사람이 볼 수 있는
-- 채널(공개 + 자기가 멤버인 비공개)과만 겹치지 않으면 된다(ChannelService 가 검사 — 사람마다 범위가 달라 DB 인덱스로는 못 건다).
-- 롤링 배포 호환: 제약을 푸는 쪽이라 구 버전 코드(테넌트 전체 검사)도 그대로 동작한다.
DROP INDEX IF EXISTS uq_channel_active_name;

CREATE UNIQUE INDEX uq_channel_active_public_name
  ON channel (tenant_id, lower(name))
  WHERE kind = 'CHANNEL' AND archived_at IS NULL AND visibility = 'PUBLIC';
