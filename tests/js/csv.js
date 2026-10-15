// A small RFC 4180 CSV reader for the tests (quoted fields, "" escapes, CRLF).
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) };
}
