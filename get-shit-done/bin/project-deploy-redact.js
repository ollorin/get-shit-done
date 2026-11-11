'use strict';

const { scanText } = require('./project-deploy-scan.js');

const redactString = (s) => {
  const hits = scanText(s);
  return hits.length > 0 ? `<redacted:${hits[0].pattern}>` : s;
};

function redactShape(shape) {
  if (typeof shape === 'string') return redactString(shape);
  if (Array.isArray(shape)) return shape.map(redactShape);
  if (shape !== null && typeof shape === 'object') {
    return Object.fromEntries(Object.entries(shape).map(([k, v]) => [redactString(k), redactShape(v)]));
  }
  return shape;
}

const settingsReport = (settingsPlan, secretFound) => (secretFound
  ? { action: settingsPlan.action, added: null, removed: null, redacted: true }
  : { action: settingsPlan.action, added: redactShape(settingsPlan.added), removed: redactShape(settingsPlan.removed) });

module.exports = { redactShape, settingsReport };
