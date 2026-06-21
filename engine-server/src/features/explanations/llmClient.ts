import type { LlmExplanationResponse } from './types.js';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export async function requestExplanationJson(prompt: string): Promise<LlmExplanationResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'あなたは将棋の作問補助者です。与えられたデータだけを根拠に、簡潔で自然な日本語の解説JSONを返します。',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${raw}`);
  }

  let parsed: unknown;
  try {
    const body = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty LLM response content');
    parsed = JSON.parse(extractJsonObject(content));
  } catch (error: any) {
    throw new Error(`failed to parse LLM JSON: ${error?.message ?? error}`);
  }

  return parsed as LlmExplanationResponse;
}
