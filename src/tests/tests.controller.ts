import {
  Controller,
  BadRequestException,
  Req,
  Param,
  Post,
  Get,
  Body,
  UploadedFile,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiResponse,
  ApiConsumes,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  TestSettingsDto,
  GenerateDto,
  SubmitAnswerDto,
  SubmitTestDto,
} from './dto/test.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TestsService } from './tests.service';
import type { Express } from 'express';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { FileInterceptor as PlatformFileInterceptor } from '@nestjs/platform-express';
import { ImageRecognitionService } from './image-recognition.service';
import { Prisma } from '@prisma/client';

@ApiTags('Tests')
@Controller('tests')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
@ApiResponse({
  status: 401,
  description: 'Unauthorized - Invalid or missing JWT token',
})
@ApiResponse({
  status: 403,
  description: 'Forbidden - Insufficient role permissions',
})
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UseInterceptors(
    PlatformFileInterceptor('file', {
      fileFilter: (
        req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (
          file.mimetype !==
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          return cb(
            new BadRequestException('Only .docx files are allowed!'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload a .docx test file (Admin only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Parsed and saved test',
    schema: {
      example: {
        id: 'uuid',
        name: 'Test',
        questions: [
          { question: 'Q?', answers: [{ text: 'A', isCorrect: true }] },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid file type',
  })
  async uploadTest(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const { name } = req.body;
    if (!name) throw new BadRequestException('Test name is required');
    const parsed = await this.testsService.parseDocx(file.buffer);
    return this.testsService.saveTest(name, parsed.questions);
  }

  @Post(':testId/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Set test randomization settings (user only)' })
  @ApiParam({ name: 'testId', type: 'string', description: 'ID of the test' })
  @ApiBody({ type: TestSettingsDto })
  @ApiResponse({
    status: 201,
    description: 'Settings saved',
    schema: {
      example: {
        shuffle_questions: true,
        shuffle_answers: false,
        shuffle_all: false,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async setSettings(
    @Param('testId') testId: string,
    @Body() body: TestSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.testsService.setSettings(testId, body);
  }

  @Get(':testId/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Get test randomization settings (Admin only)' })
  @ApiParam({ name: 'testId', type: 'string', description: 'ID of the test' })
  @ApiResponse({
    status: 200,
    description: 'Current settings',
    schema: {
      example: {
        shuffle_questions: true,
        shuffle_answers: false,
        shuffle_all: false,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async getSettings(
    @Param('testId') testId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.testsService.getSettings(testId);
  }

  @Get(':testId/variants')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get test variants' })
  @ApiParam({ name: 'testId', type: 'string', description: 'ID of the test' })
  @ApiResponse({
    status: 200,
    description: 'Current settings',
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async getTestVariants(
    @Param('testId') testId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.testsService.getTestVariants(testId, user.userId);
  }

  @Post(':id/generate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Generate randomized test variants (Admin only)' })
  @ApiParam({ name: 'id', type: 'string', description: 'ID of the test' })
  @ApiBody({ type: GenerateDto })
  @ApiResponse({
    status: 201,
    description: 'List of generated variants',
    schema: {
      example: {
        variants: [
          {
            variantId: 'uuid',
            pdfFilePath: '/public/generated/uuid.pdf',
            docxFilePath: '/ed/uuid.docx',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async generate(
    @Param('id') id: string,
    @Body() body: GenerateDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!body.copies || body.copies < 1)
      throw new BadRequestException('Copies must be a positive number');
    const variants = await this.testsService.generateVariants(id, body.copies);
    return { variants };
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit answers for a test and get results' })
  @ApiParam({ name: 'id', type: 'string', description: 'ID of the test' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        image: { type: 'string', format: 'binary' },
        answers: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    PlatformFileInterceptor('image', {
      fileFilter: (
        req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (file && !['image/png', 'image/jpeg'].includes(file.mimetype)) {
          return cb(
            new BadRequestException('Only PNG or JPEG images are allowed!'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiResponse({
    status: 201,
    description: 'Submission result',
    schema: {
      example: {
        score: 5,
        total: 10,
        breakdown: [
          { question: 1, selected: 'B', correct: 'C', isCorrect: false },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid submission data or image format',
  })
  @ApiResponse({ status: 404, description: 'Test or variant not found' })
  async submit(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @CurrentUser() user: JwtUser,
  ) {
    const { variantId, answers } = body;
    if (!variantId) throw new BadRequestException('variantId is required');
    // Fetch variant with structure and questions
    const variant: { id: string; structure: any; questions: any } | null =
      await this.testsService.getVariantWithQuestions(variantId);
    if (!variant || !variant.structure || !Array.isArray(variant.questions)) {
      throw new BadRequestException(
        'Variant structure or questions missing or invalid',
      );
    }
    const questions: any[] = Array.isArray(variant.questions)
      ? variant.questions
      : [];

    if (file) {
      // Process image submission
      const columnCount = 3;
      const bubbleMap = ImageRecognitionService.buildBubbleMap(
        questions,
        columnCount,
      );

      const optionsPerQuestion = Math.max(
        ...questions.map((q) => q.options.length),
      );

      const ocrResult = await ImageRecognitionService.analyzeCoverImage(
        file.buffer,
        {
          bubbleCount: bubbleMap.length,
          debug: true,
          optionsPerQuestion,
          minArea: 200,
          maxArea: 5000,
          fillThreshold: 80,
        },
      );

      // Use perQuestion results directly instead of re-processing marked indices
      const answers: { [questionIndex: number]: string[] } = {};
      ocrResult.perQuestion.forEach((q) => {
        if (q.selected.length > 0) {
          answers[q.question - 1] = q.selected;
        }
      });

      // Add debug logging for question 10
      console.log('Processing results for question 10:', {
        perQuestion: ocrResult.perQuestion[9],
        answers: answers[9],
        marked: ocrResult.marked,
      });

      // Score and breakdown
      let correctCount = 0;
      const breakdown = questions.map((q: any, qIdx: number) => {
        const selectedArr = answers[qIdx] || [];
        const correctOptIdx = q.options.findIndex((opt: any) => opt.isCorrect);
        const correctLabel = String.fromCharCode(65 + correctOptIdx);
        const isMulti = selectedArr.length > 1;
        const isUnanswered = selectedArr.length === 0;
        const isCorrect =
          !isMulti && !isUnanswered && selectedArr[0] === correctLabel;
        const status = isUnanswered
          ? 'unanswered'
          : isCorrect
            ? 'correct'
            : 'incorrect';

        if (isCorrect) correctCount++;
        return {
          question: qIdx + 1,
          selected: selectedArr,
          correct: correctLabel,
          isCorrect,
          isMulti,
          status,
        };
      });

      const response: any = {
        score: correctCount,
        total: questions.length,
        breakdown,
        userId: user.userId,
      };

      if (ocrResult.debugOverlayPath)
        response.debugOverlayPath = ocrResult.debugOverlayPath;
      if (ocrResult.warning) response.warning = ocrResult.warning;

      // Save submission
      await this.testsService.saveSubmission(
        id,
        variantId,
        user.userId,
        response,
      );

      return response;
    } else if (answers) {
      throw new BadRequestException('Either image or answers must be provided');
    }
  }

  @Get(':id/submissions/export')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Export all submissions for a test as Excel (Admin only)',
  })
  @ApiParam({ name: 'id', type: 'string', description: 'ID of the test' })
  @ApiResponse({
    status: 200,
    description: 'Excel file with all submissions',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async exportSubmissions(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: JwtUser,
  ) {
    const filePath = await this.testsService.exportSubmissionsExcel(id);
    return res.download(filePath);
  }

  @Get(':id/submissions')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'List all submissions for a test (Admin only)' })
  @ApiParam({ name: 'id', type: 'string', description: 'ID of the test' })
  @ApiResponse({
    status: 200,
    description: 'List of submissions',
    schema: {
      example: [
        { id: '...', userId: '...', correctCount: 5, createdAt: '...' },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async listSubmissions(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.testsService.listSubmissions(id);
  }

  @Get('/submissions/:id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Get a single submission by ID (Admin only)' })
  @ApiParam({ name: 'id', type: 'string', description: 'ID of the submission' })
  @ApiResponse({
    status: 200,
    description: 'Submission details',
    schema: {
      example: {
        id: '...',
        userId: '...',
        correctCount: 5,
        incorrect: [],
        createdAt: '...',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async getSubmission(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.testsService.getSubmission(id, user.userId, user.role);
  }
}

// Helper: Build bubble map matching PDF's columnar layout
function buildBubbleMap(questions: any[], questionsPerCol = 10, numCols = 3) {
  const bubbleMap: {
    questionIndex: number;
    optionIndex: number;
    label: string;
  }[] = [];
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < questionsPerCol; row++) {
      const qIdx = col * questionsPerCol + row;
      if (qIdx >= questions.length) continue;
      const q = questions[qIdx];
      for (let optIdx = 0; optIdx < (q.options?.length || 0); optIdx++) {
        bubbleMap.push({
          questionIndex: qIdx,
          optionIndex: optIdx,
          label: String.fromCharCode(65 + optIdx),
        });
      }
    }
  }
  return bubbleMap;
}
