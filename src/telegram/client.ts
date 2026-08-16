import { config } from "../config";
import { excerpt, TELEGRAM_EXCERPT_LENGTH, normalizeText } from "../text";
import type { Article } from "../types";

export async function publishToTelegram(
  token: string,
  chatId: string,
  article: Article,
  language: string,
): Promise<number> {
  const siteUrl = `${config.site.url}/${language}/article/${article.id}`;
  const text = [
    `<b>${escapeHtml(normalizeText(article.title))}</b>`,
    "",
    escapeHtml(excerpt(article.summary, TELEGRAM_EXCERPT_LENGTH)),
    "",
    `<a href="${escapeHtml(article.url)}">Источник: ${escapeHtml(normalizeText(article.source))}</a> · <a href="${escapeHtml(siteUrl)}">Читать на сайте</a>`,
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}: ${await response.text()}`);
  const result = await response.json<{ ok: boolean; result?: { message_id: number } }>();
  if (!result.ok || !result.result) throw new Error("Telegram did not return message id");
  return result.result.message_id;
}

export function verifyTelegramSecret(request: Request, secret?: string): boolean {
  return !secret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") === secret;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
