// 파일 공유 링크 생성·관리 모달.
// - 가시성(외부/사내) 라디오 + 비밀번호(선택) + 만료일(선택) 입력 → [생성]
// - 생성 직후 URL 1회 표시 + 복사 버튼 (이후 재확인 불가 안내)
// - 하단에 기존 링크 목록: 가시성·만료·비번여부·폐기 여부 + [폐기] 버튼

import { useEffect, useState } from 'react';

import {
  type CreatedShareLink,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareLandingUrl,
  type ShareLink,
} from '@/api/drive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { handleApiError } from '@/lib/api-error';
import { copyToClipboard } from '@/lib/copyToClipboard';
import { formatDateOnly } from '@/lib/formatters';
import { isSupportedDateKey, SUPPORTED_DATE_MAX, SUPPORTED_DATE_RANGE_MESSAGE } from '@/lib/supportedDate';
import { isPasswordWithinBytes, PASSWORD_BYTES_MESSAGE } from '@/lib/validations/user';
import type { DriveFile } from '@/types/drive';

interface ShareLinkModalProps {
  file: DriveFile;
  /** 보관된 공간(읽기 전용) — 새 링크는 만들 수 없고 기존 링크 확인·폐기만 한다(WP-527). */
  archived?: boolean;
  onClose: () => void;
}

/** 날짜를 공용 zero-pad 포맷("YYYY-MM-DD") 또는 "만료됨" 으로 표시 (#617). */
function formatExpiry(iso: string | null): string {
  if (!iso) return '만료 없음';
  const d = new Date(iso);
  if (d < new Date()) return '만료됨';
  return formatDateOnly(iso);
}

function isExpired(iso: string | null): boolean {
  return iso != null && new Date(iso) < new Date();
}

export function ShareLinkModal({ file, archived = false, onClose }: ShareLinkModalProps) {
  // 폼 상태 — 가시성(기본 외부), 비밀번호(선택), 만료일(선택)
  const [audience, setAudience] = useState<'EXTERNAL' | 'INTERNAL'>('EXTERNAL');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // 생성 직후 1회 노출되는 링크 응답
  const [created, setCreated] = useState<CreatedShareLink | null>(null);

  // 기존 링크 목록
  const [links, setLinks] = useState<ShareLink[]>([]);
  // 목록 조회 실패 — 링크가 있는데 「없음」처럼 보이지 않게 안내한다(WP-527).
  const [listFailed, setListFailed] = useState(false);

  // 진행 중 플래그
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  // 만료일 폼 에러(#673) — 과거 날짜 입력 시 생성 자체를 막기 위한 인라인 메시지
  const [expiresAtError, setExpiresAtError] = useState<string | null>(null);
  // 비밀번호 한도(bcrypt 72바이트) 인라인 에러(WP-497) — 서버 영어 원문 토스트 대신 입력 아래에 안내한다.
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 모달 열릴 때 기존 링크 목록 로드
  useEffect(() => {
    void listShareLinks(file.id)
      .then(setLinks)
      .catch(() => setListFailed(true));
  }, [file.id]);

  /** 공유 링크 생성 */
  async function onCreate() {
    // 범위 밖 날짜(5자리 연도 등) — 날짜 칸이 그대로 내보내는 값으로 아래 toISOString 이 RangeError 를 던져
    // 「링크 생성」이 아무 반응도 없었다(WP-901). 변환 전에 서버와 같은 범위 안내로 막는다.
    if (expiresAt && !isSupportedDateKey(expiresAt)) {
      setExpiresAtError(SUPPORTED_DATE_RANGE_MESSAGE);
      return;
    }
    // 만료일 — 로컬 23:59:59 로 설정해 UTC+ 사용자의 당일 만료 오인 방지.
    // "2026-06-30" 입력 → "2026-06-30T23:59:59" 로컬 → ISO 변환.
    const expiresAtIso = expiresAt
      ? new Date(`${expiresAt}T23:59:59`).toISOString()
      : undefined;

    if (!isPasswordWithinBytes(password)) {
      setPasswordError(PASSWORD_BYTES_MESSAGE);
      return;
    }

    // 과거 날짜 가드(#673) — <input type=date min> 은 키보드 직접 입력으로 우회 가능해
    // API 호출 전에 명시적으로 재검증한다. 통과하면 이전 에러 메시지를 지운다.
    if (expiresAtIso && new Date(expiresAtIso) < new Date()) {
      setExpiresAtError('만료일은 오늘 이후 날짜여야 합니다.');
      return;
    }
    setExpiresAtError(null);

    setCreating(true);
    try {
      const res = await createShareLink(file.id, {
        audience,
        password: password || undefined,
        expiresAt: expiresAtIso,
      });
      setCreated(res);
      // 폼 초기화
      setPassword('');
      setExpiresAt('');
      // 목록 갱신 — 새 링크 포함
      const updated = await listShareLinks(file.id);
      setLinks(updated);
    } catch (e) {
      handleApiError(e, '공유 링크 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  }

  /** 공유 링크 폐기 */
  async function onRevoke(id: number) {
    setRevokingId(id);
    try {
      await revokeShareLink(id);
      const updated = await listShareLinks(file.id);
      setLinks(updated);
    } catch (e) {
      handleApiError(e, '공유 링크 폐기에 실패했습니다.');
    } finally {
      setRevokingId(null);
    }
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
          <DialogDescription className="sr-only">{file.name} 공유 링크 관리</DialogDescription>
        </DialogHeader>

        {/* ── 보관 공간: 생성 폼 대신 안내(WP-527) — 누르면 내부 id 가 담긴 403 토스트만 뜨던 경로 ── */}
        {archived ? (
          <p
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="share-link-archived-notice"
          >
            보관된 공간이라 새 링크를 만들 수 없습니다. 기존 링크는 확인하고 폐기할 수 있습니다.
          </p>
        ) : (
        /* ── 링크 생성 폼 ── */
        <div className="space-y-4">
          {/* 가시성 라디오 */}
          <div className="space-y-2">
            <Label>가시성</Label>
            <RadioGroup
              value={audience}
              onValueChange={(v) => setAudience(v as 'EXTERNAL' | 'INTERNAL')}
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
                // 한도 안으로 고치면 바로 에러를 지운다(넘는 동안은 처음 안내를 유지)
                if (isPasswordWithinBytes(e.target.value)) setPasswordError(null);
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
                setExpiresAtError(null);
              }}
              min={new Date().toISOString().slice(0, 10)}
              max={SUPPORTED_DATE_MAX}
              aria-invalid={expiresAtError != null}
              aria-describedby={expiresAtError ? 'share-expires-error' : undefined}
            />
            {expiresAtError && (
              <p id="share-expires-error" className="text-xs text-destructive" data-testid="share-expires-error">
                {expiresAtError}
              </p>
            )}
          </div>

          <Button
            onClick={onCreate}
            disabled={creating}
            className="w-full"
            data-testid="share-link-create-btn"
          >
            {creating ? '생성 중...' : '링크 생성'}
          </Button>
        </div>
        )}

        {/* ── 생성 직후 URL 1회 표시 ── */}
        {created && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2" data-testid="share-link-created-url">
            <p className="text-xs font-medium text-destructive">
              이 URL은 지금만 확인할 수 있습니다. 분실 시 새 링크를 발급하세요.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={shareLandingUrl(created.token)}
                className="flex-1 text-xs font-mono"
                aria-label="생성된 공유 링크 URL"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copyToClipboard(shareLandingUrl(created.token), {
                    success: '링크를 복사했습니다',
                    failure: '복사에 실패했습니다. 직접 선택해 복사하세요.',
                  })
                }
                aria-label="공유 링크 복사"
              >
                복사
              </Button>
            </div>
          </div>
        )}

        {listFailed && (
          <p className="text-xs text-destructive" data-testid="share-link-list-error">
            기존 링크를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
          </p>
        )}

        {/* ── 기존 링크 목록 ── */}
        {links.length > 0 && (
          <div className="space-y-2" data-testid="share-link-list">
            <p className="text-xs font-medium text-muted-foreground">기존 링크</p>
            <ul className="space-y-1">
              {links.map((lk) => (
                <li
                  key={lk.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                  data-testid="share-link-item"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {/* 가시성 배지 */}
                    <Badge variant="outline">
                      {lk.audience === 'EXTERNAL' ? '외부' : '사내'}
                    </Badge>
                    {/* 상태 배지 — API 토큰 페이지와 동일 매핑(활성=default, 폐기·만료=secondary) */}
                    <Badge variant={lk.revoked || isExpired(lk.expiresAt) ? 'secondary' : 'default'}>
                      {lk.revoked ? '폐기됨' : formatExpiry(lk.expiresAt)}
                    </Badge>
                    {/* 비밀번호 여부 */}
                    {lk.hasPassword && <span>🔒 비번</span>}
                  </span>
                  {/* 유효한 링크만 폐기 버튼 표시 */}
                  {!lk.revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      disabled={revokingId === lk.id}
                      onClick={() => onRevoke(lk.id)}
                      aria-label={`링크 ${lk.id} 폐기`}
                      data-testid="share-link-revoke-btn"
                    >
                      {revokingId === lk.id ? '폐기 중...' : '폐기'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
