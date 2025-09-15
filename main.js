// main.js — Cloudflare Pages Functions compatible Telegram bot
// All interactions via inline keyboards only. Uses KV binding: BOT_KV.

const getToken = (env) => env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
const apiBase = (env) => `https://api.telegram.org/bot${getToken(env)}/`;

async function tg(env, method, payload) {
  const res = await fetch(apiBase(env) + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    console.error('Telegram API error', method, data);
  }
  return data;
}

// ---------- UI: Inline Keyboards ----------
function mainMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: 'خرید / ارتقا اکانت', callback_data: 'action:buy' },
      ],
      [
        { text: 'وضعیت اکانت', callback_data: 'menu:status' },
        { text: 'تنظیمات', callback_data: 'menu:settings' },
      ],
      [
        { text: 'راهنما', callback_data: 'menu:help' },
      ],
    ],
  };
}

function backToMainButton() {
  return { inline_keyboard: [[{ text: 'بازگشت به منوی اصلی', callback_data: 'menu:main' }]] };
}

// ---------- Views (Texts) ----------
const TEXTS = {
  welcome: 'سلام! لطفاً از دکمه‌های زیر استفاده کنید. پیام تایپی پذیرفته نمی‌شود.',
  main: 'به منوی اصلی خوش آمدید. یکی از گزینه‌ها را انتخاب کنید:',
  help: 'راهنما:\n- فقط با دکمه‌ها کار کنید.\n- اگر سؤالی دارید از بخش پشتیبانی/راهنما استفاده کنید.',
  status: 'وضعیت اکانت شما:',
  settings: 'تنظیمات ربات:',
  buy: 'برای خرید/ارتقا اکانت از گزینه‌های زیر استفاده کنید.',
  textOnlyButtons: 'این ربات فقط با دکمه‌های شیشه‌ای کار می‌کند. لطفاً از دکمه‌های زیر استفاده کنید.',
};

// ---------- Minimal User State in KV ----------
const KV_PREFIX = 'user:';

async function getUserState(env, userId) {
  try {
    const raw = await env.BOT_KV.get(KV_PREFIX + userId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setUserState(env, userId, state) {
  try {
    await env.BOT_KV.put(KV_PREFIX + userId, JSON.stringify(state));
  } catch (e) {
    console.error('KV put error', e);
  }
}

// ---------- Handlers ----------
async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  if (userId) {
    const state = await getUserState(env, userId);
    if (!state.first_seen_at) {
      state.first_seen_at = Date.now();
      await setUserState(env, userId, state);
    }
  }
  // Ignore text content; always present main menu
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: TEXTS.welcome + '\n\n' + TEXTS.main,
    reply_markup: mainMenuMarkup(),
    parse_mode: 'HTML',
  });
}

async function handleCallback(env, cq) {
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const userId = cq.from?.id;

  // Always answer callback first (prevents loading spinner)
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });

  // Persist last action in KV for simple state history
  if (userId) {
    const state = await getUserState(env, userId);
    state.last_action = data;
    state.last_action_at = Date.now();
    await setUserState(env, userId, state);
  }

  // Route by callback_data
  if (data === 'menu:main') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: TEXTS.main,
      reply_markup: mainMenuMarkup(),
      parse_mode: 'HTML',
    });
  }

  if (data === 'menu:help') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: TEXTS.help,
      reply_markup: backToMainButton(),
      parse_mode: 'HTML',
    });
  }

  if (data === 'menu:status') {
    // Example: render simple status from KV
    let statusLine = 'شناسه کاربری شما ثبت شد.';
    if (userId) {
      const state = await getUserState(env, userId);
      const since = state.first_seen_at ? new Date(state.first_seen_at).toLocaleString('fa-IR') : 'نامشخص';
      statusLine = `شناسه: <code>${userId}</code>\nاولین ورود: <b>${since}</b>`;
    }
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `${TEXTS.status}\n\n${statusLine}`,
      reply_markup: backToMainButton(),
      parse_mode: 'HTML',
    });
  }

  if (data === 'menu:settings') {
    // You can expand with more setting buttons
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: TEXTS.settings,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'اعلان‌ها: روشن/خاموش', callback_data: 'action:toggle:notify' }],
          [{ text: 'زبان: فارسی', callback_data: 'action:set:lang:fa' }],
          [{ text: 'بازگشت', callback_data: 'menu:main' }],
        ],
      },
      parse_mode: 'HTML',
    });
  }

  // Example actions (stub)
  if (data === 'action:buy') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: TEXTS.buy,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'پلن پایه', callback_data: 'action:plan:basic' }],
          [{ text: 'پلن حرفه‌ای', callback_data: 'action:plan:pro' }],
          [{ text: 'بازگشت', callback_data: 'menu:main' }],
        ],
      },
      parse_mode: 'HTML',
    });
  }

  if (data.startsWith('action:plan:')) {
    const plan = data.split(':').pop();
    // Implement your payment/link logic here
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `پلن انتخابی: <b>${plan}</b>\nبرای ادامه، لطفاً دستورالعمل پرداخت/لینک را دنبال کنید.`,
      reply_markup: backToMainButton(),
      parse_mode: 'HTML',
    });
  }

  if (data === 'action:toggle:notify') {
    if (userId) {
      const state = await getUserState(env, userId);
      state.notify = !state.notify;
      await setUserState(env, userId, state);
      return tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `اعلان‌ها: ${state.notify ? 'روشن' : 'خاموش'}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'بازگشت', callback_data: 'menu:main' }],
          ],
        },
        parse_mode: 'HTML',
      });
    }
  }

  if (data.startsWith('action:set:lang:')) {
    const lang = data.split(':').pop();
    if (userId) {
      const state = await getUserState(env, userId);
      state.lang = lang;
      await setUserState(env, userId, state);
    }
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `زبان تنظیم شد: <b>${lang}</b>`,
      reply_markup: backToMainButton(),
      parse_mode: 'HTML',
    });
  }

  // Fallback: go back to main
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: TEXTS.main,
    reply_markup: mainMenuMarkup(),
    parse_mode: 'HTML',
  });
}

async function handleUpdate(env, update) {
  try {
    if (update.message) {
      return await handleMessage(env, update.message);
    }
    if (update.callback_query) {
      return await handleCallback(env, update.callback_query);
    }
  } catch (e) {
    console.error('handleUpdate error', e);
  }
}

// ---------- Export Cloudflare-compatible app ----------
globalThis.APP = {
  // request: Request, env: Env, ctx: { waitUntil(fn) }
  async fetch(request, env, ctx) {
    // Health check or simple info on GET
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const info = {
        ok: true,
        name: 'Telegram Inline Keyboard Bot',
        time: new Date().toISOString(),
        path: url.pathname,
        kvBinding: !!env.BOT_KV,
        botToken: getToken(env) ? 'set' : 'missing',
      };
      return new Response(JSON.stringify(info, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // Telegram webhook (POST)
    if (request.method === 'POST') {
      if (!getToken(env)) {
        return new Response('Missing TELEGRAM_BOT_TOKEN', { status: 500 });
      }
      let update = null;
      try {
        update = await request.json();
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }
      // Process update (non-blocking)
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(handleUpdate(env, update));
      } else {
        // In some local/dev cases ctx might be missing
        await handleUpdate(env, update);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('Method Not Allowed', { status: 405 });
  },
};