import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsArray, IsString } from 'class-validator';

export class TestSettingsDto {
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

export class GenerateDto {
  @ApiProperty({ description: 'Number of copies to generate', example: 30 })
  @IsNumber()
  copies: number;
}

export class SubmitAnswerDto {
  @ApiProperty({ description: 'Question ID', example: 'question-uuid' })
  @IsString()
  questionId: string;

  @ApiProperty({ description: 'Selected answer IDs', example: ['answer-uuid'] })
  @IsArray()
  answerIds: string[];
}

export class SubmitTestDto {
  @ApiProperty({ type: [SubmitAnswerDto] })
  @IsArray()
  answers: SubmitAnswerDto[];
} 