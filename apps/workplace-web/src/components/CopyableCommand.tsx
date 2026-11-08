// 읽기 전용 명령어 블록 + 복사 버튼 — 관리 화면과 설정 가이드의 연결 방법 단계(WP-1281)가 함께 쓴다.
// 긴 명령은 잘리거나 가로 스크롤되지 않고 줄바꿈해 전부 보이게 한다(복사는 원본 문자열 그대로).

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/copyText';
import { objectParticle } from '@/lib/utils';

/**
 * label — 복사하는 것의 이름(기본 「명령」). 버튼 접근 이름(「<label> 복사」)과 복사 알림에 쓴다.
 * 한 화면에 블록이 여럿이면(예: 설치 명령 + 연결 주소) 이름이 같아 스크린리더로 구분되지 않고,
 * 주소를 「명령」이라 부르게 되므로 무엇을 복사하는지 적는다(WP-1434).
 */
export function CopyableCommand({ command, testId, label = '명령' }: { command: string; testId: string; label?: string }) {
  // 클립보드 접근이 막힌 환경에서는 실패를 알리고 직접 선택하도록 안내한다.
  const onCopy = async () => {
    if (await copyText(command)) toast.success(`${label}${objectParticle(label)} 복사했습니다`);
    else toast.error(`복사에 실패했습니다. ${label}${objectParticle(label)} 직접 선택해 복사하세요.`);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <pre
        className="max-w-full whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs"
        data-testid={testId}
      >
        <code>{command}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-end"
        onClick={onCopy}
        aria-label={`${label} 복사`}
        data-testid={`${testId}-copy`}
      >
        복사
      </Button>
    </div>
  );
}
