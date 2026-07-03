/** 러너 중립 RunnerEvent 에서 화면용 text 델타만 추출한다.
 *  text_delta 이벤트의 text 를 그대로 반환한다(라우터/서브에이전트 구분 없음 — wiki/drive 는 서브에이전트 미사용).
 *  그 외 이벤트(tool_use·result 등)는 null. thinking/추론 델타는 애초에 RunnerEvent 로 매핑되지 않는다. */
import type { RunnerEvent } from './runner-events.js';

export function extractTextDelta(e: RunnerEvent): string | null {
  return e.type === 'text_delta' ? e.text : null;
}
