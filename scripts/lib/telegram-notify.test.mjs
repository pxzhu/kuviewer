import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramDryRunReport,
  buildTelegramPreflightReport,
  mediaTypeForPath,
  parseArgs,
  resolveExplicitChatId,
  resolveTelegramToken,
  safeTelegramCliError,
  telegramFailureCode,
  truncateTelegramCaption,
  truncateTelegramMessage,
  validateRequiredTokenSource,
  validateTelegramToken,
} from './telegram-notify.mjs';

test('Telegram CLI parsing rejects unknown or missing values', () => {
  assert.deepEqual(parseArgs(['--preflight', '--require-token-source', 'TELEGRAM_BOT_TOKEN_TWO']), {
    dryRun: false,
    chatId: '',
    help: false,
    messageFile: '',
    photo: '',
    preflight: true,
    requireExplicitChat: false,
    requireTokenSource: 'TELEGRAM_BOT_TOKEN_TWO',
    resolveChat: false,
    text: '',
  });
  assert.throws(() => parseArgs(['--text']), /Missing value for --text/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument: --unknown/);
  assert.throws(() => validateRequiredTokenSource('UNSAFE_TOKEN_SOURCE'), /Invalid --require-token-source/);
});

test('preferred Telegram token selection trims wrappers and validates format', () => {
  const preferredToken = ['123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'].join(':');
  const fallbackToken = ['987654321', 'abcdefghijklmnopqrstuvwxyzABCDEF'].join(':');
  assert.deepEqual(resolveTelegramToken({ TELEGRAM_BOT_TOKEN_TWO: `  “${preferredToken}”  `, TELEGRAM_BOT_TOKEN: fallbackToken }), {
    token: preferredToken,
    tokenSource: 'TELEGRAM_BOT_TOKEN_TWO',
  });
  assert.deepEqual(resolveTelegramToken({ TELEGRAM_BOT_TOKEN_TWO: '   ', TELEGRAM_BOT_TOKEN: ` '${fallbackToken}' ` }), {
    token: fallbackToken,
    tokenSource: 'TELEGRAM_BOT_TOKEN',
  });
  assert.deepEqual(resolveTelegramToken({}), { token: '', tokenSource: '' });
  assert.doesNotThrow(() => validateTelegramToken(preferredToken, 'TELEGRAM_BOT_TOKEN_TWO'));
  assert.throws(() => validateTelegramToken('unsafe/token', 'TELEGRAM_BOT_TOKEN_TWO'), /Invalid Telegram bot token format/);
});

test('explicit Telegram chat ids use CLI precedence and reject unsafe values', () => {
  assert.deepEqual(resolveExplicitChatId({ chatId: ' 123456 ' }, { TELEGRAM_CHAT_ID: '-999' }), {
    explicitChatId: '123456',
    explicitChatIdSource: 'cli',
  });
  assert.deepEqual(resolveExplicitChatId({ chatId: '' }, { TELEGRAM_CHAT_ID: ' -999 ' }), {
    explicitChatId: '-999',
    explicitChatIdSource: 'env',
  });
  assert.throws(() => resolveExplicitChatId({ chatId: 'chat-name' }, {}), /Invalid Telegram chat id from cli/);
  assert.throws(() => resolveExplicitChatId({ chatId: '' }, { TELEGRAM_CHAT_ID: '1;rm' }), /Invalid Telegram chat id from environment/);
});

test('Telegram reports contain safe readiness metadata only', () => {
  const options = {
    photo: '/private/tmp/current-screen.png',
    requireExplicitChat: true,
    requireTokenSource: 'TELEGRAM_BOT_TOKEN_TWO',
    resolveChat: false,
  };
  const context = {
    hasToken: true,
    tokenSource: 'TELEGRAM_BOT_TOKEN_TWO',
    tokenSourceMatches: true,
    hasExplicitChatId: true,
    hasInferredChat: false,
    chatResolveError: '',
    chatIdSource: 'env',
    textLength: 42,
  };
  const preflight = buildTelegramPreflightReport(options, context);
  const dryRun = buildTelegramDryRunReport(options, context);
  assert.equal(preflight.ok, true);
  assert.equal(preflight.hasPhoto, true);
  assert.equal(dryRun.ok, true);
  assert.equal(JSON.stringify({ preflight, dryRun }).includes('current-screen.png'), false);
  assert.equal('token' in preflight, false);
  assert.equal('chatId' in preflight, false);
});

test('Telegram API failure codes never include remote descriptions or credentials', () => {
  const remoteDescription = `request rejected for ${['123456789', 'not-a-real-secret-value'].join(':')}`;
  const code = telegramFailureCode('sendMessage', 400, { error_code: 403, description: remoteDescription });
  assert.equal(code, 'telegram_sendMessage_failed:403');
  assert.equal(code.includes(remoteDescription), false);
  assert.equal(safeTelegramCliError(new Error(code)), code);
  assert.equal(safeTelegramCliError(new Error(remoteDescription)), 'telegram_notification_failed');
});

test('Telegram media and length limits remain bounded', () => {
  assert.equal(mediaTypeForPath('screen.JPG'), 'image/jpeg');
  assert.equal(mediaTypeForPath('screen.webp'), 'image/webp');
  assert.equal(mediaTypeForPath('screen.png'), 'image/png');
  assert.ok(truncateTelegramMessage('m'.repeat(5000)).length <= 3905);
  assert.ok(truncateTelegramCaption('c'.repeat(2000)).length <= 1005);
});
