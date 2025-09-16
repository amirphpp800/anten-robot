// main.js — Cloudflare Pages Functions compatible Telegram bot
// All interactions via inline keyboards only. Uses KV binding: BOT_KV.

const getToken = (env) => env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
const apiBase = (env) => `https://api.telegram.org/bot${getToken(env)}/`;
// Admin ID from environment (fallback to fixed if not provided)
const getAdminId = (env) => {
  const fromEnv = Number(env.ADMIN_TELEGRAM_ID);
  if (fromEnv && Number.isFinite(fromEnv)) return fromEnv;
  return 8009067953; // fallback
};

function getPublicBaseUrl(env) {
  const base = env.PUBLIC_BASE_URL || env.BASE_URL || 'https://anten-robot.pages.dev';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

// Normalize Persian/Arabic digits and separators into ASCII integer
function parseLocalizedInt(txt) {
  if (typeof txt !== 'string') return NaN;
  const map = {
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
  };
  let s = txt.trim();
  s = s.replace(/[۰-۹٠-٩]/g, d => map[d] || d);
  s = s.replace(/[,\s_]/g, '');
  const m = s.match(/^[+-]?\d+$/);
  if (!m) return NaN;
  return Number(s);
}

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

// ---------- Utils & Helpers (missing pieces) ----------
function formatToman(n) {
  const num = Math.max(0, Math.floor(Number(n) || 0));
  return new Intl.NumberFormat('fa-IR').format(num) + ' تومان';
}

function getBalance(state) {
  return Math.max(0, Math.floor(Number(state?.balance || 0)));
}

function setBalance(state, value) {
  if (!state || typeof state !== 'object') return;
  state.balance = Math.max(0, Math.floor(Number(value) || 0));
}

function genId() {
  // short unique id for pending top-ups
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('');
}

function pendingTopupKey(id) {
  return `topup:pending:${id}`;
}

function listPendingKey() {
  return 'topup:pending:list';
}

function dlProfileKey(id) {
  return `dl:profile:${id}`;
}

function genPin() {
  // 6-digit numeric PIN as string
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = p.slice(0, i).trim();
      const v = p.slice(i + 1).trim();
      out[k] = v;
    }
  }
  return out;
}

function labelForApn(value) {
  const found = APN_OPTIONS.find((o) => o.value === value);
  return found ? found.label : value || '-';
}

function renderAccountMenu(state, userId) {
  const bal = formatToman(getBalance(state));
  const text = `حساب کاربری شما\n\nشناسه: <code>${userId || '-'}</code>\nموجودی: <b>${bal}</b>`;
  const kb = {
    inline_keyboard: [
      [ { text: '🆘 پشتیبانی', url: 'https://t.me/NeoDebug' } ],
      [ { text: '💳 افزایش موجودی', callback_data: 'menu:topup' }, { text: '📊 وضعیت', callback_data: 'menu:status' } ],
      [ { text: 'بازگشت', callback_data: 'menu:main' } ],
    ],
  };
  return { text, kb };
}

function renderTopupMenu(env, state, userId) {
  const bal = formatToman(getBalance(state));
  const text = `افزایش موجودی\n\nموجودی فعلی: <b>${bal}</b>\nیک پلن را انتخاب کنید:`;
  const rows = TOPUP_PLANS.map((p) => [{ text: p.label, callback_data: `topup:choose:${p.amount}` }]);
  rows.push([{ text: 'بازگشت', callback_data: 'menu:account' }]);
  return { text, kb: { inline_keyboard: rows } };
}

function renderTopupInstruction(amount, env) {
  const text = `لطفاً مبلغ <b>${formatToman(amount)}</b> را به کارت زیر واریز کنید و سپس تصویر رسید را ارسال نمایید:\n\nکارت:\n<code>${CARD_NUMBER}</code>\nبه نام: <b>${CARD_OWNER_NAME(env)}</b>`;
  const kb = {
    inline_keyboard: [
      [ { text: 'پرداخت کردم و رسید دارم', callback_data: `topup:await:${amount}` } ],
      [ { text: 'بازگشت', callback_data: 'menu:topup' } ],
    ],
  };
  return { text, kb };
}

// ---------- Admin Renderers ----------
function profilesDisabledKey() { return 'config:profiles_disabled'; }
async function getProfilesDisabled(env) {
  try { const v = await env.BOT_KV.get(profilesDisabledKey()); return v === '1'; } catch { return false; }
}
async function setProfilesDisabled(env, disabled) {
  try { await env.BOT_KV.put(profilesDisabledKey(), disabled ? '1' : '0'); } catch {}
}

// Admin settings: whether to send how-to and profile doc via Telegram
function sendHowtoKey() { return 'config:send_howto'; }
function sendProfileDocKey() { return 'config:send_profile_doc'; }
async function getSendHowto(env) {
  try { const v = await env.BOT_KV.get(sendHowtoKey()); return v == null ? false : v === '1'; } catch { return false; }
}
async function setSendHowto(env, v) {
  try { await env.BOT_KV.put(sendHowtoKey(), v ? '1' : '0'); } catch {}
}
async function getSendProfileDoc(env) {
  try { const v = await env.BOT_KV.get(sendProfileDocKey()); return v == null ? false : v === '1'; } catch { return false; }
}
async function setSendProfileDoc(env, v) {
  try { await env.BOT_KV.put(sendProfileDocKey(), v ? '1' : '0'); } catch {}
}

async function renderAdminMenuAsync(env) {
  const disabled = await getProfilesDisabled(env);
  const statusText = disabled ? '📱 وضعیت پروفایل‌ها: اتمام ⛔️' : '📱 وضعیت پروفایل‌ها: فعال ✅';
  const toggleText = disabled ? '▶️ فعال‌سازی پروفایل‌ها' : '⏹️ اتمام موجودی پروفایل (غیرفعال‌سازی)';
  const sendHowto = await getSendHowto(env);
  const sendDoc = await getSendProfileDoc(env);
  const howtoRow = [ { text: sendHowto ? '📝 ارسال آموزش: فعال ✅' : '📝 ارسال آموزش: غیرفعال ⛔️', callback_data: 'admin:settings:howto:toggle' } ];
  const docRow = [ { text: sendDoc ? '📄 ارسال فایل پروفایل: فعال ✅' : '📄 ارسال فایل پروفایل: غیرفعال ⛔️', callback_data: 'admin:settings:profiledoc:toggle' } ];
  const kb = {
    inline_keyboard: [
      [ { text: '📊 آمار و وضعیت', callback_data: 'admin:stats' }, { text: '📥 درخواست‌های افزایش موجودی', callback_data: 'admin:pending' } ],
      [ { text: '👤💳 مدیریت موجودی کاربر', callback_data: 'admin:bal' } ],
      howtoRow,
      docRow,
      [ { text: statusText, callback_data: 'admin:profiles:status' } ],
      [ { text: toggleText, callback_data: 'admin:profiles:toggle' } ],
      [ { text: '⬅️ بازگشت به منو', callback_data: 'menu:main' } ],
    ],
  };
  return { text: 'پنل ادمین — یکی از گزینه‌ها را انتخاب کنید:', kb };
}

async function renderAdminStats(env) {
  let usersCount = 0, profilesCount = 0;
  try {
    const u = await env.BOT_KV.get('stats:users');
    const p = await env.BOT_KV.get('stats:profiles');
    usersCount = u ? Number(u) || 0 : 0;
    profilesCount = p ? Number(p) || 0 : 0;
  } catch {}
  const text = `آمار ربات\n\nکاربران: <b>${usersCount}</b>\nپروفایل‌های ساخته شده: <b>${profilesCount}</b>`;
  return { text, kb: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'admin:panel' }]] } };
}

async function renderAdminPendingList(env) {
  const listRaw = await env.BOT_KV.get(listPendingKey());
  const ids = listRaw ? (JSON.parse(listRaw) || []) : [];
  if (!ids.length) {
    return {
      text: 'هیچ درخواست افزایش موجودی در انتظار بررسی نیست.',
      kb: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'admin:panel' }]] },
    };
  }
  // Load up to first 10 items
  const take = ids.slice(0, 10);
  const blocks = [];
  for (const id of take) {
    try {
      const raw = await env.BOT_KV.get(pendingTopupKey(id));
      if (!raw) continue;
      const req = JSON.parse(raw);
      const line = `کاربر <code>${req.userId}</code> — مبلغ: <b>${formatToman(req.amount)}</b>\nشناسه: <code>${req.id}</code>`;
      blocks.push({ line, id: req.id });
    } catch {}
  }
  let text = 'درخواست‌های در انتظار (حداکثر ۱۰ مورد):\n\n';
  const kb = { inline_keyboard: [] };
  for (const b of blocks) {
    text += `• ${b.line}\n`;
    kb.inline_keyboard.push([
      { text: 'تایید ✅', callback_data: `topup:approve:${b.id}` },
      { text: 'رد ❌', callback_data: `topup:reject:${b.id}` },
    ]);
  }
  kb.inline_keyboard.push([{ text: 'بازگشت', callback_data: 'admin:panel' }]);
  return { text, kb };
}

// ---------- UI: Inline Keyboards ----------
function mainMenuMarkup(env, userId, profilesDisabled = false) {
  const rows = [];
  // First row: topup (left), account (right) — Telegram orders LTR, so place Topup first
  rows.push([
    { text: '💳 افزایش موجودی', callback_data: 'menu:topup' },
    { text: '👤 حساب کاربری', callback_data: 'menu:account' },
  ]);
  // Second row: profile
  if (profilesDisabled) {
    rows.push([{ text: '📱 دریافت پروفایل اختصاصی (غیرفعال)', callback_data: 'profile:unavailable' }]);
  } else {
    rows.push([{ text: '📱 دریافت پروفایل اختصاصی', callback_data: 'profile:start' }]);
  }
  // Show admin only to admin user
  if (userId && getAdminId(env) && getAdminId(env) === userId) {
    rows.push([{ text: '🛠️ پنل ادمین', callback_data: 'admin:panel' }]);
  }
  return { inline_keyboard: rows };
}

function backToMainButton() {
  return { inline_keyboard: [[{ text: 'بازگشت به منوی اصلی', callback_data: 'menu:main' }]] };
}

// ---------- Views (Texts) ----------
const TEXTS = {
  welcome: 'سلام! لطفاً از دکمه‌های زیر استفاده کنید. پیام تایپی پذیرفته نمی‌شود.',
  main: 'به منوی اصلی خوش آمدید. یکی از گزینه‌ها را انتخاب کنید:',
  status: 'وضعیت اکانت شما:',
  textOnlyButtons: 'این ربات فقط با دکمه‌های شیشه‌ای کار می‌کند. لطفاً از دکمه‌های زیر استفاده کنید.',
  help: 'برای استفاده از ربات از دکمه‌های موجود زیر پیام‌ها استفاده کنید. برای ساخت پروفایل iOS به «دریافت پروفایل اختصاصی» بروید. برای افزایش موجودی از «افزایش موجودی» استفاده کنید.',
};

// ---------- Profile Builder Constants & Helpers ----------
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const APN_OPTIONS = [
  { value: 'mcinet', label: 'MCI 🔵' },
  { value: 'mtnirancell', label: 'Irancell 🟡' },
  { value: 'RighTel', label: 'RighTel 🟣' },
  { value: 'ApTel', label: 'Aptel 🔴' },
  { value: 'shatelmobile', label: 'SHATEL ⚪️' },
];

// Billing and Admin
const COST_PER_PROFILE = 250000; // toman
const TOPUP_PLANS = [
  { amount: 250000, label: 'افزایش موجودی ۲۵۰,۰۰۰ تومان' },
  { amount: 500000, label: 'افزایش موجودی ۵۰۰,۰۰۰ تومان' },
];
const CARD_NUMBER = '6219 8619 4308 4037';
const CARD_OWNER_NAME = (env) => env.CARD_OWNER_NAME || 'امیرحسین سیاهبالائی';

const DEFAULT_EXCLUSIONS_BASE = ['localhost', '127.0.0.1'];
const DEFAULT_FALLBACK_CIDR = '169.254.0.0/16';

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

// (Removed God Mode & CIDR selection for simpler UX)

function renderProfileMenu(state) {
  const p = state.profile || {};
  const apn = p.apn || 'انتخاب نشده';
  const uuid = p.rootUUID || 'انتخاب نشده';
  const text = `تنظیم پروفایل iOS\n\nاپراتور (APN): ${apn}\nUUID: ${uuid}\n\nاگر اطلاعات کامل است، ساخت پروفایل را بزنید.`;
  const kb = {
    inline_keyboard: [
      [ { text: 'تغییر اپراتور', callback_data: 'profile:apn' } ],
      [ { text: 'ساخت UUID جدید', callback_data: 'profile:uuid:auto' }, { text: 'ثبت UUID دستی (غیرفعال)', callback_data: 'profile:uuid:ask' } ],
      [ { text: 'ساخت و ارسال پروفایل', callback_data: 'profile:build' } ],
      [ { text: 'بازگشت به منو', callback_data: 'menu:main' } ],
    ],
  };
  return { text, kb };
}

function buildMobileconfig({ rootUUID, apn }) {
  const exclusionListValues = [
    ...DEFAULT_EXCLUSIONS_BASE,
    DEFAULT_FALLBACK_CIDR,
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
                <string>localhost</string>
                <string>127.0.0.1</string>
                <string>169.254.0.0/16</string>
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

// Append to a capped JSON list in KV (keeps last maxItems)
async function appendList(env, key, item, maxItems = 50) {
  try {
    const raw = await env.BOT_KV.get(key);
    const arr = raw ? (JSON.parse(raw) || []) : [];
    arr.push(item);
    const trimmed = arr.length > maxItems ? arr.slice(arr.length - maxItems) : arr;
    await env.BOT_KV.put(key, JSON.stringify(trimmed));
  } catch (e) {
    console.error('appendList error', key, e);
  }
}

// Consistently adjust user balance with clamping and persistence, with ledger logging
async function adjustUserBalance(env, userId, delta, reason = 'adjust', meta = {}) {
  const tState = await getUserState(env, userId);
  if (!tState.first_seen_at) tState.first_seen_at = Date.now();
  const before = getBalance(tState);
  const after = Math.max(0, before + Math.floor(Number(delta) || 0));
  setBalance(tState, after);
  await setUserState(env, userId, tState);
  // Log ledger entry in KV (last 100 entries)
  const entry = { at: Date.now(), delta: Math.floor(Number(delta) || 0), before, after, reason, meta };
  await appendList(env, `ledger:index:${userId}`, entry, 100);
  return { before, after, state: tState };
}

// ---------- Handlers ----------
async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  if (userId) {
    const state = await getUserState(env, userId);
    // Track last chat id for possible notifications
    state.last_chat_id = chatId;
    // Admin balance adjust flow (awaiting inputs)
    if (state.awaiting_admin && typeof msg.text === 'string') {
      const adminId = getAdminId(env);
      if (adminId && adminId === userId) {
        const s = state.awaiting_admin;
        const text = (msg.text || '').trim();
        // allow cancel via text
        if (["لغو", "cancel", "/cancel", "انصراف"].includes(text)) {
          state.awaiting_admin = undefined;
          await setUserState(env, userId, state);
          const { text: pText, kb } = await renderAdminMenuAsync(env);
          return tg(env, 'sendMessage', { chat_id: chatId, text: pText, reply_markup: kb, parse_mode: 'HTML' });
        }
        if (s.step === 'user') {
          const targetId = parseLocalizedInt(text);
          if (!targetId || !Number.isFinite(targetId)) {
            return tg(env, 'sendMessage', { chat_id: chatId, text: 'شناسه کاربر نامعتبر است. یک عدد ارسال کنید یا لغو کنید.', reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'admin:panel' }]] } });
          }
          s.targetUserId = targetId;
          s.step = 'amount';
          state.awaiting_admin = s;
          await setUserState(env, userId, state);
          return tg(env, 'sendMessage', { chat_id: chatId, text: `مبلغ را به تومان وارد کنید (${s.mode === 'inc' ? 'افزایش' : 'کاهش'}):`, reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'admin:panel' }]] } });
        } else if (s.step === 'amount') {
          const parsed = parseLocalizedInt(text);
          const amount = Math.max(0, Math.floor(Number.isFinite(parsed) ? parsed : 0));
          if (!amount) {
            return tg(env, 'sendMessage', { chat_id: chatId, text: 'مبلغ نامعتبر است. یک عدد صحیح ارسال کنید یا لغو کنید.', reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'admin:panel' }]] } });
          }
          const tId = s.targetUserId;
          const delta = s.mode === 'inc' ? amount : -amount;
          const { before, after } = await adjustUserBalance(env, tId, delta);
          // Clear awaiting
          state.awaiting_admin = undefined;
          await setUserState(env, userId, state);
          // Notify admin
          await tg(env, 'sendMessage', { chat_id: chatId, text: `موجودی کاربر ${tId} از ${formatToman(before)} به ${formatToman(after)} ${s.mode === 'inc' ? 'افزایش' : 'کاهش'} یافت.` });
          // Notify target user (directly to userId chat)
          const note = s.mode === 'inc'
            ? `موجودی شما ${formatToman(amount)} افزایش یافت. موجودی جدید: ${formatToman(after)}`
            : `موجودی شما ${formatToman(amount)} کاهش یافت. موجودی جدید: ${formatToman(after)}`;
          await tg(env, 'sendMessage', { chat_id: tId, text: note });
          // Return to admin panel
          const { text: pText, kb } = await renderAdminMenuAsync(env);
          return tg(env, 'sendMessage', { chat_id: chatId, text: pText, reply_markup: kb, parse_mode: 'HTML' });
        }
      }
    }

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
      // increment users stat only once per user
      if (!state._counted_user) {
        const raw = await env.BOT_KV.get('stats:users');
        const n = raw ? Number(raw) || 0 : 0;
        await env.BOT_KV.put('stats:users', String(n + 1));
        state._counted_user = true;
      }
      // index user in KV for faster listing (keeps last 5000 users)
      try { await appendList(env, 'users:index', { id: userId, at: state.first_seen_at }, 5000); } catch {}
      await setUserState(env, userId, state);
    }
  }
  // If user is asked to send a UUID or receipt upload
  if (userId) {
    const state2 = await getUserState(env, userId);
    // Awaiting receipt upload
    if (state2.awaiting_receipt && (msg.photo || msg.document)) {
      const amount = Number(state2.awaiting_receipt_amount || 0);
      const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
      const pendingId = genId();
      const payload = { id: pendingId, userId, chatId, amount, fileId, at: Date.now() };
      await env.BOT_KV.put(pendingTopupKey(pendingId), JSON.stringify(payload));
      const listRaw = await env.BOT_KV.get(listPendingKey());
      const list = listRaw ? JSON.parse(listRaw) : [];
      list.push(pendingId);
      await env.BOT_KV.put(listPendingKey(), JSON.stringify(list));
      // add to user's topup requests index
      try { await appendList(env, `topup:index:${userId}`, { id: pendingId, amount, at: Date.now(), status: 'pending' }, 200); } catch {}
      state2.awaiting_receipt = false;
      state2.awaiting_receipt_amount = 0;
      await setUserState(env, userId, state2);
      await tg(env, 'sendMessage', { chat_id: chatId, text: 'رسید شما دریافت شد. پس از بررسی به شما اطلاع داده می‌شود.' });
      const adminId = getAdminId(env);
      if (adminId) {
        if (msg.photo) {
          await tg(env, 'sendPhoto', { chat_id: adminId, photo: fileId, caption: `درخواست افزایش موجودی\nکاربر: <code>${userId}</code>\nمبلغ: ${formatToman(amount)}\nشناسه: <code>${pendingId}</code>`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'تایید ✅', callback_data: `topup:approve:${pendingId}` }, { text: 'رد ❌', callback_data: `topup:reject:${pendingId}` }]] } });
        } else if (msg.document) {
          await tg(env, 'sendDocument', { chat_id: adminId, document: fileId, caption: `درخواست افزایش موجودی\nکاربر: <code>${userId}</code>\nمبلغ: ${formatToman(amount)}\nشناسه: <code>${pendingId}</code>`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'تایید ✅', callback_data: `topup:approve:${pendingId}` }, { text: 'رد ❌', callback_data: `topup:reject:${pendingId}` }]] } });
        }
      }
      return;
    }
  }
  // Ignore text content; always present main menu

  const disabled = await getProfilesDisabled(env);
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: TEXTS.welcome + '\n\n' + TEXTS.main,
    reply_markup: mainMenuMarkup(env, userId, disabled),
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
  // ---- Account & Top-up ----
  if (data === 'menu:account') {
    if (userId) {
      const state = await getUserState(env, userId);
      const { text, kb } = renderAccountMenu(state, userId);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
    }
  }

  if (data === 'menu:topup') {
    if (userId) {
      const state = await getUserState(env, userId);
      const { text, kb } = renderTopupMenu(env, state, userId);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
    }
  }

  if (data.startsWith('topup:choose:')) {
    const amount = Number(data.split(':').pop());
    const { text, kb } = renderTopupInstruction(amount, env);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
  }

  if (data.startsWith('topup:await:')) {
    const amount = Number(data.split(':').pop());
    if (userId) {
      const state = await getUserState(env, userId);
      state.awaiting_receipt = true;
      state.awaiting_receipt_amount = amount;
      await setUserState(env, userId, state);
      return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: 'رسید پرداخت را به صورت تصویر یا فایل ارسال کنید.', reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'menu:account' }]] } });
    }
  }

  if (data.startsWith('topup:approve:') || data.startsWith('topup:reject:')) {
    const isApprove = data.startsWith('topup:approve:');
    const pendingId = data.split(':').pop();
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'مجوز ادمین ندارید.', show_alert: true });
    }
    const raw = await env.BOT_KV.get(pendingTopupKey(pendingId));
    if (!raw) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'درخواست یافت نشد یا پردازش شده.', show_alert: true });
    }
    const req = JSON.parse(raw);
    // Remove from list
    const listRaw = await env.BOT_KV.get(listPendingKey());
    const list = listRaw ? JSON.parse(listRaw) : [];
    await env.BOT_KV.put(listPendingKey(), JSON.stringify(list.filter((x) => x !== pendingId)));
    await env.BOT_KV.delete(pendingTopupKey(pendingId));
    if (isApprove) {
      // credit user
      const { after } = await adjustUserBalance(env, req.userId, Number(req.amount || 0));
      await tg(env, 'sendMessage', { chat_id: req.chatId, text: `واریز شما تایید شد. موجودی جدید: <b>${formatToman(after)}</b>`, parse_mode: 'HTML' });
      // mark in user's topup history
      try { await appendList(env, `topup:history:${req.userId}`, { id: pendingId, amount: Number(req.amount||0), at: Date.now(), status: 'approved' }, 200); } catch {}
      // Replace buttons on the original admin message with a single status button
      await tg(env, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: 'وضعیت: تایید شد ✅', callback_data: `topup:status:${pendingId}:ok` }]] },
      });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'درخواست تایید شد.' });
    } else {
      await tg(env, 'sendMessage', { chat_id: req.chatId, text: 'متاسفانه رسید شما تایید نشد. لطفاً با پشتیبانی در ارتباط باشید یا مجدداً تلاش کنید.' });
      try { await appendList(env, `topup:history:${req.userId}`, { id: pendingId, amount: Number(req.amount||0), at: Date.now(), status: 'rejected' }, 200); } catch {}
      await tg(env, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: 'وضعیت: رد شد ❌', callback_data: `topup:status:${pendingId}:no` }]] },
      });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'درخواست رد شد.' });
    }
    return;
  }

  if (data.startsWith('topup:status:')) {
    const parts = data.split(':');
    const status = parts[3] === 'ok' ? 'تایید شده ✅' : 'رد شده ❌';
    return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: `وضعیت: ${status}` });
  }

  if (data === 'profile:start') {
    const disabled = await getProfilesDisabled(env);
    if (disabled) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'موجودی پروفایل‌ها به اتمام رسیده است. لطفاً منتظر باشید تا پروفایل‌های جدید قرار گیرد.', show_alert: true });
    }
    // Gate by balance: charge on build, but inform cost here
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: `هزینه هر پروفایل: ${formatToman(COST_PER_PROFILE)}` });
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
      state.awaiting_uuid = false;
      await setUserState(env, userId, state);
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'این بخش غیرفعال است و در حال توسعه می‌باشد.', show_alert: true });
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

  // (Removed God Mode toggle and CIDR selection routes)

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
      // Charge if not already charged for this build
      if (!p._chargedOnce) {
        const bal = getBalance(state);
        if (bal < COST_PER_PROFILE) {
          const insufficient = `موجودی شما برای ساخت پروفایل کافی نیست.\nهزینه هر پروفایل: <b>${formatToman(COST_PER_PROFILE)}</b>\nموجودی فعلی: <b>${formatToman(bal)}</b>`;
          return tg(env, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: insufficient,
            reply_markup: { inline_keyboard: [[{ text: '💳 افزایش موجودی', callback_data: 'menu:topup' }], [{ text: 'بازگشت', callback_data: 'menu:main' }]] },
            parse_mode: 'HTML',
          });
        }
        const { state: latestState, after } = await adjustUserBalance(env, userId, -COST_PER_PROFILE);
        // merge profile flags safely on the latest state to avoid overwriting balance
        const newState = latestState || {};
        newState.profile = newState.profile || {};
        newState.profile = { ...newState.profile, ...p, _chargedOnce: true };
        await setUserState(env, userId, newState);
        await tg(env, 'sendMessage', { chat_id: chatId, text: `هزینه ${formatToman(COST_PER_PROFILE)} از موجودی شما کسر شد. موجودی فعلی: <b>${formatToman(after)}</b>`, parse_mode: 'HTML' });
      }
      const xml = buildMobileconfig({ rootUUID: p.rootUUID, apn: p.apn });
      // Save a copy in KV for downloadable link (24h TTL) with PIN
      const dlId = genId();
      const pin = genPin();
      try {
        const payload = { ownerId: userId, xml, used: false, pin, at: Date.now() };
        await env.BOT_KV.put(dlProfileKey(dlId), JSON.stringify(payload), { expirationTtl: 24 * 60 * 60 });
      } catch (e) {
        console.error('KV put (download profile) error', e);
      }
      // index profile build for user
      try { await appendList(env, `profiles:index:${userId}`, { at: Date.now(), apn: p.apn, uuid: p.rootUUID, dlId }, 200); } catch {}
      const shouldSendDoc = await getSendProfileDoc(env);
      if (shouldSendDoc) {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        const blob = new Blob([xml], { type: 'application/xml' });
        form.append('document', blob, 'config.mobileconfig');
        const caption = [
          '📄 پروفایل ساخته شد و آماده نصب است.',
          '📘 آموزش استفاده در پیام بعدی ارسال می‌شود.',
          '⚠️ اگر قبلاً پروفایل نصب کرده‌ای، حتماً ابتدا آن را حذف کن.',
          '‼️ حتماً فقط یک سیم‌کارت داخل گوشی قرار بده (Dual SIM نگذار).',
        ].join('\n');
        form.append('caption', caption);
        await tgForm(env, 'sendDocument', form);
      }
      // Remove previous menu/message after sending the profile
      await tg(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
      // Send download link and QR code if base URL configured
      const base = getPublicBaseUrl(env);
      if (base) {
        const link = `${base}/dl/${dlId}`;
        await tg(env, 'sendMessage', { chat_id: chatId, text: `🔗 لینک صفحه دانلود و راهنما:\n${link}\n\n🔒 کد دانلود (PIN): <code>${pin}</code>`, parse_mode: 'HTML' });
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(link)}`;
        await tg(env, 'sendPhoto', { chat_id: chatId, photo: qrUrl, caption: '📱 با اسکن این QR کد، وارد صفحه دانلود و راهنما می‌شوی.' });
      } else {
        await tg(env, 'sendMessage', { chat_id: chatId, text: 'ℹ️ برای نمایش لینک دانلود و QR، مقدار PUBLIC_BASE_URL را در تنظیمات محیطی ست کنید.' });
      }
      // Send detailed how-to message
      const shouldSendHowto = await getSendHowto(env);
      if (shouldSendHowto) {
        const howto = [
        '🚀 راهنمای نصب و راه‌اندازی آنتن‌دهی iOS',
        '',
        'مراحل نصب:',
        ' 1. 📵 بدون سیم‌کارت گوشی را آماده کن.',
        ' 2. ⚙️ به مسیر زیر برو:',
        'Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings',
        'و صبر کن تا کامل انجام شود.',
        ' 3. 📥 پس از روشن شدن گوشی، فایل پروفایل ارسال‌شده را نصب کن. سپس یک بار گوشی را خاموش و روشن کن.',
        ' 4. 📶 بعد از روشن شدن، سیم‌کارت را وارد کن و به مسیر زیر برو:',
        'Settings → Cellular → Cellular Data Options → Voice & Data',
        'حالت را روی LTE بگذار و تیک VoLTE را روشن کن.',
        ' 5. 🔁 حالا:',
        '  • سیم‌کارت را خارج کن.',
        '  • روی OK بزن.',
        '  • شبکه را روی 2G قرار بده.',
        '  • دوباره سیم‌کارت را جا بزن.',
        '✅ آنتن باید بیاید. (بعداً می‌توانی روی 3G هم قرار بدهی.)',
        '',
        '⸻',
        '',
        'ℹ️ تجربه:',
        '',
        'با این روش، آنتن روی 3G برای چند روز پایدار بوده است.',
        '',
        '⸻',
        '',
        '❗️ نکات مهم:',
        ' • اگر قبلاً پروفایل دیگری نصب کرده‌ای، حتماً اول حذفش کن.',
        ' • فقط یک سیم‌کارت داخل گوشی قرار بده (از حالت دو سیم‌کارته استفاده نکن).',
        '',
        '⸻',
        '',
        '📦 درباره فایل:',
        '',
        'بعد از دانلود حتما این کار رو انجام بده:',
        ' • روی فایل نگه‌دار.',
        ' • گزینه Rename را بزن.',
        ' • بعد از اسم config این رو اضافه کن حتی اگ این پسوند رو داشت👇',
        '.mobileconfig',
        ].join('\n');
        await tg(env, 'sendMessage', { chat_id: chatId, text: howto });
      }
      // Update user profile counters and reset charge flag
      const st2 = await getUserState(env, userId);
      st2.profiles_built_count = Number(st2.profiles_built_count || 0) + 1;
      const byApn = st2.profiles_by_apn || {};
      byApn[p.apn] = Number(byApn[p.apn] || 0) + 1;
      st2.profiles_by_apn = byApn;
      if (st2.profile) { st2.profile._chargedOnce = false; }
      await setUserState(env, userId, st2);
      // increment profiles stat
      const prow = await env.BOT_KV.get('stats:profiles');
      const pn = prow ? Number(prow) || 0 : 0;
      await env.BOT_KV.put('stats:profiles', String(pn + 1));
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'فایل ارسال شد.' });
    }
  }

  if (data === 'menu:main') {
    const disabled = await getProfilesDisabled(env);
    // If admin, also clear any pending admin input flow
    if (userId && getAdminId(env) === userId) {
      try { const st = await getUserState(env, userId); if (st.awaiting_admin) { st.awaiting_admin = undefined; await setUserState(env, userId, st); } } catch {}
    }
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: TEXTS.main,
      reply_markup: mainMenuMarkup(env, userId, disabled),
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

  if (data === 'admin:panel') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    // Clear any pending admin input flow to avoid stuck states
    try {
      const st = await getUserState(env, userId);
      if (st.awaiting_admin) { st.awaiting_admin = undefined; await setUserState(env, userId, st); }
    } catch {}
    const { text, kb } = await renderAdminMenuAsync(env);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
  }

  if (data === 'admin:stats') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const { text, kb } = await renderAdminStats(env);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
  }

  if (data === 'admin:pending') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const { text, kb } = await renderAdminPendingList(env);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
  }

  if (data === 'admin:profiles:status') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const disabled = await getProfilesDisabled(env);
    const msg = disabled ? 'وضعیت پروفایل‌ها: اتمام موجودی ⛔️' : 'وضعیت پروفایل‌ها: فعال ✅';
    return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: msg, show_alert: true });
  }

  if (data === 'admin:profiles:toggle') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const disabled = await getProfilesDisabled(env);
    await setProfilesDisabled(env, !disabled);
    const { text, kb } = await renderAdminMenuAsync(env);
    await tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb, parse_mode: 'HTML' });
    return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: !disabled ? 'پروفایل‌ها غیرفعال شد.' : 'پروفایل‌ها فعال شد.' });
  }

  if (data === 'admin:bal') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const text = 'مدیریت موجودی کاربر — یک عمل را انتخاب کنید:';
    const kb = {
      inline_keyboard: [
        [ { text: '➕ افزایش موجودی', callback_data: 'admin:bal:inc' }, { text: '➖ کاهش موجودی', callback_data: 'admin:bal:dec' } ],
        [ { text: '⬅️ بازگشت', callback_data: 'admin:panel' } ],
      ],
    };
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: kb });
  }

  if (data === 'admin:bal:inc' || data === 'admin:bal:dec') {
    const adminId = getAdminId(env);
    if (!adminId || adminId !== userId) {
      return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی مجاز نیست.', show_alert: true });
    }
    const mode = data.endsWith(':inc') ? 'inc' : 'dec';
    const state = await getUserState(env, userId);
    state.awaiting_admin = { step: 'user', mode };
    await setUserState(env, userId, state);
    const ask = `شناسه عددی کاربر را وارد کنید (${mode === 'inc' ? 'افزایش' : 'کاهش'} موجودی):`;
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: ask,
      reply_markup: { inline_keyboard: [[{ text: 'لغو', callback_data: 'admin:panel' }]] },
    });
  }

  if (data === 'menu:status') {
    // Render account status with profile counts
    let statusLine = 'شناسه کاربری شما ثبت شد.';
    if (userId) {
      const state = await getUserState(env, userId);
      const since = state.first_seen_at ? new Date(state.first_seen_at).toLocaleString('fa-IR') : 'نامشخص';
      const totalProfiles = Number(state.profiles_built_count || 0);
      const byApn = state.profiles_by_apn || {};
      let apnLines = '';
      const apnKeys = Object.keys(byApn);
      if (apnKeys.length) {
        apnLines = '\n' + apnKeys.map(k => `- ${labelForApn(k)}: <b>${byApn[k]}</b>`).join('\n');
      }
      statusLine = `شناسه: <code>${userId}</code>\nاولین ورود: <b>${since}</b>\nتعداد پروفایل‌های دریافت‌شده: <b>${totalProfiles}</b>${apnLines}`;
    }
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `${TEXTS.status}\n\n${statusLine}`,
      reply_markup: backToMainButton(),
      parse_mode: 'HTML',
    });
  }

  // Fallback: go back to main (respect profiles disabled flag)
  const disabledFb = await getProfilesDisabled(env);
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: TEXTS.main,
    reply_markup: mainMenuMarkup(env, userId, disabledFb),
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
    // GET routes
    if (request.method === 'GET') {
      const url = new URL(request.url);
      // Download landing: /dl/:id
      if (url.pathname.startsWith('/dl/')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const id = parts[1] || '';
        const isFile = parts.length === 3 && parts[2] === 'file';
        if (!id) {
          return new Response('Not Found', { status: 404 });
        }
        try {
          const raw = await env.BOT_KV.get(dlProfileKey(id));
          if (!raw) {
            return new Response('Expired or Not Found', { status: 404 });
          }
          const payload = (() => { try { return JSON.parse(raw); } catch { return null; } })();
          if (!payload || typeof payload.xml !== 'string') {
            return new Response('Expired or Not Found', { status: 404 });
          }
          if (isFile) {
            // enforce up to 3 downloads per link
            const count = Number(payload.downloads || 0);
            if (payload.used || count >= 3) {
              return new Response('Download limit reached', { status: 410 });
            }
            const pin = url.searchParams.get('pin') || '';
            const cookies = parseCookies(request.headers.get('Cookie') || '');
            const sid = cookies['dlsid'] || '';
            const validSid = Array.isArray(payload.sids) && payload.sids.includes(sid);
            if (!pin || pin !== payload.pin || !validSid) {
              const err = `<!doctype html><html lang=\"fa\" dir=\"rtl\"><meta charset=\"utf-8\"><title>دسترسی نامعتبر</title><body style=\"font-family:Vazirmatn,Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px\"><div style=\"max-width:720px;margin:0 auto;background:#111827;border-radius:14px;padding:24px\"><h1>⛔️ دسترسی نامعتبر</h1><p>کد دانلود (PIN) یا نشست این صفحه معتبر نیست. لطفاً از طریق لینک و QR ارسال‌شده توسط ربات وارد شوید و کد صحیح را وارد کنید.</p></div></body></html>`;
              return new Response(err, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
            }
            // Mark usage and persist (allow up to 3 downloads)
            try {
              const next = count + 1;
              payload.downloads = next;
              if (next >= 3) payload.used = true;
              await env.BOT_KV.put(dlProfileKey(id), JSON.stringify(payload), { expirationTtl: 24 * 60 * 60 });
              // write download usage history
              if (payload.ownerId) {
                await appendList(env, `downloads:history:${payload.ownerId}`, { id, at: Date.now() }, 200);
              }
            } catch {}
            return new Response(payload.xml, {
              status: 200,
              headers: {
                'content-type': 'application/x-apple-aspen-config',
                'content-disposition': 'attachment; filename="config.mobileconfig"',
                'cache-control': 'no-store',
              },
            });
          }
          // Landing HTML
          const base = getPublicBaseUrl(env) || '';
          const downloadHref = `${base}/dl/${id}/file`;
          const remaining = 3 - Number((payload.downloads || 0));
          // Ensure we have a session id (sid) bound to this landing visit
          let setCookie = '';
          try {
            const cookies = parseCookies(request.headers.get('Cookie') || '');
            let sid = cookies['dlsid'];
            if (!Array.isArray(payload.sids)) payload.sids = [];
            if (!sid || !payload.sids.includes(sid)) {
              sid = genId();
              payload.sids.push(sid);
              await env.BOT_KV.put(dlProfileKey(id), JSON.stringify(payload), { expirationTtl: 24 * 60 * 60 });
              setCookie = `dlsid=${sid}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`;
            }
          } catch {}
          const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>دانلود پروفایل iOS</title>
  <style>
    :root {
      --bg1: #0b0f19;
      --bg2: #0a0c14;
      --glass: rgba(255, 255, 255, 0.06);
      --border: rgba(255, 255, 255, 0.16);
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #10b981;
      --accent-2: #22d3ee;
      --shadow: 0 10px 30px rgba(0,0,0,.45);
      --radius: 16px;
    }
    * { box-sizing: border-box }
    body {
      font-family: Vazirmatn, Segoe UI, Tahoma, sans-serif;
      margin:0; padding:24px; color:var(--text);
      min-height:100vh;
      background: radial-gradient(1200px 800px at 80% -10%, rgba(34,211,238,.12), transparent 60%),
                  radial-gradient(1000px 700px at -10% 100%, rgba(16,185,129,.10), transparent 60%),
                  linear-gradient(180deg, var(--bg1), var(--bg2));
    }
    .shell { max-width: 860px; margin: 0 auto; }
    .card {
      margin:0 auto; border-radius: var(--radius);
      background: var(--glass);
      border: 1px solid var(--border);
      padding: 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px) saturate(120%);
      -webkit-backdrop-filter: blur(10px) saturate(120%);
    }
    h1 { margin:0 0 8px 0; font-size:24px; letter-spacing:.2px; }
    p { margin: 10px 0; }
    .muted { color: var(--muted); }
    /* Button 28 style */
    .button-28 {
      appearance: none;
      background-color: transparent;
      border: 2px solid #1A1A1A;
      border-radius: 15px;
      box-sizing: border-box;
      color: #e5e7eb;
      cursor: pointer;
      display: inline-block;
      font-family: Roobert,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";
      font-size: 16px;
      font-weight: 600;
      line-height: normal;
      margin: 0;
      min-height: 56px;
      min-width: 0;
      outline: none;
      padding: 14px 22px;
      text-align: center;
      text-decoration: none;
      transition: all 300ms cubic-bezier(.23, 1, 0.32, 1);
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
      width: 100%;
      will-change: transform;
      background: rgba(255,255,255,.04);
      border-color: rgba(255,255,255,.2);
      backdrop-filter: blur(8px);
    }
    .button-28:disabled { pointer-events: none; opacity:.6 }
    .button-28:hover { color: #fff; background-color: #1A1A1A; box-shadow: rgba(0, 0, 0, 0.25) 0 8px 15px; transform: translateY(-2px); }
    .button-28:active { box-shadow: none; transform: translateY(0); }
    .field { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .input {
      background: rgba(255,255,255,.06);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 12px;
      outline: none;
      box-shadow: inset 0 0 0 9999px rgba(255,255,255,0); /* avoid iOS autofill bg */
      transition: border-color .2s ease, background .2s ease;
    }
    .input:focus { border-color: rgba(34,211,238,.55); background: rgba(255,255,255,.09); }
    code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(255,255,255,.06); padding:2px 6px; border-radius:6px; color:#93c5fd; border:1px solid var(--border); }
    hr { border: none; border-top:1px solid var(--border); margin:20px 0; }
    pre { background: rgba(255,255,255,.04); border:1px solid var(--border); border-radius:12px; padding:16px; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap" rel="stylesheet">
  <meta name="robots" content="noindex,nofollow" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <script>history.scrollRestoration = 'manual';</script>
  </head>
<body>
  <div class="shell">
  <div class="card">
    <h1>🚀 راهنمای نصب و دانلود پروفایل iOS</h1>
    <p>این صفحه مخصوص پروفایل اختصاصی شماست. روی دکمه زیر بزنید تا فایل دانلود شود.</p>
    <form method="GET" action="${downloadHref}" style="margin:16px 0 8px 0;">
      <div class="field">
        <label for="pin">🔒 کد دانلود (PIN):</label>
        <input class="input" id="pin" name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="مثلاً 123456">
        <button class="button-28" type="submit">⬇️ دانلود پروفایل (.mobileconfig)</button>
      </div>
    </form>
    <p class="muted">توجه: این لینک حداکثر ۳ بار قابل استفاده است. دفعات باقی‌مانده: <strong>${remaining < 0 ? 0 : remaining}</strong></p>
    <hr/>
    <h2>📘 راهنما</h2>
    <pre style="white-space:pre-wrap; font-family: inherit;">
🚀 راهنمای نصب و راه‌اندازی آنتن‌دهی iOS

مراحل نصب:
 1. 📵 بدون سیم‌کارت گوشی را آماده کن.
 2. ⚙️ به مسیر زیر برو:
Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings
و صبر کن تا کامل انجام شود.
 3. 📥 پس از روشن شدن گوشی، فایل پروفایل ارسال‌شده را نصب کن. سپس یک بار گوشی را خاموش و روشن کن.
 4. 📶 بعد از روشن شدن، سیم‌کارت را وارد کن و به مسیر زیر برو:
Settings → Cellular → Cellular Data Options → Voice & Data
حالت را روی LTE بگذار و تیک VoLTE را روشن کن.
 5. 🔁 حالا:
  • سیم‌کارت را خارج کن.
  • روی OK بزن.
  • شبکه را روی 2G قرار بده.
  • دوباره سیم‌کارت را جا بزن.
✅ آنتن باید بیاید. (بعداً می‌توانی روی 3G هم قرار بدهی.)

⸻

ℹ️ تجربه:

با این روش، آنتن روی 3G برای چند روز پایدار بوده است.

⸻

❗️ نکات مهم:
 • اگر قبلاً پروفایل دیگری نصب کرده‌ای، حتماً اول حذفش کن.
 • فقط یک سیم‌کارت داخل گوشی قرار بده (از حالت دو سیم‌کارته استفاده نکن).

⸻

📦 درباره فایل:

بعد از دانلود حتما این کار رو انجام بده:
 • روی فایل نگه‌دار.
 • گزینه Rename را بزن.
 • بعد از اسم config این رو اضافه کن حتی اگ این پسوند رو داشت👇
.mobileconfig
    </pre>
  </div>
  </div>
</body>
</html>`;
          const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
          if (setCookie) headers['set-cookie'] = setCookie;
          return new Response(html, { status: 200, headers });
        } catch (e) {
          return new Response('Server Error', { status: 500 });
        }
      }
      // Minimal JSON health for other GETs
      const info = {
        ok: true,
        name: 'Telegram Inline Keyboard Bot',
        time: new Date().toISOString(),
        path: url.pathname,
        kvBinding: !!env.BOT_KV,
        botToken: getToken(env) ? 'set' : 'missing',
        adminId: getAdminId(env) || null,
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
        await handleUpdate(env, update);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('Method Not Allowed', { status: 405 });
  },
};
