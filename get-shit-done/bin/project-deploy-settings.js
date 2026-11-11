'use strict';

const PERM_KEYS = ['allow', 'deny', 'ask'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const uniq = (xs) => [...new Set(xs)];
const copy = (x) => structuredClone(x);
const key = (t) => JSON.stringify([t.event, t.matcher, t.command]);
const uniqTriples = (ts) => [...new Map(ts.map((t) => [key(t), t])).values()];
const groupMatcher = (g) => g.matcher ?? '';
const isCommand = (h) => h !== null && typeof h === 'object' && h.type === 'command';

const permList = (src, k) => (src && isPlainObject(src.permissions) && Array.isArray(src.permissions[k]) ? src.permissions[k] : []);

const triplesOfGroups = (hooks) => Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
  .filter(isPlainObject)
  .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : [])
    .filter(isCommand)
    .map((h) => ({ event, matcher: groupMatcher(g), command: h.command }))));

const shapeOf = (s) => ({
  permissions: Object.fromEntries(PERM_KEYS.map((k) => [k, uniq(permList(s, k))])),
  hooks: uniqTriples(triplesOfGroups(isPlainObject(s.hooks) ? s.hooks : {})),
});

const diffShape = (to, from) => {
  const fromKeys = new Set(from.hooks.map(key));
  return {
    permissions: Object.fromEntries(PERM_KEYS.map((k) => {
      const fromSet = new Set(from.permissions[k]);
      return [k, to.permissions[k].filter((e) => !fromSet.has(e))];
    })),
    hooks: to.hooks.filter((t) => !fromKeys.has(key(t))),
  };
};

function validate(current) {
  if (!isPlainObject(current)) return 'settings root is not an object';
  if (has(current, 'permissions')) {
    if (!isPlainObject(current.permissions)) return 'permissions is not an object';
    for (const k of PERM_KEYS) {
      if (has(current.permissions, k) && !Array.isArray(current.permissions[k])) return `permissions.${k} is not an array`;
    }
  }
  if (has(current, 'hooks')) {
    if (!isPlainObject(current.hooks)) return 'hooks is not an object';
    for (const [event, groups] of Object.entries(current.hooks)) {
      if (!Array.isArray(groups)) return `hooks.${event} is not an array`;
      for (const g of groups) {
        if (!isPlainObject(g)) return `hooks.${event} has a group that is not an object`;
        if (has(g, 'hooks') && !Array.isArray(g.hooks)) return `hooks.${event} group hooks is not an array`;
      }
    }
  }
  return null;
}

const keepGroup = (event, g, managed) => {
  const cg = copy(g);
  if (!Array.isArray(cg.hooks)) return [cg];
  const hs = cg.hooks.filter((h) => !(isCommand(h) && managed.has(key({ event, matcher: groupMatcher(cg), command: h.command }))));
  if (hs.length === cg.hooks.length) return [cg];
  return hs.length === 0 ? [] : [{ ...cg, hooks: hs }];
};

function mergeSettings(current, prev, fragment) {
  const base = current === null ? {} : current;
  const problem = current === null ? null : validate(current);
  if (problem) return { ok: false, reason: problem };

  const frag = fragment ?? {};
  const fragHooks = isPlainObject(frag.hooks) ? frag.hooks : {};
  const curPerms = has(base, 'permissions') ? base.permissions : undefined;
  const curHooks = has(base, 'hooks') ? base.hooks : undefined;

  const computed = Object.fromEntries(PERM_KEYS.map((k) => {
    const fragSet = new Set(permList(frag, k));
    const prevSet = new Set(permList(prev, k));
    const cur = curPerms !== undefined && Array.isArray(curPerms[k]) ? uniq(curPerms[k]) : [];
    const kept = cur.filter((e) => !(prevSet.has(e) && !fragSet.has(e)));
    const keptSet = new Set(kept);
    return [k, [...kept, ...uniq(permList(frag, k)).filter((e) => !keptSet.has(e))]];
  }));
  const extraPerms = PERM_KEYS
    .filter((k) => !(curPerms !== undefined && has(curPerms, k)) && computed[k].length > 0)
    .map((k) => [k, computed[k]]);
  const permEntries = curPerms === undefined
    ? extraPerms
    : [...Object.keys(curPerms).map((k) => [k, PERM_KEYS.includes(k) ? computed[k] : copy(curPerms[k])]), ...extraPerms];
  const permissionsValue = curPerms === undefined && permEntries.length === 0 ? undefined : Object.fromEntries(permEntries);

  const prevTriples = Array.isArray(prev?.hooks)
    ? prev.hooks.map((t) => ({ event: t.event, matcher: t.matcher ?? '', command: t.command }))
    : [];
  const managed = new Set([...prevTriples, ...triplesOfGroups(fragHooks)].map(key));
  const events = uniq([...(curHooks === undefined ? [] : Object.keys(curHooks)), ...Object.keys(fragHooks)]);
  const hooksResult = Object.fromEntries(events.flatMap((event) => {
    const fresh = (Array.isArray(fragHooks[event]) ? fragHooks[event] : []).map(copy);
    const kept = (curHooks !== undefined && Array.isArray(curHooks[event]) ? curHooks[event] : [])
      .flatMap((g) => keepGroup(event, g, managed));
    const groups = [...fresh, ...kept];
    return groups.length > 0 ? [[event, groups]] : [];
  }));

  const top = Object.keys(base).map((k) => {
    if (k === 'permissions') return [k, permissionsValue];
    if (k === 'hooks') return [k, hooksResult];
    return [k, copy(base[k])];
  });
  const appended = [
    ...(curPerms === undefined && permissionsValue !== undefined ? [['permissions', permissionsValue]] : []),
    ...(curHooks === undefined && Object.keys(hooksResult).length > 0 ? [['hooks', hooksResult]] : []),
  ];
  const settings = Object.fromEntries([...top, ...appended]);

  const curShape = shapeOf(base);
  const settingsShape = shapeOf(settings);
  return {
    ok: true,
    settings,
    deployed: shapeOf(frag),
    changed: JSON.stringify(settings) !== JSON.stringify(base),
    added: diffShape(settingsShape, curShape),
    removed: diffShape(curShape, settingsShape),
  };
}

const serializeSettings = (settings) => `${JSON.stringify(settings, null, 2)}\n`;

module.exports = { mergeSettings, serializeSettings };
