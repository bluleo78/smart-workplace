-- WP-1514: AI 별 「새 작업 받기」 스위치.
-- false 면 AI 는 하던 작업만 마치고 새 이슈를 받지 않는다(종료 전에 작업을 비우는 용도).
-- generation 과 무관한 운영 값이라 별도 칸으로 둔다. 새 행은 true, 재시작은 유지, 종료 후 켤 때 true 로 되돌린다.
alter table agent_runtime_setting
  add column accept_new_work boolean not null default true;
