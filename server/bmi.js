// Same as client/src/pages/bmi.js. BMI from height (cm), weight (kg) and date of birth — shown on the onboarding form and in the CRM.
// Adults get the standard bands; for anyone under 18 BMI depends on age, so only the number is given.
export function bmiOf(heightCm, weightKg, dob) {
  const h = Number(heightCm), w = Number(weightKg);
  if (!(h >= 30 && h <= 250 && w >= 1 && w <= 250)) return null;
  const bmi = Math.round((w / ((h / 100) ** 2)) * 10) / 10;
  let age = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dob || ''))) {
    const [y, m, d] = String(dob).split('-').map(Number);
    const n = new Date();
    age = n.getFullYear() - y - (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d) ? 1 : 0);
  }
  if (age !== null && age >= 0 && age < 18) return { bmi, age, tone: 'child', label: `Child (${age < 1 ? 'under 1 yr' : age + ' yr'}) — compare on an age chart` };
  const [label, tone] = bmi < 18.5 ? ['Underweight', 'warn'] : bmi < 25 ? ['Normal', 'ok'] : bmi < 30 ? ['Overweight', 'warn'] : ['Obese', 'bad'];
  return { bmi, age, tone, label };
}
export const bmiText = (b) => (b ? `${b.bmi} · ${b.label}` : '');
