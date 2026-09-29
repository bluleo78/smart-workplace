-- #873: 저장된 비서 모델을 최신 Claude 모델로 일괄 전환(V115 선례).
-- 정확일치 UPDATE 만 사용 — opencode 행('providerId/모델')과 사용자가 고른 기타 값은 건드리지 않는다.
-- haiku 는 최신 세대(4.5)라 유지. 각 매핑은 동일 등급 후속 모델이며 단가는 같거나 낮다.
UPDATE assistant_config SET model = 'claude-sonnet-5-5'
 WHERE model IN ('claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929');

UPDATE assistant_config SET model = 'claude-opus-5-5'
 WHERE model IN ('claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
                 'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-1');

UPDATE assistant_config SET model = 'claude-fable-5-1'
 WHERE model = 'claude-fable-5';
