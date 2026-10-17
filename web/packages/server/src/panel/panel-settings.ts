import { PANEL_OFF, type BoardState, type PanelSettings } from '@board/shared';

/** Настройки панели; в старом документе доски поля нет - панель выключена. */
export function panelOf(s: BoardState): PanelSettings {
  return s.panel ?? PANEL_OFF;
}
