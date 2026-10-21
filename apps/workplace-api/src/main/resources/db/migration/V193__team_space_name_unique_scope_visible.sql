-- WP-693: 드라이브·노트 TEAM 공간 이름 유일성 범위를 「만드는·바꾸는 사람이 볼 수 있는(멤버인) 공간」으로 좁힌다.
-- #696(V130) 은 테넌트 전체 TEAM 공간 이름을 유일하게 했는데, TEAM 공간은 멤버에게만 보이므로 비멤버가 어떤 이름으로 만들어 볼 때
-- 409 냐 201 이냐로 그 비공개 공간이 있다는 것(과 이름)이 드러난다. 채널 WP-590(V191) 과 같은 정책 — 사람마다 볼 수 있는 범위가
-- 달라 DB 인덱스로는 못 걸고 DriveSpaceService·WikiSpaceService 가 검사한다.
-- 롤링 배포 호환: 제약을 푸는 쪽이라 구 버전 코드(테넌트 전체 검사)도 그대로 동작한다.
DROP INDEX IF EXISTS uq_drive_space_team_name;
DROP INDEX IF EXISTS uq_wiki_space_team_name;
