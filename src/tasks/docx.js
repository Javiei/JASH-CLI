import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';

// Paleta de colores oficial del formato UNPHU / Word Visual
const DOCX_THEME = {
  NAVY: '1B365D', // Azul institucional / Preguntas / Títulos
  CYAN: '0284C7', // Cyan eléctrico / Borde de preguntas / Etiqueta 'Respuesta:'
  MUTED_HEADER: '4A5568', // Subtítulo institucional
  BODY: '334155', // Texto de respuesta y cuerpo (Slate oscuro)
  LABEL_DARK: '2D3748', // Texto secundario de metadatos
  GRAY_SUB: '64748B', // Subtítulo gris de descripción
  CARD_BG: 'F7FAFC', // Fondo de tarjeta de metadatos
  QUESTION_BG: 'F1F5F9', // Fondo de tarjeta de pregunta
  BORDER_CARD: 'CBD5E0', // Borde tarjeta metadatos
  BORDER_INNER: 'E2E8F0', // Divisor horizontal interno de tarjeta
};

/**
 * Convierte texto con formato Markdown inline a TextRuns de docx (negritas, cursivas, código).
 */
function parseInlineRuns(text, baseStyle = {}) {
  const defaultFont = baseStyle.font || 'Calibri';
  const defaultSize = baseStyle.size || 20; // 10pt en medios puntos
  const defaultColor = baseStyle.color || DOCX_THEME.BODY;
  const runs = [];

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
          color: '0F172A',
          shading: { fill: 'F1F5F9' },
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

/**
 * Crea una tarjeta visual de pregunta idéntica a la del documento de referencia.
 * Caja con fondo F1F5F9 y borde izquierdo cyan 0284C7 de 3pt.
 */
function createQuestionBox(text) {
  const clean = text
    .replace(/^#{1,4}\s+/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .trim();

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.SINGLE, size: 24, color: DOCX_THEME.CYAN },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: DOCX_THEME.QUESTION_BG },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: parseInlineRuns(clean, {
                  bold: true,
                  color: DOCX_THEME.NAVY,
                  size: 21, // 10.5pt
                }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * Crea el párrafo de respuesta con sangría de 0.2 pulgadas y etiqueta 'Respuesta:' en cyan.
 */
function createAnswerParagraph(rawText) {
  const match = rawText.match(/^(\*{0,2}(?:Respuesta|Solución|Rpta):\*{0,2}\s*)([\s\S]*)$/i);
  const label = match ? match[1].replace(/\*/g, '').trim() + ' ' : 'Respuesta: ';
  const content = match ? match[2].trim() : rawText.trim();

  return new Paragraph({
    spacing: { before: 100, after: 240 },
    indent: { left: 288 }, // 0.2 pulgadas
    children: [
      new TextRun({
        text: label,
        bold: true,
        color: DOCX_THEME.CYAN,
        size: 20, // 10pt
        font: 'Calibri',
      }),
      ...parseInlineRuns(content, {
        color: DOCX_THEME.BODY,
        size: 20, // 10pt
      }),
    ],
  });
}

/**
 * Crea la tarjeta superior de metadatos (Estudiante, Materia, Actividad, Fecha).
 */
function createMetadataCard({ author = '', course = '', title = '', institution = '' }) {
  const fecha = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: DOCX_THEME.BORDER_CARD },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: DOCX_THEME.BORDER_CARD },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: DOCX_THEME.BORDER_INNER },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: DOCX_THEME.CARD_BG },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: 'Estudiante: ', bold: true, color: DOCX_THEME.NAVY, size: 19, font: 'Calibri' }),
                  new TextRun({ text: author || 'Estudiante', color: DOCX_THEME.LABEL_DARK, size: 19, font: 'Calibri' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: DOCX_THEME.CARD_BG },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: 'Materia: ', bold: true, color: DOCX_THEME.NAVY, size: 19, font: 'Calibri' }),
                  new TextRun({ text: course || 'General', color: DOCX_THEME.LABEL_DARK, size: 19, font: 'Calibri' }),
                ],
              }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: DOCX_THEME.CARD_BG },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: 'Actividad: ', bold: true, color: DOCX_THEME.NAVY, size: 19, font: 'Calibri' }),
                  new TextRun({ text: title || 'Tarea', color: DOCX_THEME.LABEL_DARK, size: 19, font: 'Calibri' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            shading: { fill: DOCX_THEME.CARD_BG },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: 'Fecha: ', bold: true, color: DOCX_THEME.NAVY, size: 19, font: 'Calibri' }),
                  new TextRun({ text: fecha, color: DOCX_THEME.LABEL_DARK, size: 19, font: 'Calibri' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
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
            children: parseInlineRuns(cellText, {
              bold: isHeader,
              color: isHeader ? DOCX_THEME.NAVY : DOCX_THEME.BODY,
              size: 19,
            }),
            spacing: { before: 80, after: 80 },
          }),
        ],
        shading: isHeader ? { fill: DOCX_THEME.QUESTION_BG } : undefined,
        borders: {
          top: { color: DOCX_THEME.BORDER_CARD, size: 4, value: BorderStyle.SINGLE },
          bottom: { color: DOCX_THEME.BORDER_CARD, size: 4, value: BorderStyle.SINGLE },
          left: { color: DOCX_THEME.BORDER_CARD, size: 4, value: BorderStyle.SINGLE },
          right: { color: DOCX_THEME.BORDER_CARD, size: 4, value: BorderStyle.SINGLE },
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

function cleanAiPreamble(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let startIdx = 0;
  const isPreamble = (l) =>
    /^(?:(?:¡?(?:hola|claro(?: que sí)?|por supuesto|entendido|seguro)[!.,]?\s*)?(?:a continuación[,:\s]+(?:presento|se presenta|se detalla|desarrollo|adjunto|encontrará|abordaremos|veremos|te presento|te detallo|doy respuesta|se responden|comparto|procedo)|en este documento[,:\s]+(?:se presenta|presento|abordaremos|se detalla)|aquí (?:tienes|está|presento)|con gusto(?: te presento)?|en el presente trabajo se detalla|estimado|saludos))/i.test(
      l.trim()
    );

  while (startIdx < lines.length) {
    const line = lines[startIdx].trim();
    if (!line) {
      startIdx++;
      continue;
    }
    if (isPreamble(line)) {
      startIdx++;
      continue;
    }
    break;
  }
  return lines.slice(startIdx).join('\n').trim();
}

/**
 * Genera un Buffer de documento Word (.docx) con el diseño elegante y profesional
 * correspondiente al formato de referencia (cajas de preguntas con acento cyan, respuestas indentadas y tarjeta de metadatos).
 * @param {object} opts
 * @param {string} opts.title Título de la tarea
 * @param {string} [opts.course] Materia
 * @param {string} [opts.author] Nombre del estudiante
 * @param {string} [opts.institution] Nombre de la institución o centro
 * @param {string} opts.content Contenido del borrador en Markdown
 */
export async function createDocxBuffer({ title = '', course = '', author = '', institution = '', content = '' }) {
  const children = [];
  const cleanContent = cleanAiPreamble(content);
  const lines = cleanContent.split('\n');

  // 1. Encabezado institucional superior
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
      children: [
        new TextRun({
          text: institution || course || 'Colegios Preuniversitarios (Moodle)',
          bold: true,
          color: DOCX_THEME.NAVY,
          size: 26, // 13pt
          font: 'Calibri',
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 280 },
      children: [
        new TextRun({
          text: course ? `${course} • Actividad Académica` : 'Actividad Académica',
          color: DOCX_THEME.MUTED_HEADER,
          size: 22, // 11pt
          font: 'Calibri',
        }),
      ],
    })
  );

  // 2. Tarjeta de Metadatos (Estudiante, Materia, Actividad, Fecha)
  children.push(createMetadataCard({ author, course, title, institution }));
  children.push(new Paragraph({ spacing: { after: 160 } }));

  // 3. Título de la tarea
  // Si la primera línea de contenido es un `# Título`, usamos ese; si no, usamos `title`
  let startIdx = 0;
  let docTitle = title;
  if (lines.length > 0 && lines[0].trim().startsWith('# ')) {
    docTitle = lines[0].trim().slice(2).trim();
    startIdx = 1;
  }

  children.push(
    new Paragraph({
      spacing: { before: 120, after: 140 },
      children: [
        new TextRun({
          text: docTitle,
          bold: true,
          color: DOCX_THEME.NAVY,
          size: 32, // 16pt
          font: 'Calibri',
        }),
      ],
    })
  );

  // 4. Procesar el resto del contenido
  let i = startIdx;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

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
      if (i < lines.length) i++;

      for (const cl of codeLines) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: cl || ' ',
                font: 'Consolas',
                size: 19,
                color: '0F172A',
              }),
            ],
            shading: { fill: 'F1F5F9' },
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
              color: DOCX_THEME.BORDER_CARD,
              space: 1,
              value: BorderStyle.SINGLE,
              size: 6,
            },
          },
          spacing: { before: 160, after: 160 },
        })
      );
      i++;
      continue;
    }

    // Detectar si es una pregunta (ej: "1. ¿...", "2) ...", "**1. ...**", "### 1. ...")
    const isQuestion =
      /^(\d+[\.\)]\s+|\*{0,2}(?:Pregunta|Problema|Ejercicio)\s*\d*:?\*{0,2}\s+|#{1,4}\s+\d+[\.\)])/i.test(line);

    // Detectar si es una respuesta (ej: "Respuesta:", "**Respuesta:**", "Solución:")
    const isAnswer = /^(\*{0,2}(?:Respuesta|Solución|Rpta):\*{0,2})/i.test(line);

    if (isQuestion) {
      // Tarjeta de pregunta con acento cyan
      children.push(createQuestionBox(line));
    } else if (isAnswer) {
      // Párrafo de respuesta con sangría y 'Respuesta:' en cyan
      children.push(createAnswerParagraph(line));
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInlineRuns(line.slice(3).trim(), { size: 26, bold: true, color: DOCX_THEME.NAVY }),
          spacing: { before: 240, after: 100 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInlineRuns(line.slice(4).trim(), { size: 22, bold: true, color: DOCX_THEME.CYAN }),
          spacing: { before: 200, after: 80 },
        })
      );
    } else if (/^[-*+]\s+/.test(line)) {
      // Lista con viñetas
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineRuns(line.replace(/^[-*+]\s+/, ''), { size: 20, color: DOCX_THEME.BODY }),
          spacing: { before: 40, after: 60, line: 276 },
        })
      );
    } else {
      // Párrafo normal
      children.push(
        new Paragraph({
          children: parseInlineRuns(line, { size: 20, color: DOCX_THEME.BODY }),
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
            size: 20, // 10pt
            color: DOCX_THEME.BODY,
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
