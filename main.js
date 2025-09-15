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
        { text: 'دریافت پروفایل', callback_data: 'profile:start' },
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

// ---------- Profile Builder Constants & Helpers ----------
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const APN_OPTIONS = [
  { value: 'mcinet', label: 'MCI' },
  { value: 'mtnirancell', label: 'Irancell' },
  { value: 'RighTel', label: 'RighTel' },
  { value: 'ApTel', label: 'ApTel' },
  { value: 'samantel', label: 'samantel' },
  { value: 'shatelmobile', label: 'SHATEL' },
];

const DEFAULT_EXCLUSIONS_BASE = ['localhost', '127.0.0.1'];
const DEFAULT_FALLBACK_CIDR = '169.254.0.0/16';
const DEFAULT_GOD_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '2.176.0.0/15',
  '2.190.0.0/15',
  '151.232.128.0/17',
  '5.208.0.0/16',
  '164.215.128.0/17',
  '46.143.0.0/17',
  '79.127.0.0/17',
  '46.209.128.0/18',
  '46.209.224.0/19',
  '46.209.64.0/19',
];

function generateUUIDv4() {
  // Cloudflare Workers supports crypto.getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20)
  );
}

async function tgForm(env, method, form) {
  const res = await fetch(apiBase(env) + method, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    console.error('Telegram API error (form)', method, data);
  }
  return data;
}

function renderApnKeyboard() {
  const rows = APN_OPTIONS.map((o) => [{ text: o.label, callback_data: `profile:apn:${o.value}` }]);
  rows.push([{ text: 'بازگشت', callback_data: 'menu:main' }]);
  return { inline_keyboard: rows };
}

function renderCidrKeyboard() {
  const rows = DEFAULT_GOD_CIDRS.map((c) => [{ text: c, callback_data: `profile:cidr:set:${c}` }]);
  rows.push([{ text: 'بازگشت', callback_data: 'profile:menu' }]);
  return { inline_keyboard: rows };
}

function renderProfileMenu(state) {
  const p = state.profile || {};
  const apn = p.apn || 'انتخاب نشده';
  const uuid = p.rootUUID || 'انتخاب نشده';
  const god = p.godMode ? 'فعال' : 'غیرفعال';
  const cidr = p.selectedCidr || DEFAULT_FALLBACK_CIDR;
  const text = `تنظیم پروفایل iOS\n\nاپراتور (APN): ${apn}\nUUID ریشه: ${uuid}\nGod Mode: ${god}\nCIDR: ${cidr}\n\nمراحل را تکمیل و سپس ساخت پروفایل را بزنید.`;
  const kb = {
    inline_keyboard: [
      [ { text: 'انتخاب اپراتور', callback_data: 'profile:apn' } ],
      [ { text: 'ساخت UUID', callback_data: 'profile:uuid:auto' }, { text: 'ثبت UUID دستی', callback_data: 'profile:uuid:ask' } ],
      [ { text: `God Mode: ${p.godMode ? 'خاموش' : 'روشن'}`, callback_data: 'profile:god:toggle' }, { text: 'انتخاب CIDR', callback_data: 'profile:cidr' } ],
      [ { text: 'ساخت و ارسال پروفایل', callback_data: 'profile:build' } ],
      [ { text: 'بازگشت به منو', callback_data: 'menu:main' } ],
    ],
  };
  return { text, kb };
}

function buildMobileconfig({ rootUUID, apn, selectedCidr }) {
  const exclusionListValues = [
    ...DEFAULT_EXCLUSIONS_BASE,
    selectedCidr && selectedCidr.includes('/') ? selectedCidr : DEFAULT_FALLBACK_CIDR,
  ];
  const gen = () => generateUUIDv4();
  const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>PayloadContent</key>
    <array>
        <!-- Cellular Settings -->
        <dict>
            <key>PayloadDisplayName</key>
            <string>Cellular</string>
            <key>PayloadIdentifier</key>
            <string>com.apple.cellular</string>
            <key>PayloadType</key>
            <string>com.apple.cellular</string>
            <key>PayloadUUID</key>
            <string>${gen()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>APNs</key>
            <array>
                <!-- First APN -->
                <dict>
                    <key>AllowedProtocolMask</key>
                    <integer>3</integer>
                    <key>AllowedProtocolMaskInDomesticRoaming</key>
                    <integer>3</integer>
                    <key>AllowedProtocolMaskInRoaming</key>
                    <integer>3</integer>
                    <key>AuthenticationType</key>
                    <string>PAP</string>
                    <key>DefaultProtocolMask</key>
                    <integer>3</integer>
                    <key>EnableXLAT464</key>
                    <true />
                    <key>Name</key>
                    <string>${apn}</string>
                    <key>ProxyServer</key>
                    <string></string>
                    <key>Username</key>
                    <string></string>
                </dict>
                <!-- Second APN -->
                <dict>
                    <key>AllowedProtocolMask</key>
                    <integer>1</integer>
                    <key>AllowedProtocolMaskInDomesticRoaming</key>
                    <integer>1</integer>
                    <key>AllowedProtocolMaskInRoaming</key>
                    <integer>1</integer>
                    <key>AuthenticationType</key>
                    <string>CHAP</string>
                    <key>DefaultProtocolMask</key>
                    <integer>1</integer>
                    <key>EnableXLAT464</key>
                    <true />
                    <key>Name</key>
                    <string>${apn}</string>
                    <key>Username</key>
                    <string></string>
                </dict>
            </array>
            <key>AttachAPN</key>
            <dict>
                <key>AllowedProtocolMask</key>
                <integer>3</integer>
                <key>AuthenticationType</key>
                <string>PAP</string>
                <key>Name</key>
                <string>${apn}</string>
                <key>Username</key>
                <string></string>
            </dict>
        </dict>

        <!-- VPN Settings -->
        <dict>
            <key>PayloadDisplayName</key>
            <string>VPN</string>
            <key>PayloadIdentifier</key>
            <string>com.apple.vpn.managed.${gen()}</string>
            <key>PayloadType</key>
            <string>com.apple.vpn.managed</string>
            <key>PayloadUUID</key>
            <string>${gen()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>UserDefinedName</key>
            <string>VPN Configuration</string>
            <key>VPNType</key>
            <string>IPSec</string>
            <key>IPSec</key>
            <dict>
                <key>AuthenticationMethod</key>
                <string>SharedSecret</string>
                <key>ExtendedAuthEnabled</key>
                <false/>
                <key>LocalIdentifier</key>
                <string>${apn}</string>
                <key>RemoteAddress</key>
                <string>vpn.example.com</string>
                <key>SharedSecret</key>
                <string>${gen()}</string>
                <key>XAuthEnabled</key>
                <false/>
                <key>XAuthName</key>
                <string>${apn}</string>
                <key>XAuthPassword</key>
                <string>${apn}</string>
            </dict>
        </dict>

        <!-- Proxy Settings -->
        <dict>
            <key>PayloadDisplayName</key>
            <string>Proxy</string>
            <key>PayloadIdentifier</key>
            <string>com.apple.proxy.${gen()}</string>
            <key>PayloadType</key>
            <string>com.apple.proxy</string>
            <key>PayloadUUID</key>
            <string>${gen()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>HTTPEnable</key>
            <false/>
            <key>HTTPPort</key>
            <integer>8080</integer>
            <key>HTTPSEnable</key>
            <false/>
            <key>HTTPSPort</key>
            <integer>8080</integer>
            <key>FTPEnable</key>
            <false/>
            <key>FTPPort</key>
            <integer>21</integer>
            <key>SOCKSEnable</key>
            <false/>
            <key>SOCKSPort</key>
            <integer>1080</integer>
            <key>Server</key>
            <string></string>
            <key>ExclusionList</key>
            <array>
${exclusionListValues.map((v) => `                <string>${v}</string>`).join('\n')}
            </array>
        </dict>

        <!-- Additional Settings -->
        <dict>
            <key>PayloadDisplayName</key>
            <string>Additional Settings</string>
            <key>PayloadIdentifier</key>
            <string>com.example.additionalsettings.${gen()}</string>
            <key>PayloadType</key>
            <string>Configuration</string>
            <key>PayloadUUID</key>
            <string>${gen()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadOrganization</key>
            <string>Github:AiGptCode</string>
            <key>PayloadRemovalDisallowed</key>
            <false/>
            <key>SignalBoostEnabled</key>
            <true/>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Configuration Profile</string>
    <key>PayloadIdentifier</key>
    <string>com.example.profile</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${rootUUID}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
`;
  return xml;
}

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
    // Handle awaiting UUID input for profile flow
    if (state.awaiting_uuid && typeof msg.text === 'string') {
      const text = (msg.text || '').trim();
      if (UUID_V4_REGEX.test(text)) {
        state.profile = state.profile || {};
        state.profile.rootUUID = text;
        state.awaiting_uuid = false;
        await setUserState(env, userId, state);
        const { text: pText, kb } = renderProfileMenu(state);
        await tg(env, 'sendMessage', { chat_id: chatId, text: 'UUID معتبر ثبت شد.', parse_mode: 'HTML' });
        return tg(env, 'sendMessage', { chat_id: chatId, text: pText, reply_markup: kb });
      } else {
        return tg(env, 'sendMessage', {
          chat_id: chatId,
          text: 'UUID نامعتبر است. یک UUID نسخه ۴ معتبر ارسال کنید یا لغو کنید.',
        });
      }
    }

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
  // ---- Profile Flow ----
  if (data === 'profile:start') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'ابتدا اپراتور (APN) خود را انتخاب کنید:',
      reply_markup: renderApnKeyboard(),
    });
  }

  if (data === 'profile:apn') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'اپراتور را انتخاب کنید:',
      reply_markup: renderApnKeyboard(),
    });
  }

  if (data.startsWith('profile:apn:')) {
    const apn = data.split(':').pop();
    if (userId) {
      const state = await getUserState(env, userId);
      state.profile = state.profile || {};
      state.profile.apn = apn;
      if (!state.profile.selectedCidr) state.profile.selectedCidr = DEFAULT_FALLBACK_CIDR;
      if (typeof state.profile.godMode !== 'boolean') state.profile.godMode = false;
      await setUserState(env, userId, state);
      const { text: pText, kb } = renderProfileMenu(state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: pText, reply_markup: kb });
    }
  }

  if (data === 'profile:uuid:auto') {
    if (userId) {
      const state = await getUserState(env, userId);
      state.profile = state.profile || {};
      state.profile.rootUUID = generateUUIDv4();
      state.awaiting_uuid = false;
      await setUserState(env, userId, state);
      const { text: pText, kb } = renderProfileMenu(state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: pText, reply_markup: kb });
    }
  }

  if (data === 'profile:uuid:ask') {
    if (userId) {
      const state = await getUserState(env, userId);
      state.awaiting_uuid = true;
      await setUserState(env, userId, state);
      return tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: 'لطفاً یک UUID نسخه ۴ معتبر ارسال کنید. برای لغو، از دکمه زیر استفاده کنید.',
        reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'profile:menu' }]] },
      });
    }
  }

  if (data === 'profile:menu') {
    if (userId) {
      const state = await getUserState(env, userId);
      state.awaiting_uuid = false;
      await setUserState(env, userId, state);
      const { text: pText, kb } = renderProfileMenu(state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: pText, reply_markup: kb });
    }
  }

  if (data === 'profile:god:toggle') {
    if (userId) {
      const state = await getUserState(env, userId);
      state.profile = state.profile || {};
      state.profile.godMode = !state.profile.godMode;
      await setUserState(env, userId, state);
      const { text: pText, kb } = renderProfileMenu(state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: pText, reply_markup: kb });
    }
  }

  if (data === 'profile:cidr') {
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: 'یک CIDR انتخاب کنید:',
      reply_markup: renderCidrKeyboard(),
    });
  }

  if (data.startsWith('profile:cidr:set:')) {
    const cidr = data.replace('profile:cidr:set:', '');
    if (userId) {
      const state = await getUserState(env, userId);
      state.profile = state.profile || {};
      state.profile.selectedCidr = cidr;
      await setUserState(env, userId, state);
      const { text: pText, kb } = renderProfileMenu(state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: pText, reply_markup: kb });
    }
  }

  if (data === 'profile:build') {
    if (userId) {
      const state = await getUserState(env, userId);
      const p = state.profile || {};
      if (!p.apn) {
        return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'ابتدا اپراتور را انتخاب کنید.', show_alert: true });
      }
      if (!p.rootUUID || !UUID_V4_REGEX.test(p.rootUUID)) {
        return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'UUID معتبر تنظیم نشده است.', show_alert: true });
      }
      const xml = buildMobileconfig({ rootUUID: p.rootUUID, apn: p.apn, selectedCidr: p.godMode ? (p.selectedCidr || DEFAULT_FALLBACK_CIDR) : DEFAULT_FALLBACK_CIDR });
      const form = new FormData();
      form.append('chat_id', String(chatId));
      const blob = new Blob([xml], { type: 'application/xml' });
      form.append('document', blob, 'config.mobileconfig');
      form.append('caption', 'پروفایل ساخته شد. آن را در iOS نصب کنید.');
      await tgForm(env, 'sendDocument', form);
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'فایل ارسال شد.' });
    }
  }

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
