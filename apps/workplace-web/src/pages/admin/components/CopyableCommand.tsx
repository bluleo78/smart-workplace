// 읽기 전용 명령어 블록 + 복사 버튼.
// 긴 명령은 잘리거나 가로 스크롤되지 않고 줄바꿈해 전부 보이게 한다(복사는 원본 문자열 그대로).

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/copyText';

export function CopyableCommand({ command, testId }: { command: string; testId: string }) {
  // 클립보드 접근이 막힌 환경에서는 실패를 알리고 직접 선택하도록 안내한다.
  const onCopy = async () => {
    if (await copyText(command)) toast.success('명령을 복사했습니다');
    else toast.error('복사에 실패했습니다. 명령을 직접 선택해 복사하세요.');
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
        aria-label="명령 복사"
        data-testid={`${testId}-copy`}
      >
        복사
      </Button>
    </div>
  );
}
