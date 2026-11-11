-- 프로젝트 노트 공간(WP-1480): 팀(TEAM) 노트 공간을 프로젝트 하나에 잇는다.
-- type 은 TEAM 그대로 둔다 — 기존 팀 공간을 프로젝트에 연결할 때 이 컬럼 값만 바꾸면 되게(새 type 을 만들지 않는다).
-- 프로젝트 삭제는 soft delete 이고 그때 앱이 연결을 끊어 일반 팀 공간으로 남긴다(ProjectNoteSpaceService.onProjectDeleted).
-- 프로젝트 행의 하드 삭제는 앱 경로에 없고 워크스페이스 영구 삭제·테스트 정리에서만 일어난다 — 그때는 공간도 함께 지운다(ON DELETE CASCADE).
-- SET NULL 이면 주인 없는 공간이 남아 그 소유자(owner_id → user) 행을 지우는 정리가 FK 에 막힌다.
-- expand 전용: NULL 허용 컬럼 + 부분 유일 인덱스라 옛 버전 코드는 이 컬럼을 모른 채 그대로 동작한다.
ALTER TABLE wiki_space
  ADD COLUMN linked_project_id BIGINT NULL REFERENCES project(id) ON DELETE CASCADE;

-- 프로젝트당 연결 공간 1개 — 동시 생성(이벤트·백필)이 겹쳐도 두 번째는 유일 위반으로 막힌다(드라이브 채널 공간 V77 과 같은 방식).
CREATE UNIQUE INDEX uq_wiki_space_linked_project
  ON wiki_space(linked_project_id) WHERE linked_project_id IS NOT NULL;
