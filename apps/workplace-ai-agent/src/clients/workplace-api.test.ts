// workplace-api client — Internal + X-On-Behalf-Of 패턴 (#34). 매 메서드에 agentId 명시.
import { afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';

import { parseIssueKey } from '@smart-workplace/mcp-tools-shared';

import { createWorkplaceApiClient } from './workplace-api.js';

afterEach(() => {
  nock.cleanAll();
});

describe('parseIssueKey', () => {
  it('WP-42 → projectKey=WP, number=42', () => {
    expect(parseIssueKey('WP-42')).toEqual({ projectKey: 'WP', number: 42 });
  });

  it('A-B-7 → projectKey=A-B, number=7 (lastIndexOf 정책)', () => {
    expect(parseIssueKey('A-B-7')).toEqual({ projectKey: 'A-B', number: 7 });
  });
});

describe('createWorkplaceApiClient (Internal + X-On-Behalf-Of)', () => {
  const BASE = 'http://api.test';
  const PREFIX = '/api/v1';
  const AGENT_ID = 201;

  function newClient() {
    return createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      internalToken: 'tk-internal',
    });
  }

  // #842: 확인카드 사전검증 — POST /actions/validate 로 actionType+params 를 그대로 보낸다.
  it('validateAction 은 /actions/validate 에 actionType·params 를 보낸다', async () => {
    const scope = nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .post(`${PREFIX}/actions/validate`, { actionType: 'drive.delete_file', params: { id: 9 } })
      .reply(204);
    await newClient().validateAction(AGENT_ID, 'drive.delete_file', { id: 9 });
    expect(scope.isDone()).toBe(true);
  });

  // #842: 검증 실패는 서버 사유를 담은 오류로 던져져야 한다 — 호출부(writeProposal)가 그대로
  // 전파해 LLM 이 자가교정할 수 있어야 하므로, 여기서 문구가 뭉개지면 안 된다(#840 인터셉터).
  it('validateAction 실패 시 서버 사유가 담긴 오류를 던진다', async () => {
    nock(BASE)
      .post(`${PREFIX}/actions/validate`)
      .reply(400, { message: '이미 멤버입니다', errors: {} });
    await expect(
      newClient().validateAction(AGENT_ID, 'project.add_member', { key: 'WP', userId: 3 }),
    ).rejects.toThrow('이미 멤버입니다');
  });

  it('updateIssueStatus → PATCH + 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .patch(`${PREFIX}/projects/WP/issues/1/status`, { status: 'DONE' })
      .reply(200, {});
    await newClient().updateIssueStatus(AGENT_ID, 'WP-1', 'DONE');
    expect(scope.isDone()).toBe(true);
  });

  // #373: flat author 필드(authorId/authorName/authorKind) → nested author 객체 변환은
  // 공유 도구 핸들러(normalizeIssueDetail)의 책임 — toolClient 는 raw comments 를 그대로 반환.
  it('toolClient.getIssueDetail → comments 를 포함한 raw 응답을 변형 없이 그대로 반환', async () => {
    const raw = {
      key: 'WP-5',
      title: '코멘트 이슈',
      body: '본문',
      status: 'TODO',
      priority: 'HIGH',
      assignees: [],
      comments: [
        {
          id: 1,
          issueId: 5,
          authorId: 3,
          authorName: '홍길동',
          authorKind: 'HUMAN',
          body: '테스트 코멘트',
          createdAt: '2026-06-07T15:06:36.671628Z',
        },
        {
          id: 2,
          issueId: 5,
          authorId: 10,
          authorName: '개인 비서',
          authorKind: 'AGENT',
          body: 'AI 코멘트',
          createdAt: '2026-06-08T10:00:00.000000Z',
        },
      ],
    };
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/5`)
      .reply(200, raw);
    const d = await newClient().toolClient(AGENT_ID).getIssueDetail('WP-5');
    expect(d).toEqual(raw);
  });

  // #406: /assignees GET 엔드포인트가 없어(405) 구현이 이슈 상세의 .summary.assignees 를 읽도록 변경됨.
  // 테스트도 GET /projects/WP/issues/42(상세) 응답을 mock 하도록 정렬한다(기존 /assignees GET mock 드리프트 해소).
  it('unassignSelf → 이슈 상세의 summary.assignees 읽고 본인 제외 후 PUT', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42`)
      .reply(200, {
        summary: {
          id: 42,
          assignees: [
            { id: 7, username: 'alice', kind: 'HUMAN' },
            { id: AGENT_ID, username: 'ai-bot', kind: 'AGENT' },
          ],
        },
      });
    const putScope = nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .put(`${PREFIX}/projects/WP/issues/42/assignees`, { userIds: [7] })
      .reply(200, []);
    await newClient().unassignSelf(AGENT_ID, 'WP-42');
    expect(putScope.isDone()).toBe(true);
  });

  // #415: agentId 가 담당자 목록에 없으면 오류 — 멱등 PUT 성공을 허위 성공으로 오인하는 것을 방지.
  it('unassignSelf — agentId 가 담당자가 아닐 때 오류 발생(PUT 미호출)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42`)
      .reply(200, {
        summary: {
          id: 42,
          assignees: [{ id: 7, username: 'alice', kind: 'HUMAN' }], // agentId 없음
        },
      });
    // PUT 은 호출되면 안 된다 — nock 을 등록하지 않아 만약 호출되면 nock 오류가 발생.
    await expect(newClient().unassignSelf(AGENT_ID, 'WP-42')).rejects.toThrow('담당자로 등록되어 있지 않아 해제할 수 없습니다.');
  });

  it('unassignSelf — assignees 가 빈 배열일 때도 오류 발생(EX-2 시나리오, #415)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/EX/issues/2`)
      .reply(200, { summary: { id: 2, assignees: [] } }); // 담당자 없음
    await expect(newClient().unassignSelf(AGENT_ID, 'EX-2')).rejects.toThrow('담당자로 등록되어 있지 않아 해제할 수 없습니다.');
  });

  it('getProviderCredential → GET /users/me/provider-credential + 헤더 (anthropic)', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/users/me/provider-credential`)
      .reply(200, { provider: 'anthropic', token: 'tk-plain', model: 'claude-sonnet-5' });
    const r = await newClient().getProviderCredential(AGENT_ID);
    expect(r).toEqual({ provider: 'anthropic', token: 'tk-plain', model: 'claude-sonnet-5' });
  });

  it('getProviderCredential → opencode 응답은 payload 를 JSON 파싱해 반환', async () => {
    const payload = JSON.stringify({ providerId: 'amazon-bedrock-openai', options: { apiKey: 'k' } });
    nock(BASE)
      .get(`${PREFIX}/users/me/provider-credential`)
      .reply(200, { provider: 'opencode', payload, model: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0' });
    const r = await newClient().getProviderCredential(AGENT_ID);
    expect(r).toEqual({
      provider: 'opencode',
      payload: { providerId: 'amazon-bedrock-openai', options: { apiKey: 'k' } },
      model: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0',
    });
  });

  it('getProviderCredential → model 미포함 응답은 null 로 폴백', async () => {
    nock(BASE)
      .get(`${PREFIX}/users/me/provider-credential`)
      .reply(200, { provider: 'anthropic', token: 'tk-plain' });
    const r = await newClient().getProviderCredential(AGENT_ID);
    expect(r).toEqual({ provider: 'anthropic', token: 'tk-plain', model: null });
  });

  it('getProviderCredential → 404 면 throw', async () => {
    nock(BASE)
      .get(`${PREFIX}/users/me/provider-credential`)
      .reply(404, { error: 'not_found' });
    await expect(newClient().getProviderCredential(AGENT_ID)).rejects.toThrow();
  });

  // --- 6c: chat ---

  it('getChatMessages → GET /chat/threads/{id}/messages?limit + 헤더', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/chat/threads/5/messages`)
      .query({ limit: '20' })
      .reply(200, {
        items: [
          { id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false },
        ],
        nextCursor: null,
        hasMore: false,
      });
    const items = await newClient().getChatMessages(AGENT_ID, 5, 20);
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe('hi');
  });

  it('addChatMessage → POST /chat/threads/{id}/messages {body} + 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .post(`${PREFIX}/chat/threads/5/messages`, { body: '답변' })
      .reply(201, {});
    await newClient().addChatMessage(AGENT_ID, 5, '답변');
    expect(scope.isDone()).toBe(true);
  });

  // --- WP-244: 스레드 경유 이슈 첨부 ---

  it('listThreadIssueAttachments → GET /chat/threads/{id}/issue-attachments', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/chat/threads/5/issue-attachments`)
      .reply(200, [
        { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 100 },
      ]);
    const list = await newClient().listThreadIssueAttachments(AGENT_ID, 5);
    expect(list[0]).toMatchObject({ fileId: 3, originalName: 'a.png', mimeType: 'image/png' });
  });

  it('downloadThreadIssueAttachment → GET /chat/threads/{id}/issue-attachments/{fileId}/content (바이트 + mimeType)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/chat/threads/5/issue-attachments/3/content`)
      .reply(200, Buffer.from('PNGDATA'), { 'Content-Type': 'image/png' });
    const res = await newClient().downloadThreadIssueAttachment(AGENT_ID, 5, 3);
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.data.toString()).toBe('PNGDATA');
    expect(res.mimeType).toBe('image/png');
  });

  // --- WP-244: 첨부 추출 텍스트 ---

  it('readIssueAttachmentText → GET .../attachments/{fileId}/text?offset&limit + 헤더', async () => {
    const slice = { fileId: 3, status: 'READY', offset: 0, totalChars: 5, truncated: false, nextOffset: null, text: '안녕하세요', reasonCode: null, reason: null };
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/1/attachments/3/text`)
      .query({ offset: '100', limit: '500' })
      .reply(200, slice);
    expect(await newClient().readIssueAttachmentText(AGENT_ID, 'WP-1', 3, 100, 500)).toEqual(slice);
  });

  it('readIssueAttachmentText → offset·limit 생략 시 쿼리 없이 호출(서버 기본값)', async () => {
    // 요청 URL 에 쿼리스트링이 실제로 없는지 직접 검증한다(nock .query({}) 는 파라미터가 있어도 통과할 수 있음).
    let requestedPath = '';
    nock(BASE)
      .get(uri => {
        requestedPath = uri;
        return uri.startsWith(`${PREFIX}/projects/WP/issues/1/attachments/3/text`);
      })
      .reply(200, { fileId: 3, status: 'PENDING' });
    expect((await newClient().readIssueAttachmentText(AGENT_ID, 'WP-1', 3)).status).toBe('PENDING');
    expect(requestedPath).not.toContain('?');
  });

  it('readChatAttachmentText → GET /chat/threads/{id}/attachments/{fileId}/text', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/chat/threads/5/attachments/8/text`)
      .query({ offset: '0' })
      .reply(200, { fileId: 8, status: 'READY', text: 'x' });
    expect((await newClient().readChatAttachmentText(AGENT_ID, 5, 8, 0)).text).toBe('x');
  });

  it('downloadChatAttachment → GET /chat/threads/{id}/messages/{msgId}/attachments/{fileId}/content', async () => {
    nock(BASE)
      .get(`${PREFIX}/chat/threads/5/messages/9/attachments/8/content`)
      .reply(200, Buffer.from('PDF'), { 'content-type': 'application/pdf' });
    const r = await newClient().downloadChatAttachment(AGENT_ID, 5, 9, 8);
    expect(r.data.toString()).toBe('PDF');
    expect(r.mimeType).toBe('application/pdf');
  });

  it('getChatMessages → 메시지 attachments(extraction 포함)를 그대로 전달', async () => {
    nock(BASE)
      .get(`${PREFIX}/chat/threads/5/messages`)
      .query({ limit: '20' })
      .reply(200, {
        items: [{ id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'b', createdAt: 't', deleted: false,
          attachments: [{ fileId: 8, messageId: 1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3,
            extraction: { status: 'READY', totalChars: 3, truncated: false, reasonCode: null, reason: null } }] }],
      });
    const items = await newClient().getChatMessages(AGENT_ID, 5, 20);
    expect(items[0].attachments?.[0].extraction?.status).toBe('READY');
  });

  // --- #333 M4: 메일 수동 동기화 ---

  describe('syncMail', () => {
    it('POST /mail/accounts/{id}/sync 로 동기화 요청', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': '7' } })
        .post(`${PREFIX}/mail/accounts/3/sync`, {})
        .reply(200, { synced: 5 });
      const out = await newClient().syncMail(7, 3);
      expect((out as { synced: number }).synced).toBe(5);
      scope.done();
    });
  });

  // --- #333 M3: 연락처 조회/생성/수정 ---

  describe('createExternalContact', () => {
    it('POST /contacts/external 로 생성하고 반환', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': '7' } })
        .post(`${PREFIX}/contacts/external`, { name: '신규', email: 'n@x.com', visibility: 'SHARED' })
        .reply(201, { id: 9, kind: 'EXTERNAL', name: '신규', email: 'n@x.com', organization: null });
      const out = await newClient().createExternalContact(7, { name: '신규', email: 'n@x.com', visibility: 'SHARED' });
      expect(out.id).toBe(9);
    });
  });

  // #846: 공유 도구용 클라이언트 — 경로 매핑은 공유 패키지(createSharedToolClient)가 하고, 여기서는
  // 이 에이전트 신원 헤더(Internal 토큰 + X-On-Behalf-Of)가 모든 요청에 실리는지를 검증한다.
  describe('toolClient', () => {
    it('getIssueDetail 은 Internal 인증 + X-On-Behalf-Of 헤더로 이슈 경로를 호출한다', async () => {
      const raw = { summary: { id: 12, title: '분석' }, body: '본문' };
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .get(`${PREFIX}/projects/WP/issues/12`)
        .reply(function () {
          // 테넌트 스코프를 하지 않았으면 테넌트 헤더가 없어야 한다.
          expect(this.req.headers['x-on-behalf-of-tenant']).toBeUndefined();
          return [200, raw];
        });
      const out = await newClient().toolClient(AGENT_ID).getIssueDetail('WP-12');
      expect(scope.isDone()).toBe(true);
      expect(out).toEqual(raw);
    });

    it('listIssues 는 쿼리 파라미터를 붙여 GET /me/issues 를 호출하고 items 를 반환한다', async () => {
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .get(`${PREFIX}/me/issues`)
        .query({ assignee: 'me', size: '30' })
        .reply(200, { items: [{ projectKey: 'WP', number: 7, title: '버그' }], hasMore: false });
      const items = await newClient().toolClient(AGENT_ID).listIssues({ assignee: 'me', size: 30 });
      expect(scope.isDone()).toBe(true);
      expect(items).toEqual([{ projectKey: 'WP', number: 7, title: '버그' }]);
    });

    it('searchMembers 는 구성원 디렉터리(/members)를 헤더와 함께 조회한다', async () => {
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .get(`${PREFIX}/members`)
        .query({ search: 'kim', kind: 'ALL', page: '0', size: '50' })
        .reply(200, { content: [{ id: 3, username: 'kim', name: '김철수' }] });
      const out = await newClient()
        .toolClient(AGENT_ID)
        .searchMembers({ search: 'kim', kind: 'ALL', page: 0, size: 50 });
      expect(scope.isDone()).toBe(true);
      expect(out).toEqual([{ id: 3, username: 'kim', name: '김철수' }]);
    });

    it('addChannelMessage 는 본문(body, parentMessageId)과 헤더를 함께 POST 한다', async () => {
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .post(`${PREFIX}/messaging/channels/7/messages`, { body: '안녕', parentMessageId: 3 })
        .reply(201, {});
      await newClient().toolClient(AGENT_ID).addChannelMessage(7, '안녕', 3);
      expect(scope.isDone()).toBe(true);
    });

    // #719: 테넌트 스코프 클라이언트에서 꺼낸 toolClient 도 X-On-Behalf-Of-Tenant 를 동봉해야 한다.
    it('withOnBehalfOfTenant 로 스코프한 toolClient 는 X-On-Behalf-Of-Tenant 헤더를 동봉한다', async () => {
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .matchHeader('x-on-behalf-of-tenant', '7')
        .get(`${PREFIX}/projects/WP/issues/12`)
        .reply(200, { summary: { id: 12 } });
      await newClient().withOnBehalfOfTenant(7).toolClient(AGENT_ID).getIssueDetail('WP-12');
      expect(scope.isDone()).toBe(true);
    });
  });

  // #840: API 오류 메시지 보강 — 서버 ErrorResponse.message 가 도구 오류 문자열로 LLM 에 전달돼야 자가교정 가능.
  // 공유 도구는 toolClient 경유로 호출되므로, 같은 http 인스턴스의 인터셉터가 그 경로에도 적용되는지 확인한다.
  describe('API 오류 메시지', () => {
    it('toolClient 경유 4xx 응답의 서버 message 와 필드 오류를 Error.message 로 끌어올리고 status 는 유지한다', async () => {
      nock(BASE)
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .get(`${PREFIX}/drive/spaces/1/items`)
        .reply(400, { status: 400, message: '위임 후보 프로젝트가 아닙니다: FOO', errors: { projectKey: '후보 밖' } });
      const err = await newClient().toolClient(AGENT_ID).listDriveItems(1).catch((e: unknown) => e);
      expect((err as Error).message).toBe('API 오류 400: 위임 후보 프로젝트가 아닙니다: FOO — projectKey: 후보 밖');
      expect((err as { response?: { status?: number } }).response?.status).toBe(400);
    });

    it('본문이 없으면 상태코드만 남긴다', async () => {
      nock(BASE).get(`${PREFIX}/drive/spaces/1/items`).reply(404);
      const err = await newClient().toolClient(AGENT_ID).listDriveItems(1).catch((e: unknown) => e);
      expect((err as Error).message).toBe('API 오류 404');
    });
  });

  // --- #333 M4: 드라이브 폴더/파일 쓰기 ---

  describe('createFolder', () => {
    it('POST /drive/spaces/{id}/folders 로 폴더 생성하고 DriveFolderItem 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .post(`${PREFIX}/drive/spaces/1/folders`, { parentId: null, name: '새 폴더' })
        .reply(201, { id: 10, parentId: null, name: '새 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().createFolder(AGENT_ID, 1, null, '새 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.id).toBe(10);
      expect(out.parentId).toBeNull();
      expect(out.name).toBe('새 폴더');
    });

    it('parentId 지정 시 body 에 포함', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .post(`${PREFIX}/drive/spaces/1/folders`, { parentId: 5, name: '하위 폴더' })
        .reply(201, { id: 11, parentId: 5, name: '하위 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().createFolder(AGENT_ID, 1, 5, '하위 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.parentId).toBe(5);
    });
  });

  describe('renameFolder', () => {
    it('PATCH /drive/folders/{id} 로 이름 변경하고 DriveFolderItem 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10`, { name: '변경 폴더' })
        .reply(200, { id: 10, parentId: null, name: '변경 폴더', createdAt: '2026-06-19T00:00:00Z' });
      const out = await newClient().renameFolder(AGENT_ID, 10, '변경 폴더');
      expect(scope.isDone()).toBe(true);
      expect(out.name).toBe('변경 폴더');
    });
  });

  describe('moveFolder', () => {
    it('PATCH /drive/folders/{id}/move 로 폴더 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10/move`, { targetParentId: 3 })
        .reply(204);
      await newClient().moveFolder(AGENT_ID, 10, 3);
      expect(scope.isDone()).toBe(true);
    });

    it('targetParentId null 로 루트 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/folders/10/move`, { targetParentId: null })
        .reply(204);
      await newClient().moveFolder(AGENT_ID, 10, null);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('moveFile', () => {
    it('PATCH /drive/files/{id}/move 로 파일 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/files/5/move`, { targetFolderId: 10 })
        .reply(204);
      await newClient().moveFile(AGENT_ID, 5, 10);
      expect(scope.isDone()).toBe(true);
    });

    it('targetFolderId null 로 루트 이동(void)', async () => {
      const scope = nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .patch(`${PREFIX}/drive/files/5/move`, { targetFolderId: null })
        .reply(204);
      await newClient().moveFile(AGENT_ID, 5, null);
      expect(scope.isDone()).toBe(true);
    });
  });

  // --- #350: 채널 목록/탐색 ---

  describe('discoverChannels', () => {
    it('GET /messaging/channels/discover?q= 로 ChannelItem[] 반환', async () => {
      const scope = nock(BASE, { reqheaders: { authorization: 'Internal tk-internal', 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels/discover`)
        .query({ q: '개발팀' })
        .reply(200, [
          { id: 2, kind: 'PUBLIC', name: '개발팀', visibility: 'PUBLIC', member: false, role: null, archived: false, memberCount: 5, unreadCount: 0 },
        ]);
      const out = await newClient().discoverChannels(AGENT_ID, '개발팀');
      expect(scope.isDone()).toBe(true);
      expect(out[0].name).toBe('개발팀');
    });

    it('특수문자 q 는 encodeURIComponent 처리', async () => {
      nock(BASE, { reqheaders: { 'x-on-behalf-of': String(AGENT_ID) } })
        .get(`${PREFIX}/messaging/channels/discover`)
        .query({ q: '팀 채널' })
        .reply(200, []);
      const out = await newClient().discoverChannels(AGENT_ID, '팀 채널');
      expect(out).toEqual([]);
    });
  });

  // --- L3 위임(일정): 채팅 @AI 대화 → 일정 제안 카드 ---

  describe('proposeCreateEvent', () => {
    it('POST /messaging/channels/{id}/proposals with actionType=calendar.create_event + payload', async () => {
      // proposeCreateIssue 패턴 미러: nock 으로 HTTP 가로채 body/헤더 검증.
      const scope = nock(BASE)
        .matchHeader('authorization', 'Internal tk-internal')
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .post(`${PREFIX}/messaging/channels/9/proposals`, {
          actionType: 'calendar.create_event',
          title: '팀 미팅',
          startsAt: '2026-07-01T10:00:00Z',
          endsAt: '2026-07-01T11:00:00Z',
          proposedByUserId: 5,
        })
        .reply(201, {});
      await newClient().proposeCreateEvent(AGENT_ID, 9, {
        title: '팀 미팅',
        startsAt: '2026-07-01T10:00:00Z',
        endsAt: '2026-07-01T11:00:00Z',
        proposedByUserId: 5,
      });
      expect(scope.isDone()).toBe(true);
    });

    it('선택 필드(allDay/location/parentMessageId) 포함 시 body 에 함께 전달', async () => {
      const scope = nock(BASE)
        .matchHeader('x-on-behalf-of', String(AGENT_ID))
        .post(`${PREFIX}/messaging/channels/9/proposals`, {
          actionType: 'calendar.create_event',
          title: '전사 워크숍',
          startsAt: '2026-07-10T00:00:00Z',
          endsAt: '2026-07-11T00:00:00Z',
          allDay: true,
          location: '제주',
          proposedByUserId: 3,
          parentMessageId: 42,
        })
        .reply(201, {});
      await newClient().proposeCreateEvent(AGENT_ID, 9, {
        title: '전사 워크숍',
        startsAt: '2026-07-10T00:00:00Z',
        endsAt: '2026-07-11T00:00:00Z',
        allDay: true,
        location: '제주',
        proposedByUserId: 3,
        parentMessageId: 42,
      });
      expect(scope.isDone()).toBe(true);
    });
  });
});
