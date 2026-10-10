export function searchAccessDenied(output: string) {
  try { const value=JSON.parse(output); return value?.error === 'Search HTTP 403' || value?.status === 'access_denied'; }
  catch { return false; }
}
export class SearchAccessDenied extends Error {
  constructor() { super('Search HTTP 403'); this.name='SearchAccessDenied'; }
}
