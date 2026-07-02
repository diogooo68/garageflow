// Wrapper LLM. Devolve JSON estruturado de forma fiavel.
import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openai.key });

// Chamada que devolve texto simples.
export async function complete(system: string, user: string, temperature = 0.7): Promise<string> {
  const res = await client.chat.completions.create({
    model: config.openai.model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? '';
}

// Chamada que devolve JSON (usa response_format json_object).
export async function completeJSON<T = any>(system: string, user: string, temperature = 0.4): Promise<T> {
  const res = await client.chat.completions.create({
    model: config.openai.model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system + '\n\nResponde SEMPRE com um objeto JSON valido.' },
      { role: 'user', content: user },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as T;
}
