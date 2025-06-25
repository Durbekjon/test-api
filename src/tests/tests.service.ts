import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

@Injectable()
export class TestsService {
  constructor(private prisma: PrismaService) {}

  async parseDocx(buffer: Buffer) {
    const { value } = await mammoth.extractRawText({ buffer });
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const questions = [];
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

  async generateVariants(testId: string, copies: number) {
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
    const variants = [];
    const outputDir = path.join(process.cwd(), 'generated');
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
      const filePath = path.join(outputDir, `${variantId}.pdf`);
      await this.createPdfVariant(filePath, variantId, test.name, questions);
      // Store variant metadata
      await this.prisma.testVariant.create({
        data: {
          id: variantId,
          testId,
          settings,
          filePath,
        },
      });
      variants.push({ variantId, filePath });
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
      for (let i = 1; i <= bubbleCount; i++) {
        doc.circle(50 + (i - 1) * 25, 200, 10).stroke();
        doc.text(i.toString(), 45 + (i - 1) * 25, 215, { width: 20, align: 'center' });
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
    const incorrect: { questionId: string; correctAnswer: { id: string; text: string } | null }[] = [];
    for (const q of test.questions as { id: string; answers: { id: string; text: string; isCorrect: boolean }[] }[]) {
      const submitted = answers.find((a: { questionId: string; answerIds: string[] }) => a.questionId === q.id);
      const correctAnswer = q.answers.find((a: { isCorrect: boolean }) => a.isCorrect);
      if (!correctAnswer) {
        incorrect.push({ questionId: q.id, correctAnswer: null });
        continue;
      }
      const isCorrect = submitted && submitted.answerIds.includes(correctAnswer.id) && submitted.answerIds.length === 1;
      if (isCorrect) {
        correctCount++;
      } else {
        incorrect.push({
          questionId: q.id,
          correctAnswer: { id: correctAnswer.id, text: correctAnswer.text },
        });
      }
    }
    // Store submission
    await this.prisma.testSubmission.create({
      data: {
        userId,
        testId,
        answers,
        correctCount,
        incorrect,
      },
    });
    return { correctCount, incorrect };
  }

  async exportSubmissionsExcel(testId: string) {
    const submissions = await this.prisma.testSubmission.findMany({
      where: { testId },
      orderBy: { createdAt: 'asc' },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Submissions');
    sheet.columns = [
      { header: 'User ID', key: 'userId', width: 36 },
      { header: 'Correct Count', key: 'correctCount', width: 15 },
      { header: 'Incorrect Question IDs', key: 'incorrect', width: 40 },
      { header: 'Timestamp', key: 'createdAt', width: 24 },
    ];
    submissions.forEach(sub => {
      sheet.addRow({
        userId: sub.userId || '',
        correctCount: sub.correctCount,
        incorrect: Array.isArray(sub.incorrect) ? sub.incorrect.map((i: { questionId: string }) => i.questionId).join(', ') : '',
        createdAt: sub.createdAt.toISOString(),
      });
    });
    const outputDir = require('path').join(process.cwd(), 'exports');
    if (!require('fs').existsSync(outputDir)) require('fs').mkdirSync(outputDir);
    const filePath = require('path').join(outputDir, `test-${testId}-submissions.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  async listSubmissions(testId: string, page = 1, limit = 20) {
    const totalCount = await this.prisma.testSubmission.count({ where: { testId } });
    const totalPages = Math.ceil(totalCount / limit);
    const results = await this.prisma.testSubmission.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { totalCount, currentPage: page, totalPages, results };
  }

  async getSubmission(id: string, userId: string, userRole: string) {
    const submission = await this.prisma.testSubmission.findUnique({ where: { id } });
    if (!submission) return null;
    if (userRole !== 'admin' && submission.userId !== userId) {
      throw new ForbiddenException('You do not have access to this submission');
    }
    return submission;
  }
}
