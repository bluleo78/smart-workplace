package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatThreadChangeNotifier;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 토크(chat thread) 읽기·쓰기 접근 판정 (WP-213).
 *
 * <p>쓰기 권한은 이슈 댓글과 같은 규칙 — 프로젝트 멤버/ADMIN, 또는 OPEN 프로젝트에서 이슈 reporter 본인 ({@link
 * ProjectAccessGuard#canWriteContent}). 규칙이 두 곳에서 따로 진화하지 않도록 chat 모듈이 project 의 가드를 직접 쓴다 — chat 은
 * project 서비스를 import 하지 않는 원칙의 의도된 예외다. 스레드 멤버가 아니어도 쓰기 권한이 있으면 메시지를 보내는 순간 대화에 자동 참여한다(댓글을 달면 자동
 * 구독되는 것과 같은 흐름).
 *
 * <p>읽기 권한은 {@link ChatThreadService#getOrCreate} 와 같다 — 프로젝트 멤버이거나 OPEN 프로젝트.
 */
@Component
@RequiredArgsConstructor
public class ChatThreadAccess {

  private final ChatThreadMemberRepository memberRepo;
  private final ChatThreadContextResolver contextResolver;
  private final IssueStakeholderLookup lookup;
  private final ProjectAccessGuard accessGuard;
  private final ChatThreadChangeNotifier notifier;

  /** 프로젝트 쓰기 권한(댓글과 동일 규칙). 스레드 멤버십과 무관한 판정 — 이미 이슈 정보를 가진 호출부(스레드 조회)용. */
  public boolean canWriteContent(long projectId, Long reporterId, long userId) {
    return accessGuard.canWriteContent(projectId, reporterId, userId);
  }

  /** 읽기 권한 규칙 — 프로젝트 멤버이거나 OPEN 프로젝트. 스레드 조회(getOrCreate)와 메시지 목록이 이 한 규칙을 공유한다. */
  public boolean canRead(long projectId, long userId) {
    return lookup.isProjectMember(projectId, userId) || lookup.isOpenProject(projectId);
  }

  /**
   * 쓰기 권한 확인(참여 없음). 타이핑 알림·첨부 선업로드·전송 전 검증용 — 읽기 전용 트랜잭션에서도 호출 가능. 없으면
   * ChatThreadNotMemberException(403).
   *
   * @return 이미 스레드 멤버면 null, 아니면 {@link #join} 에 넘길 스레드 컨텍스트(참여가 필요한 쓰기 권한자)
   */
  public ChatThreadContextResolver.Context ensureCanWrite(long threadId, long userId) {
    if (memberRepo.isMember(threadId, userId)) return null;
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null || !canWriteContent(ctx.projectId(), ctx.reporterId(), userId)) {
      throw new ChatThreadNotMemberException(threadId, userId);
    }
    return ctx;
  }

  /**
   * {@link #ensureCanWrite} 가 참여 필요(non-null)로 판정한 사용자를 대화에 자동 참여시키고 멤버 변경을 알린다(이슈 화면 멤버 수·목록 갱신).
   * ctx 가 null(이미 멤버)이면 no-op. 쓰기 트랜잭션 안에서 호출해야 하며, 이후 같은 트랜잭션의 멤버십 검사(드라이브 링크 등)가 새 멤버 row 를 본다.
   */
  public void join(ChatThreadContextResolver.Context ctx, long threadId, long userId) {
    if (ctx == null) return;
    memberRepo.insertIgnoreConflict(threadId, List.of(userId));
    notifier.membersChanged(
        ctx.projectId(), ctx.projectKey(), ctx.issueNumber(), threadId, userId, Set.of());
  }

  /** 읽기 권한 확인 — 스레드 멤버이거나 {@link #canRead}. 없으면 ChatThreadNotMemberException(403). */
  public void ensureCanRead(long threadId, long userId) {
    if (memberRepo.isMember(threadId, userId)) return;
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null || !canRead(ctx.projectId(), userId)) {
      throw new ChatThreadNotMemberException(threadId, userId);
    }
  }
}
