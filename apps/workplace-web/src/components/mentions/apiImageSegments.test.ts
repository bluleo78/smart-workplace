import { describe, expect, it } from 'vitest';

import { countApiImages, splitApiImages, withImagePlaceholders } from './apiImageSegments';
import { bodyToDoc, serializeToBody } from './mentionSerialize';

const IMG = '/api/v1/projects/WP/issue-images/12';

describe('splitApiImages', () => {
  it('이미지 앞뒤 줄바꿈 하나씩을 빼고 텍스트·이미지로 나눈다', () => {
    expect(splitApiImages(`버튼이 겹쳐요\n![a.png](${IMG})\n모바일`)).toEqual([
      { type: 'text', value: '버튼이 겹쳐요' },
      { type: 'image', src: IMG, alt: 'a.png' },
      { type: 'text', value: '모바일' },
    ]);
  });

  it('앱 API 경로가 아닌 이미지 마크다운은 글자로 둔다', () => {
    const text = '![x](https://example.com/a.png) ![y](javascript:alert(1))';
    expect(splitApiImages(text)).toEqual([{ type: 'text', value: text }]);
  });

  it('이미지 수를 세고 미리보기에서는 [이미지] 로 줄인다', () => {
    const text = `a ![p](${IMG}) b ![q](${IMG}9)`;
    expect(countApiImages(text)).toBe(2);
    expect(withImagePlaceholders(text)).toBe('a [이미지] b [이미지]');
  });
});

describe('이미지 노드 ↔ 저장 글 왕복', () => {
  it('이미지·멘션이 섞인 글을 문서로 복원했다가 같은 글로 저장한다', () => {
    const body = `<@3> 확인 부탁\n![shot.png](${IMG})\n끝`;
    const doc = bodyToDoc(body, [{ id: 3, name: '김AI', kind: 'AGENT' }], { images: true });
    expect(doc.content?.[1]).toEqual({ type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG, alt: 'shot.png' } }] });
    expect(serializeToBody(doc)).toBe(body);
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
