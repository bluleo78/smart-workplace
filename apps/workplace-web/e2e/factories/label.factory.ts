// 라벨 도메인 모킹 데이터 팩토리.
// src/types/label.ts 의 LabelResponse / LabelSummary 와 1:1.

import type { ColorToken, LabelResponse, LabelSummary } from '../../src/types/label';

let nextId = 1;

// 테스트용 라벨 객체 팩토리.
export function createLabel(overrides: Partial<LabelResponse> = {}): LabelResponse {
  const id = overrides.id ?? nextId++;
  const now = new Date().toISOString();
  return {
    id,
    projectId: 1,
    name: `라벨${id}`,
    colorToken: 'RED' as ColorToken,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// LabelResponse → 이슈에 첨부되는 LabelSummary 변환.
export function toLabelSummary(l: LabelResponse): LabelSummary {
  return { id: l.id, name: l.name, colorToken: l.colorToken };
}
