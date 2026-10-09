import SheetImport from '../components/SheetImport.jsx';
import { CLAIM_IMPORT_FIELDS, guessMapping, rowToClaim } from './claimImportFields.js';

// Claim import — the shared sheet importer, pointed at the claim fields.
export default function ClaimImport({ open, onClose, onDone }) {
  return (
    <SheetImport
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Import Claims"
      noun="claim"
      fields={CLAIM_IMPORT_FIELDS}
      guess={guessMapping}
      toRecord={rowToClaim}
      endpoint="/claims/import"
    />
  );
}
