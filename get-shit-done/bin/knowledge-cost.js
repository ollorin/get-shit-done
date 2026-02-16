/**
 * knowledge-cost.js
 *
 * Cost tracking and budget management for knowledge system operations.
 * Provides graduated budget alerts (50%/80%/90%/100%) and circuit breaker
 * functionality to prevent budget overruns.
 *
 * Usage:
 *   const { trackCost, getTotalCost, checkBudgetAlerts } = require('./knowledge-cost.js')
 *   const { openKnowledgeDB } = require('./knowledge-db.js')
 *   const conn = openKnowledgeDB('project')
 *   trackCost(conn.db, { action: 'api_call', cost: 0.50 })
 */

const fs = require('fs')
const path = require('path')

// ─── Constants ─────────────────────────────────────────────────────────────

const ALERT_THRESHOLDS = [0.5, 0.8, 0.9, 1.0]
const DEFAULT_BUDGET = { daily: 5.0, weekly: 25.0 }

// ─── Period Calculation ────────────────────────────────────────────────────

/**
 * Calculate period start timestamp
 * @param {string} period - 'daily' or 'weekly'
 * @returns {number} Timestamp in milliseconds
 */
function getStartOfPeriod(period) {
  const now = new Date()

  if (period === 'daily') {
    // Start of current day
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  } else if (period === 'weekly') {
    // Start of current week (Sunday)
    const day = now.getDay()
    const diff = now.getDate() - day
    now.setDate(diff)
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  }

  throw new Error(`Unknown period: ${period}`)
}

// ─── Budget Configuration ──────────────────────────────────────────────────

/**
 * Get budget limit for period
 * @param {string} period - 'daily' or 'weekly'
 * @returns {number} Budget limit in dollars
 */
function getBudgetLimit(period) {
  // Try to load from config file
  const configPath = path.join(
    process.cwd(),
    '.planning',
    'knowledge',
    'permissions-config.json'
  )

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.budget && config.budget[period]) {
        return config.budget[period]
      }
    } catch (err) {
      // Fall through to default
    }
  }

  return DEFAULT_BUDGET[period] || 0
}

// ─── Cost Tracking ─────────────────────────────────────────────────────────

/**
 * Get total cost for period
 * @param {object} db - better-sqlite3 database connection
 * @param {string} period - 'daily' or 'weekly'
 * @returns {number} Total cost in dollars
 */
function getTotalCost(db, period = 'daily') {
  const periodStart = getStartOfPeriod(period)

  const result = db
    .prepare(
      `SELECT SUM(cost) as total FROM cost_tracking WHERE timestamp >= ?`
    )
    .get(periodStart)

  return result.total || 0
}

/**
 * Record cost for an action
 * @param {object} db - better-sqlite3 database connection
 * @param {object} params - { action, cost, metadata }
 * @returns {object} { tracked: true, cost, total_cost, alerts }
 */
function trackCost(db, { action, cost, metadata = {} }) {
  const timestamp = Date.now()
  const metadataStr = JSON.stringify(metadata)

  // Insert cost record
  db.prepare(
    `INSERT INTO cost_tracking (action, cost, timestamp, metadata) VALUES (?, ?, ?, ?)`
  ).run(action, cost, timestamp, metadataStr)

  // Check budget alerts (cost already in DB, so no newCost param)
  const alertResult = checkBudgetAlerts(db, 0)

  return {
    tracked: true,
    cost,
    total_cost: alertResult.total_cost,
    alerts: alertResult.alerts,
    circuit_breaker_enabled: alertResult.circuit_breaker_enabled
  }
}

// ─── Budget Alerts ─────────────────────────────────────────────────────────

/**
 * Get alert severity level for threshold
 * @param {number} threshold - Alert threshold (0.5, 0.8, 0.9, 1.0)
 * @returns {string} Alert level
 */
function getAlertLevel(threshold) {
  if (threshold >= 1.0) return 'critical'
  if (threshold >= 0.9) return 'high'
  if (threshold >= 0.8) return 'warning'
  return 'info'
}

/**
 * Check if alert already fired for this threshold and period
 * @param {object} db - better-sqlite3 database connection
 * @param {number} threshold - Alert threshold
 * @param {number} periodStart - Period start timestamp
 * @returns {boolean} True if alert already fired
 */
function hasAlertFired(db, threshold, periodStart) {
  const result = db
    .prepare(
      `SELECT id FROM budget_alerts WHERE threshold = ? AND period_start = ?`
    )
    .get(threshold, periodStart)

  return !!result
}

/**
 * Mark alert as fired for this threshold and period
 * @param {object} db - better-sqlite3 database connection
 * @param {number} threshold - Alert threshold
 * @param {number} periodStart - Period start timestamp
 */
function markAlertFired(db, threshold, periodStart) {
  const firedAt = Date.now()

  db.prepare(
    `INSERT INTO budget_alerts (threshold, period_start, fired_at) VALUES (?, ?, ?)`
  ).run(threshold, periodStart, firedAt)
}

/**
 * Check budget and fire alerts if needed
 * @param {object} db - better-sqlite3 database connection
 * @param {number} newCost - New cost to be added (default 0)
 * @returns {object} { total_cost, budget, percentage, alerts, circuit_breaker_enabled }
 */
function checkBudgetAlerts(db, newCost = 0) {
  const totalCost = getTotalCost(db, 'daily') + newCost
  const budget = getBudgetLimit('daily')
  const percentage = budget > 0 ? totalCost / budget : 0
  const periodStart = getStartOfPeriod('daily')

  const alerts = []

  // Check each threshold
  for (const threshold of ALERT_THRESHOLDS) {
    if (percentage >= threshold) {
      // Check if alert already fired
      if (!hasAlertFired(db, threshold, periodStart)) {
        const level = getAlertLevel(threshold)
        alerts.push({
          threshold,
          level,
          total_cost: totalCost,
          budget,
          percentage
        })

        // Mark as fired
        markAlertFired(db, threshold, periodStart)

        // Enable circuit breaker at 100%
        if (threshold === 1.0) {
          enableCircuitBreaker(db, 'budget_exceeded')
        }
      }
    }
  }

  // Get circuit breaker state
  const circuitBreakerState = isCircuitBreakerEnabled(db)

  return {
    total_cost: totalCost,
    budget,
    percentage,
    alerts,
    circuit_breaker_enabled: circuitBreakerState.enabled
  }
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────

/**
 * Enable circuit breaker
 * @param {object} db - better-sqlite3 database connection
 * @param {string} reason - Reason for enabling
 * @returns {object} { enabled: true, reason, enabled_at }
 */
function enableCircuitBreaker(db, reason) {
  const enabledAt = Date.now()

  db.prepare(
    `UPDATE circuit_breaker SET enabled = 1, reason = ?, enabled_at = ? WHERE id = 1`
  ).run(reason, enabledAt)

  return {
    enabled: true,
    reason,
    enabled_at: enabledAt
  }
}

/**
 * Disable circuit breaker
 * @param {object} db - better-sqlite3 database connection
 * @returns {object} { enabled: false }
 */
function disableCircuitBreaker(db) {
  db.prepare(
    `UPDATE circuit_breaker SET enabled = 0, reason = NULL, enabled_at = NULL WHERE id = 1`
  ).run()

  return { enabled: false }
}

/**
 * Check if circuit breaker is enabled
 * @param {object} db - better-sqlite3 database connection
 * @returns {object} { enabled: boolean, reason?: string, enabled_at?: number }
 */
function isCircuitBreakerEnabled(db) {
  const result = db
    .prepare(`SELECT enabled, reason, enabled_at FROM circuit_breaker WHERE id = 1`)
    .get()

  if (!result) {
    return { enabled: false }
  }

  return {
    enabled: !!result.enabled,
    reason: result.reason || undefined,
    enabled_at: result.enabled_at || undefined
  }
}

/**
 * Check if costly actions should be blocked
 * @param {object} db - better-sqlite3 database connection
 * @returns {object} { blocked: boolean, reason?: string }
 */
function shouldBlockCostlyAction(db) {
  const state = isCircuitBreakerEnabled(db)

  if (state.enabled) {
    return {
      blocked: true,
      reason: state.reason || 'Circuit breaker enabled'
    }
  }

  return { blocked: false }
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  // Period calculation
  getStartOfPeriod,
  getBudgetLimit,

  // Cost tracking
  trackCost,
  getTotalCost,

  // Budget alerts
  checkBudgetAlerts,
  getAlertLevel,
  hasAlertFired,
  markAlertFired,

  // Circuit breaker
  enableCircuitBreaker,
  disableCircuitBreaker,
  isCircuitBreakerEnabled,
  shouldBlockCostlyAction
}
