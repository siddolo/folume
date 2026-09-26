export function preference<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`folume.${key}`) ?? 'null') ?? fallback; }
  catch { return fallback; }
}
export function setPreference(key: string, value: unknown) {
  try { localStorage.setItem(`folume.${key}`, JSON.stringify(value)); } catch { /* UI preferences are optional. */ }
}
