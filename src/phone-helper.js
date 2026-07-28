/**
 * Helper: extract the phone number from the argument.
 * Pass your number as the first argument so it never appears in the terminal prompt.
 *
 * Usage:
 *   node src/bridge-pairing.js     (it will prompt for your phone number)
 */

// Simple helper
export function parsePhoneArg(arg) {
  // Strip all non-digits, then ensure it starts with country code
  let num = (arg || '').replace(/\D/g, '');
  if (!num) return '';

  // If the user typed +86 138..., strip the plus and spaces
  // If it already starts with a country code prefix, use as-is
  return num;
}
