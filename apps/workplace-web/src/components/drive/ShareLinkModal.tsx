// 파일·폴더 공유 링크 관리 모달(폴더 겸용 WP-1538) — 이미 만든 링크를 먼저 보이고 다시 복사하게 한다(WP-1528).
// - 제목 아래에 파일·폴더 이름(폴더는 폴더 아이콘)을 보여 어느 파일의 링크인지 바로 안다.
// - 살아 있는(폐기·만료 아닌) 링크는 카드로: 가시성·만료·비밀번호 배지, 만든 사람·날짜, URL + [복사] + [폐기].
//   예전에 만든 링크(서버에 토큰이 없음)는 URL 대신 다시 볼 수 없다는 안내 + [폐기].
// - 새 링크는 「+ 새 링크 만들기」로 그 자리에 폼(가시성·비밀번호·만료일)을 펼쳐 만든다. 링크가 하나도 없으면 폼이 바로 보인다.
//   만들면 폼이 닫히고 새 링크가 맨 위에 강조되어 나타나며 URL 이 바로 복사된다 — 예전엔 생성 직후 한 번만 URL 을 보여 줬다.
// - 폐기·만료된 링크는 「지난 링크 n개」로 접어 두고, 펼치면 흐리게 보인다(복사·폐기 없음).
// - 보관 공간(WP-527)은 새 링크를 만들 수 없고, 기존 링크 복사·폐기만 한다.
// 목록은 TanStack Query 로 받고, 생성·폐기 결과는 캐시에 먼저 반영한 뒤 서버 목록으로 다시 맞춘다(invalidate).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Folder } from 'lucide-react';
import { useState } from 'react';

import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareLandingUrl,
  type ShareLink,
  type ShareTargetRef,
} from '@/api/drive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { StatusBadge } from '@/components/ui/status-badge';
import { handleApiError } from '@/lib/api-error';
import { copyToClipboard } from '@/lib/copyToClipboard';
import { splitShareLinks } from '@/lib/driveShareLinks';
import { formatDateOnly, formatInstantMonthDay } from '@/lib/formatters';
import { initialExpiry, nextExpiry, shareFormGuide } from '@/lib/shareLinkDefaults';
import { isSupportedDateKey, SUPPORTED_DATE_MAX, SUPPORTED_DATE_RANGE_MESSAGE } from '@/lib/supportedDate';
import { cn } from '@/lib/utils';
import { sharePasswordError } from '@/lib/validations/shareLink';

interface ShareLinkModalProps {
  /** 링크를 만들고 보는 대상 — 파일 또는 폴더(WP-1538). */
  target: ShareTargetRef;
  /** 보관된 공간(읽기 전용) — 새 링크는 만들 수 없고 기존 링크 복사·폐기만 한다(WP-527). */
  archived?: boolean;
  onClose: () => void;
}

/** 생성 요청 본문 — 비밀번호·만료일은 비우면 보내지 않는다. */
type CreateBody = Parameters<typeof createShareLink>[1];

/** 살아 있는 링크의 만료 배지 문구 — 공용 zero-pad 날짜(YYYY-MM-DD, #617) 뒤에 「까지」. */
function expiryLabel(iso: string | null): string {
  return iso ? `${formatDateOnly(iso)} 까지` : '만료 없음';
}

/** 「만든 사람 · 날짜」 — 이름을 모르면(null) 날짜만 보인다. */
function creatorLabel(link: ShareLink): string {
  const date = formatInstantMonthDay(link.createdAt);
  return link.createdByName ? `${link.createdByName} · ${date}` : date;
}

/** 가시성 배지 — 외부/사내. 살아 있는 링크·지난 링크가 함께 쓴다. */
function AudienceBadge({ link }: { link: ShareLink }) {
  return <Badge variant="outline">{link.audience === 'EXTERNAL' ? '외부' : '사내'}</Badge>;
}

export function ShareLinkModal({ target, archived = false, onClose }: ShareLinkModalProps) {
  const qc = useQueryClient();
  // API 에는 종류·id 만 넘긴다(이름은 표시용, WP-1538).
  const ref = { kind: target.kind, id: target.id } as const;
  const linksKey = ['drive', 'shareLinks', target.kind, target.id] as const;

  // 폼 상태 — 가시성(기본 외부), 비밀번호(선택), 만료일(선택)
  const [audience, setAudience] = useState<'EXTERNAL' | 'INTERNAL'>('EXTERNAL');
  const [password, setPassword] = useState('');
  // 폴더 + 외부는 만료일을 30일 뒤로 미리 채운다(웹 전용 기본값, WP-1538 P4) — 사용자가 날짜 칸을 만지기 전까지만 가시성을 따라간다.
  const [expiresAt, setExpiresAt] = useState(() => initialExpiry(target.kind, new Date()));
  const [expiresTouched, setExpiresTouched] = useState(false);
  // 「+ 새 링크 만들기」로 폼을 펼쳤는가 — 살아 있는 링크가 있으면 폼은 접혀 있다가 이걸로 연다.
  const [formOpen, setFormOpen] = useState(false);
  // 방금 만든 링크 id — 목록 맨 위 카드를 강조해 어느 링크가 복사됐는지 보인다. 다시 만들면 새 링크로 옮긴다.
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // 만료일 폼 에러(#673) — 과거 날짜 입력 시 생성 자체를 막기 위한 인라인 메시지
  const [expiresAtError, setExpiresAtError] = useState<string | null>(null);
  // 비밀번호 인라인 에러 — 한도(bcrypt 72바이트, WP-497)·공백만(WP-1385). 토스트 대신 입력 아래에 안내한다.
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 링크 목록 — 모달을 열 때마다 새로 받는다(staleTime 0). 토큰이 든 목록이라 모달을 닫으면 캐시에 남기지 않는다(gcTime 0).
  // 실패는 곧바로 안내한다(재시도 없음).
  const list = useQuery({
    queryKey: linksKey,
    queryFn: () => listShareLinks(ref),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  /**
   * 캐시의 목록을 화면에서 먼저 고친다(새 링크를 맨 위에·폐기 표시). dataUpdatedAt 은 「서버 목록이 마지막으로 온 시각」 그대로 둔다 —
   * 그래서 아래 listFailed 가 「서버 목록을 한 번도 못 받았다」를 뜻하게 된다(손으로 넣은 항목은 서버 목록이 아니다).
   */
  function patchLinks(update: (prev: ShareLink[]) => ShareLink[]) {
    const updatedAt = qc.getQueryState(linksKey)?.dataUpdatedAt ?? 0;
    qc.setQueryData<ShareLink[]>(linksKey, (prev) => update(prev ?? []), { updatedAt });
  }

  /** 서버 목록으로 다시 맞춘다 — 실패해도 캐시(새 링크·폐기 표시)는 그대로 남는다. */
  function refetchLinks() {
    void qc.invalidateQueries({ queryKey: linksKey });
  }

  const links = list.data ?? [];
  // 목록 조회 실패 — 서버 목록을 한 번도 못 받았고 조회가 실패했을 때. 링크가 있는데 「없음」처럼 보이지 않게 안내한다(WP-527).
  // 처음 조회가 성공한 뒤 생성·폐기 재조회만 실패하면 안내하지 않는다(화면 목록은 이미 맞다).
  const listFailed = list.errorUpdatedAt > 0 && list.dataUpdatedAt === 0;
  const { live, past } = splitShareLinks(links);
  // 폼 표시 — 보관 공간이 아니고, 직접 펼쳤거나 · 첫 응답이 온 뒤(성공·실패 모두) 살아 있는 링크가 없을 때(조회가 실패해도 만들 길은 남긴다).
  // 첫 응답 전(pending)엔 폼·「+ 새 링크 만들기」를 섣불리 보이지 않는다(깜빡임 방지).
  const showForm = !archived && (formOpen || (!list.isPending && live.length === 0));
  // 대상 종류·가시성별 폼 안내(WP-1538) — 폴더 외부 경고·사내 안내·만료일 기본값 안내. 파일은 모두 null.
  const guide = shareFormGuide(target.kind, audience);
  // 폼 [취소]는 접을 수 있을 때만 — 살아 있는 링크가 없으면 접어도 다시 펼쳐지므로 두지 않는다.
  const canCollapseForm = live.length > 0;

  /** 폼 입력·오류를 처음 상태로 되돌린다 — 접거나 만든 뒤 다시 펼쳤을 때 지난 값이 남지 않게. */
  function resetForm() {
    setAudience('EXTERNAL');
    setPassword('');
    setExpiresTouched(false);
    setExpiresAt(initialExpiry(target.kind, new Date()));
    setPasswordError(null);
    setExpiresAtError(null);
  }

  /** 폼 [취소] — 입력을 버리고 「+ 새 링크 만들기」로 되돌린다. */
  function onCancelForm() {
    resetForm();
    setFormOpen(false);
  }

  /** 링크 URL 복사 — 카드 [복사]와 생성 직후 자동 복사가 함께 쓴다. 실패 문구는 copyToClipboard 의 공용 안내. */
  function onCopy(token: string, success = '링크를 복사했습니다') {
    void copyToClipboard(shareLandingUrl(token), { success });
  }

  // 생성 — 서버가 목록과 같은 모양의 항목을 돌려주므로 그대로 맨 위에 넣는다(같은 id 는 중복 제거). 재조회가 늦거나 실패해도 새 링크가 바로 보인다.
  const create = useMutation({
    mutationFn: (body: CreateBody) => createShareLink(ref, body),
    onSuccess: (created) => {
      resetForm();
      setFormOpen(false);
      patchLinks((prev) => [created, ...prev.filter((l) => l.id !== created.id)]);
      setHighlightId(created.id);
      // 만들자마자 복사 — 대부분 만든 링크를 바로 보내려고 만든다.
      if (created.token) onCopy(created.token, '링크를 만들고 복사했습니다');
      refetchLinks();
    },
    onError: (e) => handleApiError(e, '공유 링크 생성에 실패했습니다.'),
  });

  /**
   * 폐기 — 성공하면 재조회를 기다리지 않고 그 카드를 바로 폐기 상태로 바꿔 「지난 링크」로 옮긴다(URL·복사 없음).
   * 폐기 실패 안내는 폐기 요청 자체가 실패했을 때만 — 그 뒤 재조회가 실패해도 링크는 실제로 끊겼으니 「폐기 실패」라 하지 않는다.
   */
  const revoke = useMutation({
    mutationFn: (id: number) => revokeShareLink(id),
    onSuccess: (_, id) => {
      patchLinks((prev) => prev.map((l) => (l.id === id ? { ...l, revoked: true, active: false, token: null } : l)));
      refetchLinks();
    },
    onError: (e) => handleApiError(e, '공유 링크 폐기에 실패했습니다.'),
  });

  /** 공유 링크 생성 — 입력을 검사한 뒤 요청한다. */
  function onCreate() {
    // 모든 입력을 한 번에 검사해 각 칸의 오류를 세우거나 지운 뒤 막는다 — 한 칸만 보고 돌아가면 이미 고친
    // 다른 칸의 오류가 화면에 남는다(WP-1385).
    // 비밀번호: 72바이트 초과(WP-497)·공백만(WP-1385 — 예전엔 서버가 「비밀번호 없음」으로 바꿔 누구나 여는 링크가
    // 조용히 만들어졌다). 빈 칸은 오류가 아니고 아래에서 undefined(비밀번호 없음)로 보낸다.
    const nextPasswordError = sharePasswordError(password);

    // 만료일 — 로컬 23:59:59 로 설정해 UTC+ 사용자의 당일 만료 오인 방지("2026-06-30" → "2026-06-30T23:59:59" 로컬 → ISO).
    let expiresAtIso: string | undefined;
    let nextExpiresAtError: string | null = null;
    if (expiresAt && !isSupportedDateKey(expiresAt)) {
      // 범위 밖 날짜(5자리 연도 등) — 그대로 toISOString 하면 RangeError 로 「링크 생성」이 무반응이었다(WP-901).
      // 변환 전에 서버와 같은 범위 안내로 막는다.
      nextExpiresAtError = SUPPORTED_DATE_RANGE_MESSAGE;
    } else if (expiresAt) {
      expiresAtIso = new Date(`${expiresAt}T23:59:59`).toISOString();
      // 과거 날짜 가드(#673) — <input type=date min> 은 키보드 직접 입력으로 우회 가능해 API 호출 전에 재검증한다.
      if (new Date(expiresAtIso) < new Date()) nextExpiresAtError = '만료일은 오늘 이후 날짜여야 합니다.';
    }

    setPasswordError(nextPasswordError);
    setExpiresAtError(nextExpiresAtError);
    if (nextPasswordError || nextExpiresAtError) return;

    create.mutate({ audience, password: password || undefined, expiresAt: expiresAtIso });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg" data-testid="share-link-modal">
        <DialogHeader>
          <DialogTitle>공유 링크</DialogTitle>
          {/* 어느 파일·폴더의 링크인지 제목 아래에 보인다(예전엔 스크린리더 전용) — 폴더는 목록과 같은 폴더 아이콘, 긴 이름은 한 줄로 줄인다. */}
          <DialogDescription className="flex min-w-0 items-center gap-1.5" data-testid="share-link-file-name" title={target.name}>
            {target.kind === 'folder' && (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden data-testid="share-target-folder-icon" />
            )}
            <span className="truncate">{target.name}</span>
          </DialogDescription>
        </DialogHeader>

        {/* ── 보관 공간: 생성 폼 대신 안내(WP-527) — 누르면 내부 id 가 담긴 403 토스트만 뜨던 경로 ── */}
        {archived && (
          <p
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="share-link-archived-notice"
          >
            보관된 공간이라 새 링크를 만들 수 없습니다. 기존 링크는 확인하고 폐기할 수 있습니다.
          </p>
        )}

        {listFailed && (
          <p className="text-xs text-destructive" data-testid="share-link-list-error">
            기존 링크를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
          </p>
        )}

        {/* ── 살아 있는 링크 — 다시 복사가 첫 동작이라 맨 위에 둔다 ── */}
        {live.length > 0 && (
          <ul className="space-y-2" data-testid="share-link-list">
            {live.map((lk) => {
              const { token } = lk;
              const highlighted = lk.id === highlightId;
              // 이 카드의 폐기 요청이 진행 중인가 — 다른 카드의 단추는 막지 않는다.
              const revoking = revoke.isPending && revoke.variables === lk.id;
              return (
                <li
                  key={lk.id}
                  className={cn(
                    'min-w-0 space-y-2 rounded-md border border-border p-3',
                    highlighted && 'border-primary ring-1 ring-primary',
                  )}
                  data-testid="share-link-item"
                  data-highlighted={highlighted ? 'true' : undefined}
                >
                  {/* 대상·만료·비밀번호·만든 사람을 한 줄에 — 좁으면(모바일) 만든 사람이 다음 줄로 내려가 칸 폭을 키우지 않는다 */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <AudienceBadge link={lk} />
                    <Badge variant="default">{expiryLabel(lk.expiresAt)}</Badge>
                    {lk.hasPassword && <Badge variant="secondary">비밀번호</Badge>}
                    <span className="ml-auto min-w-0 max-w-full truncate text-muted-foreground">{creatorLabel(lk)}</span>
                  </div>
                  {/* URL + [복사] — 예전에 만든 링크(토큰 없음)는 서버에 해시만 남아 URL 을 되살릴 수 없어 안내로 바꾼다. 폐기는 둘 다 된다. */}
                  <div
                    className="flex min-w-0 items-center gap-2"
                    data-testid={token ? undefined : 'share-link-legacy-notice'}
                  >
                    {token ? (
                      <>
                        <Input
                          readOnly
                          value={shareLandingUrl(token)}
                          className="h-8 min-w-0 flex-1 font-mono text-xs"
                          aria-label="공유 링크 URL"
                          onFocus={(e) => e.target.select()}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => onCopy(token)}
                          aria-label="공유 링크 복사"
                          data-testid="share-link-copy-btn"
                        >
                          복사
                        </Button>
                      </>
                    ) : (
                      <p className="min-w-0 flex-1 text-xs text-muted-foreground">예전에 만든 링크라 URL을 다시 볼 수 없습니다.</p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive hover:text-destructive"
                      disabled={revoking}
                      onClick={() => revoke.mutate(lk.id)}
                      aria-label={`링크 ${lk.id} 폐기`}
                      data-testid="share-link-revoke-btn"
                    >
                      {revoking ? '폐기 중...' : '폐기'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── 새 링크: 폼을 그 자리에 펼치거나, 접혀 있으면 「+ 새 링크 만들기」 ── */}
        {showForm ? (
          <div className="space-y-4 rounded-md border border-border p-3" data-testid="share-link-form">
            <p className="text-sm font-medium">새 링크</p>

            {/* 가시성 라디오 */}
            <div className="space-y-2">
              <Label>가시성</Label>
              <RadioGroup
                value={audience}
                onValueChange={(v) => {
                  const next = v as 'EXTERNAL' | 'INTERNAL';
                  setAudience(next);
                  // 폴더 기본 만료일은 안 만졌을 때만 가시성을 따라간다(WP-1538).
                  setExpiresAt((cur) =>
                    nextExpiry({ kind: target.kind, audience: next, touched: expiresTouched, current: cur, today: new Date() }),
                  );
                }}
                className="flex gap-4"
                aria-label="공유 대상"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="EXTERNAL" id="share-audience-external" />
                  <Label htmlFor="share-audience-external" className="cursor-pointer font-normal">
                    외부 (인증 없이 다운로드)
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="INTERNAL" id="share-audience-internal" />
                  <Label htmlFor="share-audience-internal" className="cursor-pointer font-normal">
                    사내 전용
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* 폴더 안내(WP-1538) — 외부는 노란 경고, 사내는 열람 방식 안내. 정적 문구라 role=alert 가 아니다. */}
            {guide.warning && (
              <p
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                data-testid="share-folder-external-warning"
              >
                {guide.warning}
              </p>
            )}
            {guide.notice && (
              <p className="text-xs text-muted-foreground" data-testid="share-folder-internal-notice">
                {guide.notice}
              </p>
            )}

            {/* 비밀번호 입력 (선택) */}
            <div className="space-y-1">
              <Label htmlFor="share-password">비밀번호 (선택)</Label>
              <Input
                id="share-password"
                type="password"
                placeholder="비워두면 비밀번호 없음"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // 오류가 보이는 동안엔 지금 값으로 다시 판정한다 — 고치면 지우고, 다른 문제로 바뀌면 그 안내로 바꾼다
                  // (지난 문구가 남지 않게). 오류가 없을 땐 입력 중에 미리 띄우지 않는다.
                  if (passwordError != null) setPasswordError(sharePasswordError(e.target.value));
                }}
                autoComplete="new-password"
                aria-invalid={passwordError != null}
                aria-describedby={passwordError ? 'share-password-error' : undefined}
              />
              {passwordError && (
                <p id="share-password-error" className="text-xs text-destructive" data-testid="share-password-error">
                  {passwordError}
                </p>
              )}
            </div>

            {/* 만료일 입력 (선택) */}
            <div className="space-y-1">
              <Label htmlFor="share-expires">만료일 (선택)</Label>
              <Input
                id="share-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => {
                  setExpiresAt(e.target.value);
                  setExpiresTouched(true);
                  setExpiresAtError(null);
                }}
                min={new Date().toISOString().slice(0, 10)}
                max={SUPPORTED_DATE_MAX}
                aria-invalid={expiresAtError != null}
                aria-describedby={expiresAtError ? 'share-expires-error' : undefined}
              />
              {guide.expiryHint && !expiresTouched && <p className="text-xs text-muted-foreground">{guide.expiryHint}</p>}
              {expiresAtError && (
                <p id="share-expires-error" className="text-xs text-destructive" data-testid="share-expires-error">
                  {expiresAtError}
                </p>
              )}
            </div>

            {/* 접을 수 있으면 [취소] + [링크 생성] 을 오른쪽에, 아니면 [링크 생성] 을 꽉 채운다 */}
            <div className="flex justify-end gap-2">
              {canCollapseForm && (
                <Button variant="ghost" onClick={onCancelForm} data-testid="share-link-form-cancel">
                  취소
                </Button>
              )}
              <Button
                onClick={onCreate}
                disabled={create.isPending}
                className={cn(!canCollapseForm && 'w-full')}
                data-testid="share-link-create-btn"
              >
                {create.isPending ? '생성 중...' : '링크 생성'}
              </Button>
            </div>
          </div>
        ) : (
          !archived &&
          !list.isPending && (
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setFormOpen(true)}
              data-testid="share-link-new-btn"
            >
              + 새 링크 만들기
            </Button>
          )
        )}

        {/* ── 지난 링크(폐기·만료) — 접어 두고, 펼치면 흐리게. 다시 쓸 수 없으니 URL·복사·폐기는 없다 ── */}
        {past.length > 0 && (
          <Collapsible className="space-y-2">
            <CollapsibleTrigger
              className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid="share-link-past-toggle"
            >
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
              지난 링크 {past.length}개 (폐기·만료)
            </CollapsibleTrigger>
            <CollapsibleContent asChild>
              <ul className="space-y-1">
                {past.map((lk) => (
                  <li
                    key={lk.id}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border px-3 py-2 text-xs opacity-60"
                    data-testid="share-link-past-item"
                  >
                    <AudienceBadge link={lk} />
                    {/* 폐기·만료 모두 「다시 쓸 수 없음」이라 의미상 비활성 배지 */}
                    <StatusBadge type="inactive">{lk.revoked ? '폐기됨' : '만료됨'}</StatusBadge>
                    <span className="ml-auto min-w-0 max-w-full truncate text-muted-foreground">{creatorLabel(lk)}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 코너 X 버튼(sr-only "닫기")과 라벨 중복을 피하기 위해 하단 버튼은 앱 전역 컨벤션(#829)에 맞춰 "취소" 사용 */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
