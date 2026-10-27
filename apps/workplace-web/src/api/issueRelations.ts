// 이슈 관계 API 클라이언트(WP-887) — 관계 유형(조회·관리), 이슈 사이 관계, 외부 링크, 관계 대상 찾기.
// 차단(의존성)은 여기 없다 — 저장·블로커 계산이 그대로라 기존 issueDependencies API 를 쓴다.

import type {
  AddIssueRelationRequest,
  IssueExternalLinkView,
  IssueLookupItem,
  IssueRelationType,
  IssueRelationTypeAdmin,
  IssueRelationView,
  SaveIssueExternalLinkRequest,
  SaveIssueRelationTypeRequest,
} from '../types/issue';
import { client } from './client';

/** 찾기 선택 거름(WP-1039) — 서버가 SQL 에서 상한 전에 건다. 주지 않으면 모든 유형·상태. */
export interface IssueLookupFilter {
  type?: string;
  openOnly?: boolean;
  /** 참이면 from 프로젝트 이슈를 뺀다 — 다른 프로젝트 에픽만 찾을 때 같은 프로젝트 행이 상한을 채우지 않게. */
  excludeFrom?: boolean;
}

/** 이슈 하나의 하위 경로 — 관계·외부 링크 API 가 같은 접두사를 쓴다. */
const issuePath = (projectKey: string, number: number) => `/projects/${projectKey}/issues/${number}`;

export const issueRelationsApi = {
  /** 관계 유형 목록(정렬 순, 숨긴 유형 포함 — 화면이 거른다). 로그인 사용자 누구나. */
  listTypes: () => client.get<IssueRelationType[]>('/issue-relation-types').then((r) => r.data),

  /**
   * 관계 대상 찾기 — 키(WPV-28)·번호(#12)·제목. from 은 현재 이슈의 프로젝트 키(개인 프로젝트면 그 안에서만 찾는다).
   * filter 는 서버가 상한(20건) 전에 거는 선택 거름(WP-1039) — type 은 유형 이름(예: EPIC), openOnly 는 완료·취소 제외, excludeFrom 은 from 프로젝트 제외.
   */
  lookup: (q: string, from: string, filter?: IssueLookupFilter) =>
    client
      .get<IssueLookupItem[]>('/issues/lookup', { params: { q, from, ...filter } })
      .then((r) => r.data),

  /** 관계 걸기 — 응답은 갱신된 이 이슈의 관계 목록. */
  addRelation: (projectKey: string, number: number, body: AddIssueRelationRequest) =>
    client.post<IssueRelationView[]>(`${issuePath(projectKey, number)}/relations`, body).then((r) => r.data),

  /** 관계 지우기 — 멱등(없어도 204). */
  removeRelation: (projectKey: string, number: number, relationId: number) =>
    client.delete<void>(`${issuePath(projectKey, number)}/relations/${relationId}`).then(() => undefined),

  /** 외부 링크 붙이기 — 응답은 갱신된 외부 링크 목록. */
  addExternalLink: (projectKey: string, number: number, body: SaveIssueExternalLinkRequest) =>
    client.post<IssueExternalLinkView[]>(`${issuePath(projectKey, number)}/external-links`, body).then((r) => r.data),

  /** 외부 링크 고치기(유형·방향·키·제목) — side 를 빼면 저장된 방향을 지킨다. */
  updateExternalLink: (projectKey: string, number: number, linkId: number, body: SaveIssueExternalLinkRequest) =>
    client
      .put<IssueExternalLinkView[]>(`${issuePath(projectKey, number)}/external-links/${linkId}`, body)
      .then((r) => r.data),

  /** 외부 링크 지우기 — 멱등(없어도 204). */
  removeExternalLink: (projectKey: string, number: number, linkId: number) =>
    client.delete<void>(`${issuePath(projectKey, number)}/external-links/${linkId}`).then(() => undefined),
};

/** 관계 유형 관리(워크스페이스 관리자) — 응답 오류는 errors.code(RELATION_TYPE_IN_USE 등)로 갈린다. */
export const issueRelationTypesAdminApi = {
  /** 유형 목록 + 유형별 쓰이는 곳 수. */
  list: () => client.get<IssueRelationTypeAdmin[]>('/admin/issue-relation-types').then((r) => r.data),

  create: (body: SaveIssueRelationTypeRequest) =>
    client.post<IssueRelationType>('/admin/issue-relation-types', body).then((r) => r.data),

  update: (id: number, body: SaveIssueRelationTypeRequest) =>
    client.put<IssueRelationType>(`/admin/issue-relation-types/${id}`, body).then((r) => r.data),

  setHidden: (id: number, hidden: boolean) =>
    client.put<IssueRelationType>(`/admin/issue-relation-types/${id}/hidden`, { hidden }).then((r) => r.data),

  /** 유형 삭제 — 쓰이는 곳이 있으면 moveTo(옮길 유형) 또는 deleteLinks(함께 삭제) 중 하나가 필요하다(없으면 409). */
  remove: (id: number, opts: { moveTo?: number; deleteLinks?: boolean } = {}) =>
    client
      .delete<void>(`/admin/issue-relation-types/${id}`, {
        params: {
          ...(opts.moveTo != null ? { moveTo: opts.moveTo } : {}),
          ...(opts.deleteLinks ? { deleteLinks: true } : {}),
        },
      })
      .then(() => undefined),
};
