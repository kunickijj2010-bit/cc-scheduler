// === APP_CONFIG — Business logic configuration ===
export const APP_CONFIG = {
  TARGET_LOAD_PER_HOUR: 2.5,
  DEPT_DEMAND_SHARE: { NDC: 0.25, GDS: 0.55, VIP: 0.20, 'Супервизия': 0.0 },
  MIN_NIGHT_COVERAGE: { NDC: 2, GDS: 2, VIP: 1, 'Супервизия': 0 },
  MONTHS_DAYS: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  MONTHS_NAMES_SHORT: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  MONTHS_NAMES_FULL: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  DOW_LABELS: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
};

export const REMAP = {
  'Группа супервизии': 'Супервизия',
  'Социальный': 'GDS',
  'VIP-линия': 'VIP',
  'GDS-линия': 'GDS',
  'Линия NDC': 'NDC',
};

export const DP = ['NDC', 'GDS', 'VIP', 'Супервизия'];
export const UI_DP = ['NDC', 'GDS', 'VIP'];  // Departments visible in UI (Supervision hidden)
export const MD = APP_CONFIG.MONTHS_DAYS;
export const MN = APP_CONFIG.MONTHS_NAMES_SHORT;
export const MNF = APP_CONFIG.MONTHS_NAMES_FULL;
export const DOWL = APP_CONFIG.DOW_LABELS;

// Supabase
export const SB_URL = 'https://pkpvsdqvpqpqvlneevud.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrcHZzZHF2cHFwcXZsbmVldnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDI1NTQwOCwiZXhwIjoyMDg1ODMxNDA4fQ.caadz2tQLSTQjCt0z-cV0ea4yZfTT_5BGLBa_n5zgE8';

// Supervisors override
export const SUPERV_NAMES = ['Белоусов Александр Алексеевич', 'Бабахина Екатерина Павловна'];
export const SKIP_DEPTS = ['Тренеры GDS'];
export const HIDDEN_DEPTS = ['Супервизия', 'МА Супервизия'];  // Hidden from UI but kept in data
export const SKIP_NAMES = ['Захаров Алексей'];

// === SHIFT_PATTERNS ===
export const SHIFT_PATTERNS = {
  '2/2': {
    cycle: [1, 1, 0, 0],
    phases: 4,
    description: 'Два дня работы, два дня отдыха',
    typicalHours: 11,
  },
  '2/2/3': {
    cycle: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
    phases: 14,
    description: 'Двое через двое с трёхдневными блоками (14-дневный цикл)',
    typicalHours: 11,
  },
  '1/3': {
    cycle: [1, 0, 0, 0],
    phases: 4,
    description: 'Сутки через трое (24-часовые смены)',
    typicalHours: 22,
  },
  '3/3': {
    cycle: [1, 1, 1, 0, 0, 0],
    phases: 6,
    description: 'Три дня работы, три дня отдыха (ночной)',
    typicalHours: 11,
    isNight: true,
  },
  '5/2': {
    cycle: [1, 1, 1, 1, 1, 0, 0],
    phases: 7,
    description: 'Стандартная пятидневка (Пн-Пт)',
    typicalHours: 8,
    alignToWeekday: true,
  },
  'ночь': {
    cycle: [1, 1, 0, 0],
    phases: 4,
    description: 'Ночная смена (обычно 21:00-09:00)',
    typicalHours: 11,
    isNight: true,
  },
};
