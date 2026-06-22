import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendToolUse } from './tool-use-log.js';

describe('appendToolUse', () => {
  const prev = process.env.WORKPLACE_TOOL_USE_LOG_PATH;
  afterEach(() => {
    if (prev === undefined) delete process.env.WORKPLACE_TOOL_USE_LOG_PATH;
    else process.env.WORKPLACE_TOOL_USE_LOG_PATH = prev;
  });

  it('env 경로가 있으면 NDJSON 한 줄을 append 한다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tul-'));
    const p = path.join(dir, 'tool-use.log');
    process.env.WORKPLACE_TOOL_USE_LOG_PATH = p;
    appendToolUse({ seq: 1, event: 'tool_use_start', toolName: 'get_issue_detail', args: { issueKey: 'EX-2' } });
    appendToolUse({ seq: 1, event: 'tool_result', toolName: 'get_issue_detail', isError: false, result: '{"ok":true}' });
    const lines = readFileSync(p, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ seq: 1, event: 'tool_use_start', toolName: 'get_issue_detail' });
    expect(JSON.parse(lines[1])).toMatchObject({ seq: 1, event: 'tool_result', isError: false });
    rmSync(dir, { recursive: true, force: true });
  });

  it('env 경로가 없으면 no-op (throw 안 함)', () => {
    delete process.env.WORKPLACE_TOOL_USE_LOG_PATH;
    expect(() => appendToolUse({ seq: 1, event: 'tool_use_start', toolName: 'x' })).not.toThrow();
  });
});
