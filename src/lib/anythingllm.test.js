import { describe, it, expect, vi } from 'vitest';
import { chatWithWorkspace, resolveWorkspaceSlug, ANYTHINGLLM_BASE_URL } from './anythingllm';

function makeFetchResponse({ ok, status = 200, json }) {
  return { ok, status, json: async () => json };
}

describe('resolveWorkspaceSlug', () => {
  it('предпочитает переданный конкретный slug', () => {
    expect(resolveWorkspaceSlug('a', 'b')).toBe('a');
  });

  it('использует запасной slug, если конкретный не задан', () => {
    expect(resolveWorkspaceSlug(null, 'b')).toBe('b');
    expect(resolveWorkspaceSlug('', 'b')).toBe('b');
  });

  it('возвращает null, если оба не заданы', () => {
    expect(resolveWorkspaceSlug(null, undefined)).toBeNull();
  });
});

describe('chatWithWorkspace', () => {
  it('немедленно возвращает ok:false без сетевого запроса, если slug не задан', async () => {
    const fetchImpl = vi.fn();
    const result = await chatWithWorkspace(null, 'привет', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no-workspace-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('отправляет POST на верный URL с телом и заголовками, возвращает текст и источники при успехе', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({ ok: true, json: { textResponse: 'Ответ', sources: [{ title: 'doc.pdf' }] } }),
    );
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });

    expect(result).toEqual({ ok: true, error: null, text: 'Ответ', sources: [{ title: 'doc.pdf' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/my-slug/chat`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ message: 'вопрос', mode: 'chat' });
  });

  it('возвращает ok:false с кодом статуса при не-200 ответе', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeFetchResponse({ ok: false, status: 500, json: {} }));
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http-500');
  });

  it('возвращает ok:false при сетевой ошибке, не выбрасывая исключение', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network');
  });

  it('возвращает ok:false с error "timeout", если ответ не пришёл за timeoutMs, и не падает', async () => {
    vi.useFakeTimers();
    const fetchImpl = (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
    const promise = chatWithWorkspace('my-slug', 'вопрос', { fetchImpl, timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    vi.useRealTimers();
  });
});
