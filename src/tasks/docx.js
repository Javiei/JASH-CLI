import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

/**
 * Convierte texto en formato Markdown a runs de texto con negritas y cursivas.
 */
function parseInlineRuns(text) {
  const runs = [];
  // Tokenizar por negritas (**texto**) y cursivas (*texto*) y código (`texto`)
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|[^*`]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const part = match[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          font: 'Calibri',
          size: 24, // 12pt
        })
      );
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          italics: true,
          font: 'Calibri',
          size: 24,
        })
      );
    } else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: 'Consolas',
          size: 22,
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: part,
          font: 'Calibri',
          size: 24,
        })
      );
    }
  }

  return runs.length ? runs : [new TextRun({ text, font: 'Calibri', size: 24 })];
}

/**
 * Genera un Buffer de documento Word (.docx) a partir de contenido en Markdown.
 * @param {object} opts
 * @param {string} opts.title Título de la tarea
 * @param {string} [opts.course] Materia
 * @param {string} [opts.author] Nombre del estudiante
 * @param {string} opts.content Contenido del borrador en Markdown
 */
export async function createDocxBuffer({ title, course = '', author = '', content = '' }) {
  const children = [];

  // Portada / Encabezado superior elegante
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: title,
          bold: true,
          font: 'Calibri',
          size: 36, // 18pt
          color: '1E3A8A', // Azul institucional
        }),
      ],
      spacing: { after: 120 },
    })
  );

  if (course || author) {
    const metaParts = [];
    if (course) metaParts.push(course);
    if (author) metaParts.push(author);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: metaParts.join('  ·  '),
            italics: true,
            font: 'Calibri',
            size: 22,
            color: '64748B',
          }),
        ],
        spacing: { after: 360 },
      })
    );
  }

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Espacio entre párrafos
      children.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new TextRun({
              text: line.slice(2).trim(),
              bold: true,
              font: 'Calibri',
              size: 32, // 16pt
              color: '1E3A8A',
            }),
          ],
          spacing: { before: 280, after: 140 },
        })
      );
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: line.slice(3).trim(),
              bold: true,
              font: 'Calibri',
              size: 28, // 14pt
              color: '0369A1',
            }),
          ],
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: line.slice(4).trim(),
              bold: true,
              font: 'Calibri',
              size: 26, // 13pt
              color: '0284C7',
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (/^[-*]\s+/.test(line)) {
      const itemText = line.replace(/^[-*]\s+/, '');
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineRuns(itemText),
          spacing: { before: 40, after: 60 },
        })
      );
    } else if (/^\d+\.\s+/.test(line)) {
      const itemText = line.replace(/^\d+\.\s+/, '');
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineRuns(itemText),
          spacing: { before: 40, after: 60 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: parseInlineRuns(line),
          spacing: { before: 60, after: 120 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 pulgada (2.54 cm)
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
