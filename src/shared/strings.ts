import strings from './strings.it.json' with { type: 'json' };

export { strings };

/** Named placeholders keep complete sentences in the copy catalog. No HTML interpolation. */
export function formatString(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}
