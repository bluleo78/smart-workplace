package com.workplace.issue.dto;

/** 이슈 본문 이미지 업로드 응답(WP-199). url 은 본문 마크다운에 그대로 넣는 참조 경로다. */
public record IssueBodyImageResponse(
    long fileId, String url, String name, String mimeType, long size) {

  /**
   * 본문 참조 URL — IssueBodyImageService 의 본문 파싱 정규식, 프론트 api/issueImages.ts 와 짝을 이룬다. 한쪽만 바꾸면 업로드는
   * 되는데 연결이 안 돼 하루 뒤 이미지가 무음으로 수거된다.
   */
  public static String urlOf(String projectKey, long fileId) {
    return "/api/v1/projects/" + projectKey + "/issue-images/" + fileId;
  }
}
