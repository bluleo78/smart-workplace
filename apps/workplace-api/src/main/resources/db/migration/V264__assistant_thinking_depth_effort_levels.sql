-- WP-1322: 「생각의 깊이」를 모델이 실제로 받는 추론 노력 단계로 바꾼다.
--   예전 값 NONE/NORMAL/DEEP 은 시스템 프롬프트에 문장 하나를 덧붙일 뿐이었다(ai-agent thinking.ts).
--   새 값: DEFAULT(설정 안 함 — 모델 기본값) / LOW / MEDIUM / HIGH / XHIGH / MAX.
--   Claude 는 Agent SDK effort 로, OpenAI 호환(opencode)은 모델 variant 로 그대로 전달한다.
--
-- 롤링 배포 호환(expand): 이번에는 허용값을 넓히기만 하고 옛 값(NONE/NORMAL/DEEP)도 CHECK 에 남긴다 — 배포 중 구 api 파드가
-- 옛 값을 쓰면 CHECK 에 막혀 설정 저장이 실패하기 때문이다. 새 api 는 옛 값을 받으면 저장 전에 아래와 같은 규칙으로 새 값으로 바꾸고(옛 웹 화면 호환), 읽은 옛 값은 DEFAULT 로 다룬다
-- (ai-agent·웹). 옛 값을 CHECK 에서 빼는 것(contract)은 구 코드가 운영에서 사라진 다음 배포에서 한다.

ALTER TABLE assistant_config DROP CONSTRAINT assistant_config_thinking_depth_check;
ALTER TABLE assistant_config ADD CONSTRAINT assistant_config_thinking_depth_check
  CHECK (thinking_depth IS NULL OR thinking_depth IN (
    'DEFAULT', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX',
    'NONE', 'NORMAL', 'DEEP' -- 옛 값: 롤링 배포 구간 호환용(다음 배포에서 제거)
  ));

-- 기존 행 이관. 비서 AGENT 의 지금 연결(ai_agent_credential 의 revoked_at IS NULL 행, 에이전트당 하나)의 provider 로 나눈다.
--   Claude(anthropic) 연결: NONE→LOW, NORMAL→HIGH, DEEP→MAX — 예전 의도(끄기·보통·깊게)에 가장 가까운 effort.
--   OpenAI 호환(opencode)·연결 없음: DEFAULT — 모델마다 지원 단계가 달라(variant) 어느 단계든 단정할 수 없다.
-- provider 가 NULL 인 레거시 행(V119 이전)은 anthropic 으로 본다(AgentProviders.isAnthropic 과 같은 규칙).
-- NULL(미설정)은 그대로 둔다 — 코드 기본값(AssistantDefaults.THINKING_DEPTH = DEFAULT)이 적용된다.
-- @wp1322-migrate-begin (테스트 AssistantThinkingDepthTest 가 이 문장을 시드 위에 다시 돌린다)
UPDATE assistant_config c
   SET thinking_depth = CASE
         WHEN EXISTS (
           SELECT 1
             FROM ai_agent_credential cr
            WHERE cr.user_id = c.agent_user_id
              AND cr.revoked_at IS NULL
              AND COALESCE(cr.provider, 'anthropic') = 'anthropic'
         ) THEN CASE c.thinking_depth
                  WHEN 'NONE' THEN 'LOW'
                  WHEN 'NORMAL' THEN 'HIGH'
                  WHEN 'DEEP' THEN 'MAX'
                END
         ELSE 'DEFAULT'
       END,
       updated_at = NOW()
 WHERE c.thinking_depth IN ('NONE', 'NORMAL', 'DEEP');
-- @wp1322-migrate-end
