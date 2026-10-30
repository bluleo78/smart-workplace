package com.workplace.user.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.AvatarTestImages;
import com.workplace.user.dto.AgentUsernames;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1222 프로필 아바타 API 통합 테스트 — 내 아바타 바꾸기·되돌리기, 공개 이미지(인증 없음·영구 캐시·크기·404), 형식·크기·자를 영역 검증, EXIF
 * 제거·방향, WEBP·GIF, 워크스페이스 아바타 목록, 관리자의 AI 아바타, AI 키로 자기 아바타 바꾸기.
 *
 * <p>테스트 트랜잭션이 롤백되면 서비스가 새로 쓴 아바타 폴더를 지운다(롤백 정리) — 디스크에 찌꺼기가 남지 않는다. 커밋 뒤 옛 폴더 삭제와 그에 따른 옛 주소 404
 * 는(공개 응답은 DB 가 아니라 폴더가 있는지로 정한다) 커밋이 일어나는 실제 HTTP 테스트({@code AvatarRealHttpTest})가 본다.
 */
@Transactional
class AvatarControllerTest extends IntegrationTestBase {

  private static final Color RED = new Color(220, 20, 20);
  private static final Color BLUE = new Color(20, 20, 220);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired AgentApiKeyService agentApiKeyService;

  private Authentication auth(long userId, String... perms) {
    var authorities = Arrays.stream(perms).map(SimpleGrantedAuthority::new).toList();
    return new UsernamePasswordAuthenticationToken(userId, "n/a", authorities);
  }

  /** 테넌트 tenantId 의 ACTIVE 구성원(HUMAN/AGENT)을 만든다. */
  private long member(String kind, long tenantId) {
    long id =
        "AGENT".equals(kind) ? TestFixtures.createAgentNoToken(dsl) : TestFixtures.createHuman(dsl);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private MockMultipartFile file(byte[] bytes, String name) {
    return new MockMultipartFile("file", name, "image/png", bytes);
  }

  /** 내 아바타 PUT(crop 은 null 이면 빼고 보낸다). */
  private ResultActions putMine(long userId, MockMultipartFile file, Integer... crop)
      throws Exception {
    TenantContext.set(1L);
    var req =
        multipart(HttpMethod.PUT, "/api/v1/users/me/avatar")
            .file(file)
            .with(authentication(auth(userId, "user:write:self")));
    if (crop.length == 3) {
      req.param("cropX", String.valueOf(crop[0]))
          .param("cropY", String.valueOf(crop[1]))
          .param("cropSize", String.valueOf(crop[2]));
    }
    return mvc.perform(req);
  }

  private String avatarUrlOf(MvcResult result) throws Exception {
    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    return body.get("avatarUrl").asText();
  }

  /** 공개 이미지를 인증 없이 받는다. */
  private MvcResult fetchPublic(String url) throws Exception {
    return mvc.perform(get(url)).andReturn();
  }

  private String avatarHashInDb(long userId) {
    return dsl.select(USER.AVATAR_HASH)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOne(0, String.class);
  }

  private static boolean near(int rgb, Color c) {
    Color got = new Color(rgb, true);
    return Math.abs(got.getRed() - c.getRed()) < 40
        && Math.abs(got.getGreen() - c.getGreen()) < 40
        && Math.abs(got.getBlue() - c.getBlue()) < 40;
  }

  @Test
  void PNG_를_잘라_올리면_공개_주소가_나오고_인증없이_256px_이미지를_영구_캐시로_준다() throws Exception {
    long me = member("HUMAN", 1L);
    // 400x200: 왼쪽 빨강, 오른쪽 파랑 → 오른쪽 200x200 을 자르면 모두 파랑.
    byte[] png =
        AvatarTestImages.encode(AvatarTestImages.halves(400, 200, RED, BLUE, false), "png");

    MvcResult put =
        putMine(me, file(png, "me.png"), 200, 0, 200).andExpect(status().isOk()).andReturn();
    String url = avatarUrlOf(put);
    String hash = avatarHashInDb(me);
    assertThat(hash).hasSize(20).matches("[0-9a-f]+");
    assertThat(url).isEqualTo("/api/v1/avatars/" + me + "/" + hash);

    mvc.perform(get(url + "/256"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "public, max-age=31536000, immutable"))
        .andExpect(header().string("Content-Type", "image/jpeg"));
    BufferedImage img =
        AvatarTestImages.decode(fetchPublic(url + "/256").getResponse().getContentAsByteArray());
    assertThat(img.getWidth()).isEqualTo(256);
    assertThat(img.getHeight()).isEqualTo(256);
    assertThat(near(img.getRGB(10, 128), BLUE)).as("자른 영역(오른쪽) 이 쓰였다").isTrue();
    assertThat(near(img.getRGB(245, 128), BLUE)).isTrue();

    for (int size : new int[] {64, 128}) {
      BufferedImage small =
          AvatarTestImages.decode(
              fetchPublic(url + "/" + size).getResponse().getContentAsByteArray());
      assertThat(small.getWidth()).isEqualTo(size);
      assertThat(small.getHeight()).isEqualTo(size);
    }
  }

  @Test
  void 자를_영역이_없으면_가운데_정사각을_쓰고_내_프로필에_avatarUrl_이_실린다() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] png =
        AvatarTestImages.encode(AvatarTestImages.halves(400, 200, RED, BLUE, false), "png");
    String url =
        avatarUrlOf(putMine(me, file(png, "me.png")).andExpect(status().isOk()).andReturn());

    BufferedImage img =
        AvatarTestImages.decode(fetchPublic(url + "/256").getResponse().getContentAsByteArray());
    // 가운데 200x200 → 왼쪽 절반 빨강, 오른쪽 절반 파랑.
    assertThat(near(img.getRGB(30, 128), RED)).isTrue();
    assertThat(near(img.getRGB(226, 128), BLUE)).isTrue();

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/users/me").with(authentication(auth(me))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.avatarUrl").value(url));
  }

  @Test
  void 틀린_해시_없는_크기_없는_사용자는_404() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    String url =
        avatarUrlOf(putMine(me, file(png, "a.png")).andExpect(status().isOk()).andReturn());
    String hash = avatarHashInDb(me);

    mvc.perform(get(url + "/100")).andExpect(status().isNotFound());
    mvc.perform(get(url + "/512")).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/avatars/" + me + "/0123456789abcdef0123/256"))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/avatars/99999999/" + hash + "/256")).andExpect(status().isNotFound());
  }

  @Test
  void 이미지가_아닌_바이트는_png_이름이어도_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
    putMine(me, file(html, "evil.png"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("PNG·JPEG·GIF·WEBP 이미지만 아바타로 쓸 수 있습니다"));
    assertThat(avatarHashInDb(me)).isNull();
  }

  @Test
  void 시그니처만_맞고_깨진_이미지는_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    byte[] broken = Arrays.copyOf(png, 40);
    putMine(me, file(broken, "broken.png")).andExpect(status().isBadRequest());
  }

  @Test
  void 가로나_세로가_4000px_를_넘으면_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] wide = AvatarTestImages.encode(AvatarTestImages.solid(4001, 1, BLUE), "png");
    putMine(me, file(wide, "wide.png"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("가로·세로 4000px 이하 이미지만 아바타로 쓸 수 있습니다"));
  }

  @Test
  void 자른_영역이_128px_보다_작으면_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] small = AvatarTestImages.encode(AvatarTestImages.solid(100, 100, BLUE), "png");
    putMine(me, file(small, "small.png")).andExpect(status().isBadRequest());
    byte[] ok = AvatarTestImages.encode(AvatarTestImages.solid(300, 300, BLUE), "png");
    putMine(me, file(ok, "ok.png"), 0, 0, 127).andExpect(status().isBadRequest());
  }

  @Test
  void 자를_영역이_이미지_밖이거나_일부만_오면_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(300, 300, BLUE), "png");
    putMine(me, file(png, "a.png"), 200, 0, 200)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("자를 영역이 이미지 밖에 있습니다"));
    putMine(me, file(png, "a.png"), -1, 0, 200).andExpect(status().isBadRequest());
    TenantContext.set(1L);
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/users/me/avatar")
                .file(file(png, "a.png"))
                .param("cropX", "0")
                .with(authentication(auth(me, "user:write:self"))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 파일이_5MB_를_넘으면_400() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] big = new byte[5 * 1024 * 1024 + 1];
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    System.arraycopy(png, 0, big, 0, png.length);
    putMine(me, file(big, "big.png"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("이미지 파일은 최대 5MB까지 업로드할 수 있습니다: big.png"));
  }

  @Test
  void 파일_없이_보내면_400_권한_없으면_403() throws Exception {
    long me = member("HUMAN", 1L);
    TenantContext.set(1L);
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/users/me/avatar")
                .with(authentication(auth(me, "user:write:self"))))
        .andExpect(status().isBadRequest());
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    TenantContext.set(1L);
    mvc.perform(
            multipart(HttpMethod.PUT, "/api/v1/users/me/avatar")
                .file(file(png, "a.png"))
                .with(authentication(auth(me, "other:perm"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void EXIF_방향을_적용해_자르고_결과에는_EXIF_가_없다() throws Exception {
    long me = member("HUMAN", 1L);
    // 저장된 픽셀 400x200(왼쪽 빨강·오른쪽 파랑) + 방향 6(시계 90도) → 보이는 모습 200x400(위 빨강·아래 파랑).
    byte[] jpeg =
        AvatarTestImages.encode(AvatarTestImages.halves(400, 200, RED, BLUE, false), "jpg");
    byte[] withExif = AvatarTestImages.withExif(jpeg, 6);
    assertThat(new String(withExif, StandardCharsets.ISO_8859_1)).contains("Exif");

    String url =
        avatarUrlOf(
            putMine(me, file(withExif, "phone.jpg")).andExpect(status().isOk()).andReturn());
    for (int size : new int[] {64, 128, 256}) {
      byte[] out = fetchPublic(url + "/" + size).getResponse().getContentAsByteArray();
      assertThat(new String(out, StandardCharsets.ISO_8859_1)).doesNotContain("Exif");
    }
    BufferedImage img =
        AvatarTestImages.decode(fetchPublic(url + "/256").getResponse().getContentAsByteArray());
    assertThat(near(img.getRGB(128, 30), RED)).as("위쪽은 빨강(방향 적용)").isTrue();
    assertThat(near(img.getRGB(128, 226), BLUE)).as("아래쪽은 파랑(방향 적용)").isTrue();
  }

  /**
   * 자를 영역은 브라우저가 보여 주는(방향 적용 뒤) 좌표다 — 서버는 이 정사각을 원본 좌표로 옮겨 그 영역만 읽은 뒤 돌린다. 저장된 픽셀 400x200(왼쪽 빨강·오른쪽
   * 파랑)에 방향을 달리 붙이고 보이는 모습의 왼쪽 위 200 정사각을 잘라, 그 자리에 보이던 색이 나오는지 본다.
   */
  @Test
  void EXIF_방향이_있으면_자를_영역을_보이는_모습_좌표로_해석한다() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] jpeg =
        AvatarTestImages.encode(AvatarTestImages.halves(400, 200, RED, BLUE, false), "jpg");
    // 3(180도): 보이는 모습 400x200 왼쪽 파랑 / 6(시계 90도): 200x400 위 빨강 / 8(반시계 90도): 200x400 위 파랑.
    int[][] cases = {{3, BLUE.getRGB()}, {6, RED.getRGB()}, {8, BLUE.getRGB()}};
    for (int[] c : cases) {
      byte[] withExif = AvatarTestImages.withExif(jpeg, c[0]);
      String url =
          avatarUrlOf(
              putMine(me, file(withExif, "phone.jpg"), 0, 0, 200)
                  .andExpect(status().isOk())
                  .andReturn());
      BufferedImage img =
          AvatarTestImages.decode(fetchPublic(url + "/256").getResponse().getContentAsByteArray());
      Color expected = new Color(c[1]);
      for (int[] p : new int[][] {{20, 20}, {236, 20}, {20, 236}, {236, 236}}) {
        assertThat(near(img.getRGB(p[0], p[1]), expected))
            .as("방향 %d 의 (%d, %d)", c[0], p[0], p[1])
            .isTrue();
      }
    }
  }

  @Test
  void WEBP_를_읽고_투명하면_PNG_로_저장한다() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] webp = AvatarTestImages.solidWebp(300, 300, 0x80, 0x10, 0x80, 0xF0);
    String url =
        avatarUrlOf(putMine(me, file(webp, "a.webp")).andExpect(status().isOk()).andReturn());

    MvcResult res = fetchPublic(url + "/256");
    assertThat(res.getResponse().getContentType()).isEqualTo("image/png");
    BufferedImage img = AvatarTestImages.decode(res.getResponse().getContentAsByteArray());
    Color c = new Color(img.getRGB(128, 128), true);
    assertThat(img.getWidth()).isEqualTo(256);
    assertThat(c.getAlpha()).isBetween(0x70, 0x90);
    assertThat(c.getBlue()).isGreaterThan(0xD0);
    assertThat(c.getRed()).isLessThan(0x30);
  }

  @Test
  void GIF_는_첫_프레임을_쓴다() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] gif = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "gif");
    String url =
        avatarUrlOf(putMine(me, file(gif, "a.gif")).andExpect(status().isOk()).andReturn());
    MvcResult res = fetchPublic(url + "/128");
    assertThat(res.getResponse().getStatus()).isEqualTo(200);
    BufferedImage img = AvatarTestImages.decode(res.getResponse().getContentAsByteArray());
    assertThat(img.getWidth()).isEqualTo(128);
    assertThat(near(img.getRGB(64, 64), BLUE)).isTrue();
  }

  @Test
  void 되돌리면_해시가_비고_내_프로필_avatarUrl_은_null() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    String url =
        avatarUrlOf(putMine(me, file(png, "a.png")).andExpect(status().isOk()).andReturn());
    assertThat(fetchPublic(url + "/64").getResponse().getStatus()).isEqualTo(200);

    TenantContext.set(1L);
    mvc.perform(delete("/api/v1/users/me/avatar").with(authentication(auth(me, "user:write:self"))))
        .andExpect(status().isNoContent());
    assertThat(avatarHashInDb(me)).isNull();
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/users/me").with(authentication(auth(me))))
        .andExpect(jsonPath("$.avatarUrl").doesNotExist());
    // 이미 기본이어도 204.
    TenantContext.set(1L);
    mvc.perform(delete("/api/v1/users/me/avatar").with(authentication(auth(me, "user:write:self"))))
        .andExpect(status().isNoContent());
  }

  @Test
  void 바꾸면_새_주소가_DB_해시가_되고_200() throws Exception {
    long me = member("HUMAN", 1L);
    byte[] blue = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    byte[] red = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, RED), "png");
    String oldUrl =
        avatarUrlOf(putMine(me, file(blue, "a.png")).andExpect(status().isOk()).andReturn());
    String newUrl =
        avatarUrlOf(putMine(me, file(red, "b.png")).andExpect(status().isOk()).andReturn());
    assertThat(newUrl).isNotEqualTo(oldUrl);
    assertThat(newUrl).endsWith("/" + avatarHashInDb(me));
    // 옛 주소 404 는 커밋 뒤 옛 폴더가 지워져야 드러나므로 AvatarRealHttpTest 가 본다.
    assertThat(fetchPublic(newUrl + "/256").getResponse().getStatus()).isEqualTo(200);
  }

  @Test
  void 워크스페이스_아바타_목록은_지금_테넌트_구성원_중_아바타가_있는_사람만() throws Exception {
    long withAvatar = member("HUMAN", 1L);
    long agentWithAvatar = member("AGENT", 1L);
    long noAvatar = member("HUMAN", 1L);
    long otherTenant = TestFixtures.createTenant(dsl, "ACTIVE");
    long outsider = member("HUMAN", otherTenant);
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    for (long id : new long[] {withAvatar, agentWithAvatar, outsider}) {
      dsl.update(USER).set(USER.AVATAR_HASH, suffix).where(USER.ID.eq(id)).execute();
    }

    TenantContext.set(1L);
    MvcResult res =
        mvc.perform(get("/api/v1/users/avatars").with(authentication(auth(noAvatar))))
            .andExpect(status().isOk())
            .andReturn();
    JsonNode list = objectMapper.readTree(res.getResponse().getContentAsString());
    var ids = new java.util.HashSet<Long>();
    list.forEach(
        n -> {
          ids.add(n.get("userId").asLong());
          if (n.get("userId").asLong() == withAvatar) {
            assertThat(n.get("avatarUrl").asText())
                .isEqualTo("/api/v1/avatars/" + withAvatar + "/" + suffix);
          }
        });
    assertThat(ids).contains(withAvatar, agentWithAvatar).doesNotContain(noAvatar, outsider);
  }

  @Test
  void 워크스페이스_아바타_목록은_로그인이_필요하다() throws Exception {
    mvc.perform(get("/api/v1/users/avatars")).andExpect(status().isUnauthorized());
  }

  // ---- 관리자의 AI 아바타 ----

  private long admin() {
    long id = member("HUMAN", 1L);
    TestFixtures.grantRole(dsl, id, "ADMIN");
    return id;
  }

  private ResultActions putAgent(long caller, long target, byte[] png) throws Exception {
    TenantContext.set(1L);
    return mvc.perform(
        multipart(HttpMethod.PUT, "/api/v1/admin/agents/" + target + "/avatar")
            .file(file(png, "ai.png"))
            .with(authentication(auth(caller, "user:write"))));
  }

  @Test
  void 관리자는_AI_아바타를_바꾸고_되돌린다() throws Exception {
    long admin = admin();
    long agent = member("AGENT", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");

    String url = avatarUrlOf(putAgent(admin, agent, png).andExpect(status().isOk()).andReturn());
    assertThat(url).startsWith("/api/v1/avatars/" + agent + "/");
    assertThat(fetchPublic(url + "/128").getResponse().getStatus()).isEqualTo(200);

    TenantContext.set(1L);
    mvc.perform(
            delete("/api/v1/admin/agents/" + agent + "/avatar")
                .with(authentication(auth(admin, "user:write"))))
        .andExpect(status().isNoContent());
    assertThat(avatarHashInDb(agent)).isNull();
  }

  @Test
  void 관리자가_아니면_AI_아바타를_못_바꾼다_403() throws Exception {
    long notAdmin = member("HUMAN", 1L);
    long agent = member("AGENT", 1L);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");
    putAgent(notAdmin, agent, png).andExpect(status().isForbidden());
    TenantContext.set(1L);
    mvc.perform(
            delete("/api/v1/admin/agents/" + agent + "/avatar")
                .with(authentication(auth(notAdmin, "user:write"))))
        .andExpect(status().isForbidden());
    assertThat(avatarHashInDb(agent)).isNull();
  }

  @Test
  void 대상이_사람이거나_다른_워크스페이스_AI_면_404() throws Exception {
    long admin = admin();
    long human = member("HUMAN", 1L);
    long otherTenant = TestFixtures.createTenant(dsl, "ACTIVE");
    long foreignAgent = member("AGENT", otherTenant);
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");

    putAgent(admin, human, png).andExpect(status().isNotFound());
    putAgent(admin, foreignAgent, png).andExpect(status().isNotFound());
    putAgent(admin, 99999999L, png).andExpect(status().isNotFound());
    TenantContext.set(1L);
    mvc.perform(
            delete("/api/v1/admin/agents/" + human + "/avatar")
                .with(authentication(auth(admin, "user:write"))))
        .andExpect(status().isNotFound());
    assertThat(avatarHashInDb(human)).isNull();
    assertThat(avatarHashInDb(foreignAgent)).isNull();
  }

  @Test
  void 개인_비서_AI_의_아바타는_관리자가_못_바꾼다_403() throws Exception {
    long admin = admin();
    long assistant = member("AGENT", 1L);
    // 개인 비서는 username 접두어로 가린다 — 이름 변경처럼 소유자만 바꿀 수 있다.
    dsl.update(USER)
        .set(USER.USERNAME, AgentUsernames.personalAssistantOf(admin))
        .where(USER.ID.eq(assistant))
        .execute();
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, BLUE), "png");

    putAgent(admin, assistant, png).andExpect(status().isForbidden());
    assertThat(avatarHashInDb(assistant)).isNull();
  }

  // ---- AI 키로 자기 아바타 ----

  @Test
  void AI_는_자기_API_키로_자기_아바타를_바꾼다() throws Exception {
    long admin = admin();
    long agent = member("AGENT", 1L);
    TestFixtures.grantRole(dsl, agent, "AGENT");
    TenantContext.set(1L);
    String key =
        agentApiKeyService.issue(admin, agent, new IssueAgentKeyRequest("avatar")).plaintextKey();
    byte[] png = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, RED), "png");

    TenantContext.clear();
    MvcResult res =
        mvc.perform(
                multipart(HttpMethod.PUT, "/api/v1/users/me/avatar")
                    .file(file(png, "me.png"))
                    .header("Authorization", "Bearer " + key))
            .andExpect(status().isOk())
            .andReturn();
    assertThat(avatarUrlOf(res)).startsWith("/api/v1/avatars/" + agent + "/");
    assertThat(avatarHashInDb(agent)).isNotNull();
  }
}
