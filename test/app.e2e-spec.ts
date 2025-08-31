import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { User } from '../src/users/user.entity';

describe('Events API E2E: CRUD with one overlap merging', () => {
  let app: INestApplication<App>;

  // Seed demo users and pick one as the invitee under test
  let inviteeId: string;
  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const dataSource = app.get<DataSource>(getDataSourceToken());
    const userRepo = dataSource.getRepository(User);

    const users = userRepo.create([
      { id: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Charlie' },
    ]);
    await userRepo.save(users);
    inviteeId = users[0].id;
  });

  afterAll(async () => {
    const ds = app.get<DataSource>(getDataSourceToken());
    await ds.query('TRUNCATE TABLE "event_invitees","events","users" RESTART IDENTITY CASCADE;');
    await app.close();
  });

  let eventId: string;

  it('POST /events creates an event with invitees', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({
        title: 'Alice 1:1',
        description: 'Planning chat',
        status: 'TODO',
        startTime: '2025-08-29T14:00:00Z',
        endTime: '2025-08-29T14:45:00Z',
        inviteeIds: [inviteeId],
      })
      .expect(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('Alice 1:1');
    expect(res.body.invitees.length).toBe(1);
    expect(res.body.invitees[0].id).toBe(inviteeId);
    eventId = res.body.id;
  });

  it('GET /events/:id returns the persisted event with invitees', async () => {
    const res = await request(app.getHttpServer())
      .get(`/events/${eventId}`)
      .expect(200);
    expect(res.body).toHaveProperty('id', eventId);
    expect(res.body.invitees.length).toBe(1);
    expect(res.body.invitees[0].id).toBe(inviteeId);
  });

  it('DELETE /events/:id removes the event and subsequent GET returns 404', async () => {
    await request(app.getHttpServer())
      .delete(`/events/${eventId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/events/${eventId}`)
      .expect(404);
  });

  it('POST /events/merge-all/:inviteeId merges overlapping events for an invitee', async () => {
    // Arrange: create two overlapping events for the same invitee
    await request(app.getHttpServer())
      .post('/events')
      .send({
        title: 'Event 1',
        status: 'TODO',
        startTime: '2025-08-29T14:00:00Z',
        endTime: '2025-08-29T14:30:00Z',
        inviteeIds: [inviteeId],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/events')
      .send({
        title: 'Event 2',
        status: 'TODO',
        startTime: '2025-08-29T14:15:00Z',
        endTime: '2025-08-29T14:45:00Z',
        inviteeIds: [inviteeId],
      })
      .expect(201);

    // Act: merge overlaps
    const res = await request(app.getHttpServer())
      .post(`/events/merge-all/${inviteeId}`)
      .expect(201);

    // Assert: one merged event spans the full time range; originals are removed
    expect(res.body).toHaveProperty('merged');
    expect(Array.isArray(res.body.merged)).toBe(true);
    expect(res.body.merged.length).toBeGreaterThanOrEqual(1);
    expect(res.body.merged[0].invitees.some((u: any) => u.id === inviteeId)).toBe(true);
    expect(res.body).toHaveProperty('removed');
    expect(Array.isArray(res.body.removed)).toBe(true);
    expect(new Date(res.body.merged[0].startTime).toISOString()).toBe('2025-08-29T14:00:00.000Z');
    expect(new Date(res.body.merged[0].endTime).toISOString()).toBe('2025-08-29T14:45:00.000Z');
  });
});

describe('Events API E2E: multiple invitees', () => {
  let app: INestApplication<App>;
  let inviteeAId: string;
  let inviteeBId: string;
  let eventId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const dataSource = app.get<DataSource>(getDataSourceToken());
    const userRepo = dataSource.getRepository(User);

    const users = userRepo.create([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Daisy' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Eve' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Frank' },
    ]);
    await userRepo.save(users);
    inviteeAId = users[0].id;
    inviteeBId = users[1].id;
  });

  afterAll(async () => {
    const ds = app.get<DataSource>(getDataSourceToken());
    await ds.query('TRUNCATE TABLE "event_invitees","events","users" RESTART IDENTITY CASCADE;');
    await app.close();
  });

  it('POST /events creates an event with multiple invitees', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({
        title: 'Pair Programming',
        description: 'Build feature X',
        status: 'TODO',
        startTime: '2025-09-01T10:00:00Z',
        endTime: '2025-09-01T11:00:00Z',
        inviteeIds: [inviteeAId, inviteeBId],
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(Array.isArray(res.body.invitees)).toBe(true);
    expect(res.body.invitees.length).toBe(2);
    const ids = res.body.invitees.map((u: any) => u.id).sort();
    expect(ids).toEqual([inviteeAId, inviteeBId].sort());
    eventId = res.body.id;
  });

  it('GET /events/:id returns the event with both invitees', async () => {
    const res = await request(app.getHttpServer())
      .get(`/events/${eventId}`)
      .expect(200);

    const ids = res.body.invitees.map((u: any) => u.id).sort();
    expect(ids).toEqual([inviteeAId, inviteeBId].sort());
  });

  it('DELETE /events/:id removes the event and subsequent GET returns 404', async () => {
    await request(app.getHttpServer()).delete(`/events/${eventId}`).expect(200);
    await request(app.getHttpServer()).get(`/events/${eventId}`).expect(404);
  });
});

describe('Events API E2E: merge-all scenarios', () => {
  let app: INestApplication<App>;
  let targetInviteeId: string;
  let otherInviteeId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const dataSource = app.get<DataSource>(getDataSourceToken());
    const userRepo = dataSource.getRepository(User);

    const users = userRepo.create([
      { id: '11111111-aaaa-4aaa-8aaa-111111111111', name: 'Target' },
      { id: '22222222-bbbb-4bbb-8bbb-222222222222', name: 'Other' },
    ]);
    await userRepo.save(users);
    targetInviteeId = users[0].id;
    otherInviteeId = users[1].id;
  });

  afterAll(async () => {
    const ds = app.get<DataSource>(getDataSourceToken());
    await ds.query('TRUNCATE TABLE "event_invitees","events","users" RESTART IDENTITY CASCADE;');
    await app.close();
  });

  const createEvent = async (title: string, start: string, end: string, inviteeIds: string[]) => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send({
        title,
        status: 'TODO',
        startTime: start,
        endTime: end,
        inviteeIds,
      })
      .expect(201);
    return res.body;
  };

  it('POST /events/merge-all/:inviteeId merges chained overlaps for a single invitee and leaves others intact', async () => {
    // Create 3 overlapping events for target invitee: should merge into one [10:00, 10:40]
    const e1 = await createEvent('T1', '2025-10-01T10:00:00Z', '2025-10-01T10:20:00Z', [targetInviteeId]);
    const e2 = await createEvent('T2', '2025-10-01T10:10:00Z', '2025-10-01T10:30:00Z', [targetInviteeId]);
    const e3 = await createEvent('T3', '2025-10-01T10:25:00Z', '2025-10-01T10:40:00Z', [targetInviteeId]);

    // Non-overlapping event for target (should not be merged/removed)
    const eSeparate = await createEvent('T4', '2025-10-01T11:00:00Z', '2025-10-01T11:30:00Z', [targetInviteeId]);

    // Overlapping event for a different invitee (should not be affected)
    const eOther = await createEvent('O1', '2025-10-01T10:05:00Z', '2025-10-01T10:35:00Z', [otherInviteeId]);

    // Act: merge for target invitee
    const res = await request(app.getHttpServer())
      .post(`/events/merge-all/${targetInviteeId}`)
      .expect(201);

    // res expectations: merged and removed arrays exist
    expect(res.body).toHaveProperty('merged');
    expect(res.body).toHaveProperty('removed');
    expect(Array.isArray(res.body.merged)).toBe(true);
    expect(Array.isArray(res.body.removed)).toBe(true);

    // Expect at least one merged interval covering full range
    const merged = res.body.merged as any[];
    const removed = res.body.removed as any[];

    // Validate merged interval span and invitee presence
    const mergedSpanning = merged.find(
      (m: any) =>
        new Date(m.startTime).toISOString() === '2025-10-01T10:00:00.000Z' &&
        new Date(m.endTime).toISOString() === '2025-10-01T10:40:00.000Z'
    );
    expect(mergedSpanning).toBeTruthy();
    expect(mergedSpanning.invitees.some((u: any) => u.id === targetInviteeId)).toBe(true);

    // Validate removed original overlapping events by id
    const removedIds = removed.map((x: any) => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    expect(removedIds).toEqual(expect.arrayContaining([e1.id, e2.id, e3.id]));

    // Originals should be gone
    await request(app.getHttpServer()).get(`/events/${e1.id}`).expect(404);
    await request(app.getHttpServer()).get(`/events/${e2.id}`).expect(404);
    await request(app.getHttpServer()).get(`/events/${e3.id}`).expect(404);

    // Non-overlapping event for target still exists
    await request(app.getHttpServer()).get(`/events/${eSeparate.id}`).expect(200);

    // Other invitee's event still exists
    await request(app.getHttpServer()).get(`/events/${eOther.id}`).expect(200);

    // Merged event retrievable with expected times and invitee
    const mergedId = typeof mergedSpanning === 'string' ? mergedSpanning : mergedSpanning.id;
    const mergedGet = await request(app.getHttpServer()).get(`/events/${mergedId}`).expect(200);
    expect(new Date(mergedGet.body.startTime).toISOString()).toBe('2025-10-01T10:00:00.000Z');
    expect(new Date(mergedGet.body.endTime).toISOString()).toBe('2025-10-01T10:40:00.000Z');
    expect(mergedGet.body.invitees.some((u: any) => u.id === targetInviteeId)).toBe(true);
  });

  it('POST /events/merge-all/:inviteeId is idempotent (no further merges after already merged)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/events/merge-all/${targetInviteeId}`)
      .expect(201);
    expect(Array.isArray(res.body.merged)).toBe(true);
    expect(Array.isArray(res.body.removed)).toBe(true);
    expect(res.body.merged.length).toBe(0);
    expect(res.body.removed.length).toBe(0);
  });
});