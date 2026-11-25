// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryStorage, storageKeys } from '@/test/memoryStorage';

import { clearIssueBodyDrafts, issueBodyDraftKey, readIssueBodyDraft, readIssueBodyDraftEntry, writeIssueBodyDraft } from './issueBodyDraft';

// 이슈 본문 로컬 초안 — 같은 기기의 다른 사용자·워크스페이스에 보이지 않아야 한다(WP-699).
describe('issueBodyDraftKey', () => {
  it('사용자·워크스페이스마다 다른 키를 쓴다', () => {
    const a = issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 1);
    expect(a).not.toBe(issueBodyDraftKey({ userId: 2, tenantId: 10 }, 'DR', 1));
    expect(a).not.toBe(issueBodyDraftKey({ userId: 1, tenantId: 11 }, 'DR', 1));
    expect(a).not.toBe(issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 2));
  });
});

describe('본문 초안 기준 version(WP-2095)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('기준 version 과 함께 쓰면 entry 로 돌려받고 글만 읽는 함수는 글을 준다', () => {
    writeIssueBodyDraft('k', '글', 7);
    expect(readIssueBodyDraftEntry('k')).toEqual({ text: '글', baseVersion: 7 });
    expect(readIssueBodyDraft('k')).toBe('글');
  });
  it('기준 본문도 함께 쓰고 읽는다(version 없이 본문만이어도 JSON)', () => {
    writeIssueBodyDraft('k', '글', 7, '기준');
    expect(readIssueBodyDraftEntry('k')).toEqual({ text: '글', baseVersion: 7, baseBody: '기준' });
    writeIssueBodyDraft('k2', '글', undefined, '기준');
    expect(readIssueBodyDraftEntry('k2')).toEqual({ text: '글', baseBody: '기준' });
  });
  it('예전 평문 초안은 기준 version 없는 entry 다', () => {
    localStorage.setItem('k', '옛 글');
    expect(readIssueBodyDraftEntry('k')).toEqual({ text: '옛 글' });
  });
});

describe('clearIssueBodyDrafts', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('로그아웃 정리 — 본문 초안(예전 형식 키 포함)만 지우고 다른 저장값은 둔다', () => {
    localStorage.setItem(issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 1), '내 초안');
    localStorage.setItem('issue-body-draft:DR:1', '예전 키 초안');
    localStorage.setItem('theme', 'dark');
    clearIssueBodyDrafts();
    expect(storageKeys(localStorage)).toEqual(['theme']);
  });
});
