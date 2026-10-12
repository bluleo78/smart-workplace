import { describe, expect, it } from 'vitest';

import { isIssueImageSrc } from '../../api/issueImages';
import { countApiImages, splitApiImages, withImagePlaceholders } from './apiImageSegments';
import { bodyToDoc, serializeToBody } from './mentionSerialize';

const IMG = '/api/v1/projects/WP/issue-images/12';

describe('splitApiImages', () => {
  it('이미지 앞뒤 줄바꿈 하나씩을 빼고 텍스트·이미지로 나눈다', () => {
    expect(splitApiImages(`버튼이 겹쳐요\n![a.png](${IMG})\n모바일`, 'WP')).toEqual([
      { type: 'text', value: '버튼이 겹쳐요' },
      { type: 'image', src: IMG, alt: 'a.png' },
      { type: 'text', value: '모바일' },
    ]);
  });

  it('이 프로젝트 이슈 이미지가 아닌 마크다운(외부·임의 API·다른 프로젝트)은 글자로 둔다', () => {
    const text =
      '![x](https://example.com/a.png) ![y](/api/v1/admin/users) ![z](/api/v1/projects/OTHER/issue-images/5)';
    expect(splitApiImages(text, 'WP')).toEqual([{ type: 'text', value: text }]);
  });

  it('서로 다른 이미지 수를 세고 미리보기에서는 [이미지] 로 줄인다', () => {
    const text = `a ![p](${IMG}) b ![q](${IMG}9) c ![p](${IMG}) ![o](/api/v1/projects/OTHER/issue-images/5)`;
    expect(countApiImages(text, 'WP')).toBe(2);
    expect(withImagePlaceholders(text, 'WP')).toBe(
      'a [이미지] b [이미지] c [이미지] ![o](/api/v1/projects/OTHER/issue-images/5)',
    );
  });

  it('이슈 이미지 경로만 이미지 src 로 인정한다', () => {
    expect(isIssueImageSrc(IMG)).toBe(true);
    expect(isIssueImageSrc('/api/v1/admin/users')).toBe(false);
    expect(isIssueImageSrc(`${IMG}/../x`)).toBe(false);
    expect(isIssueImageSrc('blob:http://x/1')).toBe(false);
  });
});

describe('이미지 노드 ↔ 저장 글 왕복', () => {
  it('이미지·멘션이 섞인 글을 문서로 복원했다가 같은 글로 저장한다', () => {
    const body = `<@3> 확인 부탁\n![shot.png](${IMG})\n끝`;
    const doc = bodyToDoc(body, [{ id: 3, name: '김AI', kind: 'AGENT' }], { images: true });
    expect(doc.content?.[1]).toEqual({ type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG, alt: 'shot.png' } }] });
    expect(serializeToBody(doc)).toBe(body);
  });

  it('이슈 이미지가 아닌 API 경로는 이미지 노드로 복원하지 않는다', () => {
    const doc = bodyToDoc('![a](/api/v1/admin/users)', [], { images: true });
    expect(doc.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '![a](/api/v1/admin/users)' }] });
  });

  it('이미지를 켜지 않은 입력창은 이미지 마크다운을 글자로 둔다', () => {
    const doc = bodyToDoc(`![a](${IMG})`, []);
    expect(doc.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: `![a](${IMG})` }] });
  });

  it('업로드 중(src 없음) 이미지는 저장 글에 나가지 않고, 이름의 대괄호는 지운다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: null, alt: '', uploadId: 'u1' } }] },
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG, alt: 'a[1].png' } }] },
      ],
    };
    expect(serializeToBody(doc)).toBe(`\n![a1.png](${IMG})`);
  });
});
