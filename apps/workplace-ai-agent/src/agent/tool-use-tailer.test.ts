import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolUseTailer } from './tool-use-tailer.js';

describe('ToolUseTailer', () => {
  it('파일이 없으면 빈 배열', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tlr-'));
    const t = new ToolUseTailer(path.join(dir, 'nope.log'));
    expect(t.readNew()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('새 완성 줄만 반환하고, 다음 호출은 그 이후만 반환', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tlr-'));
    const p = path.join(dir, 'tool-use.log');
    writeFileSync(p, JSON.stringify({ seq: 1, event: 'tool_use_start', toolName: 'a' }) + '\n', 'utf8');
    const t = new ToolUseTailer(p);
    const first = t.readNew();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ seq: 1, event: 'tool_use_start', toolName: 'a' });
    expect(t.readNew()).toEqual([]); // 새 줄 없음
    appendFileSync(p, JSON.stringify({ seq: 1, event: 'tool_result', toolName: 'a', isError: false }) + '\n', 'utf8');
    const second = t.readNew();
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ event: 'tool_result' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('미완성 줄(개행 전)은 보류했다가 완성되면 반환', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tlr-'));
    const p = path.join(dir, 'tool-use.log');
    writeFileSync(p, '{"seq":2,"event":"tool_use_start","toolName":"b"', 'utf8'); // 개행 없음
    const t = new ToolUseTailer(p);
    expect(t.readNew()).toEqual([]); // 미완성 → 보류
    appendFileSync(p, '}\n', 'utf8'); // 완성
    const out = t.readNew();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ seq: 2, toolName: 'b' });
    rmSync(dir, { recursive: true, force: true });
  });
});
