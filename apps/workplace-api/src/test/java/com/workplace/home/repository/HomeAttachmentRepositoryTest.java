package com.workplace.home.repository;

import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-234: home_message_attachment 저장소 — 후보 판정 입력, 세션 한정 조회 순서, 세션 파일 만료. 테스트 트랜잭션 롤백으로 정리. */
@Transactional
class HomeAttachmentRepositoryTest extends IntegrationTestBase {

  @Autowired HomeAttachmentRepository repo;
  @Autowired HomeSessionRepository sessionRepo;
  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;

  /** 임시(또는 지정 만료) ATTACHMENT file 행을 직접 심는다. */
  private long file(long uid, String name, String mime, OffsetDateTime expiresAt) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, UUID.randomUUID() + ".bin")
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, 3L)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, "tenant-1/home/2026-10-06/" + UUID.randomUUID() + ".bin")
        .set(FILE.UPLOADED_BY, uid)
        .set(FILE.CREATED_AT, OffsetDateTime.now())
        .set(FILE.EXPIRES_AT, expiresAt)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private OffsetDateTime later() {
    return OffsetDateTime.now().plusHours(24);
  }

  @Test
  void 세션_첨부는_메시지_파일_순으로_조회되고_다른_세션은_섞이지_않는다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessionService.create(uid).id();
    UUID other = sessionService.create(uid).id();
    long m1 = sessionService.appendMessage(uid, sid, "USER", "첫", null, null, null);
    long m2 = sessionService.appendMessage(uid, sid, "USER", "둘", null, null, null);
    long mo = sessionService.appendMessage(uid, other, "USER", "남", null, null, null);
    long a = file(uid, "a.pdf", "application/pdf", later());
    long b = file(uid, "b.png", "image/png", later());
    long c = file(uid, "c.txt", "text/plain", later());
    long d = file(uid, "d.txt", "text/plain", later());
    // 같은 트랜잭션이라 attached_at 이 같다 — 파일 id 로 순서가 정해지는지 본다.
    repo.bind(c, m2, uid);
    repo.bind(b, m1, uid);
    repo.bind(a, m1, uid);
    repo.bind(d, mo, uid);

    assertThat(repo.findBySession(sid))
        .extracting(HomeAttachmentRepository.Row::fileId)
        .containsExactly(a, b, c);
    assertThat(repo.countBySession(sid)).isEqualTo(3);
    assertThat(repo.countBySession(other)).isEqualTo(1);

    Map<Long, List<String>> names = repo.findNamesByMessageIds(List.of(m1, m2));
    assertThat(names.get(m1)).containsExactly("a.pdf", "b.png");
    assertThat(names.get(m2)).containsExactly("c.txt");
    assertThat(repo.findNamesByMessageIds(List.of())).isEmpty();
  }

  @Test
  void 후보_조회는_홈_정션_연결_여부와_임시_상태를_돌려주고_잠금_조회도_같은_값이다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessionService.create(uid).id();
    long m = sessionService.appendMessage(uid, sid, "USER", "q", null, null, null);
    long temp = file(uid, "t.pdf", "application/pdf", later());
    long permanent = file(uid, "p.pdf", "application/pdf", null);
    long bound = file(uid, "b.pdf", "application/pdf", later());
    repo.bind(bound, m, uid);

    var byId =
        repo.findCandidates(List.of(temp, permanent, bound, Long.MAX_VALUE)).stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    HomeAttachmentRepository.Candidate::fileId, c -> c));
    assertThat(byId).doesNotContainKey(Long.MAX_VALUE);
    assertThat(byId.get(temp).bound()).isFalse();
    assertThat(byId.get(temp).expiresAt()).isNotNull();
    assertThat(byId.get(temp).uploadedBy()).isEqualTo(uid);
    assertThat(byId.get(temp).category()).isEqualTo("ATTACHMENT");
    assertThat(byId.get(permanent).expiresAt()).isNull();
    assertThat(byId.get(bound).bound()).isTrue();

    assertThat(repo.lockCandidates(List.of(bound, temp)))
        .extracting(HomeAttachmentRepository.Candidate::fileId)
        .containsExactly(temp, bound);
    assertThat(repo.findCandidates(List.of())).isEmpty();
  }

  @Test
  void 저장정보는_그_세션에_연결된_파일만_돌려준다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessionService.create(uid).id();
    UUID other = sessionService.create(uid).id();
    long m = sessionService.appendMessage(uid, sid, "USER", "q", null, null, null);
    long f = file(uid, "a.pdf", "application/pdf", later());
    repo.bind(f, m, uid);

    var stored = repo.findStoredFile(sid, f).orElseThrow();
    assertThat(stored.originalName()).isEqualTo("a.pdf");
    assertThat(stored.mimeType()).isEqualTo("application/pdf");
    assertThat(stored.path()).startsWith("tenant-1/home/");
    assertThat(repo.findStoredFile(other, f)).isEmpty();
  }

  @Test
  void 승격과_세션_파일_만료는_대상_파일만_바꾼다() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessionService.create(uid).id();
    UUID other = sessionService.create(uid).id();
    long m = sessionService.appendMessage(uid, sid, "USER", "q", null, null, null);
    long mo = sessionService.appendMessage(uid, other, "USER", "q", null, null, null);
    long mine = file(uid, "a.pdf", "application/pdf", later());
    long theirs = file(uid, "b.pdf", "application/pdf", later());
    repo.bind(mine, m, uid);
    repo.bind(theirs, mo, uid);
    repo.promoteToPermanent(List.of(mine, theirs));
    assertThat(expiresAt(mine)).isNull();

    assertThat(repo.expireSessionFiles(sid)).isEqualTo(1);
    assertThat(expiresAt(mine)).isNotNull().isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(expiresAt(theirs)).isNull();
  }

  @Test
  void 세션_잠금은_있는_세션이면_true_없는_세션이면_false() {
    long uid = TestFixtures.createHuman(dsl);
    UUID sid = sessionService.create(uid).id();
    assertThat(sessionRepo.lockForUpdate(sid)).isTrue();
    assertThat(sessionRepo.lockForUpdate(UUID.randomUUID())).isFalse();
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }
}
