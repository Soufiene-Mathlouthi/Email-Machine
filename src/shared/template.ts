export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/{{\s*(\w+)\s*}}/g, (_m, key: string) => vars[key] ?? '')
}
