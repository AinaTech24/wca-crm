// New Business or Renewal — what a policy is for the office, as opposed to its
// Policy Type, which for most products is the cover variant (Package, Family
// Floater…) and only for the rest says Fresh / Renewal.
//
// The field is set on the policy form or from an import. Where it's left blank
// (and for every policy that predates the field) it is worked out once:
//   - a Policy Type of Renewal or Rollover says so outright;
//   - otherwise the policy continues an earlier one: the same policy number, or
//     the same client and product with the earlier policy ending within 60 days
//     of this one starting. A second vehicle with a different registration is
//     not a continuation, nor is a policy taken after a long gap.
// Anything else is New Business. The value is stored, so a wrong guess is fixed
// by editing the policy and is never recalculated over.

export const BUSINESS_TYPES = ['New', 'Renewal'];

/** The stored value for whatever a form or a sheet says, or '' when it says nothing usable. */
export function normalizeBusinessType(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/renew|roll ?over|^rn$|^r$/.test(s)) return 'Renewal';
  if (/new|fresh|^nb$|^n$|first/.test(s)) return 'New';
  return '';
}

const ISO = "'^\\d{4}-\\d{2}-\\d{2}'";
const day = (c) => `substr(${c}, 1, 10)::date`;
const regNo = (c) => `UPPER(REPLACE(COALESCE(${c}, ''), ' ', ''))`;

const CONTINUES_EARLIER = `EXISTS (
  SELECT 1 FROM policies o
  WHERE o.id <> p.id
    AND o.period_from ~ ${ISO} AND p.period_from ~ ${ISO}
    AND ${day('o.period_from')} < ${day('p.period_from')}
    AND (
      (NULLIF(TRIM(p.policy_number), '') IS NOT NULL AND LOWER(TRIM(o.policy_number)) = LOWER(TRIM(p.policy_number)))
      OR (
        COALESCE(NULLIF(o.insurance_type, ''), '-') = COALESCE(NULLIF(p.insurance_type, ''), '-')
        AND ((p.client_id IS NOT NULL AND o.client_id = p.client_id)
          OR (NULLIF(TRIM(p.insured_name), '') IS NOT NULL AND LOWER(TRIM(o.insured_name)) = LOWER(TRIM(p.insured_name))))
        AND NOT (${regNo('o.reg_no')} <> '' AND ${regNo('p.reg_no')} <> '' AND ${regNo('o.reg_no')} <> ${regNo('p.reg_no')})
        AND o.period_to ~ ${ISO}
        AND ABS(${day('p.period_from')} - ${day('o.period_to')}) <= 60
      )
    )
)`;

/** Fills in business_type for unclassified policies — one policy, or all of them when no id is given. */
export async function classifyBusiness(db, id = null) {
  await db.prepare(`
    UPDATE policies p SET business_type = CASE
      WHEN p.policy_type ~* '^\\s*(renew|roll\\s*over)' THEN 'Renewal'
      WHEN ${CONTINUES_EARLIER} THEN 'Renewal'
      ELSE 'New' END
    WHERE COALESCE(p.business_type, '') = ''${id === null ? '' : ' AND p.id = ?'}`).run(...(id === null ? [] : [id]));
}
