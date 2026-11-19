-- WP-1726 붙여넣은 서명 「원본 그대로」: 편집기가 담지 못하는 서식(표·글꼴·클래스 서식·상자 서식·링크 등 요소 style)이 든 서명을 붙여 넣으면 설정 화면이 편집기 대신
-- 미리 보기로 보여 준다. 그 모드를 기억하는 열 — 다시 열어도 편집기가 서식을 지우지 않게 한다.
-- 기본 FALSE 라 기존 서명은 지금처럼 편집기로 열린다. 열만 더하는 expand-only 라 롤링 배포에 안전하다(옛 앱은 열을 모른다).
ALTER TABLE mail_signature ADD COLUMN pasted BOOLEAN NOT NULL DEFAULT FALSE;
