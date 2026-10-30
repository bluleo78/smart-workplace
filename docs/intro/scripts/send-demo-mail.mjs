#!/usr/bin/env node
/**
 * 메일 장면용 데모 메일 3통을, 연결된 M365 계정에서 그 계정 자신에게 보낸다.
 *
 *   MANUAL_API=https://genia-works.iacloud.kr MANUAL_TENANT_SLUG=nuri-demo MANUAL_SEED_CONFIRM=nuri-demo \
 *     MANUAL_PASS="$(security find-generic-password -s genia-works-manual-demo -w)" node docs/intro/scripts/send-demo-mail.mjs
 *
 * 왜 자기 자신에게: 실제 메일함을 연결해 찍으므로, 고객 자료에 실 메일이 나가지 않게 시연용 메일을 따로 만든다.
 * 받는 사람은 인자로 받지 않고 연결 계정의 주소로 고정한다 — 외부로는 한 통도 나가지 않는다. 제목의 【누리커머스】 로 검색해 이 메일만 보여 준다.
 * 서버 주소·확인값 규칙은 매뉴얼 시드와 같다(checkManualTarget): localhost 가 아니면 https 이고 MANUAL_SEED_CONFIRM 이 slug 와 같아야 보낸다.
 * 보내는 사람은 촬영 계정 김서연(PEOPLE[0]) — 그 계정에 연결된 첫 메일 계정에서 보낸다. 비밀번호는 환경변수로만 받는다.
 */
import { checkManualTarget, loginIntoSlug } from '../../manual/scripts/lib/user-seed.mjs';
import { makeClient, PEOPLE } from './seed-demo.mjs';

const target = checkManualTarget({
  api: process.env.MANUAL_API ?? '',
  slug: process.env.MANUAL_TENANT_SLUG,
  confirm: process.env.MANUAL_SEED_CONFIRM,
});
if (!target.ok) {
  console.error(target.reason);
  process.exit(2);
}
if (!process.env.MANUAL_PASS) {
  console.error('MANUAL_PASS 가 필요합니다.');
  process.exit(2);
}

// 본문은 400자를 넘긴다 — 그 이하는 AI 요약을 생략하도록 설계돼 있다(MailAnalysisService.SUMMARY_MIN_CHARS).
// 제목 머리말 【누리커머스】 로 검색해 이 메일만 보여 준다(촬영 스크립트의 MAIL_QUERY 와 맞춘다).
const MAILS = [
  {
    subject: '【누리커머스】 포인트 결제 API 연동 일정 확인 요청',
    paragraphs: [
      '안녕하세요, 페이링크 제휴팀 한지우입니다.',
      '지난주 회의에서 말씀 나눈 모바일 주문 앱 2.0의 포인트 결제 연동 건으로 연락드립니다. 저희 쪽 개발 일정을 확정하려면 아래 세 가지 확인이 필요합니다.',
      '1. 테스트 환경(샌드박스) 연동 시작 가능 시점 — 저희는 다음 주 월요일부터 샌드박스 키 발급이 가능합니다.\n2. 베타 오픈(10월 중순) 전에 결제 승인·부분 취소·전체 취소 시나리오를 함께 점검할 수 있는지 여부\n3. 귀사 연동 담당자 연락처와 장애 시 비상 연락 채널',
      '특히 포인트와 쿠폰을 동시에 쓰는 결제는 정산 방식이 달라 사전 협의가 꼭 필요합니다. 쿠폰 할인 후 금액에 포인트를 적용하는지, 포인트 차감 후 쿠폰을 적용하는지 정책을 알려 주시면 정산 규칙을 맞춰 두겠습니다.',
      '이번 주 금요일까지 회신 주시면 일정에 맞춰 기술 지원 인력을 배정하겠습니다. 궁금한 점은 언제든 편하게 연락 주세요.',
      '한지우 드림\n페이링크 제휴 매니저 | 010-1234-5678',
    ],
  },
  {
    subject: '【누리커머스】 재주문 시 쿠폰이 적용되지 않는다는 문의 3건',
    paragraphs: [
      '안녕하세요, 고객센터 운영팀입니다.',
      '어제 오후부터 앱에서 "지난 주문 재주문" 기능을 사용할 때 보유 쿠폰이 결제 단계에서 적용되지 않는다는 문의가 3건 접수되었습니다. 세 건 모두 같은 증상으로 보여 공유드립니다.',
      '- 공통점: 재주문으로 담은 장바구니에서만 발생하고, 상품을 직접 담은 장바구니에서는 쿠폰이 정상 적용됨\n- 기기: iOS 2건(17.5, 17.6), Android 1건(14)\n- 쿠폰 종류: 신규 가입 10% 쿠폰 2건, 생일 쿠폰 1건\n- 고객 영향: 쿠폰 미적용 상태로 결제 완료 후 차액 환불 요청 1건, 나머지 2건은 결제 전 이탈',
      '고객에게는 우선 "확인 중이며 차액은 포인트로 보상"으로 안내했습니다. 베타 오픈 전에 재현되는 문제라면 테스터 대상 공지가 필요할 수도 있어 원인과 처리 일정을 공유 부탁드립니다.',
      '문의 원문과 고객 화면 캡처는 필요하시면 바로 전달드리겠습니다.',
      '고객센터 운영팀 드림',
    ],
  },
  {
    subject: '【누리커머스】 배송 추적 API 개편 관련 미팅 요청',
    paragraphs: [
      '안녕하세요, 빠른물류 API 담당 오세훈입니다.',
      '배송 추적 개편 프로젝트와 관련해 저희가 새로 제공하는 실시간 위치 API 사양을 공유드리고 일정 협의를 하고 싶습니다.',
      '새 API는 기사 단말의 위치를 1분 단위로 제공하고, 배송 완료 시 사진 증빙 URL을 함께 전달합니다. 기존 상태 조회 API와 응답 형식이 달라 귀사 앱 화면 설계에 영향이 있을 것 같습니다. 호출량 한도와 인증 방식(OAuth 클라이언트 자격 증명)도 함께 설명드리려 합니다.',
      '다음 주 화요일이나 수요일 오후에 1시간 정도 온라인 미팅이 가능하실까요? 가능한 시간을 알려 주시면 초대장과 사양 문서를 미리 보내드리겠습니다.',
      '오세훈 드림\n빠른물류 API 담당 | 010-2345-6789',
    ],
  },
];

const client = makeClient(target.base);
const { token } = await loginIntoSlug(client, {
  username: PEOPLE[0].username,
  password: process.env.MANUAL_PASS,
  slug: process.env.MANUAL_TENANT_SLUG,
});
const accounts = await client.call(token, 'GET', '/mail/accounts');
const account = (accounts.content ?? accounts)[0];
if (!account) throw new Error('연결된 메일 계정이 없다');
const to = account.emailAddress; // 연결 계정 자신 — 주소는 출력하지 않는다(실제 계정)

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
for (const m of MAILS) {
  await client.call(token, 'POST', `/mail/accounts/${account.id}/send`, {
    to: [to],
    cc: [],
    bcc: [],
    subject: m.subject,
    bodyText: m.paragraphs.join('\n\n'),
    // 메일 표시가 white-space 스타일을 걸러 내므로 문단은 <p>, 줄바꿈은 <br> 로 표현한다
    bodyHtml: m.paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
  });
  console.log(`✓ ${m.subject}`);
}
