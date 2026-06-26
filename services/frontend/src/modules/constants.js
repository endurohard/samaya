// Чистые данные-константы UI. Извлечены из app.js (IIFE) в отдельный модуль —
// esbuild инлайнит их обратно при сборке, но в исходниках они теперь изолированы.

export const VIEW_TITLES = {
  today: 'Сегодня',
  profile: 'Профиль',
  journal: 'Журнал записей',
  schedule: 'График работы',
  clients: 'Клиенты',
  services: 'Услуги',
  masters: 'Сотрудники',
  inventory: 'Склад / Расходники',
  analytics: 'Аналитика',
  sales: 'Продажи',
  finance: 'Финансы',
  salary: 'Зарплата',
  promotion: 'Акции и промокоды',
  messages: 'Сообщения',
  settings: 'Настройки',
};

export const CLIENT_SEGMENTS = [
  { key: 'all', label: 'Все клиенты', hint: '' },
  { key: 'regular', label: 'Постоянные', hint: '2 и более записи за 3 месяца' },
  { key: 'sleeping', label: 'Спящие', hint: 'не записывались более 3 месяцев' },
  { key: 'missing', label: 'Пропавшие', hint: 'не записывались более 6 месяцев' },
  { key: 'never', label: 'Не посещали', hint: 'нет записей данных клиентов' },
  { key: 'new', label: 'Новые', hint: 'за последний период' },
  { key: 'blocked', label: 'Заблокированы', hint: 'не могут записаться онлайн' },
  { key: 'deleted', label: 'Удалены', hint: 'удалены из списка клиентов' },
];

export const MOVEMENT_LABEL = {
  receipt: 'приход',
  consumption: 'списание',
  adjustment: 'корректировка',
  writeoff: 'списание',
  transfer: 'перемещение',
};

export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export const STATUS_LABEL = {
  pending:   { ru: 'ожидает',      cls: 'pill-warn',   icon: '⏳' },
  confirmed: { ru: 'подтверждена', cls: 'pill-ok',     icon: '✓'  },
  completed: { ru: 'оплачено',     cls: 'pill-info',   icon: '💳' },
  canceled:  { ru: 'отменена',     cls: 'pill-mute',   icon: '✕'  },
  no_show:   { ru: 'не пришёл',   cls: 'pill-danger', icon: '!'  },
};

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
export const MONTHS_RU_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
export const MONTHS_RU_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WEEKDAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const MONTH_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

export const STATUS_COLOR = {
  pending: '#f59e0b',
  confirmed: '#22c55e',
  completed: '#7c3aed',
  canceled: '#94a3b8',
  no_show: '#ef4444',
};
export const SOURCE_LABEL = { manual: 'Вручную', widget: 'Виджет', public: 'Публичный', api: 'API' };
