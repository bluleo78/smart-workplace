package com.workplace.issue.workflow;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 워크플로우 테스트가 저장소 안의 파일(정의 YAML·스키마 원본 등)을 찾는 도우미.
 *
 * <p>왜: gradle 테스트의 작업 폴더가 모듈 폴더(apps/workplace-api)라서 저장소 루트 기준 상대 경로를 그대로 열 수 없다. 두 테스트가 같은 탐색을
 * 쓰도록 한곳에 둔다.
 */
final class RepoFiles {

  private RepoFiles() {}

  /** 테스트 작업 폴더에서 위로 올라가며 저장소 상대 경로 파일을 찾는다(못 찾으면 AssertionError). */
  static Path findUp(String relative) {
    for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
      Path candidate = dir.resolve(relative);
      if (Files.exists(candidate)) {
        return candidate;
      }
    }
    throw new AssertionError("파일을 찾지 못했다: " + relative);
  }
}
