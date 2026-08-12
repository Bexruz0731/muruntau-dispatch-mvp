import { useState } from 'react';
import { chatWithWorkspace } from '../lib/anythingllm';

const VARIANTS = {
  dark: {
    button: 'text-blue-400 hover:text-blue-300 disabled:text-slate-500',
    result: 'text-slate-300 bg-slate-800/60 border border-slate-700',
    error: 'text-red-400',
  },
  light: {
    button: 'text-blue-600 hover:text-blue-700 disabled:text-slate-400',
    result: 'text-slate-700 bg-slate-50 border border-slate-200',
    error: 'text-red-600',
  },
};

// Кнопка одного из трёх LLM-сценариев (объяснение решения, сводка отчёта,
// объяснение причины аномалии) — idle -> loading -> результат/ошибка.
// buildPrompt вызывается лениво, только по клику (не на каждый рендер),
// чтобы не пересчитывать промпт впустую, пока кнопку не нажали.
export default function ExplainButton({ workspaceSlug, buildPrompt, label = 'Объяснить', variant = 'dark' }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [text, setText] = useState('');
  const styles = VARIANTS[variant];

  async function handleClick() {
    setState('loading');
    const result = await chatWithWorkspace(workspaceSlug, buildPrompt());
    if (result.ok) {
      setText(result.text);
      setState('done');
    } else {
      setState('error');
    }
  }

  if (state === 'done') {
    return <div className={`mt-1 text-[11px] rounded px-2 py-1 ${styles.result}`}>{text}</div>;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`mt-1 text-[11px] font-medium ${state === 'error' ? styles.error : styles.button}`}
    >
      {state === 'loading' ? 'Спрашиваю ИИ…' : state === 'error' ? 'ИИ-сервис недоступен — повторить' : label}
    </button>
  );
}
