// 에이전트 접속 키 영역 — 키 발급 폼 + 키 표(키 폐기 단추 포함).
// 에이전트 상세 「실행 › 접속 키」(기본 방식)와 외부 방식 「연결 방법 ①」이 함께 쓰고, Works 가 실행하는 AI 는 남은 직접 발급 키만 보인다(leftoverOnly).
// 폐기 확인 창과 평문 키 1회 표시 창은 부모가 가지므로 콜백으로 넘긴다.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  API_TOKEN_STATUS_LABEL,
  type ApiTokenStatus,
  apiTokenStatus,
} from "@/lib/apiTokenStatus";
import { formatDateTimeLocale, formatMonthDayClock } from "@/lib/formatters";

import {
  useAgentKeys,
  useIssueAgentKey,
} from "../../../hooks/queries/useAgentKeys";
import type { AgentApiKey } from "../../../types/agentKey";

interface Props {
  agentId: number;
  /** 발급 직후 1회만 알 수 있는 평문 키 — 부모가 창으로 보여 준다. */
  onIssued: (plaintextKey: string) => void;
  /** 키 폐기 요청 — 확인 창은 부모가 띄운다. */
  onRevoke: (keyId: number) => void;
  /**
   * 새 키를 발급할 수 있나 — 개인 비서·사용 중지된 AI 는 false(WP-1153). 개인 비서는 주인의 위임으로만 움직이는 신원이라 관리자가 키를 받으면
   * 주인의 개인 작업을 읽을 수 있어 서버가 발급을 403 으로 막고, 전에 나간 키도 인증하지 않는다. 남은 키의 표·폐기는 정리 수단으로 그대로 보인다.
   */
  canIssue: boolean;
  /** 발급할 수 없을 때 폼 자리에 보일 한 줄(없으면 아무것도). */
  blockedNote?: string;
  /**
   * 남은 키가 있을 수 있을 때만 blockedNote 뒤에 붙일 정리 안내(WP-1162) — 쓸 수 있는 키가 없다고 확인되면 빼서, 빈 키 표 위에서 폐기하라고 하지 않는다.
   * 목록을 불러오는 중이거나 오류면 남은 키가 있을 수 있어 붙인다.
   */
  leftoverHint?: string;
  /** 남은 키는 쓸 수 없다고 표시할지 — 개인 비서의 키는 인증 필터가 거절한다(WP-1162). */
  keysUnusable?: boolean;
  /**
   * Works 가 실행하는 AI 용 — 직접 발급한 활성 키만 한 줄씩 보이고(자동 발급 키·폐기된 키는 숨김), 없으면 아무것도 그리지 않는다.
   * Works 가 접속 키를 관리하므로 새로 발급할 필요가 없다.
   */
  leftoverOnly?: boolean;
}

export function AgentKeysSection({
  agentId,
  onIssued,
  onRevoke,
  canIssue,
  blockedNote,
  leftoverHint,
  keysUnusable = false,
  leftoverOnly = false,
}: Props) {
  const keys = useAgentKeys(agentId);
  // 만료된 자동 발급 키는 폐기한 키처럼 인증되지 않으니 남은 키로 세지 않는다(WP-1253).
  const mayHaveActiveKey = keys.data == null || keys.data.some((k) => apiTokenStatus(k) === "active");
  const issue = useIssueAgentKey(agentId);
  const [label, setLabel] = useState("");

  const onIssue = async () => {
    try {
      const res = await issue.mutateAsync({ label: label.trim() || null });
      setLabel("");
      onIssued(res.plaintextKey);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  if (leftoverOnly) {
    // 만료된 키(Works 자동 발급 키의 수명이 다함)는 폐기한 키처럼 더는 인증되지 않으니 활성으로 세지 않는다(WP-1253).
    const leftovers = (keys.data ?? []).filter((k) => !k.managed && apiTokenStatus(k) === "active");
    if (leftovers.length === 0) return null;
    return (
      <ul className="max-w-2xl space-y-1.5" data-testid="agent-leftover-keys">
        {leftovers.map((k) => (
          <li
            key={k.id}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm"
          >
            <span className="text-xs text-muted-foreground">직접 발급한 키</span>
            <code className="rounded bg-background px-1.5 font-mono text-xs">{k.keyPrefix}…</code>
            {k.label && <span className="text-xs">{k.label}</span>}
            <span className="text-xs text-muted-foreground">
              마지막 사용 {k.lastUsedAt ? formatMonthDayClock(k.lastUsedAt) : "없음"}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => onRevoke(k.id)}
              data-testid={`key-revoke-${k.id}`}
            >
              키 폐기
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2" data-testid="agent-keys-block">
      {canIssue ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onIssue();
          }}
          className="flex max-w-md gap-2"
          data-testid="key-issue-form"
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="키 이름 (선택, 예: 맥북)"
            maxLength={80}
            aria-label="키 이름"
          />
          <Button type="submit" variant="outline" disabled={issue.isPending}>
            키 발급
          </Button>
        </form>
      ) : blockedNote ? (
        <p className="text-xs text-muted-foreground" data-testid="key-issue-blocked">
          {blockedNote}
          {leftoverHint && mayHaveActiveKey && ` ${leftoverHint}`}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        {/* 좁은 화면에서 열 제목이 글자 단위로 꺾이지 않게 줄바꿈을 막고, 넘치는 폭은 바깥 div 의 가로 스크롤로 받는다. */}
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">앞자리</th>
              <th className="px-3 font-medium">이름</th>
              <th className="px-3 font-medium">발급</th>
              <th className="px-3 font-medium">마지막 사용</th>
              <th className="px-3 font-medium">상태</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.isLoading ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  로딩 중…
                </td>
              </tr>
            ) : (keys.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  아직 발급한 키가 없어요
                </td>
              </tr>
            ) : (
              (keys.data ?? []).map((k) => (
                <AgentKeyRow key={k.id} k={k} unusable={keysUnusable} onRevoke={onRevoke} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 키 표 한 줄 — 폐기·만료된 키는 쓸 수 없어 폐기 단추를 숨긴다(WP-1253). */
function AgentKeyRow({ k, unusable, onRevoke }: { k: AgentApiKey; unusable: boolean; onRevoke: (keyId: number) => void }) {
  const status = apiTokenStatus(k);
  return (
    <tr className="border-b last:border-b-0" data-testid={`key-row-${k.id}`}>
      <td className="px-3 py-2 font-mono">{k.keyPrefix}…</td>
      <td className="px-3">{k.label ?? (k.managed ? "Works 가 관리" : "-")}</td>
      <td className="px-3 text-xs text-muted-foreground">{formatDateTimeLocale(k.createdAt)}</td>
      <td className="px-3 text-xs text-muted-foreground">{formatDateTimeLocale(k.lastUsedAt)}</td>
      <td className="px-3 text-xs text-muted-foreground">
        <KeyStatusCell k={k} status={status} unusable={unusable} />
      </td>
      <td className="px-3 text-right">
        {status === "active" && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRevoke(k.id)} data-testid={`key-revoke-${k.id}`}>
            키 폐기
          </Button>
        )}
      </td>
    </tr>
  );
}

/**
 * 상태 칸 — 쓰는 중 / 폐기됨(날짜) / 만료됨. 개인 비서의 폐기 안 된 키는 인증 필터가 거절해 「사용 불가」(WP-1162),
 * 수명이 다한 Works 자동 발급 키는 「만료됨」(WP-1253).
 */
function KeyStatusCell({ k, status, unusable }: { k: AgentApiKey; status: ApiTokenStatus; unusable: boolean }) {
  if (status === "active") {
    return unusable ? (
      <span className="text-destructive" data-testid={`key-unusable-${k.id}`}>
        사용 불가
      </span>
    ) : (
      <span>쓰는 중</span>
    );
  }
  if (status === "expired") return <span data-testid={`key-expired-${k.id}`}>{API_TOKEN_STATUS_LABEL.expired}</span>;
  return <>폐기됨 {formatDateTimeLocale(k.revokedAt)}</>;
}
