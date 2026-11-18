-- WP-1741: Graph delta 커서를 새 컬럼으로 옮겨 모든 Graph 메일함이 delta 를 한 번 처음부터 다시 받게 한다.
--
-- 왜: Graph deltaLink 는 처음 요청의 $select 를 이어 간다. 별표(flag)를 $select 에 더하기 전에 연결한 계정은
--     email_folder.delta_link 의 옛 커서로 증분 동기화하므로 flag 가 영영 오지 않는다(Outlook 별표가 앱에 안 보임).
-- 왜 기존 값을 지우지(UPDATE … SET delta_link = NULL) 않고 새 컬럼인가: 롤링 배포(maxSurge 1) 중에는 옛 파드가 아직
--     자동 동기화를 돌려 마이그레이션 뒤에도 옛 $select 커서를 delta_link 에 다시 적을 수 있다. 새 코드는 새 컬럼만 읽고 쓰므로
--     옛 파드가 무엇을 적든 새 코드의 첫 동기화는 반드시 flag 를 담은 초기 delta 로 시작한다.
-- 다시 받아도 안전하다: upsert 가 (account, provider_message_id) 로 기존 행을 찾아 읽음·별표만 맞추고(새 행 없음),
--     반영 대기(seen/flagged_push_pending) 행은 서버 값으로 덮지 않는다.
-- 롤링 배포 호환(expand): nullable 컬럼만 더한다. 옛 delta_link 컬럼은 다음 배포(contract)에서 지운다.
ALTER TABLE email_folder ADD COLUMN graph_delta_link TEXT;

COMMENT ON COLUMN email_folder.graph_delta_link IS
  'Graph 증분 커서(@odata.deltaLink) — $select 에 flag 를 더한 뒤 발급된 커서만 담는다. delta_link 를 대체(WP-1741)';
