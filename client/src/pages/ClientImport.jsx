import SheetImport from '../components/SheetImport.jsx';
import { CLIENT_IMPORT_FIELDS, guessClientMapping, rowToClient } from './clientImportFields.js';
import { toDate, toPhone } from './claimImportFields.js';

// Client import — the shared sheet importer, pointed at the client fields.
// rowToClient needs the date coercion passed in because it also folds
// salutation / first / last into the single name this CRM keeps.
const toRecord = (row, mapping) => rowToClient(row, mapping, toDate, toPhone);

export default function ClientImport({ open, onClose, onDone }) {
  return (
    <SheetImport
      open={open}
      onClose={onClose}
      onDone={onDone}
      title="Import Clients"
      noun="client"
      fields={CLIENT_IMPORT_FIELDS}
      guess={guessClientMapping}
      toRecord={toRecord}
      endpoint="/clients/import"
    />
  );
}
