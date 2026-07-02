import { describe, expect, it, vi } from 'vitest';
import { mockPatApiClient as mockClient } from './test-support.js';
import { buildMessagingTools } from './messaging.js';

describe('buildMessagingTools', () => {
  it('list_channels → client.listChannels()', async () => {
    const c = mockClient();
    (c.listChannels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: '일반' }]);
    const t = buildMessagingTools(c).find((x) => x.name === 'list_channels')!;
    const out = await t.handler({});
    expect(c.listChannels).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ id: 1, name: '일반' }]);
  });

  it('get_channel_messages → limit 기본값 30 으로 client.getChannelMessages 호출', async () => {
    const c = mockClient();
    (c.getChannelMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, body: 'hi' }]);
    const t = buildMessagingTools(c).find((x) => x.name === 'get_channel_messages')!;
    const out = await t.handler({ channelId: 7 });
    expect(c.getChannelMessages).toHaveBeenCalledWith(7, 30);
    expect(JSON.parse(out)).toEqual([{ id: 1, body: 'hi' }]);
  });

  it('get_channel_messages → limit 지정 시 그대로 전달', async () => {
    const c = mockClient();
    const t = buildMessagingTools(c).find((x) => x.name === 'get_channel_messages')!;
    await t.handler({ channelId: 7, limit: 5 });
    expect(c.getChannelMessages).toHaveBeenCalledWith(7, 5);
  });

  it('add_channel_message → client.addChannelMessage(channelId, body) 후 ok 반환', async () => {
    const c = mockClient();
    const t = buildMessagingTools(c).find((x) => x.name === 'add_channel_message')!;
    const out = await t.handler({ channelId: 7, body: '안녕하세요' });
    expect(c.addChannelMessage).toHaveBeenCalledWith(7, '안녕하세요');
    expect(out).toBe('ok');
  });

  it('add_channel_message 는 body 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildMessagingTools(c).find((x) => x.name === 'add_channel_message')!;
    await expect(t.handler({ channelId: 7 })).rejects.toThrow();
    expect(c.addChannelMessage).not.toHaveBeenCalled();
  });
});
