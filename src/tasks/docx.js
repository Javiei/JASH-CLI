import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';

/**
 * Convierte texto con formato Markdown inline a TextRuns de docx (negritas, cursivas, negrita-cursiva, código).
 * Sin colores artificiales ni subrayados forzados: estilo profesional y limpio.
 */
function parseInlineRuns(text, baseStyle = {}) {
  const defaultFont = baseStyle.font || 'Calibri';
  const defaultSize = baseStyle.size || 24; // 12pt en medios puntos
  const runs = [];

  // Regex para negrita-cursiva (***...***), negrita (**...**), cursiva (*...*), código (`...`)
  const regex = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|[^*`]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const part = match[0];
    if (part.startsWith('***') && part.endsWith('***') && part.length > 6) {
      runs.push(
        new TextRun({
          text: part.slice(3, -3),
          bold: true,
          italics: true,
          font: defaultFont,
          size: defaultSize,
          ...baseStyle,
        })
      );
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          font: defaultFont,
          size: defaultSize,
          ...baseStyle,
        })
      );
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          italics: true,
          font: defaultFont,
          size: defaultSize,
          ...baseStyle,
        })
      );
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: 'Consolas',
          size: Math.max(18, defaultSize - 2),
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: part,
          font: defaultFont,
          size: defaultSize,
          ...baseStyle,
        })
      );
    }
  }

  return runs.length ? runs : [new TextRun({ text, font: defaultFont, size: defaultSize, ...baseStyle })];
}

const isTableRow = (line) => {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
};

const isTableDivider = (line) => /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());

/**
 * Convierte un bloque de líneas de tabla Markdown en una Table nativa de Word.
 */
function parseTableBlock(tableLines) {
  const rows = [];
  let isHeader = true;

  for (const rawLine of tableLines) {
    const line = rawLine.trim();
    if (isTableDivider(line)) continue;

    const cellTexts = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

    const tableCells = cellTexts.map((cellText) => {
      return new TableCell({
        children: [
          new Paragraph({
            children: parseInlineRuns(cellText, isHeader ? { bold: true } : {}),
            spacing: { before: 80, after: 80 },
          }),
        ],
        shading: isHeader ? { fill: 'F9FAFB' } : undefined,
        margins: {
          top: 100,
          bottom: 100,
          left: 140,
          right: 140,
        },
      });
    });

    rows.push(new TableRow({ children: tableCells }));
    isHeader = false;
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

/**
 * Genera un Buffer de documento Word (.docx) a partir de contenido en Markdown.
 * Respeta el diseño generado por la IA (formato específico o estructura profesional estándar).
 * Sin colores llamativos ni marcos forzados: tipografía sobria, tablas reales y jerarquía limpia.
 * @param {object} opts
 * @param {string} opts.title Título de la tarea
 * @param {string} [opts.course] Materia
 * @param {string} [opts.author] Nombre del estudiante
 * @param {string} opts.content Contenido del borrador en Markdown
 */
export async function createDocxBuffer({ title = '', course = '', author = '', content = '' }) {
  const children = [];
  const lines = content.split('\n');

  // Si la IA no empezó con un título (# Título), colocamos el título de la tarea como Heading 1 limpio
  const startsWithHeading = lines.some((l) => l.trim().startsWith('# '));
  if (!startsWithHeading && title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: title,
            bold: true,
            font: 'Calibri',
            size: 32, // 16pt
          }),
        ],
        spacing: { before: 0, after: 140 },
      })
    );

    if (course || author) {
      const meta = [course, author].filter(Boolean).join('  ·  ');
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: meta,
              italics: true,
              font: 'Calibri',
              size: 22, // 11pt
              color: '4B5563',
            }),
          ],
          spacing: { after: 240 },
        })
      );
    }
  }

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Líneas vacías -> espaciado de párrafo
    if (!line) {
      i++;
      continue;
    }

    // Bloque de código ```
    if (line.startsWith('```')) {
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // saltar el ``` de cierre

      for (const cl of codeLines) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: cl || ' ',
                font: 'Consolas',
                size: 20, // 10pt
              }),
            ],
            shading: { fill: 'F3F4F6' },
            spacing: { before: 20, after: 20, line: 240 },
          })
        );
      }
      continue;
    }

    // Tabla de Markdown
    if (isTableRow(line)) {
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      children.push(parseTableBlock(tableLines));
      continue;
    }

    // Regla horizontal --- o ***
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line)) {
      children.push(
        new Paragraph({
          border: {
            bottom: {
              color: 'E5E7EB',
              space: 1,
              value: BorderStyle.SINGLE,
              size: 6,
            },
          },
          spacing: { before: 180, after: 180 },
        })
      );
      i++;
      continue;
    }

    // Títulos y subtítulos
    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInlineRuns(line.slice(2).trim(), { size: 32, bold: true }),
          spacing: { before: 280, after: 120 },
        })
      );
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInlineRuns(line.slice(3).trim(), { size: 28, bold: true }),
          spacing: { before: 240, after: 100 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInlineRuns(line.slice(4).trim(), { size: 24, bold: true }),
          spacing: { before: 200, after: 80 },
        })
      );
    } else if (line.startsWith('#### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          children: parseInlineRuns(line.slice(5).trim(), { size: 22, bold: true, italics: true }),
          spacing: { before: 160, after: 60 },
        })
      );
    } else if (line.startsWith('> ')) {
      // Citas o notas destacadas estilo documento
      children.push(
        new Paragraph({
          children: parseInlineRuns(line.slice(2).trim(), { italics: true }),
          indent: { left: 720 },
          border: {
            left: {
              color: '9CA3AF',
              space: 14,
              value: BorderStyle.SINGLE,
              size: 12,
            },
          },
          spacing: { before: 80, after: 120, line: 276 },
        })
      );
    } else if (/^[-*+]\s+/.test(line)) {
      // Lista con viñetas
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineRuns(line.replace(/^[-*+]\s+/, '')),
          spacing: { before: 40, after: 60, line: 276 },
        })
      );
    } else if (/^\d+[.)]\s+/.test(line)) {
      // Lista numerada
      children.push(
        new Paragraph({
          children: parseInlineRuns(line),
          spacing: { before: 40, after: 60, line: 276 },
        })
      );
    } else {
      // Párrafo estándar
      children.push(
        new Paragraph({
          children: parseInlineRuns(line),
          spacing: { before: 60, after: 140, line: 276 },
        })
      );
    }

    i++;
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 24, // 12pt
            color: '111827', // Negro/carbón natural formal
          },
          paragraph: {
            spacing: {
              line: 276, // 1.15 interlineado
              after: 120,
            },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 2.54 cm / 1 pulgada estándar
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
