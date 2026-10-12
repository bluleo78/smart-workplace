import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { estimateTokens, nullAsOmitted, toolDefinition, toolDefinitionsSize, wireInputSchema } from './tool-definitions.js';

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);
const tool = (name: string) => tools.find((t) => t.name === name)!;
type Props = Record<string, Record<string, unknown>>;
const props = (name: string) => wireInputSchema(tool(name).inputSchema).properties as Props;

describe('wireInputSchema — tools/list 로 내보내는 입력 스키마 (WP-340 웨이브 5)', () => {
  it('도구마다 반복되던 $schema 를 싣지 않는다', () => {
    for (const t of tools) expect(wireInputSchema(t.inputSchema), t.name).not.toHaveProperty('$schema');
  });

  it('정보 없는 제약(안전 정수 경계·id 의 exclusiveMinimum 0·minLength 1)은 빼고, 일부러 건 범위·길이는 남긴다', () => {
    const text = JSON.stringify(tools.map((t) => wireInputSchema(t.inputSchema)));
    expect(text).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect(text).not.toContain('"exclusiveMinimum":0');
    expect(text).not.toContain('"minLength":1');
    // list_issues size 1..100, list_notifications offset ≥0, create_issue title ≤200 은 모델이 알아야 하는 범위라 남는다.
    expect(props('list_issues').size).toMatchObject({ minimum: 1, maximum: 100 });
    expect(props('list_notifications').offset).toMatchObject({ minimum: 0 });
    expect(props('create_issue').title).toMatchObject({ maxLength: 200 });
  });

  it('nullAsOmitted 입력은 null 갈래 없이 평범한 선택 입력으로 보인다(required 에도 없다)', () => {
    const ra = wireInputSchema(tool('read_attachment').inputSchema);
    const p = ra.properties as Props;
    for (const k of ['issueKey', 'attachmentId', 'driveFileId', 'offset', 'limit']) expect(p[k], k).not.toHaveProperty('anyOf');
    expect(p.attachmentId).toEqual({ type: 'integer' });
    expect(p.limit).toEqual({ type: 'integer', minimum: 1, maximum: 32000 });
    expect(ra.required).toEqual(['source']);
    for (const k of ['occurrenceDate', 'title', 'startsAt', 'endsAt', 'allDay', 'addAttendees', 'removeAttendees']) {
      expect(props('update_event')[k], k).not.toHaveProperty('anyOf');
    }
    for (const [name, k] of [['create_drive_folder', 'parentId'], ['move_drive_folder', 'targetParentId'], ['move_drive_file', 'targetFolderId']]) {
      expect(props(name)[k], `${name}.${k}`).toEqual({ type: 'integer' });
    }
  });

  // null 에 "비우기" 뜻이 있는 입력은 null 갈래가 모델에게 보여야 한다 — 표식 없는 nullable 은 그대로 둔다.
  it('null 이 "비우기" 인 입력은 null 갈래를 그대로 둔다', () => {
    const nullBranch = { anyOf: expect.arrayContaining([{ type: 'null' }]) };
    for (const k of ['description', 'location', 'color', 'reminderMinutes', 'recurrenceRule']) {
      expect(props('update_event')[k], k).toMatchObject(nullBranch);
    }
    expect(props('update_issue').parent).toMatchObject(nullBranch);
    expect(props('update_issue').milestone).toMatchObject(nullBranch);
    expect(props('update_project').description).toMatchObject(nullBranch);
    expect(props('move_wiki_page').parentId).toMatchObject(nullBranch);
  });

  it('설명은 표식 전에 붙여도, 표식 뒤에 붙여도(복제본) null 갈래를 지우고 설명을 남긴다', () => {
    const shape = z.object({
      before: nullAsOmitted(z.string().describe('먼저 붙인 설명')),
      after: nullAsOmitted(z.string()).describe('나중에 붙인 설명'),
      plain: z.string().nullish(),
    });
    const p = wireInputSchema(shape).properties as Props;
    expect(p.before).toEqual({ type: 'string', description: '먼저 붙인 설명' });
    expect(p.after).toEqual({ type: 'string', description: '나중에 붙인 설명' });
    expect(p.plain).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });
});

describe('toolDefinition', () => {
  it('표시 이름은 최상위 title 하나만 싣고(annotations.title 중복 제거) 힌트는 그대로 둔다', () => {
    const def = toolDefinition(tool('update_issue'));
    expect(def.title).toBe('이슈 수정');
    expect(def.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    expect(Object.keys(def)).toEqual(['name', 'title', 'description', 'inputSchema', 'annotations']);
  });
});

// 근사식은 README "도구 정의 크기" 에 적은 것과 같아야 한다 — 바꾸면 README 와 상한 테스트의 의미가 함께 바뀐다.
describe('estimateTokens', () => {
  it('한글은 1자 = 1토큰, 나머지는 3.5자 = 1토큰(올림)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcdefg')).toBe(2);
    expect(estimateTokens('이슈 목록')).toBe(Math.ceil(4 + 1 / 3.5));
    expect(estimateTokens('{"a":1}')).toBe(2);
  });

  it('toolDefinitionsSize 는 tools/list 배열의 직렬화 길이로 잰다', () => {
    const size = toolDefinitionsSize(tools.slice(0, 3));
    const text = JSON.stringify(tools.slice(0, 3).map(toolDefinition));
    expect(size).toMatchObject({ tools: 3, chars: text.length, tokens: estimateTokens(text) });
    expect(size.perTool.map((p) => p.tokens)).toEqual([...size.perTool.map((p) => p.tokens)].sort((a, b) => b - a));
  });
});

/**
 * null 허용 고정(WP-346 → WP-340 웨이브 5). 모델은 쓰지 않는 인자를 null 로 채워 보내기도 한다. 정의에서 null 갈래를 숨겼어도 검증은 받아야 한다.
 * MCP SDK 는 registerTool 에 넘긴 shape 로 객체를 다시 만들어 검증하므로(z.object(shape)) 같은 방식으로 확인하고, 핸들러까지 태워 본다.
 * SDK 실제 왕복은 workplace-mcp integration.test.ts 가 확인한다.
 */
describe('null 을 생략으로 받는다', () => {
  const sdkParse = (name: string, args: unknown) => z.object((tool(name).inputSchema as z.ZodObject).shape).safeParse(args);

  it('read_attachment·update_event·드라이브 이동은 null 인자를 검증에서 받아들인다', () => {
    expect(sdkParse('read_attachment', { source: 'drive', driveFileId: 5, issueKey: null, attachmentId: null, offset: null, limit: null }).success).toBe(true);
    expect(sdkParse('update_event', { eventId: 1, title: '회의', occurrenceDate: null, startsAt: null, endsAt: null, allDay: null, addAttendees: null, removeAttendees: null }).success).toBe(true);
    expect(sdkParse('move_drive_file', { driveFileId: 3, targetFolderId: null }).success).toBe(true);
    expect(sdkParse('create_drive_folder', { spaceId: 1, parentId: null, name: '자료' }).success).toBe(true);
  });

  it('표식 없는 선택 입력의 null 은 지금처럼 거절한다(허용 범위를 넓히지 않았다)', () => {
    expect(sdkParse('list_issues', { projectKey: null }).success).toBe(false);
  });

  it('read_attachment 핸들러는 null 범위를 기본값으로, null 식별자를 없음으로 본다', async () => {
    const readDriveFileText = async (id: number, range: unknown) => ({ id, range });
    const t = buildSharedTools({ readDriveFileText } as unknown as SharedToolClient).find((x) => x.name === 'read_attachment')!;
    const out = JSON.parse((await t.handler({ source: 'drive', driveFileId: 5, issueKey: null, attachmentId: null, offset: null, limit: null })) as string);
    expect(out).toMatchObject({ driveFileId: 5, range: { limit: 12000 } });
    expect(out.range).not.toHaveProperty('offset', null);
  });
});
