import { IsEnum, IsOptional, IsString, IsISO8601, ArrayNotEmpty, IsUUID } from 'class-validator';
import { EventStatus } from '../event-status.enum';

export class CreateEventDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(EventStatus) status: EventStatus;
  @IsOptional() @IsISO8601() startTime?: string; // ISO8601 strings; pipe can transform to Date
  @IsOptional() @IsISO8601() endTime?: string;
  @IsOptional() @IsUUID(undefined, { each: true }) inviteeIds?: string[];
}
