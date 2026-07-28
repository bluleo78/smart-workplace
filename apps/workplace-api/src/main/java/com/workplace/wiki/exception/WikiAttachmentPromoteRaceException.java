package com.workplace.wiki.exception;

/**
 * #759 저장 시 첨부 승격이 대상 행을 못 찾았을 때 — 정리 스윕이 그 사이 파일을 회수한 경우다. HTTP 409 매핑.
 *
 * <p>조용히 넘기면 저장은 성공했는데 본문이 사라진 파일을 가리키는 깨진 이미지가 영구히 남는다. 사용자가 다시 시도하면(이미지를 새로 올리면) 해소되므로 시끄럽게 실패하는
 * 편이 낫다.
 */
public class WikiAttachmentPromoteRaceException extends RuntimeException {
  public WikiAttachmentPromoteRaceException(int expected, int affected) {
    super("첨부 상태가 방금 변경되었습니다. 다시 저장해 주세요. (expected=" + expected + " affected=" + affected + ")");
  }
}
