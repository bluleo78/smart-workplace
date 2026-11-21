// 설정 › API 토큰 「연결된 앱」 절(WP-1687) — 내가 OAuth 로 연결해 둔 앱(Claude 커넥터 등)이 어느 워크스페이스에
// 내 권한으로 붙어 있는지 보여 준다. 연결은 앱에서 동의 화면으로 만들어지므로 여기서는 읽기·끊기만 한다.
// 끊기는 확인 창(AlertDialog)을 거치고, 알림·푸시가 여는 주소(#connected-apps — lib/connectedApps.ts)로 오면 이 절로 스크롤한다.
// 도움말 문맥: 절에 data-help="tokens.apps"(매뉴얼 정적 검사 manual:check 가 소스에서 짝을 보므로 글자 그대로 둔다).

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { bodySectionTitleClass } from '@/components/layout/sidebar-link';
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
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CONNECTED_APPS_ANCHOR } from '@/lib/connectedApps';
import {
  EMPTY_GLYPH,
  formatDateOnly,
  formatDateTimeLocale,
  formatRelativeTime,
} from '@/lib/formatters';
import type { OAuthConnection } from '@/types/oauth';

import { useMyOAuthConnections, useRevokeMyOAuthConnection } from '../../../hooks/queries/useOAuthConnections';

const COLUMN_COUNT = 5;

/** 마지막 사용 표기 — 쓴 적이 없으면 빈 값 기호, 있으면 상대 시각(데스크톱 칸과 모바일 메타가 같이 쓴다). */
function lastUsedLabel(at: string | null): string {
  return at ? formatRelativeTime(at) : EMPTY_GLYPH;
}

type ConnectedAppsSectionProps = {
  /**
   * 앵커 스크롤을 해도 되는지 — 위 토큰 표가 처음 불러오기를 마쳤다(성공·실패 모두).
   * 이 절의 화면 위치는 위에 있는 토큰 표의 높이에 달려 있어, 표가 아직 뼈대면 토큰 줄이 늦게 와 표가 길어지며 절이 다시 밀린다.
   * 토큰 쿼리는 표를 그리는 TokenSettingsPage 가 가지므로 거기서 넘겨받는다.
   */
  scrollReady: boolean;
};

export function ConnectedAppsSection({ scrollReady }: ConnectedAppsSectionProps) {
  const connections = useMyOAuthConnections();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  // 마지막으로 스크롤한 이동의 location.key — 이동마다 한 번만 스크롤하고, 목록을 다시 읽을 때는 다시 하지 않는다.
  const scrolledKey = useRef<string | null>(null);
  const hasRows = (connections.data?.length ?? 0) > 0;
  // 오류 줄은 보여 줄 줄이 없을 때만 — 창으로 돌아와 다시 읽다가 실패해도 이미 받은 목록은 끊을 곳이라 지우지 않는다.
  // (실패를 「연결 없음」으로 숨기지도 않는다: 받은 목록이 없으면 오류 줄이 선다.)
  const showError = connections.isError && !hasRows;
  // 절을 그리는가 — 줄이 있거나 오류 줄이 선다. 로딩 중·빈 목록에서는 숨긴다(이른 반환과 스크롤 조건이 같이 쓴다).
  const visible = hasRows || showError;

  // 알림·푸시의 「새 앱이 연결됨」은 CONNECTED_APPS_PATH(/settings/tokens#connected-apps)로 열린다.
  // 사용자는 「내가 하지 않은 연결」을 곧장 끊으러 온 것인데, 폐기된 토큰이 쌓여 목록이 길면 이 절이 화면 아래로 밀려 지나치기 쉽다.
  // 스크롤은 아래가 모두 갖춰진 뒤 한 번 한다.
  // - 토큰 목록이 처음 불러오기를 마쳤다(scrollReady, 성공·실패 모두) — 표가 아직 뼈대면 토큰 줄이 늦게 와 표가 길어지며 절이 다시 밀린다.
  // - 연결 목록을 마운트 뒤 새로 받았다(isFetchedAfterMount — IssueDetailPage 의 코멘트 앵커와 같은 방식). 이 목록은
  //   staleTime 0 이라 마운트하면 늘 다시 읽으므로, 캐시 줄로 먼저 스크롤하면 다시 읽은 결과(비었거나 새 줄)로는 기회가 없다.
  // - 절이 그려진다 — 줄이 있거나, 목록을 못 받아 오류 줄이 있다(실패를 숨기지 않는다는 절 원칙과 같다).
  const ready = scrollReady && connections.isFetchedAfterMount && visible;
  useEffect(() => {
    if (location.hash !== `#${CONNECTED_APPS_ANCHOR}` || !ready) return;
    if (scrolledKey.current === location.key) return;
    scrolledKey.current = location.key;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [location.hash, location.key, ready]);

  // 로딩 중·빈 목록에서는 절 자체를 숨긴다 — 대부분의 사용자는 연결이 없어 뼈대가 잠깐 떴다 사라지는 깜빡임이 더 나쁘다.
  // 오류는 숨기지 않는다 — 보안 목록이라 실패를 숨기면 「연결 없음」으로 착각한다.
  if (!visible) return null;

  return (
    <section
      ref={sectionRef}
      id={CONNECTED_APPS_ANCHOR}
      aria-labelledby="connected-apps-title"
      data-help="tokens.apps"
      data-testid="connected-apps"
      className="space-y-3"
    >
      <h2 id="connected-apps-title" className={bodySectionTitleClass}>
        연결된 앱
      </h2>
      <ConnectedAppsTable rows={connections.data ?? []} showError={showError} />
    </section>
  );
}

/**
 * 연결 표와 끊기 확인 창 — 절이 보일 때만 마운트된다.
 * 확인 대상(targetId)을 여기 두는 이유: 목록이 비어 절이 사라지면 이 컴포넌트가 내려가며 대상도 함께 사라진다.
 * 바깥(절)에 두면 창의 onOpenChange 가 불리지 않아 대상이 남고, 나중에 같은 줄이 다시 생길 때 창이 저절로 다시 뜬다.
 */
function ConnectedAppsTable({ rows, showError }: { rows: OAuthConnection[]; showError: boolean }) {
  const revoke = useRevokeMyOAuthConnection();
  // 끊기 확인 대상의 id — 토큰 폐기 창(TokenSettingsPage)과 같은 방식. null 이면 창이 닫혀 있다.
  // 통째 객체가 아니라 id 만 두고 목록에서 끌어낸다 — 목록이 갱신돼도 낡은 사본이 남지 않고, 대상 줄이 빠지면 창도 닫힌다.
  const [targetId, setTargetId] = useState<number | null>(null);
  const target = rows.find((c) => c.id === targetId) ?? null;

  return (
    <>
      <div className="rounded-md border">
        <Table aria-label="연결된 앱 목록">
          <TableHeader>
            <TableRow>
              <TableHead className="max-w-[45vw] md:max-w-[260px]">앱</TableHead>
              {/* 휴대폰(<md)에서는 워크스페이스·연결·마지막 사용 열을 숨기고 앱 이름 아래 한 줄로 모은다 — 토큰 표(WP-617)와 같은 방식. */}
              <TableHead className="hidden md:table-cell">워크스페이스</TableHead>
              <TableHead className="hidden md:table-cell">연결</TableHead>
              <TableHead className="hidden md:table-cell">마지막 사용</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showError ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-destructive">
                  연결된 앱을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => {
                // 데스크톱 칸과 모바일 메타가 같은 값을 쓰므로 줄마다 한 번만 계산한다.
                const connectedOn = formatDateOnly(c.createdAt);
                const lastUsed = lastUsedLabel(c.lastUsedAt);
                return (
                  <TableRow key={c.id} data-testid={`oauth-connection-row-${c.id}`}>
                    <TableCell className="max-w-[45vw] md:max-w-[260px]">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium" title={c.clientName}>
                          {c.clientName}
                        </span>
                        {/* DCR 로 등록된 앱 — 동의 화면과 같은 경고색 작은 글자로 확인되지 않았음을 알린다. */}
                        {c.unverified && (
                          <span className="shrink-0 rounded-md bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-text">
                            확인되지 않은 앱
                          </span>
                        )}
                      </div>
                      {c.redirectHost && (
                        <div className="truncate text-xs text-muted-foreground" title={c.redirectHost}>
                          {c.redirectHost}
                        </div>
                      )}
                      {/* 모바일 메타 — 항목 단위로 줄바꿈하고(whitespace-nowrap) 워크스페이스 이름만 칸이 좁을 때 말줄임한다(WP-1126 방식). */}
                      <div
                        className="flex flex-wrap gap-x-2 text-xs text-muted-foreground md:hidden"
                        data-testid={`oauth-connection-meta-${c.id}`}
                      >
                        <span className="min-w-0 max-w-full truncate">{c.tenantName}</span>
                        <span className="whitespace-nowrap">연결 {connectedOn}</span>
                        <span className="whitespace-nowrap">사용 {lastUsed}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{c.tenantName}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {connectedOn}
                    </TableCell>
                    <TableCell
                      className="hidden text-xs text-muted-foreground md:table-cell"
                      title={c.lastUsedAt ? formatDateTimeLocale(c.lastUsedAt) : undefined}
                    >
                      {lastUsed}
                    </TableCell>
                    {/* 액션 칸 — 고정폭 + 우측 정렬. 같은 앱을 두 워크스페이스에 연결해도 접근 이름이 줄마다 다르다. */}
                    <TableCell className="w-20 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`${c.clientName} ${c.tenantName} 연결 끊기`}
                        data-testid={`oauth-connection-revoke-${c.id}`}
                        // 끊는 중인 줄만 막아 같은 연결을 두 번 끊지 않게 한다(다른 줄은 그대로).
                        disabled={revoke.isPending && revoke.variables === c.id}
                        onClick={() => setTargetId(c.id)}
                      >
                        끊기
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 끊기 확인 — 토큰 폐기 창과 같은 모양. 확인을 누르면 창이 닫히고 mutation 이 돈다. */}
      <AlertDialog
        open={target != null}
        onOpenChange={(open) => {
          if (!open) setTargetId(null);
        }}
      >
        <AlertDialogContent data-testid="oauth-connection-confirm-dialog" data-help="tokens.apps">
          <AlertDialogHeader>
            <AlertDialogTitle>앱 연결 끊기</AlertDialogTitle>
            {/* 닫히는 애니메이션 동안 target 이 null 이 되므로 본문은 target 이 있을 때만 그린다. 앱 이름은 임의 문자열이지만 줄바꿈은 공용 AlertDialogDescription(wrap-anywhere)이 맡는다(WP-1921). */}
            {target && (
              <AlertDialogDescription>
                {`${target.clientName}의 ${target.tenantName} 연결을 끊으시겠습니까? 이 앱은 바로 Gen:iA Works 에 접근할 수 없게 되고, 다시 쓰려면 앱에서 다시 연결해야 합니다.`}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="oauth-connection-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="oauth-connection-confirm"
              onClick={() => targetId != null && revoke.mutate(targetId)}
            >
              끊기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
