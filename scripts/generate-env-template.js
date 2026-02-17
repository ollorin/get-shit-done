#!/usr/bin/env node
/**
 * Generate .env.template from required environment variables
 */

const fs = require('fs');
const path = require('path');

const ENV_VARS = [
  {
    name: 'TELEGRAM_BOT_TOKEN',
    required: true,
    description: 'Telegram bot token from @BotFather',
    example: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
  },
  {
    name: 'TELEGRAM_OWNER_ID',
    required: true,
    description: 'Your Telegram user ID (send /start to @userinfobot to get it)',
    example: '123456789'
  },
  {
    name: 'ANTHROPIC_API_KEY',
    required: false,
    description: 'Claude API key (optional - only needed if not using Claude Code subscription)',
    example: 'sk-ant-...'
  },
  {
    name: 'NODE_ENV',
    required: false,
    description: 'Runtime environment',
    default: 'development',
    options: ['development', 'production']
  },
  {
    name: 'LOG_LEVEL',
    required: false,
    description: 'Logging verbosity',
    default: 'info',
    options: ['debug', 'info', 'warn', 'error']
  },
  {
    name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    required: false,
    description: 'OpenTelemetry collector endpoint (optional - for distributed tracing)',
    example: 'http://localhost:4317'
  },
  {
    name: 'OTEL_SERVICE_NAME',
    required: false,
    description: 'Service name for OpenTelemetry traces',
    default: 'gsd'
  }
];

function generateEnvTemplate() {
  const lines = [
    '# GSD Environment Configuration',
    '# Copy this file to .env and fill in your values',
    '# Never commit .env to version control!',
    '',
    '# ========================================',
    '# Required Variables',
    '# ========================================',
    ''
  ];

  // Required vars first
  for (const v of ENV_VARS.filter(v => v.required)) {
    lines.push(`# ${v.description}`);
    if (v.example) lines.push(`# Example: ${v.example}`);
    lines.push(`${v.name}=`);
    lines.push('');
  }

  lines.push('# ========================================');
  lines.push('# Optional Variables');
  lines.push('# ========================================');
  lines.push('');

  // Optional vars
  for (const v of ENV_VARS.filter(v => !v.required)) {
    lines.push(`# ${v.description}`);
    if (v.options) lines.push(`# Options: ${v.options.join(' | ')}`);
    if (v.default) lines.push(`# Default: ${v.default}`);
    if (v.example) lines.push(`# Example: ${v.example}`);
    lines.push(`# ${v.name}=${v.default || ''}`);
    lines.push('');
  }

  const content = lines.join('\n');
  const templatePath = path.join(__dirname, '..', '.env.template');

  fs.writeFileSync(templatePath, content);
  console.log('       Generated .env.template');
}

module.exports = generateEnvTemplate;

if (require.main === module) {
  generateEnvTemplate();
}
