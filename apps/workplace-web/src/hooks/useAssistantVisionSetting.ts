// 등록 후 비서 설정(개인 비서·공통 비서)의 "이미지 입력" 지정과 모델 변경 저장 — 두 화면이 같은 규칙을 쓰도록 묶었다(WP-250).
// OpenAI 호환(opencode) 연결만 지정할 수 있다(Claude 는 늘 이미지를 본다). 이 화면은 고르면 바로 저장하므로 서버 상태의 지금 모델 지정값이 곧 화면 값이다.
import { toast } from 'sonner';

import { type VisionChoice, visionChoiceOf, visionSettingOf } from '@/lib/ai/visionConfig';
import { handleApiError } from '@/lib/api-error';
import type { UpdateAssistantSettings } from '@/types/assistant';

interface Options {
  /** 지금 연결의 provider — 'opencode' 일 때만 이미지 입력을 지정한다. */
  provider: string | null | undefined;
  /** 서버 상태의 지금 모델 지정값(true/false, 없으면 자동 감지). */
  vision: boolean | null | undefined;
  /** 설정 변경 요청(각 화면의 mutation). */
  save: (body: UpdateAssistantSettings) => Promise<unknown>;
  /** 저장 성공·실패 토스트 문구 — 화면마다 다르다. */
  messages: { success: string; error: string };
}

/**
 * @returns isOpencode: 이미지 입력 선택 상자를 보일지, currentVision: 선택 상자 값,
 *   changeModel: 모델 변경 저장, changeVision: 이미지 입력만 바꿔 저장(지금 모델에 건다)
 */
export function useAssistantVisionSetting({ provider, vision, save, messages }: Options) {
  const isOpencode = provider === 'opencode';

  // 저장 공통 — 실패 시 오류 토스트(silent failure 방지), 성공 시 확인 토스트.
  const run = async (body: UpdateAssistantSettings) => {
    try {
      await save(body);
      toast.success(messages.success);
    } catch (e) {
      handleApiError(e, messages.error);
    }
  };

  return {
    isOpencode,
    currentVision: visionChoiceOf(vision),
    // opencode 면 vision:null 을 함께 보내 지정을 지운다 — 다른 모델은 자동 감지에서 시작한다(이전 모델의 지정을 옮기면
    // 못 보는 모델에 이미지가 갈 수 있다).
    changeModel: (model: string) => run(isOpencode ? { model, vision: null } : { model }),
    changeVision: (choice: VisionChoice) => run({ vision: visionSettingOf(choice) }),
  };
}
