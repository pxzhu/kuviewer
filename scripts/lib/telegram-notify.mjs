import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const validTokenSources = new Set(['TELEGRAM_BOT_TOKEN_TWO', 'TELEGRAM_BOT_TOKEN']);
const validTelegramMethods = new Set(['getUpdates', 'sendMessage', 'sendPhoto']);

export function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    chatId: '',
    help: false,
    messageFile: '',
    photo: '',
    preflight: false,
    requireExplicitChat: false,
    requireTokenSource: '',
    resolveChat: false,
    text: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--preflight') {
      parsed.preflight = true;
    } else if (arg === '--chat-id') {
      parsed.chatId = requiredArgumentValue(argv, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--message-file') {
      parsed.messageFile = requiredArgumentValue(argv, index, arg);
      index += 1;
    } else if (arg === '--photo') {
      parsed.photo = requiredArgumentValue(argv, index, arg);
      index += 1;
    } else if (arg === '--require-explicit-chat') {
      parsed.requireExplicitChat = true;
    } else if (arg === '--require-token-source') {
      parsed.requireTokenSource = requiredArgumentValue(argv, index, arg);
      index += 1;
    } else if (arg === '--resolve-chat') {
      parsed.resolveChat = true;
    } else if (arg === '--text') {
      parsed.text = requiredArgumentValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function resolveTelegramToken(env) {
  const preferredToken = normalizeTelegramTokenValue(env.TELEGRAM_BOT_TOKEN_TWO);
  if (preferredToken) {
    return { token: preferredToken, tokenSource: 'TELEGRAM_BOT_TOKEN_TWO' };
  }
  const fallbackToken = normalizeTelegramTokenValue(env.TELEGRAM_BOT_TOKEN);
  if (fallbackToken) {
    return { token: fallbackToken, tokenSource: 'TELEGRAM_BOT_TOKEN' };
  }
  return { token: '', tokenSource: '' };
}

export function resolveExplicitChatId(options, env) {
  const cliChatId = normalizeEnvironmentValue(options.chatId);
  if (cliChatId) {
    return { explicitChatId: normalizeTelegramChatId(cliChatId, 'cli'), explicitChatIdSource: 'cli' };
  }
  const envChatId = normalizeEnvironmentValue(env.TELEGRAM_CHAT_ID || env.TELEGRAM_TO || env.TELEGRAM_CHAT_ID_KUVIEWER);
  if (envChatId) {
    return { explicitChatId: normalizeTelegramChatId(envChatId, 'environment'), explicitChatIdSource: 'env' };
  }
  return { explicitChatId: '', explicitChatIdSource: '' };
}

export function validateRequiredTokenSource(requiredTokenSource) {
  if (requiredTokenSource && !validTokenSources.has(requiredTokenSource)) {
    throw new Error('Invalid --require-token-source. Use TELEGRAM_BOT_TOKEN_TWO or TELEGRAM_BOT_TOKEN.');
  }
}

export function validateTelegramToken(token, tokenSource) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) {
    const safeSource = validTokenSources.has(tokenSource) ? tokenSource : 'environment';
    throw new Error(`Invalid Telegram bot token format from ${safeSource}.`);
  }
}

export function buildTelegramPreflightReport(options, context) {
  const hasUsableChat = context.hasExplicitChatId || (!options.requireExplicitChat && (!options.resolveChat || context.hasInferredChat));
  return {
    ok: context.hasToken && context.tokenSourceMatches && hasUsableChat,
    preflight: true,
    hasToken: context.hasToken,
    tokenSource: context.tokenSource,
    requiredTokenSource: options.requireTokenSource,
    tokenSourceMatches: context.tokenSourceMatches,
    hasExplicitChatId: context.hasExplicitChatId,
    hasInferredChat: context.hasInferredChat,
    chatResolveError: context.chatResolveError,
    chatIdSource: context.chatIdSource,
    wouldUseGetUpdates: !context.hasExplicitChatId,
    requiresExplicitChatId: options.requireExplicitChat,
    resolvedChat: options.resolveChat,
    sendMode: options.photo ? 'photo' : context.textLength > 0 ? 'message' : 'none',
    textLength: context.textLength,
    hasPhoto: Boolean(options.photo),
  };
}

export function buildTelegramDryRunReport(options, context) {
  const ok = context.tokenSourceMatches && (!options.requireExplicitChat || context.hasExplicitChatId);
  return {
    ok,
    dryRun: true,
    hasToken: context.hasToken,
    tokenSource: context.tokenSource,
    requiredTokenSource: options.requireTokenSource,
    tokenSourceMatches: context.tokenSourceMatches,
    hasExplicitChatId: context.hasExplicitChatId,
    chatIdSource: context.chatIdSource,
    wouldUseGetUpdates: !context.hasExplicitChatId,
    requiresExplicitChatId: options.requireExplicitChat,
    textLength: context.textLength,
    hasPhoto: Boolean(options.photo),
  };
}

export function telegramFailureCode(method, status, payload = {}) {
  const safeMethod = validTelegramMethods.has(method) ? method : 'request';
  const candidate = Number.isInteger(payload.error_code) ? payload.error_code : status;
  const safeStatus = Number.isInteger(candidate) && candidate >= 100 && candidate <= 599 ? candidate : 500;
  return `telegram_${safeMethod}_failed:${safeStatus}`;
}

export function safeTelegramCliError(error) {
  const message = error instanceof Error ? error.message : '';
  if (/^(Unknown argument: --[a-z0-9-]+|Missing value for --[a-z0-9-]+|Invalid Telegram chat id from (cli|environment)\.|Invalid Telegram bot token format from (TELEGRAM_BOT_TOKEN_TWO|TELEGRAM_BOT_TOKEN|environment)\.|Invalid --require-token-source\. Use TELEGRAM_BOT_TOKEN_TWO or TELEGRAM_BOT_TOKEN\.|telegram_(getUpdates|sendMessage|sendPhoto|request)_(unavailable|failed:\d{3}))$/.test(message)) {
    return message;
  }
  return 'telegram_notification_failed';
}

export async function readMessageText(options) {
  if (options.messageFile) {
    return (await readFile(options.messageFile, 'utf8')).trim();
  }
  return options.text.trim();
}

export async function inferChatId(botToken) {
  const response = await telegramFetch(botToken, 'getUpdates');
  const updates = Array.isArray(response.result) ? response.result : [];
  const latestChat = updates
    .map((update) => update.message?.chat || update.channel_post?.chat || update.edited_message?.chat)
    .filter((chat) => chat && typeof chat.id !== 'undefined')
    .pop();
  return latestChat ? String(latestChat.id) : '';
}

export async function sendMessage(botToken, chatId, text) {
  await telegramFetch(botToken, 'sendMessage', {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      text,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function sendPhoto(botToken, chatId, photoPath, caption) {
  const photoBytes = await readFile(photoPath);
  const form = new FormData();
  form.append('chat_id', chatId);
  if (caption) {
    form.append('caption', caption);
  }
  form.append('photo', new Blob([photoBytes], { type: mediaTypeForPath(photoPath) }), path.basename(photoPath));
  await telegramFetch(botToken, 'sendPhoto', { body: form, method: 'POST' });
}

export function mediaTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  return 'image/png';
}

export function truncateTelegramMessage(text) {
  return text.length > 3900 ? `${text.slice(0, 3890)}\n...(truncated)` : text;
}

export function truncateTelegramCaption(text) {
  return text.length > 1000 ? `${text.slice(0, 990)}\n...(truncated)` : text;
}

async function telegramFetch(botToken, method, init = {}) {
  const safeMethod = validTelegramMethods.has(method) ? method : 'request';
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, init);
  } catch {
    throw new Error(`telegram_${safeMethod}_unavailable`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(telegramFailureCode(method, response.status, payload));
  }
  return payload;
}

function requiredArgumentValue(argv, index, argumentName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argumentName}`);
  return value;
}

function normalizeEnvironmentValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTelegramTokenValue(value) {
  const normalized = normalizeEnvironmentValue(value);
  const wrappers = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (const [open, close] of wrappers) {
    if (normalized.startsWith(open) && normalized.endsWith(close)) {
      return normalized.slice(open.length, -close.length).trim();
    }
  }
  return normalized;
}

function normalizeTelegramChatId(value, source) {
  if (!/^-?\d{1,20}$/.test(value)) throw new Error(`Invalid Telegram chat id from ${source}.`);
  return value;
}
