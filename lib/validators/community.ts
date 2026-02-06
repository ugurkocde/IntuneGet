/**
 * Community Feature Validators
 * Zod schemas for validating community-related inputs
 */

import { z } from 'zod';

// ============================================
// App Suggestions
// ============================================

export const suggestionSchema = z.object({
  winget_id: z
    .string()
    .min(1, 'WinGet ID is required')
    .max(200, 'WinGet ID must be 200 characters or less')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/,
      'Invalid WinGet ID format (expected: Publisher.AppName)'
    ),
  reason: z
    .string()
    .max(500, 'Reason must be 500 characters or less')
    .transform(sanitizeText)
    .optional()
    .nullable(),
});

export type SuggestionInput = z.infer<typeof suggestionSchema>;

// ============================================
// App Ratings
// ============================================

export const ratingSchema = z.object({
  rating: z
    .number()
    .int('Rating must be a whole number')
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  comment: z
    .string()
    .max(1000, 'Comment must be 1000 characters or less')
    .transform(sanitizeText)
    .optional()
    .nullable(),
  deployment_success: z.boolean().optional().nullable(),
});

export type RatingInput = z.infer<typeof ratingSchema>;

// ============================================
// Detection Rule Feedback
// ============================================

export const feedbackSchema = z.object({
  app_id: z
    .string()
    .min(1, 'App ID is required')
    .max(200, 'App ID must be 200 characters or less'),
  feedback_type: z.enum(['works', 'fails', 'improvement'], {
    message: 'Feedback type must be works, fails, or improvement',
  }),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .transform(sanitizeText)
    .optional()
    .nullable(),
  environment_info: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

// ============================================
// Query Parameters
// ============================================

export const suggestionsQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected', 'implemented', 'all'])
    .optional()
    .default('pending'),
  sort: z.enum(['votes', 'newest', 'oldest']).optional().default('votes'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type SuggestionsQueryInput = z.infer<typeof suggestionsQuerySchema>;

export const ratingsQuerySchema = z.object({
  app_id: z.string().min(1).max(200),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export type RatingsQueryInput = z.infer<typeof ratingsQuerySchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate and parse input against a schema
 * Returns { success: true, data } or { success: false, error }
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format the first error message - Zod v4 uses issues instead of errors
  const issues = result.error.issues || [];
  if (issues.length === 0) {
    return { success: false, error: 'Validation failed' };
  }

  const firstIssue = issues[0];
  const errorMessage = firstIssue.path && firstIssue.path.length > 0
    ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
    : firstIssue.message;

  return { success: false, error: errorMessage };
}

/**
 * Sanitize string input to prevent XSS
 * Removes potentially dangerous characters and patterns
 */
export function sanitizeText(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .replace(/\0/g, '')                    // Remove null bytes
    .replace(/[<>]/g, '')                  // Remove angle brackets
    .replace(/&#\d+;/gi, '')              // Remove numeric HTML entities
    .replace(/&#x[0-9a-f]+;/gi, '')       // Remove hex HTML entities
    .replace(/&[a-z]+;/gi, '')            // Remove named HTML entities
    .replace(/javascript\s*:/gi, '')       // Remove javascript: protocol
    .replace(/data\s*:/gi, '')             // Remove data: URIs
    .replace(/vbscript\s*:/gi, '')         // Remove vbscript: protocol
    .replace(/on\w+\s*=/gi, '')            // Remove event handlers
    .trim();
}

/**
 * Validate UUID format
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 320;
}
