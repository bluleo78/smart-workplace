package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.messaging.outbound.dto.MessagingClassifyResult;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessagingClassifyWatermarkRepository;
import com.workplace.messaging.service.MessagingAttentionService;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.CHANNEL;

/**
 * MessagingAttentionService 비용 깔때기 통합 테스트.
 * 이름 프리필터·watermark 게이트·버스트 코얼레싱·relevant 없어도 watermark 전진 검증.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class MessagingAttentionServiceTest {

  @Autowired MessagingAttentionService svc;
  @MockBean AiAgentMessagingClient aiClient;
  @Autowired ConversationAttentionRepository attnRepo;
  @Autowired MessagingClassifyWatermarkRepository wmRepo;
  @Autowired MessageRepository messageRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ChannelRepository channelRepo;
  @Autowired DSLContext dsl;

  /** 테스트마다 tenant GUC 주입 — RLS 통과를 위해 필수. */
  @BeforeEach
  void tenant() {
    dsl.execute("set app.tenant_id='1'");
  }

  /**
   * 채널을 PUBLIC 으로 생성하고, 주어진 이름의 멤버를 추가한 뒤 채널 ID 반환.
   * 멤버 이름은 USER.NAME 필드에 저장된다(이름 프리필터 매핑 기준).
   */
  private long seedChannelWithMembers(List<String> memberNames) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6);
    // 임시 소유자 생성
    long ownerId = seedUser("owner", "human");
    long channelId = channelRepo.insertPublic("attn-ch-" + suffix, ownerId);
    for (String name : memberNames) {
      long uid = seedUser(name, "HUMAN");
      memberRepo.add(channelId, uid, "MEMBER");
    }
    return channelId;
  }

  /** UUID suffix 유니크 유저 INSERT 후 ID 반환 (USER.NAME = name 정확히 설정). */
  private long seedUser(String name, String kind) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, name + "_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, name + "_" + suffix + "@example.com")
        .set(USER.KIND, kind.toUpperCase())
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널에 메시지를 INSERT 하고 id 반환. authorName 은 별도 user 생성 없이 임시 user 를 사용. */
  private long seedMessage(long channelId, String authorName, String body, List<Long> mentions) {
    long authorId = seedUser(authorName, "HUMAN");
    // 메시지 작성자도 채널 멤버여야 RLS 통과
    memberRepo.add(channelId, authorId, "MEMBER");
    return messageRepo.insert(channelId, authorId, body, mentions, null);
  }

  @Test
  void 이름없는_배치는_AI호출안함() {
    // 채널에 "배포 완료 ㅋㅋ" 만 → 멤버 이름("양동희") 토큰(풀네임/"동희")이 본문에 없음 → classify 미호출.
    // 또한 이름필터 skip 경로도 watermark 를 마지막 메시지 id 로 전진해야 한다 (재분류 방지).
    long ch = seedChannelWithMembers(List.of("양동희"));
    long mid = seedMessage(ch, "노이즈", "배포 완료 ㅋㅋ", List.of());
    svc.onChannelMessageSync(ch);
    verifyNoInteractions(aiClient);
    // 이름필터 조기 return 경로도 watermark 를 배치 마지막 id 로 전진해야 재분류가 차단된다.
    assertThat(wmRepo.get(ch)).isEqualTo(mid);
  }

  @Test
  void 이름있으면_classify호출_relevant만_기록() {
    long ch = seedChannelWithMembers(List.of("양동희")); // user 1
    // 본문에 "동희" 포함 → 이름 토큰 프리필터 통과
    seedMessage(ch, "김PM", "동희가 배포했나?", List.of());
    // 멤버 중 userId=1 이 relevant 로 반환되도록 모킹
    // (실제 시드된 userId 와 무관하게 upsert 동작 확인)
    long memberId = memberRepo.listMembers(ch).stream()
        .filter(m -> "양동희".equals(m.name()))
        .map(m -> m.userId())
        .findFirst().orElseThrow();
    when(aiClient.classify(any())).thenReturn(
        new MessagingClassifyResult(
            List.of(new MessagingClassifyResult.Relevant(memberId, "배포 여부 질문"))));
    svc.onChannelMessageSync(ch);
    assertThat(attnRepo.isFlagged(ch, memberId)).isTrue();
  }

  @Test
  void 새_메시지_없으면_재분류안함_watermark게이트() {
    // watermark 가 이미 최신 메시지 id 이상 → maxId<=wm → 호출 0 ("변함없는 대화는 0")
    long ch = seedChannelWithMembers(List.of("양동희"));
    long mid = seedMessage(ch, "김PM", "동희 어때?", List.of());
    wmRepo.advance(ch, mid);                 // 이미 mid 까지 분류함
    svc.onChannelMessageSync(ch);
    verifyNoInteractions(aiClient);
  }

  @Test
  void 버스트_코얼레싱_첫분류가_watermark올리면_후속스킵() {
    long ch = seedChannelWithMembers(List.of("양동희"));
    seedMessage(ch, "김PM", "동희 1", List.of());
    seedMessage(ch, "김PM", "동희 2", List.of());
    when(aiClient.classify(any())).thenReturn(new MessagingClassifyResult(List.of()));
    svc.onChannelMessageSync(ch);            // 1회 분류 → watermark=last
    svc.onChannelMessageSync(ch);            // 새 메시지 없음 → 스킵
    verify(aiClient, times(1)).classify(any());
  }

  @Test
  void relevant_없어도_watermark_전진_영구재분류방지() {
    long ch = seedChannelWithMembers(List.of("양동희"));
    long mid = seedMessage(ch, "김PM", "동희 봤어?", List.of());
    when(aiClient.classify(any())).thenReturn(new MessagingClassifyResult(List.of())); // 아무도 관련X
    svc.onChannelMessageSync(ch);
    assertThat(wmRepo.get(ch)).isEqualTo(mid); // 결과 없어도 watermark 전진
    svc.onChannelMessageSync(ch);
    verify(aiClient, times(1)).classify(any()); // 재분류 안 함
  }
}
