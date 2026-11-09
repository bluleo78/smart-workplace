-- V277 (WP-1458): 보고 키가 활성 연결 행 id 뿐 아니라 «묶인 계정의 version»도 될 수 있게 한다.
-- ChatGPT·Gen:iA 로그인 계정은 새 UI(계정 고르기)에서 고를 수 있고, 그런 AI 의 모델 목록은 Pod 보고로 채운다 — 그 보고의 version 은
-- ActiveCredentialRef(id = 계정 secret_version)라 ai_agent_credential 행 id 가 아니다. 그래서 자격 참조를 풀어, 두 종류의 로그인 버전을 모두 담는다
-- (기존 연결 행 id 값은 그대로 유효 — 오래된 코드는 id 만 보고한다).
--   - 풀어도 조회 규칙은 안 바뀐다: 보고는 (테넌트·AI)당 하나이고, 조회는 저장된 version 이 «지금 그 로그인 정보의 version»일 때만 쓴다
--     (코드가 활성 연결 행 / 묶인 계정 참조와 대조). 연결·묶음을 바꾸면 옛 보고는 자연히 무시된다.
--   - column 제약(NOT NULL 등)은 그대로 — 보고는 항상 version 과 함께 온다. 색인·RLS 그대로. 계약 단계(왼쪽 칸 정리)는 다음 배포.
-- 롤링 배포 호환: 옛 코드는 FK 가 있던 시절대로 id 를 쓰고, FK 제거는 열람에 영향이 없다.

ALTER TABLE agent_reported_model DROP CONSTRAINT IF EXISTS agent_reported_model_credential_id_fkey;
