// Единая точка входа в локальный AnythingLLM API — используется во всех
// четырёх LLM-сценариях (объяснение решения диспетчера, RAG-запрос нормы
// топлива, сводка по отчёту, объяснение причины аномалии) и на странице
// чата-ассистента. Любая сетевая ошибка/таймаут/не-200 ответ перехватываются
// внутри и НИКОГДА не выбрасываются наружу — вызывающему коду достаточно
// проверить result.ok, try/catch не нужен (ТЗ, раздел "Интеграция AnythingLLM").
export const ANYTHINGLLM_BASE_URL = 'http://localhost:3001';
export const DEFAULT_TIMEOUT_MS = 8000;

export const WORKSPACE_DOCS_SLUG = import.meta.env.VITE_ANYTHINGLLM_WORKSPACE_DOCS || null;
export const WORKSPACE_DISPATCH_SLUG = import.meta.env.VITE_ANYTHINGLLM_WORKSPACE_DISPATCH || null;
const API_KEY = import.meta.env.VITE_ANYTHINGLLM_API_KEY || '';

// Если задан только один из двух workspace slug — он используется для всех
// сценариев (ТЗ). preferred — обычно нужный по смыслу workspace,
// fallback — второй, на случай если сконфигурирован только он.
export function resolveWorkspaceSlug(preferred, fallback) {
  return preferred || fallback || null;
}

// POST /api/v1/workspace/{slug}/chat. fetchImpl — точка внедрения для
// тестов (по умолчанию — глобальный fetch, доступный и в браузере, и в
// Node 18+, на котором реально выполняется vitest).
export async function chatWithWorkspace(slug, message, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!slug) {
    return { ok: false, error: 'no-workspace-configured', text: null, sources: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/${slug}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, mode: 'chat' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `http-${res.status}`, text: null, sources: [] };
    }

    const data = await res.json();
    return {
      ok: true,
      error: null,
      text: data.textResponse ?? data.text ?? '',
      sources: data.sources ?? data.citations ?? [],
    };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return { ok: false, error: isTimeout ? 'timeout' : 'network', text: null, sources: [] };
  } finally {
    clearTimeout(timer);
  }
}
