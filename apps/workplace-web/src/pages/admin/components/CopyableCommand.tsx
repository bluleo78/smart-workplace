// 읽기 전용 명령어 블록 + 복사 버튼.
// 좁은 화면에서 페이지가 가로로 넘치지 않도록 코드 블록 자체가 가로 스크롤된다.

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function CopyableCommand({ command, testId }: { command: string; testId: string }) {
  // 클립보드 접근이 막힌 환경에서는 실패를 알리고 직접 선택하도록 안내한다.
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('명령을 복사했습니다');
    } catch {
      toast.error('복사에 실패했습니다. 명령을 직접 선택해 복사하세요.');
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <pre
        className="max-w-full overflow-x-auto rounded bg-muted p-3 font-mono text-xs"
        data-testid={testId}
      >
        <code>{command}</code>
      </pre>
      <Button type="button" variant="outline" size="sm" className="self-end" onClick={onCopy}>
        복사
      </Button>
    </div>
  );
}
