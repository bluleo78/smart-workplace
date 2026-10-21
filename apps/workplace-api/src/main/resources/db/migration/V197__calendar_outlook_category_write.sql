-- 앱 태그 → Outlook 범주 써 넣기(WP-716)에 필요한 동기화 정보.
-- expand 단계: NULL 허용·기본값 있는 컬럼 추가뿐이라 구 버전 코드와 공존해도 안전하다.

-- 동기화된 M365 반복 회의 회차·예외 회차의 시리즈 마스터 id(Graph seriesMasterId)와 일정 종류(Graph type —
-- singleInstance | occurrence | exception | seriesMaster). 태그를 써 넣은 뒤 Outlook 이 실제로 바꿔 보일 로컬 행(누른 행 + 같은
-- 시리즈의 occurrence 행)만 연결을 바꾸려고 둔다. 단일 일정·로컬 일정·옛 행은 NULL(옛 행은 다음 동기화에 채워진다).
-- 써 넣을 Graph 대상은 이 값이 아니라 써 넣기 직전에 Graph 에서 읽은 값으로 정한다.
ALTER TABLE calendar_event ADD COLUMN series_master_id VARCHAR(500);
ALTER TABLE calendar_event ADD COLUMN external_type VARCHAR(20);

-- 앱에서 이 일정의 Outlook 범주를 마지막으로 써 넣은 시각(앱 서버 시계). 써 넣기 전에 Graph 를 읽어 둔 동기화가 그 뒤에 저장하면서
-- 새 연결을 옛 범주로 되돌리지 않게, 동기화는 자기 수집 시작보다 늦게 써 넣은 일정의 범주 연결을 건너뛴다.
ALTER TABLE calendar_event ADD COLUMN categories_written_at TIMESTAMPTZ;

-- 같은 달력의 한 시리즈 회차 행을 찾는 조회용(태그 써 넣기 뒤 연결 갱신). 반복 회의 회차만 값이 있어 부분 인덱스로 둔다.
CREATE INDEX idx_calendar_event_series_master
  ON calendar_event (calendar_id, series_master_id)
  WHERE series_master_id IS NOT NULL;

-- 이 외부 달력이 연결 계정 자신의 사서함 달력인지(Graph owner = 기본 달력의 owner). 편집 권한으로 공유받은 동료 달력(canEdit=true)은
-- 일정이 남의 사서함에 있어 /me/events/{id} 로 범주를 쓸 수 없으므로 태그 써 넣기를 막는다. 옛 행은 FALSE(다음 동기화에 채워진다 —
-- 그 전까지는 안전하게 써 넣기를 막는다). 로컬 달력은 쓰지 않는다.
ALTER TABLE calendar ADD COLUMN is_own_mailbox BOOLEAN NOT NULL DEFAULT FALSE;
