-- 비서 모델 디폴트 상향(claude-sonnet-4-6 → claude-sonnet-5). 기존 저장값 일괄 정정.
UPDATE assistant_config SET model = 'claude-sonnet-5' WHERE model = 'claude-sonnet-4-6';
