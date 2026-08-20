// Display-side only. The classification rule itself lives on the server
// (server/departments.js) and is stamped onto each record on save, so this
// file never has to know which products belong where.
export const DEPARTMENTS = ['Personal Lines', 'Commercial Lines'];
export const DEPT_BADGE = { 'Personal Lines': 'blue', 'Commercial Lines': 'orange' };
export const DEPT_SHORT = { 'Personal Lines': 'Personal', 'Commercial Lines': 'Commercial' };

export function DeptBadge({ value }) {
  if (!value) return null;
  return <span className={'badge ' + (DEPT_BADGE[value] || '')}>{DEPT_SHORT[value] || value}</span>;
}
