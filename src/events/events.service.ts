// src/events/events.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Event } from './event.entity';
import { User } from '../users/user.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event) private readonly eventRepo: Repository<Event>,
    @InjectRepository(User)  private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateEventDto): Promise<Event> {
    const invitees = dto.inviteeIds?.length
      ? await this.userRepo.find({ where: { id: In(dto.inviteeIds) } })
      : [];
    const event = this.eventRepo.create({
      ...dto,
      startTime: dto.startTime ? new Date(dto.startTime) : undefined,
      endTime: dto.endTime ? new Date(dto.endTime) : undefined,
      invitees,
    });
    return this.eventRepo.save(event);
  }

  findOne(id: string) {
    return this.eventRepo.findOne({ where: { id }, relations: ['invitees'] });
  }

  async update(id: string, dto: UpdateEventDto) {
    const event = await this.findOne(id);
    if (!event) throw new NotFoundException('Event not found');

    if (dto.inviteeIds) {
      event.invitees = await this.userRepo.find({ where: { id: In(dto.inviteeIds) } });
    }
    if (dto.startTime !== undefined) event.startTime = dto.startTime ? new Date(dto.startTime) : null;
    if (dto.endTime !== undefined)   event.endTime   = dto.endTime   ? new Date(dto.endTime)   : null;

    Object.assign(event, dto, { invitees: event.invitees });
    return this.eventRepo.save(event);
  }

  async remove(id: string) {
    const res = await this.eventRepo.delete(id);
    if (!res.affected) throw new NotFoundException('Event not found');
    return { deleted: true };
  }

  // src/events/events.service.ts
  async mergeAllForUser(userId: string) {
    // 1) load all events where this user is an invitee, with times
    const events = await this.eventRepo.createQueryBuilder('e')
      .leftJoinAndSelect('e.invitees', 'u')
      .where('u.id = :userId', { userId })
      .andWhere('e.startTime IS NOT NULL AND e.endTime IS NOT NULL')
      .orderBy('e.startTime', 'ASC')
      .getMany();

    if (events.length === 0) return { merged: [], removed: [] };

    // 2) group by overlap
    type Group = { start: Date; end: Date; items: typeof events };
    const groups: Group[] = [];
    let cur: Group | null = null;

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
      aStart <= bEnd && bStart <= aEnd;

    for (const ev of events) {
      if (!cur) {
        cur = { start: ev.startTime!, end: ev.endTime!, items: [ev] };
        continue;
      }
      if (overlaps(cur.start, cur.end, ev.startTime!, ev.endTime!)) {
        // extend current
        if (ev.startTime! < cur.start) cur.start = ev.startTime!;
        if (ev.endTime! > cur.end) cur.end = ev.endTime!;
        cur.items.push(ev);
      } else {
        groups.push(cur);
        cur = { start: ev.startTime!, end: ev.endTime!, items: [ev] };
      }
    }
    if (cur) groups.push(cur);

    // 3) for each group: union invitees, create one merged event, delete originals
    const mergedResults: any[] = [];
    const removedIds: string[] = [];

    for (const g of groups) {
      // union invitees
      const inviteeMap = new Map<string, any>();
      for (const ev of g.items) {
        for (const user of ev.invitees || []) inviteeMap.set(user.id, user);
      }
      const invitees = Array.from(inviteeMap.values());

      // create merged event
      const merged = this.eventRepo.create({
        title: `Merged (${g.items.length})`,
        description: 'Auto-merged overlapping events',
        status: g.items[0].status, // or choose a rule
        startTime: g.start,
        endTime: g.end,
        invitees,
      });
      const saved = await this.eventRepo.save(merged);
      mergedResults.push(saved);

      // remove originals
      const ids = g.items.map((e) => e.id);
      removedIds.push(...ids);
      await this.eventRepo.delete(ids);
    }

    return { merged: mergedResults, removed: removedIds };
  }


  // optional: list with filters/pagination
  // list({ status, skip = 0, take = 20 }: { status?: string; skip?: number; take?: number }) {
  //   return this.eventRepo.find({
  //     where: status ? { status } : {},
  //     relations: ['invitees'],
  //     order: { createdAt: 'DESC' },
  //     skip, take,
  //   });
  // }
}
