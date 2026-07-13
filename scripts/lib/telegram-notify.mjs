import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const validTokenSources = new Set(['TELEGRAM_BOT_TOKEN_TWO', 'TELEGRAM_BOT_TOKEN']);

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
      parsed.chatId = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--message-file') {
      parsed.messageFile = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--photo') {
      parsed.photo = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--require-explicit-chat') {
      parsed.requireExplicitChat = true;
    } else if (arg === '--require-token-source') {
      parsed.requireTokenSource = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--resolve-chat') {
      parsed.resolveChat = true;
    } else if (arg === '--text') {
      parsed.text = argv[index + 1] || '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function resolveTelegramToken(env) {
  if (env.TELEGRAM_BOT_TOKEN_TWO) {
    return { token: env.TELEGRAM_BOT_TOKEN_TWO, tokenSource: 'TELEGRAM_BOT_TOKEN_TWO' };
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    return { token: env.TELEGRAM_BOT_TOKEN, tokenSource: 'TELEGRAM_BOT_TOKEN' };
  }
  return { token: '', tokenSource: '' };
}

export function resolveExplicitChatId(options, env) {
  const envChatId = env.TELEGRAM_CHAT_ID || env.TELEGRAM_TO || env.TELEGRAM_CHAT_ID_KUVIEWER || '';
  if (options.chatId) {
    return { explicitChatId: options.chatId, explicitChatIdSource: 'cli' };
  }
  if (envChatId) {
    return { explicitChatId: envChatId, explicitChatIdSource: 'env' };
  }
  return { explicitChatId: '', explicitChatIdSource: '' };
}

export function validateRequiredTokenSource(requiredTokenSource) {
  if (requiredTokenSource && !validTokenSources.has(requiredTokenSource)) {
    throw new Error('Invalid --require-token-source. Use TELEGRAM_BOT_TOKEN_TWO or TELEGRAM_BOT_TOKEN.');
  }
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
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const description = typeof payload.description === 'string' ? payload.description : `HTTP ${response.status}`;
    throw new Error(`telegram_${method}_failed: ${description}`);
  }
  return payload;
}
