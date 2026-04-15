const MESSAGES = {
    ERROR_CONFIG: '❌ Ошибка: конфигурация не загружена. Обратитесь в поддержку.',
    ERROR_GENERAL: '❌ Произошла ошибка, попробуйте снова',
    ERROR_TRADE_COMMAND: (msg) => `❌ Ошибка: ${msg}`,
    ERROR_INVALID_DATA: '❌ Ошибка: некорректные данные',
    ERROR_NOT_REGISTERED: '❌ Вы не зарегистрированы. Используйте /start',

    ERROR_INVALID_CAPTCHA: '❌ Неверный код, попробуйте снова! Введите код с картинки 🤖',

    ERROR_INVALID_WALLET_ADDRESS: (currency) => `❌ Введите корректный адрес кошелька для ${currency}`,

    ERROR_DEAL_NOT_FOUND: '❌ Данные сделки не найдены',
    ERROR_DEAL_NOT_FOUND_OR_PROCESSED: '❌ Заявка не найдена или уже обработана',

    ERROR_PAYMENT_VARIANTS_FETCH_FAILED: '❌ Ошибка при получении вариантов оплаты',
    ERROR_PAYMENT_VARIANTS_NOT_FOUND: '❌ Нет доступных вариантов оплаты',

    ERROR_WALLET_NOT_FOUND: '❌ Кошелёк не найден',
    ERROR_WITHDRAWAL_DATA_NOT_FOUND: '❌ Ошибка: данные для вывода не найдены',

    CAPTCHA_SUCCESS: '✅ Капча пройдена!',

    CANCEL_ACTION: '❌ Отменить',
    CANCEL_DEAL: (dealId) => `❌ Отменить заявку`,
    CONTACT_OPERATOR_ALT: '📞 Написать оператору',
    OPERATOR_WRITE_USER: '📞 Написать пользователю',
    PAYMENT_DONE: (dealId) => '✅ Оплата выполнена',

    REQUISITES_DELETE_BTC: '✅ BTC кошелёк удалён',
    REQUISITES_DELETE_LTC: '✅ LTC кошелёк удалён',

    OTHER_MENU_TEXT: '📋 Прочее',
    WALLET_INPUT_PROMPT: '💼 Введите адрес кошелька для BTC',

    CB_USER_NOT_FOUND: 'Пользователь не найден',
    CB_MIN_AMOUNT: '⚠️ Минимальная сумма — 500 RUB',
    CB_BACK: '⬅️ Назад',

    CACHE_WARNING: '⚠️ Курс может быть устаревшим'
};

module.exports = {
    MESSAGES
};
