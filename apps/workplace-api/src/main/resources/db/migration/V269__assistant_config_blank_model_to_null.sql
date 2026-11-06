-- WP-1395: 비서 설정의 모델명이 다듬지 않고 저장돼 있었다 — 공백만 든 값은 기본 모델로 대체되지 않았고, 앞뒤 공백이 붙은 이름은 실행기가 찾지 못한다.
-- 이제 저장할 때 앞뒤 공백을 떼고 비면 NULL(= 기본 모델)로 두므로(Texts.stripToNull), 이미 저장된 값도 같은 규칙으로 맞춘다.
-- \s 는 탭·줄바꿈까지 잡는다(btrim 은 기본으로 스페이스만 뗀다).
UPDATE assistant_config
   SET model = NULLIF(regexp_replace(model, '^\s+|\s+$', '', 'g'), '')
 WHERE model ~ '^\s|\s$';
