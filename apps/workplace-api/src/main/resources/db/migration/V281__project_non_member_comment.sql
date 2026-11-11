-- WP-1495: 접수함(OPEN) 프로젝트의 비멤버도 이슈에 댓글을 달 수 있게 하는 프로젝트별 설정.
-- 기본은 끔(false) — 지금까지의 동작(멤버/ADMIN·이슈 reporter 만 댓글)을 그대로 두고, 소유자가 켠 프로젝트만 개방한다.
alter table project add column non_member_comment boolean not null default false;
