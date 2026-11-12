import { describe, expect, it } from 'vitest';

import { aiDialogButtonText, isAiDialogTargetId } from './aiDialogTargets';

describe('aiDialogTargets', () => {
  it('목록 밖 id 는 허용하지 않는다', () => {
    expect(isAiDialogTargetId('agent.danger')).toBe(false);
    expect(isAiDialogTargetId('toString')).toBe(false);
  });

  it('목록 안 id 는 허용한다', () => {
    expect(isAiDialogTargetId('agents.accounts.add')).toBe(true);
  });

  it('단추 글은 목록 라벨 + 창 열기', () => {
    expect(aiDialogButtonText('agent.run.repo.token')).toBe('저장소 토큰 넣기 창 열기');
  });
});
