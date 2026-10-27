package com.workplace.project.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 프로젝트 부분 수정 요청(#858). key 는 불변. null 필드는 변경 없음을 의미하고, 설명을 비우려면 {@code clearDescription=true} 를
 * 보낸다(이슈 PATCH 와 같은 규칙). name 은 보낼 때만 공백이 아니어야 한다 — 이전엔 전체 덮어쓰기라 name 만 보내면 설명이 null 로 지워졌다.
 */
public record UpdateProjectRequest(
    @Size(max = 120) @Pattern(regexp = "(?s).*\\S.*", message = "이름은 비워 둘 수 없습니다.") String name,
    @Size(max = 2000) String description,
    Boolean clearDescription,
    // 연결된 저장소(WP-1011) — 빈 문자열이면 지운다. AI 컴퓨터가 셸로 clone 할 주소라 https·ssh·사용자@호스트:경로 형식에
    // 호스트·경로 글자만 받는다($ ; | ` 같은 셸 글자 금지). https 주소의 「아이디:토큰@」도 막는다 — 이 값은 프로젝트를
    // 볼 수 있는 모두에게 보이고, 접근은 AI 컴퓨터의 git 자격 증명으로 한다. http:// 는 받지 않는다(평문 전송).
    @Size(max = 500) @Pattern(regexp = REPOSITORY_URL_PATTERN, message = REPOSITORY_URL_MESSAGE)
        String repositoryUrl,
    // 기본 브랜치 — git 브랜치 이름으로 쓸 수 있는 것만(clone --branch 가 거절할 .. // 끝의 / .lock 등도 미리 막는다).
    @Size(max = 100)
        @Pattern(regexp = REPOSITORY_BRANCH_PATTERN, message = REPOSITORY_BRANCH_MESSAGE)
        String repositoryBranch) {
  /**
   * 저장소 주소 형식 — 빈 값, 또는 https://호스트[:포트]/경로 · ssh://[사용자@]호스트[:포트]/경로 · 사용자@호스트:경로(scp 형식). 웹
   * validations/project.ts 와 같은 규칙.
   */
  private static final String REPOSITORY_URL_PATTERN =
      "^$|^(https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?/"
          + "|ssh://([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?/"
          + "|[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:)"
          + "[A-Za-z0-9._~/][A-Za-z0-9._~/-]*$";

  private static final String REPOSITORY_URL_MESSAGE =
      "https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요. 주소에 아이디·토큰은 넣지 않아요.";

  /** 브랜치 형식 — 빈 값, 또는 git 이름 글자만이고 - · / · . 로 시작하지 않으며 .. // /. 이 없고 / · . · .lock 으로 끝나지 않는다. */
  private static final String REPOSITORY_BRANCH_PATTERN =
      "^$|^(?![-/.])(?!.*(\\.\\.|//|/\\.))(?!.*([/.]|\\.lock)$)[A-Za-z0-9._/-]+$";

  private static final String REPOSITORY_BRANCH_MESSAGE =
      "브랜치 이름에는 영문·숫자·. _ / - 만 쓸 수 있고, .. · // 나 끝의 / · .lock 은 안 돼요.";

  public UpdateProjectRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
    repositoryUrl = repositoryUrl == null ? null : repositoryUrl.strip();
    repositoryBranch = repositoryBranch == null ? null : repositoryBranch.strip();
    // 주소를 지우면 브랜치도 지운다 — 남겨 두면 나중에 다른 저장소를 연결할 때 옛 브랜치가 보이지 않게 따라붙는다.
    if ("".equals(repositoryUrl)) {
      repositoryBranch = "";
    }
  }
}
