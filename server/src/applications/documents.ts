import PDFDocument from 'pdfkit';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { TailoredCvData } from './tailor';

interface CvLines {
  name: string;
  contactLine: string;
  sections: { heading: string; lines: string[] }[];
}

/** Single source of layout truth so the PDF and DOCX always contain the same content. */
export function layoutCv(data: TailoredCvData): CvLines {
  const contactLine = [data.contact.email, data.contact.phone, data.contact.location].filter(Boolean).join('  |  ');
  const sections: CvLines['sections'] = [];
  if (data.summary) sections.push({ heading: 'Summary', lines: [data.summary] });
  if (data.skills.length) sections.push({ heading: 'Skills', lines: [data.skills.join(', ')] });
  if (data.experience.length) {
    sections.push({
      heading: 'Experience',
      lines: data.experience.flatMap((role) => {
        const dates = `${role.start} – ${role.end ?? 'Present'}`;
        return [`${role.title} · ${role.company} (${dates})`, ...role.bullets.map((b) => `• ${b}`)];
      }),
    });
  }
  if (data.education.length) {
    sections.push({
      heading: 'Education',
      lines: data.education.map((e) => [e.degree, e.field, e.institution, e.year].filter(Boolean).join(', ')),
    });
  }
  if (data.certifications.length) sections.push({ heading: 'Certifications', lines: data.certifications });
  if (data.languages.length) sections.push({ heading: 'Languages', lines: [data.languages.join(', ')] });
  return { name: data.name, contactLine, sections };
}

export function renderCvPdf(data: TailoredCvData): Promise<Buffer> {
  const layout = layoutCv(data);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${layout.name} – CV`, Author: layout.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(layout.name);
    doc.font('Helvetica').fontSize(9.5).fillColor('#444').text(layout.contactLine).moveDown(0.8);
    for (const section of layout.sections) {
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text(section.heading.toUpperCase()).moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor('#222');
      for (const line of section.lines) doc.text(line, { paragraphGap: 2 });
      doc.moveDown(0.7);
    }
    doc.end();
  });
}

export async function renderCvDocx(data: TailoredCvData): Promise<Buffer> {
  const layout = layoutCv(data);
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: layout.name, bold: true, size: 36 })], alignment: AlignmentType.LEFT }),
    new Paragraph({ children: [new TextRun({ text: layout.contactLine, color: '555555', size: 19 })] }),
  ];
  for (const section of layout.sections) {
    children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } }));
    for (const line of section.lines) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 60 } }));
    }
  }
  const document = new Document({
    creator: layout.name,
    title: `${layout.name} – CV`,
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
