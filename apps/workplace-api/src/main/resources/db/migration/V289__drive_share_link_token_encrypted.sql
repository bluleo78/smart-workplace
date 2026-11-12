-- WP-1528: 공유 링크 토큰을 다시 보여주기 위해 AES-GCM 암호문을 저장한다.
-- 형식은 EncryptionService 의 `iv:ciphertext`(Base64). 평문 토큰은 저장하지 않는다.
-- NULL = WP-1528 이전에 만든 링크(복원 불가). 공개 resolve 는 계속 token_hash 로 찾으므로
-- SECURITY DEFINER 함수 drive_share_link_resolve 는 건드리지 않는다. (expand-only: nullable 추가)
ALTER TABLE drive_share_link ADD COLUMN token_encrypted TEXT;
