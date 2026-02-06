/**
 * Rate Limiting Middleware
 * Supabase-backed rate limiter with in-memory fallback
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ============================================
// Types
// ============================================

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional custom key generator */
  keyGenerator?: (request: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ============================================
// In-Memory Fallback Store
// ============================================

const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// ============================================
// Default Key Generators
// ============================================

export function getUserKey(userId: string): string {
  return `user:${userId}`;
}

export function getIpKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  return `ip:${ip}`;
}

export function getOrgKey(orgId: string): string {
  return `org:${orgId}`;
}

// ============================================
// Preset Configurations
// ============================================

/** Community endpoints: 10 requests/minute per user */
export const COMMUNITY_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60 * 1000,
};

/** MSP API endpoints: 60 requests/minute per organization */
export const MSP_RATE_LIMIT: RateLimitConfig = {
  limit: 60,
  windowMs: 60 * 1000,
};

/** Public endpoints: 30 requests/minute per IP */
export const PUBLIC_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowMs: 60 * 1000,
};

/** Strict limit for sensitive operations: 5 requests/minute */
export const STRICT_RATE_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 60 * 1000,
};

// ============================================
// Rate Limiting Functions
// ============================================

export interface RateLimitResult {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit via Supabase RPC (atomic, distributed)
 */
async function checkRateLimitDB(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const supabase = createServerClient();

  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_window_ms: config.windowMs,
    p_limit: config.limit,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Rate limit RPC returned no data');
  }

  const result = data as unknown as { limited: boolean; remaining: number; reset_at: number };

  return {
    limited: result.limited,
    limit: config.limit,
    remaining: result.remaining,
    resetAt: result.reset_at,
  };
}

/**
 * In-memory rate limit check (fallback)
 */
function checkRateLimitMemory(key: string, config: RateLimitConfig): RateLimitResult {
  cleanupExpiredEntries();

  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  entry.count++;

  const remaining = Math.max(0, config.limit - entry.count);
  const limited = entry.count > config.limit;

  return {
    limited,
    limit: config.limit,
    remaining,
    resetAt: entry.resetAt,
  };
}

/**
 * Check rate limit with Supabase backend, falling back to in-memory
 */
export async function checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    return await checkRateLimitDB(key, config);
  } catch {
    return checkRateLimitMemory(key, config);
  }
}

/**
 * Apply rate limiting and return appropriate response if exceeded.
 * Returns null if not rate limited, or a NextResponse if rate limited.
 */
export async function applyRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const result = await checkRateLimit(key, config);

  if (result.limited) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);

    return NextResponse.json(
      {
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
          'Retry-After': retryAfter.toString(),
        },
      }
    );
  }

  return null;
}

/**
 * Add rate limit headers to a successful response
 */
export async function addRateLimitHeaders(
  response: NextResponse,
  key: string,
  config: RateLimitConfig
): Promise<NextResponse> {
  const result = await checkRateLimit(key, config);

  const remaining = Math.max(0, result.remaining);

  response.headers.set('X-RateLimit-Limit', config.limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

  return response;
}

// ============================================
// Higher-Order Function for Route Handlers
// ============================================

type RouteHandler = (request: Request) => Promise<NextResponse>;

export function withRateLimit(
  handler: RouteHandler,
  config: RateLimitConfig,
  keyGenerator: (request: Request) => string | null
): RouteHandler {
  return async (request: Request) => {
    const key = keyGenerator(request);

    if (!key) {
      return handler(request);
    }

    const rateLimitResponse = await applyRateLimit(key, config);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    return handler(request);
  };
}

// ============================================
// Utility Functions
// ============================================

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

export async function getRateLimitStatus(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    return await checkRateLimitDB(key, config);
  } catch {
    const entry = rateLimitStore.get(key);
    const now = Date.now();

    if (!entry || entry.resetAt < now) {
      return {
        limited: false,
        limit: config.limit,
        remaining: config.limit,
        resetAt: now + config.windowMs,
      };
    }

    return {
      limited: entry.count >= config.limit,
      limit: config.limit,
      remaining: Math.max(0, config.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }
}

export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}
