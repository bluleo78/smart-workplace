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
