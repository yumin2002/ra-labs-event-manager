import dataSource from '../../data-source';  // adjust path if your data-source.ts is elsewhere
import { User } from '../users/user.entity';

async function runSeed() {
  try {
    await dataSource.initialize();

    const userRepo = dataSource.getRepository(User);

    // create demo users
    const users = userRepo.create([
        { id: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
        { id: '33333333-3333-4333-8333-333333333333', name: 'Charlie' },
    ]);

    await userRepo.save(users);

    console.log('✅ Seed complete! Inserted users:', users);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    await dataSource.destroy();
  }
}

runSeed();
