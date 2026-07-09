// src/tools/test-support.ts — 도구 테스트 전용 mock PatApiClient 팩토리.
// 도메인별 테스트 파일에서 중복 작성을 피하기 위한 공유 헬퍼(프로덕션 코드에서는 import 하지 않음).
import { vi } from 'vitest';
import type { PatApiClient } from '../clients/workplace-api.js';

/** 모든 메서드를 vi.fn() 으로 채운 mock PatApiClient 를 생성한다. 필요한 메서드만 개별 테스트에서 재설정한다. */
export function mockPatApiClient(): PatApiClient {
  return {
    getMe: vi.fn(),
    listProjects: vi.fn(),
    getProject: vi.fn(),
    listMyIssues: vi.fn(),
    getIssueDetail: vi.fn(),
    createIssue: vi.fn(),
    addIssueComment: vi.fn(),
    updateIssueStatus: vi.fn(),
    listWikiSpaces: vi.fn(),
    searchWikiPages: vi.fn(),
    getWikiPage: vi.fn(),
    createWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
    listChannels: vi.fn(),
    getChannelMessages: vi.fn(),
    addChannelMessage: vi.fn(),
    listEvents: vi.fn(),
    getEvent: vi.fn(),
    listDriveSpaces: vi.fn(),
    listDriveItems: vi.fn(),
    searchDrive: vi.fn(),
    listMailAccounts: vi.fn(),
    listMail: vi.fn(),
    getMail: vi.fn(),
    getProjectTypes: vi.fn(),
    getProjectLabels: vi.fn(),
    getProjectMembers: vi.fn(),
    updateIssue: vi.fn(),
    setIssueType: vi.fn(),
    setIssueParent: vi.fn(),
    addIssueDependency: vi.fn(),
    removeIssueDependency: vi.fn(),
    replaceIssueAssignees: vi.fn(),
    replaceIssueLabels: vi.fn(),
    editIssueComment: vi.fn(),
  };
}
