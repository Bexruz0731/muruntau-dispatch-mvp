import { useState } from 'react';
import { chatWithWorkspace, resolveWorkspaceSlug, WORKSPACE_DOCS_SLUG, WORKSPACE_DISPATCH_SLUG } from '../lib/anythingllm';

const DOCS_WORKSPACE_SLUG = resolveWorkspaceSlug(WORKSPACE_DOCS_SLUG, WORKSPACE_DISPATCH_SLUG);

export default function AssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    setMessages((m) => [...m, { role: 'user', text, sources: [] }]);
    setInput('');
    setPending(true);

    const result = await chatWithWorkspace(DOCS_WORKSPACE_SLUG, text);
    setMessages((m) => [
      ...m,
      result.ok
        ? { role: 'assistant', text: result.text, sources: result.sources }
        : { role: 'assistant', text: 'ИИ-сервис недоступен, попробуйте позже.', sources: [] },
    ]);
    setPending(false);
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col p-4 max-w-3xl mx-auto">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && !pending && (
          <div className="text-sm text-slate-400">Задайте вопрос по технической документации.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'
              }`}
            >
              <div>{m.text}</div>
              {m.sources.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-400">
                  Источники: {m.sources.map((s) => s.title ?? s.name ?? 'документ').join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="text-sm text-slate-400">ИИ печатает…</div>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Введите вопрос…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:bg-slate-300"
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
