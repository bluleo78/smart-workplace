/** 기본 대기 함수 — 러너들이 폴링 간격 대기에 쓴다. 테스트는 deps.sleep 으로 바꿔 실제로 기다리지 않는다. */
export const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
