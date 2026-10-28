// 에이전트 API 키 영역 — 키 발급 폼 + 키 목록(회수 버튼 포함).
// 내부 에이전트("API 키" 블록)와 외부 에이전트("① 키 발급" 카드) 두 레이아웃이 공유하며 external 로 제목·placeholder 만 달라진다.
// 회수 확인 다이얼로그와 평문 키 1회 표시 다이얼로그는 페이지가 소유하므로 콜백으로 위임한다.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTimeLocale } from '@/lib/formatters';

import { useAgentKeys, useIssueAgentKey } from '../../../hooks/queries/useAgentKeys';

interface Props {
  agentId: number;
  /** 외부 실행 에이전트 여부 — true 면 섹션 제목을 숨기고(카드 안 ① 소제목이 대신함) placeholder 가 달라진다. */
  external: boolean;
  /** 발급 직후 1회만 알 수 있는 평문 키 — 페이지가 다이얼로그로 보여 준다. */
  onIssued: (plaintextKey: string) => void;
  /** 키 회수 요청 — 확인 AlertDialog 는 페이지가 띄운다. */
  onRevoke: (keyId: number) => void;
  /**
   * 새 키를 발급할 수 있나 — 개인 비서는 false(WP-1153). 주인의 위임으로만 움직이는 신원이라 관리자가 키를 받으면 주인의 개인 작업을 읽을 수
   * 있어 서버가 발급을 403 으로 막고, 전에 나간 키도 인증하지 않는다. 남은 키의 목록·회수는 정리 수단으로 그대로 보인다.
   */
  canIssue: boolean;
}

export function AgentKeysSection({ agentId, external, onIssued, onRevoke, canIssue }: Props) {
  const keys = useAgentKeys(agentId);
  const issue = useIssueAgentKey(agentId);
  const [label, setLabel] = useState('');
  // 회수되지 않은 키가 있을 때만 정리 안내를 붙인다 — 키가 없는데 회수하라고 하지 않게.
  const hasActiveKey = (keys.data ?? []).some((k) => k.revokedAt == null);

  const onIssue = async () => {
    try {
      const res = await issue.mutateAsync({ label: label.trim() || null });
      setLabel('');
      onIssued(res.plaintextKey);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  return (
    <div className="space-y-2" data-testid="agent-keys-block">
      {!external && <h3 className="text-sm font-medium">API 키</h3>}
      {!canIssue ? (
        <p className="text-xs text-muted-foreground" data-testid="key-issue-personal-hint">
          개인 비서의 키는 관리자가 발급할 수 없어요.
          {hasActiveKey && ' 남아 있는 키로는 로그인되지 않으니 회수해 정리하세요.'}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onIssue();
          }}
          className="flex gap-2"
          data-testid="key-issue-form"
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={external ? 'label (예: 맥북)' : 'label (선택)'}
            maxLength={80}
            aria-label="키 label"
          />
          <Button type="submit" disabled={issue.isPending}>
            키 발급
          </Button>
        </form>
      )}

      <div className="rounded-md border overflow-x-auto">
        {/* 좁은 화면(모바일 시트·외부 연결 카드 안)에서 열 제목이 글자 단위로 꺾이지 않게 줄바꿈을 막고,
            넘치는 폭은 바깥 div 의 가로 스크롤로 받는다. */}
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2 px-3">prefix</th>
              <th className="px-3">label</th>
              <th className="px-3">발급</th>
              <th className="px-3">마지막 사용</th>
              <th className="px-3">회수</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.isLoading ? (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground text-center">
                  로딩 중…
                </td>
              </tr>
            ) : (keys.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground text-center">
                  키가 없습니다
                </td>
              </tr>
            ) : (
              (keys.data ?? []).map((k) => (
                <tr key={k.id} className="border-b" data-testid={`key-row-${k.id}`}>
                  <td className="py-2 px-3 font-mono">{k.keyPrefix}…</td>
                  <td className="px-3">{k.label ?? '-'}</td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {formatDateTimeLocale(k.createdAt)}
                  </td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {formatDateTimeLocale(k.lastUsedAt)}
                  </td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {formatDateTimeLocale(k.revokedAt)}
                  </td>
                  <td className="px-3">
                    {k.revokedAt == null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevoke(k.id)}
                        data-testid={`key-revoke-${k.id}`}
                      >
                        회수
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
