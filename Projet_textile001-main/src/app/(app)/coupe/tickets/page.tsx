import { requirePageRole } from '@/server/auth/guards';
import TicketsManager from '@/features/coupe/tickets/tickets-manager';

export const metadata = { title: 'Tickets de production' };

export default async function TicketsPage() {
  await requirePageRole('chef_coupe');
  return <TicketsManager />;
}
