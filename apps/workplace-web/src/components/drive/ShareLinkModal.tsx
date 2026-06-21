// 파일 공유 링크 생성·관리 모달.
// - 가시성(외부/사내) 라디오 + 비밀번호(선택) + 만료일(선택) 입력 → [생성]
// - 생성 직후 URL 1회 표시 + 복사 버튼 (이후 재확인 불가 안내)
// - 하단에 기존 링크 목록: 가시성·만료·비번여부·폐기 여부 + [폐기] 버튼

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  type CreatedShareLink,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareLandingUrl,
  type ShareLink,
} from '@/api/drive';
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
import type { DriveFile } from '@/types/drive';

interface ShareLinkModalProps {
  file: DriveFile;
  onClose: () => void;
}

/** 날짜를 한국어 "YYYY.MM.DD" 또는 "만료됨" 포맷으로 표시. */
function formatExpiry(iso: string | null): string {
  if (!iso) return '만료 없음';
  const d = new Date(iso);
  if (d < new Date()) return '만료됨';
  return d.toLocaleDateString('ko-KR');
}

export function ShareLinkModal({ file, onClose }: ShareLinkModalProps) {
  // 폼 상태 — 가시성(기본 외부), 비밀번호(선택), 만료일(선택)
  const [audience, setAudience] = useState<'EXTERNAL' | 'INTERNAL'>('EXTERNAL');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // 생성 직후 1회 노출되는 링크 응답
  const [created, setCreated] = useState<CreatedShareLink | null>(null);

  // 기존 링크 목록
  const [links, setLinks] = useState<ShareLink[]>([]);

  // 진행 중 플래그
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  // 모달 열릴 때 기존 링크 목록 로드
  useEffect(() => {
    void listShareLinks(file.id)
      .then(setLinks)
      .catch(() => {/* 목록 로드 실패는 무음 처리 */});
  }, [file.id]);

  /** 공유 링크 생성 */
  async function onCreate() {
    setCreating(true);
    try {
      // 만료일 — 로컬 23:59:59 로 설정해 UTC+ 사용자의 당일 만료 오인 방지.
      // "2026-06-30" 입력 → "2026-06-30T23:59:59" 로컬 → ISO 변환.
      const expiresAtIso = expiresAt
        ? new Date(`${expiresAt}T23:59:59`).toISOString()
        : undefined
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

  /** 클립보드 복사 */
  async function onCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('링크를 복사했습니다');
    } catch {
      toast.error('복사에 실패했습니다. 직접 선택해 복사하세요.');
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

        {/* ── 링크 생성 폼 ── */}
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
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {/* 만료일 입력 (선택) */}
          <div className="space-y-1">
            <Label htmlFor="share-expires">만료일 (선택)</Label>
            <Input
              id="share-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
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
                onClick={() => onCopy(shareLandingUrl(created.token))}
                aria-label="공유 링크 복사"
              >
                복사
              </Button>
            </div>
          </div>
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
                  <span className="flex gap-3 text-muted-foreground">
                    {/* 가시성 배지 */}
                    <span className="font-medium text-foreground">
                      {lk.audience === 'EXTERNAL' ? '외부' : '사내'}
                    </span>
                    {/* 만료일 */}
                    <span>{formatExpiry(lk.expiresAt)}</span>
                    {/* 비밀번호 여부 */}
                    {lk.hasPassword && <span>🔒 비번</span>}
                    {/* 폐기 배지 */}
                    {lk.revoked && (
                      <span className="text-destructive font-medium">폐기됨</span>
                    )}
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
