-- V190 (WP-525): 채널이 삭제돼 연결이 끊긴(linked_channel_id IS NULL) 채널 연동 드라이브 공간을 한 번 정리한다.
-- 채널 삭제 시 linked_channel_id 가 ON DELETE SET NULL 로 끊기기만 해, 예전 멤버가 계속 읽고 쓰고 외부 공유 링크도 살아 있었으며
-- 소유자·관리자 누구도 지울 수 없었다. 새 삭제는 ChannelDeletingEvent → DriveChannelSpaceService.deleteChannelSpace 가 같은
-- 트랜잭션에서 처리한다 — 이 마이그레이션은 그 이전에 남은 공간만 지운다(팀 공간 삭제와 같은 방식: blob 만료 표시 후 공간 행 삭제,
-- 파일·폴더·버전·멤버·공유 링크 행은 cascade). 만료 표시된 blob 은 FileCleanupService 가 회수한다.
-- 데이터만 지우므로 구·신 버전 공존(롤링 배포)에 영향이 없다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
UPDATE file
SET expires_at = now()
WHERE id IN (
  SELECT df.file_id
  FROM drive_file df
  JOIN drive_space s ON s.id = df.space_id
  WHERE s.type = 'CHANNEL' AND s.linked_channel_id IS NULL
  UNION
  SELECT v.file_id
  FROM drive_file_version v
  JOIN drive_file df ON df.id = v.drive_file_id
  JOIN drive_space s ON s.id = df.space_id
  WHERE s.type = 'CHANNEL' AND s.linked_channel_id IS NULL
);

DELETE FROM drive_space
WHERE type = 'CHANNEL' AND linked_channel_id IS NULL;
