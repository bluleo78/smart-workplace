import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SettingsPage } from '@/components/layout/SettingsPage';
import { useSettingsScrollRoot } from '@/components/layout/settingsScrollRoot';
import { Button } from '@/components/ui/button';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { SearchInput } from '@/components/ui/search-input';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { AddMemberDialog } from '@/components/users/AddMemberDialog';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useDebounceValue } from '@/hooks/useDebounceValue';
import { formatNumber } from '@/lib/formatters';
import { flattenUniquePages } from '@/lib/offsetPaging';

import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { AgentBadge } from '../../components/users/AgentBadge';
import { useInfiniteMembers } from '../../hooks/queries/useMembers';

export default function UserListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounceValue(search, 300);
  const [addOpen, setAddOpen] = useState(false);

  // #833: 계정 관리 API(/users, ADMIN 전용) 대신 구성원 디렉터리(/members)를 읽는다.
  // 이 화면이 답하는 질문은 "우리 워크스페이스에 누가 있는가"이고, 계정 생성·역할변경 같은 관리
  // 동작만 /users 를 쓴다. includeInactive 로 비활성 계정도 함께 보여준다(관리 화면이므로).
  // WP-182: 페이지 번호 대신 무한 스크롤 — 끝에 닿으면 다음 50명을 이어 붙인다.
  const membersQuery = useInfiniteMembers({
    search: debouncedSearch || undefined,
    kind: 'ALL',
    includeInactive: true,
  });
  const { data, isLoading, isError } = membersQuery;
  const users = flattenUniquePages(data?.pages, (u) => u.userId);
  const totalElements = data?.pages[0]?.totalElements;
  const scrollRoot = useSettingsScrollRoot();

  return (
    <SettingsPage
      title="구성원"
      actions={
        <Button data-testid="add-member-button" onClick={() => setAddOpen(true)}>
          구성원 추가
        </Button>
      }
    >
      <div className="flex items-center gap-4">
        <SearchInput
          placeholder="이름 또는 아이디로 검색..."
          value={search}
          onChange={setSearch}
        />
        {/* 전체 인원 — 무한 스크롤이라 페이지 표시 대신 총 인원만 보인다(WP-182) */}
        {totalElements != null && (
          <span className="ml-auto text-sm text-muted-foreground" data-testid="user-list-total">
            총 {formatNumber(totalElements)}명
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table aria-label="사용자 목록">
          <TableHeader>
            <TableRow>
              {/* WP-182: 아이디·이메일은 대부분 같은 값이라 별도 열 대신 이름 아래 보조 줄로 합쳤다.
                  구분·상태는 배지 폭만큼만(w-px + nowrap) 차지해 이름 열에 공간을 몰아준다. */}
              <TableHead>구성원</TableHead>
              <TableHead className="w-px whitespace-nowrap">구분</TableHead>
              <TableHead className="w-px whitespace-nowrap">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={3} rows={5} />
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-destructive">
                  데이터를 불러오는데 실패했습니다.
                </TableCell>
              </TableRow>
            ) : users.length > 0 ? (
              users.map((u) => (
                <TableRow
                  key={u.userId}
                  // 키보드 접근성: Tab 포커스 가능하도록 tabIndex={0}, role="button" 추가
                  tabIndex={0}
                  role="button"
                  aria-label={`사용자 ${u.name} 상세 보기`}
                  className="cursor-pointer hover:bg-muted/50 transition-colors row-hover"
                  onClick={() => navigate(`/settings/users/${u.userId}`)}
                  // Enter/Space 키로 행 클릭과 동일한 네비게이션 동작 수행
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/settings/users/${u.userId}`); }}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar user={{ id: u.userId, username: u.username, name: u.name }} size="md" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.name}</div>
                        <div className="truncate text-xs text-muted-foreground" data-testid="user-list-username">
                          {u.username}
                          {/* 이메일은 아이디와 다를 때만 덧붙인다(같은 값 중복 표기 방지) */}
                          {u.email && u.email !== u.username && <> · {u.email}</>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.kind === 'AGENT' ? (
                      <AgentBadge size="xs" />
                    ) : (
                      // 같은 '구분' 컬럼에서 AGENT(배지)와 시각 일관성 유지 — HUMAN도 배지로 통일
                      <Badge variant="secondary">일반</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? 'default' : 'secondary'}>
                      {u.active ? '활성' : '비활성'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={3}
                message="사용자가 없습니다."
                searchKeyword={debouncedSearch || undefined}
                onResetSearch={search ? () => setSearch('') : undefined}
              />
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMoreFooter query={membersQuery} root={scrollRoot} data-testid="user-list-load-more" />

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
    </SettingsPage>
  );
}
