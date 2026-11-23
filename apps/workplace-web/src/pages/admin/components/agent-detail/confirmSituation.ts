import { eunNeun, objectParticle, subjectParticle } from '../../../../lib/utils';

/**
 * 이슈 키 뒤 조사 — 「WP-1271 을/이」. 숫자로 끝나면 읽는 소리(일·이·삼…)의 받침으로 고르고,
 * 아니면 일반 조사 규칙(목적격 objectParticle·주격 subjectParticle)을 따른다.
 */
function digitParticle(text: string, withFinal: string, withoutFinal: string): string | null {
  const last = text.slice(-1);
  if (!/\d/.test(last)) return null;
  return '013678'.includes(last) ? withFinal : withoutFinal;
}

export const keyObjectParticle = (text: string) => digitParticle(text, '을', '를') ?? objectParticle(text);
export const keySubjectParticle = (text: string) => digitParticle(text, '이', '가') ?? subjectParticle(text);
/** 이슈 키 뒤 주제 조사(은/는) — 숫자로 끝나면 읽는 소리의 받침으로, 그 밖에는 마지막 음절 받침으로 고른다. */
const keyTopicParticle = (text: string) => digitParticle(text, '은', '는') ?? eunNeun(text);

/**
 * 확인 창 ①의 현황 한 줄(WP-2018 리뷰 후속) — 같은 창이 뜨는 「차단됨」(사람의 답 대기)과 「시작 실패」를 나눠 지금 상태에 맞게 말한다.
 * 예전엔 둘 다 「처리하고 있어요」 라서 창만 봐서는 어떤 상태인지 알 수 없었다. 이슈 키가 없어도 문장이 깨지지 않는다.
 * 컴포넌트 파일에 두면 리액트 새로고침 규칙(react-refresh/only-export-components)에 걸리므로 순수 함수라 따로 둔다.
 */
export function confirmSituation(opts: { name: string; failedOn: boolean; blocked: boolean; issueKey: string | null }): string {
  const { name, failedOn, blocked, issueKey } = opts;
  const who = `${name}${subjectParticle(name)}`;
  // 이슈 키에 목적격 조사를 붙인 것 — 목적어 자리(처리하고 있어요)에서만 쓴다. 차단됨 문장은 전치사(에서)를, 시작 실패 문장은 주제격을 쓴다.
  const objectKey = issueKey ? `${issueKey} ${keyObjectParticle(issueKey)}` : null;
  // 「아직 하던 일이에요」 의 주어는 키라 목적격이 아니라 주제격(은/는)이 맞다 — 「WP-1 을 아직 하던 일이에요」 는 문법이 깨진다(WP-2018 리뷰).
  const topicKey = issueKey ? `${issueKey} ${keyTopicParticle(issueKey)}` : null;
  if (blocked) {
    const waiting = issueKey ? `${issueKey} 에서 사람의 답을 기다리고 있어요.` : '사람의 답을 기다리고 있어요.';
    return `${failedOn ? '시작에 실패한 뒤에도 ' : ''}${who} ${waiting}`;
  }
  if (failedOn) {
    return topicKey
      ? `${who} 시작에 실패했지만 ${topicKey} 아직 하던 일이에요.`
      : `${who} 시작에 실패했지만 하던 일이 남아 있어요.`;
  }
  return `${who} ${objectKey ?? '이슈를'} 처리하고 있어요.`;
}