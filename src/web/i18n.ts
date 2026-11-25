export type Lang = 'en' | 'ru';
export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/**
 * Russian strings, keyed by the English text. Anything missing (including messages from mail servers) is shown in
 * English, so a missing entry never breaks a page.
 */
const RU: Record<string, string> = {
  // layout and sign-in
  'IMAP Connector': 'Почтовый подключатель',
  'Sign in': 'Вход',
  'Settings': 'Настройки',
  'Connect your mailbox to AI': 'Подключите почту к ИИ',
  'Sign in with your email address and mail password. Your first sign-in creates your account on this server.':
    'Войдите адресом и паролем от почты. Первый вход создаёт вашу учётную запись на этом сервере.',
  'Your account and stored credentials were deleted.': 'Учётная запись и сохранённые пароли удалены.',
  'Email': 'Адрес',
  'Password or app password': 'Пароль или пароль приложения',
  'Mail server settings': 'Настройки почтового сервера',
  'IMAP server': 'Сервер IMAP',
  'SMTP server': 'Сервер SMTP',
  'Gmail, iCloud, Yahoo and others need an app password': 'Gmail, iCloud, Yahoo и другие требуют пароль приложения',
  'instead of your normal password:': 'вместо обычного пароля:',
  'Lost it? Create a new one and sign in with it.': 'Потеряли? Создайте новый и войдите с ним.',
  'Outlook.com and Microsoft 365 are not supported yet.': 'Outlook.com и Microsoft 365 пока не поддерживаются.',
  'Sign out': 'Выйти',
  'Signed in as': 'Вы вошли как',
  'Your mail password stopped working.': 'Пароль от почты перестал работать.',
  'Sign in again': 'Войдите заново',
  'with your current password or app password.': 'с текущим паролем или паролем приложения.',
  'Your account is ready. Connect it to Claude or ChatGPT below.': 'Учётная запись готова. Подключите её к Claude или ChatGPT ниже.',
  'Saved.': 'Сохранено.',
  // connect
  'Connect an AI': 'Подключить ИИ',
  'Connector URL:': 'Адрес подключения:',
  'Settings → Connectors → Add custom connector → paste the URL → Connect.':
    'Настройки → Подключения → Add custom connector → вставьте адрес → Connect.',
  'Settings → Connectors (enable developer mode if needed) → Create → paste the URL → choose OAuth.':
    'Настройки → Connectors (при необходимости включите режим разработчика) → Create → вставьте адрес → OAuth.',
  'You will be asked to approve access on this server.': 'Доступ нужно будет подтвердить на этом сервере.',
  // mailboxes
  'Mailboxes': 'Ящики',
  'One connection, several mailboxes. The AI sees the mailbox you signed in with and every mailbox listed here.':
    'Одно подключение — все ящики. ИИ видит ящик, которым вы вошли, и все ящики из этого списка.',
  'Mailbox': 'Ящик',
  'Label': 'Метка',
  'Address': 'Адрес',
  'Status': 'Состояние',
  'Inbox': 'Входящие',
  'signed in': 'основной',
  'OK': 'работает',
  'Needs a new password': 'нужен новый пароль',
  'not checked': 'не проверен',
  'Not responding': 'не отвечает',
  'The password no longer works: set a new one in the ⋯ menu.': 'Пароль больше не подходит: задайте новый в меню ⋯.',
  'The mail server did not respond. Try again shortly.': 'Почтовый сервер не ответил. Попробуйте чуть позже.',
  'Unexpected error.': 'Непредвиденная ошибка.',
  'That folder does not exist.': 'Такой папки нет.',
  'Mail server unavailable, try again shortly.': 'Почтовый сервер недоступен, попробуйте позже.',
  'This account\'s mail server is not approved on this instance. Ask the user to sign in again.':
    'Почтовый сервер этого ящика здесь не разрешён. Войдите в ящик заново.',
  '{unread} unread of {total}': '{unread} непрочит. из {total}',
  'Rename': 'Переименовать',
  'Save': 'Сохранить',
  'New password': 'Новый пароль',
  'Update password': 'Обновить пароль',
  'Remove': 'Убрать',
  'Remove {email} from this connection? Its stored password is deleted; the mailbox itself is not touched.':
    'Убрать {email} из подключения? Сохранённый пароль удалится, сам ящик не изменится.',
  'Check all mailboxes': 'Проверить все ящики',
  'Checks each mailbox and counts messages in Inbox. Nothing is marked as read.':
    'Заходит в каждый ящик и считает письма во «Входящих». Ничего не помечается прочитанным.',
  'Add mailboxes': 'Добавить ящики',
  'Fill in as many rows as you need and save once. Each password is checked with a real sign-in and stored encrypted. Gmail and iCloud need an app password.':
    'Заполните сколько нужно строк и сохраните один раз. Каждый пароль проверяется настоящим входом и хранится зашифрованным. Для Gmail и iCloud нужен пароль приложения.',
  'Label (optional)': 'Метка (необязательно)',
  'e.g. sales': 'напр. sales',
  'Check and add mailboxes': 'Проверить и добавить',
  'Connected as "{label}".': 'Подключён как «{label}».',
  'Password updated.': 'Пароль обновлён.',
  'Renamed to "{label}".': 'Новая метка: «{label}».',
  'Enter both the address and the password.': 'Введите и адрес, и пароль.',
  'This is the mailbox you are signed in with.': 'Это ящик, которым вы вошли.',
  'At most {max} linked mailboxes.': 'Не больше {max} ящиков.',
  'Fill in at least one mailbox.': 'Заполните хотя бы одну строку.',
  'Use letters, digits, dot, dash or underscore.': 'Используйте буквы, цифры, точку, дефис или подчёркивание.',
  'This label is already used.': 'Такая метка уже есть.',
  'Enter the new password.': 'Введите новый пароль.',
  // telegram
  'Your own Telegram accounts. The AI reads chats without marking them as read; it can send only where you allow it below and only with full access.':
    'Ваши аккаунты Telegram. ИИ читает чаты, не помечая их прочитанными; отправлять может только там, где вы разрешили ниже, и только при полном доступе.',
  'Account': 'Аккаунт',
  'Sending': 'Отправка',
  'allowed': 'разрешена',
  'off': 'выключена',
  'Turn off': 'Выключить',
  'Allow': 'Разрешить',
  'Disconnect Telegram account {label}? The stored session is deleted; your Telegram account is not touched.':
    'Отключить аккаунт Telegram {label}? Сохранённая сессия удалится, сам аккаунт Telegram не изменится.',
  'Telegram sent a code to your Telegram app for {phone}. Enter it here.': 'Telegram отправил код в приложение Telegram для {phone}. Введите его здесь.',
  'Code': 'Код',
  'Cancel': 'Отмена',
  'This account has two-step verification. Enter your Telegram cloud password.':
    'У аккаунта включена двухэтапная проверка. Введите облачный пароль Telegram.',
  'hint': 'подсказка',
  'Cloud password': 'Облачный пароль',
  'Connect a Telegram account': 'Подключить аккаунт Telegram',
  'Open my.telegram.org, sign in with the phone number of the account, choose "API development tools" and create an app (any name).':
    'Откройте my.telegram.org, войдите по номеру этого аккаунта, выберите «API development tools» и создайте приложение (название любое).',
  'Copy api_id and api_hash into the form below and press "Get code".': 'Скопируйте api_id и api_hash в форму ниже и нажмите «Получить код».',
  'Enter the code that arrives in your Telegram app (and your cloud password, if you set one).':
    'Введите код, который придёт в приложение Telegram (и облачный пароль, если он задан).',
  'Phone': 'Телефон',
  'e.g. oman': 'напр. oman',
  'Get code': 'Получить код',
  'Copy api_id (digits) and api_hash (32 characters) from my.telegram.org → API development tools.':
    'Скопируйте api_id (цифры) и api_hash (32 символа) с my.telegram.org → API development tools.',
  'The phone number is not valid. Use international format, e.g. +96871113813.': 'Неверный номер. Укажите в международном формате, например +96871113813.',
  'Too many Telegram sign-in attempts. Try again in 15 minutes.': 'Слишком много попыток входа в Telegram. Попробуйте через 15 минут.',
  'The sign-in expired. Start again to get a new code.': 'Время входа истекло. Начните заново, чтобы получить новый код.',
  'Enter the code Telegram sent to your app.': 'Введите код, который Telegram прислал в приложение.',
  'Enter your Telegram two-step verification password.': 'Введите облачный пароль Telegram.',
  'Telegram did not respond. Try again shortly.': 'Telegram не ответил. Попробуйте чуть позже.',
  'The code is wrong. Check it and try again.': 'Неверный код. Проверьте и попробуйте снова.',
  'The code expired. Start again to get a new one.': 'Код устарел. Начните заново, чтобы получить новый.',
  'The two-step verification password is wrong.': 'Неверный облачный пароль.',
  'Telegram rejected the api_id / api_hash. Copy them again from my.telegram.org.': 'Telegram не принял api_id / api_hash. Скопируйте их заново с my.telegram.org.',
  'This phone number has no Telegram account.': 'На этот номер нет аккаунта Telegram.',
  // permissions
  'What can the AI do?': 'Что может ИИ?',
  'Applies to every mailbox of this connection.': 'Действует для всех ящиков этого подключения.',
  'Read only': 'Только чтение',
  'Search and read mail. The AI cannot change anything.': 'Искать и читать почту. ИИ ничего не меняет.',
  'Read and draft (recommended)': 'Чтение и черновики (рекомендуется)',
  'Also flag, move and archive mail, and save drafts that you review and send yourself.':
    'Ещё помечать, перемещать и архивировать письма и сохранять черновики, которые вы проверяете и отправляете сами.',
  'Full access': 'Полный доступ',
  'Also send email and move messages to Trash. Warning: a malicious email could try to trick the AI into sending mail on your behalf.':
    'Ещё отправлять письма и переносить их в корзину. Внимание: вредоносное письмо может попытаться заставить ИИ отправить почту от вашего имени.',
  // apps, smtp, delete
  'Connected apps': 'Подключённые приложения',
  'No AI apps connected yet.': 'Пока ни одно приложение не подключено.',
  'Unnamed app': 'Приложение без названия',
  'Connected': 'Подключено',
  'last used': 'последнее использование',
  'Revoke': 'Отключить',
  'Sending (SMTP)': 'Отправка (SMTP) основного ящика',
  'SMTP username': 'Логин SMTP',
  'SMTP password (leave empty to keep the current one)': 'Пароль SMTP (оставьте пустым, чтобы не менять)',
  'Use my mail (IMAP) password for SMTP': 'Использовать пароль почты (IMAP) для SMTP',
  'Save SMTP settings': 'Сохранить настройки SMTP',
  'Delete account': 'Удалить учётную запись',
  'Removes your stored credentials and disconnects every AI app. Your mailbox is not touched.':
    'Удаляет сохранённые пароли и отключает все приложения ИИ. Сами ящики не меняются.',
  'Delete your account and stored credentials?': 'Удалить учётную запись и сохранённые пароли?',
  'Delete my account': 'Удалить учётную запись',
  // consent and errors
  'Approve access': 'Подтверждение доступа',
  'Allow {app} to use your mailbox?': 'Разрешить {app} доступ к почте?',
  '{app} wants to access {email} and its linked mailboxes.': '{app} просит доступ к {email} и привязанным ящикам.',
  "After approval you'll be sent to {host}.": 'После подтверждения вы вернётесь на {host}.',
  'Current permission level: {level}. You can change it any time in settings, and revoke this app there too.':
    'Текущий уровень доступа: {level}. Его можно изменить в настройках, там же можно отключить это приложение.',
  'Approve': 'Разрешить',
  'Deny': 'Отказать',
  'Back to start': 'На главную',
  'Not found': 'Не найдено',
  'This page does not exist.': 'Такой страницы нет.',
  'Request expired': 'Запрос устарел',
  'This connection request expired or was already used. Start connecting again from Claude or ChatGPT.':
    'Запрос на подключение устарел или уже использован. Начните подключение заново из Claude или ChatGPT.',
  'Something went wrong': 'Что-то пошло не так',
  'Request rejected': 'Запрос отклонён',
  'The request could not be processed.': 'Запрос не удалось обработать.',
  // messages from sign-in and checks
  'Enter your email address and password.': 'Введите адрес и пароль.',
  'Too many sign-in attempts. Try again in 15 minutes.':
    'Слишком много неудачных попыток входа с этого устройства. Попробуйте через 15 минут.',
  'The mail server rejected the password for this address 5 times in a row, so sign-in is paused for 15 minutes. Check the password (or app password) first, then try again.':
    'Почтовый сервер 5 раз подряд не принял пароль для этого адреса, поэтому вход приостановлен на 15 минут. Сначала проверьте пароль (или пароль приложения), потом попробуйте снова.',
  'Email or password incorrect. Many providers (Gmail, iCloud, Yahoo) require an app password instead of your normal password.':
    'Неверный адрес или пароль. Gmail, iCloud, Yahoo и другие требуют пароль приложения вместо обычного.',
  "Couldn't reach your mail server. Check the settings or try again shortly.":
    'Не удалось связаться с почтовым сервером. Проверьте настройки или попробуйте позже.',
  "We couldn't detect your mail server settings. Enter them below.": 'Не удалось определить настройки почтового сервера. Введите их ниже.',
  'This mail server is not allowed on this instance. Ask the administrator.':
    'Этот почтовый сервер здесь не разрешён. Обратитесь к администратору.',
  'Check the server settings.': 'Проверьте настройки сервера.',
  'Check the SMTP settings.': 'Проверьте настройки SMTP.',
  'Choose a valid permission level.': 'Выберите уровень доступа.',
};

export function parseLang(value: string | undefined): Lang {
  return value?.trim().toLowerCase() === 'ru' ? 'ru' : 'en';
}

export function translator(lang: Lang): Translate {
  return (text, vars) => {
    let out = lang === 'ru' ? (RU[text] ?? text) : text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  };
}
