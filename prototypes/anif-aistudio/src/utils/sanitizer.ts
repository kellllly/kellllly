/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ANIF Gabon - Filtre de Caviardage et Décontamination PII / Bancaire
 * Conforme à la Recommandation 29 du GAFI et au Secret de l'Instruction Financière
 */

export interface SanitizationResult {
  sanitizedText: string;
  itemsRedactedCount: number;
  detectedCategories: string[];
  originalText: string;
}

export function sanitizeFinancialAndPII(rawText: string): SanitizationResult {
  let text = rawText;
  let count = 0;
  const categories: string[] = [];

  // 1. Détection et caviardage des IBAN et comptes bancaires CEMAC (Gabon GA21... ou 12-24 chiffres consécutifs)
  const ibanRegex = /\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/gi;
  if (ibanRegex.test(text)) {
    text = text.replace(ibanRegex, () => {
      count++;
      return '[COMPTE BANCAIRE MASQUÉ - ART. 29 GAFI]';
    });
    categories.push('Comptes Bancaires & IBAN');
  }

  const rawAccountRegex = /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4,8})\b/g;
  if (rawAccountRegex.test(text)) {
    text = text.replace(rawAccountRegex, () => {
      count++;
      return '[COMPTE BANCAIRE MASQUÉ]';
    });
    if (!categories.includes('Comptes Bancaires & IBAN')) {
      categories.push('Comptes Bancaires & IBAN');
    }
  }

  // 2. Détection et caviardage des montants de transactions financières
  const amountRegex = /(\d+([ ,.]\d{3})*([.,]\d+)?)\s*(FCFA|XAF|EUR|USD|\$|€|milliards?|millions?)\b/gi;
  if (amountRegex.test(text)) {
    text = text.replace(amountRegex, () => {
      count++;
      return '[MONTANT TRANSACTION CONFIDENTIEL]';
    });
    categories.push('Flux Financiers & Montants');
  }

  // 3. Détection et caviardage des numéros d'identification fiscale (NIF) ou CNI/Passeport
  const idRegex = /\b(NIF|CNI|PASSPORT|PASSEPORT|RCCM)[:\s]+([A-Z0-9\/-]{6,20})\b/gi;
  if (idRegex.test(text)) {
    text = text.replace(idRegex, (_match, type) => {
      count++;
      return `[IDENTIFIANT ${type.toUpperCase()} CAVIARDÉ]`;
    });
    categories.push('Identifiants Régaliens (NIF/CNI/Passeport)');
  }

  // 4. Détection et caviardage des entités corporatives sensibles sous enquête
  const corporateSuspectRegex = /\b(Société\s+[A-Z][a-zA-Z0-9\s]+(?:SARL|SA|HOLDING|OFFSHORE|LTD))\b/gi;
  if (corporateSuspectRegex.test(text)) {
    text = text.replace(corporateSuspectRegex, () => {
      count++;
      return '[ENTITÉ COMMERCIALE ENQUÊTÉE - SECRET DÉFENSE]';
    });
    categories.push('Entités d\'Intérêt Enquête');
  }

  return {
    sanitizedText: text,
    itemsRedactedCount: count,
    detectedCategories: categories,
    originalText: rawText
  };
}

export function formatSecondsToSla(totalSeconds: number): {
  formatted: string;
  isUrgent: boolean;
  isOverdue: boolean;
} {
  const isOverdue = totalSeconds <= 0;
  const absSeconds = Math.abs(totalSeconds);

  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const formatted = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return {
    formatted: isOverdue ? `-${formatted}` : formatted,
    isUrgent: totalSeconds > 0 && totalSeconds < 1800, // < 30 min
    isOverdue
  };
}
