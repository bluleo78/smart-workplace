package com.workplace.wiki.report;

import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * 리포트 템플릿 공용 도우미(WP-1486) — 기본 템플릿 원문을 읽고, 템플릿 본문을 기본으로 덮는다. 프로젝트 리포트 템플릿(WP-1483)과 개인 보고 템플릿 두 벌이
 * 나눠 쓴다. 템플릿 복사·위치 판정은 각 템플릿 클래스가 공간 트리 잠금 아래에서 id 로 한다(WP-1654·WP-1655 — 「부모 바로 아래」 위치 검사는 걷었다).
 *
 * <p>쓰기는 {@link WikiSystemPageWriter}(역할 검사 없음)로 한다. 본문 쓰기는 동기화 서버 위임 경로라 이 클래스의 메서드는 <b>트랜잭션
 * 밖에서</b> 불러야 한다.
 */
@Component
@RequiredArgsConstructor
public class ReportTemplateCopier {

  private final WikiSystemPageWriter writer;

  /**
   * 클래스패스 리소스 원문(UTF-8)을 읽는다 — 템플릿 클래스가 기동 때 한 번 부른다.
   *
   * @throws UncheckedIOException 리소스가 없거나 읽지 못함(배포가 잘못된 것이라 기동을 실패시킨다)
   */
  public static String loadResource(String classpath) {
    try (InputStream in = new ClassPathResource(classpath).getInputStream()) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("기본 리포트 템플릿을 읽지 못했습니다: " + classpath, e);
    }
  }

  /** 템플릿 본문을 덮는다(기본으로 되돌리기) — 직전 판을 수정 기록에 남긴다. 페이지가 없으면 예외. */
  public void overwrite(long pageId, long authorId, String markdown) {
    WikiPageDetail page = writer.findPage(pageId).orElseThrow();
    writer.writeBody(authorId, pageId, page.version(), markdown, false, true);
  }
}
