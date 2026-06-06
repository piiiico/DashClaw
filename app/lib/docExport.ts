/**
 * Client-side document export utilities.
 * Converts markdown content to PDF, Word (.docx), or Excel (.xlsx).
 */

export async function exportToPdf(content: string, filename: string): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default;
  const container = document.createElement('div');
  container.textContent = content;
  container.style.cssText = 'font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a1a; padding: 20px; white-space: pre-wrap;';

  await html2pdf()
    .set({
      margin: [10, 10, 10, 10],
      filename: `${filename}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    })
    .from(container)
    .save();
}

export async function exportToWord(content: string, filename: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

  const lines = content.split('\n');
  const children: InstanceType<typeof Paragraph>[] = [];

  for (const line of lines) {
    if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push(new Paragraph({
        children: [new TextRun(line.slice(2))],
        bullet: { level: 0 },
      }));
    } else if (line.startsWith('```') || line.trim() === '') {
      if (line.trim() === '') children.push(new Paragraph({ text: '' }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, font: line.startsWith('    ') || line.startsWith('\t') ? 'Courier New' : undefined })],
      }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${filename}.docx`);
}

export async function exportToExcel(content: string, filename: string): Promise<void> {
  const XLSX = await import('@e965/xlsx');

  const tableMatch = content.match(/\|(.+)\|\n\|[-| :]+\|\n((\|.+\|\n?)+)/);
  let ws;
  if (tableMatch) {
    const headerLine = tableMatch[1] as string;
    const headers = headerLine.split('|').map((h) => h.trim()).filter(Boolean);
    const bodyLines = (tableMatch[2] as string).trim().split('\n');
    const rows = bodyLines.map((line) =>
      line.split('|').map((c) => c.trim()).filter(Boolean)
    );
    const data = [headers, ...rows];
    ws = XLSX.utils.aoa_to_sheet(data);
  } else {
    const lines = content.split('\n').map((l) => [l]);
    ws = XLSX.utils.aoa_to_sheet(lines);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Document');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
