/**
 * Detection of nominative or financial data before a support message becomes a
 * ticket (cahier des charges : filtre bloquant la transmission de données
 * nominatives). Heuristic, not a certified anonymisation: it blocks the obvious
 * cases and the person must still review the text.
 */
export type SensitiveFinding = { kind: string; sample: string };

const PATTERNS: ReadonlyArray<{ kind: string; regex: RegExp; check?: (match: string) => boolean }> = [
  // Bounded parts (RFC 5321: 64 before @, 253 for the domain) and a start only at a word boundary:
  // unbounded `+` made the scan quadratic (about 12 s for 100 000 digits with no @).
  { kind: 'Adresse e-mail', regex: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z])/g },
  { kind: 'IBAN', regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  { kind: 'Numéro de carte bancaire', regex: /\b(?:\d[ -]?){13,19}\b/g, check: luhn },
  { kind: 'Numéro de téléphone', regex: /(?:\+|00)\d{1,3}[ .-]?\d(?:[ .-]?\d){6,11}\b|\b0\d(?:[ .-]?\d{2}){3,4}\b/g },
  { kind: 'Mention d’identité (né le, passeport, CNI…)', regex: /\b(?:né|née)\s+le\b|\bpasseport\b|\bcarte\s+(?:nationale\s+)?d[’']identit[ée]\b|\bCNI\b|\bNIP\b/gi },
];

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const mask = (value: string) => value.length <= 4 ? '••••' : `${value.slice(0, 2)}…${value.slice(-2)}`;

export function findSensitiveData(...texts: string[]): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    // A passage already reported (e.g. an IBAN) is not reported again as a phone number.
    const covered: Array<[number, number]> = [];
    for (const { kind, regex, check } of PATTERNS) {
      for (const match of text.matchAll(regex)) {
        const value = match[0].trim();
        if (check && !check(value)) continue;
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (covered.some(([a, b]) => start < b && end > a)) continue;
        covered.push([start, end]);
        const key = `${kind}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ kind, sample: mask(value) });
      }
    }
  }
  return findings;
}
