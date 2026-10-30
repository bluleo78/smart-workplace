package com.workplace.user.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.AvatarTestImages;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/**
 * WP-1222 아바타 — 실제 HTTP(Tomcat) 로 확인한다. MockMvc 는 multipart 필드를 요청 파라미터로 바로 넣어 주므로, PUT multipart 의
 * 자를 영역 필드가 Tomcat 에서 실제로 읽히는지는 여기서만 드러난다. AI 키(ak_)로 자기 아바타를 바꾸고, 커밋 뒤 옛 해시 폴더가 지워지는지, 공개 주소가 인증
 * 없이 열리는지도 본다. 요청이 각자 커밋하므로 직접 정리한다.
 */
class AvatarRealHttpTest extends IntegrationTestBase {

  private static final Color RED = new Color(220, 20, 20);
  private static final Color BLUE = new Color(20, 20, 220);

  @Autowired DSLContext dsl;
  @Autowired AgentApiKeyService keyService;
  @Autowired FileStore fileStore;
  @Autowired ObjectMapper objectMapper;
  @LocalServerPort int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();
  private long adminId;
  private long agentId;
  private String key;

  @BeforeEach
  void seed() {
    callInTenant(
        1L,
        () -> {
          adminId = TestFixtures.createHuman(dsl);
          agentId = TestFixtures.createAgentNoToken(dsl);
          for (long id : new long[] {adminId, agentId}) {
            dsl.insertInto(MEMBERSHIP)
                .set(MEMBERSHIP.USER_ID, id)
                .set(MEMBERSHIP.TENANT_ID, 1L)
                .set(MEMBERSHIP.STATUS, "ACTIVE")
                .execute();
          }
          TestFixtures.grantRole(dsl, agentId, "AGENT");
          return null;
        });
    TenantContext.set(1L);
    try {
      key = keyService.issue(adminId, agentId, new IssueAgentKeyRequest("avatar")).plaintextKey();
    } finally {
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(adminId, agentId)).execute();
          // 키(agent_api_key)가 발급자(admin)를 참조한다 — AI 를 먼저 지워 키가 CASCADE 로 지워진 뒤 admin 을 지운다.
          dsl.deleteFrom(USER).where(USER.ID.eq(agentId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(adminId)).execute();
        });
    fileStore.deleteTreeIfExists("avatars/" + agentId);
  }

  private String url(String path) {
    return "http://localhost:" + port + path;
  }

  /** ak_ 키로 PUT multipart(file + 자를 영역 필드). */
  private ResponseEntity<String> putAvatar(byte[] png, int x, int y, int size) {
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth(key);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    var body = new LinkedMultiValueMap<String, Object>();
    body.add(
        "file",
        new ByteArrayResource(png) {
          @Override
          public String getFilename() {
            return "me.png";
          }
        });
    body.add("cropX", String.valueOf(x));
    body.add("cropY", String.valueOf(y));
    body.add("cropSize", String.valueOf(size));
    return exchange(
        "/api/v1/users/me/avatar", HttpMethod.PUT, new HttpEntity<>(body, headers), String.class);
  }

  private <T> ResponseEntity<T> exchange(
      String path, HttpMethod method, HttpEntity<?> entity, Class<T> type) {
    try {
      return rest.exchange(url(path), method, entity, type);
    } catch (HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).build();
    }
  }

  private String hashDir(String avatarUrl) {
    // /api/v1/avatars/{userId}/{hash} → avatars/{userId}/{hash}
    return avatarUrl.substring("/api/v1/".length());
  }

  @Test
  void AI_키로_PUT_multipart_하면_자를_영역이_적용되고_바꾸면_옛_폴더가_지워진다() throws Exception {
    // 400x200 왼쪽 빨강·오른쪽 파랑 → 오른쪽 200x200 만 자른다(필드가 무시되면 가운데라 반반이 된다).
    byte[] halves =
        AvatarTestImages.encode(AvatarTestImages.halves(400, 200, RED, BLUE, false), "png");
    ResponseEntity<String> first = putAvatar(halves, 200, 0, 200);
    assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
    String firstUrl = objectMapper.readTree(first.getBody()).get("avatarUrl").asText();
    assertThat(firstUrl).startsWith("/api/v1/avatars/" + agentId + "/");

    // 공개 주소 — 인증 헤더 없이.
    ResponseEntity<byte[]> image =
        exchange(firstUrl + "/256", HttpMethod.GET, HttpEntity.EMPTY, byte[].class);
    assertThat(image.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(image.getHeaders().getCacheControl())
        .isEqualTo("public, max-age=31536000, immutable");
    assertThat(image.getHeaders().getContentType()).isEqualTo(MediaType.IMAGE_JPEG);
    // 해시·크기 ETag — 다시 확인하는 요청(If-None-Match)은 본문 없이 304.
    String etag = image.getHeaders().getETag();
    assertThat(etag).isEqualTo("\"" + firstUrl.substring(firstUrl.lastIndexOf('/') + 1) + "-256\"");
    HttpHeaders revalidate = new HttpHeaders();
    revalidate.setIfNoneMatch(etag);
    assertThat(
            exchange(firstUrl + "/256", HttpMethod.GET, new HttpEntity<>(revalidate), byte[].class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_MODIFIED);
    BufferedImage img = AvatarTestImages.decode(image.getBody());
    Color left = new Color(img.getRGB(10, 128));
    assertThat(left.getBlue()).as("자른 영역(오른쪽 파랑)이 쓰였다").isGreaterThan(180);
    assertThat(left.getRed()).isLessThan(80);
    assertThat(Files.isDirectory(fileStore.resolve(hashDir(firstUrl)))).isTrue();

    // 다른 그림으로 바꾸면 커밋 뒤 옛 해시 폴더가 지워지고 옛 주소는 404.
    byte[] red = AvatarTestImages.encode(AvatarTestImages.solid(300, 300, RED), "png");
    ResponseEntity<String> second = putAvatar(red, 0, 0, 300);
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
    String secondUrl = objectMapper.readTree(second.getBody()).get("avatarUrl").asText();
    assertThat(secondUrl).isNotEqualTo(firstUrl);
    assertThat(Files.exists(fileStore.resolve(hashDir(firstUrl)))).isFalse();
    assertThat(
            exchange(firstUrl + "/256", HttpMethod.GET, HttpEntity.EMPTY, byte[].class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // 되돌리면 폴더도 지워진다.
    HttpHeaders auth = new HttpHeaders();
    auth.setBearerAuth(key);
    assertThat(
            exchange(
                    "/api/v1/users/me/avatar",
                    HttpMethod.DELETE,
                    new HttpEntity<>(auth),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(Files.exists(fileStore.resolve(hashDir(secondUrl)))).isFalse();
    assertThat(
            exchange(secondUrl + "/256", HttpMethod.GET, HttpEntity.EMPTY, byte[].class)
                .getStatusCode())
        .as("되돌린 뒤 옛 주소는 404")
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            dsl.select(USER.AVATAR_HASH)
                .from(USER)
                .where(USER.ID.eq(agentId))
                .fetchOne(0, String.class))
        .isNull();
  }

  /** avatars/{agentId}/ 아래 해시 폴더 이름들. */
  private List<String> hashDirs() throws Exception {
    Path root = fileStore.resolve("avatars/" + agentId);
    if (!Files.isDirectory(root)) return List.of();
    try (Stream<Path> dirs = Files.list(root)) {
      return dirs.map(p -> p.getFileName().toString()).sorted().toList();
    }
  }

  /**
   * 해시는 업로드마다 새 난수다 — 같은 바이트를 두 번 올려도 주소가 달라, 겹친 요청이 서로 DB 가 가리키는 폴더를 지우지 못한다. 두 번 바꾼 뒤에는 마지막 폴더
   * 하나만 남고 그 주소만 200 이다.
   */
  @Test
  void 같은_그림을_두_번_올려도_주소가_다르고_마지막_폴더만_남는다() throws Exception {
    byte[] red = AvatarTestImages.encode(AvatarTestImages.solid(300, 300, RED), "png");
    ResponseEntity<String> first = putAvatar(red, 0, 0, 300);
    ResponseEntity<String> second = putAvatar(red, 0, 0, 300);
    assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
    String firstUrl = objectMapper.readTree(first.getBody()).get("avatarUrl").asText();
    String secondUrl = objectMapper.readTree(second.getBody()).get("avatarUrl").asText();
    assertThat(secondUrl).isNotEqualTo(firstUrl);

    assertThat(
            exchange(firstUrl + "/256", HttpMethod.GET, HttpEntity.EMPTY, byte[].class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            exchange(secondUrl + "/256", HttpMethod.GET, HttpEntity.EMPTY, byte[].class)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    String secondHash = secondUrl.substring(secondUrl.lastIndexOf('/') + 1);
    assertThat(hashDirs()).containsExactly(secondHash);
  }
}
