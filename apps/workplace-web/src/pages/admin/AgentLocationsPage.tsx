// ADMIN — AI 실행 위치(WP-1256). 위치 = runner 를 설치한 쿠버네티스 네임스페이스 하나.
// 목록(이름·설명·기본·연결 상태·자리 사용) + 「위치 추가」 → runner 토큰 1회 표시 + 설치 순서 + ⋯ 메뉴(기본 지정·자리 수·토큰 재발급·삭제).

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import { SettingsPage } from '@/components/layout/SettingsPage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { formatRelativeTime } from '@/lib/formatters';

import {
  useAgentLocations,
  useDeleteAgentLocation,
  useRotateAgentLocationToken,
  useSetDefaultAgentLocation,
} from '../../hooks/queries/useAgentRuntime';
import { connectionPill } from '../../lib/agentRuntimeStatus';
import type { AgentLocation, AgentLocationTokenResponse } from '../../types/agentRuntime';
import { AgentLocationFormDialog } from './components/AgentLocationFormDialog';
import { AgentLocationTokenDialog } from './components/AgentLocationTokenDialog';

export default function AgentLocationsPage() {
  const locations = useAgentLocations();
  const setDefault = useSetDefaultAgentLocation();
  const rotate = useRotateAgentLocationToken();
  const remove = useDeleteAgentLocation();
  // 추가(null) 또는 고칠 위치 — undefined 면 닫힘.
  const [editing, setEditing] = useState<AgentLocation | null | undefined>(undefined);
  // 발급 직후 한 번만 보이는 토큰 + 처음 만든 위치인지(설치 순서를 보일지).
  const [issued, setIssued] = useState<{ res: AgentLocationTokenResponse; created: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'delete'; location: AgentLocation } | null>(null);

  const rows = locations.data ?? [];

  return (
    <SettingsPage
      title="AI 실행 위치"
      actions={
        <Button onClick={() => setEditing(null)} data-testid="agent-location-new">
          + 위치 추가
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Works 가 AI 를 띄우는 클러스터입니다. 위치마다 runner 를 한 번 설치하면, 에이전트 화면에서 켜고 끄는 대로 AI 가 그 위치에서 돕니다.
      </p>
      <div className="rounded-md border">
        <Table aria-label="실행 위치 목록">
          <TableHeader>
            <TableRow>
              <TableHead>위치</TableHead>
              <TableHead>연결</TableHead>
              <TableHead className="text-right">자리</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.isLoading ? (
              <TableSkeletonRows columns={4} rows={3} />
            ) : rows.length === 0 ? (
              <TableEmptyRow colSpan={4} message="아직 실행 위치가 없어요. 「위치 추가」로 만들고 안내대로 runner 를 설치하세요." />
            ) : (
              rows.map((l) => {
                const pill = connectionPill(l.connection);
                return (
                  <TableRow key={l.id} data-testid={`agent-location-row-${l.id}`}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.name}</span>
                        {l.isDefault && <Badge variant="secondary">기본</Badge>}
                      </div>
                      {l.description && <p className="mt-0.5 text-xs text-muted-foreground">{l.description}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusBadge type={pill.type} data-testid={`agent-location-connection-${l.id}`}>
                          {pill.label}
                        </StatusBadge>
                        {l.lastSeenAt && (
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(l.lastSeenAt)} 보고</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums" data-testid={`agent-location-seats-${l.id}`}>
                      {l.used} / {l.capacity}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${l.name} 메뉴`} data-testid={`agent-location-menu-${l.id}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!l.isDefault && <DropdownMenuItem onSelect={() => setDefault.mutate(l.id)}>기본으로 지정</DropdownMenuItem>}
                          <DropdownMenuItem onSelect={() => setEditing(l)}>이름·자리 수 바꾸기</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfirm({ kind: 'rotate', location: l })}>토큰 재발급</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={l.used > 0}
                            onSelect={() => setConfirm({ kind: 'delete', location: l })}
                          >
                            {l.used > 0 ? '삭제 (쓰는 AI 가 있어 불가)' : '삭제'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editing !== undefined && (
        <AgentLocationFormDialog
          location={editing}
          onClose={() => setEditing(undefined)}
          onCreated={(res) => setIssued({ res, created: true })}
        />
      )}

      <AgentLocationTokenDialog
        // 위치마다 새로 그린다 — 앞 위치에 넣은 내부 IP 가 다음 위치의 설치 명령에 남지 않게.
        key={issued?.res.location.id ?? 'closed'}
        issued={issued?.res ?? null}
        showInstall={issued?.created ?? false}
        onClose={() => setIssued(null)}
      />

      <DeleteConfirmDialog
        open={confirm?.kind === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        entityName="실행 위치"
        itemName={confirm?.location.name ?? ''}
        description={`「${confirm?.location.name ?? ''}」 위치를 삭제합니다. 설치한 runner 는 더 이상 연결되지 않으니 클러스터에서 helm uninstall 로 지우세요.`}
        onConfirm={() => confirm && remove.mutate(confirm.location.id, { onSuccess: () => setConfirm(null) })}
      />
      <AlertDialog open={confirm?.kind === 'rotate'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>토큰 재발급</AlertDialogTitle>
            <AlertDialogDescription>
              「{confirm?.location.name}」의 runner 토큰을 새로 만듭니다. 지금 설치된 runner 는 바로 끊기니 새 토큰으로 runner Secret 을
              바꾸세요. 그동안 돌던 AI 는 그대로 돕니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                rotate.mutate(confirm.location.id, {
                  onSuccess: (res) => {
                    setConfirm(null);
                    setIssued({ res, created: false });
                  },
                })
              }
            >
              재발급
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
