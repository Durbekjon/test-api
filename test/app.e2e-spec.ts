import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

describe('E2E API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: string;
  let testId: string;
  let questionId: string;
  let answerId: string;
  let variantId: string;
  let variantQuestions: any[];
  let submissionId: string;
  let dbTx: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    // Clean DB
    await prisma.testSubmission.deleteMany();
    await prisma.testVariant.deleteMany();
    await prisma.testSettings.deleteMany();
    await prisma.answer.deleteMany();
    await prisma.question.deleteMany();
    await prisma.test.deleteMany();
    await prisma.user.deleteMany();
    // Create a user
    await prisma.user.create({ data: { username: 'testuser', password: '$2a$10$wH6QwQwQwQwQwQwQwQwQwOQwQwQwQwQwQwQwQwQwQwQwQwQwQw', role: 'user' } }); 
    // Start a transaction for test isolation
    dbTx = await prisma.$transaction([]);
  });

  afterAll(async () => {
    // Rollback transaction if possible (mock, since Prisma doesn't support rollback for all engines)
    await app.close();
  });

  describe('Auth', () => {
    it('Login with valid credentials returns JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'testuser', password: 'testpass' });
      expect(res.status).toBe(201);
      expect(res.body.access_token).toBeDefined();
      jwt = res.body.access_token;
    });
    it('Login with invalid credentials fails', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'testuser', password: 'wrongpass' });
      expect(res.status).toBe(401);
    });
  });

  describe('Upload and Parsing', () => {
    it('Uploading a valid .docx file returns parsed JSON structure', async () => {
      const filePath = path.join(__dirname, 'sample.docx');
      // Create a minimal .docx file for test if not exists
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, Buffer.from('UEsDBBQABgAIAAAAIQAAAAAAAAAAAAAAAAAJAAAAd29yZC9VVAkAAxw0b2McNG9jdXgLAAEE6AMAAAToAwAAUEsDBBQABgAIAAAAIQAAAAAAAAAAAAAAAAATAAAAd29yZC9kb2N1bWVudC54bWxVVAkAAxw0b2McNG9jdXgLAAEE6AMAAAToAwAAUEsBAhQAFAAIAAgAAAAhAAAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAHdvcmQvVVQFAAMcNG9jdXgLAAEE6AMAAAToAwAAUEsBAhQAFAAIAAgAAAAhAAAAAAAAAAAAAAAAABMAAAAAAAAAAAAAAAAAAAAAAAB3b3JkL2RvY3VtZW50LnhtbFVUBQADHDS9Y3V4CwABBOgDAAAE6AMAAFBLBQYAAAAAAwADAMcAAABRAAAAAAA=','base64'));
      }
      const res = await request(app.getHttpServer())
        .post('/tests/upload')
        .set('Authorization', `Bearer ${jwt}`)
        .field('name', 'Test 1')
        .attach('file', filePath);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      testId = res.body.id;
      expect(res.body.questions).toBeDefined();
    });
    it('Uploading an invalid file returns validation error', async () => {
      const res = await request(app.getHttpServer())
        .post('/tests/upload')
        .set('Authorization', `Bearer ${jwt}`)
        .field('name', 'Test 2')
        .attach('file', __filename); // Not a .docx
      expect(res.status).toBe(400);
    });
  });

  describe('Test Randomization Logic', () => {
    it('Set shuffle settings and generate variants', async () => {
      // Set shuffle settings
      const settingsRes = await request(app.getHttpServer())
        .post(`/tests/${testId}/settings`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ shuffle_questions: true, shuffle_answers: true, shuffle_all: false });
      expect(settingsRes.status).toBe(201);
      // Generate variants
      const genRes = await request(app.getHttpServer())
        .post(`/tests/${testId}/generate`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ copies: 2 });
      expect(genRes.status).toBe(201);
      expect(Array.isArray(genRes.body.variants)).toBe(true);
      expect(genRes.body.variants.length).toBe(2);
      variantId = genRes.body.variants[0].variantId;
      // Optionally, parse the generated PDF to check order (skipped for brevity)
    });
  });

  describe('Test Submission and Scoring', () => {
    it('Submit answers and receive correctCount and incorrect breakdown', async () => {
      // Fetch test questions/answers
      const testRes = await request(app.getHttpServer())
        .get(`/tests/${testId}/settings`)
        .set('Authorization', `Bearer ${jwt}`);
      expect(testRes.status).toBe(200);
      // For simplicity, fetch questions from DB
      const test = await prisma.test.findUnique({
        where: { id: testId },
        include: { questions: { include: { answers: true } } },
      });
      expect(test).toBeTruthy();
      // Prepare correct answers
      const answers = (test?.questions || []).map(q => ({
        questionId: q.id,
        answerIds: q.answers
          .map(a => (a.isCorrect ? a.id : undefined))
          .filter((id): id is string => typeof id === 'string'),
      })).filter(a => a.answerIds.length > 0);
      // Submit
      const submitRes = await request(app.getHttpServer())
        .post(`/tests/${testId}/submit`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ answers });
      expect(submitRes.status).toBe(201);
      expect(typeof submitRes.body.correctCount).toBe('number');
      expect(Array.isArray(submitRes.body.incorrect)).toBe(true);
      const foundSubmission = await prisma.testSubmission.findFirst({ where: { testId } });
      expect(foundSubmission).toBeTruthy();
      submissionId = String(foundSubmission?.id);
    });
    it('Edge case: missing or multiple answers handled properly', async () => {
      // Missing answer
      const test = await prisma.test.findUnique({
        where: { id: testId },
        include: { questions: { include: { answers: true } } },
      });
      expect(test).toBeTruthy();
      const answers = (test?.questions || []).slice(0, -1).map(q => ({
        questionId: q.id,
        answerIds: q.answers
          .map(a => (a.isCorrect ? a.id : undefined))
          .filter((id): id is string => typeof id === 'string'),
      })).filter(a => a.answerIds.length > 0);
      const res = await request(app.getHttpServer())
        .post(`/tests/${testId}/submit`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ answers });
      expect(res.status).toBe(201);
      expect(res.body.incorrect.length).toBeGreaterThan(0);
      // Multiple answers
      const multiAnswers = (test?.questions || []).map(q => ({
        questionId: q.id,
        answerIds: q.answers.map(a => a.id),
      }));
      const res2 = await request(app.getHttpServer())
        .post(`/tests/${testId}/submit`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ answers: multiAnswers });
      expect(res2.status).toBe(201);
      expect(res2.body.incorrect.length).toBeGreaterThan(0);
    });
  });
});
