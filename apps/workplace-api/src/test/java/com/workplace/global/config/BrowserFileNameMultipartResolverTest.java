package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockPart;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

/**
 * 브라우저 파일명 이스케이프 해석기(WP-1074) 단위 검증 — 실제 HTTP 경로는 MultipartFilenameIntegrationTest 가 본다. 여기서는 그 경로가
 * 닿지 않는 지연 파싱(resolveLazily)과, 한 필드에 형식이 다른 파일이 섞인 요청을 본다.
 */
class BrowserFileNameMultipartResolverTest {

  /** 즉시·지연 파싱 모두 — 같은 필드의 파일마다 자기 형식대로(따옴표 형식만 되돌림), 순서를 지켜 바뀐다. */
  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void decodesOnlyQuotedFilenames_inPartOrder(boolean lazy) {
    BrowserFileNameMultipartResolver resolver = new BrowserFileNameMultipartResolver();
    resolver.setResolveLazily(lazy);
    MockHttpServletRequest request = multipartRequest();
    request.addPart(filePart("files", "filename=\"a%22b.txt\""));
    request.addPart(filePart("files", "filename*=UTF-8''r%2522.txt"));
    request.addPart(filePart("files", "filename=\"plain.txt\""));
    request.addPart(new MockPart("note", "x%22y".getBytes(StandardCharsets.UTF_8)));

    MultipartHttpServletRequest resolved = resolver.resolveMultipart(request);

    List<MultipartFile> files = resolved.getFiles("files");
    assertThat(files)
        .extracting(MultipartFile::getOriginalFilename)
        .containsExactly("a\"b.txt", "r%22.txt", "plain.txt");
    // 바꾼 파일도 바이트·필드 이름은 원래 파트 그대로다.
    assertThat(files.get(0).getName()).isEqualTo("files");
    assertThat(files.get(0).getSize()).isEqualTo(5);
    // 파일명이 없는 일반 필드는 파일 목록에 끼지 않고, 파일과의 짝 맞추기도 흐트러뜨리지 않는다.
    assertThat(resolved.getFileMap()).doesNotContainKey("note");
  }

  @Test
  void decodeFileName_rules() {
    assertThat(BrowserFileNameMultipartResolver.decodeFileName("%22a%22")).isEqualTo("\"a\"");
    assertThat(BrowserFileNameMultipartResolver.decodeFileName("a%0D%0Ab")).isEqualTo("a__b");
    assertThat(BrowserFileNameMultipartResolver.decodeFileName("50%off %0a"))
        .isEqualTo("50%off %0a");
    assertThat(BrowserFileNameMultipartResolver.decodeFileName(null)).isNull();
  }

  private static MockHttpServletRequest multipartRequest() {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/upload");
    request.setContentType("multipart/form-data; boundary=x");
    return request;
  }

  /** 파일명 부분을 그대로 넣은 파일 파트(본문 "hello"). */
  private static MockPart filePart(String name, String filenameParam) {
    MockPart part = new MockPart(name, "hello".getBytes(StandardCharsets.UTF_8));
    part.getHeaders()
        .set(HttpHeaders.CONTENT_DISPOSITION, "form-data; name=\"" + name + "\"; " + filenameParam);
    return part;
  }
}
