import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../lib/api.js';
import { Banner } from './ui.jsx';

const COLUMNS = [
  'Participant Name',
  "Father's Name",
  'Age',
  'Mobile',
  'Address',
  'Location',
  'Events Participating',
];

/**
 * Builds the download template. Academy contact details are deliberately left
 * out of the sample row: blank Mobile/Address/Location fall back to the
 * academy's own on import, so a coach only fills them in for exceptions.
 */
function buildTemplate(events) {
  const sample = {
    'Participant Name': 'Karthik R',
    "Father's Name": 'Ramesh K',
    Age: 17,
    Mobile: '',
    Address: '',
    Location: '',
    'Events Participating': events.slice(0, 2).map((e) => e.eventId).join(', '),
  };

  const sheet = XLSX.utils.json_to_sheet([sample], { header: COLUMNS });
  sheet['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(16, c.length + 4) }));

  // A second sheet listing the valid codes, so coaches are not guessing at them.
  const reference = XLSX.utils.json_to_sheet(
    events.map((e) => ({ Code: e.eventId, Event: e.name, Category: e.category }))
  );
  reference['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 16 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Participants');
  XLSX.utils.book_append_sheet(book, reference, 'Event Codes');
  return book;
}

export default function BulkUpload({ events, onImported }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  function download() {
    XLSX.writeFile(buildTemplate(events), 'veeran-participants-template.xlsx');
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError('');
    setRejected([]);
    setResult(null);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (rows.length === 0) throw new Error('That file has no data rows.');

      const data = await api.post('/participants/bulk', { rows });
      setResult(data);
      await onImported?.();
    } catch (err) {
      setError(err.message);
      setRejected(err.rejected ?? []);
    } finally {
      setBusy(false);
      // Reset so re-picking the same corrected file still fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="card">
      <h2>Bulk upload participants</h2>
      <p>
        Download the template, fill one row per participant, then upload it. Leave Mobile,
        Address and Location blank to inherit your academy details. Rows are all-or-nothing —
        if any row fails validation, nothing is imported.
      </p>

      <Banner>{error}</Banner>

      {rejected.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Name</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.name || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {Object.values(r.errors).join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <>
          <Banner kind="ok">
            Imported {result.importedCount} participant
            {result.importedCount === 1 ? '' : 's'}. Each signs in with the UID below and the
            default password.
          </Banner>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Name</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {result.participants.map((p) => (
                  <tr key={p.participantId}>
                    <td>{p.participantId}</td>
                    <td>{p.participantName}</td>
                    <td>{p.defaultPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" className="ghost" onClick={download}>
          Download template
        </button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Importing…' : 'Upload filled sheet'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={upload}
          style={{ display: 'none' }}
        />
      </div>
    </section>
  );
}
