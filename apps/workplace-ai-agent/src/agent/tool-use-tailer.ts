// 사이드카 NDJSON 을 바이트 오프셋 기준으로 증분 읽기 한다(라이브 테일).
// fs.watch 는 빠른 append 를 놓칠 수 있어 인터벌 폴링(호출측)에서 readNew() 를 반복 호출한다.
// 완성된 줄(\n)만 파싱하고, 미완성 잔여는 버퍼에 보관해 다음 호출에서 이어붙인다.
import { readSync, openSync, closeSync, fstatSync } from 'node:fs';
import type { ToolUseLine } from './tool-use-log.js';

export class ToolUseTailer {
  private offset = 0; // 다음에 읽을 바이트 위치
  private partial = ''; // 개행 전 미완성 잔여
  constructor(private readonly filePath: string) {}

  // 마지막 오프셋 이후 추가된 완성 줄을 파싱해 반환. 파일 없음/새 줄 없음이면 빈 배열.
  readNew(): ToolUseLine[] {
    let fd: number;
    try {
      fd = openSync(this.filePath, 'r');
    } catch {
      return []; // 아직 파일 없음
    }
    try {
      const size = fstatSync(fd).size;
      if (size <= this.offset) return []; // 새 바이트 없음
      const len = size - this.offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, this.offset);
      this.offset = size;
      this.partial += buf.toString('utf8');
      const out: ToolUseLine[] = [];
      let nl: number;
      while ((nl = this.partial.indexOf('\n')) !== -1) {
        const line = this.partial.slice(0, nl).trim();
        this.partial = this.partial.slice(nl + 1);
        if (!line) continue;
        try {
          out.push(JSON.parse(line) as ToolUseLine);
        } catch {
          // 깨진 줄 무시
        }
      }
      return out;
    } finally {
      closeSync(fd);
    }
  }
}
