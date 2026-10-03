package com.workplace.issue.dto;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 이슈 본문 이미지 업로드 응답(WP-199). url 은 본문 마크다운에 그대로 넣는 참조 경로다. */
public record IssueBodyImageResponse(
    long fileId, String url, String name, String mimeType, long size) {

  /** 본문에 이슈 이미지 참조가 있을 수 있는지 빠르게 거르는 표식 — 정규식·DB 작업 전에 대부분의 텍스트 본문을 걸러낸다. */
  private static final String REF_MARKER = "/issue-images/";

  /**
   * 본문 참조 URL 파싱 패턴 — urlOf 와 짝. group(1)=프로젝트 키, group(2)=fileId. \d{1,19} 는 Long.MAX_VALUE 자릿수이고
   * (?!\d) 로 20자리 이상·prefix(12 vs 123) 가 잘려 매칭되지 않게 한다. 한 번만 컴파일해 서비스·저장소가 공유한다.
   */
  private static final Pattern REF =
      Pattern.compile("/api/v1/projects/([^/\\s)]+)/issue-images/(\\d{1,19})(?!\\d)");

  /**
   * 본문 참조 URL — 위 REF 패턴, 프론트 api/issueImages.ts 와 짝을 이룬다. 한쪽만 바꾸면 업로드는 되는데 연결이 안 돼 하루 뒤 이미지가 무음으로
   * 수거된다.
   */
  public static String urlOf(String projectKey, long fileId) {
    return "/api/v1/projects/" + projectKey + "/issue-images/" + fileId;
  }

  /** 본문에 이슈 이미지 참조 표식이 있는가 — 이미지 없는 본문 저장 시 연결 동기화(잠금·조회)를 건너뛰는 데 쓴다. */
  public static boolean mayReferenceImages(String body) {
    return body != null && body.contains(REF_MARKER);
  }

  /** 본문의 이슈 이미지 참조 fileId — 프로젝트 키를 가리지 않는다(보존 판정은 후보를 이미 프로젝트로 묶어 넘긴다). */
  public static Set<Long> idsIn(String body) {
    return idsIn(body, null);
  }

  /**
   * 본문에서 주어진 프로젝트 키의 이미지 참조 fileId 를 뽑는다(projectKey 가 null 이면 키 무관). 범위를 넘는 19자리 값은 parseLong 이
   * 던지므로 건너뛴다 — 본문은 자유 텍스트라 저장이 깨지면 안 된다.
   */
  public static Set<Long> idsIn(String body, String projectKey) {
    Set<Long> ids = new LinkedHashSet<>();
    if (!mayReferenceImages(body)) return ids;
    Matcher m = REF.matcher(body);
    while (m.find()) {
      if (projectKey != null && !projectKey.equals(m.group(1))) continue;
      try {
        ids.add(Long.parseLong(m.group(2)));
      } catch (NumberFormatException ignored) {
        // 19자리 overflow — 무시
      }
    }
    return ids;
  }
}
