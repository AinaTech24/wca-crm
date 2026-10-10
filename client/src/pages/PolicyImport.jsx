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
    />
  );
}
