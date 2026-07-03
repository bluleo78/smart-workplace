// 공유 LLM 모델 기본값 — 각 run-*.ts 가 개별로 상수를 들고 있어 발생한 drift(예: run-drive-ai.ts 의
// 'claude-sonnet-4-5' 오기)를 막기 위해 단일 진실원천으로 통일한다(Task 7).
// 우선순위: 요청 body의 model(compose 경로) > credential.model(redeem 응답, assistant_config.model)
// > WORKPLACE_AI_MODEL env > 이 기본값.
export const DEFAULT_MODEL = 'claude-sonnet-5';
