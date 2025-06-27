import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export class CoverSheetService {
  static async generateCover({ title, variant }: { title: string; variant: any }): Promise<string> {
    const uuid = variant.id || uuidv4();
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
    const { width, height } = page.getSize();
    const margin = 28.35; // 1cm in points

    // Fonts
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const mono = await pdfDoc.embedFont(StandardFonts.Courier);

    // Title
    const titleFontSize = 24;
    const titleWidth = helveticaBold.widthOfTextAtSize(title, titleFontSize);
    page.drawText(title, {
      x: (width - titleWidth) / 2,
      y: height - margin - titleFontSize,
      size: titleFontSize,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // UUID
    const uuidFontSize = 13;
    const uuidText = `Variant UUID: ${uuid}`;
    const uuidWidth = mono.widthOfTextAtSize(uuidText, uuidFontSize);
    page.drawText(uuidText, {
      x: (width - uuidWidth) / 2,
      y: height - margin - titleFontSize - 30,
      size: uuidFontSize,
      font: mono,
      color: rgb(0, 0, 0),
    });

    // Bubble grid layout from variant.structure
    const mm = 2.83465; // 1mm in points
    const bubbleDiameter = 8.5 * mm; // ~8.5mm (22.7pt)
    const bubbleRadius = bubbleDiameter / 2;
    const bubbleMargin = 4 * mm; // 4mm (11.3pt) margin around each
    const labelFontSize = 12;
    const optionFontSize = 12;
    const rowGuideColor = rgb(0.85, 0.85, 0.85);
    let questions: any[] = [];
    let maxOptions = 0;
    try {
      if (!variant.structure || !Array.isArray(variant.structure.questions)) {
        throw new Error('Missing or malformed structure.questions');
      }
      questions = variant.structure.questions;
      maxOptions = Math.max(...questions.map(q => Array.isArray(q.options) ? q.options.length : 0));
    } catch (e) {
      console.warn('[CoverSheetService] Invalid variant.structure:', e);
      // Render placeholder message
      page.drawText('Invalid or missing variant structure. Cannot render answer grid.', {
        x: margin,
        y: height / 2,
        size: 16,
        font: helveticaBold,
        color: rgb(1, 0, 0),
      });
      // Footer and save as usual
      const footer = 'Mark the correct bubble with a dark pen.';
      const footerFontSize = 10;
      const footerWidth = helvetica.widthOfTextAtSize(footer, footerFontSize);
      page.drawText(footer, {
        x: (width - footerWidth) / 2,
        y: margin,
        size: footerFontSize,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
      const outputDir = path.join(process.cwd(), 'public/tests');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, `${uuid}.pdf`);
      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(filePath, pdfBytes);
      return filePath;
    }

    // BUBBLE GRID: enforce 30 questions per page
    const maxQuestionsPerGridPage = 30;
    let gridQIdx = 0;
    let firstPage = page;
    let gridPageNum = 0;
    while (gridQIdx < questions.length) {
      let page: any;
      if (gridPageNum === 0) {
        page = firstPage;
      } else {
        page = pdfDoc.addPage([595.28, 841.89]);
      }
      gridPageNum++;
      // Option header row (A, B, C, ...) for each column
      const questionsOnThisPage = Math.min(maxQuestionsPerGridPage, questions.length - gridQIdx);
      const questionsPerCol = 10;
      const numColsGrid = Math.ceil(questionsOnThisPage / questionsPerCol);
      const colWidth = maxOptions * (bubbleDiameter + bubbleMargin) + 50; // 50pt for question number
      const startY = height - margin - titleFontSize - 60;
      const rowHeight = bubbleDiameter + 2 * mm + 18;
      const startX = (width - (numColsGrid * colWidth)) / 2;
      // Draw option headers for each column
      for (let col = 0; col < numColsGrid; col++) {
        for (let opt = 0; opt < maxOptions; opt++) {
          const optLabel = String.fromCharCode(65 + opt);
          const x = startX + col * colWidth + 40 + opt * (bubbleDiameter + bubbleMargin) + bubbleRadius;
          page.drawText(optLabel, {
            x: x - helvetica.widthOfTextAtSize(optLabel, optionFontSize) / 2,
            y: startY + 10,
            size: optionFontSize,
            font: helveticaBold,
            color: rgb(0, 0, 0),
          });
        }
      }
      // Draw bubbles for up to 30 questions on this page
      for (let col = 0; col < numColsGrid; col++) {
        for (let row = 0; row < questionsPerCol; row++) {
          const qIdx = gridQIdx + col * questionsPerCol + row;
          if (qIdx >= gridQIdx + questionsOnThisPage || qIdx >= questions.length) break;
          const q = questions[qIdx];
          const y = startY - (row + 1) * rowHeight;
          // Draw question number
          const qNum = String(qIdx + 1);
          page.drawText(qNum, {
            x: startX + col * colWidth + 10,
            y: y - bubbleRadius - labelFontSize / 2 + 2,
            size: labelFontSize,
            font: helvetica,
            color: rgb(0, 0, 0),
          });
          // Draw subtle guide line
          page.drawLine({
            start: { x: startX + col * colWidth + 40, y: y - bubbleRadius - 2 },
            end: { x: startX + col * colWidth + 40 + (maxOptions - 1) * (bubbleDiameter + bubbleMargin) + bubbleDiameter, y: y - bubbleRadius - 2 },
            thickness: 0.5,
            color: rowGuideColor,
          });
          // Draw bubbles for each option
          for (let opt = 0; opt < maxOptions; opt++) {
            const x = startX + col * colWidth + 40 + opt * (bubbleDiameter + bubbleMargin) + bubbleRadius;
            if (q.options && q.options[opt]) {
              page.drawCircle({
                x,
                y,
                size: bubbleRadius,
                borderWidth: 1.2,
                color: rgb(1, 1, 1),
                borderColor: rgb(0, 0, 0),
              });
            }
          }
        }
      }
      // Footer (only on last grid page)
      if (gridQIdx + questionsOnThisPage >= questions.length) {
        const footer = 'Mark the correct bubble with a dark pen.';
        const footerFontSize = 10;
        const footerWidth = helvetica.widthOfTextAtSize(footer, footerFontSize);
        page.drawText(footer, {
          x: (width - footerWidth) / 2,
          y: margin,
          size: footerFontSize,
          font: helvetica,
          color: rgb(0, 0, 0),
        });
      }
      gridQIdx += questionsOnThisPage;
    }

    // Helper: Wrap text into lines that fit maxWidth
    function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    // SAVOLLAR VA VARIANTLAR 2-SAHIFADA (FLEXIBLE LAYOUT, WRAPPING, MULTI-PAGE)
    function renderQuestionsOnPage(page: any, startQIdx: number, questions: any[], qaColCount: number, qaColWidth: number, qaColGap: number, qaMargin: number, qaFontSize: number, qaLineSpacing: number, qaStartY: number, qaMinY: number, helvetica: any) {
      let col = 0;
      let qaY = qaStartY;
      let colX = qaMargin;
      let qIdx = startQIdx;
      for (; qIdx < questions.length;) {
        const q = questions[qIdx];
        const qText = `${qIdx + 1}. ${q.text || ''}`;
        const qLines = wrapText(qText, helvetica, qaFontSize, qaColWidth - 10);
        const qTextHeight = qLines.length * qaFontSize + (qLines.length - 1) * 2;
        let totalHeight = qTextHeight + qaLineSpacing;
        let optLinesArr: string[][] = [];
        let optHeights: number[] = [];
        if (Array.isArray(q.options)) {
          for (let o = 0; o < q.options.length; o++) {
            const optLabel = String.fromCharCode(65 + o);
            const optText = q.options[o]?.text || '';
            const optLine = `   ${optLabel}. ${optText}`;
            const optLines = wrapText(optLine, helvetica, qaFontSize, qaColWidth - 20);
            optLinesArr.push(optLines);
            const optHeight = optLines.length * qaFontSize + (optLines.length - 1) * 2;
            optHeights.push(optHeight);
            totalHeight += optHeight + 2;
          }
        }
        totalHeight += qaLineSpacing;
        // Agar ustun pastiga sig'masa, keyingi ustunga o'tamiz
        if (qaY - totalHeight < qaMinY) {
          col++;
          if (col >= qaColCount) break; // page is full, return to continue on next page
          colX = qaMargin + col * (qaColWidth + qaColGap);
          qaY = qaStartY;
          continue;
        }
        // Draw wrapped question text
        let drawY = qaY;
        for (let l = 0; l < qLines.length; l++) {
          page.drawText(qLines[l], {
            x: colX,
            y: drawY,
            size: qaFontSize,
            font: helvetica,
            color: rgb(0, 0, 0),
            maxWidth: qaColWidth - 10,
          });
          drawY -= qaFontSize + 2;
        }
        // Draw wrapped options
        if (Array.isArray(q.options)) {
          for (let o = 0; o < q.options.length; o++) {
            const optLines = optLinesArr[o];
            for (let l = 0; l < optLines.length; l++) {
              page.drawText(optLines[l], {
                x: colX + 10,
                y: drawY,
                size: qaFontSize,
                font: helvetica,
                color: rgb(0.2, 0.2, 0.2),
                maxWidth: qaColWidth - 20,
              });
              drawY -= qaFontSize + 2;
            }
            drawY -= 2; // extra spacing between options
          }
        }
        qaY = drawY - qaLineSpacing;
        qIdx++;
      }
      return qIdx; // return the next question index to continue
    }

    // Multi-page rendering
    const qaColGap = 40;
    const qaFontSize = 12;
    const qaLineSpacing = 6;
    let nextQIdx = 0;
    while (nextQIdx < questions.length) {
      const qaPage = pdfDoc.addPage([595.28, 841.89]);
      const qaWidth = qaPage.getWidth();
      const qaHeight = qaPage.getHeight();
      const qaColCount = Math.ceil(Math.min(30, questions.length) / 10);
      const qaColWidth = (qaWidth - 2 * margin - (qaColCount - 1) * qaColGap) / qaColCount;
      const qaStartY = qaHeight - margin - qaFontSize;
      const qaMinY = margin + 30;
      nextQIdx = renderQuestionsOnPage(
        qaPage,
        nextQIdx,
        questions,
        qaColCount,
        qaColWidth,
        qaColGap,
        margin,
        qaFontSize,
        qaLineSpacing,
        qaStartY,
        qaMinY,
        helvetica
      );
    }

    // Save PDF
    const outputDir = path.join(process.cwd(), 'public/tests');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${uuid}.pdf`);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  }
} 