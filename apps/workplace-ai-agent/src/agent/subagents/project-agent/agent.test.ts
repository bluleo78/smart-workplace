import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('project-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 project-agent 가 로드된다', () => {
    expect(loaded['project-agent']).toBeDefined();
  });
  it('tools 는 read 2 + search_members + 워크플로우 정의 3 + update_project + 메타 생성·수정 2 + propose 5 + submit_response', () => {
    expect(loaded['project-agent'].tools).toEqual([
      'mcp__workplace__list_projects',
      'mcp__workplace__get_project',
      // #833: 이름 → userId 확정 경로. 없으면 에이전트가 연락처 id 를 오용한다.
      'mcp__workplace__search_members',
      // WP-2033: 워크플로우 정의 조회·검증·저장/게시
      'mcp__workplace__get_workflow',
      'mcp__workplace__validate_workflow',
      'mcp__workplace__update_workflow',
      // #855: 이름·설명 직접 수정(OWNER)
      'mcp__workplace__update_project',
      // WP-356: 라벨·마일스톤·사이클 생성·수정(직접 실행 — 대응 확인 카드 없음, 삭제는 도구 없음)
      'mcp__workplace__create_project_meta',
      'mcp__workplace__update_project_meta',
      'mcp__workplace__propose_create_project',
      'mcp__workplace__propose_delete_project',
      'mcp__workplace__propose_add_project_member',
      // #856: 멤버 역할 변경·제거 제안
      'mcp__workplace__propose_update_project_member_role',
      'mcp__workplace__propose_remove_project_member',
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-343: list_project_members 폐지 — 멤버는 get_project 의 members 로 읽는다.
  it('폐지된 list_project_members 대신 get_project 의 members 로 안내한다', () => {
    expect(loaded['project-agent'].tools).not.toContain('mcp__workplace__list_project_members');
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).not.toContain('list_project_members');
    expect(prompt).toContain('`members`');
  });
  it('WP-356: 라벨·마일스톤·사이클 생성·수정 안내와 삭제 미지원 안내가 있다', () => {
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).toContain('create_project_meta');
    expect(prompt).toContain('update_project_meta');
    expect(prompt).toMatch(/삭제는 지원하지 않습니다/);
  });
  it('maxTurns 설정 + 본문에 프로젝트·제안 안내', () => {
    expect(loaded['project-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['project-agent'].prompt).toMatch(/프로젝트|제안/);
  });
  it('워크플로우에 존재 확인(get_project) 규칙이 명시되어 있다', () => {
    // 멤버 추가 propose 전 get_project 존재 확인 규칙 (#386)
    expect(loaded['project-agent'].prompt).toMatch(/get_project/);
    expect(loaded['project-agent'].prompt).toMatch(/존재/);
  });
  it('#833: 멤버 추가 전 search_members 로 username 을 확정하라는 규칙이 명시되어 있다', () => {
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).toMatch(/search_members/);
    expect(prompt).toMatch(/추측 금지|추측하지/);
    expect(prompt).toMatch(/username/);
  });
  it('규칙 위반 key 를 수락하지 말고 변환·안내하라는 규칙이 명시되어 있다', () => {
    // #387: 소문자 등 ^[A-Z][A-Z0-9]{1,9}$ 위반 key 를 그대로 수락 금지 + 대문자 변환/되묻기.
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).toMatch(/\^\[A-Z]\[A-Z0-9]\{1,9}\$/);
    expect(prompt).toMatch(/수락하지 마|수락 금지|그대로 수락/);
    expect(prompt).toMatch(/ABC/); // abc → ABC 변환 예시
  });

  // WP-352: list_projects 가 번호 페이지라 hasMore·nextPage 로 이어 조회하게 한다.
  it('list_projects 의 hasMore·nextPage 안내가 있다', () => {
    const prompt = loaded['project-agent'].prompt;
    expect(prompt).toContain('`hasMore`·`nextPage`');
    expect(prompt).toContain('`nextPage` 를 `page` 로 넘겨');
  });

  // WP-2033: 워크플로우 정의 지시문(도구 목록은 위 tools 테스트가 고정) — 저장 전 검증·게시·충돌 방지 값·실제 응답 필드.
  it('WP-2033: 저장 전 검증·게시는 명시 요청 때만·expectedDraftUpdatedAt(새로 만들 땐 생략)·published 확인을 안내한다', () => {
    const p = loaded['project-agent'].prompt;
    for (const k of ['validate_workflow', 'publish: true', 'expectedDraftUpdatedAt', '새로 만들 때는 넘기지 않습니다', 'WORKFLOW_DRAFT_CONFLICT', 'draftProblems', 'published: false']) {
      expect(p).toContain(k);
    }
  });
});
