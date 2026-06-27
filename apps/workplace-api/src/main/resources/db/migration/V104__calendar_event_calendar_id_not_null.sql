-- 코드 배선 완료 후 calendar_id NOT NULL 확정. 혹시 남은 NULL(개발 중 생성분)은 기본 캘린더로 재백필.
UPDATE calendar_event e
   SET calendar_id = c.id
  FROM calendar c
 WHERE e.calendar_id IS NULL
   AND c.owner_id = e.owner_id AND c.tenant_id = e.tenant_id AND c.is_default;

ALTER TABLE calendar_event ALTER COLUMN calendar_id SET NOT NULL;
