-- V298 (WP-1655): 개인 보고 — 보고 저장 위치와 템플릿 분리 상태. 컬럼 추가만(롤링 배포 호환).
--   report_location_page_id: 새 보고를 둘 페이지(내 노트 안). NULL = 기본 「보고」. 지워지면 NULL(기본으로 되돌아감).
--   template_initialized: 「보고」 아래 옛 템플릿을 「템플릿」 으로 한 번 옮기는 판정을 마쳤는가 — 옮기기를 한 번만 하기 위한 표시.
--   daily_template_made / weekly_template_made: 그 종류 템플릿을 한 번이라도 만들었는가 — *_template_page_id 는 ON DELETE SET NULL
--     이라 지운 흔적이 안 남는다. 종류별로 두어, 처음 켤 때 일일을 만든 직후 주간을 「다시 만듦」으로 잘못 알리지 않게 한다.
--   template_recreated_at: 없어진 템플릿을 다시 만든 시각 — 설정 화면 한 줄 알림. 사용자가 다음에 설정을 쓰면 지운다.
ALTER TABLE personal_report_setting
  ADD COLUMN report_location_page_id BIGINT REFERENCES wiki_page(id) ON DELETE SET NULL,
  ADD COLUMN template_initialized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN daily_template_made BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN weekly_template_made BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN template_recreated_at TIMESTAMPTZ;
CREATE INDEX idx_personal_report_setting_location ON personal_report_setting(report_location_page_id);
-- 기존 행: 지금 템플릿 id 가 있으면 그 종류는 만든 적이 있다.
UPDATE personal_report_setting
  SET daily_template_made = daily_template_page_id IS NOT NULL,
      weekly_template_made = weekly_template_page_id IS NOT NULL;
