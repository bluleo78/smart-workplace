package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.IssueCommentResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** issue_comment 리포지토리. 응답 시 USER 테이블과 JOIN 하여 작성자 이름을 포함한다. */
@Repository
@RequiredArgsConstructor
public class IssueCommentRepository {

  private final DSLContext dsl;

  /** SELECT 결과를 {@link IssueCommentResponse} 로 매핑. user.name/kind JOIN 포함. */
  private IssueCommentResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(ISSUE_COMMENT.CREATED_AT);
    OffsetDateTime updated = r.get(ISSUE_COMMENT.UPDATED_AT);
    return new IssueCommentResponse(
        r.get(ISSUE_COMMENT.ID),
        r.get(ISSUE_COMMENT.ISSUE_ID),
        r.get(ISSUE_COMMENT.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_COMMENT.BODY),
        created != null ? created.toInstant() : null,
        updated != null ? updated.toInstant() : null,
        r.get(USER.USERNAME),
        List.of(),
        // 멘션 사용자는 응답을 만드는 서비스가 채운다(IssueCommentMentionService, WP-1095) — 권한 확인·AI 요약처럼 본문만 읽는 경로는
        // 조회하지 않는다.
        List.of());
  }

  /** id 로 활성 코멘트 조회 (user JOIN). */
  public Optional<IssueCommentResponse> findById(Long id) {
    return dsl.select(
            ISSUE_COMMENT.ID,
            ISSUE_COMMENT.ISSUE_ID,
            ISSUE_COMMENT.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            USER.USERNAME,
            ISSUE_COMMENT.BODY,
            ISSUE_COMMENT.CREATED_AT,
            ISSUE_COMMENT.UPDATED_AT)
        .from(ISSUE_COMMENT)
        .join(USER)
        .on(USER.ID.eq(ISSUE_COMMENT.AUTHOR_ID))
        .where(ISSUE_COMMENT.ID.eq(id).and(ISSUE_COMMENT.DELETED_AT.isNull()))
        .fetchOptional(this::mapToResponse);
  }

  /** 이슈 단위 활성 코멘트 목록을 created_at asc(같으면 id asc) 정렬로 조회. */
  public List<IssueCommentResponse> findByIssue(Long issueId) {
    return dsl.select(
            ISSUE_COMMENT.ID,
            ISSUE_COMMENT.ISSUE_ID,
            ISSUE_COMMENT.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            USER.USERNAME,
            ISSUE_COMMENT.BODY,
            ISSUE_COMMENT.CREATED_AT,
            ISSUE_COMMENT.UPDATED_AT)
        .from(ISSUE_COMMENT)
        .join(USER)
        .on(USER.ID.eq(ISSUE_COMMENT.AUTHOR_ID))
        .where(ISSUE_COMMENT.ISSUE_ID.eq(issueId).and(ISSUE_COMMENT.DELETED_AT.isNull()))
        // 같은 시각(한 트랜잭션·같은 밀리초)에 들어온 코멘트는 먼저 넣은 순서(id)로 — 순서가 정해지지 않으면 화면·테스트가 흔들린다(WP-1095 리뷰).
        .orderBy(ISSUE_COMMENT.CREATED_AT.asc(), ISSUE_COMMENT.ID.asc())
        .fetch(this::mapToResponse);
  }

  /** 이 사람(authorId) 말고 다른 사람이 단 활성 코멘트가 있는지(WP-634 — 비멤버 제보자 삭제 가능 판정). */
  public boolean existsFromOthers(Long issueId, Long authorId) {
    return dsl.fetchExists(
        ISSUE_COMMENT,
        ISSUE_COMMENT
            .ISSUE_ID
            .eq(issueId)
            .and(ISSUE_COMMENT.DELETED_AT.isNull())
            .and(ISSUE_COMMENT.AUTHOR_ID.ne(authorId)));
  }

  /** 신규 코멘트 INSERT 후 user JOIN 으로 응답 구성. */
  public IssueCommentResponse insert(Long issueId, Long authorId, String body) {
    Long id =
        dsl.insertInto(ISSUE_COMMENT)
            .set(ISSUE_COMMENT.ISSUE_ID, issueId)
            .set(ISSUE_COMMENT.AUTHOR_ID, authorId)
            .set(ISSUE_COMMENT.BODY, body)
            .returning(ISSUE_COMMENT.ID)
            .fetchOptional()
            .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"))
            .getId();
    return findById(id).orElseThrow();
  }

  /**
   * 가져오기(WP-883) 댓글 INSERT — 원작성자·원 작성·수정 시각과 가져옴 표시(imported_by·imported_at=지금)를 한 번에 쓴다(INSERT 뒤
   * UPDATE 로 덮어쓰지 않게). 응답 조립이 필요 없어 새 id 만 돌려준다.
   */
  public long insertImported(
      long issueId,
      long authorId,
      String body,
      OffsetDateTime createdAt,
      OffsetDateTime updatedAt,
      long importedBy) {
    return dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, issueId)
        .set(ISSUE_COMMENT.AUTHOR_ID, authorId)
        .set(ISSUE_COMMENT.BODY, body)
        .set(ISSUE_COMMENT.CREATED_AT, createdAt)
        .set(ISSUE_COMMENT.UPDATED_AT, updatedAt)
        .set(ISSUE_COMMENT.IMPORTED_BY, importedBy)
        .set(ISSUE_COMMENT.IMPORTED_AT, OffsetDateTime.now())
        .returning(ISSUE_COMMENT.ID)
        .fetchOptional()
        .orElseThrow(() -> new IllegalStateException("INSERT RETURNING 결과 없음"))
        .getId();
  }

  /** body 갱신. updated_at = now(). */
  public void update(Long id, String body) {
    dsl.update(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.BODY, body)
        .set(ISSUE_COMMENT.UPDATED_AT, OffsetDateTime.now())
        .where(ISSUE_COMMENT.ID.eq(id))
        .execute();
  }

  /**
   * 반응을 달기 전에 살아 있는 코멘트 행을 잠근다(FOR NO KEY UPDATE) — 같은 코멘트에 대한 반응 추가가 상한 확인부터 삽입까지 한 줄로 서서, 동시 요청이
   * 모두 「상한 미만」으로 읽고 함께 넣는 일을 막는다(WP-829, 채팅 MessageRepository.lockForReaction 과 같다). 반응 행 FK 의 KEY
   * SHARE 와는 충돌하지 않는다. 지워졌거나 없는 코멘트면 false.
   */
  public boolean lockForReaction(long id) {
    return dsl.select(ISSUE_COMMENT.ID)
        .from(ISSUE_COMMENT)
        .where(ISSUE_COMMENT.ID.eq(id).and(ISSUE_COMMENT.DELETED_AT.isNull()))
        .forNoKeyUpdate()
        .fetchOptional()
        .isPresent();
  }

  /** soft-delete: deleted_at = now(). */
  public void softDelete(Long id) {
    dsl.update(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE_COMMENT.ID.eq(id))
        .execute();
  }
}
