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

// Paleta de colores clásica y moderna de Word / Gemini (Tema Office Accent 1)
const WORD_COLORS = {
  TITLE: '1F4E79', // Azul profundo formal para título principal
  H1: '2E75B6', // Azul característico de Word para Encabezado 1
  H2: '1F4E79', // Azul marino para Encabezado 2
  H3: '2E75B6', // Azul Word para Encabezado 3
  H4: '5B9BD5', // Azul celeste suave para Encabezado 4
  BODY: '262626', // Gris oscuro natural (mucho más agradable que negro puro)
  MUTED: '595959', // Gris para subtítulos y metadatos
  TABLE_HEADER_BG: 'D9E8F5', // Fondo azul claro característico de tablas de Word
  TABLE_HEADER_TEXT: '1F4E79',
  TABLE_BORDER: 'BDD7EE', // Bordes suaves en tono azul de Word
  CALLOUT_BG: 'F0F4F8', // Fondo sutil para citas o notas destacadas
  CALLOUT_BORDER: '2E75B6',
  DIVIDER: 'BDD7EE',
  CODE_BG: 'F1F5F9',
  CODE_TEXT: '0F172A',
};

/**
 * Convierte texto con formato Markdown inline a TextRuns de docx (negritas, cursivas, negrita-cursiva, código).
 * Aplica los colores predeterminados de Word para que se vea fresco, casual y con vida.
 */
function parseInlineRuns(text, baseStyle = {}) {
  const defaultFont = baseStyle.font || 'Calibri';
  const defaultSize = baseStyle.size || 24; // 12pt en medios puntos
  const defaultColor = baseStyle.color || WORD_COLORS.BODY;
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
          color: defaultColor,
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
          color: defaultColor,
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
          color: defaultColor,
          ...baseStyle,
        })
      );
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: 'Consolas',
          size: Math.max(18, defaultSize - 2),
          color: WORD_COLORS.CODE_TEXT,
          shading: { fill: WORD_COLORS.CODE_BG },
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: part,
          font: defaultFont,
          size: defaultSize,
          color: defaultColor,
          ...baseStyle,
        })
      );
    }
  }

  return runs.length ? runs : [new TextRun({ text, font: defaultFont, size: defaultSize, color: defaultColor, ...baseStyle })];
}

const isTableRow = (line) => {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
};

const isTableDivider = (line) => /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());

/**
 * Convierte un bloque de líneas de tabla Markdown en una Table nativa de Word con el estilo por defecto de Word (azul claro).
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
            children: parseInlineRuns(cellText, {
              bold: isHeader,
              color: isHeader ? WORD_COLORS.TABLE_HEADER_TEXT : WORD_COLORS.BODY,
            }),
            spacing: { before: 80, after: 80 },
          }),
        ],
        shading: isHeader ? { fill: WORD_COLORS.TABLE_HEADER_BG } : undefined,
        borders: {
          top: { color: WORD_COLORS.TABLE_BORDER, size: 4, value: BorderStyle.SINGLE },
          bottom: { color: WORD_COLORS.TABLE_BORDER, size: 4, value: BorderStyle.SINGLE },
          left: { color: WORD_COLORS.TABLE_BORDER, size: 4, value: BorderStyle.SINGLE },
          right: { color: WORD_COLORS.TABLE_BORDER, size: 4, value: BorderStyle.SINGLE },
        },
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
 * Utiliza el formato casual, visual y bonito por defecto de Word / Gemini:
 * Títulos con los clásicos tonos azules de Word, tablas celestes impecables y tipografía agradable.
 * @param {object} opts
 * @param {string} opts.title Título de la tarea
 * @param {string} [opts.course] Materia
 * @param {string} [opts.author] Nombre del estudiante
 * @param {string} opts.content Contenido del borrador en Markdown
 */
export async function createDocxBuffer({ title = '', course = '', author = '', content = '' }) {
  const children = [];
  const lines = content.split('\n');

  // Si la IA no empezó con un título (# Título), colocamos el título con el azul característico de Word
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
            size: 36, // 18pt
            color: WORD_COLORS.TITLE,
          }),
        ],
        spacing: { before: 0, after: 120 },
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
              color: WORD_COLORS.MUTED,
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
                color: WORD_COLORS.CODE_TEXT,
              }),
            ],
            shading: { fill: WORD_COLORS.CODE_BG },
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
              color: WORD_COLORS.DIVIDER,
              space: 1,
              value: BorderStyle.SINGLE,
              size: 8,
            },
          },
          spacing: { before: 180, after: 180 },
        })
      );
      i++;
      continue;
    }

    // Títulos y subtítulos con la paleta de colores de Word
    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInlineRuns(line.slice(2).trim(), { size: 32, bold: true, color: WORD_COLORS.H1 }),
          spacing: { before: 280, after: 120 },
        })
      );
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInlineRuns(line.slice(3).trim(), { size: 26, bold: true, color: WORD_COLORS.H2 }),
          spacing: { before: 240, after: 100 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInlineRuns(line.slice(4).trim(), { size: 24, bold: true, color: WORD_COLORS.H3 }),
          spacing: { before: 200, after: 80 },
        })
      );
    } else if (line.startsWith('#### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          children: parseInlineRuns(line.slice(5).trim(), { size: 22, bold: true, color: WORD_COLORS.H4 }),
          spacing: { before: 160, after: 60 },
        })
      );
    } else if (line.startsWith('> ')) {
      // Citas o notas destacadas estilo Word (fondo celeste tenue y borde izquierdo azul)
      children.push(
        new Paragraph({
          children: parseInlineRuns(line.slice(2).trim(), { italics: true, color: WORD_COLORS.H2 }),
          shading: { fill: WORD_COLORS.CALLOUT_BG },
          indent: { left: 480 },
          border: {
            left: {
              color: WORD_COLORS.CALLOUT_BORDER,
              space: 14,
              value: BorderStyle.SINGLE,
              size: 16,
            },
          },
          spacing: { before: 100, after: 140, line: 276 },
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
      // Párrafo estándar en gris natural de Word
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
            color: WORD_COLORS.BODY,
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
