// 모델의 "이미지 입력" 지원 여부 선택 상자 + 도움말 — AI 연결 다이얼로그(관리자)·개인 비서 등록 폼과, 등록 후 모델 설정(개인 비서·공통 비서)이 같이 쓴다.
// 자동 감지가 실패하는 OpenAI 호환 모델을 위해 사람이 직접 "볼 수 있음/볼 수 없음"을 지정할 수 있게 한다.
// 선택값은 visionConfigFor 로 providerConfig.vision 에 실린다(자동이면 키 생략).
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Label } from '@/components/ui/label';
import type { VisionChoice } from '@/lib/ai/visionConfig';

interface Props {
  value: VisionChoice;
  onChange: (value: VisionChoice) => void;
  /** 트리거 id — 라벨(htmlFor)과 연결한다. */
  id: string;
  testId?: string;
  /** 저장 중 등 — 선택을 잠근다(등록 후 설정 화면은 고르면 바로 저장한다). */
  disabled?: boolean;
  /**
   * 등록 후 설정 화면용 — 옆 필드와 같은 마크업(일반 label + 이 간격 클래스, 예: 'space-y-1')으로 그려 라벨·선택 상자 줄을 맞춘다.
   * 없으면 다이얼로그·등록 폼 기본(ui Label + space-y-1.5).
   */
  settingsSpacing?: string;
}

// 옵션 표시 순서·문구 — 기본(자동 감지)을 맨 앞에 둔다.
const OPTIONS: { value: VisionChoice; label: string }[] = [
  { value: 'auto', label: '자동 감지' },
  { value: 'yes', label: '볼 수 있음' },
  { value: 'no', label: '볼 수 없음' },
];

export function VisionInputSelect({
  value,
  onChange,
  id,
  testId,
  disabled,
  settingsSpacing,
}: Props) {
  return (
    <div className={settingsSpacing ?? 'space-y-1.5'}>
      {settingsSpacing ? (
        <label className="text-sm font-medium" htmlFor={id}>
          이미지 입력
        </label>
      ) : (
        <Label htmlFor={id}>이미지 입력</Label>
      )}
      <Select value={value} onValueChange={(v) => onChange(v as VisionChoice)} disabled={disabled}>
        <SelectTrigger id={id} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        이미지를 볼 수 있는 모델이면 AI가 첨부 사진과 PDF 페이지를 직접 봅니다. 자동 감지가 안 되는
        모델은 직접 지정하세요.
      </p>
    </div>
  );
}
