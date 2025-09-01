// src/events/events.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Event } from './event.entity';
import { User } from '../users/user.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { EventStatus } from './event-status.enum';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event) private readonly eventRepo: Repository<Event>,
    @InjectRepository(User)  private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateEventDto): Promise<Event> {
    const ids = Array.from(new Set(dto.inviteeIds));
    let invitees: User[] = [];
    // check if invitees exist
    if (ids.length) {
      invitees = await this.userRepo.find({ where: { id: In(ids) } });
      if (invitees.length !== ids.length) {
        const found = new Set(invitees.map(u => u.id));
        const missing = ids.filter(id => !found.has(id));
        throw new NotFoundException(`Invitee(s) not found: ${missing.join(', ')}`);
      }
    }
    const event = this.eventRepo.create({
      ...dto,
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      invitees,
    });
    return this.eventRepo.save(event);
  }

  async findOne(id: string) {
    const event = await this.eventRepo.findOne({ where: { id }, relations: ['invitees'] });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async remove(id: string) {
    const res = await this.eventRepo.delete(id);
    if (!res.affected) throw new NotFoundException('Event not found');
    return { deleted: true };
  }

  // src/events/events.service.ts
  async mergeAllForUser(userId: string) {
    // Ensure the user exists
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    // 1) load all events where this user is an invitee, with times
    const eventIds = await this.eventRepo.createQueryBuilder('e')
      .leftJoin('e.invitees', 'u')
      .where('u.id = :userId', { userId })
      .andWhere('e.startTime IS NOT NULL AND e.endTime IS NOT NULL')
      .orderBy('e.startTime', 'ASC')
      .select('e.id')
      .getMany();

    if (eventIds.length === 0) {
      return { merged: [], removed: [] };
    }

    // Then, fetch all events with all invitees
    const events = await this.eventRepo.find({
      where: { id: In(eventIds.map(e => e.id)) },
      relations: ['invitees'],
      order: { startTime: 'ASC' }
    });
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

    // Only merge groups that have more than one event; leave standalone events untouched
    const groupsToMerge = groups.filter(g => g.items.length > 1);
    if (groupsToMerge.length === 0) return { merged: [], removed: [] };
    
    // 3) for each group: union invitees, create one merged event, delete originals
    const mergedResults: any[] = [];
    const removedIds: string[] = [];

    for (const g of groupsToMerge) {
      // union invitees
      const inviteeMap = new Map<string, any>();
      for (const ev of g.items) {
        for (const user of ev.invitees || []) inviteeMap.set(user.id, user);
      }
      const invitees = Array.from(inviteeMap.values());
      const statuses = g.items.map(e => e.status);
      let status: EventStatus;
      if (statuses.includes(EventStatus.TODO)) {
        status = EventStatus.TODO;
      } else if (statuses.includes(EventStatus.IN_PROGRESS)) {
        status = EventStatus.IN_PROGRESS;
      } else {
        status = EventStatus.COMPLETED;
      }
      // build merged description listing all merged events
      const mergedList = g.items
        .map((e, idx) => `${idx + 1}. ${e.title}: ${e.description}`)
        .join('\n');
      // create merged event
      const merged = this.eventRepo.create({
        title: `Merged (${g.items.length})`,
        description: `Auto-merged overlapping events:\n${mergedList}`,
        status: status,
        startTime: g.start,
        endTime: g.end,
        invitees,
      });
      const saved = await this.eventRepo.save(merged);
      mergedResults.push(merged);

      const ids = g.items.map((e) => e.id);
      removedIds.push(...ids);
      await this.eventRepo.delete(ids);
    }

    return { merged: mergedResults, removed: removedIds };
  }
}
