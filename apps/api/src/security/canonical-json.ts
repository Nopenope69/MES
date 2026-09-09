// apps/api/src/security/canonical-json.ts
import crypto from 'crypto';

/**
 * RFC 8785 (JSON Canonicalization Scheme - JCS) Deterministic Serializer.
 *
 * Requirements:
 * 1. Whitespace: No whitespace outside of string literals.
 * 2. Object keys: Sorted lexicographically by UTF-16 code units recursively.
 * 3. Numbers: Serialized per ECMAScript specifications (with -0 mapped to "0", finite check).
 * 4. Strings: Standard JSON escaping per RFC 8259.
 * 5. Arrays: Serialized sequentially without whitespace.
 */
export function canonicalizeJson(data: any): string {
  if (data === null) {
    return 'null';
  }

  if (typeof data === 'boolean') {
    return data ? 'true' : 'false';
  }

  if (typeof data === 'number') {
    if (!Number.isFinite(data)) {
      throw new TypeError('Non-finite numbers cannot be canonicalized to JSON per RFC 8785');
    }
    // Per RFC 8785: -0 must be serialized as 0
    if (Object.is(data, -0) || data === 0) {
      return '0';
    }
    return JSON.stringify(data);
  }

  if (typeof data === 'string') {
    return JSON.stringify(data);
  }

  if (typeof data === 'object') {
    // If the object provides a custom toJSON method (e.g. Date), invoke it first
    if (typeof data.toJSON === 'function') {
      return canonicalizeJson(data.toJSON());
    }

    if (Array.isArray(data)) {
      const items = data.map((item) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return 'null';
        }
        return canonicalizeJson(item);
      });
      return `[${items.join(',')}]`;
    }

    // Filter out undefined, function, or symbol properties
    const keys = Object.keys(data).filter(
      (k) => data[k] !== undefined && typeof data[k] !== 'function' && typeof data[k] !== 'symbol'
    );

    // RFC 8785 Section 3.2.3: Object keys MUST be sorted lexicographically by UTF-16 code units
    keys.sort((a, b) => {
      const minLen = Math.min(a.length, b.length);
      for (let i = 0; i < minLen; i++) {
        const codeA = a.charCodeAt(i);
        const codeB = b.charCodeAt(i);
        if (codeA !== codeB) {
          return codeA - codeB;
        }
      }
      return a.length - b.length;
    });

    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(data[key])}`);
    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Unsupported type for canonical JSON: ${typeof data}`);
}

/**
 * Computes deterministic SHA-256 digest of an RFC 8785 canonicalized envelope.
 */
export function computeCanonicalSha256(data: any): string {
  const canonical = canonicalizeJson(data);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
