import { type QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { issueKeys } from './queries/useIssues';
import { handleIssueEvent } from './useIssueStream';

function mockQueryClient() {
  return { invalidateQueries: vi.fn() } as unknown as QueryClient;
}

describe('handleIssueEvent', () => {
  it('issue.commented → 이슈 detail 캐시를 payload 의 projectKey/issueNumber 로 무효화', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.commented', { projectKey: 'EX', issueNumber: 21 });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: issueKeys.detail('EX', 21) });
  });

  it('issue.comment_updated → 이슈 detail 캐시를 payload 의 projectKey/issueNumber 로 무효화 (#717)', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.comment_updated', { projectKey: 'EX', issueNumber: 21 });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: issueKeys.detail('EX', 21) });
  });

  it('issue.comment_deleted → 이슈 detail 캐시를 payload 의 projectKey/issueNumber 로 무효화 (#717)', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.comment_deleted', { projectKey: 'EX', issueNumber: 21 });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: issueKeys.detail('EX', 21) });
  });

  it('issue.created → 해당 프로젝트 목록·검색·내 이슈 캐시를 무효화 (WP-36)', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.created', { projectKey: 'EX', issueKey: 'EX-22' });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: issueKeys.lists('EX') });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: issueKeys.search('EX') });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me-issues'] });
  });

  it('issue.created payload 에 projectKey 가 없으면 invalidate 하지 않는다', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.created', {});
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('알 수 없는 이벤트는 무시', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.status_changed', { projectKey: 'EX', issueNumber: 21 });
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('payload 가 비정상(필드 누락)이면 invalidate 하지 않는다', () => {
    const qc = mockQueryClient();
    handleIssueEvent(qc, 'issue.commented', {});
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });
});
