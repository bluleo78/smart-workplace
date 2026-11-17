-- V296 (WP-1654): 프로젝트 정기 리포트 — 리포트 저장 위치와 템플릿 분리 상태. 컬럼 추가만(롤링 배포 호환).
--   report_location_page_id: 새 리포트를 둘 페이지. NULL = 기본 「리포트」. 지워지면 NULL(기본으로 되돌아감).
--   template_initialized: 템플릿을 「템플릿」 체계로 한 번이라도 갖췄는가(복사 또는 옛 위치 이전 판정 완료) — 옛 템플릿 이전을 한 번만 하고,
--     지운 뒤 다시 만들 때 「다시 만들었어요」를 알리기 위한 표시(template_page_id 는 ON DELETE SET NULL 이라 지운 흔적이 안 남는다).
--   template_recreated_at: 없어진 템플릿을 다시 만든 시각 — 설정 화면 한 줄 알림. 관리자가 다음에 설정을 저장하면 지운다.
ALTER TABLE project_report_setting
  ADD COLUMN report_location_page_id BIGINT REFERENCES wiki_page(id) ON DELETE SET NULL,
  ADD COLUMN template_initialized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN template_recreated_at TIMESTAMPTZ;
CREATE INDEX idx_project_report_setting_location ON project_report_setting(report_location_page_id);
