import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPendingActions } from './run-ai-compose.js';

describe('readPendingActions', () => {
  it('NDJSON 여러 줄을 배열로 파싱하고 깨진 줄은 건너뛴다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pa-'));
    const p = path.join(dir, 'pending-action.json');
    writeFileSync(p, '{"actionType":"a","summary":"A","params":{}}\nbroken\n{"actionType":"b","summary":"B","params":{}}\n');
    const out = readPendingActions(p);
    expect(out.map((x: any) => x.actionType)).toEqual(['a', 'b']);
    rmSync(dir, { recursive: true, force: true });
  });
  it('파일 없으면 빈 배열', () => {
    expect(readPendingActions('/nonexistent/x.json')).toEqual([]);
  });
});
