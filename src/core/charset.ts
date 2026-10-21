/** Characters on each printable template page (9 x 9 boxes per page). */
export interface CharPage {
  id: number;
  title: string;
  chars: string[];
}

const split = (s: string): string[] => Array.from(s);

export const UPPERCASE = split('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
export const LOWERCASE = split('abcdefghijklmnopqrstuvwxyz');
export const DIGITS = split('0123456789');

export const PAGES: CharPage[] = [
  {
    id: 1,
    title: 'Letters, numbers & punctuation',
    chars: [...UPPERCASE, ...LOWERCASE, ...DIGITS, ...split(`.,!?'":;-()&@#$%/+=`)],
  },
  {
    id: 2,
    title: 'Symbols & accented letters (optional)',
    chars: [
      ...split('*_[]{}<>\\|~^`€£¥¢©°§'),
      ...split('‘’“”'),
      ...split('ÀÁÂÄÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕØÙÚÛÜ'),
      ...split('àáâäãåçèéêëìíîïñòóôöõøùúûü'),
      ...split('ß¿¡æœ'),
    ],
  },
];

export const ALL_CHARS: string[] = PAGES.flatMap((p) => p.chars);

/** Short hints printed next to characters that are easy to confuse. */
export const CHAR_HINTS: Record<string, string> = {
  I: 'capital i',
  l: 'small L',
  '1': 'one',
  O: 'capital o',
  '0': 'zero',
  "'": 'apostrophe',
  '"': 'quote',
  '-': 'hyphen',
  '`': 'backtick',
  '‘': 'open',
  '’': 'close',
  '“': 'open',
  '”': 'close',
  '|': 'bar',
  '\\': 'backslash',
  _: 'underscore',
};

/**
 * Characters that do not rest on the baseline (descenders, floating marks) and
 * must keep the vertical position they were written at.
 */
const OFF_BASELINE = new Set(
  split(`gjpqyfQJ,;_'"-=*^~\`°+<>‘’“”|()[]{}$§çÇ¿`),
);

export function sitsOnBaseline(ch: string): boolean {
  return !OFF_BASELINE.has(ch);
}

/** Flat-bottomed, flat-topped capitals used to measure the writer's cap height. */
export const CAP_HEIGHT_REFERENCE = new Set(split('ABDEFHIKLMNPRTUVWXZ'));
/** Lowercase letters without ascenders or descenders, used to measure x-height. */
export const X_HEIGHT_REFERENCE = new Set(split('acemnorsuvwxz'));

/** Font design metrics (units per em = 1000). */
export const UNITS_PER_EM = 1000;
export const CAP_HEIGHT = 700;
export const X_HEIGHT = 480;

export function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

export function codepointHex(ch: string): string {
  return (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}
