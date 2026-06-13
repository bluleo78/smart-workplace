-- V60: contact_favorite PK 에 tenant_id 포함(V58 정정 — fix-forward).
--
-- 배경: V58 은 contact_favorite PK (owner_id, target_type, target_id) 를 "전이 안전"으로 보고
--   그대로 두었으나 이는 EXTERNAL 타깃(→ contact_entry, 테넌트 스코프)에만 맞다.
--   target_type='MEMBER' 일 때 target_id 는 전역 "user"(id) 이고 owner_id 도 전역 "user"(id) 라
--   (user 테이블은 tenant_id/RLS 없음 — 전역 신원), 같은 유저가 두 테넌트에서 같은 멤버를
--   즐겨찾기하면 동일 PK 가 생겨 두 번째 insert 가 충돌한다. PK/유니크 인덱스는 RLS 를 우회하므로
--   테넌트 격리가 안 먹는다(uq_email_account_user_addr 를 (tenant_id, ...) 로 고친 것과 동일 원리).
--
-- 해법: PK 선두에 tenant_id 를 넣어 (tenant_id, owner_id, target_type, target_id) 로 재정의.
--   tenant_id 는 V58 에서 이미 NOT NULL 이므로 PK 구성 가능. 현재 즐겨찾기 쓰기 경로는 없어
--   데이터 영향 없음(잠재 결함의 선제 차단).
ALTER TABLE contact_favorite DROP CONSTRAINT contact_favorite_pkey;
ALTER TABLE contact_favorite
  ADD CONSTRAINT contact_favorite_pkey PRIMARY KEY (tenant_id, owner_id, target_type, target_id);
