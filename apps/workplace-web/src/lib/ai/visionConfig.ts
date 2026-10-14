// 연결 다이얼로그의 "이미지 입력" 선택값을 API providerConfig.vision 으로 바꾼다.
// 자동 감지는 서버가 모델 목록·메타로 판정하므로 키 자체를 보내지 않는다(기본 동작 유지).
// 수동 지정은 모델별 맵 `{ [모델 id]: boolean }` — 모델을 바꿔 연결해도 다른 모델의 지정이 섞이지 않게 한다.

/** 선택 상자 값 — auto: 자동 감지, yes: 볼 수 있음, no: 볼 수 없음. */
export type VisionChoice = 'auto' | 'yes' | 'no';

/**
 * @param choice 선택 상자 값
 * @param model 제출될 모델 id(프로바이더 접두가 붙은 최종 값)
 * @returns 자동이거나 모델이 비어 있으면 undefined(키 생략), 아니면 `{ [model]: true|false }`
 */
export function visionConfigFor(
  choice: VisionChoice,
  model: string,
): Record<string, boolean> | undefined {
  if (choice === 'auto' || !model) return undefined;
  return { [model]: choice === 'yes' };
}

/**
 * 이미지 입력 선택과 그 선택을 한 모델 id — 선택은 그 모델에만 적용된다(WP-250 최종 리뷰).
 * 모델 직접 입력 중 키를 칠 때마다 선택을 지우던 방식 대신, 선택 당시 모델을 기억해 두고 화면·제출 값은 visionChoiceFor 로 고른다.
 */
export interface VisionPick {
  model: string;
  choice: VisionChoice;
}

/** 아무것도 지정하지 않은 상태(자동 감지). */
export const NO_VISION_PICK: VisionPick = { model: '', choice: 'auto' };

/**
 * 지금 모델에 적용할 선택 — 선택할 때의 모델과 지금 모델(접두·공백 정리 후 제출 값)이 같을 때만 그 선택, 다르면 자동 감지.
 * 이전 모델에 지정한 값이 다른 모델로 따라가지 않게 하면서, 같은 id 로 정리되는 입력(끝 공백 등)에는 선택을 유지한다.
 */
export function visionChoiceFor(pick: VisionPick, model: string): VisionChoice {
  return pick.model === model ? pick.choice : 'auto';
}
