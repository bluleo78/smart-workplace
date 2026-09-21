-- V132 (#833): 구성원 디렉터리 조회 권한 'member:read' 신설 + ADMIN/USER/AGENT 부여.
--
-- 배경: "사용자(계정)"와 "구성원(테넌트 멤버십)"은 다른 개념인데 API 가 /users 하나뿐이었다. 그래서
-- 사내 사람을 찾는 일이 (a) ADMIN 전용 계정 관리 API 를 쓰거나 (b) 연락처 목록으로 우회하거나
-- 둘 중 하나였고, (b) 때문에 AI 가 연락처 id 를 프로젝트 멤버 userId 로 오용하는 문제가 생겼다.
--
-- 구성원 디렉터리(GET /api/v1/members)는 membership 기준으로 현재 테넌트 멤버만 보여주는 조회 전용
-- 표면이라 모든 구성원에게 열어도 된다. 계정 관리(user:write·role:assign)는 그대로 ADMIN 전용이며,
-- 'user:read'(계정 목록/상세)도 ADMIN 전용으로 둔다 — 두 권한을 분리해야 "디렉터리를 본다"와
-- "계정을 관리한다"가 섞이지 않는다.
--
-- RLS 주의: permission 은 전역 카탈로그(테넌트 무관), role/role_permission 은 RLS ENABLE(미-FORCE)
-- → 소유자 app(Flyway)은 BYPASSRLS. role_permission.tenant_id 는 NOT NULL 이고 DEFAULT 가 GUC 기반
-- (Flyway 에선 NULL)이라 role 에서 가져와 명시한다.
INSERT INTO permission (code, description, category)
VALUES ('member:read', '구성원 디렉터리 조회', 'user')
ON CONFLICT (code) DO NOTHING;

-- 기존 **모든** 역할에 부여한다. 시스템 역할(ADMIN/USER/AGENT)만 대상으로 하면 관리자가 만든 커스텀
-- 역할만 가진 사용자는 멤버 picker·@멘션·위키 @유저가 통째로 빈 화면이 된다(전부 /members 로 옮겼으므로).
-- 디렉터리 조회는 "이 워크스페이스에 누가 있는가"라 멤버라면 누구나 볼 수 있어야 하는 정보다.
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'member:read'
WHERE NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
