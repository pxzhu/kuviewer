import {
  buildTelegramDryRunReport,
  buildTelegramPreflightReport,
  inferChatId,
  parseArgs,
  readMessageText,
  resolveExplicitChatId,
  resolveTelegramToken,
  safeTelegramCliError,
  sendMessage,
  sendPhoto,
  truncateTelegramCaption,
  truncateTelegramMessage,
  validateRequiredTokenSource,
  validateTelegramToken,
} from './lib/telegram-notify.mjs';

await main().catch((error) => fail(safeTelegramCliError(error)));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  validateRequiredTokenSource(args.requireTokenSource);
  const { token, tokenSource } = resolveTelegramToken(process.env);
  if (token) validateTelegramToken(token, tokenSource);
  const { explicitChatId, explicitChatIdSource } = resolveExplicitChatId(args, process.env);
  const tokenSourceMatches = !args.requireTokenSource || tokenSource === args.requireTokenSource;

  if (args.preflight) {
    await runPreflight(args, {
      explicitChatId,
      explicitChatIdSource,
      token,
      tokenSource,
      tokenSourceMatches,
    });
  }

  if (!token) fail('TELEGRAM_BOT_TOKEN is required');
  if (!tokenSourceMatches) {
    fail(`Required Telegram token source unavailable. Expected ${args.requireTokenSource}, found ${tokenSource || 'none'}.`);
  }

  const messageText = await readMessageText(args);
  if (!messageText && !args.photo) fail('Provide --text, --message-file, or --photo');

  if (args.dryRun) {
    runDryRun(args, {
      explicitChatId,
      explicitChatIdSource,
      messageText,
      tokenSource,
      tokenSourceMatches,
    });
  }

  if (args.requireExplicitChat && !explicitChatId) {
    fail('Explicit Telegram chat id required. Set --chat-id, TELEGRAM_CHAT_ID, TELEGRAM_TO, or TELEGRAM_CHAT_ID_KUVIEWER.');
  }

  const chatId = explicitChatId || await inferChatId(token);
  if (!chatId) fail('Telegram chat id not found. Set TELEGRAM_CHAT_ID or send a message to the bot so getUpdates can infer it.');

  if (args.photo) {
    await sendPhoto(token, chatId, args.photo, truncateTelegramCaption(messageText));
    printJson({ ok: true, sent: 'photo', chatIdSource: explicitChatIdSource || 'getUpdates' });
  } else {
    await sendMessage(token, chatId, truncateTelegramMessage(messageText));
    printJson({ ok: true, sent: 'message', chatIdSource: explicitChatIdSource || 'getUpdates' });
  }
}

async function runPreflight(options, context) {
  const preflightText = options.messageFile || options.text ? await readMessageText(options) : '';
  let inferredChatAvailable = false;
  let chatResolveError = '';
  if (context.token && options.resolveChat && !context.explicitChatId) {
    try {
      inferredChatAvailable = Boolean(await inferChatId(context.token));
    } catch {
      chatResolveError = 'telegram_getUpdates_unavailable';
    }
  }

  const report = buildTelegramPreflightReport(options, {
    hasToken: Boolean(context.token),
    tokenSource: context.tokenSource,
    tokenSourceMatches: context.tokenSourceMatches,
    hasExplicitChatId: Boolean(context.explicitChatId),
    hasInferredChat: inferredChatAvailable,
    chatResolveError,
    chatIdSource: context.explicitChatIdSource || '',
    textLength: preflightText.length,
  });
  printJson(report);
  process.exit(report.ok ? 0 : 1);
}

function runDryRun(options, context) {
  const report = buildTelegramDryRunReport(options, {
    hasToken: true,
    tokenSource: context.tokenSource,
    tokenSourceMatches: context.tokenSourceMatches,
    hasExplicitChatId: Boolean(context.explicitChatId),
    chatIdSource: context.explicitChatIdSource || '',
    textLength: context.messageText.length,
  });
  printJson(report);
  process.exit(report.ok ? 0 : 1);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage:
  TELEGRAM_BOT_TOKEN_TWO=... TELEGRAM_CHAT_ID=... node scripts/notify-telegram.mjs --text "Done"
  TELEGRAM_BOT_TOKEN_TWO=... node scripts/notify-telegram.mjs --chat-id 123456 --text "Done"
  TELEGRAM_BOT_TOKEN_TWO=... node scripts/notify-telegram.mjs --message-file /tmp/summary.txt --photo /tmp/screenshot.png
  TELEGRAM_BOT_TOKEN_TWO=... node scripts/notify-telegram.mjs --preflight --require-explicit-chat
  TELEGRAM_BOT_TOKEN_TWO=... node scripts/notify-telegram.mjs --preflight --resolve-chat
  TELEGRAM_BOT_TOKEN_TWO=... node scripts/notify-telegram.mjs --preflight --require-token-source TELEGRAM_BOT_TOKEN_TWO

Environment:
  TELEGRAM_BOT_TOKEN_TWO          Preferred bot token. Never printed by this script.
  TELEGRAM_BOT_TOKEN              Fallback bot token. Never printed by this script.
  TELEGRAM_CHAT_ID                Optional. If missing, getUpdates is used.
  TELEGRAM_TO                     Optional chat id alias.
  TELEGRAM_CHAT_ID_KUVIEWER       Optional chat id alias.

Options:
  --preflight                    Check readiness without sending. Does not call Telegram unless --resolve-chat is set.
  --require-explicit-chat        Refuse getUpdates chat inference; require an explicit chat id.
  --require-token-source NAME    Refuse fallback tokens unless NAME matches TELEGRAM_BOT_TOKEN_TWO or TELEGRAM_BOT_TOKEN.
  --resolve-chat                 In preflight mode, call getUpdates and report only if a chat is available.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
