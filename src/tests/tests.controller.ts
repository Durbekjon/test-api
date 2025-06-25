import { Controller, BadRequestException, Req, Param, Post, Get, Body, UploadedFile, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiParam, ApiResponse, ApiConsumes, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsArray, IsString } from 'class-validator';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TestsService } from './tests.service';
import type { Express } from 'express';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { FileInterceptor as PlatformFileInterceptor } from '@nestjs/platform-express';

class TestSettingsDto {
  @ApiProperty({ description: 'Shuffle questions', example: true })
  @IsBoolean()
  shuffle_questions: boolean;

  @ApiProperty({ description: 'Shuffle answers', example: false })
  @IsBoolean()
  shuffle_answers: boolean;

  @ApiProperty({ description: 'Shuffle all', example: false })
  @IsBoolean()
  shuffle_all: boolean;
}

class GenerateDto {
  @ApiProperty({ description: 'Number of copies to generate', example: 30 })
  @IsNumber()
  copies: number;
}

class SubmitAnswerDto {
  @ApiProperty({ description: 'Question ID', example: 'question-uuid' })
  @IsString()
  questionId: string;

  @ApiProperty({ description: 'Selected answer IDs', example: ['answer-uuid'] })
  @IsArray()
  answerIds: string[];
}

class SubmitTestDto {
  @ApiProperty({ type: [SubmitAnswerDto] })
  @IsArray()
  answers: SubmitAnswerDto[];
}

@ApiTags('Tests')
@Controller('tests')
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Post('upload')
  @UseInterceptors(PlatformFileInterceptor('file', {
    fileFilter: (req: Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
      if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return cb(new BadRequestException('Only .docx files are allowed!'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: 'Upload a .docx test file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Parsed and saved test', schema: { example: { id: 'uuid', name: 'Test', questions: [{ question: 'Q?', answers: [{ text: 'A', isCorrect: true }] }] } } })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async uploadTest(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new BadRequestException('File is required');
    const { name } = req.body;
    if (!name) throw new BadRequestException('Test name is required');
    const parsed = await this.testsService.parseDocx(file.buffer);
    return this.testsService.saveTest(name, parsed.questions);
  }

  @Post(':testId/settings')
  @ApiOperation({ summary: 'Set test randomization settings' })
  @ApiParam({ name: 'testId', type: 'string' })
  @ApiBody({ type: TestSettingsDto })
  @ApiResponse({ status: 201, description: 'Settings saved', schema: { example: { shuffle_questions: true, shuffle_answers: false, shuffle_all: false } } })
  async setSettings(@Param('testId') testId: string, @Body() body: TestSettingsDto, @Req() req: Request) {
    // Optionally get userId from auth in future
    return this.testsService.setSettings(testId, body);
  }

  @Get(':testId/settings')
  @ApiOperation({ summary: 'Get test randomization settings' })
  @ApiParam({ name: 'testId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Current settings', schema: { example: { shuffle_questions: true, shuffle_answers: false, shuffle_all: false } } })
  async getSettings(@Param('testId') testId: string, @Req() req: Request) {
    // Optionally get userId from auth in future
    return this.testsService.getSettings(testId);
  }

  @Post(':id/generate')
  @ApiOperation({ summary: 'Generate randomized test variants' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({ type: GenerateDto })
  @ApiResponse({ status: 201, description: 'List of generated variants', schema: { example: { variants: [{ variantId: 'uuid', filePath: '/generated/uuid.pdf' }] } } })
  async generate(@Param('id') id: string, @Body() body: GenerateDto, @Req() req: Request) {
    if (!body.copies || body.copies < 1) throw new BadRequestException('Copies must be a positive number');
    const variants = await this.testsService.generateVariants(id, body.copies);
    return { variants };
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit answers for a test and get results' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({ type: SubmitTestDto })
  @ApiResponse({ status: 201, description: 'Submission result', schema: { example: { correctCount: 5, incorrect: [{ questionId: '...', correctAnswer: { id: '...', text: '...' } }] } } })
  async submit(@Param('id') id: string, @Body() body: SubmitTestDto, @CurrentUser() user: JwtUser) {
    return this.testsService.checkAnswers(id, body.answers, user.userId);
  }

  @Get(':id/submissions/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Export all submissions for a test as Excel' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Excel file with all submissions', schema: { type: 'string', format: 'binary' } })
  async exportSubmissions(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.testsService.exportSubmissionsExcel(id);
    return res.download(filePath);
  }

  @Get(':id/submissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'List all submissions for a test (paginated)' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of submissions', schema: { example: [{ id: '...', userId: '...', correctCount: 5, createdAt: '...' }] } })
  async listSubmissions(@Param('id') id: string) {
    return this.testsService.listSubmissions(id);
  }

  @Get('/submissions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get a single submission by ID' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Submission details', schema: { example: { id: '...', userId: '...', correctCount: 5, incorrect: [], createdAt: '...' } } })
  async getSubmission(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.testsService.getSubmission(id, user.userId, user.role);
  }
}
