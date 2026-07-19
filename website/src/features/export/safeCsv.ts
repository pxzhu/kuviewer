const spreadsheetFormulaPrefix = /^[\t\r\n ]*[=+\-@]/;

export function safeCsvCell(value: unknown) {
  let text = String(value).replace(/\0/g, '');
  if (spreadsheetFormulaPrefix.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function safeCsvDocument(headers: string[], rows: unknown[][]) {
  return `${headers.map(safeCsvCell).join(',')}\n${rows.map((row) => row.map(safeCsvCell).join(',')).join('\n')}\n`;
}
