/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Schémas de Validation Stricts (Zod) - Conforme OWASP Top 10
 * Protection XSS, Injections SQL et Validation des Données Métier
 */

import { z } from 'zod';

// Regex anti-XSS et anti-injection : détecte les balises de script, handlers inline et tentatives d'injection SQL
const XSS_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|javascript:|onerror=|onload=|onclick=/i;
const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|OR\s+['"]?1['"]?\s*=\s*['"]?1)\b|--|\/\*)/i;

export const SafeTextSchema = z
  .string()
  .min(1, 'Le texte ne peut pas être vide')
  .max(5000, 'Texte trop volumineux (maximum 5000 caractères)')
  .refine((val) => !XSS_PATTERN.test(val), {
    message: 'ALERTE SÉCURITÉ : Tentative d\'injection de script XSS détectée et bloquée.'
  })
  .refine((val) => !SQL_INJECTION_PATTERN.test(val), {
    message: 'ALERTE SÉCURITÉ : Pattern d\'injection SQL malveillant intercepté par le WAF applicatif.'
  });

export const MessageInputSchema = z.object({
  canalId: z.string().min(1, 'Identifiant de canal requis'),
  texte: SafeTextSchema,
  retentionHours: z.number().int().min(1).max(720),
  classification: z.enum(['TRÈS SECRET', 'CONFIDENTIEL OPÉRATIONNEL', 'RESTREINT', 'INTERNE', 'SUPPORT TECHNIQUE'])
});

export const TicketInputSchema = z.object({
  titre: z.string().min(5, 'Titre trop court (minimum 5 caractères)').max(150),
  descriptionAnonymisee: SafeTextSchema,
  priorite: z.enum(['P1', 'P2', 'P3', 'P4']),
  demandeurMatricule: z.string().regex(/^AGT-[A-Z]{2,3}-\d{3}$|^AUD-[A-Z]{3,5}-\d{2}$/, 'Matricule régalien invalide'),
  stationSource: z.string().min(3).max(64),
  estSousContrainte48h: z.boolean().default(false)
});

export const AuthCredentialSchema = z.object({
  matricule: z.string().min(5),
  fidoCredentialId: z.string().min(10),
  roleNiveau: z.number().int().min(1).max(5),
  signatureEd25519: z.string().min(16)
});

export type MessageInput = z.infer<typeof MessageInputSchema>;
export type TicketInput = z.infer<typeof TicketInputSchema>;
export type AuthCredential = z.infer<typeof AuthCredentialSchema>;

/**
 * Fonction de validation sécurisée avec rapport détaillé
 */
export function validateSecurePayload<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues || [];
  const errors = issues.map((e) => `${e.path.length ? e.path.join('.') + ': ' : ''}${e.message}`);
  return { success: false, errors };
}
