import SheetImport from '../components/SheetImport.jsx';
import { POLICY_IMPORT_FIELDS, guessPolicyMapping, rowToPolicy, toDate, toNumber } from './policyImportFields.js';

// Policy import — the shared sheet importer, pointed at the policy fields.
const toRecord = (row, mapping) => rowToPolicy(row, mapping, toDate, toNumber);

export default function PolicyImport({ open, onClose, onDone }) {
  return (
    <SheetImport
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Import Policies"
      noun="policy"
      fields={POLICY_IMPORT_FIELDS}
      guess={guessPolicyMapping}
      toRecord={toRecord}
      endpoint="/policies/import"
      duplicateOption={{
        label: 'If a policy number is already in the CRM:',
        def: 'update',
        choices: [
          { v: 'update', label: "Update it with the sheet's values (blank cells keep what is there)" },
          { v: 'skip', label: 'Skip it' },
        ],
      }}
    />
  );
}
