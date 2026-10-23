package com.workplace.issue.dto;

/**
 * 이슈 본문·코멘트 길이 상한의 단일 출처(WP-885).
 *
 * <p>Jira 이전 데이터에 본문 25,721자·코멘트 31,150자(보안 스캐너 표)가 있어 예전 10,000자로는 옮길 수 없었다. 두 컬럼 모두 TEXT 라 마이그레이션
 * 없이 상한만 올린다. 이슈 생성·수정, 코멘트 생성·수정은 물론 이슈 본문이 되는 메일 승격·채팅 제안 요청도 같은 값을 쓴다. 웹({@code
 * lib/validations/issue.ts})·MCP({@code mcp-tools-shared}) 검증도 같은 값이어야 하므로 바꿀 땐 함께 바꾼다.
 */
public final class IssueTextLimits {

  /** 이슈 본문·코멘트 본문 최대 길이(글자 수). */
  public static final int BODY_MAX = 50_000;

  private IssueTextLimits() {}
}
