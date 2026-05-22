/**
 * Sole Vite/Rollup entry — RazyUI + theme only.
 * Site/app code is plain ES modules in `public/js/` (copied to webassets as-is).
 *
 * Use explicit named exports only — some Rollup chunk layouts drop `export default` on the entry.
 */
import 'razyui/theme.css';
import * as RazyUIPkg from 'razyui';
import { registerElement as registerRuiInputElement } from 'razyui/component/Input.js';

export const razyui = RazyUIPkg.default ?? RazyUIPkg;
export const registerElement = registerRuiInputElement;
