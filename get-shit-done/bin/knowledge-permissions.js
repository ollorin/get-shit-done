/**
 * knowledge-permissions.js
 *
 * Permission grant/revoke/check infrastructure for bounded autonomous actions.
 * Enables users to grant explicit permissions with limits (cost, count, scope).
 *
 * Usage:
 *   const { grantPermission, checkPermission, revokePermission } = require('./knowledge-permissions.js')
 *   const grant = grantPermission(db, { action: 'delete_file:/test/*', limits: { max_count: 10 } })
 *   const check = checkPermission(db, 'delete_file:/test/foo.txt', {})
 *   const revoke = revokePermission(db, grant.grant_token)
 */

const crypto = require('crypto')

// ─── Permission Grant ──────────────────────────────────────────────────────

/**
 * Grant permission with optional limits and expiration
 * @param {object} db - better-sqlite3 database connection
 * @param {object} options - { action, scope, limits, ttl }
 * @returns {{ granted: boolean, grant_id?: number, grant_token?: string, expires_at?: number, error?: string }}
 */
function grantPermission(db, options) {
  const {
    action,
    scope = 'global',
    limits = {},
    ttl = null,
    metadata = {}
  } = options

  // Validate required fields
  if (!action) {
    return { granted: false, error: 'action is required' }
  }

  // Validate limits schema
  const limitValidation = validateLimits(limits)
  if (!limitValidation.valid) {
    return { granted: false, error: limitValidation.error }
  }

  // Generate revocable token
  const grantToken = crypto.randomBytes(16).toString('hex')

  // Calculate timestamps
  const grantedAt = Date.now()
  const expiresAt = ttl ? grantedAt + ttl : null

  // Insert grant
  try {
    const result = db.prepare(`
      INSERT INTO permissions (grant_token, action_pattern, scope, limits, granted_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      grantToken,
      action,
      scope,
      JSON.stringify(limits),
      grantedAt,
      expiresAt,
      JSON.stringify({ ...metadata, granted_by: 'user' })
    )

    return {
      granted: true,
      grant_id: result.lastInsertRowid,
      grant_token: grantToken,
      expires_at: expiresAt
    }
  } catch (err) {
    return { granted: false, error: err.message }
  }
}

// ─── Permission Revocation ─────────────────────────────────────────────────

/**
 * Revoke permission by token
 * @param {object} db - better-sqlite3 database connection
 * @param {string} grantToken - Token to revoke
 * @returns {{ revoked: boolean, grant_token?: string, error?: string }}
 */
function revokePermission(db, grantToken) {
  if (!grantToken) {
    return { revoked: false, error: 'grant_token is required' }
  }

  try {
    const result = db.prepare(`
      UPDATE permissions
      SET revoked_at = ?
      WHERE grant_token = ?
        AND revoked_at IS NULL
    `).run(Date.now(), grantToken)

    if (result.changes === 0) {
      return { revoked: false, error: 'grant not found or already revoked' }
    }

    return { revoked: true, grant_token: grantToken }
  } catch (err) {
    return { revoked: false, error: err.message }
  }
}

// ─── Permission Check ──────────────────────────────────────────────────────

/**
 * Check if action is permitted
 * @param {object} db - better-sqlite3 database connection
 * @param {string} action - Action to check (e.g., 'delete_file:/test/foo.txt')
 * @param {object} context - { scope?, ... }
 * @returns {{ permitted: boolean, grant_id?: number, grant_token?: string, limits?: object, reason?: string }}
 */
function checkPermission(db, action, context = {}) {
  if (!action) {
    return { permitted: false, reason: 'action is required' }
  }

  const now = Date.now()

  // Get active grants
  try {
    const grants = db.prepare(`
      SELECT id, action_pattern, scope, limits, grant_token
      FROM permissions
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY granted_at DESC
    `).all(now)

    // Check each grant for match
    for (const grant of grants) {
      const patternMatch = matchesPattern(action, grant.action_pattern)
      const scopeMatch = matchesScope(context.scope, grant.scope)

      if (patternMatch && scopeMatch) {
        // Parse limits
        const limits = grant.limits ? JSON.parse(grant.limits) : {}

        // Check limits if any exist
        if (Object.keys(limits).length > 0) {
          const limitCheck = checkLimits(db, grant.id, action, limits)
          if (!limitCheck.allowed) {
            return {
              permitted: false,
              reason: 'limit_exceeded',
              limit_type: limitCheck.exceeded
            }
          }
        }

        return {
          permitted: true,
          grant_id: grant.id,
          grant_token: grant.grant_token,
          limits
        }
      }
    }

    return { permitted: false, reason: 'no_matching_grant' }
  } catch (err) {
    return { permitted: false, reason: 'check_failed: ' + err.message }
  }
}

// ─── List Active Permissions ───────────────────────────────────────────────

/**
 * List all active permission grants
 * @param {object} db - better-sqlite3 database connection
 * @returns {Array<object>} List of active grants
 */
function listActivePermissions(db) {
  const now = Date.now()

  try {
    const grants = db.prepare(`
      SELECT
        id,
        grant_token,
        action_pattern,
        scope,
        limits,
        granted_at,
        expires_at,
        CASE
          WHEN expires_at IS NULL THEN 'permanent'
          ELSE CAST((expires_at - ?) / (24*60*60*1000) AS INTEGER) || ' days'
        END as expires_in
      FROM permissions
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY granted_at DESC
    `).all(now, now)

    return grants.map(grant => ({
      ...grant,
      limits: grant.limits ? JSON.parse(grant.limits) : {}
    }))
  } catch (err) {
    console.warn('Failed to list permissions:', err.message)
    return []
  }
}

// ─── Pattern Matching Helpers ──────────────────────────────────────────────

/**
 * Check if action matches pattern
 * @param {string} action - Action string to check
 * @param {string} pattern - Pattern to match against
 * @returns {boolean} True if action matches pattern
 */
function matchesPattern(action, pattern) {
  // Exact match
  if (action === pattern) return true

  // Wildcard suffix (e.g., "aws:*" matches "aws:s3:upload")
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2)
    return action.startsWith(prefix + ':')
  }

  // Glob-style match (e.g., "delete_file:/test/*")
  if (pattern.includes('*')) {
    const regexPattern = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    const regex = new RegExp(regexPattern)
    return regex.test(action)
  }

  return false
}

/**
 * Check if context scope matches grant scope
 * @param {string} contextScope - Scope from context
 * @param {string} grantScope - Scope from grant
 * @returns {boolean} True if scopes match
 */
function matchesScope(contextScope, grantScope) {
  // Global grants work everywhere
  if (grantScope === 'global') return true

  // If no context scope provided, match 'project' scope (assuming we're in project context)
  // Only 'global' scope would match if context is explicitly 'global'
  if (!contextScope) return true

  // Exact scope match
  if (contextScope === grantScope) return true

  // Path-based scope (e.g., "path:/test/*")
  if (grantScope.startsWith('path:')) {
    const pathPattern = grantScope.slice(5)
    return matchesPattern(contextScope, pathPattern)
  }

  return false
}

// ─── Limit Validation ──────────────────────────────────────────────────────

/**
 * Validate limits schema
 * @param {object} limits - Limits object to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateLimits(limits) {
  if (!limits || typeof limits !== 'object') {
    return { valid: true } // No limits is valid
  }

  // Validate max_cost
  if (limits.max_cost !== undefined) {
    if (typeof limits.max_cost !== 'number' || limits.max_cost < 0) {
      return { valid: false, error: 'max_cost must be a positive number' }
    }
  }

  // Validate max_count
  if (limits.max_count !== undefined) {
    if (typeof limits.max_count !== 'number' || limits.max_count < 1 || !Number.isInteger(limits.max_count)) {
      return { valid: false, error: 'max_count must be a positive integer' }
    }
  }

  // Validate path
  if (limits.path !== undefined) {
    if (typeof limits.path !== 'string') {
      return { valid: false, error: 'path must be a string' }
    }
  }

  return { valid: true }
}

// ─── Limit Checking ────────────────────────────────────────────────────────

/**
 * Check if action is within limits
 * @param {object} db - better-sqlite3 database connection
 * @param {number} grantId - Grant ID to check
 * @param {string} action - Action being performed
 * @param {object} limits - Limits to check against
 * @returns {{ allowed: boolean, exceeded?: string }}
 */
function checkLimits(db, grantId, action, limits) {
  // Check max_count limit
  if (limits.max_count !== undefined) {
    try {
      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM permission_usage
        WHERE grant_id = ?
      `).get(grantId)

      if (result && result.count >= limits.max_count) {
        return { allowed: false, exceeded: 'max_count' }
      }
    } catch (err) {
      console.warn('Failed to check max_count limit:', err.message)
    }
  }

  // Check max_cost limit (requires cost_tracking table from plan 03)
  if (limits.max_cost !== undefined) {
    try {
      // Check if cost_tracking table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='cost_tracking'
      `).get()

      if (tableExists) {
        const result = db.prepare(`
          SELECT SUM(cost) as total_cost
          FROM cost_tracking
          WHERE grant_id = ?
        `).get(grantId)

        const totalCost = result?.total_cost || 0
        if (totalCost >= limits.max_cost) {
          return { allowed: false, exceeded: 'max_cost' }
        }
      }
    } catch (err) {
      console.warn('Failed to check max_cost limit:', err.message)
    }
  }

  return { allowed: true }
}

// ─── Permission Usage Recording ────────────────────────────────────────────

/**
 * Record permission usage for limit tracking
 * @param {object} db - better-sqlite3 database connection
 * @param {number} grantId - Grant ID being used
 * @param {string} action - Action being performed
 * @returns {{ recorded: boolean, error?: string }}
 */
function recordPermissionUsage(db, grantId, action) {
  if (!grantId || !action) {
    return { recorded: false, error: 'grantId and action are required' }
  }

  try {
    db.prepare(`
      INSERT INTO permission_usage (grant_id, action, timestamp)
      VALUES (?, ?, ?)
    `).run(grantId, action, Date.now())

    return { recorded: true }
  } catch (err) {
    return { recorded: false, error: err.message }
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  grantPermission,
  revokePermission,
  checkPermission,
  listActivePermissions,
  matchesPattern,
  validateLimits,
  checkLimits,
  recordPermissionUsage
}
