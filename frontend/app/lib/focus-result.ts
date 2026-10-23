/**
 * Moves focus to an action's result, such as a row's message, unless the
 * person moved on while the action ran. Focus moves only when it was lost (on
 * the page body, or on a control the result removed) or is still inside
 * `scope`, so a slow upload that ends while they type in another form does not
 * take their focus and scroll the page away from them.
 */
export function focusResult(target: HTMLElement | null | undefined, scope: HTMLElement | null | undefined) {
  const active = document.activeElement;
  const lost = !active || active === document.body || !active.isConnected;
  if (lost || scope?.contains(active)) target?.focus();
}
