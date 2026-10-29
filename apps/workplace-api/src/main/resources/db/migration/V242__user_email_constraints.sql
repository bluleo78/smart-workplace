-- WP-1156: 사용자 이메일을 DB 가 직접 지키게 한다(WP-1098 리뷰에서 남은 위험 세 가지).
-- 1. V234 는 btrim(공백만)으로 정리해 탭·줄바꿈뿐인 이메일이 남았다 — 보이는 글자가 없는 이메일을 「이메일 없음」(NULL)으로 맞춘다.
-- 2. 대소문자만 다른 이메일 — 코드는 대소문자 무시로 중복을 검사하지만(UserRepository.existsByEmail) 고유 인덱스(V2)는 대소문자를 가려
--    동시에 저장하면 둘 다 들어갔다. 이미 겹친 이메일은 가장 먼저 만든 계정(id 가 가장 작은)만 남기고 나머지 계정의 이메일을 비운다
--    (로그인은 아이디로 하므로 막히지 않는다 — 비운 계정은 이메일을 다시 넣어야 한다).
-- 3. 빈 이메일을 DB 가 막지 않았다 — 「NULL 이거나 공백류가 아닌 글자가 하나는 있음」 CHECK 를 둔다.
-- 공백류는 ASCII 공백·탭·줄바꿈·CR·FF·VT 로 정한다 — 코드(Texts.blankToNull, String.isBlank)가 비었다고 보는 값의 부분집합이라, 코드가
-- 비어 있지 않다고 보고 저장하는 값을 이 제약이 거절하는 일이 없다.
-- 구·신 버전 공존: 배포된 코드(v0.9.31, WP-1098)는 이미 빈 이메일을 NULL 로 저장하고 대소문자 무시로 중복을 검사하므로 새 제약과 부딪히지 않는다.
-- 기존 대소문자 구분 인덱스(idx_user_email_unique)는 새 인덱스가 포함하지만 지우기는 다음 배포로 미룬다(expand/contract).
UPDATE "user" SET email = NULL WHERE email IS NOT NULL AND email !~ '[^ \t\n\r\f\v]';

UPDATE "user" u
   SET email = NULL
  FROM (SELECT id,
               row_number() OVER (PARTITION BY lower(email) ORDER BY id) AS rn
          FROM "user"
         WHERE email IS NOT NULL) d
 WHERE u.id = d.id
   AND d.rn > 1;

ALTER TABLE "user"
  ADD CONSTRAINT chk_user_email_not_blank CHECK (email IS NULL OR email ~ '[^ \t\n\r\f\v]');

CREATE UNIQUE INDEX idx_user_email_lower_unique ON "user" (lower(email)) WHERE email IS NOT NULL;
