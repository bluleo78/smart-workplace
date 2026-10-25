package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import java.util.List;

/**
 * 이슈 상세 응답 DTO: 요약 + 본문 + 코멘트 + 히스토리 + 첨부 + AI 즉시 컨텍스트 + 관계·외부 링크.
 *
 * <p>aiContext 는 저장 요약이 없고 블로커도 없으면 null(프론트 카드 미렌더). 단순 목록 조회(IssueResponse) 경로에서는 사용하지 않는다.
 */
public record IssueDetailResponse(
    IssueResponse summary,
    String body,
    List<IssueCommentResponse> comments,
    List<IssueHistoryEntryResponse> history,
    List<IssueAttachmentResponse> attachments,
    /** AI 즉시 컨텍스트(요약+블로커). 없으면 null. */
    IssueAiContext aiContext,
    /** 조회자 권한 플래그 — 프론트 단일 소스. 내용(제목/본문) 편집 가능 여부(멤버/ADMIN 또는 OPEN reporter). */
    boolean viewerCanEditContent,
    /** 워크플로(상태/유형/우선순위 등) 편집 가능 여부(멤버/ADMIN). */
    boolean viewerCanEditWorkflow,
    /** 이슈 삭제 가능 여부(reporter 본인 또는 프로젝트 OWNER). */
    boolean viewerCanDelete,
    /**
     * 보고자(이슈를 만든 사람) 요약 — 상세 속성 레일·모바일 속성 시트 표시용(WP-272). summary.reporterId 는 숫자뿐이라 이름·종류를 함께 싣는다.
     * 사용자 행을 찾지 못하면 null.
     */
    UserSummary reporter,
    /** 보고자를 바꿀 수 있는지(WP-944) — 프로젝트 OWNER·ADMIN 또는 지금 보고자 본인. */
    boolean viewerCanChangeReporter,
    /**
     * 이슈 사이 관계(WP-887, 차단 제외 — 차단은 summary.blockedBy/blocks). 조회자가 읽을 수 있는 상대만, 상대가 삭제된 관계는 뺀다. 유형
     * 정렬값 → 말 → (프로젝트 키, 번호) 순.
     */
    List<IssueRelationView> relations,
    /** 외부 링크(WP-887) — 다른 시스템 이슈를 관계 유형·키·제목·주소로 붙인 것. */
    List<IssueExternalLinkView> externalLinks) {}
