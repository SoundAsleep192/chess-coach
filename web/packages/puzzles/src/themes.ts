/** Заголовки «Радуги» -> темы Lichess (словарь из спецификации). Ключ - заголовок после normalizeTitle. */
export const RADUGA_THEMES: Record<string, string[]> = {
  'двойной удар': ['fork'],
  'связка': ['pin'],
  'отвлечение': ['deflection'],
  'завлечение': ['attraction'],
  'уничтожение защиты': ['capturingDefender'],
  'открытое нападение': ['discoveredAttack'],
  'вскрытое нападение': ['discoveredAttack'],
  'двойной шах': ['doubleCheck'],
  'перекрытие': ['interference'],
  'освобождение поля': ['clearance'],
  'освобождение линии': ['clearance'],
  'мат': ['mate'],
  'матовые атаки': ['mate'],
  // заголовки глав семи томов, найденные при разметке (задача 6)
  'вскрытое нападение с шахом': ['discoveredAttack', 'discoveredCheck'],
  'вскрытое нападение без шаха': ['discoveredAttack'],
  'вскрытый шах': ['discoveredAttack', 'discoveredCheck'],
  // блокировка: фигуру соперника заставляют занять поле (обычно бегства своего короля) - ближе всего завлечение
  'блокировка': ['attraction'],
  'спертый мат': ['smotheredMate', 'mate'],
  'блокировка спертый мат': ['smotheredMate', 'mate'],
  'слабость последней горизонтали': ['backRankMate'],
  'рентген': ['xRayAttack'],
  'ловля фигуры': ['trappedPiece'],
  'промежуточный ход': ['intermezzo'],
  'игра на мат': ['mate'],
  'мат в 2 хода': ['mate', 'mateIn2'],
  'создание неотвратимой угрозы мата': ['mate', 'quietMove'],
  // спасение ничьей патом: у Lichess это equality («отыграться до ничьей»)
  'игра на пат': ['equality'],
  // смешанная глава последнего тома: темы нет, заголовок остаётся только в themesRaw
  'проверь себя!': [],
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/часть\s*\d+/g, ' ')
    .replace(/[«»".,:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Темы по заголовку. known=false - заголовка нет в словаре: он идёт в themesRaw и в отчёт, словарь дополняется. */
export function radugaThemes(title: string): { themes: string[]; known: boolean } {
  const themes = RADUGA_THEMES[normalizeTitle(title)];
  return themes ? { themes: [...themes], known: true } : { themes: [], known: false };
}
