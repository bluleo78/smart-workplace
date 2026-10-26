// e2e-orphan-webservers.mjs 타입 선언 — e2e/global-lock.ts(TS)가 가져다 쓴다.
export declare const PREVIEW_DIR_PREFIX: string
export declare function findOrphanGroups(psOutput: string): number[]
export declare function findStalePreviewDirs(
  dirNames: string[],
  psOutput: string,
  ageMsOf: (name: string) => number,
  maxAgeMs: number,
): string[]
export declare function reapOrphanWebServers(options?: { log?: (message: string) => void }): void
