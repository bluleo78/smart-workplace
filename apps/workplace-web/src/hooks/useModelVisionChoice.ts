// AI 연결 폼(관리자 다이얼로그·개인 비서 등록)의 "이미지 입력" 선택 상태 — 두 폼이 같은 규칙을 쓰도록 묶었다(WP-250).
// 선택은 선택할 때의 모델 id 와 함께 기억하고, 지금 모델이 그 id 와 다르면 자동 감지로 보인다(제출 값도 자동).
import { useState } from 'react';

import { NO_VISION_PICK, type VisionChoice, visionChoiceFor, type VisionPick } from '@/lib/ai/visionConfig';

/**
 * @param model 지금 제출될 모델 id(프로바이더 접두가 붙은 최종 값 — visionConfigFor 에 넘기는 값과 같아야 한다)
 * @returns vision: 지금 모델에 적용할 선택, setVision: 지금 모델에 대한 선택 지정, resetVision: 지정 지우기
 */
export function useModelVisionChoice(model: string) {
  const [pick, setPick] = useState<VisionPick>(NO_VISION_PICK);
  return {
    vision: visionChoiceFor(pick, model),
    setVision: (choice: VisionChoice) => setPick({ model, choice }),
    resetVision: () => setPick(NO_VISION_PICK),
  };
}
