import { isDeepStrictEqual } from 'node:util';

// Mail state is JSON data. Copy mutable containers, retaining immutable string
// leaves so large cached attachments are not duplicated for every transaction.
export function cloneData(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') return structuredClone(value);
    return value;
  }
  if (seen.has(value)) return seen.get(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    const copy = structuredClone(value);
    seen.set(value, copy);
    return copy;
  }
  const copy = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: cloneData(value[key], seen), enumerable: true, configurable: true, writable: true,
    });
  }
  return copy;
}

// String identity/equality is checked before descending into arrays and objects.
// Unlike JSON.stringify comparisons, unchanged attachment strings allocate no
// serialization copies and object property order does not imply a change.
export const sameData = isDeepStrictEqual;
