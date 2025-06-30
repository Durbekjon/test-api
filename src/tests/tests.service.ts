import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { CoverSheetService } from './cover-sheet.service';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';

@Injectable()
export class TestsService {
  constructor(private prisma: PrismaService) {}

  async parseDocx(buffer: Buffer): Promise<{ questions: { question: string; answers: { text: string; isCorrect: boolean }[] }[] }> {
    const { value } = await mammoth.extractRawText({ buffer });
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const questions: { question: string; answers: { text: string; isCorrect: boolean }[] }[] = [];
    let currentQuestion: { text: string; answers: { text: string; isCorrect: boolean }[]; correctAnswers: number } | null = null;
    for (const line of lines) {
      if (line.startsWith('?')) {
        if (currentQuestion) {
          if (currentQuestion.correctAnswers !== 1) {
            throw new BadRequestException('Each question must have exactly one correct answer');
          }
          questions.push({
            question: currentQuestion.text,
            answers: Array.isArray(currentQuestion.answers) ? currentQuestion.answers : [],
          });
        }
        currentQuestion = {
          text: line.slice(1).trim(),
          answers: [],
          correctAnswers: 0,
        };
      } else if (line.startsWith('+')) {
        if (!currentQuestion) throw new BadRequestException('Answer before question');
        currentQuestion.answers.push({ text: line.slice(1).trim(), isCorrect: true });
        currentQuestion.correctAnswers++;
      } else if (line.startsWith('-')) {
        if (!currentQuestion) throw new BadRequestException('Answer before question');
        currentQuestion.answers.push({ text: line.slice(1).trim(), isCorrect: false });
      }
    }
    if (currentQuestion) {
      if (currentQuestion.correctAnswers !== 1) {
        throw new BadRequestException('Each question must have exactly one correct answer');
      }
      questions.push({
        question: currentQuestion.text,
        answers: Array.isArray(currentQuestion.answers) ? currentQuestion.answers : [],
      });
    }
    return { questions };
  }

  async saveTest(name: string, questions: { question: string; answers: { text: string; isCorrect: boolean }[] }[]) {
    return this.prisma.test.create({
      data: {
        name,
        questions: {
          create: questions.map(q => ({
            text: q.question,
            answers: {
              create: Array.isArray(q.answers) ? q.answers.map(a => ({ text: a.text, isCorrect: a.isCorrect })) : [],
            },
          })),
        },
      },
      include: {
        questions: {
          include: {
            answers: true,
          },
        },
      },
    });
  }

  async getSettings(testId: string, userId?: string) {
    return this.prisma.testSettings.findUnique({
      where: { testId },
    });
  }

  async setSettings(testId: string, settings: { shuffle_questions: boolean; shuffle_answers: boolean; shuffle_all: boolean }, userId?: string) {
    return this.prisma.testSettings.upsert({
      where: { testId },
      update: settings,
      create: {
        testId,
        ...settings,
        userId,
      },
    });
  }

  async generateDocxVariant(filePath: string, variantId: string, testName: string, questions: any[]) {
    // Title and UUID
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: testName,
              heading: 'Title',
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: `Variant UUID: ${variantId}`,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),
            new Paragraph({
              text: 'Answer Bubbles:',
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),
            // Bubble grid (table)
            this.createBubbleGridTable(questions),
            new Paragraph({
              text: '',
              spacing: { after: 400 },
            }),
            // Questions and answers
            ...questions.map((q: any, idx: number) => [
              new Paragraph({
                text: `${idx + 1}. ${q.text}`,
                spacing: { after: 100 },
              }),
              ...q.answers.map((a: any, aidx: number) =>
                new Paragraph({
                  text: `   ${String.fromCharCode(65 + aidx)}. ${a.text}`,
                  spacing: { after: 50 },
                })
              ),
              new Paragraph(''),
            ]).flat(),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    await fs.promises.writeFile(filePath, buffer);
  }

  createBubbleGridTable(questions: any[]) {
    // At least 20 bubbles, or as many as questions
    const bubbleCount = Math.max(questions.length, 20);
    const maxPerCol = 10;
    const numCols = Math.ceil(bubbleCount / maxPerCol);
    const rows: TableRow[] = [];
    // Header row (A, B, C, ...)
    const maxOptions = Math.max(...questions.map(q => q.answers.length));
    const headerCells = [
      new TableCell({
        children: [new Paragraph('Q#')],
        width: { size: 1000, type: WidthType.DXA },
      }),
      ...Array.from({ length: maxOptions }, (_, i) =>
        new TableCell({
          children: [new Paragraph(String.fromCharCode(65 + i))],
          width: { size: 1000, type: WidthType.DXA },
        })
      ),
    ];
    rows.push(new TableRow({ children: headerCells }));
    // Bubble rows
    for (let i = 0; i < bubbleCount; i++) {
      const qNum = i + 1;
      const q = questions[i];
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(qNum.toString())],
              width: { size: 1000, type: WidthType.DXA },
            }),
            ...Array.from({ length: maxOptions }, (_, j) =>
              new TableCell({
                children: [new Paragraph('○')],
                width: { size: 1000, type: WidthType.DXA },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
                },
              })
            ),
          ],
        })
      );
    }
    return new Table({
      rows,
      width: { size: 100 * numCols, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
    });
  }

  async generateVariants(testId: string, copies: number): Promise<{ variantId: string; pdfFilePath: string; docxFilePath: string }[]> {
    // Fetch test, questions, answers, and settings
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: {
        questions: { include: { answers: true } },
        testSettings: true,
      },
    });
    if (!test) throw new Error('Test not found');
    const settings = test.testSettings || { shuffle_questions: false, shuffle_answers: false, shuffle_all: false };
    const variants: { variantId: string; pdfFilePath: string; docxFilePath: string }[] = [];
    const outputDir = path.join(process.cwd(), 'public/generated');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    for (let i = 0; i < copies; i++) {
      // Deep copy questions/answers
      let questions = JSON.parse(JSON.stringify(test.questions));
      // Shuffle logic
      if (settings.shuffle_all) {
        questions = this.shuffleArray(questions);
        questions.forEach((q: any) => { q.answers = this.shuffleArray(q.answers); });
      } else {
        if (settings.shuffle_questions) questions = this.shuffleArray(questions);
        if (settings.shuffle_answers) questions.forEach((q: any) => { q.answers = this.shuffleArray(q.answers); });
      }
      const variantId = uuidv4();
      // Yangi structure tuzish (PDF uchun faqat text va options)
      const variantStructure = {
        id: variantId,
        questions: questions.map((q: any) => ({
          text: q.text,
          options: q.answers.map((a: any) => ({ text: a.text }))
        }))
      };
      // To'liq savollar tuzilmasi (scoring uchun)
      const variantQuestions = questions.map((q: any) => ({
        text: q.text,
        options: q.answers.map((a: any) => ({ text: a.text, isCorrect: a.isCorrect }))
      }));
      // PDF generatsiyasi
      const pdfFilePath = await CoverSheetService.generateCover({
        title: test.name,
        variant: { id: variantId, structure: variantStructure }
      });
      // DOCX generatsiyasi
      const docxFilePath = path.join(outputDir, `${variantId}.docx`);
      await this.generateDocxVariant(docxFilePath, variantId, test.name, questions);
      // Store variant metadata
      await this.prisma.testVariant.create({
        data: {
          id: variantId,
          testId,
          settings,
          filePath: pdfFilePath,
          questions: variantQuestions,
        },
      });
      variants.push({ variantId, pdfFilePath, docxFilePath });
    }
    return variants;
  }

  shuffleArray(arr: any[]) {
    return arr
      .map(value => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value);
  }

  async createPdfVariant(filePath: string, variantId: string, testName: string, questions: any[]) {
    return new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      // Title page
      doc.fontSize(20).text(`Test: ${testName}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text(`Variant UUID: ${variantId}`, { align: 'center' });
      doc.moveDown();
      doc.text('Bubbles:', { align: 'center' });
      // Mock 20 round bubbles (or based on number of questions)
      const bubbleCount = Math.max(questions.length, 20);
      const maxPerCol = 10;
      const bubbleRadius = 10;
      const bubbleSpacingY = 30;
      const bubbleSpacingX = 40;
      const startX = 70;
      const startY = 200;
      const numCols = Math.ceil(bubbleCount / maxPerCol);
      for (let col = 0; col < numCols; col++) {
        const bubblesInCol = Math.min(maxPerCol, bubbleCount - col * maxPerCol);
        for (let row = 0; row < bubblesInCol; row++) {
          const idx = col * maxPerCol + row + 1;
          const x = startX + col * bubbleSpacingX;
          const y = startY + row * bubbleSpacingY;
          doc.circle(x, y, bubbleRadius).stroke();
          doc.text(idx.toString(), x - 25, y - 7, { width: 20, align: 'right' });
        }
      }
      doc.addPage();
      // Questions
      questions.forEach((q: any, idx: number) => {
        doc.fontSize(14).text(`${idx + 1}. ${q.text}`);
        q.answers.forEach((a: any, aidx: number) => {
          doc.fontSize(12).text(`   ${String.fromCharCode(65 + aidx)}. ${a.text}`);
        });
        doc.moveDown();
      });
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', err => reject(err));
    });
  }

  async checkAnswers(testId: string, answers: { questionId: string; answerIds: string[] }[], userId?: string) {
    // Fetch test with questions and answers
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { questions: { include: { answers: true } } },
    });
    if (!test) throw new Error('Test not found');
    
    let correctCount = 0;
    const breakdown = test.questions.map((q: { id: string; answers: { id: string; text: string; isCorrect: boolean }[] }) => {
      const submitted = answers.find((a: { questionId: string; answerIds: string[] }) => a.questionId === q.id);
      const correctAnswer = q.answers.find((a: { isCorrect: boolean }) => a.isCorrect);
      
      if (!correctAnswer) {
        return {
          questionId: q.id,
          selected: submitted?.answerIds || [],
          correct: null,
          isCorrect: false,
          status: 'invalid'
        };
      }

      const isCorrect = submitted && submitted.answerIds.includes(correctAnswer.id) && submitted.answerIds.length === 1;
      if (isCorrect) {
        correctCount++;
      }

      return {
        questionId: q.id,
        selected: submitted?.answerIds || [],
        correct: { id: correctAnswer.id, text: correctAnswer.text },
        isCorrect,
        status: isCorrect ? 'correct' : (submitted ? 'incorrect' : 'unanswered')
      };
    });

    // Store submission
    await this.prisma.testSubmission.create({
      data: {
        userId,
        testId,
        answers: breakdown,
        correctCount,
        totalCount: test.questions.length,
      },
    });

    return { correctCount, totalCount: test.questions.length, breakdown };
  }

  async exportSubmissionsExcel(testId: string) {
    const submissions = await this.prisma.testSubmission.findMany({
      where: { testId },
      include: {
        user: true,
        variant: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Submissions');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'User', key: 'username', width: 20 },
      { header: 'Variant', key: 'variantId', width: 36 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Percentage', key: 'percentage', width: 10 },
      { header: 'Date', key: 'date', width: 20 }
    ];

    submissions.forEach(submission => {
      worksheet.addRow({
        id: submission.id,
        username: submission.user?.username || 'Anonymous',
        variantId: submission.variantId || 'N/A',
        score: submission.correctCount,
        total: submission.totalCount,
        percentage: `${((submission.correctCount / submission.totalCount) * 100).toFixed(1)}%`,
        date: submission.createdAt.toLocaleString()
      });
    });

    const filePath = path.join(process.cwd(), 'public', 'generated', `submissions-${testId}-${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  async listSubmissions(testId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    return this.prisma.testSubmission.findMany({
      where: { testId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            role: true
          }
        },
        variant: {
          select: {
            id: true,
            filePath: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });
  }

  async getSubmission(id: string, userId: string, userRole: string) {
    const submission = await this.prisma.testSubmission.findUnique({
      where: { id },
      include: {
        test: true,
        variant: true,
        user: true
      }
    });

    if (!submission) {
      throw new BadRequestException('Submission not found');
    }

    // Only allow admin or the user who submitted to view
    if (userRole !== 'admin' && submission.userId !== userId) {
      throw new ForbiddenException('Not authorized to view this submission');
    }

    return {
      id: submission.id,
      testId: submission.testId,
      variantId: submission.variantId,
      userId: submission.userId,
      correctCount: submission.correctCount,
      totalCount: submission.totalCount,
      answers: submission.answers,
      metadata: submission.metadata,
      createdAt: submission.createdAt,
      test: {
        id: submission.test.id,
        name: submission.test.name
      },
      variant: submission.variant ? {
        id: submission.variant.id,
        filePath: submission.variant.filePath
      } : null,
      user: submission.user ? {
        id: submission.user.id,
        username: submission.user.username,
        role: submission.user.role
      } : null
    };
  }

  async getTestWithQuestions(id: string) {
    return this.prisma.test.findUnique({
      where: { id },
      include: { questions: { include: { answers: true } } },
    });
  }

  async getVariantWithQuestions(variantId: string) {
    const variant = await this.prisma.testVariant.findUnique({
      where: { id: variantId },
      select: { id: true, settings: true, questions: true },
    });
    console.log(variant);
    if (!variant || !variant.settings) {
      console.warn('[TestsService] Variant or settings missing for', variantId);
      return null;
    }
    let structure = null;
    try {
      structure = typeof variant.settings === 'string' ? JSON.parse(variant.settings) : variant.settings;
    } catch (e) {
      console.warn('[TestsService] Failed to parse settings JSON:', e);
      return null;
    }
    return { id: variant.id, structure, questions: variant.questions };
  }

  async saveSubmission(testId: string, variantId: string, userId: string, result: any) {
    const metadata = result.warning || result.debugOverlayPath ? {
      warning: result.warning,
      debugOverlayPath: result.debugOverlayPath
    } : undefined;

    return this.prisma.testSubmission.create({
      data: {
        testId,
        variantId,
        userId,
        answers: result.breakdown,
        correctCount: result.score,
        totalCount: result.total,
        metadata
      }
    });
  }
}
