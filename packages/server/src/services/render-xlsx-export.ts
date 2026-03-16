import ExcelJS from 'exceljs';

export async function exportFragmentsToXlsx(fragments: Array<Record<string, any>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fragments');

  sheet.columns = [
    { header: 'ID', key: 'id', width: 40 },
    { header: 'Titre', key: 'title', width: 40 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Domaine', key: 'domain', width: 20 },
    { header: 'Langue', key: 'lang', width: 8 },
    { header: 'Qualité', key: 'quality', width: 12 },
    { header: 'Auteur', key: 'author', width: 15 },
    { header: 'Créé le', key: 'created_at', width: 20 },
  ];

  for (const f of fragments) {
    sheet.addRow({
      id: f.id, title: f.title, type: f.type, domain: f.domain,
      lang: f.lang, quality: f.quality, author: f.author, created_at: f.created_at,
    });
  }

  // Style header row
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
