// Findings register: which phase owns a finding. The mapping is project data, passed as an owner map (--owner-map <json>):
//   { "unit_phase": { "<unit>": "<phase>" }, "class_phase": { "<class>": "<phase>" },
//     "triage_rules": [ ["<regex>", "<phase>"] ], "severity_overrides": { "<id>": { "sev": "HIGH", "source": "<where>" } } }
// A class sweep wins over unit ownership. A unit with no entry is an error, never a guessed phase. With no owner map the unit
// itself owns its findings and every triage row is owned by "triage".
import { collapseUnit, err, ok } from './parse.mjs';

export function ownerPhase(unit, cls, ownerMap) {
  const base = collapseUnit(unit);
  if (!ownerMap) return ok(base);
  const unitPhase = ownerMap.unit_phase ?? {};
  if (!Object.hasOwn(unitPhase, base)) return err(`unmapped unit ${unit}`);
  const classPhase = ownerMap.class_phase ?? {};
  return ok(Object.hasOwn(classPhase, cls) ? classPhase[cls] : unitPhase[base]);
}

// First matching rule wins; the text is the triage id plus its evidence cell.
export function triageOwnerPhase(id, evidence, ownerMap) {
  if (!ownerMap) return ok('triage');
  const text = `${id} ${evidence}`;
  const hit = (ownerMap.triage_rules ?? []).find(([re]) => new RegExp(re).test(text));
  return hit ? ok(hit[1]) : err(`no triage phase rule for ${id}`);
}

// An owner map must be an object whose tables have the shapes above; an invalid map is a failure, not a default.
export function validateOwnerMap(map) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(map)) return err('owner map must be a JSON object');
  for (const k of ['unit_phase', 'class_phase']) {
    if (map[k] !== undefined && !(isObj(map[k]) && Object.values(map[k]).every((v) => typeof v === 'string'))) return err(`owner map ${k} must map names to phase strings`);
  }
  const rules = map.triage_rules;
  if (rules !== undefined) {
    if (!Array.isArray(rules) || !rules.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string')) return err('owner map triage_rules must be [regex, phase] pairs');
    for (const [re] of rules) {
      try { new RegExp(re); } catch (e) { return err(`owner map triage rule ${re}: ${e.message}`); }
    }
  }
  if (map.severity_overrides !== undefined && !isObj(map.severity_overrides)) return err('owner map severity_overrides must be an object');
  return ok(map);
}
