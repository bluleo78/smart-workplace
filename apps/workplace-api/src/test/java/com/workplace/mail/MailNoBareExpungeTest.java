package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * 메일 코드에 IMAP 일반 EXPUNGE 가 없는지 지키는 정적 검사(WP-1682). 인자 없는 {@code expunge()}·{@code
 * expunge(null)}·{@code close(true)} 는 메일함의 다른 {@code \Deleted} 메일(다른 클라이언트가 지울 표시만 해 둔 메일)까지 지운다 —
 * 지우기는 그 메일만 {@code UID EXPUNGE} 하는 {@code expunge(Message[])}, 닫기는 {@code close(false)} 만 쓴다. 되돌릴
 * 수 없는 사고라 리뷰가 아니라 테스트로 막는다.
 */
class MailNoBareExpungeTest {

  /** Gradle 테스트의 작업 디렉터리(앱 루트) 기준 메일 도메인 소스. */
  private static final Path MAIL_SOURCES = Path.of("src/main/java/com/workplace/mail");

  private static final Pattern BARE_EXPUNGE = Pattern.compile("\\.expunge\\(\\s*(null\\s*)?\\)");
  private static final Pattern CLOSE_TRUE = Pattern.compile("\\.close\\(\\s*true\\s*\\)");

  @Test
  void mailCode_neverCallsBareExpungeOrCloseTrue() throws IOException {
    List<Path> files;
    try (Stream<Path> s = Files.walk(MAIL_SOURCES)) {
      files = s.filter(p -> p.toString().endsWith(".java")).toList();
    }
    // 경로가 틀려 아무것도 읽지 않고 통과하는 일이 없게 — 일반 EXPUNGE 를 피해 쓰는 파일이 실제로 검사 대상인지 본다
    assertThat(files).isNotEmpty();
    assertThat(files).anyMatch(p -> p.getFileName().toString().equals("ImapMailMover.java"));

    List<String> violations = new ArrayList<>();
    for (Path file : files) {
      List<String> lines = Files.readAllLines(file);
      for (int i = 0; i < lines.size(); i++) {
        String line = lines.get(i).strip();
        if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) {
          continue; // 주석 줄(설명 속 예시)은 제외
        }
        if (BARE_EXPUNGE.matcher(line).find() || CLOSE_TRUE.matcher(line).find()) {
          violations.add(MAIL_SOURCES.relativize(file) + ":" + (i + 1) + "  " + line);
        }
      }
    }
    assertThat(violations).as("일반 EXPUNGE·close(true) 호출").isEmpty();
  }
}
