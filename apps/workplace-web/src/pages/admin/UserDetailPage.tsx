import { ArrowLeft } from 'lucide-react';
import { useEffect,useState } from 'react';
import { Navigate, useNavigate,useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { rolesApi } from '../../api/roles';
import { usersApi } from '../../api/users';
import { SettingsPage } from '../../components/layout/SettingsPage';
import { SettingsSection } from '../../components/layout/SettingsSection';
import { settingsGuides } from '../../components/settings-guide/settingsGuides';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { formatDateShort } from '../../lib/formatters';
import type { RoleResponse } from '../../types/role';
import type { UserDetailResponse } from '../../types/user';
import { UserActiveSection, UserRolesSection } from './components/UserAccessSections';

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetailResponse | null>(null);
  const [allRoles, setAllRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        // 둘을 함께 읽되 역할 목록 실패는 AI 일 때 무시한다 — AI 는 역할 없이 에이전트 상세로 넘긴다(WP-1075, 아래 Navigate).
        const [userRes, rolesRes] = await Promise.all([
          usersApi.getUserById(Number(id)),
          rolesApi.getRoles().catch(() => null),
        ]);
        if (userRes.data.kind !== 'AGENT') {
          if (!rolesRes) throw new Error('역할 목록을 불러오지 못했습니다');
          setAllRoles(rolesRes.data);
        }
        setUser(userRes.data);
      } catch {
        toast.error('사용자 정보를 불러오는데 실패했습니다.');
        navigate('/settings/users');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id, navigate]);

  // 뒤로가기 버튼 — 제목 왼쪽에 배치하는 관례 준수 (#102).
  const backButton = (
    <Button variant="ghost" size="icon" onClick={() => navigate('/settings/users')} aria-label="목록으로 돌아가기" title="목록으로 돌아가기">
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );

  if (isLoading) {
    return (
      <SettingsPage title="사용자 상세" icon={backButton} width="form" guide={settingsGuides.userDetail}>
        <div className="space-y-4 py-6">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </SettingsPage>
    );
  }

  if (!user) return null;

  // WP-1075: AI 는 에이전트 화면이 관리한다 — 옛 주소(/settings/users/{에이전트 id})로 들어오면 에이전트 상세로 넘긴다.
  if (user.kind === 'AGENT') return <Navigate to={`/settings/agents?agent=${user.id}`} replace />;

  return (
    <SettingsPage
      title="사용자 상세"
      icon={backButton}
      width="form"
      guide={settingsGuides.userDetail}
      // WP-414: AI 화면 맥락 — 저장된 값(이름·역할·활성)만. 체크만 바꾼 미저장 역할은 싣지 않는다.
      aiContext={{
        focus: {
          type: '사용자',
          label: user.name,
          refs: { username: user.username },
          facts: [
            ['아이디', user.username],
            ['역할', user.roles.map((r) => r.name).join(', ')],
            ['활성 상태', user.isActive ? '활성' : '비활성'],
          ],
        },
      }}
    >
      {/* 기본 정보 — 읽기 전용(가입 정보는 본인만 수정) */}
      <SettingsSection title="기본 정보" description="가입 정보는 구성원 본인만 바꿀 수 있어요.">
        {/* 값 열은 minmax(0,1fr) — 섹션 입력 열의 wrap-anywhere 와 함께, 공백 없는 긴 아이디·이메일이 min-content 로 열을 늘려 모바일 본문을 가로로 넘기지 않게(WP-397 D2).
            라벨 열은 좁은 본문(@container 640 미만)에서 80px 로 줄여 값 폭을 확보한다. */}
        <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-sm @min-[640px]:grid-cols-[120px_minmax(0,1fr)]">
          <span className="text-muted-foreground">아이디</span>
          <span>{user.username}</span>
          <span className="text-muted-foreground">이름</span>
          <span>{user.name}</span>
          <span className="text-muted-foreground">이메일</span>
          <span>{user.email ?? '-'}</span>
          <span className="text-muted-foreground">가입일</span>
          <span>{formatDateShort(user.createdAt)}</span>
          <span className="text-muted-foreground">상태</span>
          <span>
            <Badge variant={user.isActive ? 'default' : 'secondary'}>
              {user.isActive ? '활성' : '비활성'}
            </Badge>
          </span>
        </div>
      </SettingsSection>

      {/* 활성 상태·역할 할당 — 에이전트 상세와 같은 섹션(WP-1075). key 로 다른 사용자 전환 시 역할 선택을 다시 시드한다. */}
      <UserActiveSection key={user.id} user={user} onChanged={(active) => setUser({ ...user, isActive: active })} />
      <UserRolesSection key={user.id} user={user} allRoles={allRoles} onSaved={setUser} />
    </SettingsPage>
  );
}
