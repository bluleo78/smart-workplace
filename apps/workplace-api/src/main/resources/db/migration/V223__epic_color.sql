-- V223: 에픽 색(WP-1017) — 에픽마다 색을 정해 목록·타임라인에서 구분한다.
--
-- 1) issue.epic_color — 라벨 color_token 과 같은 12색 토큰. 에픽만 쓰고 나머지 유형은 null. DB CHECK 는 두지 않는다(검증은 ColorToken.validate).
--    nullable·기본값 없음이라 롤링 배포 중 컬럼을 모르는 구 파드의 INSERT 도 깨지지 않는다(구 파드가 만든 에픽은 색 없음 → 유형 색으로 보인다).
-- 2) 기존 에픽 백필 — 프로젝트마다 번호 순으로 팔레트(EpicColors.PALETTE 와 같은 순서, GRAY 제외 11색)를 돌려 가며 칠한다.
--    삭제된 에픽도 함께 칠한다(복원되면 색이 있게). GUC 없이 도는 테넌트 무관 단일 UPDATE 다. issue 는 FORCE RLS 지만
--    Flyway 소유자 롤은 BYPASSRLS 라 통과한다(V204·V206 과 같은 전제).

-- 1)
ALTER TABLE issue ADD COLUMN epic_color VARCHAR(16);

-- 2)
WITH ranked AS (
  SELECT i.id,
         row_number() OVER (PARTITION BY i.project_id ORDER BY i.number) AS rn
    FROM issue i
    JOIN issue_type_def t ON t.id = i.type_id
   WHERE t.name = 'EPIC'
)
UPDATE issue
   SET epic_color = (ARRAY['BLUE', 'ORANGE', 'GREEN', 'PURPLE', 'RED', 'TEAL',
                           'PINK', 'YELLOW', 'INDIGO', 'CYAN', 'BROWN'])[((ranked.rn - 1) % 11) + 1]
  FROM ranked
 WHERE issue.id = ranked.id;
