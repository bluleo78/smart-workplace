-- WP-1222: 사용자(사람·AI) 프로필 아바타. 이미지 파일은 스토리지 루트 아래 avatars/{userId}/{hash}/{size}.{ext} 에 두고
-- 여기에는 지금 쓰는 해시만 둔다. NULL 이면 기본 아바타(이니셜·색).
-- 해시는 공개 주소(/api/v1/avatars/{userId}/{hash}/{size})의 일부라 추측할 수 없는 값(결과 이미지 sha-256 앞부분)이다 — 바뀌면
-- 주소도 바뀌어 브라우저가 오래 캐시해도 된다.
-- 롤링 배포 호환(expand): NULL 허용 열 추가만 한다 — 옛 코드는 이 열을 모른 채 그대로 동작한다.
ALTER TABLE "user" ADD COLUMN avatar_hash VARCHAR(64) NULL;
