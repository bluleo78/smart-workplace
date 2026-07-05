// 공개 공유 링크 다운로드 랜딩 페이지 — 인증 없이 접근 가능.
// /s/:token 라우트에 마운트되며 AppLayout 을 사용하지 않는다.
//
// 동작:
//   - 항상 비밀번호 입력 필드 + "다운로드" 버튼 표시.
//     (비밀번호 불필요 링크는 빈 채로 클릭하면 바로 다운로드됨)
//   - 다운로드는 fetch(bearer 헤더 옵션 + X-Share-Password 헤더)로 Blob 수신 후 브라우저 다운로드 트리거.
//   - URL 에 비밀번호를 포함하지 않아 히스토리/Referer 노출 방지.
//   - 오류는 상태 코드별 한국어 인라인 메시지로 표시.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { downloadSharedFile,ShareDownloadError } from '@/api/drive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** 상태 코드 → 한국어 안내 메시지 (원인) */
function errorMessage(status: number): string {
  if (status === 401) return '비밀번호가 필요하거나 올바르지 않습니다. (사내 링크는 로그인이 필요합니다)'
  if (status === 410) return '만료되었거나 폐기된 링크입니다.'
  if (status === 404) return '존재하지 않는 링크입니다.'
  return '다운로드에 실패했습니다. 잠시 후 다시 시도하세요.'
}

/** 상태 코드 → 다음 행동 안내 (막다른 페이지 방지, #677) */
function errorAction(status: number): string {
  if (status === 410 || status === 404) return '링크를 공유한 사람에게 새 링크를 요청하세요.';
  return '';
}

export default function ShareLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  // 'idle' | 'loading' | 'success' | 'error'
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [errStatus, setErrStatus] = useState<number>(0)

  async function handleDownload() {
    if (!token) return
    setStatus('loading')
    setErrMsg(null)
    try {
      await downloadSharedFile(token, password || undefined)
      setStatus('success')
    } catch (e) {
      const code = e instanceof ShareDownloadError ? e.status : 0
      setErrStatus(code)
      setErrMsg(errorMessage(code))
      setStatus('error')
    }
  }

  return (
    // 전체 화면 중앙 정렬 — AppLayout 없이 최소 UI
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* 브랜드/홈 링크 — AppLayout 밖 독립 페이지라 대체 내비게이션 수단이 전혀 없어 추가 (#677) */}
      <Link to="/" className="mb-6 text-sm font-medium text-muted-foreground hover:text-foreground">
        Smart Workplace
      </Link>
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        {/* 헤더 */}
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold">파일 다운로드</h1>
          <p className="text-sm text-muted-foreground">
            공유 링크를 통해 파일을 받을 수 있습니다.
          </p>
        </div>

        {/* 비밀번호 입력 — 항상 표시. 비밀번호 없는 링크는 빈 채로 다운로드. */}
        <div className="space-y-2">
          <Label htmlFor="share-download-password">비밀번호 (없으면 비워두세요)</Label>
          <Input
            id="share-download-password"
            type="password"
            placeholder="링크 비밀번호를 입력하세요"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleDownload()
            }}
            aria-label="공유 링크 비밀번호"
          />
        </div>

        {/* 에러 메시지 — 원인(errMsg) + 다음 행동(errAction/로그인 링크)을 함께 제공해 막다른 페이지 방지 (#677) */}
        {status === 'error' && errMsg && (
          <div className="space-y-1">
            <p className="text-sm text-destructive" role="alert" data-testid="share-error-msg">
              {errMsg}
            </p>
            {errStatus === 401 && (
              <Link
                to="/login"
                className="text-sm font-medium text-primary underline underline-offset-4"
                data-testid="share-error-login-link"
              >
                로그인 페이지로 이동
              </Link>
            )}
            {errorAction(errStatus) && (
              <p className="text-sm text-muted-foreground" data-testid="share-error-action">
                {errorAction(errStatus)}
              </p>
            )}
          </div>
        )}

        {/* 성공 메시지 */}
        {status === 'success' && (
          <p className="text-sm text-foreground" data-testid="share-success-msg">
            다운로드가 시작되었습니다.
          </p>
        )}

        {/* 다운로드 버튼 */}
        <Button
          className="w-full"
          onClick={() => void handleDownload()}
          disabled={status === 'loading'}
          data-testid="share-download-btn"
        >
          {status === 'loading' ? '다운로드 중...' : '다운로드'}
        </Button>
      </div>
    </div>
  );
}
