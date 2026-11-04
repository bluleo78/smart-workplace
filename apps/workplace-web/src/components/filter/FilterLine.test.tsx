// FilterLine — 슬롯 순서·둘째 줄 생략·toolbar 역할 검증 (WP-1355)
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FilterLine } from './FilterLine';

describe('FilterLine', () => {
  it('role=toolbar 와 「필터」 라벨을 가진다', () => {
    render(<FilterLine keyword={<input aria-label="kw" />} />);
    expect(screen.getByRole('toolbar', { name: '필터' })).toBeInTheDocument();
  });

  it('keyword 가 DOM 첫째, 이어서 chips · end 순서다', () => {
    render(
      <FilterLine
        keyword={<input aria-label="kw" />}
        chips={<button>chip</button>}
        end={<button>end</button>}
      />,
    );
    const order = [screen.getByLabelText('kw'), screen.getByText('chip'), screen.getByText('end')];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('chips · end 가 모두 없으면(조건이 거짓인 슬롯을 undefined 로 넘긴 경우 포함) 둘째 줄을 그리지 않는다', () => {
    const showChips = false;
    const showEnd = false;
    render(
      <FilterLine
        keyword={<input aria-label="kw" />}
        chips={showChips ? <button>chip</button> : undefined}
        end={showEnd ? <button>end</button> : undefined}
      />,
    );
    expect(screen.getByRole('toolbar').children).toHaveLength(1);
    expect(screen.queryByTestId('filter-line-rest')).toBeNull();
  });

  it('chips 나 end 중 하나라도 있으면 둘째 줄을 그린다', () => {
    render(<FilterLine keyword={<input aria-label="kw" />} end={<button>end</button>} />);
    expect(screen.getByTestId('filter-line-rest')).toBeInTheDocument();
  });

  it('className · data-testid 는 가장 바깥 루트(@container)에 붙고, toolbar 는 그 안이다', () => {
    const { container } = render(<FilterLine keyword={<input />} className="mb-2" data-testid="fl" />);
    const root = container.firstElementChild!;
    expect(root).toBe(screen.getByTestId('fl'));
    expect(root).toHaveClass('mb-2', '@container');
    expect(screen.getByRole('toolbar')).not.toHaveClass('mb-2');
    expect(root).toContainElement(screen.getByRole('toolbar'));
  });

  it('chips 만 있어도 둘째 줄을 그리고 end 래퍼(ml-auto)는 없다', () => {
    render(<FilterLine keyword={<input />} chips={<button>chip</button>} />);
    const rest = screen.getByTestId('filter-line-rest');
    expect(rest.querySelector('.ml-auto')).toBeNull();
  });

  it('chips 가 0 이면 「0」 을 그리지 않고 둘째 줄도 없다', () => {
    render(<FilterLine keyword={<input />} chips={0} />);
    expect(screen.queryByTestId('filter-line-rest')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('반응형 클래스 계약: 키워드 @2xl:w-64·모바일 max-w-none, 둘째 줄 가로 스크롤', () => {
    render(<FilterLine keyword={<input aria-label="kw" />} chips={<button>chip</button>} />);
    const kw = screen.getByLabelText('kw').parentElement!;
    expect(kw.className).toContain('@2xl:w-64');
    expect(kw.className).toContain('[&>*]:max-w-none');
    expect(screen.getByTestId('filter-line-rest').querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('clear 슬롯은 스크롤 영역 밖, 줄 맨 끝(end 뒤)에 놓인다', () => {
    render(<FilterLine keyword={<input />} chips={<button>chip</button>} end={<button>end</button>} clear={<button>clr</button>} />);
    const clr = screen.getByText('clr');
    const rest = screen.getByTestId('filter-line-rest');
    expect(rest).toContainElement(clr);
    // 어떤 overflow-x-auto 요소 안에도 들어 있지 않다
    expect(clr.closest('.overflow-x-auto')).toBeNull();
    expect(screen.getByText('chip').closest('.overflow-x-auto')).not.toBeNull();
    expect(screen.getByTestId('filter-line-clear')).toHaveClass('shrink-0');
    // DOM(=Tab) 순서 chips → end → clear, 순서를 CSS order 로 바꾸지 않는다
    expect(screen.getByText('end').compareDocumentPosition(clr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('end').parentElement?.className).not.toMatch(/order-/);
  });

  it('clear 만 있어도 둘째 줄을 그리고, undefined 면 그리지 않는다', () => {
    const { rerender } = render(<FilterLine keyword={<input />} clear={<button>clr</button>} />);
    expect(screen.getByTestId('filter-line-rest')).toBeInTheDocument();
    rerender(<FilterLine keyword={<input />} clear={undefined} />);
    expect(screen.queryByTestId('filter-line-rest')).toBeNull();
  });

  it('줄바꿈 계약: toolbar @2xl:flex-wrap, chips 래퍼 @2xl:shrink-0·max-w-full, end ml-auto shrink-0', () => {
    render(<FilterLine keyword={<input />} chips={<button>chip</button>} end={<button>end</button>} />);
    expect(screen.getByRole('toolbar')).toHaveClass('@2xl:flex-wrap');
    const wrapper = screen.getByText('chip').closest('[class*="@2xl:relative"]') as HTMLElement;
    expect(wrapper).toHaveClass('@2xl:shrink-0', '@2xl:max-w-full');
    expect(screen.getByText('end').parentElement).toHaveClass('ml-auto', 'shrink-0');
  });

  it('키워드 칸이 chips 보다 먼저 줄어든다(@2xl:[flex-shrink:4], min-w-40)', () => {
    render(<FilterLine keyword={<input aria-label="kw" />} chips={<button>chip</button>} />);
    const kw = screen.getByLabelText('kw').parentElement!;
    expect(kw.className).toContain('@2xl:[flex-shrink:4]');
    expect(kw.className).toContain('@2xl:min-w-40');
  });

  describe('넘침 페이드', () => {
    const proto = HTMLElement.prototype;
    const orig = {
      sw: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
      cw: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
    };
    // 스크롤 영역(overflow-x-auto 클래스를 가진 요소)만 폭을 흉내 낸다
    const mockWidths = (scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(proto, 'scrollWidth', {
        configurable: true,
        get() {
          return (this as HTMLElement).className.includes('overflow-x-auto') ? scrollWidth : 0;
        },
      });
      Object.defineProperty(proto, 'clientWidth', {
        configurable: true,
        get() {
          return (this as HTMLElement).className.includes('overflow-x-auto') ? clientWidth : 0;
        },
      });
    };
    afterEach(() => {
      if (orig.sw) Object.defineProperty(proto, 'scrollWidth', orig.sw);
      else delete (proto as unknown as Record<string, unknown>).scrollWidth;
      if (orig.cw) Object.defineProperty(proto, 'clientWidth', orig.cw);
      else delete (proto as unknown as Record<string, unknown>).clientWidth;
    });

    it('넘치지 않으면 페이드가 없다', () => {
      mockWidths(300, 300);
      render(<FilterLine keyword={<input />} chips={<button>chip</button>} />);
      expect(screen.queryByTestId('filter-line-chips-fade')).toBeNull();
      expect(screen.queryByTestId('filter-line-rest-fade')).toBeNull();
    });

    it('넘치면 페이드가 있고(pointer-events-none·aria-hidden), 끝까지 스크롤하면 사라진다', () => {
      mockWidths(500, 300);
      render(<FilterLine keyword={<input />} chips={<button>chip</button>} />);
      const fade = screen.getByTestId('filter-line-chips-fade');
      expect(fade).toHaveClass('pointer-events-none');
      expect(fade).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByTestId('filter-line-rest-fade')).toBeInTheDocument();
      // 끝(200 + 300 = 500)까지 스크롤
      const scroller = screen.getByText('chip').closest('[class*="@2xl:overflow-x-auto"]') as HTMLElement;
      scroller.scrollLeft = 200;
      fireEvent.scroll(scroller);
      expect(screen.queryByTestId('filter-line-chips-fade')).toBeNull();
    });
  });
});
